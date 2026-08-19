export const INDENT_TYPES = [
  { value: "rma_advance_exchange", label: "RMA Advance Exchange" },
  { value: "rma_exchange", label: "RMA Exchange" },
  { value: "rma_service_ship", label: "RMA Service Ship" },
] as const;

export type IndentType = (typeof INDENT_TYPES)[number]["value"];

export function indentTypeLabel(v?: string | null): string {
  return INDENT_TYPES.find((t) => t.value === v)?.label || "—";
}

export type OracleDefective = {
  def_model_no: string;
  def_serial_no: string;
  qty: string;
};

export type OracleExchange = {
  warehouse_id: string;
  warehouse_name: string;
  model_no: string;
  serial_no: string;
  qty: string;
};

export type OracleReceived = {
  warehouse_id: string;
  warehouse_name: string;
  model_no: string;
  serial_no: string;
  qty: string;
  received_date: string;
  remarks: string;
};

export type OracleDefectiveRow = OracleDefective & { part_name?: string };
export type OracleExchangeRow = OracleExchange;
export type ProductTag = "good" | "defective" | "scrap";
export type OracleReceivedRow = OracleReceived & {
  /** Product Tag / Stock Condition — used by the Customer-return section
   *  to classify inbound stock into Good / Defective / Scrap. Optional on
   *  the OEM-return section (existing behaviour). */
  product_tag?: ProductTag | "";
  /** Product name from Product Master (paired with model_no). Optional
   *  for backward compat; populated when selected via the Product Master picker. */
  part_name?: string;
};

export type OracleBlock = {
  oracle_no: string;
  // Row-level arrays (new structure). Each block can have N rows; the
  // exchange/received arrays mirror the defective array length 1:1.
  defective_rows: OracleDefectiveRow[];
  exchange_rows: OracleExchangeRow[];
  /** Material Received (from OEM) — historically "from IMS". */
  received_rows: OracleReceivedRow[];
  /** Section D: Material Received (from Customer). Same shape as OEM
   *  received but with a mandatory `product_tag`. */
  customer_received_rows?: OracleReceivedRow[];
  // Legacy single-row fields — kept optional for backward compat reads only.
  defective?: OracleDefective;
  exchange?: OracleExchange;
  received?: OracleReceived;
  status?: "open" | "closed";
  closed_by?: string | null;
  closed_by_name?: string | null;
  closed_at?: string | null;
  /** Set by admin_reopen_oracle RPC when an admin re-opens a closed oracle. */
  reopened?: {
    at?: string | null;
    by?: string | null;
    reason?: string | null;
    scope?: "grn" | "dc" | "full" | null;
  } | null;
  /** Set when an admin force-closes the oracle, bypassing the normal
   *  auto-close requirements. Always paired with `force_close_reason`. */
  force_closed?: boolean | null;
  force_close_reason?: string | null;
};

const blankExchangeRow = (qty = ""): OracleExchangeRow => ({
  warehouse_id: "", warehouse_name: "", model_no: "", serial_no: "", qty,
});
const blankReceivedRow = (qty = ""): OracleReceivedRow => ({
  warehouse_id: "", warehouse_name: "", model_no: "", serial_no: "", qty, received_date: "", remarks: "",
});

/** Seed a received/customer-received row from the defective row so that
 *  model / qty auto-populate (still editable in the UI). For OEM
 *  received rows the serial is intentionally NOT auto-mapped — the OEM
 *  ships a fresh unit with its own serial the user enters manually. */
const receivedRowFromDefective = (d: OracleDefectiveRow | undefined, isCustomer = false): OracleReceivedRow => ({
  warehouse_id: "",
  warehouse_name: "",
  model_no: d?.def_model_no || "",
  serial_no: isCustomer ? (d?.def_serial_no || "") : "",
  qty: d?.qty || "",
  received_date: "",
  remarks: "",
  ...(isCustomer ? { product_tag: "defective" as ProductTag } : {}),
});

