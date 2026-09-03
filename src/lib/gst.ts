// GST engine — pure functions used by the invoicing UI, PDF, and reports.
// Indian GST rules:
//   Same-state supply  → CGST + SGST (each half of the total GST rate)
//   Inter-state supply → IGST (full rate)

import { GSTIN_REGEX, GSTIN_STATE_CODES } from "@/lib/india";
import { r2 } from "@/lib/money";

export type SalesType =
  | "local_itemwise"
  | "local_multirate"
  | "local_multirate_cons"
  | "local_nil_rated"
  | "local_tax_incl"
  | "sez_taxable"
  | "sez_zero_rated";

export type SupplyClass = "nil" | "exempt" | "zero_rated" | null;

export function getSupplyClass(salesType: SalesType | string | null | undefined): SupplyClass {
  const st = String(salesType || "") as SalesType;
  if (st === "local_nil_rated") return "nil";
  if (st === "sez_zero_rated") return "zero_rated";
  return null;
}

export type GstItemInput = {
  qty: number;
  rate: number;
  discount_pct?: number;
  gst_rate: number; // percent, e.g. 18
  cess_rate?: number; // percent
};

export type GstItemBreakup = {
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  line_total: number;
};

export type GstTotals = {
  subtotal: number;
  discount: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  round_off: number;
  total: number;
  is_interstate: boolean;
  items: GstItemBreakup[];
  gstWarning?: string;
};

// r2 is imported from @/lib/money — single source of truth (re-exported for backward compat)
// Use money.ts directly for new code; gst.ts re-exports r2/r3 so existing `from "@/lib/gst"` imports keep working.
export { r3 } from "@/lib/money";
export { r2 };

export function isValidGSTIN(v: string | null | undefined): boolean {
  if (!v) return false;
  return GSTIN_REGEX.test(v.trim().toUpperCase());
}

export function stateCodeFromGSTIN(v: string | null | undefined): string | null {
  if (!v) return null;
  const c = v.trim().slice(0, 2);
  return GSTIN_STATE_CODES[c] ? c : null;
}

export function stateNameFromCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return GSTIN_STATE_CODES[code] ?? null;
}

// ── H3: shared supply-type resolver ───────────────────────────────────
// Single source of truth for intra vs inter-state determination.
// GSTIN codes win when available; free-text state names are fallback via
// GSTIN_STATE_CODES inverse. Missing buyer state → missingState + warning
// (zero tax, like computeTotals does) instead of silently assuming IGST/CGST.
// Used by both gst.ts computeTotals and crm.ts computeQuoteTotals/isIntraSupply.
//
// NOTE: GSTIN_STATE_CODES is imported from @/lib/india which itself imports
// INDIAN_STATES from @/lib/crm, forming a circular dependency (crm → gst →
// india → crm). Eagerly building the inverse map at top-level would read
// GSTIN_STATE_CODES before the cycle resolves (undefined). So we build it
// lazily on first use.
let _stateNameToCode: Record<string, string> | null = null;
function getStateNameToCode(): Record<string, string> {
  if (_stateNameToCode) return _stateNameToCode;
  _stateNameToCode = {};
  // Guard for circular-init window where GSTIN_STATE_CODES may still be undefined
  if (!GSTIN_STATE_CODES || typeof GSTIN_STATE_CODES !== "object") return _stateNameToCode;
  for (const [code, name] of Object.entries(GSTIN_STATE_CODES)) {
    _stateNameToCode[name.trim().toLowerCase()] = code;
  }
  return _stateNameToCode;
}

export function stateCodeFromStateName(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  return getStateNameToCode()[key] ?? null;
}

export type ResolveSupplyTypeOpts = {
  seller_gstin?: string | null;
  buyer_gstin?: string | null;
  business_state?: string | null;
  place_of_supply?: string | null;
  sellerStateCode?: string | null;
  buyerStateCode?: string | null;
  placeOfSupplyStateCode?: string | null;
  salesType?: SalesType | string | null;
};

export type ResolveSupplyTypeResult = {
  sellerCode: string | null;
  buyerCode: string | null;
  isInterstate: boolean;
  missingState: boolean;
  gstWarning?: string;
};

export function resolveSupplyType(opts: ResolveSupplyTypeOpts): ResolveSupplyTypeResult {
  // Seller: explicit code > GSTIN > business_state name
  const sellerCode =
    opts.sellerStateCode?.trim() ||
    (opts.seller_gstin ? stateCodeFromGSTIN(opts.seller_gstin) : null) ||
    stateCodeFromStateName(opts.business_state) ||
    null;
  // Buyer: explicit code > GSTIN > place_of_supply name > placeOfSupplyStateCode fallback
  const buyerCode =
    opts.buyerStateCode?.trim() ||
    (opts.buyer_gstin ? stateCodeFromGSTIN(opts.buyer_gstin) : null) ||
    stateCodeFromStateName(opts.place_of_supply) ||
    opts.placeOfSupplyStateCode?.trim() ||
    null;

  const missingState = !buyerCode;
  const st = String(opts.salesType || "") as SalesType;
  const rawInterstate = !!sellerCode && !!buyerCode && sellerCode !== buyerCode;
  // §5.1: sez_taxable / sez_zero_rated force interstate regardless of state
  const isInterstate = st === "sez_taxable" || st === "sez_zero_rated" ? true : rawInterstate;
  return {
    sellerCode,
    buyerCode,
    isInterstate,
    missingState,
    gstWarning: missingState ? "Buyer state / place of supply missing; GST not computed" : undefined,
  };
}

