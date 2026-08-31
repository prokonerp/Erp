import { supabase } from "@/integrations/supabase/client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { imsKeys, stockKeys, txnKeys } from "@/lib/queryKeys";

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
  | "completed"
  | "cancelled";

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
  qty: number;
  opening_stock: boolean;
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
  cancelled_reason: string | null;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  cancelled: "Cancelled",
};

/**
 * @deprecated for lists — use useStockPaginated / fetchStockPage with server pagination.
 * Kept only for exports / legacy callers that need the full dataset. Do not use for UI lists.
 */
export async function listStock(): Promise<StockItem[]> {
  const { fetchAll } = await import("@/lib/fetchAll");
  return fetchAll<StockItem>("ims_stock_items", (q) =>
    q.select("*").order("created_at", { ascending: false }),
  );
}

// ── Paginated (server-side) ───────────────────────────────────────────────

export type StockPaginatedParams = {
  page: number;
  pageSize: number;
  warehouseId?: string | null;
  search?: string | null;
  stockType?: StockType | null;
  stockStatus?: StockStatus | null;
};

export const STOCK_SELECT =
  "id,oem,category,part_name,part_model_no,part_serial_no,warehouse_id,stock_type,stock_status,ticket_id,indent_id,oem_case_id,customer_name,transaction_ref,notes,qty,opening_stock,created_at,updated_at";

export const STOCK_SELECT_AGG = STOCK_SELECT;

/**
 * Server-paginated fetch for stock items. Uses `count: exact` + `.range()` so
 * the list never needs to pull the whole table.
 */
