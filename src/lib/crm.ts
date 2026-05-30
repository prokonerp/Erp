export type Customer = {
  id: string;
  company: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gst: string | null;
  remarks: string | null;
  created_at: string;
};

export type LeadStatus = "new" | "follow_up" | "quoted" | "won" | "lost";

export type Lead = {
  id: string;
  customer_id: string;
  owner_id: string;
  title: string;
  source: string | null;
  status: LeadStatus;
  expected_value: number;
  closed_value: number;
  next_followup: string | null;
  closed_at: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadActivity = {
  id: string;
  lead_id: string;
  owner_id: string;
  activity_date: string;
  kind: "note" | "call" | "meeting" | "email" | "whatsapp";
  notes: string | null;
  next_followup: string | null;
  created_at: string;
};

export type QuoteItem = {
  description: string;
  hsn?: string;
  qty: number;
  unit?: string;
  rate: number;
  amount: number;
};

export type Quotation = {
  id: string;
  quote_no: string;
  lead_id: string | null;
  customer_id: string | null;
  owner_id: string;
  quote_date: string;
  validity_days: number;
  items: QuoteItem[];
  subtotal: number;
  gst_percent: number;
  gst_amount: number;
  total: number;
  status: "draft" | "sent" | "accepted" | "rejected";
  terms: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
};

export type IncentiveRule = {
  id: string;
  label: string;
  min_value: number;
  max_value: number | null;
  percent: number;
  active: boolean;
  sort_order: number;
};

export type Incentive = {
  id: string;
  lead_id: string | null;
  owner_id: string;
  period: string | null;
  closed_value: number;
  applied_percent: number;
  payout: number;
  status: "pending" | "paid";
  paid_at: string | null;
  notes: string | null;
  created_at: string;
};

export const statusLabel: Record<LeadStatus, string> = {
  new: "New",
  follow_up: "Follow-up",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

export const statusClass: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-800 border-blue-300",
  follow_up: "bg-amber-100 text-amber-800 border-amber-300",
  quoted: "bg-purple-100 text-purple-800 border-purple-300",
  won: "bg-green-100 text-green-800 border-green-300",
  lost: "bg-red-100 text-red-800 border-red-300",
};

export const fmtMoney = (n: number | null | undefined) =>
  "₹" + (Number(n || 0)).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}-${m}-${y}`;
};

// Marginal-slab incentive: pays each rule's percent on the portion of
// closed_value falling within its [min, max) band. Industry-standard tiered
// commission used by most B2B sales orgs.
export function computeIncentive(rules: IncentiveRule[], closed_value: number) {
  const active = rules.filter((r) => r.active).sort((a, b) => a.min_value - b.min_value);
  let payout = 0;
  for (const r of active) {
    const lo = r.min_value;
    const hi = r.max_value ?? Infinity;
    if (closed_value <= lo) break;
    const slice = Math.min(closed_value, hi) - lo;
    if (slice > 0) payout += slice * (r.percent / 100);
  }
  const applied_percent = closed_value > 0 ? (payout / closed_value) * 100 : 0;
  return { payout, applied_percent };
}

export const fyLabel = (d: Date = new Date()) => {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
};