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