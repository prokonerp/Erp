// GST engine — pure functions used by the invoicing UI, PDF, and reports.
// Indian GST rules:
//   Same-state supply  → CGST + SGST (each half of the total GST rate)
//   Inter-state supply → IGST (full rate)

import { GSTIN_REGEX, GSTIN_STATE_CODES } from "@/lib/india";

// ── P1 Foundation — SalesType branching (docs §5.1, §7) ───────────────────
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

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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

export function computeLine(
  item: GstItemInput,
  isInterstate: boolean,
  salesType?: SalesType | string | null,
): GstItemBreakup {
  const st = String(salesType || "") as SalesType;
  // §5.1 branching: local_nil_rated → force gst 0; sez_taxable → force interstate; sez_zero_rated → force gst 0
  // H3: lock nil / zero_rated / exempt uniformly via getSupplyClass
  const supplyClass = getSupplyClass(salesType);
  const isNilOrExempt = supplyClass === "nil" || supplyClass === "exempt" || supplyClass === "zero_rated";
  const isNil = st === "local_nil_rated";
  const isZeroRated = st === "sez_zero_rated";
  const isTaxIncl = st === "local_tax_incl";
  const isSezTaxable = st === "sez_taxable";
  const effectiveInterstate = isSezTaxable ? true : isInterstate;
  let gstRate = Number(item.gst_rate) || 0;
  let cessRate = Number(item.cess_rate) || 0;
  if (isNil || isZeroRated || isNilOrExempt) {
    gstRate = 0;
    cessRate = 0;
  }

  const gross = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  const discAmt = gross * (Number(item.discount_pct) || 0) / 100;
  const netGross = gross - discAmt;

  let taxable: number;
  if (isTaxIncl) {
    // back-calc: taxable = r2(gross*100/(100+gst_rate)) — spec §7 / Table 7
    // Apply on netGross (after discount) so discount on inclusive price is correct
    taxable = gstRate === 0 ? r2(netGross) : r2((netGross * 100) / (100 + gstRate));
  } else {
    taxable = r2(netGross);
  }

  const gstAmt = r2(taxable * gstRate / 100);
  const cess = r2(taxable * cessRate / 100);
  const cgst = effectiveInterstate ? 0 : r2(gstAmt / 2);
  const sgst = effectiveInterstate ? 0 : r2(gstAmt - cgst);
  const igst = effectiveInterstate ? gstAmt : 0;
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
  salesType?: SalesType | string | null,
): GstItemBreakup[] {
  const breakups = items.map((it) => computeLine(it, isInterstate, salesType));
  const disc = r2(Number(headerDiscount) || 0);
  if (disc <= 0) return breakups;
  const subtotal = r2(breakups.reduce((s, b) => s + b.taxable_value, 0));
  if (subtotal <= 0) return breakups;
  // H1 fix: header discount must not exceed subtotal; otherwise no valid apportionment exists
  if (disc > subtotal) {
    throw new Error(`Header discount (${disc}) exceeds subtotal (${subtotal})`);
  }

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
  // H1 fix: clamp to maxPaise then redistribute truncated surplus round-robin
  // to lines with remaining capacity so Σ paise === totalPaise.
  // Test case: subtotal 101 (1 + 100), discount 50 → totalPaise 5000 apportioned; if any line clamped,
  // surplus is redistributed round-robin; discount 200 > subtotal 101 throws.
  // Edge: items [{qty:1,rate:0.02,gst_rate:18},{qty:1,rate:100,gst_rate:18}] subtotal ~100.02,
  // discount 100.02 with remainder could push small line 1 paise over max; clamped paise redistributed.
  for (let i = 0; i < paise.length; i++) {
    const maxPaise = Math.round(breakups[i].taxable_value * 100);
    if (paise[i] > maxPaise) paise[i] = maxPaise;
  }
  // Redistribute surplus truncated by clamping — round-robin to lines with capacity
  let surplus = totalPaise - paise.reduce((s, x) => s + x, 0);
  if (surplus > 0) {
    let guard = 0;
    const maxGuard = paise.length * (surplus + 1) + 10;
    while (surplus > 0 && guard < maxGuard) {
      guard++;
      let progressed = false;
      for (let i = 0; i < paise.length && surplus > 0; i++) {
        const maxPaise = Math.round(breakups[i].taxable_value * 100);
        const cap = maxPaise - paise[i];
        if (cap > 0) {
          paise[i] += 1;
          surplus -= 1;
          progressed = true;
        }
      }
      if (!progressed) break; // no capacity left
    }
    if (surplus !== 0) {
      throw new Error(`Header discount (${disc}) exceeds distributable subtotal (${subtotal}) after clamping; surplus ${surplus} paise remains`);
    }
  }

  return breakups.map((b, i) => {
    const st = String(salesType || "") as SalesType;
    const supplyClassInner = getSupplyClass(salesType);
    const isZero = st === "local_nil_rated" || st === "sez_zero_rated" || supplyClassInner === "exempt" || supplyClassInner === "nil" || supplyClassInner === "zero_rated";
    let gstRate = Number(items[i].gst_rate) || 0;
    let cessRate = Number(items[i].cess_rate) || 0;
    if (isZero) { gstRate = 0; cessRate = 0; }
    const taxable = r2(b.taxable_value - paise[i] / 100);
    const gstAmt = r2((taxable * gstRate) / 100);
    const cessAmt = r2((taxable * cessRate) / 100);
    const effInter = st === "sez_taxable" ? true : isInterstate;
    const cgst = effInter ? 0 : r2(gstAmt / 2);
    const sgst = effInter ? 0 : r2(gstAmt - cgst);
    const igst = effInter ? gstAmt : 0;
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
  salesType?: SalesType | string | null;
}): GstTotals {
  const buyerCode = args.buyerStateCode || args.placeOfSupplyStateCode || null;
  const missingState = !buyerCode;
  const rawInterstate =
    !!args.sellerStateCode && !!buyerCode && args.sellerStateCode !== buyerCode;
  // §5.1: sez_taxable forces IGST regardless of state; sez_zero_rated also interstate but rate 0
  const st = String(args.salesType || "") as SalesType;
  const isInterstate = st === "sez_taxable" || st === "sez_zero_rated" ? true : rawInterstate;
  // B-03: a header-level discount must be pushed into the line breakups so
  // that Σ(line.taxable_value) equals the invoice-level taxable value and
  // GST is computed on the post-discount amount. Without this, stored
  // invoice_items disagree with the invoice header (GSTR-1 mismatch).
  const headerDisc = r2(Number(args.headerDiscount) || 0);
  const preDiscountBreakups = args.items.map((it) => computeLine(it, isInterstate, args.salesType));
  const breakups =
    headerDisc > 0
      ? apportionHeaderDiscount(args.items, headerDisc, isInterstate, args.salesType)
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

// H15 fix — unified rate-wise summary for PDF tax table (vs hsnSummary which groups by HSN).
// invoicePdf.ts previously duplicated this logic in-line as `rateGroups` Map; now it imports this
// single source of truth so HSN and rate views cannot drift. Rounding via r2 matches hsnSummary.
export type RateRow = {
  gst_rate: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
};

export function rateSummary(
  items: Array<GstItemBreakup & { gst_rate: number; cess_rate?: number | null }>,
): RateRow[] {
  const map = new Map<number, RateRow>();
  for (const it of items) {
    const rate = Number(it.gst_rate) || 0;
    const row = map.get(rate) || { gst_rate: rate, taxable_value: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
    row.taxable_value = r2(row.taxable_value + it.taxable_value);
    row.cgst = r2(row.cgst + it.cgst);
    row.sgst = r2(row.sgst + it.sgst);
    row.igst = r2(row.igst + it.igst);
    row.cess = r2(row.cess + (it.cess || 0));
    row.total = r2(row.total + it.line_total);
    map.set(rate, row);
  }
  return Array.from(map.values()).sort((a, b) => a.gst_rate - b.gst_rate);
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

// H12 fix: integerWords handles arbitrary n with proper hundreds for crore ≥100.
// Recursively splits via Indian grouping (crore/lakh/thousand) so 100 Cr → "One Hundred Crore",
// 123 Cr → "One Hundred Twenty Three Crore", 1234 Cr → "One Thousand Two Hundred Thirty Four Crore", etc.
function integerWords(n: number): string {
  if (n === 0) return "";
  if (n < 100) return twoDigits(n);
  if (n < 1000) return threeDigits(n);
  if (n < 100000) {
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    return twoDigits(th) + " Thousand" + (r ? " " + threeDigits(r) : "");
  }
  if (n < 10000000) {
    const lakh = Math.floor(n / 100000);
    const rem = n % 100000;
    const lakhWords = lakh < 100 ? twoDigits(lakh) : lakh < 1000 ? threeDigits(lakh) : integerWords(lakh);
    return lakhWords + " Lakh" + (rem ? " " + integerWords(rem) : "");
  }
  const crore = Math.floor(n / 10000000);
  const rem = n % 10000000;
  return integerWords(crore) + " Crore" + (rem ? " " + integerWords(rem) : "");
}

export function amountInWords(n: number): string {
  if (!isFinite(n)) return "";
  const negative = n < 0;
  const abs = Math.abs(n);
  let rupees = Math.floor(abs);
  let paise = Math.round((abs - rupees) * 100);
  // rounding edge: 99.995 → 100 paise should carry to rupees
  if (paise === 100) { rupees += 1; paise = 0; }

  if (rupees === 0 && paise === 0) return "Rupees Zero Only";

  const rupeeWords = rupees === 0 ? "" : integerWords(rupees);

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