export const blankOracle = (): OracleBlock => ({
  oracle_no: "",
  defective_rows: [{ def_model_no: "", def_serial_no: "", qty: "" }],
  exchange_rows: [blankExchangeRow()],
  received_rows: [blankReceivedRow()],
  customer_received_rows: [],
  status: "open",
  closed_by: null,
  closed_by_name: null,
  closed_at: null,
});

/** Normalize an oracle block: migrate legacy single-row shape → row arrays
 *  and ensure exchange/received arrays match defective row count. */
export function normalizeOracle(o: OracleBlock): OracleBlock {
  const out: OracleBlock = { ...o };
  const hasRows = Array.isArray(out.defective_rows) && out.defective_rows.length > 0;
  if (!hasRows) {
    const d = out.defective;
    out.defective_rows = d ? [{ def_model_no: d.def_model_no || "", def_serial_no: d.def_serial_no || "", qty: d.qty || "" }] : [];
  }
  if (!Array.isArray(out.exchange_rows)) {
    out.exchange_rows = out.exchange ? [{ ...out.exchange }] : [];
  }
  if (!Array.isArray(out.received_rows)) {
    out.received_rows = out.received ? [{ ...out.received }] : [];
  }
  if (!Array.isArray(out.customer_received_rows)) {
    out.customer_received_rows = [];
  }
  // Pad exchange/received to defective length
  const n = out.defective_rows.length;
  while (out.exchange_rows.length < n) out.exchange_rows.push(blankExchangeRow(out.defective_rows[out.exchange_rows.length]?.qty || ""));
  while (out.received_rows.length < n) {
    const idx = out.received_rows.length;
    out.received_rows.push(receivedRowFromDefective(out.defective_rows[idx]));
  }
  out.exchange_rows = out.exchange_rows.slice(0, n);
  out.received_rows = out.received_rows.slice(0, n);
  // Backfill any OEM-received row where model/serial/qty are still blank
  // from the corresponding defective row so saved indents display the
  // mapped values as editable field content (not placeholders).
  out.received_rows = out.received_rows.map((r, ix) => {
    const d = out.defective_rows[ix];
    if (!d) return r;
    return {
      ...r,
      model_no: r.model_no || d.def_model_no || "",
      // OEM received serial stays blank until user enters it manually.
      serial_no: r.serial_no || "",
      qty: r.qty || d.qty || "",
    };
  });
  // customer_received_rows: always visible — pad to defective length,
  // seeding model/serial/qty from defective rows with product_tag defaulted
  // to "defective" (still editable).
  while (out.customer_received_rows.length < n) {
    const idx = out.customer_received_rows.length;
    out.customer_received_rows.push(receivedRowFromDefective(out.defective_rows[idx], true));
  }
  out.customer_received_rows = out.customer_received_rows.slice(0, n).map((r, ix) => {
    const d = out.defective_rows[ix];
    return {
      ...r,
      model_no: r.model_no || d?.def_model_no || "",
      serial_no: r.serial_no || d?.def_serial_no || "",
      qty: r.qty || d?.qty || "",
      product_tag: r.product_tag || ("defective" as ProductTag),
    };
  });
  return out;
}

/** Section D (Material Received from Customer) is mandatory for exchange-type
 *  RMAs where the customer physically returns the defective unit. For
 *  RMA Service Ship nothing comes back from the customer, so D is optional —
 *  unless the user has already started filling one of those rows. */
export function requiresCustomerReturn(indentType?: string | null): boolean {
  return (indentType || "") !== "rma_service_ship";
}