export async function fetchStockPage(
  params: StockPaginatedParams,
): Promise<{ data: StockItem[]; count: number }> {
  const { page, pageSize, warehouseId, search, stockType, stockStatus } = params;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from("ims_stock_items" as never)
    .select(STOCK_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  if (stockType) q = q.eq("stock_type", stockType);
  if (stockStatus) q = q.eq("stock_status", stockStatus);
  if (search && search.trim()) {
    const s = search.trim().replace(/%/g, "");
    // Server-side ilike across the most-searched columns; avoid pulling full table.
    q = q.or(`part_name.ilike.%${s}%,part_model_no.ilike.%${s}%,part_serial_no.ilike.%${s}%`);
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { data: (data || []) as StockItem[], count: count ?? 0 };
}

export function useStockPaginated(params: StockPaginatedParams) {
  return useQuery({
    queryKey: stockKeys.paginated(
      params as unknown as Record<string, unknown> & { page: number; pageSize: number },
    ),
    queryFn: () => fetchStockPage(params),
    placeholderData: keepPreviousData,
  });
}

/** Back-compat alias — some callers imported via imsKeys. */
export function useStockPaginatedWithImsKeys(params: StockPaginatedParams) {
  return useQuery({
    queryKey: imsKeys.paginated(
      params as unknown as Record<string, unknown> & { page: number; pageSize: number },
    ),
    queryFn: () => fetchStockPage(params),
    placeholderData: keepPreviousData,
  });
}

export async function getStock(id: string): Promise<StockItem | null> {
  const { data, error } = await sb.from("ims_stock_items").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data || null) as StockItem | null;
}

export async function createStock(input: Partial<StockItem>): Promise<StockItem> {
  // Resolve current user for created_by and transaction audit trail
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id ?? null;

  // 1. Insert stock item (with created_by)
  const { data, error } = await sb
    .from("ims_stock_items")
    .insert({ ...input, created_by: uid } as never)
    .select("*")
    .single();
  if (error) throw error;
  if (!data)
    throw new Error("Stock insert was blocked by permissions. Contact admin to grant IMS access.");

  // 2. Create a corresponding transaction so counts/timelines stay in sync
  const txnType: TxnType = input.stock_type === "defective" ? "defective_in" : "good_in";
  const qty = input.qty ?? 1;
  const { error: tErr } = await sb.from("ims_transactions").insert({
    txn_type: txnType,
    stock_item_id: data.id,
    part_name: input.part_name ?? null,
    part_model_no: input.part_model_no ?? null,
    part_serial_no: input.part_serial_no ?? null,
    oem: input.oem ?? null,
    to_warehouse_id: input.warehouse_id ?? null,
    from_party: "Manual Entry",
    qty,
    reference: "Manual Stock Entry",
    notes: input.notes ?? null,
    created_by: uid,
  } as never);
  if (tErr) throw tErr;

  return data as StockItem;
}

export async function updateStock(id: string, patch: Partial<StockItem>): Promise<void> {
  const { error } = await sb.from("ims_stock_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteStock(id: string): Promise<void> {
  const { error } = await sb.from("ims_stock_items").delete().eq("id", id);
  if (error) throw error;
}

/**
 * @deprecated for lists — use useTransactionsPaginated / fetchTransactionsPage with server pagination.
 * Kept only for exports / legacy callers that need the full dataset. Do not use for UI lists.
 */
export async function listTransactions(): Promise<Transaction[]> {
  const { fetchAll } = await import("@/lib/fetchAll");
  return fetchAll<Transaction>("ims_transactions", (q) =>
    q.select("*").order("txn_date", { ascending: false }),
  );
}

// ── Paginated transactions ────────────────────────────────────────────────

export type TransactionsPaginatedParams = {
  page: number;
  pageSize: number;
  search?: string | null;
  txnType?: TxnType | null;
};

export const TXN_SELECT =
  "id,txn_no,txn_date,txn_type,stock_item_id,part_name,part_model_no,part_serial_no,oem,from_warehouse_id,to_warehouse_id,from_party,to_party,qty,ticket_id,indent_id,oem_case_id,transfer_id,reference,notes,created_at";

export async function fetchTransactionsPage(
  params: TransactionsPaginatedParams,
): Promise<{ data: Transaction[]; count: number }> {
  const { page, pageSize, search, txnType } = params;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from("ims_transactions" as never)
    .select(TXN_SELECT, { count: "exact" })
    .order("txn_date", { ascending: false })
    .range(from, to);

  if (txnType) q = q.eq("txn_type", txnType);
  if (search && search.trim()) {
    const s = search.trim().replace(/%/g, "");
    q = q.or(
      `part_name.ilike.%${s}%,part_model_no.ilike.%${s}%,part_serial_no.ilike.%${s}%,txn_no.ilike.%${s}%`,
    );
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { data: (data || []) as Transaction[], count: count ?? 0 };
}

export function useTransactionsPaginated(params: TransactionsPaginatedParams) {
  return useQuery({
    queryKey: txnKeys.paginated(
      params as unknown as Record<string, unknown> & { page: number; pageSize: number },
    ),
    queryFn: () => fetchTransactionsPage(params),
    placeholderData: keepPreviousData,
  });
}

export async function createTransaction(input: Partial<Transaction>): Promise<Transaction> {
  const { data, error } = await sb.from("ims_transactions").insert(input).select("*").single();
  if (error) throw error;
  return data as Transaction;
}

export async function updateTransaction(id: string, patch: Partial<Transaction>): Promise<void> {
  const { error } = await sb.from("ims_transactions").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await sb.from("ims_transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function getStockHistory(stockId: string): Promise<Transaction[]> {
  const { data, error } = await sb
    .from("ims_transactions")
    .select("*")
    .eq("stock_item_id", stockId)
    .order("txn_date", { ascending: true });
  if (error) throw error;
  return (data || []) as Transaction[];
}

export async function listTransfers(): Promise<Transfer[]> {
  const { data, error } = await sb
    .from("ims_transfers")
    .select("*")
    .order("created_at", { ascending: false });
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

/**
 * Update a transfer with an optimistic-lock guard (B-20): when
 * `expectedStatus` is given, the write only lands if the row still has that
 * status — two admins double-approving (or one acting on a stale screen)
 * can no longer both transition the same transfer.
 */
export async function updateTransfer(
  id: string,
  patch: Partial<Transfer>,
  expectedStatus?: Transfer["status"] | null,
): Promise<void> {
  let q = sb.from("ims_transfers").update(patch).eq("id", id);
  if (expectedStatus) q = q.eq("status", expectedStatus);
  const { data, error } = await q.select("id");
  if (error) throw error;
  if (expectedStatus && (!data || data.length === 0)) {
    throw new Error(
      "This transfer was just updated by someone else — refresh to see its current status.",
    );
  }
}

export async function deleteTransfer(id: string): Promise<void> {
  const { error } = await sb.from("ims_transfers").delete().eq("id", id);
  if (error) throw error;
}

export async function listReservations(): Promise<Reservation[]> {
  const { data, error } = await sb
    .from("ims_reservations")
    .select("*")
    .order("reserved_at", { ascending: false });
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

export async function deleteReservation(id: string): Promise<void> {
  const { error } = await sb.from("ims_reservations").delete().eq("id", id);
  if (error) throw error;
}

export async function listAudit(limit = 500): Promise<AuditEntry[]> {
  const { data, error } = await sb
    .from("ims_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as AuditEntry[];
}

export type WarehouseLite = {
  id: string;
  code: string | null;
  name: string;
  type: string | null;
  asp_code: string | null;
  branch_id: string | null;
  branch?: { id: string; name: string; code: string | null } | null;
};

export type ProductLite = {
  id: string;
  name: string | null;
  model: string | null;
  sku: string | null;
  item_type: string;
  description: string | null;
  brand: string | null;
};

export async function listProducts(): Promise<ProductLite[]> {
  const { fetchAll } = await import("@/lib/fetchAll");
  return fetchAll<ProductLite>("products", (q) =>
    q.select("id,name,model,sku,item_type,description,brand").order("model"),
  );
}

export async function listWarehouses(): Promise<WarehouseLite[]> {
  const { data, error } = await sb
    .from("warehouses")
    .select("id,code,name,type,asp_code,branch_id,branch:branches(id,name,code)")
    .order("name");
  if (error) throw error;
  return (data || []) as unknown as WarehouseLite[];
}

/** Branch name for a warehouse, sourced live from Warehouse Master. */
export function warehouseBranchName(wh: WarehouseLite | null | undefined): string {
  return wh?.branch?.name || "—";
}

/** Friendly display: "Delhi Warehouse (Godown)" */
export function formatWarehouse(wh: WarehouseLite | null | undefined): string {
  if (!wh) return "—";
  const bits = [wh.type, wh.asp_code ? `ASP: ${wh.asp_code}` : null, wh.branch?.name].filter(
    Boolean,
  );
  return bits.length ? `${wh.name} (${bits.join(" • ")})` : wh.name;
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
  let q = sb
    .from("ims_stock_items")
    .select("*")
    .eq("part_serial_no", serial)
    .eq("stock_status", "available");
  if (partModelNo) q = q.eq("part_model_no", partModelNo);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data || null) as StockItem | null;
}

/**
 * Issue a stock item to a ticket: marks the item `issued` and writes a
 * `good_out` (or `defective_out`) transaction with full traceability.
 *
 * B-07 hardening:
 *  - The stock row is claimed FIRST with a conditional update that refuses
 *    items already marked `issued` — issuing the same serial to two tickets
 *    can no longer succeed twice.
 *  - If the traceability transaction fails afterwards, the claim is rolled
 *    back so stock isn't marked issued without its audit trail.
 *  - Every write result is checked; nothing is silently ignored.
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
  const { data: stock, error: loadErr } = await sb
    .from("ims_stock_items")
    .select("*")
    .eq("id", input.stockItemId)
    .maybeSingle();
  if (loadErr) throw loadErr;
  if (!stock) throw new Error("Stock item not found — it may have been deleted.");
  if (stock.stock_status === "issued") {
    throw new Error(
      `Serial ${input.partSerialNo || stock.part_serial_no || ""} is already issued${stock.ticket_id ? ` (ticket ${stock.ticket_id})` : ""} and cannot be issued again.`,
    );
  }

  const txnType = stock.stock_type === "defective" ? "defective_out" : "good_out";
  const refParts = [
    input.ticketNo ? `Ticket ${input.ticketNo}` : null,
    input.caseId ? `Case ${input.caseId}` : null,
    input.engineer ? `Engineer ${input.engineer}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Claim first: conditional update loses the race if another user just
  // issued this serial (affected-rows check below).
  const { data: claimedRows, error: claimErr } = await sb
    .from("ims_stock_items")
    .update({
      stock_status: "issued",
      ticket_id: input.ticketId,
      customer_name: input.customerName ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.stockItemId)
    .neq("stock_status", "issued")
    .select("id");
  if (claimErr) throw claimErr;
  if (!claimedRows || claimedRows.length === 0) {
    throw new Error(
      `Serial ${input.partSerialNo || stock.part_serial_no || ""} was just issued by someone else.`,
    );
  }

  const { error: txnError } = await sb.from("ims_transactions").insert({
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
    reference: refParts || input.ticketNo || input.caseId || null,
    notes: "Auto-issued from Ticket → Parts Used confirmation",
  });
  if (txnError) {
    // Roll back the claim — never mark stock issued without its audit trail.
    await sb
      .from("ims_stock_items")
      .update({
        stock_status: stock.stock_status,
        ticket_id: stock.ticket_id ?? null,
        customer_name: stock.customer_name ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.stockItemId);
    throw new Error(
      `Stock issue recorded failed, transaction log could not be written: ${txnError.message}`,
    );
  }
}
