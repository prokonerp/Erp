/**
 * src/lib/einvoice.ts — thin re-export wrapper for legacy expectation.
 *
 * `standalone-module.md:60-62` notes that `gst.ts:288-289` references
 * `einvoice.ts` but the file was missing; the invoicing flow previously used
 * `mockIrnPayload()` which fabricated IRN/QR values. This module is the
 * legacy-compatible façade over the real pure builders in `invoiceJson.ts`.
 *
 * ## Staged JSON round-trip (no GSP today, manual upload)
 *
 * 1. **Generate** — UI calls `buildGstInvoiceJson(invoice, items, branch, customer, transport)`
 *    and/or `buildEwayJson(invoice, transport, items)` to produce NIC e-Invoice
 *    v1.03 / E-Way Bill v1.0 compliant JSON (pure, deterministic `r2` rounding).
 *    The JSON is offered as a downloadable `.json` file / copyable textarea;
 *    nothing is sent over the network.
 * 2. **Manual upload** — user uploads the downloaded JSON to the government
 *    portals (`einvoice1.gst.gov.in` offline tool / `ewaybillgst.gov.in`) in
 *    their own browser session. No GSP credentials are stored in Prokon.
 * 3. **Paste-back** — the portal returns a success payload containing the real
 *    `Irn` (64-hex), `AckNo` (15-digit), `AckDt`, `SignedQRCode` (base64 JWT)
 *    and, for E-Way, `EwbNo` (12-digit) + `EwbDt`/`EwbValidTill`. The user
 *    pastes that JSON back into the app; `parseGstPortalIrnResponse` and
 *    `parseEwayResponse` validate and normalise it, after which the caller
 *    persists `irn`/`ack_no`/`signed_qr`/`gst_invoice_json` and
 *    `einvoice_status='generated'` (and `ewaybill_no` etc).
 * 4. **Future GSP** — when a live IRP gateway is added, replace only the
 *    manual paste step with a `fetch` to the GSP; the builders, validators and
 *    DB columns remain unchanged.
 *
 * This file intentionally has **no Supabase I/O and no network calls** — it is
 * a pure re-export + a small completion-status helper so existing imports of
 * `src/lib/einvoice` keep working.
 *
 * @module src/lib/einvoice
 */

import { computeEInvoiceRequired } from "./transport";
import { computeEWayRequired } from "./transport";
import type { TransportDetails } from "./transport";

// ── Core NIC builders / validators / helpers (pure) ──────────────────────────
export {
  buildGstInvoiceJson,
  buildEwayJson,
  parseGstPortalIrnResponse,
  parseEwayResponse,
  // alias kept for callers that used the alternate casing
  parseGstPortalIrnResponse as parseGstPortalIRNResponse,
  parseEwayResponse as parseEWayResponse,
  getSupTypForSalesType,
  getSupTyp,
  gstDateDDMMYYYY,
} from "./invoiceJson";

// Re-export useful types (optional, does not affect legacy expectation)
export type {
  InvoiceLite,
  InvoiceItemLite,
  BranchLite,
  CustomerLite,
  NicInvoiceJson,
  EwayJson,
  IrnParseResult,
  EwayParseResult,
  SupTyp,
} from "./invoiceJson";

// ── Transport requirement helpers ────────────────────────────────────────────
// `standalone-module.md` / task expects `isEInvoiceRequired` to be an alias of
// `computeEInvoiceRequired` (Y/N string) and `isEWayRequired` as the E-Way
// gate. We re-export the Y/N and boolean variants for compatibility.
export {
  computeEInvoiceRequired,
  computeEInvoiceRequired as isEInvoiceRequired,
  computeEWayRequired,
  computeEWayRequired as isEWayRequired,
  computeEWayRequiredYN,
  isEInvoiceRequired as isEInvoiceRequiredBool,
} from "./transport";

// Keep direct named re-export visible for IDE auto-complete
export { computeEInvoiceRequired as computeEInvoiceRequiredAlias } from "./transport";

// ── Completion status helper ─────────────────────────────────────────────────

export type InvoiceCompletionInput = {
  seller_gstin?: string | null;
  buyer_gstin?: string | null;
  total?: number | null;
  subtotal?: number | null;
  taxable_value?: number | null;
  transport_details?: TransportDetails | string | unknown | null;
  einvoice_status?: string | null;
  eway_status?: string | null;
  irn?: string | null;
  ack_no?: string | null;
  ack_date?: string | null;
  qr_payload?: string | null;
  signed_qr?: string | null;
  ewaybill_no?: string | null;
  ewaybill_date?: string | null;
  ewaybill_valid_till?: string | null;
  // allow legacy / new column aliases
  [key: string]: unknown;
};