export function oracleIsComplete(oIn: OracleBlock, indentType?: string | null): boolean {
  const o = normalizeOracle(oIn);
  const nn = (s?: string) => !!(s && String(s).trim());
  const qty = (s?: string) => nn(s) && Number(s) > 0;
  if (o.defective_rows.length === 0) return false;
  const custRows = o.customer_received_rows || [];
  const custTouched = custRows.some((c) => nn(c?.warehouse_id) || nn(c?.serial_no) || nn(c?.received_date));
  const needCust = requiresCustomerReturn(indentType) || custTouched;
  for (let i = 0; i < o.defective_rows.length; i++) {
    const d = o.defective_rows[i];
    const e = o.exchange_rows[i];
    const r = o.received_rows[i];
    const c = custRows[i];
    if (!(nn(d.def_model_no) && nn(d.def_serial_no) && qty(d.qty))) return false;
    if (!e || !(nn(e.warehouse_id) && nn(e.model_no) && nn(e.serial_no) && qty(e.qty))) return false;
    if (!r || !(nn(r.warehouse_id) && nn(r.model_no) && nn(r.serial_no) && qty(r.qty) && nn(r.received_date))) return false;
    // Section D: Material Received (from Customer) — conditional on indent type.
    if (needCust) {
      if (!c || !(nn(c.warehouse_id) && nn(c.model_no) && nn(c.serial_no) && qty(c.qty) && nn(c.received_date) && nn(c.product_tag))) return false;
    }
  }
  return true;
}

export type SectionKey = "A" | "B" | "C" | "D";

/** Per-section field-completeness, extracted verbatim from `oracleIsComplete`
 *  so the pipeline display and the closure check can never disagree.
 *  Returns the list of human-readable missing field labels (empty = complete). */
export function sectionMissingFields(
  oIn: OracleBlock,
  section: SectionKey,
  indentType?: string | null,
): string[] {
  const o = normalizeOracle(oIn);
  const nn = (s?: string) => !!(s && String(s).trim());
  const qty = (s?: string) => nn(s) && Number(s) > 0;
  const missing = new Set<string>();
  if (o.defective_rows.length === 0) {
    missing.add("No defective rows");
    return Array.from(missing);
  }
  const custRows = o.customer_received_rows || [];
  const custTouched = custRows.some((c) => nn(c?.warehouse_id) || nn(c?.serial_no) || nn(c?.received_date));
  const needCust = requiresCustomerReturn(indentType) || custTouched;
  for (let i = 0; i < o.defective_rows.length; i++) {
    if (section === "A") {
      const d = o.defective_rows[i];
      if (!nn(d.def_model_no)) missing.add("Model No");
      if (!nn(d.def_serial_no)) missing.add("Serial No");
      if (!qty(d.qty)) missing.add("Qty");
    } else if (section === "B") {
      const e = o.exchange_rows[i];
      if (!e) { missing.add("Exchange row"); continue; }
      if (!nn(e.warehouse_id)) missing.add("Warehouse");
      if (!nn(e.model_no)) missing.add("Model");
      if (!nn(e.serial_no)) missing.add("Serial");
      if (!qty(e.qty)) missing.add("Qty");
    } else if (section === "C") {
      const r = o.received_rows[i];
      if (!r) { missing.add("Received row"); continue; }
      if (!nn(r.warehouse_id)) missing.add("Warehouse");
      if (!nn(r.model_no)) missing.add("Model");
      if (!nn(r.serial_no)) missing.add("Serial");
      if (!qty(r.qty)) missing.add("Qty");
      if (!nn(r.received_date)) missing.add("Received Date");
    } else {
      if (!needCust) return [];
      const c = custRows[i];
      if (!c) { missing.add("Customer return row"); continue; }
      if (!nn(c.warehouse_id)) missing.add("Warehouse");
      if (!nn(c.model_no)) missing.add("Model");
      if (!nn(c.serial_no)) missing.add("Serial");
      if (!qty(c.qty)) missing.add("Qty");
      if (!nn(c.received_date)) missing.add("Received Date");
      if (!nn(c.product_tag)) missing.add("Product Tag");
    }
  }
  return Array.from(missing);
}

