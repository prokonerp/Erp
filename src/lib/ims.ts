import { supabase } from "@/integrations/supabase/client";

export type StockType = "good" | "defective";
export type StockStatus =
  | "available"
  | "reserved"
  | "issued"
  | "in_transit"
  | "returned_to_oem"
  | "scrapped";

export type TxnType =
  | "good_in"
  | "good_out"
  | "defective_in"
  | "defective_out"
  | "transfer_out"
  | "transfer_in"
  | "oem_return"
  | "oem_replacement_receipt"
  | "stock_adjustment"
  | "scrap_adjustment";

export type TransferStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "in_transit"
  | "received"
  | "completed";

export type ReservationStatus = "reserved" | "issued" | "released";

export type StockItem = {
  id: string;
  oem: string | null;
  category: string | null;
  part_name: string;
  part_model_no: string | null;
  part_serial_no: string | null;
  warehouse_id: string | null;
  warehouse_type: string | null;
  stock_type: StockType;
  stock_status: StockStatus;
  ticket_id: string | null;
  indent_id: string | null;
  oem_case_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  transaction_ref: string | null;
  notes: string | null;
  created_by: string | null;
  modified_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Transaction = {
  id: string;
  txn_no: string | null;
  txn_date: string;
  txn_type: TxnType;
  stock_item_id: string | null;
  part_name: string | null;
  part_model_no: string | null;
  part_serial_no: string | null;
  oem: string | null;
  from_warehouse_id: string | null;
  to_warehouse_id: string | null;
  from_party: string | null;
  to_party: string | null;
  qty: number;
  ticket_id: string | null;
  indent_id: string | null;
  transfer_id: string | null;
  reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  oem_case_id: string | null;
};

export type Transfer = {
  id: string;
  transfer_no: string | null;
  request_date: string;
  source_warehouse_id: string | null;
  destination_warehouse_id: string | null;
  oem: string | null;
  part_name: string | null;
  part_model_no: string | null;
  part_serial_no: string | null;
  stock_item_id: string | null;
  stock_type: StockType;
  qty: number;
  reason: string | null;
  remarks: string | null;
  status: TransferStatus;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  received_by: string | null;
  received_at: string | null;
  receipt_remarks: string | null;
  created_at: string;
  updated_at: string;
};

export type Reservation = {
  id: string;
  stock_item_id: string;
  ticket_id: string | null;
  indent_id: string | null;
  customer_id: string | null;
  status: ReservationStatus;
  reserved_by: string | null;
  reserved_at: string;
  released_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AuditEntry = {
  id: string;
  entity: string;
  entity_id: string | null;
  action: string;
  old_value: unknown;
  new_value: unknown;
  user_id: string | null;
  created_at: string;
};

const sb = supabase as unknown as {
  from: (t: string) => any;
};

export const STOCK_TYPE_LABEL: Record<StockType, string> = {
  good: "Good",
  defective: "Defective",
};

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  available: "Available",
  reserved: "Reserved",
  issued: "Issued",
  in_transit: "In Transit",
  returned_to_oem: "Returned to OEM",
  scrapped: "Scrapped",
};

export const TXN_TYPE_LABEL: Record<TxnType, string> = {
  good_in: "Good Stock In",
  good_out: "Good Stock Out",
  defective_in: "Defective Stock In",
  defective_out: "Defective Stock Out",
  transfer_out: "Transfer Out",
  transfer_in: "Transfer In",
  oem_return: "OEM Return",
  oem_replacement_receipt: "OEM Replacement Receipt",
  stock_adjustment: "Stock Adjustment",
  scrap_adjustment: "Scrap Adjustment",
};

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  in_transit: "In Transit",
  received: "Received",
  completed: "Completed",
};

export async function listStock(): Promise<StockItem[]> {
  const { data, error } = await sb.from("ims_stock_items").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as StockItem[];
}

export async function getStock(id: string): Promise<StockItem | null> {
  const { data, error } = await sb.from("ims_stock_items").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data || null) as StockItem | null;
}

export async function createStock(input: Partial<StockItem>): Promise<StockItem> {
  const { data, error } = await sb.from("ims_stock_items").insert(input).select("*").single();
  if (error) throw error;
  return data as StockItem;
}

