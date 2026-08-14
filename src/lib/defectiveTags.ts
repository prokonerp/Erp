import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { listWarehouses, type WarehouseLite } from "@/lib/ims";

const sb = supabase as any;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DefectiveTag = {
  id: string;
  tag_no: string | null;
  tag_date: string;
  txn_id: string;
  txn_no: string | null;
  txn_date: string | null;
  service_request_no: string | null;
  oracle_order_no: string | null;
  model_no: string | null;
  serial_no: string | null;
  customer_name: string | null;
  asp_code: string | null;
  engineer_name: string | null;
  replacement_date: string | null;
  replacement_count: number;
  reason: string | null;
  warehouse_id: string | null;
  status: string;
  printed_at: string | null;
  printed_by: string | null;
  print_count: number;
  created_by_name: string | null;
  created_at: string;
};

/** A Defective Stock IN transaction enriched with related ERP details. */
export type DefectiveInRecord = {
  /** Stable row key: transaction id, or `stock:<stock item id>` for stock-item sourced rows. */
  key: string;
  source: "txn" | "stock";
  txn_id: string | null;
  stock_item_id: string | null;
  txn_no: string | null;
  txn_date: string;
  service_request_no: string | null;
  oracle_order_no: string | null;
  model_no: string | null;
  part_name: string | null;
  serial_no: string | null;
  customer_name: string | null;
  asp_code: string | null;
  warehouse_id: string | null;
  engineer_name: string | null;
  replacement_date: string | null;
  reason: string | null;
  tag_generated: boolean;
  tag_no: string | null;
  /** Underlying stock item already dispatched back to the OEM. */
  sent_to_oem: boolean;
};

export function fmtDate(d?: string | null) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * All Defective Stock IN records from IMS (`ims_transactions.txn_type = 'defective_in'`),
 * joined live with Ticket (service request), Warehouse (ASP code) and existing tags.
 */