/** Tri-state progress indicator for a single Oracle block:
 *  - "closed": already marked closed, or every required row is complete AND
 *    no linked DC/GRN is still pending (same rule as auto-close).
 *  - "pending": no material fields filled yet.
 *  - "in_progress": some rows partially filled but not all complete. */
export function oracleProgress(
  oIn: OracleBlock,
  indentType?: string | null,
  pending?: OraclePendingDocs | null,
): "closed" | "in_progress" | "pending" {
  const o = normalizeOracle(oIn);
  if (o.status === "closed" || oracleCanAutoClose(o, pending, indentType)) return "closed";
  const nn = (s?: string) => !!(s && String(s).trim());
  const anyFilled =
    o.defective_rows.some((d) => nn(d.def_model_no) || nn(d.def_serial_no) || nn(d.qty)) ||
    o.exchange_rows.some((e) => nn(e.warehouse_id) || nn(e.model_no) || nn(e.serial_no) || nn(e.qty)) ||
    o.received_rows.some((r) => nn(r.warehouse_id) || nn(r.model_no) || nn(r.serial_no) || nn(r.qty) || nn(r.received_date)) ||
    (o.customer_received_rows || []).some((r) => nn(r.warehouse_id) || nn(r.model_no) || nn(r.serial_no) || nn(r.qty) || nn(r.received_date));
  return anyFilled ? "in_progress" : "pending";
}

/** Build Oracle blocks from a ticket's Defective Parts list. Rows are
 *  grouped by their `oracle_no` tag (case-insensitive trim). Parts without
 *  an Oracle # are grouped under "Unassigned". */
export function buildOraclesFromDefectiveParts(
  parts: Array<{ name?: string; model_no?: string; serial?: string; qty?: string | number; oracle_no?: string }>,
): OracleBlock[] {
  const groups = new Map<string, OracleDefectiveRow[]>();
  const order: string[] = [];
  for (const p of parts || []) {
    const key = (p.oracle_no || "").trim();
    if (!key && !(p.name || p.model_no || p.serial)) continue;
    const k = key || "Unassigned";
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k)!.push({
      part_name: p.name || "",
      def_model_no: p.model_no || "",
      def_serial_no: p.serial || "",
      qty: String(p.qty ?? "1"),
    });
  }
  return order.map((k) => {
    const def = groups.get(k)!;
    return {
      oracle_no: k === "Unassigned" ? "" : k,
      defective_rows: def,
      exchange_rows: def.map((d) => blankExchangeRow(d.qty)),
      received_rows: def.map((d) => receivedRowFromDefective(d)),
      customer_received_rows: [],
      status: "open" as const,
      closed_by: null,
      closed_by_name: null,
      closed_at: null,
    };
  });
}

/** Build Oracle blocks from a ticket's defective parts, filtered to only the
 *  supplied oracle numbers. Matching is case-insensitive with trim; a `"NEW"`
 *  sentinel is treated as "unassigned only" (parts without an oracle_no).
 *  Delegates to `buildOraclesFromDefectiveParts` after filtering so grouping
 *  and shape stay identical to the single-indent flow. */
export function buildOraclesFromSelectedList(
  parts: Array<{ name?: string; model_no?: string; serial?: string; qty?: string | number; oracle_no?: string }>,
  oracleList: string[],
): OracleBlock[] {
  const wanted = new Set(oracleList.map((s) => (s || "").trim().toUpperCase()).filter(Boolean));
  const wantsUnassigned = wanted.has("NEW") || wanted.has("UNASSIGNED");
  const filtered = (parts || []).filter((p) => {
    const k = (p.oracle_no || "").trim().toUpperCase();
    if (!k) return wantsUnassigned;
    return wanted.has(k);
  });
  return buildOraclesFromDefectiveParts(filtered);
}

export function oracleStatus(o: OracleBlock): "open" | "closed" {
  return o.status === "closed" ? "closed" : "open";
}