export async function updateStock(id: string, patch: Partial<StockItem>): Promise<void> {
  const { error } = await sb.from("ims_stock_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function listTransactions(): Promise<Transaction[]> {
  const { data, error } = await sb.from("ims_transactions").select("*").order("txn_date", { ascending: false }).limit(500);
  if (error) throw error;
  return (data || []) as Transaction[];
}

export async function createTransaction(input: Partial<Transaction>): Promise<Transaction> {
  const { data, error } = await sb.from("ims_transactions").insert(input).select("*").single();
  if (error) throw error;
  return data as Transaction;
}

export async function getStockHistory(stockId: string): Promise<Transaction[]> {
  const { data, error } = await sb.from("ims_transactions").select("*").eq("stock_item_id", stockId).order("txn_date", { ascending: true });
  if (error) throw error;
  return (data || []) as Transaction[];
}

export async function listTransfers(): Promise<Transfer[]> {
  const { data, error } = await sb.from("ims_transfers").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as Transfer[];
}

export async function getTransfer(id: string): Promise<Transfer | null> {
  const { data, error } = await sb.from("ims_transfers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data || null) as Transfer | null;
}

export async function createTransfer(input: Partial<Transfer>): Promise<Transfer> {
  const { data, error } = await sb.from("ims_transfers").insert(input).select("*").single();
  if (error) throw error;
  return data as Transfer;
}

export async function updateTransfer(id: string, patch: Partial<Transfer>): Promise<void> {
  const { error } = await sb.from("ims_transfers").update(patch).eq("id", id);
  if (error) throw error;
}

export async function listReservations(): Promise<Reservation[]> {
  const { data, error } = await sb.from("ims_reservations").select("*").order("reserved_at", { ascending: false });
  if (error) throw error;
  return (data || []) as Reservation[];
}

export async function createReservation(input: Partial<Reservation>): Promise<Reservation> {
  const { data, error } = await sb.from("ims_reservations").insert(input).select("*").single();
  if (error) throw error;
  return data as Reservation;
}

export async function updateReservation(id: string, patch: Partial<Reservation>): Promise<void> {
  const { error } = await sb.from("ims_reservations").update(patch).eq("id", id);
  if (error) throw error;
}

export async function listAudit(limit = 500): Promise<AuditEntry[]> {
  const { data, error } = await sb.from("ims_audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []) as AuditEntry[];
}

export type WarehouseLite = { id: string; code: string | null; name: string; type: string | null };
export async function listWarehouses(): Promise<WarehouseLite[]> {
  const { data, error } = await sb.from("warehouses").select("id,code,name,type").order("name");
  if (error) throw error;
  return (data || []) as WarehouseLite[];
}

/** Friendly display: "Delhi Warehouse (Godown)" */
export function formatWarehouse(wh: WarehouseLite | null | undefined): string {
  if (!wh) return "—";
  return wh.type ? `${wh.name} (${wh.type})` : wh.name;
}

export function warehouseLookup(warehouses: WarehouseLite[]) {
  const map = new Map(warehouses.map((w) => [w.id, w]));
  return (id: string | null | undefined) => formatWarehouse(id ? map.get(id) : null);
}

/** Transactions filtered to those originating from an indent (or matching free-text). */
export async function listIndentTransactions(): Promise<Transaction[]> {
  const { data, error } = await sb
    .from("ims_transactions")
    .select("*")
    .or("indent_id.not.is.null,oem_case_id.not.is.null")
    .order("txn_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data || []) as Transaction[];
}

/** Look up an AVAILABLE inventory stock item by serial (optionally scoped to a model). */
export async function findAvailableStockBySerial(
  serial: string,
  partModelNo?: string | null,
): Promise<StockItem | null> {
  let q = sb.from("ims_stock_items").select("*").eq("part_serial_no", serial).eq("stock_status", "available");
  if (partModelNo) q = q.eq("part_model_no", partModelNo);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data || null) as StockItem | null;
}

/**
 * Issue a stock item to a ticket: marks the item `issued` and writes a
 * `good_out` (or `defective_out`) transaction with full traceability.
 */
export async function issueStockToTicket(input: {
  stockItemId: string;
  ticketId: string;
  ticketNo?: string | null;
  caseId?: string | null;
  engineer?: string | null;
  customerName?: string | null;
  partModelNo?: string | null;
  partSerialNo?: string | null;
  partName?: string | null;
  oem?: string | null;
  qty?: number;
}): Promise<void> {
  const { data: stock } = await sb.from("ims_stock_items").select("*").eq("id", input.stockItemId).maybeSingle();
  const txnType = (stock?.stock_type === "defective") ? "defective_out" : "good_out";
  const refParts = [
    input.ticketNo ? `Ticket ${input.ticketNo}` : null,
    input.caseId ? `Case ${input.caseId}` : null,
    input.engineer ? `Engineer ${input.engineer}` : null,
  ].filter(Boolean).join(" · ");
  await sb.from("ims_transactions").insert({
    txn_type: txnType,
    stock_item_id: input.stockItemId,
    part_name: input.partName ?? stock?.part_name ?? null,
    part_model_no: input.partModelNo ?? stock?.part_model_no ?? null,
    part_serial_no: input.partSerialNo ?? stock?.part_serial_no ?? null,
    oem: input.oem ?? stock?.oem ?? null,
    from_warehouse_id: stock?.warehouse_id ?? null,
    to_warehouse_id: null,
    from_party: null,
    to_party: input.customerName || "Customer (Ticket)",
    qty: input.qty ?? 1,
    ticket_id: input.ticketId,
    reference: refParts || (input.ticketNo || input.caseId || null),
    notes: "Auto-issued from Ticket → Parts Used confirmation",
  });
  await sb.from("ims_stock_items").update({
    stock_status: "issued",
    ticket_id: input.ticketId,
    customer_name: input.customerName ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", input.stockItemId);
}