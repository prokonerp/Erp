import { resolveSupplyType } from "@/lib/gst";
import { r2 } from "@/lib/money";

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
  city?: string | null;
  gst: string | null;
  pan?: string | null;
  gst_status?: string | null;
  customer_type?: string | null;
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
  closed_remarks: string | null;
  lost_reason: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Human "x ago" for pending-acknowledgment ageing. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

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
  warranty_months?: number;   // per-line warranty override (months)
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
  branch_id: string | null;
  quote_date: string;
  expiry_date: string | null;
  validity_days: number;
  salesperson: string | null;
  project_name: string | null;
  payment_terms: string | null;
  delivery_timeline: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  place_of_supply: string | null;
  items: QuoteItem[];
  subtotal: number;             // sum of line amounts (after line discount, before tax)
  discount_amount: number;      // doc-level flat discount
  discount_label?: string | null; // editable label for the discount line
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
  // ── Revise trail (Option A, all nullable/have defaults so old rows stay valid) ──
  revision_of?: string | null;
  revision_no?: number;         // 1 = original, 2… = revisions
  is_latest?: boolean;          // false = superseded, hidden from default pipeline/list unless Show history
  superseded_at?: string | null;
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

// ── Revision helpers (Option A, pipeline-safe) ──────────────────────────

export const revisionBadgeClass = "bg-slate-100 text-slate-700 border-slate-300";
export const latestRevisionBadgeClass = "bg-emerald-50 text-emerald-800 border-emerald-200";
export const supersededBadgeClass = "bg-slate-100 text-slate-500 border-slate-300";

export function isSuperseded(q: Pick<Quotation, "is_latest">): boolean {
  return q.is_latest === false;
}
export function isLatest(q: Pick<Quotation, "is_latest">): boolean {
  return q.is_latest !== false;
}
export function revisionLabel(q: Pick<Quotation, "revision_no" | "is_latest">): string {
  const n = Number(q.revision_no || 1);
  if (n <= 1) return isSuperseded(q as any) ? "Superseded" : "";
  return isSuperseded(q as any) ? `Superseded v${n}` : `Revised v${n}`;
}
export function groupKeyForThread(q: Quotation): string {
  // thread = same lead if present, else root id via revision_of chain fallback
  if (q.lead_id) return `lead:${q.lead_id}`;
  if (q.revision_of) return `rev:${q.revision_of}`;
  return `id:${q.id}`;
}
export function sortQuotationsForThread(a: Quotation, b: Quotation): number {
  const na = Number(a.revision_no || 1);
  const nb = Number(b.revision_no || 1);
  if (na !== nb) return nb - na; // latest first
  return (b.created_at || "").localeCompare(a.created_at || "");
}

/** Filter to only latest revisions (default pipeline/list view). Keep superseded hidden */
export function filterLatestOnly<T extends Pick<Quotation, "is_latest">>(rows: T[]): T[] {
  return rows.filter((r) => r.is_latest !== false);
}

/** Keep mutations pipeline-safe: sync a lead's expected_value to its latest revision total */
export async function syncLeadExpectedValue(leadId: string, newTotal?: number): Promise<void> {
  if (!leadId) return;
  // prefer caller-supplied newTotal to avoid extra read; fallback to DB fetch of latest
  let total = newTotal;
  if (total === undefined) {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await (supabase as any)
      .from("quotations")
      .select("total")
      .eq("lead_id", leadId)
      .eq("is_latest", true)
      .order("revision_no", { ascending: false })
      .limit(1)
      .maybeSingle();
    total = Number((data as any)?.total ?? 0);
  }
  const { supabase } = await import("@/integrations/supabase/client");
  const { error } = await (supabase as any).from("leads").update({ expected_value: total }).eq("id", leadId);
  if (error) throw error;
}

