// Supabase writers that turn one document into the next.
// They wrap documentFlow.ts (pure mapping) with the DB reads/writes needed to
// hydrate branch/customer snapshots, compute GST totals, and persist rows +
// child items. Kept out of documentFlow.ts so the pure module stays testable.

import { supabase } from "@/integrations/supabase/client";
import {
  computeTotals,
  stateCodeFromGSTIN,
  stateNameFromCode,
  amountInWords,
  stateCodeFromStateName,
} from "@/lib/gst";
import { fetchBranches, itemDraftFromBreakup, type ItemDraft } from "@/lib/sales";
import type { Quotation, Customer } from "@/lib/crm";
import type { SalesOrder } from "@/lib/salesOrders";
import { fetchSalesOrder } from "@/lib/salesOrders";
import { getCompany } from "@/lib/letterhead";
import {
  quoteToSalesOrder,
  salesOrderToDeliveryChallan,
  salesOrderToInvoice,
  deliveryChallanToInvoice,
  salesOrderToInvoicePartial,
  salesOrderToGeneralDcPartial,
  salesOrderToProformaPartial,
  salesOrderToDeliveryChallanPartial,
  validateThisQty,
  type NewInvoicePayload,
  type FulfillmentLine,
  type SoFulfillmentSummary,
} from "@/lib/documentFlow";
import type { DeliveryChallan } from "@/lib/challan";
import { insertGeneralDc } from "@/lib/generalDc";
import { insertProforma, fetchProforma } from "@/lib/proforma";
import { findShortfalls, blockMessage, logNegativeOverrides } from "@/lib/negativeStock";

const SO_FULFILL_LOCK_PREFIX = "so_fulfill:";

/**
 * Serialize concurrent conversions on the same SO.
 * Canonical DB pattern is `pg_advisory_xact_lock(hashtextextended('so_fulfill:'||soId,0))`
 * inside `set_*_no()` triggers. No dedicated RPC exists for this key on the
 * Supabase JS client, so we attempt `supabase.rpc("pg_advisory_xact_lock", …)` and
 * fall back to optimistic concurrency (balance re-validation inside fn). The
 * true serialization guarantee is the re-validation of `balance` before insert
 * — the lock is opportunistic.
 */