export type InvoiceCompletionStatus = {
  /** true when IRN is required for this invoice (B2B + branch GSTIN) */
  e_invoice_required: boolean;
  /** true when an E-Way Bill is required (total ≥ ₹50k or explicit Y) */
  e_way_required: boolean;
  /** true when every required artefact is present */
  complete: boolean;
  /** human-readable badge: "Complete" | "Pending e-Invoice" | "Pending e-Way" | "Pending e-Invoice + e-Way" */
  badge: string;
};

function asTransportDetails(
  raw: InvoiceCompletionInput["transport_details"],
): TransportDetails | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as TransportDetails;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as TransportDetails;
  return null;
}

/**
 * Derive e-Invoice / e-Way requirement and overall completion for an invoice.
 *
 * - **e-Invoice required** — `transport_details.e_invoice_reqd === "Y"` wins;
 *   otherwise `computeEInvoiceRequired(seller_gstin, buyer_gstin) === "Y"` (B2B
 *   gate: valid branch GSTIN + valid buyer GSTIN → Y, else N).
 * - **e-Way required** — delegates to `computeEWayRequired(total, e_way_reqd)`:
 *   explicit `"Y"` always true, `"N"` defers to ₹50k threshold, otherwise
 *   `total >= 50000`.
 * - **Complete** — `(!e_invoice_required || irn_present) && (!e_way_required || ewb_present)`.
 *   `irn_present` checks `irn` / `transport_details.einvoice_irn` / `einvoice_status==='generated'`;
 *   `ewb_present` checks `ewaybill_no` / `transport_details.eway_bill_no` / `eway_status==='generated'`.
 *
 * Used by the Invoice detail page and registry to render the amber/green badge
 * and to gate "Print Final".
 */
export function getInvoiceCompletionStatus(
  invoice: InvoiceCompletionInput | null | undefined,
): InvoiceCompletionStatus {
  if (!invoice) {
    return {
      e_invoice_required: false,
      e_way_required: false,
      complete: false,
      badge: "Pending",
    };
  }

  const transport = asTransportDetails(invoice.transport_details);

  // e-Invoice required
  let e_invoice_required: boolean;
  if (transport && (transport.e_invoice_reqd === "Y" || transport.e_invoice_reqd === "N")) {
    e_invoice_required = transport.e_invoice_reqd === "Y";
  } else {
    const sellerGstin =
      (invoice.seller_gstin as string | null | undefined) ??
      (transport?.einvoice_irn ? null : null);
    const buyerGstin = (invoice.buyer_gstin as string | null | undefined) ?? null;
    e_invoice_required = computeEInvoiceRequired(sellerGstin ?? null, buyerGstin ?? null) === "Y";
  }

  // e-Way required
  const totalNum = Number((invoice as { total?: unknown }).total) || 0;
  const eWayReqdFlag = (transport?.e_way_reqd as "Y" | "N" | null | undefined) ?? null;
  const e_way_required = computeEWayRequired(totalNum, eWayReqdFlag);

  // Presence checks — honour both legacy columns and transport_details mirrors
  const hasIrn =
    !!invoice.irn ||
    !!transport?.einvoice_irn ||
    (typeof (invoice as Record<string, unknown>).einvoice_irn === "string" &&
      !!((invoice as Record<string, unknown>).einvoice_irn as string).trim()) ||
    invoice.einvoice_status === "generated" ||
    (typeof (invoice as Record<string, unknown>).ack_no === "string" &&
      !!((invoice as Record<string, unknown>).ack_no as string).trim());

  const hasEwb =
    !!invoice.ewaybill_no ||
    !!transport?.eway_bill_no ||
    (typeof (invoice as Record<string, unknown>).eway_bill_no === "string" &&
      !!((invoice as Record<string, unknown>).eway_bill_no as string).trim()) ||
    invoice.eway_status === "generated" ||
    !!invoice.ewaybill_valid_till ||
    !!transport?.eway_bill_valid_till;

  const eInvoiceDone = !e_invoice_required || hasIrn;
  const eWayDone = !e_way_required || hasEwb;
  const complete = eInvoiceDone && eWayDone;

  let badge: string;
  if (complete) {
    badge = "Complete";
  } else if (e_invoice_required && !hasIrn && e_way_required && !hasEwb) {
    badge = "Pending e-Invoice + e-Way";
  } else if (e_invoice_required && !hasIrn) {
    badge = "Pending e-Invoice";
  } else if (e_way_required && !hasEwb) {
    badge = "Pending e-Way";
  } else {
    badge = "Pending";
  }

  return {
    e_invoice_required,
    e_way_required,
    complete,
    badge,
  };
}
