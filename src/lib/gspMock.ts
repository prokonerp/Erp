/**
 * src/lib/gspMock.ts — in-process GSP stand-in for local development.
 *
 * Implements the same `GspTransport` interface as `createHttpTransport`, so
 * swapping to the real GSP is a `GSP_MODE` change rather than a code change.
 *
 * ## Why the IRN here is a real SHA-256 and not `mockIrnPayload()`
 *
 * The retired `mockIrnPayload()` in `gst.ts` built an IRN as
 * `hash8.repeat(8)` — a 64-char string that passes `/^[0-9a-f]{64}$/` while
 * being obviously fake. Four such values reached production and the ERP
 * reported those invoices as compliant. This mock derives the IRN from a
 * SHA-256 of the document instead, so it is non-repeating and indistinguishable
 * from a genuine IRN structurally — which is exactly what makes it useful for
 * exercising the parse/persist/status path without lying about compliance.
 *
 * ## Determinism
 *
 * The IRN is derived from the document number + date, so calling
 * `generateIrn` twice for the same invoice returns the same IRN. That mirrors
 * real idempotent behaviour and lets tests assert on stable values.
 *
 * ## Failure injection
 *
 * Pass `mockError: "3038: ..."` (or set `GSP_MOCK_ERROR`) to make every call
 * return a genuine GSP *business failure* envelope, so the error-mapping and
 * retry paths are exercised rather than assumed.
 *
 * @module src/lib/gspMock
 */

import { createHash } from "node:crypto";
import {
  GspError,
  parseBusinessError,
  type ByDocQuery,
  type ByIrnQuery,
  type CancelIrnRequest,
  type GenEwbByIrnRequest,
  type GspEnvelope,
  type GspTransport,
  type GstinQuery,
} from "./gspClient";
import type { GspInvoiceRequest } from "./gspPayload";

export type MockTransportOptions = {
  /** e.g. `"3038: Pincode does not exist"`. Injects a business failure. */
  mockError?: string;
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Deterministic 64-hex, non-repeating — the exact shape of a real IRN. */
function deriveIrn(userGstin: string, docNumber: string, docDate: string): string {
  return sha256Hex(`irn:${userGstin}:${docNumber}:${docDate}`);
}

/** Deterministic 15-digit acknowledgement number. */
function deriveAckNo(seed: string): string {
  const digest = sha256Hex(`ack:${seed}`);
  // Take digits only, left-pad, and keep 15.
  const digits = digest.replace(/\D/g, "").padEnd(15, "7").slice(0, 15);
  return digits;
}

/** Deterministic 12-digit e-way bill number. */
function deriveEwbNo(seed: string): string {
  const digest = sha256Hex(`ewb:${seed}`);
  const digits = digest.replace(/\D/g, "").padEnd(12, "3").slice(0, 12);
  return digits;
}

function signedQr(irn: string, userGstin: string, docNumber: string): string {
  return Buffer.from(
    JSON.stringify({ irn, gstin: userGstin, docNo: docNumber, iss: "NIC Sandbox" }),
    "utf8",
  ).toString("base64");
}

function okEnvelope(message: Record<string, unknown>): GspEnvelope {
  return {
    results: {
      message: { ...message, error: false, Status: "ACT" },
      errorMessage: "",
      InfoDtls: "",
      status: "Success",
      code: 200,
      requestId: `mock-${Date.now()}`,
    },
  };
}

function errorEnvelope(errorMessage: string): GspEnvelope {
  return {
    results: {
      message: "",
      errorMessage,
      InfoDtls: "",
      status: "Failed",
      code: 204,
      requestId: `mock-${Date.now()}`,
    },
  };
}

export function createMockTransport(opts: MockTransportOptions = {}): GspTransport {
  const injected = opts.mockError ?? process.env.GSP_MOCK_ERROR ?? "";

  /** Throws a real GspError when a failure is injected, so callers' error
   *  handling runs exactly as it would against the live GSP. */
  function maybeFail(endpoint: string): void {
    if (!injected) return;
    const err = parseBusinessError(errorEnvelope(injected), endpoint, 200);
    if (err) throw err;
  }

  function irnFor(userGstin: string, docNumber: string, docDate: string) {
    const irn = deriveIrn(userGstin, docNumber, docDate);
    return {
      irn,
      message: {
        Irn: irn,
        AckNo: deriveAckNo(irn),
        AckDt: "01/09/2026 12:00:00",
        SignedQRCode: signedQr(irn, userGstin, docNumber),
        SignedInvoice: signedQr(irn, userGstin, docNumber),
        Status: "ACT",
        error: false,
      },
    };
  }

  return {
    async generateIrn(body: GspInvoiceRequest): Promise<GspEnvelope> {
      maybeFail("generate_irn");
      const { user_gstin: gstin, document_details: doc } = body;
      const { irn, message } = irnFor(gstin, doc.document_number, doc.document_date);
      return okEnvelope({ ...message, QRCodeUrl: `mock://qr/${irn}` });
    },

    async cancelIrn(body: CancelIrnRequest): Promise<GspEnvelope> {
      maybeFail("cancel_irn");
      return okEnvelope({ Irn: body.irn, CancelDate: "01/09/2026 14:00:00" });
    },

    async genEwbByIrn(body: GenEwbByIrnRequest): Promise<GspEnvelope> {
      maybeFail("gen_ewb_by_irn");
      return okEnvelope({
        Irn: body.irn,
        EwbNo: deriveEwbNo(body.irn),
        EwbDt: "01/09/2026 12:00:00",
        EwbValidTill: "02/09/2026 12:00:00",
      });
    },

    async getEinvoiceByDoc(q: ByDocQuery): Promise<GspEnvelope> {
      maybeFail("get_einvoice_by_doc");
      const { message } = irnFor(q.user_gstin, q.document_number, q.document_date ?? "01/09/2026");
      return okEnvelope(message);
    },

    async getEinvoiceByIrn(q: ByIrnQuery): Promise<GspEnvelope> {
      maybeFail("get_einvoice_by_irn");
      return okEnvelope({ Irn: q.irn, AckNo: deriveAckNo(q.irn) });
    },

    async getEwbByIrn(q: ByIrnQuery): Promise<GspEnvelope> {
      maybeFail("get_ewb_by_irn");
      // Mirror the real API's ambiguity: an unknown IRN yields no EwbNo.
      const known = /^f{64}$/.test(q.irn);
      return okEnvelope({
        Irn: q.irn,
        EwbNo: known ? null : deriveEwbNo(q.irn),
        EwbDt: known ? null : "01/09/2026 12:00:00",
        EwbValidTill: known ? null : "02/09/2026 12:00:00",
      });
    },

    async getGstinDetails(q: GstinQuery): Promise<GspEnvelope> {
      maybeFail("get_gstin_details");
      return okEnvelope({ Gstin: q.gstin, TradeName: "Mock GSTIN", LegalName: "Mock GSTIN" });
    },
  };
}

/**
 * Build the transport that matches the active mode. Kept here so the server
 * functions have a single import for "give me a GSP".
 */
export function createTransportForMode(
  mode: "mock" | "sandbox" | "production",
  httpDeps?: Parameters<typeof import("./gspClient").createHttpTransport>[0],
): GspTransport {
  if (mode === "mock") return createMockTransport();
  // Lazily imported by the caller; this branch exists for symmetry.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./gspClient").createHttpTransport(httpDeps!);
}

export { GspError };
