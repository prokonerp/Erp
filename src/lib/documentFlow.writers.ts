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
  r2,
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
  validateSoForConversion,
  type NewInvoicePayload,
  type FulfillmentLine,
  type SoFulfillmentSummary,
  type ConversionType,
} from "@/lib/documentFlow";
import type { DeliveryChallan } from "@/lib/challan";
import { insertGeneralDc } from "@/lib/generalDc";
import { insertProforma, fetchProforma } from "@/lib/proforma";
import { findShortfalls, blockMessage, logNegativeOverrides } from "@/lib/negativeStock";

const SO_FULFILL_LOCK_PREFIX = "so_fulfill:";

/**
 * Serialize concurrent conversions on the same SO.
 * Canonical DB pattern is `pg_advisory_xact_lock(hashtextextended('so_fulfill:'||soId,0))`
 * inside `set_*_no()` triggers. JS (Supabase JS client) cannot hold a single
 * Postgres transaction across multiple statements — each supabase.rpc / insert
 * is its own transaction/statement. So `pg_advisory_xact_lock` (transaction-
 * scoped) releases instantly after the single RPC statement and does NOT guard
 * the subsequent inserts. The REAL race guard is therefore optimistic
 * re-validation + post-insert verification (verifyNoOverFulfillment) which rolls
 * back over-fulfillment if two concurrent writers slip through.
 *
 * We still attempt `pg_advisory_lock` (session-level) first — if the Supabase
 * RPC exists it is held for the whole fn duration and released in finally.
 * Then we try `pg_advisory_xact_lock` as fallback. If neither is available we
 * fall back to optimistic + verification. The lock is opportunistic; verification
 * is mandatory.
 */