/** Per-oracle, per-document-type counts of related documents.
 *  `pending` = exists but not yet Submitted/Closed.
 *  `settled` = exists and is Submitted/Closed.
 *  Both zero means the document was never created — which is NOT the same
 *  as "nothing pending" and must block auto-close. */
export type DocCounts = {
  pending: number;
  settled: number;
  /** Most recently created settled document for this section, when known. */
  doc_id?: string | null;
  doc_no?: string | null;
};
export type OraclePendingDocs = {
  dc: DocCounts;
  oem_grn: DocCounts;
  customer_grn: DocCounts;
};

export const emptyDocCounts = (): DocCounts => ({ pending: 0, settled: 0 });
export const emptyOracleDocs = (): OraclePendingDocs => ({
  dc: emptyDocCounts(), oem_grn: emptyDocCounts(), customer_grn: emptyDocCounts(),
});

/** A document type is satisfied only when at least one exists AND none of
 *  the existing ones are still pending. */
export function docSatisfied(c?: DocCounts | null): boolean {
  if (!c) return false;
  return c.settled > 0 && c.pending === 0;
}

/** A document status counts as settled when Submitted, Closed, or
 *  "Challan Generated" — the latter is a genuine completed state for
 *  Delivery Challans where stock has already been posted.
 *  Cancelled documents are ignored by the callers building these counts. */
export function docStatusSettled(status?: string | null): boolean {
  const s = (status || "").trim().toLowerCase();
  return s === "submitted" || s === "closed" || s === "challan generated";
}

/** An Oracle may auto-close only when every A–D row is complete AND every
 *  section that has material to send/receive has its corresponding document
 *  actually generated and Submitted/Closed:
 *   - Section B (exchange rows) → Delivery Challan
 *   - Section C (OEM received rows) → GRN (category = oem)
 *   - Section D (customer received rows) → GRN (category = customer) */
/** Which documents this Oracle needs before it may close. Extracted from
 *  `oracleCanAutoClose` so the pipeline display uses the identical rule. */
export function oracleDocRequirements(oIn: OracleBlock, indentType?: string | null) {
  const o = normalizeOracle(oIn);
  const nn = (s?: string) => !!(s && String(s).trim());
  const rowFilled = (r?: { warehouse_id?: string; model_no?: string; serial_no?: string; qty?: string }) =>
    !!r && (nn(r.warehouse_id) || nn(r.model_no) || nn(r.serial_no) || nn(r.qty));
  const custRows = o.customer_received_rows || [];
  const custTouched = custRows.some(rowFilled);
  return {
    needDc: o.exchange_rows.some(rowFilled),
    needOemGrn: o.received_rows.some(rowFilled),
    needCustomerGrn: (requiresCustomerReturn(indentType) && custRows.length > 0) || custTouched,
  };
}

export function oracleCanAutoClose(
  oIn: OracleBlock,
  pending?: OraclePendingDocs | null,
  indentType?: string | null,
): boolean {
  if (!oracleIsComplete(oIn, indentType)) return false;
  const { needDc, needOemGrn, needCustomerGrn } = oracleDocRequirements(oIn, indentType);
  if (needDc && !docSatisfied(pending?.dc)) return false;
  if (needOemGrn && !docSatisfied(pending?.oem_grn)) return false;
  if (needCustomerGrn && !docSatisfied(pending?.customer_grn)) return false;
  return true;
}

export function indentStatusFromOracles(oracles: OracleBlock[] | null | undefined): "open" | "closed" {
  const list = oracles || [];
  if (list.length === 0) return "open";
  return list.every((o) => oracleStatus(o) === "closed") ? "closed" : "open";
}

