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

export type CallType = string;

export const PRIORITIES = ["P1", "P2", "P3", "P4", "P5"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_COLOR: Record<string, string> = {
  P1: "bg-red-100 text-red-800",
  P2: "bg-orange-100 text-orange-800",
  P3: "bg-amber-100 text-amber-800",
  P4: "bg-blue-100 text-blue-800",
  P5: "bg-zinc-100 text-zinc-700",
};

/** Hours elapsed between two dates, EXCLUDING any time that falls on Sunday (local). */
export function hoursExcludingSundays(fromISO: string, to: Date = new Date()): number {
  const from = new Date(fromISO);
  if (isNaN(from.getTime()) || to <= from) return 0;
  let total = 0;
  // Walk segment-by-segment between day boundaries so we can skip Sundays entirely.
  let cursor = new Date(from);
  while (cursor < to) {
    const next = new Date(cursor);
    next.setHours(24, 0, 0, 0); // start of next day (local)
    const segEnd = next < to ? next : to;
    if (cursor.getDay() !== 0) {
      total += (segEnd.getTime() - cursor.getTime()) / 3_600_000;
    }
    cursor = segEnd;
  }
  return total;
}

export function timerBadgeColor(hours: number): string {
  if (hours > 24) return "bg-red-100 text-red-800 border-red-200";
  if (hours > 8) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-green-100 text-green-800 border-green-200";
}

export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))}m`;
  if (hours < 100) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours)}h`;
}

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type PartLine = {
  name: string;
  qty: string;
  model_no?: string;
  serial?: string;
  remarks?: string;
  confirmed?: boolean;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
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

/** Normalise phone to international digits (defaults to India 91). Returns "" if invalid. */
export function waPhone(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  // assume already includes country code if >=11 digits
  return digits.length >= 11 ? digits : "";
}

/** WhatsApp universal link — works on mobile (opens app), desktop (opens WhatsApp Desktop),
 *  and falls back to WhatsApp Web in the browser if no app is installed. */
export function waLink(phone: string | null | undefined, text: string): string {
  const p = waPhone(phone);
  const t = encodeURIComponent(text);
  return p
    ? `https://wa.me/${p}?text=${t}`
    : `https://wa.me/?text=${t}`;
}

/** Click handler: copy message to clipboard, then open WhatsApp in a new browser tab.
 *  Uses the wa.me universal link with target=_blank so WhatsApp is never embedded
 *  inside an iframe/modal (which browsers block with ERR_BLOCKED_BY_RESPONSE).
 *  Returns:
 *    "ok"       — new tab opened
 *    "invalid"  — phone number missing / invalid
 *    "blocked"  — popup blocked by browser; caller should show a fallback message
 */
export async function waOpen(
  phone: string | null | undefined,
  text: string,
): Promise<"ok" | "invalid" | "blocked"> {
  const p = waPhone(phone);
  if (!p) return "invalid";
  try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  const url = `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
  try {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w || w.closed || typeof w.closed === "undefined") return "blocked";
    return "ok";
  } catch {
    return "blocked";
  }
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