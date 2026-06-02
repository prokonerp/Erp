export const CALL_TYPES = [
  "OOW",
  "Installation",
  "Warranty",
  "AMC",
  "PM Call",
  "New Sale Delivery",
  "CCTV",
] as const;

export const TICKET_STATUSES = [
  "New",
  "Call Log",
  "In Progress",
  "Under Observation",
  "Waiting for Parts",
  "Parts Received",
  "Cancelled",
  "Closed",
] as const;

export type CallType = (typeof CALL_TYPES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type PartLine = {
  name: string;
  qty: string;
  serial?: string;
  remarks?: string;
};

export const STATUS_COLOR: Record<string, string> = {
  New: "bg-blue-100 text-blue-800",
  "Call Log": "bg-indigo-100 text-indigo-800",
  "In Progress": "bg-amber-100 text-amber-800",
  "Under Observation": "bg-purple-100 text-purple-800",
  "Waiting for Parts": "bg-orange-100 text-orange-800",
  "Parts Received": "bg-teal-100 text-teal-800",
  Cancelled: "bg-zinc-200 text-zinc-700",
  Closed: "bg-green-100 text-green-800",
};

/** Build a wa.me click-to-send URL. phone must be digits, country code optional. */
export function waLink(phone: string | null | undefined, text: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  const num = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}

export function engineerAssignMsg(t: {
  case_id: string;
  call_type: string;
  customer_name: string;
  customer_phone?: string | null;
  location?: string | null;
  customer_address?: string | null;
  product?: string | null;
  serial_no?: string | null;
  complaint?: string | null;
}) {
  return [
    `*New Service Call Assigned*`,
    `Case ID: ${t.case_id}`,
    `Type: ${t.call_type}`,
    `Customer: ${t.customer_name}`,
    t.customer_phone ? `Contact: ${t.customer_phone}` : "",
    t.location ? `Location: ${t.location}` : "",
    t.customer_address ? `Address: ${t.customer_address}` : "",
    t.product ? `Product: ${t.product}` : "",
    t.serial_no ? `Serial: ${t.serial_no}` : "",
    t.complaint ? `Complaint: ${t.complaint}` : "",
    ``,
    `— Prokon Hi-Tech Systems`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function customerClosedMsg(t: {
  case_id: string;
  customer_name: string;
  product?: string | null;
}) {
  return [
    `Dear ${t.customer_name},`,
    ``,
    `Your service request *${t.case_id}*${t.product ? ` for ${t.product}` : ""} has been *resolved & closed*.`,
    `Thank you for choosing Prokon Hi-Tech Systems. We appreciate your business.`,
    ``,
    `For any further assistance, feel free to reach out.`,
    `— Prokon Hi-Tech Systems`,
  ].join("\n");
}

/** Replace {{key}} placeholders in a template body. */
export function renderTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

export type WaTemplateId = "engineer_assign" | "oow_quotation" | "ticket_closed";

export const TEMPLATE_PLACEHOLDERS: Record<WaTemplateId, string[]> = {
  engineer_assign: [
    "case_id", "call_type", "customer_name", "customer_phone",
    "location", "customer_address", "product", "serial_no", "complaint",
  ],
  oow_quotation: ["customer_name", "case_id", "quote_no", "product", "product_line"],
  ticket_closed: ["customer_name", "case_id", "product", "product_line"],
};