export function indentClosedAt(oracles: OracleBlock[] | null | undefined): string | null {
  const list = oracles || [];
  if (list.length === 0 || !list.every((o) => oracleStatus(o) === "closed")) return null;
  const times = list.map((o) => (o.closed_at ? new Date(o.closed_at).getTime() : 0)).filter((t) => t > 0);
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

export function formatAge(fromIso: string, toIso?: string | null): string {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  let ms = Math.max(0, to - from);
  const day = 24 * 60 * 60 * 1000;
  const hr = 60 * 60 * 1000;
  const mn = 60 * 1000;
  const days = Math.floor(ms / day); ms -= days * day;
  const hours = Math.floor(ms / hr); ms -= hours * hr;
  const mins = Math.floor(ms / mn);
  if (days > 0) return `${days} Day${days === 1 ? "" : "s"} ${String(hours).padStart(2, "0")} Hour${hours === 1 ? "" : "s"}`;
  if (hours > 0) return `${hours} Hour${hours === 1 ? "" : "s"} ${String(mins).padStart(2, "0")} Min`;
  return `${mins} Min`;
}

export type Indent = {
  id: string;
  indent_no: string | null;
  indent_date: string;
  ticket_id: string;
  indent_city: string | null;
  case_id: string | null;
  oem_case_id: string | null;
  oracle_number: string | null;
  company: string | null;
  def_model_no: string | null;
  def_serial_no: string | null;
  problem_reported: string | null;
  indent_type: IndentType | null;
  oracles: string | null;
  oracles_data: OracleBlock[] | null;
  material_exchange_model: string | null;
  material_exchange_serial_no: string | null;
  material_rec_model_no: string | null;
  material_rec_serial_no: string | null;
  material_rec_date: string | null;
  engineer_name: string | null;
  remarks: string | null;
  product_model: string | null;
  product_serial: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Sync the linked Ticket's Good Parts Used section from the Indent's
 * CLOSED Oracle blocks (Material Exchange). Open oracles are ignored.
 * Rows from this indent are de-duplicated by indent_id + oracle_no.
 */
export async function syncTicketGoodPartsFromIndent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  indent: { id: string; indent_no: string | null; ticket_id: string; oracles_data: OracleBlock[] | null }
): Promise<void> {
  if (!indent.ticket_id) return;
  const { data, error } = await supabase
    .from("tickets")
    .select("good_parts_used, good_parts_details")
    .eq("id", indent.ticket_id)
    .maybeSingle();
  if (error) return;
  type Row = {
    name?: string; qty?: string; model_no?: string; serial?: string; remarks?: string;
    source?: string; indent_id?: string | null; indent_no?: string | null; oracle_no?: string | null;
  };
  const tk = (data || {}) as { good_parts_used?: boolean; good_parts_details?: Row[] };
  const existing: Row[] = Array.isArray(tk.good_parts_details) ? tk.good_parts_details : [];
  // Drop previous rows generated from THIS indent — we re-build them from current oracles.
  const kept = existing.filter((r) => !(r.source === "oracle_exchange" && r.indent_id === indent.id));
  const oracleRows: Row[] = [];
  for (const oRaw of indent.oracles_data || []) {
    const o = normalizeOracle(oRaw);
    if (o.status !== "closed") continue;
    for (const ex of o.exchange_rows) {
      if (!ex || !ex.model_no || !ex.serial_no) continue;
      // Serial select stores `part_serial_no || id`; model select stores "name||model_no"
      const [partName, modelNo] = (ex.model_no || "").split("||");
      oracleRows.push({
        name: partName || ex.model_no,
        model_no: modelNo || ex.model_no,
        serial: ex.serial_no,
        qty: ex.qty || "1",
        remarks: `Oracle ${o.oracle_no || ""} · ${indent.indent_no || ""}`.trim(),
        source: "oracle_exchange",
        indent_id: indent.id,
        indent_no: indent.indent_no,
        oracle_no: o.oracle_no || "",
      });
    }
  }
  const merged = [...kept, ...oracleRows];
  const enableGood = oracleRows.length > 0 ? true : !!tk.good_parts_used;
  await supabase.from("tickets").update({
    good_parts_used: enableGood,
    good_parts_details: merged as unknown as Record<string, unknown>,
  }).eq("id", indent.ticket_id);
}