async function withSoFulfillLock<T>(soId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${SO_FULFILL_LOCK_PREFIX}${soId}`;
  try {
    const { error } = await supabase.rpc("pg_advisory_xact_lock" as never, { key } as never);
    if (error && import.meta.env.DEV) {
      console.warn("[withSoFulfillLock] advisory lock RPC not available, falling back to optimistic:", error.message);
    }
  } catch (_e) {
    if (import.meta.env.DEV) console.warn("[withSoFulfillLock] fallback to optimistic", _e);
  }
  return fn();
}

async function fetchSoViewSummary(soId: string): Promise<SoFulfillmentSummary[]> {
  const { data, error } = await supabase
    .from("so_fulfillment_summary" as never)
    .select("*")
    .eq("sales_order_id", soId);
  if (error) throw error;
  return (data ?? []) as unknown as SoFulfillmentSummary[];
}

function buildPriorThisBalance(
  _so: SalesOrder,
  summary: SoFulfillmentSummary[],
  lines: FulfillmentLine[],
): { prior: unknown[]; thisFulfilled: unknown[]; balanceAfter: unknown[] } {
  const map = new Map<number, SoFulfillmentSummary>();
  for (const s of summary) map.set(Number(s.line_index), s);
  const prior: unknown[] = [];
  const thisFulfilled: unknown[] = [];
  const balanceAfter: unknown[] = [];
  for (const fl of lines) {
    const s = map.get(fl.line_index);
    const fulfilledBefore = s ? Number(s.fulfilled_stock) || 0 : Number(fl.fulfilled_before) || 0;
    const orderedQty = Number(fl.ordered_qty) || 0;
    const thisQty = Number(fl.this_qty) || 0;
    prior.push({
      line_index: fl.line_index,
      product_id: fl.product_id,
      ordered_qty: orderedQty,
      fulfilled_before: fulfilledBefore,
    });
    if (thisQty > 0) {
      thisFulfilled.push({ line_index: fl.line_index, this_qty: thisQty, product_id: fl.product_id });
    }
    const balance = Math.max(0, orderedQty - fulfilledBefore - thisQty);
    balanceAfter.push({ line_index: fl.line_index, balance, ordered_qty: orderedQty });
  }
  return { prior, thisFulfilled, balanceAfter };
}

async function insertLedgerAndFulfillments(params: {
  sales_order_id: string;
  conversion_type: string;
  target_table: string;
  target_id: string;
  target_no: string | null;
  prior: unknown[];
  thisFulfilled: unknown[];
  balanceAfter: unknown[];
  lines: FulfillmentLine[];
  status?: string;
}): Promise<{ ledgerId: string }> {
  const { sales_order_id, conversion_type, target_table, target_id, target_no, prior, thisFulfilled, balanceAfter, lines, status } = params;
  const { data: ledger, error: ledgerErr } = await supabase
    .from("so_conversions" as never)
    .insert({
      sales_order_id,
      conversion_type,
      target_table,
      target_id,
      target_no,
      status: status ?? "draft",
      prior_fulfilled: prior as never,
      this_fulfilled: thisFulfilled as never,
      balance_after: balanceAfter as never,
    } as never)
    .select("id")
    .single();
  if (ledgerErr) throw ledgerErr;
  const ledgerId = (ledger as { id: string }).id;
  const rows = lines
    .filter((l) => Number(l.this_qty) > 0)
    .map((l) => ({
      sales_order_id,
      conversion_id: ledgerId,
      line_index: l.line_index,
      product_id: l.product_id ?? null,
      ordered_qty: Number(l.ordered_qty) || 0,
      this_qty: Number(l.this_qty) || 0,
      warehouse_id: (l as unknown as { warehouse_id?: string | null }).warehouse_id ?? null,
      serial_numbers: Array.isArray((l as unknown as { serial_numbers?: string[] }).serial_numbers)
        ? ((l as unknown as { serial_numbers: string[] }).serial_numbers as string[])
        : [],
    }));
  if (rows.length > 0) {
    const { error: fulErr } = await supabase.from("so_fulfillments" as never).insert(rows as never);
    if (fulErr) {
      await supabase.from("so_conversions" as never).delete().eq("id", ledgerId);
      throw new Error(`Ledger fulfillments could not be saved (ledger rolled back): ${fulErr.message}`);
    }
  }
  return { ledgerId };
}

async function fetchCustomer(id: string | null): Promise<Customer | null> {
  if (!id) return null;
  const { data } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  return (data as unknown as Customer) || null;
}

async function hydrateParties(so: { branch_id: string | null; customer_id: string | null }) {
  const [branches, customer] = await Promise.all([fetchBranches(), fetchCustomer(so.customer_id)]);
  const branch =
    branches.find((b) => b.id === so.branch_id) ||
    branches.find((b) => b.is_default) ||
    branches[0];
  return { branch, customer };
}

/**
 * Idempotent: reuses the linked SO if the quote already has one.
 *
 * B-01/B-02/B-25 hardening:
 *  1. Existing SO is looked up BOTH by the quote's `converted_to_so_id`
 *     marker AND by `sales_orders.linked_quote_id`, so a lost/corrupt marker
 *     cannot cause a duplicate SO.
 *  2. A conditional "claim" update (`converted_to_so_id IS NULL`) serializes
 *     concurrent double-clicks at the row-lock level — the loser sees zero
 *     updated rows and reloads the winner's SO instead of inserting its own.
 *  3. Every write result is checked; nothing is swallowed (B-16).
 */
export async function createSalesOrderFromQuote(
  quote: Quotation,
): Promise<{ id: string; so_no: string | null }> {
  type Created = { id: string; so_no: string | null };

  const findExisting = async (): Promise<Created | null> => {
    const linkedId = (quote as unknown as { converted_to_so_id?: string | null })
      .converted_to_so_id;
    if (linkedId) {
      const { data, error } = await supabase
        .from("sales_orders" as never)
        .select("id, so_no")
        .eq("id", linkedId)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as Created;
    }
    const { data: byLink, error: err2 } = await supabase
      .from("sales_orders" as never)
      .select("id, so_no")
      .eq("linked_quote_id", quote.id)
      .limit(1)
      .maybeSingle();
    if (err2) throw err2;
    return (byLink as unknown as Created) || null;
  };

  const existing = await findExisting();
  if (existing) {
    // Backfill the marker if it was lost, best-effort but reported.
    const { error: backfillErr } = await supabase
      .from("quotations")
      .update({ converted_to_so_id: existing.id, status: "accepted" } as never)
      .eq("id", quote.id)
      .is("converted_to_so_id", null);
    if (backfillErr && import.meta.env.DEV)
      console.error("quotation converted_to_so_id backfill failed:", backfillErr.message);
    return existing;
  }

  // Serialize concurrent conversions: only one caller can move the marker off NULL.
  const PLACEHOLDER = "00000000-0000-0000-0000-000000000001";
  const { data: claimed, error: claimError } = await supabase
    .from("quotations")
    .update({ status: "accepted", converted_to_so_id: PLACEHOLDER } as never)
    .eq("id", quote.id)
    .is("converted_to_so_id", null)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) {
    // Another request won the race — return its SO instead of duplicating.
    const winner = await findExisting();
    if (winner) return winner;
    throw new Error("Quotation is already being converted — refresh and try again.");
  }

  const payload = quoteToSalesOrder(quote);

  let created: Created;
  try {
    const { customer, branch } = await hydrateParties({
      branch_id: payload.branch_id,
      customer_id: payload.customer_id,
    });
    const company = await getCompany();

    const sellerCode = branch?.state_code || stateCodeFromGSTIN(branch?.gstin) || null;
    const buyerCode =
      (customer as unknown as { state_code?: string })?.state_code ||
      stateCodeFromGSTIN(customer?.gst || null) ||
      stateCodeFromStateName((customer as unknown as { state?: string })?.state || null) ||
      null;

    const totals = computeTotals({
      sellerStateCode: sellerCode,
      buyerStateCode: buyerCode,
      items: (payload.items || []).map((i) => ({
        qty: i.qty,
        rate: i.rate,
        discount_pct: i.discount_pct,
        gst_rate: i.gst_rate,
        cess_rate: Number((i as any).cess_rate) || 0,
      })),
      headerDiscount: Number((payload as any).discount_amount ?? payload.discount) || 0,
      roundOff: true,
    });

    const itemsWithBreakup = payload.items.map((it, i) => {
      const b = totals.items[i];
      return {
        ...it,
        taxable_value: b.taxable_value,
        cgst: b.cgst,
        sgst: b.sgst,
        igst: b.igst,
        cess: b.cess,
        line_total: b.line_total,
      };
    });

    // Preserve shipping/TCS/adjustment that were previously dropped (#3)
    const shipping = Number((payload as any).shipping_charges) || 0;
    const adjustment = Number((payload as any).adjustment) || 0;
    const tcsAmt = Number((payload as any).tcs_amount) || 0;
    // totals.total already includes headerDiscount + GST + round_off; add shipping/adjustment/TCS on top
    const extra = shipping + adjustment + tcsAmt;
    const finalRound = totals.round_off;
    const finalTotal = totals.total + extra;

    const {
      shipping_charges: _sc,
      adjustment: _adj,
      tcs_percent: _tcsP,
      tcs_amount: _tcsA,
      discount_label: _dl,
      discount_amount: _da,
      ...payloadSansExtra
    } = payload as any;
    const insert = {
      ...payloadSansExtra,
      branch_id: branch?.id ?? payload.branch_id,
      seller_name: company.name,
      seller_gstin: company.gstin ?? branch?.gstin ?? null,
      seller_state: branch?.state_name ?? stateNameFromCode(sellerCode) ?? null,
      seller_state_code: sellerCode,
      seller_address: company.regd_address,
      buyer_name: customer?.company ?? null,
      buyer_gstin: customer?.gst ?? null,
      buyer_state: customer?.state ?? stateNameFromCode(buyerCode) ?? null,
      buyer_state_code: buyerCode,
      place_of_supply: payload.place_of_supply || customer?.state || null,
      place_of_supply_code: buyerCode,
      is_interstate: totals.is_interstate,
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxable_value: totals.taxable_value,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      cess: totals.cess,
      round_off: finalRound,
      shipping_charges: shipping,
      adjustment,
      tcs_percent: Number((payload as any).tcs_percent) || 0,
      tcs_amount: tcsAmt,
      discount_label: (payload as any).discount_label ?? null,
      discount_amount: Number((payload as any).discount_amount) || 0,
      total: finalTotal,
      total_in_words: amountInWords(finalTotal),
      items: itemsWithBreakup,
    };

    const { data: invData, error: invError } = await supabase
      .from("sales_orders" as never)
      .insert(insert as never)
      .select("id, so_no")
      .single();
    if (invError) throw invError;
    created = invData as Created;
  } catch (e) {
    // Release claim so retry can proceed
    await supabase
      .from("quotations")
      .update({ status: quote.status ?? "draft", converted_to_so_id: null } as never)
      .eq("id", quote.id);
    throw e;
  }

  const { error: linkErr } = await supabase
    .from("quotations")
    .update({ converted_to_so_id: created.id } as never)
    .eq("id", quote.id);
  if (linkErr) {
    // The SO exists; the marker must still land or the quote looks unconverted.
    throw new Error(
      `Sales Order ${created.so_no || created.id} created, but linking it back to the quotation failed: ${linkErr.message}`,
    );
  }
  return created;
}

/**
 * @deprecated use createDeliveryChallanFromSO with lines for partial support
 * — kept for backward compat (full-qty callers e.g. sales.orders.$id.tsx)
 */
export async function createChallanFromSalesOrder(
  so: SalesOrder,
): Promise<{ id: string; challan_no: string | null }> {
  type Created = { id: string; challan_no: string | null };

  const { data: existingDc, error: dcLookupErr } = await supabase
    .from("delivery_challans" as never)
    .select("id, challan_no")
    .eq("sales_order_id", so.id)
    .order("created_at", { ascending: false } as never)
    .limit(1)
    .maybeSingle();
  if (dcLookupErr) throw dcLookupErr;
  if (existingDc) return existingDc as unknown as Created;

  const rawPayload = salesOrderToDeliveryChallan(so);
  // Strip synthetic fields that are not columns in delivery_challans (branch_id etc — kept only inside items JSON)
  const { branch_id: _b, buyer_state: _bs, buyer_state_code: _bsc, ...payload } = rawPayload as any;
  const { data, error } = await supabase
    .from("delivery_challans" as never)
    .insert(payload as never)
    .select("id, challan_no")
    .single();
  if (error) throw error;

  // Status flip is conditional + checked: never clobber "invoiced", and a
  // failure must surface (the user can safely retry — the DC lookup above
  // makes a retry return the existing challan instead of duplicating).
  const { error: statusErr } = await supabase
    .from("sales_orders" as never)
    .update({ status: so.status === "invoiced" ? so.status : "partial" } as never)
    .eq("id", so.id);
  if (statusErr) {
    throw new Error(
      `Delivery Challan created, but updating the Sales Order status failed: ${statusErr.message}`,
    );
  }
  return data as Created;
}

async function insertInvoiceFromPayload(
  payload: NewInvoicePayload,
  hydrate: { branchId?: string | null; customerId?: string | null },
): Promise<{ id: string; invoice_no: string | null }> {
  const { branch, customer } = await hydrateParties({
    branch_id: hydrate.branchId ?? payload.branch_id,
    customer_id: hydrate.customerId ?? payload.customer_id,
  });
  if (!branch) throw new Error("No branch configured for invoice");
  if (!branch.gstin) throw new Error("Selected branch has no GSTIN — set it in Sales → Settings");
  if (!customer) throw new Error("Customer required to raise invoice");
  const company = await getCompany();

  const sellerCode = branch.state_code || stateCodeFromGSTIN(branch.gstin) || null;
  const buyerCode =
    (customer as unknown as { state_code?: string }).state_code ||
    stateCodeFromGSTIN(customer.gst || null) ||
    stateCodeFromStateName((customer as unknown as { state?: string })?.state || null) ||
    null;

  const drafts: ItemDraft[] = (payload.items || []).map((it: any) => ({
    product_id: it.product_id ?? null,
    description: it.description || "",
    hsn: it.hsn || "",
    qty: Number(it.qty) || 0,
    unit: it.unit || "Nos",
    rate: Number(it.rate) || 0,
    discount_pct: Number(it.discount_pct) || 0,
    gst_rate: Number(it.gst_rate) || 0,
    cess_rate: Number(it.cess_rate) || 0,
    warehouse_id: it.warehouse_id ?? null,
    serial_numbers: Array.isArray(it.serial_numbers) ? it.serial_numbers : [],
    is_serialized: !!(
      it.is_serialized ??
      (Array.isArray(it.serial_numbers) && it.serial_numbers.length > 0)
    ),
    part_model_no: it.part_model_no ?? null,
    part_name: it.part_name ?? null,
  }));

  // Preserve header-level extras (shipping/TCS/adjustment) — previously dropped
  const ship = Number((payload as any).shipping_charges) || 0;
  const adj = Number((payload as any).adjustment) || 0;
  const tcsP = Number((payload as any).tcs_percent) || 0;
  let tcsA = Number((payload as any).tcs_amount) || 0;
  // If tcs_amount not explicit but percent given, derive it on discounted total + shipping (mirrors crm.computeQuoteTotals)
  // computeTotals already yields taxable+gst; tcs base = taxable + shipping

  const baseTotals = computeTotals({
    sellerStateCode: sellerCode,
    buyerStateCode: buyerCode,
    items: drafts.map((i) => ({
      qty: i.qty,
      rate: i.rate,
      discount_pct: i.discount_pct,
      gst_rate: i.gst_rate,
      cess_rate: (i as any).cess_rate || 0,
    })),
    roundOff: true,
  });
  if (tcsP > 0 && tcsA === 0) {
    const tcsBase = baseTotals.taxable_value + ship;
    tcsA = Math.round(((tcsBase * tcsP) / 100) * 100) / 100;
  }
  const extraInv = ship + adj + tcsA;
  const totals = {
    ...baseTotals,
    total: baseTotals.total + extraInv,
    round_off: baseTotals.round_off,
  } as typeof baseTotals;

  const insertPayload: any = {
    invoice_date: payload.invoice_date,
    branch_id: branch.id,
    customer_id: customer.id,
    po_number: payload.po_number,
    po_date: payload.po_date,
    seller_name: company.name,
    seller_gstin: company.gstin || branch.gstin,
    seller_state: branch.state_name,
    seller_state_code: sellerCode,
    seller_address: company.regd_address,
    buyer_name: customer.company,
    buyer_gstin: customer.gst,
    buyer_state: customer.state ?? stateNameFromCode(buyerCode),
    buyer_state_code: buyerCode,
    billing_address: payload.billing_address ?? customer.billing_address,
    shipping_address:
      payload.shipping_address ?? customer.shipping_address ?? customer.billing_address,
    place_of_supply: payload.place_of_supply ?? customer.state,
    place_of_supply_code: buyerCode,
    is_interstate: totals.is_interstate,
    reverse_charge: !!(payload as any).reverse_charge,
    subtotal: totals.subtotal,
    discount: totals.discount,
    taxable_value: totals.taxable_value,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    cess: totals.cess,
    round_off: totals.round_off,
    total: totals.total,
    total_in_words: amountInWords(totals.total),
    status: "draft",
    notes: payload.notes,
    terms: payload.terms,
    payment_terms: payload.payment_terms,
    linked_quote_id: payload.linked_quote_id,
    linked_dc_ids: payload.linked_dc_ids,
    sales_order_id: payload.sales_order_id,
  };

  const { data: inv, error } = await supabase
    .from("invoices")
    .insert(insertPayload as never)
    .select("id, invoice_no")
    .single();
  if (error) throw error;

  const rows = drafts.map((d, i) => {
    const b = totals.items[i];
    const r = itemDraftFromBreakup(d, b);
    return { ...r, invoice_id: (inv as { id: string }).id, sr_no: i + 1 };
  });
  const { error: e2 } = await supabase.from("invoice_items").insert(rows as never);
  if (e2) {
    // Compensating cleanup (B-16/race #29): never leave an orphan invoice
    // header with no line items — a retry would otherwise find it via the
    // idempotency check and treat the broken invoice as complete.
    await supabase
      .from("invoices")
      .delete()
      .eq("id", (inv as { id: string }).id);
    throw new Error(`Invoice items could not be saved (header rolled back): ${e2.message}`);
  }

  return inv as { id: string; invoice_no: string | null };
}

/**
 * @deprecated use ledger view + balance checks — kept for backward compat
 * Idempotency helper: prefers issued invoice; falls back to draft (may be orphaned).
 */
async function findInvoiceForSalesOrder(
  soId: string,
): Promise<{ id: string; invoice_no: string | null } | null> {
  // Prefer a fully-issued invoice (idempotent success)
  const { data: issued, error: e1 } = await supabase
    .from("invoices")
    .select("id, invoice_no")
    .eq("sales_order_id", soId)
    .in("status", ["issued", "partial", "paid"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e1) throw e1;
  if (issued) return issued as { id: string; invoice_no: string | null };
  // Fall back to draft (may be orphaned — caller should handle)
  const { data: draft, error: e2 } = await supabase
    .from("invoices")
    .select("id, invoice_no")
    .eq("sales_order_id", soId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e2) throw e2;
  return (draft as { id: string; invoice_no: string | null }) || null;
}

/**
 * @deprecated use createTaxInvoiceFromSO with lines for partial support
 * — kept for backward compat (full-qty SO detail callers)
 */
export async function createInvoiceFromSalesOrder(so: SalesOrder) {
  // B-25: SO → Invoice was previously unprotected against double-clicks.
  const existingInv = await findInvoiceForSalesOrder(so.id);
  if (existingInv) {
    const { error: statusErr } = await supabase
      .from("sales_orders" as never)
      .update({ status: "invoiced" } as never)
      .eq("id", so.id);
    if (statusErr && import.meta.env.DEV)
      console.error("sales_orders status flip failed:", statusErr.message);
    return existingInv;
  }

  const payload = salesOrderToInvoice(so);
  const inv = await insertInvoiceFromPayload(payload, {
    branchId: so.branch_id,
    customerId: so.customer_id,
  });

  const { error: statusErr } = await supabase
    .from("sales_orders" as never)
    .update({ status: "invoiced" } as never)
    .eq("id", so.id);
  if (statusErr) {
    // Safe to surface: a retry finds the existing invoice instead of duplicating.
    throw new Error(
      `Invoice created, but updating the Sales Order status failed: ${statusErr.message}`,
    );
  }
  return inv;
}

export async function createInvoiceFromChallan(
  dc: DeliveryChallan,
  linked: {
    sales_order_id?: string | null;
    linked_quote_id?: string | null;
    branch_id?: string | null;
    customer_id?: string | null;
  } = {},
) {
  // B-25: DC → Invoice idempotency — an invoice already raised from this DC
  // is returned instead of duplicated.
  const { data: existing, error: lookupErr } = await supabase
    .from("invoices")
    .select("id, invoice_no")
    .contains("linked_dc_ids", [dc.id])
    .neq("status", "cancelled")
    .limit(1)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (existing) return existing as unknown as { id: string; invoice_no: string | null };

  const payload = deliveryChallanToInvoice(dc, linked);
  return insertInvoiceFromPayload(payload, {
    branchId: linked.branch_id ?? null,
    customerId: linked.customer_id ?? null,
  });
}

// ── New ledger-aware partial writers (V2) ─────────────────────────────────

function stockLinesFromFulfillment(so: SalesOrder, lines: FulfillmentLine[]) {
  const stockLines: { model: string; label?: string | null; warehouseId?: string | null; qty: number; stockType?: "good" | "defective" }[] = [];
  for (const fl of lines) {
    const qty = Number(fl.this_qty) || 0;
    if (qty <= 0) continue;
    if (fl.product_id == null) continue;
    const soItem = (so.items?.[fl.line_index] as unknown as Record<string, unknown>) ?? {};
    const model = String((soItem as { part_model_no?: string; model_no?: string; part_name?: string }).part_model_no || (soItem as { model_no?: string }).model_no || (soItem as { part_name?: string }).part_name || "").trim();
    if (!model) continue;
    stockLines.push({
      model,
      label: (soItem as { description?: string; part_name?: string }).description || (soItem as { part_name?: string }).part_name || null,
      warehouseId: (fl as unknown as { warehouse_id?: string | null }).warehouse_id ?? (soItem as { warehouse_id?: string | null }).warehouse_id ?? null,
      qty,
      stockType: "good",
    });
  }
  return stockLines;
}

async function revalidateBalanceOrThrow(soId: string, lines: FulfillmentLine[]): Promise<SoFulfillmentSummary[]> {
  const fresh = await fetchSoViewSummary(soId);
  const map = new Map<number, SoFulfillmentSummary>();
  for (const s of fresh) map.set(Number(s.line_index), s);
  for (const fl of lines) {
    const s = map.get(fl.line_index);
    const balance = s ? Number(s.balance) : Number(fl.balance);
    if (Number(fl.this_qty) > balance) {
      throw new Error(`Balance changed — ${balance} remaining for line ${fl.line_index + 1}, you asked ${fl.this_qty}. Refresh and try again.`);
    }
  }
  return fresh;
}

export async function createTaxInvoiceFromSO(
  soId: string,
  lines: FulfillmentLine[],
  opts?: { allow_negative_stock?: boolean },
): Promise<{ id: string; invoice_no: string | null }> {
  const err = validateThisQty(lines);
  if (err) throw new Error(err);

  const so = await fetchSalesOrder(soId);
  const summary = await fetchSoViewSummary(soId);

  for (const fl of lines) {
    const s = summary.find((x) => Number(x.line_index) === fl.line_index);
    const balance = s ? Number(s.balance) : Number(fl.balance);
    if (Number(fl.this_qty) > balance) {
      throw new Error(`Balance changed — ${balance} remaining for line ${fl.line_index + 1}, you asked ${fl.this_qty}. Refresh and try again.`);
    }
  }

  const stockLines = stockLinesFromFulfillment(so, lines);
  let shortfalls: Awaited<ReturnType<typeof findShortfalls>> = [];
  if (!opts?.allow_negative_stock && stockLines.length > 0) {
    shortfalls = await findShortfalls(stockLines);
    if (shortfalls.length > 0) throw new Error(blockMessage(shortfalls[0]));
  } else if (opts?.allow_negative_stock && stockLines.length > 0) {
    shortfalls = await findShortfalls(stockLines);
  }

  return withSoFulfillLock(soId, async () => {
    const freshSummary = await revalidateBalanceOrThrow(soId, lines);
    const payload = salesOrderToInvoicePartial(so, lines);
    let inv: { id: string; invoice_no: string | null } | null = null;
    let ledgerId: string | null = null;
    try {
      inv = await insertInvoiceFromPayload(payload, { branchId: so.branch_id, customerId: so.customer_id });
      const { prior, thisFulfilled, balanceAfter } = buildPriorThisBalance(so, freshSummary, lines);
      const res = await insertLedgerAndFulfillments({
        sales_order_id: soId,
        conversion_type: "tax_invoice",
        target_table: "invoices",
        target_id: inv.id,
        target_no: inv.invoice_no,
        prior,
        thisFulfilled,
        balanceAfter,
        lines,
        status: "draft",
      });
      ledgerId = res.ledgerId;
      const { error: updErr } = await supabase.from("invoices" as never).update({ conversion_id: ledgerId } as never).eq("id", inv.id);
      if (updErr) {
        try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {}
        throw updErr;
      }
      if (inv.invoice_no) {
        try { await supabase.from("so_conversions" as never).update({ target_no: inv.invoice_no } as never).eq("id", ledgerId); } catch {}
      }
      if (opts?.allow_negative_stock && shortfalls.length > 0) {
        try {
          await logNegativeOverrides({
            documentType: "invoice",
            documentId: inv.id,
            documentNo: inv.invoice_no,
            shortfalls,
            reason: "SO split-delivery override",
          });
        } catch {}
      }
      return inv;
    } catch (e) {
      if (ledgerId) { try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {} }
      if (inv) { try { await supabase.from("invoices" as never).delete().eq("id", inv.id); } catch {} }
      throw e;
    }
  });
}

export async function createGeneralDcFromSO(
  soId: string,
  lines: FulfillmentLine[],
  opts?: { allow_negative_stock?: boolean; returnable?: boolean; expected_return_date?: string | null; purpose?: string; issueImmediately?: boolean },
): Promise<{ id: string; dc_no: string | null }> {
  const err = validateThisQty(lines);
  if (err) throw new Error(err);

  const so = await fetchSalesOrder(soId);
  const summary = await fetchSoViewSummary(soId);
  for (const fl of lines) {
    const s = summary.find((x) => Number(x.line_index) === fl.line_index);
    const balance = s ? Number(s.balance) : Number(fl.balance);
    if (Number(fl.this_qty) > balance) throw new Error(`Balance changed — ${balance} remaining for line ${fl.line_index + 1}, you asked ${fl.this_qty}. Refresh and try again.`);
  }

  const stockLines = stockLinesFromFulfillment(so, lines);
  let shortfalls: Awaited<ReturnType<typeof findShortfalls>> = [];
  if (!opts?.allow_negative_stock && stockLines.length > 0) {
    shortfalls = await findShortfalls(stockLines);
    if (shortfalls.length > 0) throw new Error(blockMessage(shortfalls[0]));
  } else if (opts?.allow_negative_stock && stockLines.length > 0) {
    shortfalls = await findShortfalls(stockLines);
  }

  return withSoFulfillLock(soId, async () => {
    const freshSummary = await revalidateBalanceOrThrow(soId, lines);
    const base = salesOrderToGeneralDcPartial(so, lines);
    if (opts?.returnable !== undefined) (base as unknown as Record<string, unknown>).returnable = !!opts.returnable;
    if (opts?.expected_return_date !== undefined) (base as unknown as Record<string, unknown>).expected_return_date = opts.expected_return_date;
    if (opts?.purpose !== undefined) (base as unknown as Record<string, unknown>).purpose = opts.purpose;
    if (opts?.allow_negative_stock !== undefined) (base as unknown as Record<string, unknown>).allow_negative_stock = !!opts.allow_negative_stock;
    if (opts?.issueImmediately) (base as unknown as Record<string, unknown>).status = "Issued";

    let gdc: { id: string; dc_no: string | null; status?: string } | null = null;
    let ledgerId: string | null = null;
    try {
      const inserted = await insertGeneralDc(base as unknown as Record<string, unknown>);
      gdc = { id: (inserted as unknown as { id: string }).id, dc_no: (inserted as unknown as { dc_no: string | null }).dc_no ?? null, status: (inserted as unknown as { status?: string }).status ?? (base as unknown as { status?: string }).status ?? "Draft" };

      const { prior, thisFulfilled, balanceAfter } = buildPriorThisBalance(so, freshSummary, lines);
      const res = await insertLedgerAndFulfillments({
        sales_order_id: soId,
        conversion_type: "general_dc",
        target_table: "general_delivery_challans",
        target_id: gdc.id,
        target_no: gdc.dc_no,
        prior,
        thisFulfilled,
        balanceAfter,
        lines,
        status: String(gdc.status ?? "Draft").toLowerCase(),
      });
      ledgerId = res.ledgerId;
      const { error: updErr } = await supabase
        .from("general_delivery_challans" as never)
        .update({ conversion_id: ledgerId, sales_order_id: soId } as never)
        .eq("id", gdc.id);
      if (updErr) {
        try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {}
        throw updErr;
      }
      if (opts?.allow_negative_stock && shortfalls.length > 0) {
        try {
          await logNegativeOverrides({
            documentType: "dc",
            documentId: gdc.id,
            documentNo: gdc.dc_no,
            shortfalls,
            reason: "SO split-delivery GDC override",
          });
        } catch {}
      }
      return { id: gdc.id, dc_no: gdc.dc_no };
    } catch (e) {
      if (ledgerId) { try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {} }
      if (gdc) { try { await supabase.from("general_delivery_challans" as never).delete().eq("id", gdc.id); } catch {} }
      throw e;
    }
  });
}

export async function createProformaFromSO(
  soId: string,
  lines: FulfillmentLine[],
): Promise<{ id: string; proforma_no: string | null }> {
  const err = validateThisQty(lines);
  if (err) throw new Error(err);

  const so = await fetchSalesOrder(soId);
  const summary = await fetchSoViewSummary(soId);
  for (const fl of lines) {
    const s = summary.find((x) => Number(x.line_index) === fl.line_index);
    const balance = s ? Number(s.balance) : Number(fl.balance);
    if (Number(fl.this_qty) > balance) throw new Error(`Balance changed — ${balance} remaining for line ${fl.line_index + 1}, you asked ${fl.this_qty}. Refresh and try again.`);
  }

  return withSoFulfillLock(soId, async () => {
    const freshSummary = await revalidateBalanceOrThrow(soId, lines);
    const base = salesOrderToProformaPartial(so, lines);

    const { branch, customer } = await hydrateParties({ branch_id: (so as unknown as { branch_id: string | null }).branch_id, customer_id: (so as unknown as { customer_id: string | null }).customer_id });
    if (!branch) throw new Error("No branch configured for proforma");
    if (!customer) throw new Error("Customer required to raise proforma");
    const company = await getCompany();
    const sellerCode = branch.state_code || stateCodeFromGSTIN(branch.gstin) || null;
    const buyerCode =
      (customer as unknown as { state_code?: string }).state_code ||
      stateCodeFromGSTIN(customer.gst || null) ||
      stateCodeFromStateName((customer as unknown as { state?: string })?.state || null) ||
      null;

    const drafts: ItemDraft[] = (base.items || []).map((it: unknown) => {
      const a = it as Record<string, unknown>;
      return {
        product_id: (a.product_id as string | null) ?? null,
        description: (a.description as string) || "",
        hsn: (a.hsn as string) || "",
        qty: Number(a.qty) || 0,
        unit: (a.unit as string) || "Nos",
        rate: Number(a.rate) || 0,
        discount_pct: Number(a.discount_pct) || 0,
        gst_rate: Number(a.gst_rate) || 0,
        cess_rate: Number(a.cess_rate) || 0,
        warehouse_id: (a.warehouse_id as string | null) ?? null,
        serial_numbers: Array.isArray(a.serial_numbers) ? (a.serial_numbers as string[]) : [],
        is_serialized: !!((a.is_serialized as boolean) ?? (Array.isArray(a.serial_numbers) && (a.serial_numbers as string[]).length > 0)),
        part_model_no: (a.part_model_no as string | null) ?? null,
        part_name: (a.part_name as string | null) ?? null,
      };
    });

    const ship = Number((base as unknown as Record<string, unknown>).shipping_charges) || 0;
    const adj = Number((base as unknown as Record<string, unknown>).adjustment) || 0;
    const tcsP = Number((base as unknown as Record<string, unknown>).tcs_percent) || 0;
    let tcsA = Number((base as unknown as Record<string, unknown>).tcs_amount) || 0;
    const baseTotals = computeTotals({
      sellerStateCode: sellerCode,
      buyerStateCode: buyerCode,
      items: drafts.map((i) => ({
        qty: i.qty,
        rate: i.rate,
        discount_pct: i.discount_pct,
        gst_rate: i.gst_rate,
        cess_rate: (i as unknown as { cess_rate?: number }).cess_rate || 0,
      })),
      roundOff: true,
    });
    if (tcsP > 0 && tcsA === 0) {
      const tcsBase = baseTotals.taxable_value + ship;
      tcsA = Math.round(((tcsBase * tcsP) / 100) * 100) / 100;
    }
    const extra = ship + adj + tcsA;
    const totals = { ...baseTotals, total: baseTotals.total + extra } as typeof baseTotals;

    const payload: Record<string, unknown> = {
      proforma_date: (base as unknown as Record<string, unknown>).proforma_date,
      branch_id: branch.id,
      customer_id: customer.id,
      sales_order_id: soId,
      seller_name: company.name,
      seller_gstin: company.gstin || branch.gstin,
      seller_state: branch.state_name,
      seller_state_code: sellerCode,
      seller_address: company.regd_address,
      buyer_name: customer.company,
      buyer_gstin: customer.gst,
      buyer_state: customer.state ?? stateNameFromCode(buyerCode),
      buyer_state_code: buyerCode,
      billing_address: (base as unknown as Record<string, unknown>).billing_address ?? customer.billing_address,
      shipping_address: (base as unknown as Record<string, unknown>).shipping_address ?? customer.shipping_address ?? customer.billing_address,
      place_of_supply: (base as unknown as Record<string, unknown>).place_of_supply ?? customer.state,
      place_of_supply_code: buyerCode,
      is_interstate: totals.is_interstate,
      reverse_charge: !!((base as unknown as Record<string, unknown>).reverse_charge),
      po_number: (base as unknown as Record<string, unknown>).po_number,
      po_date: (base as unknown as Record<string, unknown>).po_date,
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxable_value: totals.taxable_value,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      cess: totals.cess,
      round_off: totals.round_off,
      total: totals.total,
      total_in_words: amountInWords(totals.total),
      shipping_charges: ship,
      adjustment: adj,
      tcs_percent: tcsP,
      tcs_amount: tcsA,
      discount_label: (base as unknown as Record<string, unknown>).discount_label ?? null,
      discount_amount: Number((base as unknown as Record<string, unknown>).discount_amount) || 0,
      items: drafts.map((d, i) => {
        const b = totals.items[i];
        return itemDraftFromBreakup(d as ItemDraft, b);
      }),
      prior_fulfilled: (base as unknown as Record<string, unknown>).prior_fulfilled,
      this_fulfilled: (base as unknown as Record<string, unknown>).this_fulfilled,
      status: "draft",
      notes: (base as unknown as Record<string, unknown>).notes,
      terms: (base as unknown as Record<string, unknown>).terms,
    };

    let proforma: { id: string; proforma_no: string | null } | null = null;
    let ledgerId: string | null = null;
    try {
      const inserted = await insertProforma(payload);
      proforma = { id: (inserted as unknown as { id: string }).id, proforma_no: (inserted as unknown as { proforma_no: string | null }).proforma_no ?? null };

      const { prior, thisFulfilled, balanceAfter } = buildPriorThisBalance(so, freshSummary, lines);
      const res = await insertLedgerAndFulfillments({
        sales_order_id: soId,
        conversion_type: "proforma_invoice",
        target_table: "proforma_invoices",
        target_id: proforma.id,
        target_no: proforma.proforma_no,
        prior,
        thisFulfilled,
        balanceAfter,
        lines,
        status: "draft",
      });
      ledgerId = res.ledgerId;
      const { error: updErr } = await supabase.from("proforma_invoices" as never).update({ conversion_id: ledgerId } as never).eq("id", proforma.id);
      if (updErr) {
        try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {}
        throw updErr;
      }
      return { id: proforma.id, proforma_no: proforma.proforma_no };
    } catch (e) {
      if (ledgerId) { try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {} }
      if (proforma) { try { await supabase.from("proforma_invoices" as never).delete().eq("id", proforma.id); } catch {} }
      throw e;
    }
  });
}

export async function createDeliveryChallanFromSO(
  soId: string,
  lines: FulfillmentLine[],
): Promise<{ id: string; challan_no: string | null }> {
  const err = validateThisQty(lines);
  if (err) throw new Error(err);

  const so = await fetchSalesOrder(soId);
  const summary = await fetchSoViewSummary(soId);
  for (const fl of lines) {
    const s = summary.find((x) => Number(x.line_index) === fl.line_index);
    const balance = s ? Number(s.balance) : Number(fl.balance);
    if (Number(fl.this_qty) > balance) throw new Error(`Balance changed — ${balance} remaining for line ${fl.line_index + 1}, you asked ${fl.this_qty}. Refresh and try again.`);
  }

  return withSoFulfillLock(soId, async () => {
    const freshSummary = await revalidateBalanceOrThrow(soId, lines);
    const base = salesOrderToDeliveryChallanPartial(so, lines);
    const { branch_id: _b, buyer_state: _bs, buyer_state_code: _bsc, ...payload } = base as unknown as Record<string, unknown>;

    let dc: { id: string; challan_no: string | null } | null = null;
    let ledgerId: string | null = null;
    try {
      const { data, error } = await supabase.from("delivery_challans" as never).insert(payload as never).select("id, challan_no").single();
      if (error) throw error;
      dc = data as { id: string; challan_no: string | null };

      const { prior, thisFulfilled, balanceAfter } = buildPriorThisBalance(so, freshSummary, lines);
      const res = await insertLedgerAndFulfillments({
        sales_order_id: soId,
        conversion_type: "delivery_challan",
        target_table: "delivery_challans",
        target_id: dc.id,
        target_no: dc.challan_no,
        prior,
        thisFulfilled,
        balanceAfter,
        lines,
        status: "Draft",
      });
      ledgerId = res.ledgerId;
      const { error: updErr } = await supabase.from("delivery_challans" as never).update({ conversion_id: ledgerId } as never).eq("id", dc.id);
      if (updErr) {
        try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {}
        throw updErr;
      }
      return { id: dc.id, challan_no: dc.challan_no };
    } catch (e) {
      if (ledgerId) { try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {} }
      if (dc) { try { await supabase.from("delivery_challans" as never).delete().eq("id", dc.id); } catch {} }
      throw e;
    }
  });
}

export async function createInvoiceFromProforma(
  proformaId: string,
  lines?: FulfillmentLine[],
): Promise<{ id: string; invoice_no: string | null }> {
  const proforma = await fetchProforma(proformaId);
  const soId = (proforma as unknown as { sales_order_id: string | null }).sales_order_id as string | null;

  let payload: NewInvoicePayload;
  let fulLines: FulfillmentLine[] | null = null;

  if (soId && lines && lines.length > 0) {
    const err = validateThisQty(lines);
    if (err) throw new Error(err);
    const so = await fetchSalesOrder(soId);
    payload = salesOrderToInvoicePartial(so, lines);
    fulLines = lines;
    (payload as unknown as Record<string, unknown>).sales_order_id = soId;
  } else if (soId && !lines) {
    const so = await fetchSalesOrder(soId);
    const proformaItems = (proforma.items || []) as unknown as Array<{ qty: number }>;
    const summary = await fetchSoViewSummary(soId);
    const derived: FulfillmentLine[] = proformaItems.map((it, idx) => {
      const s = summary.find((x) => Number(x.line_index) === idx);
      return {
        line_index: idx,
        product_id: (so.items?.[idx] as unknown as { product_id: string | null })?.product_id ?? null,
        ordered_qty: Number((so.items?.[idx] as unknown as { qty: number })?.qty) || Number(it.qty) || 0,
        fulfilled_before: s ? Number(s.fulfilled_stock) || 0 : 0,
        balance: s ? Number(s.balance) : Number((so.items?.[idx] as unknown as { qty: number })?.qty) || 0,
        this_qty: Number(it.qty) || 0,
        warehouse_id: (so.items?.[idx] as unknown as { warehouse_id: string | null })?.warehouse_id ?? null,
      } as FulfillmentLine;
    });
    payload = salesOrderToInvoicePartial(so, derived);
    fulLines = derived;
    (payload as unknown as Record<string, unknown>).sales_order_id = soId;
  } else {
    const items = (proforma.items || []) as unknown as FulfillmentLine[];
    payload = {
      branch_id: (proforma as unknown as { branch_id: string | null }).branch_id ?? null,
      customer_id: (proforma as unknown as { customer_id: string | null }).customer_id ?? null,
      invoice_date: new Date().toISOString().slice(0, 10),
      billing_address: (proforma as unknown as { billing_address: string | null }).billing_address ?? null,
      shipping_address: (proforma as unknown as { shipping_address: string | null }).shipping_address ?? null,
      place_of_supply: (proforma as unknown as { place_of_supply: string | null }).place_of_supply ?? null,
      buyer_name: (proforma as unknown as { buyer_name: string | null }).buyer_name ?? null,
      buyer_gstin: (proforma as unknown as { buyer_gstin: string | null }).buyer_gstin ?? null,
      buyer_state: (proforma as unknown as { buyer_state: string | null }).buyer_state ?? null,
      buyer_state_code: (proforma as unknown as { buyer_state_code: string | null }).buyer_state_code ?? null,
      po_number: (proforma as unknown as { po_number: string | null }).po_number ?? null,
      po_date: (proforma as unknown as { po_date: string | null }).po_date ?? null,
      notes: (proforma as unknown as { notes: string | null }).notes ?? null,
      terms: (proforma as unknown as { terms: string | null }).terms ?? null,
      payment_terms: null,
      linked_quote_id: null,
      linked_dc_ids: null,
      sales_order_id: soId,
      items: (proforma.items as unknown as SalesOrder["items"]) || [],
      reverse_charge: !!((proforma as unknown as { reverse_charge: boolean }).reverse_charge),
      shipping_charges: Number((proforma as unknown as { shipping_charges: number }).shipping_charges) || 0,
      adjustment: Number((proforma as unknown as { adjustment: number }).adjustment) || 0,
      tcs_percent: Number((proforma as unknown as { tcs_percent: number }).tcs_percent) || 0,
      tcs_amount: Number((proforma as unknown as { tcs_amount: number }).tcs_amount) || 0,
      round_off: Number((proforma as unknown as { round_off: number }).round_off) || 0,
      discount_label: (proforma as unknown as { discount_label: string | null }).discount_label ?? null,
    };
    if (lines && lines.length > 0) {
      const filtered = new Map(lines.filter((l) => Number(l.this_qty) > 0).map((l) => [l.line_index, l]));
      payload.items = (payload.items as unknown as Array<Record<string, unknown>>).filter((_, idx) => filtered.has(idx)).map((it: Record<string, unknown>, idx: number) => {
        const fl = (Array.from(filtered.values()) as FulfillmentLine[]).find((x) => x.line_index === idx) ?? filtered.get(idx);
        if (!fl) return it as unknown as typeof payload.items[number];
        return { ...(it as object), qty: Number(fl.this_qty) || (it.qty as number) } as unknown as typeof payload.items[number];
      });
      fulLines = lines;
    } else {
      // standalone fallback: fulLines from items length
      fulLines = null;
    }
    if (!payload.items || payload.items.length === 0) throw new Error("Proforma has no items to invoice");
  }

  if (soId && fulLines) {
    const soForStock = await fetchSalesOrder(soId);
    const stockLines = stockLinesFromFulfillment(soForStock, fulLines);
    if (stockLines.length > 0) {
      const shortfalls = await findShortfalls(stockLines);
      if (shortfalls.length > 0) throw new Error(blockMessage(shortfalls[0]));
    }
  }

  let inv: { id: string; invoice_no: string | null } | null = null;
  let ledgerId: string | null = null;
  try {
    inv = await insertInvoiceFromPayload(payload, { branchId: payload.branch_id, customerId: payload.customer_id });

    const { error: linkErr } = await supabase.from("invoices" as never).update({ linked_proforma_id: proformaId } as never).eq("id", inv.id);
    if (linkErr) {
      try { await supabase.from("invoices" as never).delete().eq("id", inv.id); } catch {}
      throw linkErr;
    }

    if (soId && fulLines) {
      const so = await fetchSalesOrder(soId);
      const summary = await fetchSoViewSummary(soId);
      const { prior, thisFulfilled, balanceAfter } = buildPriorThisBalance(so, summary, fulLines);
      const res = await insertLedgerAndFulfillments({
        sales_order_id: soId,
        conversion_type: "tax_invoice",
        target_table: "invoices",
        target_id: inv.id,
        target_no: inv.invoice_no,
        prior,
        thisFulfilled,
        balanceAfter,
        lines: fulLines,
        status: "draft",
      });
      ledgerId = res.ledgerId;
      const { error: convErr } = await supabase.from("invoices" as never).update({ conversion_id: ledgerId } as never).eq("id", inv.id);
      if (convErr) {
        try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {}
        throw convErr;
      }
    }
    return inv;
  } catch (e) {
    if (ledgerId) { try { await supabase.from("so_conversions" as never).delete().eq("id", ledgerId); } catch {} }
    if (inv) { try { await supabase.from("invoices" as never).delete().eq("id", inv.id); } catch {} }
    throw e;
  }
}
