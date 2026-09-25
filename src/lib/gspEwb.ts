import { z } from "zod";

/**
 * Pure helpers for the e-way bill and GSTIN-lookup paths.
 *
 * These live apart from `gsp.functions.ts` on purpose: that module is coupled
 * to Supabase and the active transport, which makes it awkward to unit test.
 * The *decision rules* — which transport field wins, how a GSP lookup response
 * is normalised — are pure and belong here so they can be pinned by tests.
 */

// ── e-way bill input ────────────────────────────────────────────────────────

/**
 * Part-B transport fields are optional: an e-way bill can be raised with only
 * the invoice's own (frozen) transport_details, and the vehicle/transporter
 * may be supplied (or corrected) at e-way-bill time. The handler resolves the
 * effective values with `resolveEwbTransportFields`.
 */
export const ewbInputSchema = z.object({
  invoiceId: z.string().uuid(),
  distance: z.number().positive().max(4000),
  transporter_id: z.string().trim().max(100).optional(),
  transporter_name: z.string().trim().max(200).optional(),
  vehicle_number: z.string().trim().max(40).optional(),
});

/** Shape of the optional transport fields the UI may send with an EWB request. */
export type EwbTransportInput = z.infer<typeof ewbInputSchema>;

/** The `transport_details` columns the e-way bill reads, when present. */
export interface FrozenTransportDetails {
  transporter_id?: string | null;
  transporter_name?: string | null;
  vehicle_no?: string | null;
}

export interface ResolvedEwbFields {
  transporter_id: string | null;
  transporter_name: string | null;
  vehicle_number: string | null;
}

const blank = (v: string | null | undefined): v is null | undefined => v == null || v.trim() === "";

/**
 * Resolve the transporter/vehicle to put on the e-way bill.
 *
 * Precedence: an explicitly supplied value wins, because Part-B details are
 * legitimately provided (or corrected) at e-way-bill time; anything not
 * supplied falls back to the invoice's frozen `transport_details`. A value that
 * is present but blank is treated as "not supplied" so the fallback still wins.
 */
export function resolveEwbTransportFields(
  details: FrozenTransportDetails | null | undefined,
  input: Pick<EwbTransportInput, "transporter_id" | "transporter_name" | "vehicle_number">,
): ResolvedEwbFields {
  const pick = (explicit: string | undefined, frozen: string | null | undefined) =>
    blank(explicit) ? (blank(frozen) ? null : (frozen as string)) : (explicit as string);

  return {
    transporter_id: pick(input.transporter_id, details?.transporter_id),
    transporter_name: pick(input.transporter_name, details?.transporter_name),
    vehicle_number: pick(input.vehicle_number, details?.vehicle_no),
  };
}

// ── GSTIN lookup normalisation ─────────────────────────────────────────────

export interface GstinDetails {
  gstin: string | null;
  tradeName: string | null;
  legalName: string | null;
  status: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * Normalise a `get-gstin-details` message into a stable shape.
 *
 * The GSP only sometimes returns a trade/legal name or a status, so every field
 * is coerced to `string | null` (never `undefined`) to keep the UI's rendering
 * and the client's cache shape deterministic. A completely absent payload maps
 * to all-nulls rather than throwing, so the caller can decide how to surface it.
 */
export function normalizeGstinDetails(message: unknown): GstinDetails {
  const m = (message ?? {}) as Record<string, unknown>;
  return {
    gstin: str(m.Gstin) ?? str(m.gstin),
    tradeName: str(m.TradeName) ?? str(m.tradeName),
    legalName: str(m.LegalName) ?? str(m.legalName),
    status: str(m.GSTINStatus) ?? str(m.Status) ?? str(m.status),
  };
}