export async function listDefectiveInRecords(): Promise<DefectiveInRecord[]> {
  const [txns, tags, warehouses] = await Promise.all([
    fetchAll<any>("ims_transactions", (q) =>
      q.select("*").eq("txn_type", "defective_in").order("txn_date", { ascending: false }),
    ),
    fetchAll<any>("defective_tags", (q) => q.select("txn_id,stock_item_id,tag_no")),
    listWarehouses(),
  ]);

  const ticketIds = Array.from(
    new Set(txns.map((t) => t.ticket_id).filter((id: string | null) => !!id && UUID_RE.test(id))),
  ) as string[];
  let tickets: any[] = [];
  if (ticketIds.length) {
    const { data } = await sb
      .from("tickets")
      .select("id,case_id,customer_name,assigned_engineer_name,complaint")
      .in("id", ticketIds);
    tickets = data || [];
  }
  const tById = new Map(tickets.map((t) => [t.id, t]));
  const whById = new Map<string, WarehouseLite>(warehouses.map((w) => [w.id, w]));
  const tagByTxn = new Map(tags.filter((t) => t.txn_id).map((t) => [t.txn_id, t.tag_no as string | null]));
  const tagByStockItem = new Map(
    tags.filter((t) => t.stock_item_id).map((t) => [t.stock_item_id, t.tag_no as string | null]),
  );

  // Include anything flagged defective by TYPE or by STATUS.
  const allStock = await fetchAll<any>("ims_stock_items", (q) =>
    q.select("*").order("created_at", { ascending: false }),
  );
  const statusKey = (serial?: string | null, model?: string | null) =>
    `${(serial || "").toLowerCase()}|${(model || "").toLowerCase()}`;
  const sentToOemKeys = new Set(
    allStock
      .filter((s) => String(s.stock_status || "").toLowerCase() === "returned_to_oem")
      .map((s) => statusKey(s.part_serial_no, s.part_model_no))
      .filter((k: string) => k !== "|"),
  );

  const fromTxns = txns.map((t) => {
    const tk = t.ticket_id ? tById.get(t.ticket_id) : null;
    const wh = whById.get(t.to_warehouse_id || t.from_warehouse_id || "");
    return {
      key: t.id,
      source: "txn" as const,
      txn_id: t.id,
      stock_item_id: null,
      txn_no: t.txn_no,
      txn_date: t.txn_date,
      service_request_no: tk?.case_id || (t.ticket_id && !UUID_RE.test(t.ticket_id) ? t.ticket_id : null) || t.reference || null,
      oracle_order_no: t.oem_case_id || null,
      model_no: t.part_model_no || null,
      part_name: t.part_name || null,
      serial_no: t.part_serial_no || null,
      customer_name: t.from_party || tk?.customer_name || null,
      asp_code: wh?.asp_code || null,
      warehouse_id: wh?.id || null,
      engineer_name: tk?.assigned_engineer_name || null,
      replacement_date: t.txn_date,
      reason: t.notes || tk?.complaint || null,
      tag_generated: tagByTxn.has(t.id),
      tag_no: tagByTxn.get(t.id) ?? null,
      sent_to_oem: sentToOemKeys.has(statusKey(t.part_serial_no, t.part_model_no)),
    };
  });

  // Defective stock can also exist as stock items without a matching `defective_in`
  // transaction (opening stock, GRN-classified defectives, manual entries). Include
  // those so they can be tagged too, skipping any already covered by a transaction.
  const coveredSerials = new Set(
    fromTxns.map((r) => `${(r.serial_no || "").toLowerCase()}|${(r.model_no || "").toLowerCase()}`).filter((k) => k !== "|"),
  );
  const stockItems = allStock.filter(
    (s) =>
      String(s.stock_type || "").toLowerCase() === "defective" ||
      String(s.stock_status || "").toLowerCase().includes("defect"),
  );
  const fromStock = stockItems
    .filter(
      (s) =>
        !coveredSerials.has(`${(s.part_serial_no || "").toLowerCase()}|${(s.part_model_no || "").toLowerCase()}`),
    )
    .map((s) => {
      const wh = whById.get(s.warehouse_id || "");
      return {
        key: `stock:${s.id}`,
        source: "stock" as const,
        txn_id: null,
        stock_item_id: s.id as string,
        txn_no: s.transaction_ref || null,
        txn_date: s.created_at,
        service_request_no: s.ticket_id && !UUID_RE.test(s.ticket_id) ? s.ticket_id : null,
        oracle_order_no: s.oem_case_id || null,
        model_no: s.part_model_no || null,
        part_name: s.part_name || null,
        serial_no: s.part_serial_no || null,
        customer_name: s.customer_name || null,
        asp_code: wh?.asp_code || null,
        warehouse_id: wh?.id || null,
        engineer_name: null,
        replacement_date: s.created_at,
        reason: s.notes || null,
        tag_generated: tagByStockItem.has(s.id),
        tag_no: tagByStockItem.get(s.id) ?? null,
        sent_to_oem: String(s.stock_status || "").toLowerCase() === "returned_to_oem",
      } as DefectiveInRecord;
    });

  return [...fromTxns, ...fromStock];
}

export async function listDefectiveTags(): Promise<DefectiveTag[]> {
  return fetchAll<DefectiveTag>("defective_tags", (q) =>
    q.select("*").order("created_at", { ascending: false }),
  );
}

/** One selected Defective Stock IN record = one Defective Tag. Duplicates are rejected by the DB. */
export async function generateTags(records: DefectiveInRecord[], createdByName?: string | null) {
  const rows = records
    .filter((r) => !r.tag_generated)
    .map((r) => ({
      txn_id: r.txn_id,
      stock_item_id: r.stock_item_id,
      txn_no: r.txn_no,
      txn_date: r.txn_date,
      service_request_no: r.service_request_no,
      oracle_order_no: r.oracle_order_no,
      model_no: r.model_no || r.part_name,
      serial_no: r.serial_no,
      customer_name: r.customer_name,
      asp_code: r.asp_code,
      engineer_name: r.engineer_name,
      replacement_date: r.replacement_date,
      reason: r.reason,
      warehouse_id: r.warehouse_id,
      created_by_name: createdByName || null,
    }));
  if (!rows.length) return [] as DefectiveTag[];
  const { data, error } = await sb.from("defective_tags").insert(rows).select("*");
  if (error) throw error;
  return (data || []) as DefectiveTag[];
}

export async function markTagsPrinted(ids: string[], byName?: string | null) {
  if (!ids.length) return;
  const { data } = await sb.from("defective_tags").select("id,print_count").in("id", ids);
  const counts = new Map<string, number>((data || []).map((r: any) => [r.id as string, (r.print_count as number) || 0]));
  await Promise.all(
    ids.map((id) =>
      sb
        .from("defective_tags")
        .update({
          printed_at: new Date().toISOString(),
          printed_by: byName || null,
          print_count: (counts.get(id) || 0) + 1,
        })
        .eq("id", id),
    ),
  );
}