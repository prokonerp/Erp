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
};

export const blankOracle = (): OracleBlock => ({
  oracle_no: "",
  defective: { def_model_no: "", def_serial_no: "", qty: "" },
  exchange: { warehouse_id: "", warehouse_name: "", model_no: "", serial_no: "", qty: "" },
  received: { warehouse_id: "", warehouse_name: "", model_no: "", serial_no: "", qty: "", received_date: "", remarks: "" },
});

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