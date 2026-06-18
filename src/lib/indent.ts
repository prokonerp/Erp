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

export type OracleBlock = {
  oracle_no: string;
  defective: OracleDefective;
  exchange: OracleExchange;
  received: OracleReceived;
  status?: "open" | "closed";
  closed_by?: string | null;
  closed_by_name?: string | null;
  closed_at?: string | null;
};

export const blankOracle = (): OracleBlock => ({
  oracle_no: "",
  defective: { def_model_no: "", def_serial_no: "", qty: "" },
  exchange: { warehouse_id: "", warehouse_name: "", model_no: "", serial_no: "", qty: "" },
  received: { warehouse_id: "", warehouse_name: "", model_no: "", serial_no: "", qty: "", received_date: "", remarks: "" },
  status: "open",
  closed_by: null,
  closed_by_name: null,
  closed_at: null,
});

export function oracleIsComplete(o: OracleBlock): boolean {
  const d = o.defective;
  const e = o.exchange;
  const r = o.received;
  const nn = (s: string) => !!(s && String(s).trim());
  const qty = (s: string) => nn(s) && Number(s) > 0;
  return (
    nn(d.def_model_no) && nn(d.def_serial_no) && qty(d.qty) &&
    nn(e.warehouse_id) && nn(e.model_no) && nn(e.serial_no) && qty(e.qty) &&
    nn(r.warehouse_id) && nn(r.model_no) && nn(r.serial_no) && qty(r.qty) && nn(r.received_date)
  );
}

export function oracleStatus(o: OracleBlock): "open" | "closed" {
  return o.status === "closed" ? "closed" : "open";
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
  supabase: {
    from: (t: string) => {
      select: (s: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }> } };
      update: (p: Record<string, unknown>) => { eq: (k: string, v: string) => Promise<{ error: { message: string } | null }> };
    };
  },
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
  for (const o of indent.oracles_data || []) {
    if (o.status !== "closed") continue;
    const ex = o.exchange;
    if (!ex || !ex.model_no || !ex.serial_no) continue;
    oracleRows.push({
      name: ex.model_no,
      model_no: ex.model_no,
      serial: ex.serial_no,
      qty: ex.qty || "1",
      remarks: `Oracle ${o.oracle_no || ""} · ${indent.indent_no || ""}`.trim(),
      source: "oracle_exchange",
      indent_id: indent.id,
      indent_no: indent.indent_no,
      oracle_no: o.oracle_no || "",
    });
  }
  const merged = [...kept, ...oracleRows];
  const enableGood = oracleRows.length > 0 ? true : !!tk.good_parts_used;
  await supabase.from("tickets").update({
    good_parts_used: enableGood,
    good_parts_details: merged as unknown as Record<string, unknown>,
  }).eq("id", indent.ticket_id);
}