export function computeLine(
  item: GstItemInput,
  isInterstate: boolean,
): GstItemBreakup {
  const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  const discAmt = gross * (Number(item.discount_pct) || 0) / 100;
  const taxable = r2(gross - discAmt);
  const gstAmt = r2(taxable * (Number(item.gst_rate) || 0) / 100);
  const cess = r2(taxable * (Number(item.cess_rate) || 0) / 100);
  const cgst = isInterstate ? 0 : r2(gstAmt / 2);
  const sgst = isInterstate ? 0 : r2(gstAmt - cgst);
  const igst = isInterstate ? gstAmt : 0;
  return {
    taxable_value: taxable,
    cgst,
    sgst,
    igst,
    cess,
    line_total: r2(taxable + cgst + sgst + igst + cess),
  };
}

/**
 * Distribute a header-level discount across line items so that the sum of the
 * per-line taxable values equals the invoice-level taxable value (B-03).
 *
 * Without this, an invoice with a header discount saves line items whose
 * taxable_value still add up to the *undiscounted* subtotal — the printed
 * header and the stored item rows disagree, which breaks GSTR-1 item-wise
 * filing.
 *
 * The discount is shared in proportion to each line's taxable value, using
 * integer-paise largest-remainder rounding so the shares always sum to exactly
 * the header discount (no drift), and no line is discounted below zero.
 */
export function apportionHeaderDiscount(
  items: GstItemInput[],
  headerDiscount: number,
  isInterstate: boolean,
): GstItemBreakup[] {
  const breakups = items.map((it) => computeLine(it, isInterstate));
  const disc = r2(Number(headerDiscount) || 0);
  if (disc <= 0) return breakups;
  const subtotal = r2(breakups.reduce((s, b) => s + b.taxable_value, 0));
  if (subtotal <= 0) return breakups;

  const totalPaise = Math.round(disc * 100);
  const exact = breakups.map((b) => (b.taxable_value / subtotal) * totalPaise);
  const paise = exact.map((x) => Math.floor(x));
  let rem = totalPaise - paise.reduce((s, x) => s + x, 0);

  // Give leftover paise to the lines with the largest fractional remainder.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rem > 0 && order.length > 0; k++) {
    paise[order[k % order.length].i] += 1;
    rem--;
  }

  // Never discount a line below zero taxable value.
  for (let i = 0; i < paise.length; i++) {
    const maxPaise = Math.round(breakups[i].taxable_value * 100);
    if (paise[i] > maxPaise) paise[i] = maxPaise;
  }

  return breakups.map((b, i) => {
    const taxable = r2(b.taxable_value - paise[i] / 100);
    const gstAmt = r2((taxable * (Number(items[i].gst_rate) || 0)) / 100);
    const cessAmt = r2((taxable * (Number(items[i].cess_rate) || 0)) / 100);
    const cgst = isInterstate ? 0 : r2(gstAmt / 2);
    const sgst = isInterstate ? 0 : r2(gstAmt - cgst);
    const igst = isInterstate ? gstAmt : 0;
    return {
      taxable_value: taxable,
      cgst,
      sgst,
      igst,
      cess: cessAmt,
      line_total: r2(taxable + cgst + sgst + igst + cessAmt),
    };
  });
}