export async function withSoFulfillLock<T>(soId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${SO_FULFILL_LOCK_PREFIX}${soId}`;
  let locked = false;
  let lockMethod: "session" | "xact" | null = null;
  try {
    const { error: e1 } = await supabase.rpc("pg_advisory_lock" as never, { key } as never);
    if (!e1) {
      locked = true;
      lockMethod = "session";
    } else {
      const { error: e2 } = await supabase.rpc("pg_advisory_xact_lock" as never, { key } as never);
      if (!e2) {
        locked = true;
        lockMethod = "xact";
      } else if (import.meta.env.DEV) {
        console.warn("[withSoFulfillLock] advisory lock RPC not available, falling back to optimistic+verification:", e2.message);
      }
    }
  } catch (_e) {
    if (import.meta.env.DEV) console.warn("[withSoFulfillLock] fallback to optimistic+verification", _e);
  }
  try {
    return await fn();
  } finally {
    if (locked && lockMethod === "session") {
      try {
        await supabase.rpc("pg_advisory_unlock" as never, { key } as never);
      } catch {}
    }
    // xact lock auto-releases at statement end — nothing to do; session lock released above
  }
}

export async function verifyNoOverFulfillment(params: {
  soId: string;
  so: SalesOrder;
  lines: FulfillmentLine[];
  targetTable: string;
  targetId: string;
  ledgerId: string;
}): Promise<void> {
  const { soId, so, lines, targetTable, targetId, ledgerId } = params;
  for (const fl of lines) {
    const qty = Number(fl.this_qty) || 0;
    if (qty <= 0) continue;
    const soItem = so.items?.[fl.line_index] as unknown as Record<string, unknown> | undefined;
    const orderedQty = Number((soItem as { qty?: number; quantity?: number } | undefined)?.qty ?? (soItem as { quantity?: number } | undefined)?.quantity ?? fl.ordered_qty) || 0;
    if (orderedQty <= 0) continue;
    const { data, error } = await supabase
      .from("so_fulfillments" as never)
      .select("this_qty, so_conversions!inner(conversion_type, status)")
      .eq("sales_order_id", soId)
      .eq("line_index", fl.line_index);
    if (error) throw error;
    // Only count stock-affecting fulfillments (exclude proforma, mirror view logic)
    const rows = (data as unknown as Array<{ this_qty: number; so_conversions: { conversion_type: string; status: string } }> | null) ?? [];
    const total = rows
      .filter((r) => r.so_conversions.conversion_type !== "proforma_invoice" && r.so_conversions.status !== "cancelled")
      .reduce((sum, r) => sum + (Number(r.this_qty) || 0), 0);
    if (total > orderedQty) {
      // Roll back: delete ledger (+ cascades fulfillments) and target doc
      try {
        await supabase.from("so_conversions" as never).delete().eq("id", ledgerId);
      } catch {}
      try {
        await supabase.from(targetTable as never).delete().eq("id", targetId);
      } catch {}
      throw new Error("Over-fulfillment detected — concurrent update, please retry");
    }
  }
}

export async function fetchSoViewSummary(soId: string): Promise<SoFulfillmentSummary[]> {
  const { data, error } = await supabase
    .from("so_fulfillment_summary" as never)
    .select("*")
    .eq("sales_order_id", soId);
  if (error) throw error;
  return (data ?? []) as unknown as SoFulfillmentSummary[];
}

export function buildPriorThisBalance(
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

export async function insertLedgerAndFulfillments(params: {
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
  const branch = branches.find((b) => b.id === so.branch_id);
  if (!branch) {
    // Fail closed — silent fallback to wrong branch flips CGST/SGST↔IGST (LOG-C3)
    throw new Error(
      so.branch_id
        ? `Branch ${so.branch_id} not found — check branch config in Sales → Settings`
        : "No branch selected — pick a branch before creating documents",
    );
  }
  return { branch, customer };
}

// ── Hardened helpers ────────────────────────────────────────────────────────

/**
 * Strict balance validation with consistent error message including SO No and line description.
 * Handles NaN, negative, missing qty uniformly. Throws on any violation.
 */
export function assertBalancesOrThrow(
  soId: string,
  so: SalesOrder,
  lines: FulfillmentLine[],
  summary: SoFulfillmentSummary[],
): void {
  const soNo = (so as unknown as { so_no?: string | null }).so_no || soId;
  const map = new Map<number, SoFulfillmentSummary>();
  for (const s of summary) map.set(Number((s as unknown as { line_index: number }).line_index), s as SoFulfillmentSummary);

  for (const fl of lines) {
    const item = so.items?.[fl.line_index] as unknown as Record<string, unknown> | undefined;
    const descRaw = (item as { description?: string; part_name?: string } | undefined)?.description
      || (item as { part_name?: string } | undefined)?.part_name
      || (fl as unknown as { description?: string | null }).description
      || null;
    const desc = descRaw ? String(descRaw).trim() : "";
    const label = desc ? `${desc} (Line ${fl.line_index + 1})` : `Line ${fl.line_index + 1}`;

    // orderedQty: prefer view summary, else derive from SO items (not client fl.balance), fallback to fl.ordered_qty
    let orderedQty: number;
    const s = map.get(fl.line_index);
    if (s) {
      orderedQty = Number((s as unknown as { ordered_qty: number }).ordered_qty);
    } else {
      const raw = (item as { qty?: unknown; quantity?: unknown } | undefined)?.qty
        ?? (item as { quantity?: unknown } | undefined)?.quantity
        ?? fl.ordered_qty;
      orderedQty = Number(raw);
    }
    if (!Number.isFinite(orderedQty)) {
      throw new Error(`SO ${soNo} — ${label}: ordered quantity is invalid (got ${String(orderedQty)})`);
    }
    if (orderedQty < -1e-9) {
      throw new Error(`SO ${soNo} — ${label}: ordered quantity cannot be negative (got ${orderedQty})`);
    }
    // missing qty: 0 with positive this_qty is an error
    const thisQtyRaw = fl.this_qty;
    const thisQty = Number(thisQtyRaw);
    if (!Number.isFinite(thisQty)) {
      throw new Error(`SO ${soNo} — ${label}: quantity must be a valid number (got ${String(thisQtyRaw)})`);
    }
    if (thisQty < -1e-9) {
      throw new Error(`SO ${soNo} — ${label}: quantity cannot be negative (got ${thisQty})`);
    }
    if (thisQty > 1e-9 && (!Number.isFinite(orderedQty) || orderedQty <= 1e-9)) {
      throw new Error(`SO ${soNo} — ${label}: ordered quantity missing or zero, cannot fulfill (ordered ${orderedQty})`);
    }

    let balance: number;
    if (s) {
      balance = Number((s as unknown as { balance: number }).balance);
      if (!Number.isFinite(balance)) {
        throw new Error(`SO ${soNo} — ${label}: balance is invalid (got ${String((s as unknown as { balance: unknown }).balance)})`);
      }
    } else {
      const fulfilledBefore = Number(fl.fulfilled_before) || 0;
      if (!Number.isFinite(fulfilledBefore) || fulfilledBefore < -1e-9) {
        throw new Error(`SO ${soNo} — ${label}: fulfilled_before is invalid (got ${String(fl.fulfilled_before)})`);
      }
      balance = Math.max(0, orderedQty - (Number.isFinite(fulfilledBefore) ? fulfilledBefore : 0));
    }

    if (!Number.isFinite(balance)) {
      throw new Error(`SO ${soNo} — ${label}: balance is invalid (got ${String(balance)})`);
    }
    if (balance < -1e-9) {
      throw new Error(`SO ${soNo} — ${label}: balance cannot be negative (got ${balance})`);
    }
    if (thisQty - balance > 1e-6) {
      throw new Error(`SO ${soNo} — ${label}: Balance changed — ${balance} remaining, you asked ${thisQty}. Refresh and try again.`);
    }
  }
}

/**
 * Validate SO status for conversion. Wraps documentFlow.validateSoForConversion
 * and throws a user-friendly error if SO is cancelled or fully delivered.
 */
export function validateSoStatusForConversion(
  so: SalesOrder,
  conversionType: ConversionType | string,
): void {
  const err = validateSoForConversion(so, conversionType as ConversionType);
  if (err) throw new Error(err);
}

/**
 * Consistent rollback helper for writers. Deletes ledger and target doc, then re-throws.
 * Every writer (createTaxInvoiceFromSO, createGeneralDcFromSO, createProformaFromSO,
 * createDeliveryChallanFromSO, createInvoiceFromProforma) must use this in catch blocks.
 */
export async function handleWriterError(
  e: unknown,
  ledgerId: string | null,
  targetId: string | null,
  targetTable: string,
): Promise<never> {
  if (ledgerId) {
    try {
      await supabase.from("so_conversions" as never).delete().eq("id", ledgerId);
    } catch {}
  }
  if (targetId && targetTable) {
    try {
      await supabase.from(targetTable as never).delete().eq("id", targetId);
    } catch {}
  }
  throw e;
}

/**
 * Cancel a conversion by its ledger id. Marks so_conversions.status='cancelled'
 * (view so_fulfillment_summary excludes cancelled, so balance restores + stock reverses via trigger).
 */
export async function cancelSoConversion(conversionId: string): Promise<void> {
  if (!conversionId) throw new Error("conversionId required");
  const { error } = await supabase.from("so_conversions" as never).update({ status: "cancelled" } as never).eq("id", conversionId);
  if (error) throw error;
}

/**
 * Sync cancellation to ledger for a target document (e.g. invoice/dc cancel).
 * Updates so_conversions.status='cancelled' via target_table/target_id and also via conversion_id FK fallback.
 */
export async function syncCancelToLedger(targetTable: string, targetId: string): Promise<void> {
  if (!targetTable || !targetId) return;
  try {
    await supabase.from("so_conversions" as never).update({ status: "cancelled" } as never).eq("target_table", targetTable as never).eq("target_id", targetId);
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[syncCancelToLedger] update via target_table/target_id failed", e);
  }
  try {
    const { data } = await supabase.from(targetTable as never).select("conversion_id").eq("id", targetId).maybeSingle();
    const convId = (data as unknown as { conversion_id?: string | null } | null)?.conversion_id;
    if (convId) {
      await supabase.from("so_conversions" as never).update({ status: "cancelled" } as never).eq("id", convId);
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[syncCancelToLedger] fallback via conversion_id failed", e);
  }
}

// ── Pooled invoice reversal gap ────────────────────────────────────────────
/**
 * POOLED INVOICE REVERSAL GAP
 *
 * Stock posting for SO conversions uses two paths:
 *  - Serialized items: dedicated rows in ims_stock_items with part_serial_no != null; reversal on
 *    invoice/DC cancel is handled by DB trigger `trg_revert_stock_on_invoice_cancel` (or similar)
 *    which flips stock_status back to 'available'.
 *  - Pooled (non-serialized) items: aggregated qty in ims_stock_items where part_serial_no IS NULL
 *    and stock_status='available'. Deduction is via `ims_deduct_qty` / stock triggers on invoice/DC
 *    creation. However, the existing cancel triggers do NOT restore pooled qty — they only handle
 *    serialized serials. This means cancelling a pooled invoice currently leaves stock understated.
 *
 * Required migration (NOT yet applied — do not assume it exists):
 * ```sql
 * -- restore pooled qty when invoice/dc is cancelled
 * create or replace function public.restore_pooled_stock_on_cancel() returns trigger as $$
 * begin
 *   if NEW.status = 'cancelled' and OLD.status != 'cancelled' then
 *     -- re-add qty to ims_stock_items (pooled) per invoice_items / general_dc items
 *     -- and insert compensating ims_transactions
 *   end if;
 *   return NEW;
 * end; $$ language plpgsql;
 * create trigger trg_restore_pooled_on_invoice_cancel
 *   after update on public.invoices for each row execute function public.restore_pooled_stock_on_cancel();
 * -- repeat for general_delivery_challans and delivery_challans
 * ```
 *
 * Until that migration lands, this JS fallback is a NO-OP that logs a warning so operators know
 * pooled stock was NOT restored. If you need immediate JS restoration, uncomment the suppressed
 * block inside restorePooledStockOnInvoiceCancel and ensure it is idempotent with the future trigger.
 */
export async function restorePooledStockOnInvoiceCancel(invoiceId: string): Promise<void> {
  if (!invoiceId) return;
  if (import.meta.env.DEV) {
    console.warn(
      "[restorePooledStockOnInvoiceCancel] pooled reversal trigger not yet migrated — JS fallback is NO-OP. Invoice",
      invoiceId,
      "pooled stock not restored; add migration trg_restore_pooled_on_invoice_cancel (see comment above).",
    );
  }
  // --- Optional JS fallback (keep disabled until migration decision) ---
  // const { data: items } = await supabase.from("invoice_items").select("part_model_no, qty, warehouse_id").eq("invoice_id", invoiceId);
  // for (const it of ((items ?? []) as unknown as Array<{ part_model_no: string | null; qty: number; warehouse_id: string | null }>)) {
  //   if (!it.part_model_no || !it.qty) continue;
  //   // upsert/increment pooled stock row: update ims_stock_items qty = qty + it.qty where part_model_no=... and warehouse_id=... and part_serial_no is null
  //   // and insert ims_transactions with txn_type 'stock_adjustment'
  // }
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
    // Recompute round_off including extras — stale round_off from computeTotals
    // causes ≤0.49 drift between DB total and NIC TotInvVal (LOG-C1)
    const grossWithExtras = r2(totals.taxable_value + totals.cgst + totals.sgst + totals.igst + totals.cess + extra);
    const finalRound = r2(Math.round(grossWithExtras) - grossWithExtras);
    const finalTotal = r2(Math.round(grossWithExtras));

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
    if (invError) {
      // 409 duplicate = uq_so_linked_quote — another request already created SO for this quote.
      // Treat as idempotent success: return winner instead of bubbling 409.
      const code = (invError as unknown as { code?: string }).code;
      const msg = (invError.message || "").toLowerCase();
      const isDup =
        code === "23505" ||
        msg.includes("uq_so_linked_quote") ||
        msg.includes("duplicate") ||
        msg.includes("already exists");
      if (isDup) {
        const winner = await findExisting();
        if (winner) {
          // Backfill marker if missing (best-effort)
          try {
            await supabase
              .from("quotations")
              .update({ converted_to_so_id: winner.id, status: "accepted" } as never)
              .eq("id", quote.id)
              .is("converted_to_so_id", null);
          } catch {}
          return winner;
        }
        // Fallback: fresh lookup by linked_quote_id (covers stale `quote` closure)
        try {
          const { data: byLink } = await supabase
            .from("sales_orders" as never)
            .select("id, so_no")
            .eq("linked_quote_id", quote.id)
            .maybeSingle();
          if (byLink) return byLink as unknown as Created;
        } catch {}
      }
      throw invError;
    }
    created = invData as Created;
  } catch (e) {
    throw e;
  }

  // Final link is conditional (converted_to_so_id IS NULL) — serializes concurrent
  // double-clicks without needing a FK-violating placeholder row. If we lost
  // the race, we roll back our SO and return the winner's SO instead.
  const { data: linkedRows, error: linkErr } = await supabase
    .from("quotations")
    .update({ converted_to_so_id: created.id, status: "accepted" } as never)
    .eq("id", quote.id)
    .is("converted_to_so_id", null)
    .select("id");
  if (linkErr) {
    try {
      await supabase.from("sales_orders" as never).delete().eq("id", created.id);
    } catch {}
    throw new Error(
      `Sales Order ${created.so_no || created.id} created, but linking it back to the quotation failed: ${linkErr.message}`,
    );
  }
  if (!linkedRows || linkedRows.length === 0) {
    // Lost race — another tab/request claimed it while we were inserting
    try {
      await supabase.from("sales_orders" as never).delete().eq("id", created.id);
    } catch {}
    const winner = await findExisting();
    if (winner) return winner;
    throw new Error(
      "This quotation was already converted by another user — please refresh. Your sales order was rolled back to avoid duplication.",
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
    warranty_applicable: (it.warranty_applicable as boolean | null) ?? null,
    warranty_duration: it.warranty_duration != null ? Number(it.warranty_duration) : it.warranty_months != null ? Number(it.warranty_months) : null,
    warranty_unit: (it.warranty_unit as string | null) ?? (it.warranty_months != null ? "Months" : null),
    warranty_start_from: (it.warranty_start_from as string | null) ?? null,
    warranty_type: (it.warranty_type as string | null) ?? null,
    warranty_months: it.warranty_months != null ? Number(it.warranty_months) : null,
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
    tcsA = r2((tcsBase * tcsP) / 100); // FIX-11: use r2 for EPSILON-aware rounding
  }
  const extraInv = ship + adj + tcsA;
  // Recompute round_off including extras — stale round_off from computeTotals
  // causes ≤0.49 drift between DB total and NIC TotInvVal (LOG-C1)
  const grossWithExtrasInv = r2(baseTotals.taxable_value + baseTotals.cgst + baseTotals.sgst + baseTotals.igst + baseTotals.cess + extraInv);
  const totals = {
    ...baseTotals,
    total: r2(Math.round(grossWithExtrasInv)),
    round_off: r2(Math.round(grossWithExtrasInv) - grossWithExtrasInv),
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
    // FIX: propagate admin allow_negative_stock so DB trigger respects override (no data loss, additive)
    allow_negative_stock: !!((payload as any).allow_negative_stock),
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

export async function stockLinesFromFulfillment(so: SalesOrder, lines: FulfillmentLine[]) {
  // Parallelized: collect fetch promises for lines missing model, then Promise.all
  type StockLine = { model: string; label?: string | null; warehouseId?: string | null; qty: number; stockType?: "good" | "defective" };
  const pending: Promise<StockLine | null>[] = [];

  for (const fl of lines) {
    const qty = Number(fl.this_qty) || 0;
    if (qty <= 0) continue;
    if (fl.product_id == null) continue;
    if (fl.is_serialized) continue;
    const soItem = (so.items?.[fl.line_index] as unknown as Record<string, unknown>) ?? {};
    const partModelNo = String((soItem as { part_model_no?: string; model_no?: string; part_name?: string }).part_model_no || (soItem as { model_no?: string }).model_no || (soItem as { part_name?: string }).part_name || "").trim();
    const description = String((soItem as { description?: string; part_name?: string }).description || (soItem as { part_name?: string }).part_name || (fl as unknown as { description?: string | null }).description || `Line ${fl.line_index + 1}`).trim();

    if (partModelNo) {
      pending.push(
        Promise.resolve({
          model: partModelNo,
          label: (soItem as { description?: string; part_name?: string }).description || (soItem as { part_name?: string }).part_name || description || null,
          warehouseId: (fl as unknown as { warehouse_id?: string | null }).warehouse_id ?? (soItem as { warehouse_id?: string | null }).warehouse_id ?? null,
          qty,
          stockType: "good" as const,
        }),
      );
    } else {
      // Need to fetch model from products table — parallelize via Promise.all
      if (!fl.product_id) continue;
      const pId = fl.product_id;
      const wh = (fl as unknown as { warehouse_id?: string | null }).warehouse_id ?? (soItem as { warehouse_id?: string | null }).warehouse_id ?? null;
      const lbl = (soItem as { description?: string; part_name?: string }).description || (soItem as { part_name?: string }).part_name || description || null;
      const lineIdx = fl.line_index;
      const lineLabel = description || `Line ${lineIdx + 1}`;
      pending.push(
        (async (): Promise<StockLine> => {
          const { data, error } = await supabase.from("products" as never).select("model").eq("id", pId as never).single();
          if (error) throw error;
          const fetched = String((data as unknown as { model?: string | null })?.model ?? "").trim();
          if (!fetched) {
            throw new Error(`Line ${lineIdx + 1} (${lineLabel}): missing model — cannot verify stock`);
          }
          return { model: fetched, label: lbl, warehouseId: wh, qty, stockType: "good" as const };
        })(),
      );
    }
  }

  const resolved = await Promise.all(pending);
  // Filter nulls (should not happen, but defensive)
  return resolved.filter((x): x is StockLine => x != null);
}

export async function revalidateBalanceOrThrow(soId: string, lines: FulfillmentLine[], so?: SalesOrder | null): Promise<SoFulfillmentSummary[]> {
  const fresh = await fetchSoViewSummary(soId);
  const map = new Map<number, SoFulfillmentSummary>();
  for (const s of fresh) map.set(Number(s.line_index), s);
  for (const fl of lines) {
    const s = map.get(fl.line_index);
    let balance: number;
    if (s) {
      balance = Number(s.balance);
    } else {
      // B3: never trust client-supplied fl.balance when view row is missing.
      // Derive orderedQty from SO items and compute balance = orderedQty - fulfilledBefore.
      let orderedQty: number;
      if (so && so.items?.[fl.line_index] != null) {
        const item = so.items[fl.line_index] as unknown as Record<string, unknown>;
        orderedQty = Number((item as { qty?: number }).qty ?? (item as { quantity?: number }).quantity ?? fl.ordered_qty) || 0;
      } else {
        orderedQty = Number(fl.ordered_qty) || 0;
      }
      const fulfilledBefore = Number(fl.fulfilled_before) || 0;
      balance = Math.max(0, orderedQty - fulfilledBefore);
    }
    if (Number(fl.this_qty) - balance > 1e-6) {
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
  validateSoStatusForConversion(so, "tax_invoice");
  const summary = await fetchSoViewSummary(soId);
  assertBalancesOrThrow(soId, so, lines, summary);

  return withSoFulfillLock(soId, async () => {
    const freshSummary = await revalidateBalanceOrThrow(soId, lines, so);
    // B2: stock check inside lock after revalidation, immediately before insert
    const stockLines = await stockLinesFromFulfillment(so, lines);
    let shortfalls: Awaited<ReturnType<typeof findShortfalls>> = [];
    if (!opts?.allow_negative_stock && stockLines.length > 0) {
      shortfalls = await findShortfalls(stockLines);
      if (shortfalls.length > 0) throw new Error(blockMessage(shortfalls[0]));
    } else if (opts?.allow_negative_stock && stockLines.length > 0) {
      shortfalls = await findShortfalls(stockLines);
    }
    const payload = salesOrderToInvoicePartial(so, lines);
    // Preserve admin override for DB trigger (additive, no overwrite of existing payload fields)
    (payload as any).allow_negative_stock = !!opts?.allow_negative_stock;
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
      // B1: post-insert verification — guard against race over-fulfillment
      await verifyNoOverFulfillment({ soId, so, lines, targetTable: "invoices", targetId: inv.id, ledgerId });
      const { error: updErr } = await supabase.from("invoices" as never).update({ conversion_id: ledgerId } as never).eq("id", inv.id);
      if (updErr) {
        await handleWriterError(updErr, ledgerId, inv.id, "invoices").catch(() => { throw updErr; });
        throw updErr;
      }
      if (inv.invoice_no) {
        try { await supabase.from("so_conversions" as never).update({ target_no: inv.invoice_no } as never).eq("id", ledgerId); } catch {}
      }
      if (opts?.allow_negative_stock && shortfalls.length > 0) {
        // SEC-C1: Audit trail MUST be written — never silently swallow this error.
        // If this fails, the outer catch block handles rollback.
        await logNegativeOverrides({
          documentType: "invoice",
          documentId: inv.id,
          documentNo: inv.invoice_no,
          shortfalls,
          reason: "SO split-delivery override",
        });
      }
      return inv;
    } catch (e) {
      await handleWriterError(e, ledgerId, inv?.id ?? null, "invoices").catch(() => { throw e; });
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
  validateSoStatusForConversion(so, "general_dc");
  const summary = await fetchSoViewSummary(soId);
  assertBalancesOrThrow(soId, so, lines, summary);

  return withSoFulfillLock(soId, async () => {
    const freshSummary = await revalidateBalanceOrThrow(soId, lines, so);
    // B2: stock check inside lock after revalidation
    const stockLines = await stockLinesFromFulfillment(so, lines);
    let shortfalls: Awaited<ReturnType<typeof findShortfalls>> = [];
    if (!opts?.allow_negative_stock && stockLines.length > 0) {
      shortfalls = await findShortfalls(stockLines);
      if (shortfalls.length > 0) throw new Error(blockMessage(shortfalls[0]));
    } else if (opts?.allow_negative_stock && stockLines.length > 0) {
      shortfalls = await findShortfalls(stockLines);
    }
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
      await verifyNoOverFulfillment({ soId, so, lines, targetTable: "general_delivery_challans", targetId: gdc.id, ledgerId });
      const { error: updErr } = await supabase
        .from("general_delivery_challans" as never)
        .update({ conversion_id: ledgerId, sales_order_id: soId } as never)
        .eq("id", gdc.id);
      if (updErr) {
        await handleWriterError(updErr, ledgerId, gdc.id, "general_delivery_challans").catch(() => { throw updErr; });
        throw updErr;
      }
      if (opts?.allow_negative_stock && shortfalls.length > 0) {
        // SEC-C1: Audit trail MUST be written — never silently swallow this error.
        await logNegativeOverrides({
          documentType: "dc",
          documentId: gdc.id,
          documentNo: gdc.dc_no,
          shortfalls,
          reason: "SO split-delivery GDC override",
        });
      }
      return { id: gdc.id, dc_no: gdc.dc_no };
    } catch (e) {
      await handleWriterError(e, ledgerId, gdc?.id ?? null, "general_delivery_challans").catch(() => { throw e; });
      throw e;
    }
  });
}

export async function createProformaFromSO(
  soId: string,
  lines: FulfillmentLine[],
  opts?: { allow_negative_stock?: boolean },
): Promise<{ id: string; proforma_no: string | null }> {
  void opts;
  const err = validateThisQty(lines);
  if (err) throw new Error(err);

  const so = await fetchSalesOrder(soId);
  validateSoStatusForConversion(so, "proforma_invoice");
  const summary = await fetchSoViewSummary(soId);
  assertBalancesOrThrow(soId, so, lines, summary);

  return withSoFulfillLock(soId, async () => {
    const freshSummary = await revalidateBalanceOrThrow(soId, lines, so);
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
        warranty_applicable: (a.warranty_applicable as boolean | null) ?? (a.warranty_months != null ? true : null),
        warranty_duration:
          a.warranty_duration != null
            ? Number(a.warranty_duration)
            : a.warranty_months != null
              ? Number(a.warranty_months)
              : null,
        warranty_unit: (a.warranty_unit as string | null) ?? (a.warranty_months != null ? "Months" : null),
        warranty_start_from: (a.warranty_start_from as string | null) ?? null,
        warranty_type: (a.warranty_type as string | null) ?? null,
        warranty_months: a.warranty_months != null ? Number(a.warranty_months) : null,
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
      tcsA = r2((tcsBase * tcsP) / 100); // FIX-11: use r2 for EPSILON-aware rounding
    }
    const extra = ship + adj + tcsA;
    // Recompute round_off including extras — stale round_off from computeTotals
    // causes ≤0.49 drift between DB total and NIC TotInvVal (LOG-C1)
    const grossWithExtrasPro = r2(baseTotals.taxable_value + baseTotals.cgst + baseTotals.sgst + baseTotals.igst + baseTotals.cess + extra);
    const totals = { ...baseTotals, total: r2(Math.round(grossWithExtrasPro)), round_off: r2(Math.round(grossWithExtrasPro) - grossWithExtrasPro) } as typeof baseTotals;

    // Preserve explicit PO/billing/buyer fields from SO (fallback chain: SO → quotation → hydrate)
    // hydrateParties recomputes seller/buyer snapshots, but explicit PO/details must NOT be overwritten with empty.
    const baseAny = base as unknown as Record<string, unknown>;
    const soAny = so as unknown as Record<string, unknown>;
    const payload: Record<string, unknown> = {
      proforma_date: baseAny.proforma_date,
      branch_id: branch.id,
      customer_id: customer.id,
      sales_order_id: soId,
      seller_name: company.name,
      seller_gstin: company.gstin || branch.gstin,
      seller_state: branch.state_name,
      seller_state_code: sellerCode,
      seller_address: company.regd_address,
      // Fallback chain: SO snapshot → customer master → computed code
      buyer_name: (baseAny.buyer_name as string) ?? customer.company,
      buyer_gstin: (baseAny.buyer_gstin as string) ?? customer.gst,
      buyer_state: (baseAny.buyer_state as string) ?? customer.state ?? stateNameFromCode(buyerCode),
      buyer_state_code: (baseAny.buyer_state_code as string) ?? buyerCode,
      billing_address: baseAny.billing_address ?? customer.billing_address,
      shipping_address: baseAny.shipping_address ?? customer.shipping_address ?? customer.billing_address,
      place_of_supply: baseAny.place_of_supply ?? customer.state,
      // Preserve explicit place_of_supply_code from SO if present, else recomputed buyerCode
      place_of_supply_code: (baseAny.place_of_supply_code as string) ?? (soAny.place_of_supply_code as string) ?? buyerCode,
      is_interstate: totals.is_interstate,
      reverse_charge: !!(baseAny.reverse_charge),
      po_number: baseAny.po_number ?? soAny.po_number ?? null,
      po_date: baseAny.po_date ?? soAny.po_date ?? null,
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
      prior_fulfilled: baseAny.prior_fulfilled,
      this_fulfilled: baseAny.this_fulfilled,
      status: "draft",
      notes: baseAny.notes,
      terms: baseAny.terms,
      // ── Extended print fields (persisted now that 20260913000002 adds columns) ──
      payment_terms: (baseAny as any).payment_terms ?? (soAny as any).payment_terms ?? null,
      salesperson: (baseAny as any).salesperson ?? (soAny as any).salesperson ?? null,
      contact_person: (baseAny as any).contact_person ?? (soAny as any).contact_person ?? null,
      contact_email: (baseAny as any).contact_email ?? (soAny as any).contact_email ?? null,
      contact_mobile: (baseAny as any).contact_mobile ?? (soAny as any).contact_mobile ?? null,
      delivery_timeline: (baseAny as any).delivery_timeline ?? (soAny as any).delivery_timeline ?? null,
      sales_type: (baseAny as any).sales_type ?? (soAny as any).sales_type ?? null,
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
      await verifyNoOverFulfillment({ soId, so, lines, targetTable: "proforma_invoices", targetId: proforma.id, ledgerId });
      const { error: updErr } = await supabase.from("proforma_invoices" as never).update({ conversion_id: ledgerId } as never).eq("id", proforma.id);
      if (updErr) {
        await handleWriterError(updErr, ledgerId, proforma.id, "proforma_invoices").catch(() => { throw updErr; });
        throw updErr;
      }
      return { id: proforma.id, proforma_no: proforma.proforma_no };
    } catch (e) {
      await handleWriterError(e, ledgerId, proforma?.id ?? null, "proforma_invoices").catch(() => { throw e; });
      throw e;
    }
  });
}

export async function createDeliveryChallanFromSO(
  soId: string,
  lines: FulfillmentLine[],
  opts?: { allow_negative_stock?: boolean },
): Promise<{ id: string; challan_no: string | null }> {
  void opts;
  const err = validateThisQty(lines);
  if (err) throw new Error(err);

  const so = await fetchSalesOrder(soId);
  validateSoStatusForConversion(so, "delivery_challan");
  const summary = await fetchSoViewSummary(soId);
  assertBalancesOrThrow(soId, so, lines, summary);

  return withSoFulfillLock(soId, async () => {
    const freshSummary = await revalidateBalanceOrThrow(soId, lines, so);
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
      await verifyNoOverFulfillment({ soId, so, lines, targetTable: "delivery_challans", targetId: dc.id, ledgerId });
      const { error: updErr } = await supabase.from("delivery_challans" as never).update({ conversion_id: ledgerId } as never).eq("id", dc.id);
      if (updErr) {
        await handleWriterError(updErr, ledgerId, dc.id, "delivery_challans").catch(() => { throw updErr; });
        throw updErr;
      }
      return { id: dc.id, challan_no: dc.challan_no };
    } catch (e) {
      await handleWriterError(e, ledgerId, dc?.id ?? null, "delivery_challans").catch(() => { throw e; });
      throw e;
    }
  });
}

export async function createInvoiceFromProforma(
  proformaId: string,
  lines?: FulfillmentLine[],
  opts?: { allow_negative_stock?: boolean },
): Promise<{ id: string; invoice_no: string | null }> {
  void opts;
  const proforma = await fetchProforma(proformaId);
  const soId = (proforma as unknown as { sales_order_id: string | null }).sales_order_id as string | null;

  let payload: NewInvoicePayload;
  let fulLines: FulfillmentLine[] | null = null;

  if (soId && lines && lines.length > 0) {
    const err = validateThisQty(lines);
    if (err) throw new Error(err);
    const so = await fetchSalesOrder(soId);
    validateSoStatusForConversion(so, "tax_invoice");
    payload = salesOrderToInvoicePartial(so, lines);
    fulLines = lines;
    (payload as unknown as Record<string, unknown>).sales_order_id = soId;
  } else if (soId && !lines) {
    const so = await fetchSalesOrder(soId);
    validateSoStatusForConversion(so, "tax_invoice");
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
      // B6 fix: reconstruct payload.items from lines via explicit line_index mapping,
      // not by filtering payload order. Payload order may not match line_index order.
      const activeLines = lines.filter((l) => Number(l.this_qty) > 0);
      const origItems = payload.items as unknown as Array<Record<string, unknown>>;
      payload.items = activeLines.map((fl) => {
        const orig = origItems[fl.line_index] ?? origItems[0];
        if (!orig) throw new Error(`Invalid line_index ${fl.line_index} for proforma items`);
        return { ...(orig as object), qty: Number(fl.this_qty) } as unknown as typeof payload.items[number];
      });
      fulLines = lines;
    } else {
      // standalone fallback: fulLines from items length
      fulLines = null;
    }
    if (!payload.items || payload.items.length === 0) throw new Error("Proforma has no items to invoice");
  }

  // B4 + B2 + B1: SO-linked path must be serialized via lock, revalidate balance,
  // check stock inside lock, and verify no over-fulfillment after ledger insert.
  if (soId && fulLines) {
    const soForFulfill = await fetchSalesOrder(soId);
    validateSoStatusForConversion(soForFulfill, "tax_invoice");
    return withSoFulfillLock(soId, async () => {
      const freshSummary = await revalidateBalanceOrThrow(soId, fulLines!, soForFulfill);
      const stockLines = await stockLinesFromFulfillment(soForFulfill, fulLines!);
      if (stockLines.length > 0) {
        const shortfalls = await findShortfalls(stockLines);
        if (shortfalls.length > 0) throw new Error(blockMessage(shortfalls[0]));
      }
      let inv: { id: string; invoice_no: string | null } | null = null;
      let ledgerId: string | null = null;
      try {
        inv = await insertInvoiceFromPayload(payload, { branchId: payload.branch_id, customerId: payload.customer_id });
        const { error: linkErr } = await supabase.from("invoices" as never).update({ linked_proforma_id: proformaId } as never).eq("id", inv.id);
        if (linkErr) {
          await handleWriterError(linkErr, null, inv.id, "invoices").catch(() => { throw linkErr; });
          throw linkErr;
        }
        const { prior, thisFulfilled, balanceAfter } = buildPriorThisBalance(soForFulfill, freshSummary, fulLines!);
        const res = await insertLedgerAndFulfillments({
          sales_order_id: soId,
          conversion_type: "tax_invoice",
          target_table: "invoices",
          target_id: inv.id,
          target_no: inv.invoice_no,
          prior,
          thisFulfilled,
          balanceAfter,
          lines: fulLines!,
          status: "draft",
        });
        ledgerId = res.ledgerId;
        await verifyNoOverFulfillment({ soId, so: soForFulfill, lines: fulLines!, targetTable: "invoices", targetId: inv.id, ledgerId });
        const { error: convErr } = await supabase.from("invoices" as never).update({ conversion_id: ledgerId } as never).eq("id", inv.id);
        if (convErr) {
          await handleWriterError(convErr, ledgerId, inv.id, "invoices").catch(() => { throw convErr; });
          throw convErr;
        }
        return inv;
      } catch (e) {
        await handleWriterError(e, ledgerId, inv?.id ?? null, "invoices").catch(() => { throw e; });
        throw e;
      }
    });
  }

  // SO-less or standalone proforma (no ledger/fulfillment needed)
  let inv: { id: string; invoice_no: string | null } | null = null;
  try {
    inv = await insertInvoiceFromPayload(payload, { branchId: payload.branch_id, customerId: payload.customer_id });

    const { error: linkErr } = await supabase.from("invoices" as never).update({ linked_proforma_id: proformaId } as never).eq("id", inv.id);
    if (linkErr) {
      await handleWriterError(linkErr, null, inv.id, "invoices").catch(() => { throw linkErr; });
      throw linkErr;
    }

    return inv;
  } catch (e) {
    await handleWriterError(e, null, inv?.id ?? null, "invoices").catch(() => { throw e; });
    throw e;
  }
}
