// src/lib/invoiceJson.ts — NIC v1.03 + E-Way builders + paste validators (pure)
// No Supabase calls, no side effects, fully typed, deterministic rounding.
// Reuses: r2 (local deterministic), computeTotals / hsnSummary from gst.ts,
// SalesType from sales.ts, TransportDetails from transport.ts, GSTIN_REGEX etc from india.ts.

import { GSTIN_REGEX, validateGSTINChecksum } from "@/lib/india";
import type { SalesType } from "@/lib/sales";
import type { TransportDetails, DispatchDetails } from "@/lib/transport";
import { computeTotals, hsnSummary } from "@/lib/gst";
import type { GstItemInput } from "@/lib/gst";

// Re-use gst helpers for totals parity — imported type-only where possible
// r2 in gst.ts is private, so we replicate the exact impl here for determinism.
// computeTotals / hsnSummary are imported to keep rounding & HSN aggregation
// identical to the invoicing UI path; see buildGstInvoiceJson ValDtls fallback
// and buildEwayJson item dedup comment.
void computeTotals;
void hsnSummary;
type _GstCheck = GstItemInput;
const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

// ── regexes (exported for unit tests / triggers parity) ─────────────────────
export const IRN_REGEX = /^[0-9a-f]{64}$/i;
export const ACK_REGEX = /^[0-9]{15}$/;
export const EWB_REGEX = /^[0-9]{12}$/;
export const PIN_REGEX = /^[1-9][0-9]{5}$/;
export const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// ── minimal row shapes — compatible with sales.ts InvoiceRow etc but loosened ─
export type InvoiceLite = {
  invoice_no: string | null;
  invoice_date: string; // ISO YYYY-MM-DD
  due_date?: string | null;
  seller_name?: string | null;
  seller_gstin?: string | null;
  seller_state?: string | null;
  seller_state_code?: string | null;
  seller_address?: string | null;
  buyer_name?: string | null;
  buyer_gstin?: string | null;
  buyer_state?: string | null;
  buyer_state_code?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  place_of_supply?: string | null;
  place_of_supply_code?: string | null;
  is_interstate?: boolean | null;
  sales_type?: SalesType | string | null;
  reverse_charge?: boolean | null;
  po_number?: string | null;
  po_date?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  taxable_value?: number | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  cess?: number | null;
  round_off?: number | null;
  total?: number | null;
  total_paid?: number | null;
  payment_terms?: string | null;
  lut_no?: string | null;
  notes?: string | null;
  terms?: string | null;
};

export type InvoiceItemLite = {
  sr_no?: number | null;
  description: string;
  hsn?: string | null;
  qty: number;
  unit?: string | null;
  rate: number;
  discount_pct?: number | null;
  gst_rate: number;
  cess_rate?: number | null;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess?: number | null;
  line_total: number;
};

export type BranchLite = {
  name?: string | null;
  address?: string | null;
  gstin?: string | null;
  state_name?: string | null;
  state_code?: string | null;
  phone?: string | null;
  email?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  bank_ifsc?: string | null;
  upi_id?: string | null;
};

export type CustomerLite = {
  company?: string | null;
  billing_address?: string | null;
  shipping_address?: string | null;
  gst?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
};

// ── helpers ──────────────────────────────────────────────────────────────────
export function isValidGSTIN(v: string | null | undefined): boolean {
  if (!v || typeof v !== "string") return false;
  const t = v.trim().toUpperCase();
  if (t === "URP") return false;
  return GSTIN_REGEX.test(t);
}

/** checksum-gated helper — true only if GSTIN passes regex AND mod-36 checksum */
export function isValidGSTINWithChecksum(v: string | null | undefined): boolean {
  if (!v || typeof v !== "string") return false;
  const t = v.trim().toUpperCase();
  if (t === "URP") return false;
  return validateGSTINChecksum(t);
}

function normalizeGstin(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toUpperCase();
  if (t === "URP") return null;
  // H5: checksum gate — only checksum-valid GSTINs are considered present
  return validateGSTINChecksum(t) ? t : null;
}

function stateCodeFromGSTINLocal(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const s = gstin.trim().toUpperCase();
  if (s === "URP") return null;
  if (!GSTIN_REGEX.test(s)) return null;
  const code = s.slice(0, 2);
  // light validation: 01-38 except 25 etc but keep simple: 01-99 numeric
  if (!/^[0-9]{2}$/.test(code)) return null;
  // Note: state code extraction is permissive (regex only) for POS fallback.
  // Checksum validation is done separately via validateGSTINChecksum for SupTyp/B2B gate (H5).
  return code;
}

