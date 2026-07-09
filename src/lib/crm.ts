export type Customer = {
  id: string;
  company: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  state: string | null;
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

// Zoho-style line item
export type QuoteItem = {
  product_id?: string;         // reference to products master (optional)
  product_name?: string;       // snapshot of master name at time of save
  description: string;
  item_details?: string;      // extra notes line under description
  hsn?: string;
  qty: number;
  unit?: string;
  rate: number;
  discount_percent?: number;  // per-line discount %
  tax_percent?: number;       // per-line GST %
  amount: number;             // = qty*rate*(1-disc%)
};

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "invoiced";

export type Quotation = {
  id: string;
  quote_no: string;
  reference_no: string | null;
  subject: string | null;
  lead_id: string | null;
  customer_id: string | null;
  owner_id: string;
  quote_date: string;
  expiry_date: string | null;
  validity_days: number;
  salesperson: string | null;
  project_name: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  place_of_supply: string | null;
  items: QuoteItem[];
  subtotal: number;             // sum of line amounts (after line discount, before tax)
  discount_amount: number;      // doc-level flat discount
  shipping_charges: number;
  adjustment: number;
  tcs_percent: number;
  tcs_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  gst_percent: number;          // legacy fallback
  gst_amount: number;           // total tax (cgst+sgst+igst)
  round_off: number;
  total: number;
  status: QuoteStatus;
  terms: string | null;
  customer_notes: string | null;
  remarks: string | null;
  attachments: any[];
  created_at: string;
  updated_at: string;
};

export type QuoteTermsTemplate = {
  id: string;
  name: string;
  body: string;
  is_default: boolean;
  sort_order: number;
};

export type CrmSettings = {
  id: number;
  business_state: string;
  business_gstin: string | null;
  default_terms: string;
  default_customer_notes: string;
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
  new: "New", follow_up: "Follow-up", quoted: "Quoted", won: "Won", lost: "Lost",
};
export const statusClass: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-800 border-blue-300",
  follow_up: "bg-amber-100 text-amber-800 border-amber-300",
  quoted: "bg-purple-100 text-purple-800 border-purple-300",
  won: "bg-green-100 text-green-800 border-green-300",
  lost: "bg-red-100 text-red-800 border-red-300",
};

export const quoteStatusClass: Record<QuoteStatus, string> = {
  draft: "bg-gray-100 text-gray-800 border-gray-300",
  sent: "bg-blue-100 text-blue-800 border-blue-300",
  accepted: "bg-green-100 text-green-800 border-green-300",
  declined: "bg-red-100 text-red-800 border-red-300",
  expired: "bg-amber-100 text-amber-800 border-amber-300",
  invoiced: "bg-purple-100 text-purple-800 border-purple-300",
};

export const fmtMoney = (n: number | null | undefined) =>
  "₹" + (Number(n || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}-${m}-${y}`;
};

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

// Indian states for place-of-supply
export const INDIAN_STATES = [
  "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat",
  "Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra",
  "Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu",
  "Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal",
  "Andaman and Nicobar Islands","Chandigarh","Dadra and Nagar Haveli and Daman and Diu",
  "Delhi","Jammu and Kashmir","Ladakh","Lakshadweep","Puducherry",
];

// ---------- Quotation calculations (Zoho-style) ----------

export function lineAmount(it: QuoteItem): number {
  const gross = Number(it.qty || 0) * Number(it.rate || 0);
  const disc = gross * (Number(it.discount_percent || 0) / 100);
  return +(gross - disc).toFixed(2);
}
export function lineTax(it: QuoteItem): number {
  return +((lineAmount(it) * Number(it.tax_percent || 0)) / 100).toFixed(2);
}

export function computeQuoteTotals(q: {
  items: QuoteItem[];
  discount_amount: number;
  shipping_charges: number;
  adjustment: number;
  tcs_percent: number;
  round_off: number;
  place_of_supply: string | null;
  business_state: string;
}) {
  const subtotal = +q.items.reduce((s, it) => s + lineAmount(it), 0).toFixed(2);
  const total_tax = +q.items.reduce((s, it) => s + lineTax(it), 0).toFixed(2);

  const intra = (q.place_of_supply || "").trim().toLowerCase() === q.business_state.trim().toLowerCase();
  const cgst_amount = intra ? +(total_tax / 2).toFixed(2) : 0;
  const sgst_amount = intra ? +(total_tax - cgst_amount).toFixed(2) : 0;
  const igst_amount = intra ? 0 : total_tax;

  const after_disc = subtotal - Number(q.discount_amount || 0);
  const tcs_base = after_disc + Number(q.shipping_charges || 0);
  const tcs_amount = +(tcs_base * (Number(q.tcs_percent || 0) / 100)).toFixed(2);

  const total = +(
    after_disc
    + Number(q.shipping_charges || 0)
    + Number(q.adjustment || 0)
    + cgst_amount + sgst_amount + igst_amount
    + tcs_amount
    + Number(q.round_off || 0)
  ).toFixed(2);

  return { subtotal, total_tax, cgst_amount, sgst_amount, igst_amount, tcs_amount, total };
}

// Number to words (Indian) for invoice totals
export function amountInWords(num: number): string {
  const n = Math.round(num);
  if (n === 0) return "Zero Rupees Only";
  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
    "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  const two = (x: number): string => x < 20 ? a[x] : b[Math.floor(x/10)] + (x%10 ? " " + a[x%10] : "");
  const three = (x: number): string => {
    const h = Math.floor(x/100), r = x%100;
    return (h ? a[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  let s = n, out = "";
  const cr = Math.floor(s / 10000000); s %= 10000000;
  const lk = Math.floor(s / 100000); s %= 100000;
  const th = Math.floor(s / 1000); s %= 1000;
  if (cr) out += three(cr) + " Crore ";
  if (lk) out += two(lk) + " Lakh ";
  if (th) out += two(th) + " Thousand ";
  if (s) out += three(s);
  return out.trim() + " Rupees Only";
}
