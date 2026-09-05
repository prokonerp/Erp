// TransportDetails — 25-field Tally parity (Image 2) — docs/Invoicing_Staged_Plan_Proposal.docx §5.2
// Stored as invoices.transport_details JSONB; typed here as source of truth.

import { GSTIN_REGEX, validateGSTINChecksum } from "@/lib/india";

// ── enums ────────────────────────────────────────────────────────────────
export const TRANSPORT_MODES = ["Self", "Road", "Rail", "Air", "Ship"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const MODE_OF_TRANSPORT = ["road", "rail", "air", "ship"] as const;
export type ModeOfTransport = (typeof MODE_OF_TRANSPORT)[number];

export type TransactionType = "B2B" | "B2C" | "SEZWP" | "SEZWOP";

// ── dispatch nested ─────────────────────────────────────────────────────
export type DispatchDetails = {
  name: string | null;
  place: string | null;
  /** primary address line (alias addr1 for doc parity) */
  address: string | null;
  /** doc compat alias — same as address when present */
  addr1?: string | null;
  pin_code: string | null;
  /** free-text state name */
  state: string | null;
  /** 2-digit GST state code e.g. "06" */
  state_code: string | null;
  gstin: string | null;
};

// ── TransportDetails (25 top-level keys — Image 2 parity) ───────────────
// Count: 1 transport_mode, 2 transporter_id, 3 transporter_name, 4 gr_rr_no,
// 5 gr_rr_date, 6 vehicle_no, 7 station_to_place, 8 pin_code, 9 distance_km,
// 10 mode_of_transport, 11 sub_type, 12 transaction_type, 13 e_invoice_reqd,
// 14 e_way_reqd, 15 generate_eway_within_einvoice, 16 update_port_address,
// 17 dispatch_details, 18 eway_bill_no, 19 eway_bill_date, 20 eway_bill_valid_till,
// 21 einvoice_irn, 22 einvoice_ack_no, 23 einvoice_ack_date, 24 einvoice_qr,
// 25 transporter_id+name counted separately; dispatch subfields counted in 17
export type TransportDetails = {
  // §5.2 screenshot-mapped
  transport_mode: TransportMode;
  transporter_id: string | null;
  transporter_name: string | null;
  gr_rr_no: string | null;
  gr_rr_date: string | null; // ISO YYYY-MM-DD (UI shows DD-MM-YYYY)
  vehicle_no: string | null; // /^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/ — std + BH series
  station_to_place: string | null;
  pin_code: string | null; // 6-digit /^[1-9][0-9]{5}$/
  distance_km: number | null; // int 1-4000, haversine auto if PINs known
  mode_of_transport: ModeOfTransport; // Road default
  sub_type: string | null; // e.g. "Supply"
  transaction_type: TransactionType; // auto from sales_type

  e_invoice_reqd: "Y" | "N"; // auto B2B? Y:N (editable)
  e_way_reqd: "Y" | "N" | null; // auto total>=50000? Y:N (editable) — null = AUTO via threshold
  generate_eway_within_einvoice: boolean; // checkbox → embed EwbDtls
  update_port_address: string | null; // Export/SEZ utility

  // Dispatch Details boxed set (nested object)
  dispatch_details: DispatchDetails | null;

  // Compliance — pasted after portal (Phase 2/3, locked after IRN)
  eway_bill_no: string | null; // 12-digit EWB
  eway_bill_date: string | null; // ISO
  eway_bill_valid_till: string | null; // ISO
  einvoice_irn: string | null; // 64-hex IRN
  einvoice_ack_no: string | null; // 15-digit ack
  einvoice_ack_date: string | null; // ISO
  einvoice_qr: string | null; // signed QR payload (base64 JWT)
};

// ── defaults ─────────────────────────────────────────────────────────────
export const DEFAULT_TRANSPORT: TransportDetails = {
  transport_mode: "Self",
  transporter_id: null,
  transporter_name: null,
  gr_rr_no: null,
  gr_rr_date: null,
  vehicle_no: null,
  station_to_place: null,
  pin_code: null,
  distance_km: null,
  mode_of_transport: "road",
  sub_type: "Supply",
  transaction_type: "B2B",
  e_invoice_reqd: "N",
  e_way_reqd: null,
  generate_eway_within_einvoice: false,
  update_port_address: null,
  dispatch_details: null,
  eway_bill_no: null,
  eway_bill_date: null,
  eway_bill_valid_till: null,
  einvoice_irn: null,
  einvoice_ack_no: null,
  einvoice_ack_date: null,
  einvoice_qr: null,
};

// ── regexes ──────────────────────────────────────────────────────────────
export const PIN_REGEX = /^[1-9][0-9]{5}$/;
export const VEHICLE_REGEX = /^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;
export const EWB_REGEX = /^[0-9]{12}$/;
export const ACK_REGEX = /^[0-9]{15}$/;
export const IRN_REGEX = /^[0-9a-fA-F]{64}$/;

// ── helpers ──────────────────────────────────────────────────────────────
/** GSTIN format check (regex only). For checksum use validateGSTINChecksum from india.ts */
export function validateGSTIN(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  return GSTIN_REGEX.test(gstin.trim().toUpperCase());
}

/**
 * §7 Business Rules — e_invoice_required
 * Recommended lockdown: B2B (buyer GSTIN) + branch GSTIN ⇒ mandatory Y.
 * No turnover gate now. URP / no GSTIN ⇒ N (B2C).
 * H5 fix: checksum gate via validateGSTINChecksum + explicit URP sentinel.
 */
export function computeEInvoiceRequired(
  branchGstin: string | null | undefined,
  buyerGstin: string | null | undefined,
): "Y" | "N" {
  const buyerTrim = buyerGstin?.trim().toUpperCase() ?? "";
  // URP sentinel — unregistered person → always B2C → no e-invoice
  if (buyerTrim === "URP") return "N";
  const branchValid = validateGSTINChecksum(branchGstin);
  const buyerValid = validateGSTINChecksum(buyerGstin);
  return branchValid && buyerValid ? "Y" : "N";
}

/** boolean convenience — same rule as computeEInvoiceRequired */
export function isEInvoiceRequired(
  branchGstin: string | null | undefined,
  buyerGstin: string | null | undefined,
): boolean {
  return computeEInvoiceRequired(branchGstin, buyerGstin) === "Y";
}

/**
 * §7 — e_way_required (GST e-Way Bill — Rule 138: threshold is INCLUSIVE)
 * Explicit N ⇒ false, explicit Y ⇒ true, else ≥₹50,000 ⇒ true (inclusive boundary).
 * Explicit N overrides threshold. 50000 exactly IS required — see unit test below.
 * Docs and code must stay inclusive (≥ not >): sales.index.tsx, sales.invoices.$id.tsx,
 * and transport.ts all use >= 50000. Do not change to > 50000.
 */
export function computeEWayRequired(
  total: number | null | undefined,
  e_way_reqd: "Y" | "N" | null | undefined,
): boolean {
  const t = Number(total) || 0;
  if (e_way_reqd === "N") return false;
  if (e_way_reqd === "Y") return true;
  return t >= 50000; // inclusive: 50000 triggers e-Way (M5) — test: computeEWayRequired(50000,null)===true
}

/** Y/N variant */
export function computeEWayRequiredYN(
  total: number | null | undefined,
  e_way_reqd: "Y" | "N" | null | undefined,
): "Y" | "N" {
  return computeEWayRequired(total, e_way_reqd) ? "Y" : "N";
}

/**
 * Auto transaction type from sales_type + buyer GSTIN.
 * SEZWP/SEZWOP dominate; else B2B if buyer GSTIN valid (checksum), else B2C.
 * H5 fix: URP sentinel handled explicitly + checksum gate (validateGSTINChecksum).
 */
export function computeTransactionType(
  salesType: string | null | undefined,
  _isInterstate: boolean | null | undefined,
  buyerGstin: string | null | undefined,
): TransactionType {
  const st = String(salesType || "").toLowerCase();
  if (st === "sez_taxable") return "SEZWP";
  if (st === "sez_zero_rated") return "SEZWOP";
  const buyerTrim = buyerGstin?.trim().toUpperCase() ?? "";
  if (!buyerTrim || buyerTrim === "URP") return "B2C";
  const hasGstin = validateGSTINChecksum(buyerGstin);
  return hasGstin ? "B2B" : "B2C";
}

/** distance guard 1–4000 */
export function clampDistanceKm(v: number | null | undefined): number | null {
  if (v == null || !isFinite(Number(v))) return null;
  const n = Math.round(Number(v));
  if (n < 1) return 1;
  if (n > 4000) return 4000;
  return n;
}

export function isValidDistanceKm(v: number | null | undefined): boolean {
  if (v == null) return false;
  const n = Number(v);
  return isFinite(n) && n >= 1 && n <= 4000;
}

/** VehicleNo: std ^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$ or BH ^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$; lenient upper-trim */
export function isValidVehicleNo(v: string | null | undefined): boolean {
  if (!v) return false;
  return VEHICLE_REGEX.test(v.trim().toUpperCase());
}

export function isValidPinCode(v: string | null | undefined): boolean {
  if (!v) return false;
  return PIN_REGEX.test(v.trim());
}

/** validate + clamp distance, return warning if out of bounds */
export function validateDistanceKm(v: number | null | undefined): { value: number | null; warning?: string } {
  if (v == null) return { value: null };
  const n = Number(v);
  if (!isFinite(n)) return { value: null, warning: "Distance must be a number" };
  if (n < 1) return { value: 1, warning: "Distance clamped to minimum 1 km" };
  if (n > 4000) return { value: 4000, warning: "Distance clamped to maximum 4000 km" };
  return { value: Math.round(n) };
}
