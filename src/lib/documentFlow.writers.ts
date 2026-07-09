// Supabase writers that turn one document into the next.
// They wrap documentFlow.ts (pure mapping) with the DB reads/writes needed to
// hydrate branch/customer snapshots, compute GST totals, and persist rows +
// child items. Kept out of documentFlow.ts so the pure module stays testable.

import { supabase } from "@/integrations/supabase/client";
import { computeTotals, stateCodeFromGSTIN, stateNameFromCode, amountInWords } from "@/lib/gst";
import { fetchBranches, itemDraftFromBreakup, type ItemDraft } from "@/lib/sales";
import type { Quotation, Customer } from "@/lib/crm";
import type { SalesOrder } from "@/lib/salesOrders";
import {
  quoteToSalesOrder,
  salesOrderToDeliveryChallan,
  salesOrderToInvoice,
  deliveryChallanToInvoice,
  type NewInvoicePayload,
} from "@/lib/documentFlow";
import type { DeliveryChallan } from "@/lib/challan";

async function fetchCustomer(id: string | null): Promise<Customer | null> {
  if (!id) return null;
  const { data } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  return (data as unknown as Customer) || null;
}

async function hydrateParties(so: {
  branch_id: string | null;
  customer_id: string | null;
}) {
  const [branches, customer] = await Promise.all([fetchBranches(), fetchCustomer(so.customer_id)]);
  const branch = branches.find((b) => b.id === so.branch_id) || branches.find((b) => b.is_default) || branches[0];
  return { branch, customer };
}

/** Idempotent: reuses the linked SO if the quote already has one. */
export async function createSalesOrderFromQuote(quote: Quotation): Promise<{ id: string; so_no: string | null }> {
  const linkedId = (quote as unknown as { converted_to_so_id?: string | null }).converted_to_so_id;
  if (linkedId) {
    const { data } = await supabase.from("sales_orders" as never).select("id, so_no").eq("id", linkedId).maybeSingle();
    if (data) return data as { id: string; so_no: string | null };
  }

  const payload = quoteToSalesOrder(quote);
  const { customer, branch } = await hydrateParties({ branch_id: payload.branch_id, customer_id: payload.customer_id });

  const sellerCode = branch?.state_code || stateCodeFromGSTIN(branch?.gstin) || null;
  const buyerCode = (customer as unknown as { state_code?: string })?.state_code || stateCodeFromGSTIN(customer?.gst || null);

  const totals = computeTotals({
    sellerStateCode: sellerCode,
    buyerStateCode: buyerCode,
    items: (payload.items || []).map((i) => ({ qty: i.qty, rate: i.rate, discount_pct: i.discount_pct, gst_rate: i.gst_rate })),
    roundOff: true,
  });

  const itemsWithBreakup = payload.items.map((it, i) => {
    const b = totals.items[i];
    return { ...it, taxable_value: b.taxable_value, cgst: b.cgst, sgst: b.sgst, igst: b.igst, cess: b.cess, line_total: b.line_total };
  });

  const insert = {
    ...payload,
    branch_id: branch?.id ?? payload.branch_id,
    seller_name: branch?.name ?? null,
    seller_gstin: branch?.gstin ?? null,
    seller_state: branch?.state_name ?? stateNameFromCode(sellerCode) ?? null,
    seller_state_code: sellerCode,
    seller_address: branch?.address ?? null,
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
    round_off: totals.round_off,
    total: totals.total,
    total_in_words: amountInWords(totals.total),
    items: itemsWithBreakup,
  };

  const { data, error } = await supabase.from("sales_orders" as never).insert(insert as never).select("id, so_no").single();
  if (error) throw error;
  const created = data as { id: string; so_no: string | null };

  await supabase.from("quotations").update({ converted_to_so_id: created.id, status: "accepted" } as never).eq("id", quote.id);
  return created;
}

export async function createChallanFromSalesOrder(so: SalesOrder): Promise<{ id: string; challan_no: string | null }> {
  const payload = salesOrderToDeliveryChallan(so);
  const { data, error } = await supabase.from("delivery_challans" as never).insert(payload as never).select("id, challan_no").single();
  if (error) throw error;
  await supabase.from("sales_orders" as never).update({ status: so.status === "invoiced" ? so.status : "partial" } as never).eq("id", so.id);
  return data as { id: string; challan_no: string | null };
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

  const sellerCode = branch.state_code || stateCodeFromGSTIN(branch.gstin) || null;
  const buyerCode = (customer as unknown as { state_code?: string }).state_code || stateCodeFromGSTIN(customer.gst || null);

  const drafts: ItemDraft[] = (payload.items || []).map((it) => ({
    product_id: it.product_id,
    description: it.description,
    hsn: it.hsn || "",
    qty: Number(it.qty) || 0,
    unit: it.unit || "Nos",
    rate: Number(it.rate) || 0,
    discount_pct: Number(it.discount_pct) || 0,
    gst_rate: Number(it.gst_rate) || 0,
    warehouse_id: null,
    serial_numbers: [],
    is_serialized: false,
    part_model_no: null,
    part_name: null,
  }));

  const totals = computeTotals({
    sellerStateCode: sellerCode,
    buyerStateCode: buyerCode,
    items: drafts.map((i) => ({ qty: i.qty, rate: i.rate, discount_pct: i.discount_pct, gst_rate: i.gst_rate })),
    roundOff: true,
  });

  const insertPayload = {
    invoice_date: payload.invoice_date,
    branch_id: branch.id,
    customer_id: customer.id,
    po_number: payload.po_number,
    po_date: payload.po_date,
    seller_name: branch.name,
    seller_gstin: branch.gstin,
    seller_state: branch.state_name,
    seller_state_code: sellerCode,
    seller_address: branch.address,
    buyer_name: customer.company,
    buyer_gstin: customer.gst,
    buyer_state: customer.state ?? stateNameFromCode(buyerCode),
    buyer_state_code: buyerCode,
    billing_address: payload.billing_address ?? customer.billing_address,
    shipping_address: payload.shipping_address ?? customer.shipping_address ?? customer.billing_address,
    place_of_supply: payload.place_of_supply ?? customer.state,
    place_of_supply_code: buyerCode,
    is_interstate: totals.is_interstate,
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

  const { data: inv, error } = await supabase.from("invoices").insert(insertPayload as never).select("id, invoice_no").single();
  if (error) throw error;

  const rows = drafts.map((d, i) => {
    const b = totals.items[i];
    const r = itemDraftFromBreakup(d, b);
    return { ...r, invoice_id: (inv as { id: string }).id, sr_no: i + 1 };
  });
  const { error: e2 } = await supabase.from("invoice_items").insert(rows as never);
  if (e2) throw e2;

  return inv as { id: string; invoice_no: string | null };
}

export async function createInvoiceFromSalesOrder(so: SalesOrder) {
  const payload = salesOrderToInvoice(so);
  const inv = await insertInvoiceFromPayload(payload, { branchId: so.branch_id, customerId: so.customer_id });
  await supabase.from("sales_orders" as never).update({ status: "invoiced" } as never).eq("id", so.id);
  return inv;
}

export async function createInvoiceFromChallan(dc: DeliveryChallan, linked: { sales_order_id?: string | null; linked_quote_id?: string | null; branch_id?: string | null; customer_id?: string | null } = {}) {
  const payload = deliveryChallanToInvoice(dc, linked);
  return insertInvoiceFromPayload(payload, { branchId: linked.branch_id ?? null, customerId: linked.customer_id ?? null });
}