export const fmtMoney = (n: number | null | undefined) =>
  "₹" + (Number(n || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-");
  return `${d}-${m}-${y}`;
};

/** Default quotation validity in days (quote date counts as day 1). */
export const DEFAULT_VALIDITY_DAYS = 15;

/**
 * Expiry = quote date + (validity - 1) calendar days, so the quote date is
 * counted as day 1 (e.g. 01-Aug + 15 days validity → 15-Aug).
 */
export function computeExpiryDate(
  quoteDate: string | null | undefined,
  validityDays: number = DEFAULT_VALIDITY_DAYS
): string {
  if (!quoteDate) return "";
  const base = new Date(`${quoteDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return "";
  const days = Math.max(1, Number(validityDays) || DEFAULT_VALIDITY_DAYS);
  base.setDate(base.getDate() + days - 1);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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
  return r2(gross - disc);
}
export function lineTax(it: QuoteItem): number {
  return r2((lineAmount(it) * Number(it.tax_percent || 0)) / 100);
}

/**
 * B-04 + H3: single source of truth for intra- vs inter-state supply.
 * Delegates to `resolveSupplyType` in gst.ts so CRM and invoice engine share
 * identical rules: GSTIN state codes win when available; free-text state
 * names are resolved via GSTIN_STATE_CODES inverse; missing buyer state
 * returns missingState (caller must zero tax, see computeQuoteTotals).
 */
export function isIntraSupply(opts: {
  seller_gstin?: string | null;
  buyer_gstin?: string | null;
  place_of_supply?: string | null;
  business_state: string;
}): boolean {
  const r = resolveSupplyType({
    seller_gstin: opts.seller_gstin,
    buyer_gstin: opts.buyer_gstin,
    business_state: opts.business_state,
    place_of_supply: opts.place_of_supply,
  });
  // Missing buyer state previously mapped to inter (false); preserve that
  // boolean for backwards compat — the tax-zeroing is handled at the
  // computeQuoteTotals level via missingState (mirrors gst.ts).
  if (r.missingState) return false;
  return !r.isInterstate;
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
  /** B-04: GSTINs take precedence over free-text state names when deciding
   *  intra vs inter-state — the invoice engine (gst.ts) derives the tax type
   *  from GSTIN codes, so the quote must use the identical rule or a quote can
   *  show CGST+SGST while its invoice charges IGST. */
  seller_gstin?: string | null;
  buyer_gstin?: string | null;
}) {
  const subtotal = r2(q.items.reduce((s, it) => s + lineAmount(it), 0));
  const total_tax = r2(q.items.reduce((s, it) => s + lineTax(it), 0));

  // H3: use shared resolver — maps business_state / place_of_supply to
  // GSTIN codes via GSTIN_STATE_CODES inverse, and surfaces missingState so
  // we can zero tax instead of mis-classifying as IGST/CGST.
  const resolved = resolveSupplyType({
    seller_gstin: q.seller_gstin,
    buyer_gstin: q.buyer_gstin,
    business_state: q.business_state,
    place_of_supply: q.place_of_supply,
  });
  const missingState = resolved.missingState;
  const intra = !resolved.isInterstate;
  const raw_cgst = intra ? r2(total_tax / 2) : 0;
  const raw_sgst = intra ? r2(total_tax - raw_cgst) : 0;
  const raw_igst = intra ? 0 : total_tax;
  // H3: when buyer state / place of supply missing we must NOT silently
  // assume intra or inter — zero tax lines and warn (mirrors gst.ts computeTotals).
  const cgst_amount = missingState ? 0 : raw_cgst;
  const sgst_amount = missingState ? 0 : raw_sgst;
  const igst_amount = missingState ? 0 : raw_igst;
  const gstWarning = resolved.gstWarning;

  const after_disc = subtotal - Number(q.discount_amount || 0);
  const tcs_base = after_disc + Number(q.shipping_charges || 0);
  const tcs_amount = r2(tcs_base * (Number(q.tcs_percent || 0) / 100));

  const total = r2(
    after_disc
    + Number(q.shipping_charges || 0)
    + Number(q.adjustment || 0)
    + cgst_amount + sgst_amount + igst_amount
    + tcs_amount
    + Number(q.round_off || 0)
  );

  return { subtotal, total_tax, cgst_amount, sgst_amount, igst_amount, tcs_amount, total, gstWarning };
}

// ── Centralized quotation validation (H8) ──
// Single source for new.tsx and $id.tsx save guards.
// Returns first error string or null if ok. Reuses lineAmount for subtotal.
export function validateQuotation(opts: {
  items: QuoteItem[];
  branch_id?: string | null;
  place_of_supply?: string | null;
  discount_amount?: number | null;
  shipping_charges?: number | null;
  adjustment?: number | null;
  tcs_percent?: number | null;
  round_off?: number | null;
  customer_id?: string | null;
  require_branch?: boolean;
  require_place_of_supply?: boolean;
}): string | null {
  const {
    items,
    branch_id,
    place_of_supply,
    discount_amount,
    shipping_charges,
    adjustment,
    tcs_percent,
    round_off,
    customer_id,
    require_branch = true,
    require_place_of_supply = false,
  } = opts;

  if (customer_id !== undefined && !customer_id) return "Select a customer";
  if (require_branch && !branch_id) return "Select a warehouse / branch";
  if (require_place_of_supply && !(place_of_supply || "").trim()) return "Select place of supply";

  // Numeric doc-level fields must be finite
  const numChecks: Array<[string, number | null | undefined, string]> = [
    ["Discount", discount_amount, "Discount amount must be a valid number"],
    ["Shipping", shipping_charges, "Shipping charges must be a valid number"],
    ["Adjustment", adjustment, "Adjustment must be a valid number"],
    ["TCS %", tcs_percent, "TCS % must be a valid number"],
    ["Round-off", round_off, "Round-off must be a valid number"],
  ];
  for (const [, val, msg] of numChecks) {
    if (val == null) continue;
    const n = Number(val);
    if (!Number.isFinite(n)) return msg;
  }

  // TCS % bounds
  if (tcs_percent != null) {
    const n = Number(tcs_percent);
    if (Number.isFinite(n) && (n < 0 || n > 100)) return "TCS % must be between 0 and 100";
  }

  // Filter to valid items (non-empty description or product_id)
  const valid = (items || []).filter((it) => ((it.description || "").trim() || (it.product_id || "").trim()));
  if (!valid.length) return "Add at least one item";

  // Per-line checks
  for (let idx = 0; idx < valid.length; idx++) {
    const it = valid[idx];
    const label = (it.description || it.product_name || `Item ${idx + 1}`).trim() || `Item ${idx + 1}`;
    const qty = Number(it.qty);
    if (!Number.isFinite(qty)) return `Quantity for "${label}" must be a valid number`;
    if (qty <= 0) return `Quantity for "${label}" must be greater than zero`;
    if (!Number.isInteger(qty)) return `Quantity for "${label}" must be a whole number`;
    const rate = Number(it.rate);
    if (!Number.isFinite(rate)) return `Rate for "${label}" must be a valid number`;
    if (rate < 0) return `Rate for "${label}" cannot be negative`;
    const disc = Number(it.discount_percent ?? 0);
    if (!Number.isFinite(disc)) return `Discount % for "${label}" must be a valid number`;
    if (disc < 0 || disc > 100) return `Discount % for "${label}" must be between 0 and 100`;
    const tax = Number(it.tax_percent ?? 0);
    if (!Number.isFinite(tax)) return `Tax % for "${label}" must be a valid number`;
    if (tax < 0 || tax > 100) return `Tax % for "${label}" must be between 0 and 100`;
  }

  // Duplicate detection: trim + lowercased, skip empty keys, product_id wins
  const seen = new Set<string>();
  for (const it of valid) {
    const raw = (it.product_id || "").trim() ? (it.product_id as string).trim() : (it.description || "").trim();
    const key = raw.toLowerCase();
    if (!key) continue;
    if (seen.has(key)) return `Duplicate item: ${it.description || it.product_name || raw}`;
    seen.add(key);
  }

  // Discount amount vs subtotal
  if (discount_amount != null) {
    const da = Number(discount_amount);
    if (Number.isFinite(da) && da !== 0) {
      const subtotal = valid.reduce((s, it) => s + lineAmount(it), 0);
      if (da < 0) return "Discount amount cannot be negative";
      if (da > subtotal) return "Discount cannot exceed subtotal";
    }
  }

  // Discount/tax already handled isFinite above, but also ensure shipping etc. not NaN handled.

  return null;
}

// Alias for task spec naming
export const validateQuote = validateQuotation;

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

/**
 * Resolve customers by explicit ids (chunked to stay under URL / row limits).
 * Use this for name-resolution maps instead of fetching the whole customers
 * table, which Supabase silently caps at 1000 rows.
 */
export async function fetchCustomersByIds(
  ids: (string | null | undefined)[],
  columns = "*",
): Promise<Customer[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!unique.length) return [];
  const out: Customer[] = [];
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase.from("customers").select(columns).in("id", slice);
    if (error) throw error;
    out.push(...((data || []) as unknown as Customer[]));
  }
  return out;
}