export function computeTotals(args: {
  sellerStateCode: string | null | undefined;
  buyerStateCode: string | null | undefined;
  items: GstItemInput[];
  headerDiscount?: number;
  roundOff?: boolean;
  placeOfSupplyStateCode?: string | null | undefined;
  salesType?: SalesType | string | null | undefined;
}): GstTotals {
  // H3: single resolver so gst.ts and crm.ts cannot diverge (GSTIN codes > state-name fallback, missing → warning)
  const resolved = resolveSupplyType({
    sellerStateCode: args.sellerStateCode,
    buyerStateCode: args.buyerStateCode,
    placeOfSupplyStateCode: args.placeOfSupplyStateCode,
    salesType: args.salesType,
  });
  const missingState = resolved.missingState;
  const isInterstate = resolved.isInterstate;
  // B-03: a header-level discount must be pushed into the line breakups so
  // that Σ(line.taxable_value) equals the invoice-level taxable value and
  // GST is computed on the post-discount amount. Without this, stored
  // invoice_items disagree with the invoice header (GSTR-1 mismatch).
  const headerDisc = r2(Number(args.headerDiscount) || 0);
  const preDiscountBreakups = args.items.map((it) => computeLine(it, isInterstate));
  const breakups =
    headerDisc > 0
      ? apportionHeaderDiscount(args.items, headerDisc, isInterstate)
      : preDiscountBreakups;
  const subtotal = r2(preDiscountBreakups.reduce((s, b) => s + b.taxable_value, 0));
  // When neither a buyer state nor a place of supply is known we must NOT
  // silently assume intra-state. Zero the tax lines and warn the caller.
  const rawCgst = r2(breakups.reduce((s, b) => s + b.cgst, 0));
  const rawSgst = r2(breakups.reduce((s, b) => s + b.sgst, 0));
  const rawIgst = r2(breakups.reduce((s, b) => s + b.igst, 0));
  const cgst = missingState ? 0 : rawCgst;
  const sgst = missingState ? 0 : rawSgst;
  const igst = missingState ? 0 : rawIgst;
  const cess = r2(breakups.reduce((s, b) => s + b.cess, 0));
  // With apportioned breakups the discounted lines already carry the header
  // discount — derive the invoice taxable value from them so header and
  // line items can never disagree (B-03).
  const taxable = r2(breakups.reduce((s, b) => s + b.taxable_value, 0));
  const gross = r2(taxable + cgst + sgst + igst + cess);
  const rounded = args.roundOff === false ? gross : Math.round(gross);
  const round_off = r2(rounded - gross);
  return {
    subtotal,
    discount: r2(headerDisc),
    taxable_value: taxable,
    cgst,
    sgst,
    igst,
    cess,
    round_off,
    total: r2(rounded),
    is_interstate: isInterstate,
    items: breakups,
    gstWarning: missingState ? "Buyer state / place of supply missing; GST not computed" : undefined,
  };
}

// HSN summary — for invoice PDF and GSTR-1.
export type HsnRow = {
  hsn: string;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
};

export function hsnSummary(
  items: Array<GstItemInput & GstItemBreakup & { hsn?: string | null }>,
): HsnRow[] {
  const map = new Map<string, HsnRow>();
  for (const it of items) {
    const key = (it.hsn || "-").trim() || "-";
    const row = map.get(key) || { hsn: key, taxable_value: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
    row.taxable_value = r2(row.taxable_value + it.taxable_value);
    row.cgst = r2(row.cgst + it.cgst);
    row.sgst = r2(row.sgst + it.sgst);
    row.igst = r2(row.igst + it.igst);
    row.cess = r2(row.cess + it.cess);
    row.total = r2(row.total + it.line_total);
    map.set(key, row);
  }
  return Array.from(map.values());
}

// Indian numbering: 12,34,567.89 → "Twelve Lakh Thirty Four Thousand …"
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return TENS[t] + (u ? " " + ONES[u] : "");
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(ONES[h] + " Hundred");
  if (r) parts.push(twoDigits(r));
  return parts.join(" ");
}

export function amountInWords(n: number): string {
  if (!isFinite(n)) return "";
  const negative = n < 0;
  const abs = Math.abs(n);
  const rupees = Math.floor(abs);
  const paise = Math.round((abs - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Rupees Zero Only";

  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;

  const parts: string[] = [];
  if (crore) parts.push(twoDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (rest) parts.push(threeDigits(rest));
  const rupeeWords = parts.join(" ");

  let out = "Rupees " + (rupeeWords || "Zero");
  if (paise) out += " and " + twoDigits(paise) + " Paise";
  out += " Only";
  return (negative ? "Minus " : "") + out;
}

export function upiPaymentUri(args: {
  upiId: string;
  payeeName: string;
  amount: number;
  note?: string;
}): string {
  const p = new URLSearchParams();
  p.set("pa", args.upiId);
  p.set("pn", args.payeeName);
  p.set("am", args.amount.toFixed(2));
  p.set("cu", "INR");
  if (args.note) p.set("tn", args.note);
  return "upi://pay?" + p.toString();
}

// Mock e-Invoice IRN + QR payload generator. Real GSP integration plugs in later
// through the same interface (see docstring in einvoice.ts).
export function mockIrnPayload(invoice: {
  invoice_no: string;
  invoice_date: string;
  seller_gstin: string | null;
  buyer_gstin: string | null;
  total: number;
}): { irn: string; ack_no: string; qr_payload: string } {
  const seed = `${invoice.invoice_no}|${invoice.invoice_date}|${invoice.total}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hex = h.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
  return {
    irn: hex,
    ack_no: String(1e12 + h).slice(0, 15),
    qr_payload: JSON.stringify({
      SellerGstin: invoice.seller_gstin,
      BuyerGstin: invoice.buyer_gstin,
      DocNo: invoice.invoice_no,
      DocTyp: "INV",
      DocDt: invoice.invoice_date,
      TotInvVal: invoice.total,
      Irn: hex,
      IrnDt: new Date().toISOString(),
    }),
  };
}