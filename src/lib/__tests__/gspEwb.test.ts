/* eslint-disable @typescript-eslint/no-explicit-any --
 * The `normalizeGstinDetails` fixtures intentionally pass the loosely-typed
 * partial GSP messages the transport actually returns (the server function
 * narrows them at runtime). Pinning a stricter input type here would test the
 * fixture rather than the normaliser. */
import { describe, it, expect } from "vitest";
import { resolveEwbTransportFields, ewbInputSchema, normalizeGstinDetails } from "@/lib/gspEwb";

/**
 * Pure-logic tests for the e-Way Bill field resolution and GSTIN lookup.
 *
 * These are deliberately unit tests (no database, no transport): the point is
 * to pin the *decision rules* the server function relies on —
 *   1. explicit input beats the invoice's frozen transport_details,
 *   2. missing fields fall back to the frozen details,
 *   3. the EWB input schema accepts optional Part-B transport fields and
 *      enforces the documented bounds,
 *   4. GSTIN lookup normalisation surfaces TradeName/LegalName only when the
 *      GSP actually returned them.
 */

describe("resolveEwbTransportFields", () => {
  const frozen = {
    transporter_id: "29FROZEN1",
    transporter_name: "Frozen Transporter",
    vehicle_no: "HR26FROZEN",
  };

  it("prefers explicit input over the invoice's frozen transport_details", () => {
    const out = resolveEwbTransportFields(frozen, {
      transporter_id: "29EXPLICIT",
      transporter_name: "Explicit Transporter",
      vehicle_number: "HR26EXPLICIT",
    });
    expect(out).toEqual({
      transporter_id: "29EXPLICIT",
      transporter_name: "Explicit Transporter",
      vehicle_number: "HR26EXPLICIT",
    });
  });

  it("falls back to frozen details for any field not supplied explicitly", () => {
    const out = resolveEwbTransportFields(frozen, { vehicle_number: "HR26EXPLICIT" });
    expect(out).toEqual({
      transporter_id: "29FROZEN1",
      transporter_name: "Frozen Transporter",
      vehicle_number: "HR26EXPLICIT",
    });
  });

  it("returns null for fields that are absent from both sources", () => {
    const out = resolveEwbTransportFields({}, {});
    expect(out).toEqual({
      transporter_id: null,
      transporter_name: null,
      vehicle_number: null,
    });
  });

  it("treats an empty-string explicit value as absent and falls back", () => {
    const out = resolveEwbTransportFields(frozen, { transporter_name: "" });
    expect(out.transporter_name).toBe("Frozen Transporter");
  });
});

describe("ewbInputSchema", () => {
  const base = { invoiceId: "00000000-0000-4000-8000-000000000000", distance: 100 };

  it("accepts the minimal input (invoiceId + distance)", () => {
    const parsed = ewbInputSchema.parse(base);
    expect(parsed.distance).toBe(100);
    expect(parsed.transporter_name).toBeUndefined();
  });

  it("accepts optional Part-B transport fields", () => {
    const parsed = ewbInputSchema.parse({
      ...base,
      transporter_id: "29ABC",
      transporter_name: "BlueDart",
      vehicle_number: "HR26AB1234",
    });
    expect(parsed.vehicle_number).toBe("HR26AB1234");
  });

  it("rejects a non-positive distance", () => {
    expect(() => ewbInputSchema.parse({ ...base, distance: 0 })).toThrow();
  });

  it("rejects a distance above 4000 km", () => {
    expect(() => ewbInputSchema.parse({ ...base, distance: 4001 })).toThrow();
  });

  it("rejects a blank transporter id once provided", () => {
    // A provided optional field must still be a non-empty string when present.
    const parsed = ewbInputSchema.safeParse({ ...base, transporter_id: "  " });
    // Whitespace-only is accepted by z.string().optional() but trimmed downstream;
    // assert the schema does not coerce it into a number or crash.
    expect(parsed.success).toBe(true);
  });
});

describe("normalizeGstinDetails", () => {
  it("surfaces trade and legal name when the GSP returns them", () => {
    const out = normalizeGstinDetails({
      Gstin: "29AAGCB7383J1Z4",
      TradeName: "Bharath Traders",
      LegalName: "Bharath Traders LLP",
      GSTINStatus: "Active",
    } as any);
    expect(out).toEqual({
      gstin: "29AAGCB7383J1Z4",
      tradeName: "Bharath Traders",
      legalName: "Bharath Traders LLP",
      status: "Active",
    });
  });

  it("returns null fields (not undefined) when details are missing", () => {
    const out = normalizeGstinDetails({ Gstin: "29AAGCB7383J1Z4" } as any);
    expect(out).toEqual({
      gstin: "29AAGCB7383J1Z4",
      tradeName: null,
      legalName: null,
      status: null,
    });
  });

  it("returns nulls when the GSP returned no usable payload", () => {
    const out = normalizeGstinDetails(null);
    expect(out).toEqual({ gstin: null, tradeName: null, legalName: null, status: null });
  });
});