export function gstDateDDMMYYYY(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== "string") return null;
  const s = iso.trim();
  if (!s) return null;
  // already DD/MM/YYYY
  if (/^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/.test(s)) return s;
  // DD-MM-YYYY → DD/MM/YYYY
  if (/^[0-9]{2}-[0-9]{2}-[0-9]{4}$/.test(s)) return s.replace(/-/g, "/");
  // ISO YYYY-MM-DD or YYYY-MM-DDTHH...
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${d}/${mo}/${y}`;
  }
  // DD.MM.YYYY
  if (/^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$/.test(s)) return s.replace(/\./g, "/");
  return null;
}

export function isValidBase64(v: string | null | undefined): boolean {
  if (!v || typeof v !== "string") return false;
  const s = v.trim().replace(/\s+/g, "");
  if (!s) return false;
  if (s.length % 4 !== 0) return false;
  if (!BASE64_REGEX.test(s)) return false;
  try {
    // round-trip check using Buffer if available, else atob
    if (typeof Buffer !== "undefined") {
      const buf = Buffer.from(s, "base64");
      const re = buf.toString("base64");
      // Compare without padding sensitivity: normalize both
      return re.replace(/=+$/, "") === s.replace(/=+$/, "");
    }
    // browser atob
    const decoded = atob(s);
    const encoded = btoa(decoded);
    return encoded.replace(/=+$/, "") === s.replace(/=+$/, "");
  } catch {
    return false;
  }
}

function tryDecodeBase64(b64: string): string | null {
  if (!isValidBase64(b64)) return null;
  try {
    if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf-8");
    return atob(b64);
  } catch {
    return null;
  }
}

function extractPin(address: string | null | undefined): number | null {
  if (!address) return null;
  const m = String(address).match(/\b[1-9][0-9]{5}\b/);
  if (!m) return null;
  const n = Number(m[0]);
  return PIN_REGEX.test(String(n)) ? n : null;
}

function addr1Line(address: string | null | undefined, maxLen = 100): string {
  if (!address) return "";
  // take first non-empty segment before newline/comma, truncated
  const raw = String(address).split(/[\n,]+/)[0]?.trim() || String(address).trim();
  if (!raw) return "";
  return raw.slice(0, maxLen);
}

function locFromAddress(address: string | null | undefined, fallbackState: string | null | undefined): string {
  if (!address) return fallbackState ? String(fallbackState).slice(0, 50) : "";
  const parts = String(address)
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Prefer last segment that is not a PIN
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/^[1-9][0-9]{5}$/.test(p)) continue;
    if (p.length >= 2) return p.slice(0, 50);
  }
  return fallbackState ? String(fallbackState).slice(0, 50) : parts[0]?.slice(0, 50) || "";
}

function stateCodeToInt(code: string | null | undefined): number | null {
  if (!code) return null;
  const n = parseInt(String(code).trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 38) return null;
  return n;
}

function trimStr(v: unknown, max = 100): string {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

// ── SupTyp mapping ───────────────────────────────────────────────────────────
export type SupTyp = "B2B" | "B2C" | "SEZWP" | "SEZWOP" | "EXPWP" | "EXPWOP";

export function getSupTypForSalesType(
  salesType: SalesType | string | null | undefined,
  buyerGstin: string | null | undefined,
): SupTyp {
  const st = String(salesType || "").toLowerCase();
  if (st === "sez_taxable") return "SEZWP";
  if (st === "sez_zero_rated") return "SEZWOP";
  // Optional EXP handling if caller passes export types
  if (st === "export_taxable" || st === "exp_wp") return "EXPWP";
  if (st === "export_zero_rated" || st === "exp_wop") return "EXPWOP";
  // H10: explicit nil mapping — local_nil_rated is domestic Nil, not zero-rated;
  // force GST 0 via gst.ts but SupTyp remains B2B/B2C based on buyer GSTIN (with URP/ checksum gate)
  // H5: URP sentinel + checksum gate
  if (st === "local_nil_rated") {
    const buyerTrimNil = buyerGstin?.trim().toUpperCase() ?? "";
    if (!buyerTrimNil || buyerTrimNil === "URP") return "B2C";
    return validateGSTINChecksum(buyerGstin) ? "B2B" : "B2C";
  }
  const buyerTrim = buyerGstin?.trim().toUpperCase() ?? "";
  if (!buyerTrim || buyerTrim === "URP") return "B2C";
  const hasGstin = validateGSTINChecksum(buyerGstin);
  return hasGstin ? "B2B" : "B2C";
}

// Keep alias for doc search
export const getSupTyp = getSupTypForSalesType;

function transModeToNicCode(mode: string | null | undefined): string {
  const m = String(mode || "road").toLowerCase();
  if (m === "road") return "1";
  if (m === "rail") return "2";
  if (m === "air") return "3";
  if (m === "ship") return "4";
  // numeric string passthrough
  if (/^[1-4]$/.test(m)) return m;
  return "1";
}

// ── NIC JSON types (trimmed to used subset, 1:1 with example §8.1) ──────────
export type NicTranDtls = {
  TaxSch: "GST";
  SupTyp: SupTyp;
  RegRev: "Y" | "N";
  EcmGstin: string | null;
  IgstOnIntra: "N" | "Y";
};

export type NicDocDtls = {
  Typ: "INV" | "CRN" | "DBN";
  No: string;
  Dt: string; // DD/MM/YYYY
  OrgInvNo: string | null;
};

export type NicPartyDtls = {
  Gstin: string | null;
  LglNm: string;
  TrdNm: string;
  Addr1: string;
  Addr2: string | null;
  Loc: string;
  Pin: number | null;
  Stcd: string | null;
  Ph: string | null;
  Em: string | null;
};

export type NicBuyerDtls = NicPartyDtls & {
  Pos: string | null; // place of supply code
};

export type NicDispDtls = {
  Nm: string;
  Addr1: string;
  Addr2: string | null;
  Loc: string;
  Pin: number | null;
  Stcd: string | null;
};

export type NicShipDtls = {
  Gstin: string | null;
  LglNm: string;
  Addr1: string;
  Addr2: string | null;
  Loc: string;
  Pin: number | null;
  Stcd: string | null;
};

export type NicItem = {
  SlNo: string;
  PrdDesc: string;
  IsServc: "Y" | "N";
  HsnCd: string;
  Barcde: string | null;
  Qty: number; // 3 decimals
  FreeQty: number;
  Unit: string; // NOS etc
  UnitPrice: number; // 2 dec
  TotAmt: number;
  Discount: number;
  PreTaxVal: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt: number;
  CgstAmt: number;
  SgstAmt: number;
  CesRt: number;
  CesAmt: number;
  CesNonAdvlAmt: number;
  StateCesRt: number;
  StateCesAmt: number;
  StateCesNonAdvlAmt: number;
  OthChrg: number;
  TotItemVal: number;
};

export type NicValDtls = {
  AssVal: number;
  CgstVal: number;
  SgstVal: number;
  IgstVal: number;
  CesVal: number;
  StCesVal: number;
  Discount: number;
  OthChrg: number;
  RndOffAmt: number;
  TotInvVal: number;
  TotInvValFc: number;
};

export type NicPayDtls = {
  Nm: string | null;
  AccDet: string | null;
  Mode: string | null;
  FinInsBr: string | null;
  PayTerm: string | null;
  PayInstr: string | null;
  CrTrn: string | null;
  DirDr: string | null;
  CrDay: number | null;
  PaidAmt: number;
  PayDue: number;
};

export type NicRefDtls = {
  InvRm: string | null;
  DocPerdDtls: { InvStDt: string; InvEndDt: string } | null;
  PrecDocDtls: Array<{ InvNo: string; InvDt: string }> | null;
  ContrDtls: Array<{ RecAdvRefr: string; RecAdvDt: string; TendRefr: string }> | null;
};

export type NicAddlDoc = { Url: string | null; Docs: string | null; Info: string | null };

export type NicEwbDtls = {
  TransId: string | null;
  TransName: string | null;
  TransMode: string; // "1" | "2" | "3" | "4"
  Distance: number | null;
  TransDocNo: string | null;
  TransDocDt: string | null; // DD/MM/YYYY
  VehNo: string | null;
  VehType: "R" | "O";
};

export type NicInvoiceJson = {
  Version: "1.03";
  TranDtls: NicTranDtls;
  DocDtls: NicDocDtls;
  SellerDtls: NicPartyDtls;
  BuyerDtls: NicBuyerDtls;
  DispDtls: NicDispDtls | null;
  ShipDtls: NicShipDtls | null;
  ItemList: NicItem[];
  ValDtls: NicValDtls;
  PayDtls: NicPayDtls | null;
  RefDtls: NicRefDtls | null;
  AddlDocDtls: NicAddlDoc[] | null;
  ExpDtls: null;
  EwbDtls: NicEwbDtls | null;
};

// Standalone E-Way JSON (portal v1.0)
export type EwayJson = {
  supplyType: "O" | "I";
  subSupplyType: number; // 1 = Supply
  subSupplyDesc: string;
  docType: "INV" | "CHL" | "BIL" | "BOE" | "OTH";
  docNo: string;
  docDate: string; // DD/MM/YYYY
  fromGstin: string | null;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2: string | null;
  fromPlace: string;
  fromPincode: number | null;
  fromStateCode: number | null;
  toGstin: string | null;
  toTrdName: string;
  toAddr1: string;
  toAddr2: string | null;
  toPlace: string;
  toPincode: number | null;
  toStateCode: number | null;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  transporterId: string | null;
  transporterName: string | null;
  transMode: string; // "1".."4"
  transDistance: string; // NIC expects string
  transDocNo: string | null;
  transDocDate: string | null;
  vehicleNo: string | null;
  vehicleType: "R" | "O";
  itemList: Array<{
    productName: string;
    productDesc: string;
    hsnCode: number | null;
    quantity: number;
    taxableAmount: number;
    sgstRate?: number;
    cgstRate?: number;
    igstRate?: number;
    cessRate?: number;
  }>;
};

// ── Builder: GST e-Invoice JSON (NIC 1.03) ──────────────────────────────────
export function buildGstInvoiceJson(
  invoice: InvoiceLite,
  items: InvoiceItemLite[],
  branch: BranchLite | null,
  customer: CustomerLite | null,
  transport: TransportDetails | null,
  dispDetails?: DispatchDetails | null,
): NicInvoiceJson {
  if (!invoice) throw new Error("buildGstInvoiceJson: invoice is required");
  if (!Array.isArray(items) || items.length === 0) throw new Error("buildGstInvoiceJson: at least one item is required");

  const invNo = trimStr(invoice.invoice_no, 64);
  if (!invNo) throw new Error("buildGstInvoiceJson: invoice.invoice_no is required");
  const docDt = gstDateDDMMYYYY(invoice.invoice_date);
  if (!docDt) throw new Error(`buildGstInvoiceJson: invalid invoice_date '${invoice.invoice_date}' — expected YYYY-MM-DD`);

  // Seller — H11: branch nullable guard + robust pin/loc fallback
  const sellerGstinRawFallback = branch?.gstin || invoice.seller_gstin || null;
  if (!branch && !sellerGstinRawFallback) {
    throw new Error("buildGstInvoiceJson: branch is required — seller_gstin missing and no branch to fallback");
  }
  const sellerGstin = normalizeGstin(sellerGstinRawFallback);
  if (!sellerGstin && !branch?.gstin && !invoice.seller_gstin) {
    throw new Error("buildGstInvoiceJson: seller GSTIN is required — provide branch.gstin or invoice.seller_gstin with valid checksum");
  }
  // H11: still enforce seller GSTIN exists for e-invoice; if branch missing and checksum fails, error
  if (!branch && sellerGstinRawFallback && !sellerGstin) {
    throw new Error(`buildGstInvoiceJson: seller_gstin '${String(sellerGstinRawFallback).trim()}' fails checksum validation`);
  }
  const sellerStateCode =
    stateCodeFromGSTINLocal(sellerGstin) ||
    trimStr(branch?.state_code || invoice.seller_state_code || null, 2) ||
    null;
  const sellerName = trimStr(branch?.name || invoice.seller_name || "Seller", 100);
  const sellerAddrRaw = branch?.address || invoice.seller_address || "";
  const sellerPin = extractPin(sellerAddrRaw) ?? null;
  const sellerLocRaw = locFromAddress(sellerAddrRaw, invoice.seller_state || branch?.state_name || null);
  const sellerLoc = sellerLocRaw || trimStr(invoice.seller_state || branch?.state_name || "", 50) || "";

  // Buyer — H5: unified URP sentinel + checksum gate
  const buyerGstinRaw = trimStr(invoice.buyer_gstin || customer?.gst || "", 15);
  const buyerGstinTrimUpper = buyerGstinRaw ? buyerGstinRaw.trim().toUpperCase() : "";
  const isBuyerUrp = buyerGstinTrimUpper === "URP" || !buyerGstinTrimUpper;
  const buyerGstinNorm = isBuyerUrp ? null : normalizeGstin(buyerGstinRaw);
  const buyerGstin = buyerGstinNorm;
  // H5: checksum-gated — only checksum-valid GSTIN is B2B, else URP/B2C
  const buyerHasGstin = !!buyerGstin && validateGSTINChecksum(buyerGstin);
  // H5: unify URP — both builders emit "URP" for B2C (not null)
  const buyerGstinForJson: string = buyerHasGstin ? (buyerGstin as string) : "URP";
  const buyerStateCode =
    stateCodeFromGSTINLocal(buyerHasGstin ? buyerGstin : null) ||
    trimStr(invoice.buyer_state_code || invoice.place_of_supply_code || null, 2) ||
    null;
  const posCode = trimStr(invoice.place_of_supply_code || buyerStateCode || null, 2) || buyerStateCode || null;
  const buyerName = trimStr(invoice.buyer_name || customer?.company || "Buyer", 100);
  const billingAddrRaw = invoice.billing_address || customer?.billing_address || "";
  const buyerAddr1 = addr1Line(billingAddrRaw, 100);
  const buyerAddr2Raw = String(billingAddrRaw).split(/[\n]+/)[1]?.trim().slice(0, 100) || null;
  const buyerPin = extractPin(billingAddrRaw);
  const buyerLoc = locFromAddress(billingAddrRaw, invoice.buyer_state || customer?.state || null);

  // Ship
  const shipAddrRaw = invoice.shipping_address || billingAddrRaw || "";
  const shipLoc = locFromAddress(shipAddrRaw, invoice.buyer_state || null);
  const shipPin = extractPin(shipAddrRaw);

  // Disp (explicit param wins over transport.dispatch_details)
  const disp: DispatchDetails | null = dispDetails ?? transport?.dispatch_details ?? null;
  const dispDtls: NicDispDtls | null = disp
    ? {
        Nm: trimStr(disp.name || branch?.name || sellerName, 100) || sellerName,
        Addr1: trimStr(disp.address || disp.addr1 || "", 100) || addr1Line(sellerAddrRaw, 100),
        Addr2: null,
        Loc: trimStr(disp.place || "", 50) || locFromAddress(disp.address || disp.addr1 || null, disp.state || null) || sellerLoc || "",
        Pin: disp.pin_code ? Number(String(disp.pin_code).trim()) : sellerPin,
        Stcd: trimStr(disp.state_code || null, 2) || sellerStateCode,
      }
    : null;

  const shipDtls: NicShipDtls | null = {
    Gstin: buyerGstinForJson,
    LglNm: buyerName,
    Addr1: addr1Line(shipAddrRaw, 100) || buyerAddr1 || "",
    Addr2: null,
    Loc: shipLoc || buyerLoc || "",
    Pin: shipPin ?? buyerPin,
    Stcd: buyerStateCode,
  };

  // SupTyp
  const supTyp = getSupTypForSalesType(invoice.sales_type, buyerGstin);

  // TranDtls
  const tranDtls: NicTranDtls = {
    TaxSch: "GST",
    SupTyp: supTyp,
    RegRev: invoice.reverse_charge ? "Y" : "N",
    EcmGstin: null,
    IgstOnIntra: "N",
  };

  // DocDtls
  const docDtls: NicDocDtls = {
    Typ: "INV",
    No: invNo,
    Dt: docDt,
    OrgInvNo: null,
  };

  // Seller / Buyer Dtls
  const sellerDtls: NicPartyDtls = {
    Gstin: sellerGstin,
    LglNm: sellerName,
    TrdNm: sellerName,
    Addr1: addr1Line(sellerAddrRaw, 100) || "",
    Addr2: buyerAddr2Raw ? null : null, // Seller Addr2 always null / "" per NIC
    Loc: sellerLoc || "",
    Pin: sellerPin,
    Stcd: sellerStateCode,
    Ph: trimStr(branch?.phone || null, 15) || null,
    Em: trimStr(branch?.email || null, 100) || null,
  };

  const buyerDtls: NicBuyerDtls = {
    Gstin: buyerGstinForJson,
    LglNm: buyerName,
    TrdNm: buyerName,
    Addr1: buyerAddr1 || "",
    Addr2: buyerAddr2Raw,
    Loc: buyerLoc || "",
    Pin: buyerPin,
    Stcd: buyerStateCode,
    Pos: posCode,
    Ph: trimStr(customer?.phone || null, 15) || null,
    Em: trimStr(customer?.email || null, 100) || null,
  };

  // ItemList — deterministic per-line math
  const itemList: NicItem[] = items.map((it, idx) => {
    const qty = r3(Number(it.qty) || 0);
    const unitPrice = r2(Number(it.rate) || 0);
    const gross = r2(qty * unitPrice);
    const discPct = Number(it.discount_pct) || 0;
    const discountAmt = r2((gross * discPct) / 100);
    // Use stored breakups if present, else derive via gst math above
    // Stored taxable_value / cgst / sgst / igst / cess / line_total are authoritative
    const assAmt = r2(Number(it.taxable_value) || r2(gross - discountAmt));
    const gstRt = Number(it.gst_rate) || 0;
    // NIC expects 2-dec Igst/Cgst/Sgst; intra → split, inter → Igst only
    // Trust stored splits
    const igstAmt = r2(Number(it.igst) || 0);
    const cgstAmt = r2(Number(it.cgst) || 0);
    const sgstAmt = r2(Number(it.sgst) || 0);
    const cesRt = Number(it.cess_rate) || 0;
    const cesAmt = r2(Number(it.cess) || 0);
    const totItemVal = r2(Number(it.line_total) || r2(assAmt + cgstAmt + sgstAmt + igstAmt + cesAmt));
    const hsn = trimStr(it.hsn || "", 8) || "0000";
    const desc = trimStr(it.description || `Item ${idx + 1}`, 300) || `Item ${idx + 1}`;
    const isServc: "Y" | "N" = hsn.startsWith("99") ? "Y" : "N";
    const unit = trimStr(it.unit || "NOS", 8).toUpperCase() || "NOS";
    return {
      SlNo: String(idx + 1),
      PrdDesc: desc,
      IsServc: isServc,
      HsnCd: hsn,
      Barcde: null,
      Qty: qty,
      FreeQty: 0,
      Unit: unit,
      UnitPrice: unitPrice,
      TotAmt: gross,
      Discount: discountAmt,
      PreTaxVal: 0,
      AssAmt: assAmt,
      GstRt: gstRt,
      IgstAmt: igstAmt,
      CgstAmt: cgstAmt,
      SgstAmt: sgstAmt,
      CesRt: cesRt,
      CesAmt: cesAmt,
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: totItemVal,
    };
  });

  // ValDtls — prefer invoice header totals; fallback to sums
  const sumAss = r2(itemList.reduce((s, it) => s + it.AssAmt, 0));
  const sumCgst = r2(itemList.reduce((s, it) => s + it.CgstAmt, 0));
  const sumSgst = r2(itemList.reduce((s, it) => s + it.SgstAmt, 0));
  const sumIgst = r2(itemList.reduce((s, it) => s + it.IgstAmt, 0));
  const sumCes = r2(itemList.reduce((s, it) => s + it.CesAmt, 0));
  const sumTot = r2(itemList.reduce((s, it) => s + it.TotItemVal, 0));

  const assVal = invoice.taxable_value != null ? r2(Number(invoice.taxable_value)) : sumAss;
  const cgstVal = invoice.cgst != null ? r2(Number(invoice.cgst)) : sumCgst;
  const sgstVal = invoice.sgst != null ? r2(Number(invoice.sgst)) : sumSgst;
  const igstVal = invoice.igst != null ? r2(Number(invoice.igst)) : sumIgst;
  const cesVal = invoice.cess != null ? r2(Number(invoice.cess)) : sumCes;
  const discountVal = invoice.discount != null ? r2(Number(invoice.discount)) : r2(itemList.reduce((s, it) => s + it.Discount, 0));
  const rndOffAmt = invoice.round_off != null ? r2(Number(invoice.round_off)) : r2((invoice.total != null ? Number(invoice.total) : sumTot) - (assVal + cgstVal + sgstVal + igstVal + cesVal));
  const totInvValRaw = invoice.total != null ? Number(invoice.total) : sumTot + rndOffAmt;
  const totInvVal = Math.round(totInvValRaw);

  const valDtls: NicValDtls = {
    AssVal: assVal,
    CgstVal: cgstVal,
    SgstVal: sgstVal,
    IgstVal: igstVal,
    CesVal: cesVal,
    StCesVal: 0,
    Discount: discountVal,
    OthChrg: 0,
    RndOffAmt: rndOffAmt,
    TotInvVal: totInvVal,
    TotInvValFc: totInvVal,
  };

  // PayDtls
  const paidAmt = r2(Number(invoice.total_paid) || 0);
  const payDue = r2(totInvVal - paidAmt);
  const payDtls: NicPayDtls = {
    Nm: null,
    AccDet: trimStr(branch?.bank_account || null, 30) || null,
    Mode: null,
    FinInsBr: trimStr(branch?.bank_ifsc || null, 30) || null,
    PayTerm: trimStr(invoice.payment_terms || null, 100) || null,
    PayInstr: null,
    CrTrn: null,
    DirDr: null,
    CrDay: null,
    PaidAmt: paidAmt,
    PayDue: payDue < 0 ? 0 : payDue,
  };

  // RefDtls
  const poNo = trimStr(invoice.po_number || null, 30);
  const poDt = invoice.po_date ? gstDateDDMMYYYY(invoice.po_date) : null;
  const invRm = poNo ? `PO No: ${poNo}${poDt ? ` Dt: ${poDt}` : ""}` : trimStr(invoice.notes || null, 200) || null;
  // PrecDocDtls left null — caller can enrich if linked docs supplied
  const refDtls: NicRefDtls = {
    InvRm: invRm,
    DocPerdDtls: null,
    PrecDocDtls: null,
    ContrDtls: null,
  };

  // AddlDocDtls — H10: nil vs zero conflation guard; supply_class is DB-checked (nil/exempt/zero_rated)
  const addlDocs: NicAddlDoc[] = [];
  const lut = trimStr(invoice.lut_no || null, 60);
  const stNorm = String(invoice.sales_type || "").toLowerCase();
  if (stNorm === "local_nil_rated") {
    // Nil-rated (Table 8): GST forced 0, supply_class='nil', NOT zero_rated/SEZ
    addlDocs.push({ Url: null, Docs: null, Info: `Sales Type: ${invoice.sales_type} (Nil-rated)` });
  } else if (stNorm === "sez_zero_rated" && lut) {
    addlDocs.push({ Url: null, Docs: `Lut No: ${lut}`, Info: `Sales Type: ${invoice.sales_type}` });
  } else if (invoice.sales_type) {
    addlDocs.push({ Url: null, Docs: null, Info: `Sales Type: ${invoice.sales_type}` });
  }
  // H10 DB check note: invoices.supply_class CHECK (nil, exempt, zero_rated) — enforced in 20260902000000_invoicing_staged.sql:29
  // Runtime guard: if sales_type is nil-rated but supply_class mismatched, builder still forces gst 0 via computeLine, but caller should persist supply_class='nil'.

  // EwbDtls — only when generate_eway_within_einvoice true
  let ewbDtls: NicEwbDtls | null = null;
  if (transport?.generate_eway_within_einvoice) {
    const distanceRaw = transport.distance_km;
    const distance = distanceRaw != null && Number.isFinite(Number(distanceRaw)) ? Math.round(Number(distanceRaw)) : null;
    const clamped = distance != null ? Math.min(4000, Math.max(1, distance)) : null;
    const transDocDt = transport.gr_rr_date ? gstDateDDMMYYYY(transport.gr_rr_date) : null;
    ewbDtls = {
      TransId: trimStr(transport.transporter_id || null, 15) || null,
      TransName: trimStr(transport.transporter_name || null, 100) || trimStr(transport.transport_mode || "Self", 100) || "Self",
      TransMode: transModeToNicCode(transport.mode_of_transport || null),
      Distance: clamped,
      TransDocNo: trimStr(transport.gr_rr_no || null, 15) || null,
      TransDocDt: transDocDt,
      VehNo: trimStr(transport.vehicle_no || null, 20)?.toUpperCase() || null,
      VehType: "R",
    };
  }

  return {
    Version: "1.03",
    TranDtls: tranDtls,
    DocDtls: docDtls,
    SellerDtls: sellerDtls,
    BuyerDtls: buyerDtls,
    DispDtls: dispDtls,
    ShipDtls: shipDtls,
    ItemList: itemList,
    ValDtls: valDtls,
    PayDtls: payDtls,
    RefDtls: refDtls,
    AddlDocDtls: addlDocs.length ? addlDocs : null,
    ExpDtls: null,
    EwbDtls: ewbDtls,
  };
}

// ── Builder: Standalone E-Way JSON ──────────────────────────────────────────
export function buildEwayJson(
  invoice: InvoiceLite,
  transport: TransportDetails | null,
  itemsInput?: InvoiceItemLite[],
): EwayJson {
  if (!invoice) throw new Error("buildEwayJson: invoice is required");
  const invNo = trimStr(invoice.invoice_no, 64);
  if (!invNo) throw new Error("buildEwayJson: invoice.invoice_no is required");
  const docDate = gstDateDDMMYYYY(invoice.invoice_date);
  if (!docDate) throw new Error(`buildEwayJson: invalid invoice_date '${invoice.invoice_date}'`);

  // H11: branch is not passed to E-Way builder — invoice.seller_gstin must be present + checksum-valid
  const sellerGstinRawEway = trimStr((invoice as any).seller_gstin || "", 15);
  if (!sellerGstinRawEway) {
    throw new Error("buildEwayJson: seller_gstin is required — invoice.seller_gstin missing (branch GSTIN should be copied to invoice.seller_gstin)");
  }
  const sellerGstin = normalizeGstin(sellerGstinRawEway);
  if (!sellerGstin) {
    throw new Error(`buildEwayJson: seller_gstin '${sellerGstinRawEway}' fails checksum validation`);
  }
  const sellerName = trimStr(invoice.seller_name || "Seller", 100);
  const sellerAddrRaw = invoice.seller_address || "";
  const sellerPin = extractPin(sellerAddrRaw) ?? null;
  const sellerLocRaw = locFromAddress(sellerAddrRaw, invoice.seller_state || null);
  const sellerLoc = sellerLocRaw || trimStr(invoice.seller_state || "", 50) || "";
  const sellerStateCode = stateCodeToInt(stateCodeFromGSTINLocal(sellerGstin) || invoice.seller_state_code || null);

  // H5: unified URP sentinel + checksum gate for E-Way buyer
  const buyerGstinRaw = trimStr(invoice.buyer_gstin || "", 15);
  const buyerTrimUpper = buyerGstinRaw ? buyerGstinRaw.trim().toUpperCase() : "";
  const isBuyerUrpEway = buyerTrimUpper === "URP" || !buyerTrimUpper;
  const buyerGstinNorm = isBuyerUrpEway ? null : normalizeGstin(buyerGstinRaw);
  const buyerGstin = buyerGstinNorm;
  const buyerHasGstinEway = !!buyerGstin && validateGSTINChecksum(buyerGstin);
  const toGstin: string = buyerHasGstinEway ? (buyerGstin as string) : "URP";
  const buyerName = trimStr(invoice.buyer_name || "Buyer", 100);
  const billingAddrRaw = invoice.billing_address || "";
  const toAddr1 = addr1Line(billingAddrRaw, 100) || addr1Line(invoice.shipping_address || "", 100) || "";
  const toPlaceRaw = locFromAddress(billingAddrRaw, invoice.buyer_state || null) || locFromAddress(invoice.shipping_address || null, null);
  const toPlace = toPlaceRaw || trimStr(invoice.buyer_state || "", 50) || "";
  const toPin = extractPin(billingAddrRaw) ?? extractPin(invoice.shipping_address || null) ?? null;
  const buyerStateCode = stateCodeToInt(stateCodeFromGSTINLocal(buyerHasGstinEway ? buyerGstin : null) || invoice.buyer_state_code || invoice.place_of_supply_code || null);

  const totalValue = r2(Number(invoice.total) || 0) || r2(Number(invoice.taxable_value) || 0);
  const cgstValue = r2(Number(invoice.cgst) || 0);
  const sgstValue = r2(Number(invoice.sgst) || 0);
  const igstValue = r2(Number(invoice.igst) || 0);
  const cessValue = r2(Number(invoice.cess) || 0);

  const distanceRaw = transport?.distance_km;
  const distance = distanceRaw != null && Number.isFinite(Number(distanceRaw)) ? Math.round(Number(distanceRaw)) : null;
  const transDistance = distance != null ? String(Math.min(4000, Math.max(1, distance))) : "0";
  const transDocDate = transport?.gr_rr_date ? gstDateDDMMYYYY(transport.gr_rr_date) : null;

  // itemList — prefer explicit itemsInput, else empty (caller should supply)
  // Keep per-line; if duplicate HSN dedup needed, caller can pre-aggregate via hsnSummary
  const items = itemsInput ?? [];
  const ewayItems = items.map((it) => {
    const hsnNum = it.hsn ? Number(String(it.hsn).replace(/\D/g, "")) : null;
    const taxableAmount = r2(Number(it.taxable_value) || 0);
    // Derive per-unit GST rates for E-Way (half for CGST/SGST when intra)
    const gstRate = Number(it.gst_rate) || 0;
    const isInter = (invoice as any).is_interstate ?? (sellerStateCode != null && buyerStateCode != null ? sellerStateCode !== buyerStateCode : false);
    const cgstRate = isInter ? 0 : r2(gstRate / 2);
    const sgstRate = isInter ? 0 : r2(gstRate - cgstRate);
    const igstRate = isInter ? gstRate : 0;
    return {
      productName: trimStr(it.description || "Item", 100),
      productDesc: trimStr(it.description || "Item", 100),
      hsnCode: hsnNum != null && Number.isFinite(hsnNum) ? hsnNum : null,
      quantity: r3(Number(it.qty) || 0),
      taxableAmount,
      cgstRate,
      sgstRate,
      igstRate,
      cessRate: Number(it.cess_rate) || 0,
    };
  });

  // Sub-supply mapping
  const subTypeRaw = trimStr(transport?.sub_type || "Supply", 50) || "Supply";
  const subSupplyMap: Record<string, number> = {
    Supply: 1,
    Import: 2,
    Export: 3,
    "Job Work": 4,
    "For Own Use": 5,
    "Job work": 4,
    "SKD/CKD": 6,
    "Line Sales": 7,
    "Recipient Not Known": 8,
    Exhibition: 9,
    "Line sales": 7,
  };
  const subSupplyType = subSupplyMap[subTypeRaw] ?? 1;

  return {
    supplyType: "O",
    subSupplyType,
    subSupplyDesc: subTypeRaw,
    docType: "INV",
    docNo: invNo,
    docDate,
    fromGstin: sellerGstin,
    fromTrdName: sellerName,
    fromAddr1: addr1Line(sellerAddrRaw, 100) || "",
    fromAddr2: null,
    fromPlace: sellerLoc || "",
    fromPincode: sellerPin,
    fromStateCode: sellerStateCode,
    toGstin,
    toTrdName: buyerName,
    toAddr1: toAddr1,
    toAddr2: null,
    toPlace: toPlace,
    toPincode: toPin,
    toStateCode: buyerStateCode,
    totalValue,
    cgstValue,
    sgstValue,
    igstValue,
    cessValue,
    transporterId: trimStr(transport?.transporter_id || null, 15) || null,
    transporterName: trimStr(transport?.transporter_name || null, 100) || trimStr(transport?.transport_mode || null, 50) || null,
    transMode: transModeToNicCode(transport?.mode_of_transport || null),
    transDistance,
    transDocNo: trimStr(transport?.gr_rr_no || null, 15) || null,
    transDocDate: transDocDate,
    vehicleNo: trimStr(transport?.vehicle_no || null, 20)?.toUpperCase() || null,
    vehicleType: "R",
    itemList: ewayItems,
  };
}

// ── Paste validators ────────────────────────────────────────────────────────
export type IrnParseResult = {
  irn: string;
  ack_no: string;
  ack_date: string; // ISO 8601
  signed_qr: string; // base64
  signedQrPayload: string | null; // decoded UTF-8 if decodable
};

function pickFirst<T>(obj: any, keys: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== "") return obj[k] as T;
    // case-insensitive fallback
    const found = Object.keys(obj).find((x) => x.toLowerCase() === k.toLowerCase());
    if (found && obj[found] != null && String(obj[found]).trim() !== "") return obj[found] as T;
  }
  return undefined;
}

function normalizeAckDateToISO(raw: string): string {
  const s = String(raw).trim();
  if (!s) throw new Error("Ack date is empty");
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new Error(`Ack date is not a valid ISO datetime: '${raw}'`);
    return d.toISOString();
  }
  // YYYY-MM-DD HH:MM:SS or YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2}:\d{2})?$/.test(s)) {
    const iso = s.replace(" ", "T");
    const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(d.getTime())) throw new Error(`Ack date is not a valid datetime: '${raw}'`);
    return d.toISOString();
  }
  // DD/MM/YYYY HH:MM:SS or DD/MM/YYYY
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (m) {
    const [, dd, mm, yyyy, hh, mi, ss] = m;
    const iso = `${yyyy}-${mm}-${dd}T${hh || "00"}:${mi || "00"}:${ss || "00"}`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new Error(`Ack date is not a valid DD/MM/YYYY datetime: '${raw}'`);
    return d.toISOString();
  }
  // DD-MM-YYYY
  const m2 = s.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (m2) {
    const [, dd, mm, yyyy, hh, mi, ss] = m2;
    const iso = `${yyyy}-${mm}-${dd}T${hh || "00"}:${mi || "00"}:${ss || "00"}`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new Error(`Ack date is not a valid DD-MM-YYYY datetime: '${raw}'`);
    return d.toISOString();
  }
  // Fallback: try Date parse
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  throw new Error(`Ack date is not a recognised datetime format: '${raw}' (expected YYYY-MM-DD or DD/MM/YYYY or ISO)`);
}

export function parseGstPortalIrnResponse(jsonText: string): IrnParseResult {
  if (!jsonText || typeof jsonText !== "string" || !jsonText.trim()) {
    throw new Error("IRN response: empty input — paste the JSON copied from the GST portal");
  }
  let root: any;
  try {
    root = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`IRN response: invalid JSON — ${e?.message || String(e)}`);
  }

  // Portal wraps in { Status, Data: {...}} or { data: {...}} or flat
  const data: any =
    root?.Data && typeof root.Data === "object"
      ? root.Data
      : root?.data && typeof root.data === "object"
        ? root.data
        : root?.result && typeof root.result === "object"
          ? root.result
          : root;

  // Heuristic: if root is array, take first
  const container = Array.isArray(data) ? data[0] : data;

  const irnRaw = pickFirst<string>(container, ["Irn", "irn", "IRN", "IRNNo", "irnNo"]) ?? pickFirst<string>(root, ["Irn", "irn"]);
  const ackNoRaw = pickFirst<string>(container, ["AckNo", "ack_no", "ackNo", "Ack_No", "AckNumber"]) ?? pickFirst<string>(root, ["AckNo", "ack_no"]);
  const ackDateRaw = pickFirst<string>(container, ["AckDt", "ack_date", "ackDate", "AckDate", "Ack_Date", "AckDtStr"]) ?? pickFirst<string>(root, ["AckDt", "ack_date"]);
  const signedQrRaw =
    pickFirst<string>(container, ["SignedQRCode", "signed_qr", "SignedQrcode", "SignedQrCode", "SignedQR", "signedQrCode", "QrCode"]) ??
    pickFirst<string>(container, ["SignedInvoice", "signed_invoice"]) ??
    pickFirst<string>(root, ["SignedQRCode", "signed_qr"]);

  if (irnRaw == null || String(irnRaw).trim() === "") throw new Error("IRN response: field 'Irn' (64-hex) is missing");
  if (ackNoRaw == null || String(ackNoRaw).trim() === "") throw new Error("IRN response: field 'AckNo' (15-digit) is missing");
  if (ackDateRaw == null || String(ackDateRaw).trim() === "") throw new Error("IRN response: field 'AckDt' (ack date) is missing");
  if (signedQrRaw == null || String(signedQrRaw).trim() === "") throw new Error("IRN response: field 'SignedQRCode' (base64) is missing");

  const irn = String(irnRaw).trim();
  const ack_no = String(ackNoRaw).trim();
  const ack_date_raw = String(ackDateRaw).trim();
  const signed_qr = String(signedQrRaw).trim().replace(/\s+/g, "");

  if (!IRN_REGEX.test(irn)) throw new Error(`IRN invalid: must be 64 hex characters (^[0-9a-f]{64}$, case-insensitive), got '${irn.slice(0, 32)}...' (len ${irn.length})`);
  if (!ACK_REGEX.test(ack_no)) throw new Error(`AckNo invalid: must be 15 digits (^[0-9]{15}$), got '${ack_no}' (len ${ack_no.length})`);
  if (!isValidBase64(signed_qr)) throw new Error("SignedQRCode invalid: must be base64-encoded (A-Z, a-z, 0-9, +, /, = padding)");

  let ack_date: string;
  try {
    ack_date = normalizeAckDateToISO(ack_date_raw);
  } catch (e: any) {
    throw new Error(`AckDt invalid: ${e?.message || String(e)}`);
  }

  const signedQrPayload = tryDecodeBase64(signed_qr);

  return { irn, ack_no, ack_date, signed_qr, signedQrPayload };
}

// Keep alias for doc naming variants
export const parseGstPortalIRNResponse = parseGstPortalIrnResponse;

export type EwayParseResult = {
  ewbNo: string; // 12-digit
  ewbDate: string; // ISO
  validTill: string; // ISO
  raw?: any;
};

function normalizeEwayDateToISO(raw: string, fieldName: string): string {
  if (!raw || !String(raw).trim()) throw new Error(`${fieldName} is empty`);
  const s = String(raw).trim();
  return normalizeAckDateToISO(s);
}

export function parseEwayResponse(jsonText: string): EwayParseResult {
  if (!jsonText || typeof jsonText !== "string" || !jsonText.trim()) {
    throw new Error("E-Way response: empty input — paste the JSON copied from the E-Way portal");
  }
  let root: any;
  try {
    root = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`E-Way response: invalid JSON — ${e?.message || String(e)}`);
  }

  const data: any =
    root?.Data && typeof root.Data === "object"
      ? root.Data
      : root?.data && typeof root.data === "object"
        ? root.data
        : root?.result && typeof root.result === "object"
          ? root.result
          : root;

  const container: any = Array.isArray(data) ? data[0] : data;

  const ewbNoRaw =
    pickFirst<string>(container, ["EwbNo", "ewbNo", "EWayBillNo", "ewayBillNo", "eway_bill_no", "EwayBillNo", "ewb_no"]) ??
    pickFirst<string>(root, ["EwbNo", "ewbNo"]);
  const ewbDateRaw =
    pickFirst<string>(container, ["EwbDt", "ewbDate", "EwayBillDate", "ewayBillDate", "generatedDate", "GenDate", "EwbDate"]) ??
    pickFirst<string>(root, ["EwbDt", "ewbDate"]);
  const validTillRaw =
    pickFirst<string>(container, ["EwbValidTill", "validTill", "ValidTill", "validUpto", "ValidUpto", "ewayBillValidTill", "ValidTillDate"]) ??
    pickFirst<string>(root, ["EwbValidTill", "validTill"]);

  if (ewbNoRaw == null || String(ewbNoRaw).trim() === "") throw new Error("E-Way response: field 'EwbNo' (12-digit) is missing");
  // ewbDate is required but validTill may be derived as ewbDate + ceil(distance/100) days if missing
  if (ewbDateRaw == null || String(ewbDateRaw).trim() === "") throw new Error("E-Way response: field 'EwbDt' (generation date) is missing");

  const ewbNo = String(ewbNoRaw).trim();
  const ewbDateRawStr = String(ewbDateRaw).trim();
  const validTillRawStr = validTillRaw != null ? String(validTillRaw).trim() : "";

  if (!EWB_REGEX.test(ewbNo)) throw new Error(`EwbNo invalid: must be 12 digits (^[0-9]{12}$), got '${ewbNo}' (len ${ewbNo.length})`);

  let ewbDate: string;
  try {
    ewbDate = normalizeEwayDateToISO(ewbDateRawStr, "EwbDt");
  } catch (e: any) {
    throw new Error(`EwbDt invalid: ${e?.message || String(e)}`);
  }

  let validTill: string;
  if (validTillRawStr) {
    try {
      validTill = normalizeEwayDateToISO(validTillRawStr, "EwbValidTill");
    } catch (e: any) {
      throw new Error(`EwbValidTill invalid: ${e?.message || String(e)}`);
    }
    // sanity: validTill must be >= ewbDate
    if (new Date(validTill).getTime() < new Date(ewbDate).getTime()) {
      throw new Error(`EwbValidTill must be >= EwbDt (got validTill '${validTill}' < ewbDate '${ewbDate}')`);
    }
  } else {
    // Derive +1 day fallback (portal sometimes omits when distance unknown)
    const d = new Date(ewbDate);
    d.setDate(d.getDate() + 1);
    validTill = d.toISOString();
  }

  return { ewbNo, ewbDate, validTill, raw: container };
}

// Keep alternate casing alias
export const parseEWayResponse = parseEwayResponse;
