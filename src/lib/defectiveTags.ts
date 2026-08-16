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
  oem_case_id: string | null;
  created_by_name: string | null;
  created_at: string;
};

/** A Defective Stock IN transaction enriched with related ERP details. */
export type DefectiveInRecord = {
  /** Stable row key: transaction id, or `stock:<stock item id>` for stock-item sourced rows. */
  key: string;
  source: "indent" | "txn" | "stock";
  txn_id: string | null;
  stock_item_id: string | null;
  txn_no: string | null;
  txn_date: string;
  service_request_no: string | null;
  oem_ref_id: string | null;
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
 * Defective parts, sourced primarily from Indents (`indents.oracles_data[].defective_rows`),
 * which is where the workflow actually captures accurate model/serial/Oracle/OEM Case data.
 * Defective stock that has no Indent yet still shows up via the IMS transaction/stock fallback.
 */
export async function listDefectiveInRecords(): Promise<DefectiveInRecord[]> {
  const [txns, tags, warehouses, indents] = await Promise.all([
    fetchAll<any>("ims_transactions", (q) =>
      q.select("*").eq("txn_type", "defective_in").order("txn_date", { ascending: false }),
    ),
    fetchAll<any>("defective_tags", (q) => q.select("txn_id,stock_item_id,tag_no,model_no,serial_no")),
    listWarehouses(),
    fetchAll<any>("indents", (q) =>
      q
        .select("id,indent_no,indent_date,ticket_id,case_id,oem_case_id,engineer_name,oracles_data,is_deleted")
        .order("indent_date", { ascending: false }),
    ),
  ]);

  const liveIndents = (indents || []).filter((i) => !i.is_deleted);

  const ticketIds = Array.from(
    new Set(
      [
        ...txns.map((t) => t.ticket_id),
        ...liveIndents.map((i) => i.ticket_id),
      ].filter((id: string | null) => !!id && UUID_RE.test(id)),
    ),
  ) as string[];
  let tickets: any[] = [];
  if (ticketIds.length) {
    const { data } = await sb
      .from("tickets")
      .select("id,case_id,customer_name,assigned_engineer_name,complaint,oem_ref_id,defective_parts_details")
      .in("id", ticketIds);
    tickets = data || [];
  }
  const tById = new Map(tickets.map((t) => [t.id, t]));

  // Batch: all indents for the involved tickets, so Oracle # can be resolved
  // from the Indent that already handled this defective part.
  const norm = (v: any) => String(v ?? "").trim().toLowerCase();
  const oracleByTicketPart = new Map<string, string>();
  if (ticketIds.length) {
    const { data: indents } = await sb
      .from("indents")
      .select("ticket_id,oracles_data")
      .in("ticket_id", ticketIds);
    for (const ind of indents || []) {
      for (const blk of (ind.oracles_data as any[]) || []) {
        const oracleNo = String(blk?.oracle_no || "").trim();
        if (!oracleNo) continue;
        for (const row of (blk?.defective_rows as any[]) || []) {
          const k = `${ind.ticket_id}|${norm(row?.def_model_no)}|${norm(row?.def_serial_no)}`;
          if (!oracleByTicketPart.has(k)) oracleByTicketPart.set(k, oracleNo);
        }
      }
    }
  }
  const whById = new Map<string, WarehouseLite>(warehouses.map((w) => [w.id, w]));
  const tagByTxn = new Map(tags.filter((t) => t.txn_id).map((t) => [t.txn_id, t.tag_no as string | null]));
  const tagByStockItem = new Map(
    tags.filter((t) => t.stock_item_id).map((t) => [t.stock_item_id, t.tag_no as string | null]),
  );
  // Global lookup by the physical unit (model + serial). A tag for a unit must be
  // found regardless of which txn / stock row surfaced the row in this listing.
  const tagByPart = new Map<string, string | null>();
  for (const t of tags) {
    const k = dispatchKey(t.model_no, t.serial_no);
    if (k === "|") continue;
    if (!tagByPart.has(k)) tagByPart.set(k, (t.tag_no as string | null) ?? null);
  }
  const tagFor = (model?: string | null, serial?: string | null) => {
    const k = dispatchKey(model, serial);
    return k === "|" ? undefined : tagByPart.get(k);
  };
  const hasTag = (model?: string | null, serial?: string | null) => tagFor(model, serial) !== undefined;

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

  // ── PRIMARY SOURCE: Indent → Oracle block → defective rows ──────────────────
  // Replacement Date comes from the linked customer Delivery Challan for the block.
  // Real Section B customer DCs often have indent_id = null, so match on the
  // item's own defective_serial / defective_model instead.
  const dcDateBySerial = new Map<string, string>();
  const dcDateByModel = new Map<string, string>();
  {
    const dcs = await fetchAll<any>("delivery_challans", (q) =>
      q.select("challan_date,items").eq("doc_type", "customer").order("challan_date", { ascending: false }),
    );
    for (const dc of dcs || []) {
      if (!dc.challan_date) continue;
      for (const it of (dc.items as any[]) || []) {
        const s = norm(it?.defective_serial);
        const m = norm(it?.defective_model);
        if (s && !dcDateBySerial.has(s)) dcDateBySerial.set(s, dc.challan_date);
        if (m && !dcDateByModel.has(m)) dcDateByModel.set(m, dc.challan_date);
      }
    }
  }
  const dcDateFor = (model?: string | null, serial?: string | null) =>
    (serial && dcDateBySerial.get(norm(serial))) || (!serial && model ? dcDateByModel.get(norm(model)) : null) || null;

  // Reuse existing txn linkage (and its tag) when the same physical part is
  // already present in IMS, so tags stay attached to one record.
  const txnByPart = new Map<string, any>();
  for (const t of txns) {
    const k = `${norm(t.part_model_no)}|${norm(t.part_serial_no)}`;
    if (k !== "|" && !txnByPart.has(k)) txnByPart.set(k, t);
  }

  const fromIndents: DefectiveInRecord[] = [];
  const indentCoveredTxnIds = new Set<string>();
  const indentCoveredParts = new Set<string>();
  for (const ind of liveIndents) {
    const tk = ind.ticket_id ? tById.get(ind.ticket_id) : null;
    for (const blk of (ind.oracles_data as any[]) || []) {
      const oracleNo = String(blk?.oracle_no || "").trim() || null;
      const wh = whById.get(
        ((blk?.received_rows as any[]) || []).map((r) => r?.warehouse_id).find((w) => w && UUID_RE.test(w)) || "",
      );
      const rows = (blk?.defective_rows as any[]) || [];
      rows.forEach((row, idx) => {
        const model = String(row?.def_model_no || "").trim() || null;
        const serial = String(row?.def_serial_no || "").trim() || null;
        if (!model && !serial) return;
        const partKey = `${norm(model)}|${norm(serial)}`;
        if (partKey !== "|" && indentCoveredParts.has(partKey)) return;
        if (partKey !== "|") indentCoveredParts.add(partKey);
        const txn = txnByPart.get(partKey);
        if (txn) indentCoveredTxnIds.add(txn.id);
        const remarks =
          ((tk?.defective_parts_details as any[]) || []).find(
            (p) =>
              (norm(p?.model_no) === norm(model) || norm(p?.name) === norm(model)) &&
              (!serial || norm(p?.serial) === norm(serial)),
          )?.remarks || null;
        fromIndents.push({
          key: txn ? txn.id : `indent:${ind.id}:${oracleNo || idx}:${idx}`,
          source: "indent",
          txn_id: txn?.id ?? null,
          stock_item_id: null,
          txn_no: txn?.txn_no ?? ind.indent_no ?? null,
          txn_date: txn?.txn_date || ind.indent_date || ind.created_at,
          service_request_no: tk?.case_id || ind.case_id || null,
          oem_ref_id: ind.oem_case_id || tk?.oem_ref_id || null,
          oracle_order_no: oracleNo,
          model_no: model,
          part_name: row?.part_name || null,
          serial_no: serial,
          customer_name: tk?.customer_name || null,
          asp_code: wh?.asp_code || null,
          warehouse_id: wh?.id || null,
          engineer_name: ind.engineer_name || tk?.assigned_engineer_name || null,
          replacement_date: dcDateFor(model, serial),
          reason: remarks || null,
          tag_generated: txn ? tagByTxn.has(txn.id) : false,
          tag_no: txn ? tagByTxn.get(txn.id) ?? null : null,
          sent_to_oem: sentToOemKeys.has(statusKey(serial, model)),
        });
      });
    }
  }

  // ── FALLBACK: defective IMS transactions with no Indent-sourced counterpart ──
  const fromTxns = txns
    .filter(
      (t) =>
        !indentCoveredTxnIds.has(t.id) &&
        !indentCoveredParts.has(`${norm(t.part_model_no)}|${norm(t.part_serial_no)}`),
    )
    .map((t) => {
    const tk = t.ticket_id ? tById.get(t.ticket_id) : null;
    const wh = whById.get(t.to_warehouse_id || t.from_warehouse_id || "");
    // Serial fallback: pull from the ticket's defective parts capture.
    let serialNo: string | null = t.part_serial_no || null;
    if (!serialNo && tk?.defective_parts_details) {
      const match = ((tk.defective_parts_details as any[]) || []).find(
        (p) => norm(p?.model_no) === norm(t.part_model_no) && p?.serial,
      );
      serialNo = match?.serial || null;
    }
    const oracleFromIndent = t.ticket_id
      ? oracleByTicketPart.get(`${t.ticket_id}|${norm(t.part_model_no)}|${norm(serialNo)}`) || null
      : null;
    return {
      key: t.id,
      source: "txn" as const,
      txn_id: t.id,
      stock_item_id: null,
      txn_no: t.txn_no,
      txn_date: t.txn_date,
      service_request_no: tk?.case_id || (t.ticket_id && !UUID_RE.test(t.ticket_id) ? t.ticket_id : null) || t.reference || null,
      oem_ref_id: tk?.oem_ref_id || null,
      oracle_order_no: oracleFromIndent || t.oem_case_id || null,
      model_no: t.part_model_no || null,
      part_name: t.part_name || null,
      serial_no: serialNo,
      customer_name: t.from_party || tk?.customer_name || null,
      asp_code: wh?.asp_code || null,
      warehouse_id: wh?.id || null,
      engineer_name: tk?.assigned_engineer_name || null,
      replacement_date: dcDateFor(t.part_model_no, serialNo) || t.txn_date,
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
    [...fromIndents, ...fromTxns]
      .map((r) => `${(r.serial_no || "").toLowerCase()}|${(r.model_no || "").toLowerCase()}`)
      .filter((k) => k !== "|"),
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
        oem_ref_id: null,
        oracle_order_no: s.oem_case_id || null,
        model_no: s.part_model_no || null,
        part_name: s.part_name || null,
        serial_no: s.part_serial_no || null,
        customer_name: s.customer_name || null,
        asp_code: wh?.asp_code || null,
        warehouse_id: wh?.id || null,
        engineer_name: null,
        replacement_date: dcDateFor(s.part_model_no, s.part_serial_no) || s.created_at,
        reason: s.notes || null,
        tag_generated: tagByStockItem.has(s.id),
        tag_no: tagByStockItem.get(s.id) ?? null,
        sent_to_oem: String(s.stock_status || "").toLowerCase() === "returned_to_oem",
      } as DefectiveInRecord;
    });

  return [...fromIndents, ...fromTxns, ...fromStock];
}

export async function listDefectiveTags(): Promise<DefectiveTag[]> {
  return fetchAll<DefectiveTag>("defective_tags", (q) =>
    q.select("*").order("created_at", { ascending: false }),
  );
}

export type TagDispatch = { dc_no: string; dc_date: string | null };

/** Key used to match a tag to its dispatched stock item: model|serial (lowercased). */
export function dispatchKey(model?: string | null, serial?: string | null) {
  return `${String(model ?? "").trim().toLowerCase()}|${String(serial ?? "").trim().toLowerCase()}`;
}

/**
 * Map of model|serial → the OEM DC that dispatched it, for stock already
 * returned to OEM. Two batched queries only.
 */
export async function fetchTagDispatches(): Promise<Map<string, TagDispatch>> {
  const stock = await fetchAll<any>("ims_stock_items", (q) =>
    q.select("part_model_no,part_serial_no,transaction_ref,updated_at").eq("stock_status", "returned_to_oem"),
  );
  const map = new Map<string, TagDispatch>();
  const challanNos = new Set<string>();
  for (const s of stock || []) {
    const key = dispatchKey(s.part_model_no, s.part_serial_no);
    if (key === "|") continue;
    const ref = String(s.transaction_ref || "").trim();
    const dcNo = ref.startsWith("DC ") ? ref.slice(3).trim() : ref;
    if (!dcNo) continue;
    if (!map.has(key)) map.set(key, { dc_no: dcNo, dc_date: null });
    challanNos.add(dcNo);
  }
  if (challanNos.size) {
    const { data } = await sb
      .from("delivery_challans")
      .select("challan_no,challan_date")
      .in("challan_no", Array.from(challanNos));
    const dateByNo = new Map<string, string | null>((data || []).map((d: any) => [d.challan_no, d.challan_date]));
    for (const v of map.values()) v.dc_date = dateByNo.get(v.dc_no) ?? null;
  }
  return map;
}

/** Whole days between txn_date and today. */
export function ageingDays(d?: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86400000));
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
      oem_case_id: r.oem_ref_id,
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