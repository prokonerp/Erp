import { z } from "zod";
import type { IdentityResult } from "@/lib/engineer-identity";

export const UPS_LOCATIONS = ["Computer Room", "Electrical Room", "Network Room", "Other"] as const;

export type FsrEngineer = { employeeId: string | null; name: string; phone?: string | null; submissionId?: string };

const emptyToUndefined = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;

const optionalNonNegativeNumber = z.preprocess(
  emptyToUndefined,
  z.coerce.number().nonnegative().optional(),
);

const optionalNonNegativeInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().nonnegative().optional(),
);

const requiredPositiveNumber = (message: string) =>
  z.preprocess(emptyToUndefined, z.coerce.number({ error: message }).positive(message));

export const BATTERY_MAKES = ["EXIDE", "QUANTA"] as const;
export const BATTERY_AH = ["7", "12", "18", "26", "42", "65", "100", "120", "150", "200"] as const;
/** Battery bank qty: optional, integer, hard cap 16 (matches the QTY-driven grid). */
const optionalBatteryQty = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().max(16, "Battery qty cannot exceed 16").optional(),
);
export const batteryBankSchema = z.object({
  batteryBankMake: z.preprocess(emptyToUndefined, z.enum(BATTERY_MAKES).optional()),
  batteryBankAh: z.preprocess(emptyToUndefined, z.enum(BATTERY_AH).optional()),
  batteryBankQty: optionalBatteryQty,
});
const voltsReadingSchema = z.object({ volts: optionalNonNegativeNumber });
export const MAX_BATTERY_READINGS = 16;
export const chargingReadingsSchema = z
  .array(voltsReadingSchema)
  .max(MAX_BATTERY_READINGS)
  .default([]);
export const dischargingReadingsSchema = z
  .array(voltsReadingSchema)
  .max(MAX_BATTERY_READINGS)
  .default([]);
export const pcPairSchema = z.object({
  monitorSizeIn: optionalNonNegativeNumber,
  qty: optionalNonNegativeInt,
});
export const printerPairSchema = z.object({
  ratingW: optionalNonNegativeInt,
  qty: optionalNonNegativeInt,
});
export const scannerPairSchema = z.object({
  ratingW: optionalNonNegativeInt,
  qty: optionalNonNegativeInt,
});
const pcDetailsSchema = z.array(pcPairSchema).max(20).default([]);
const printerDetailsSchema = z.array(printerPairSchema).max(20).default([]);
const scannerDetailsSchema = z.array(scannerPairSchema).max(20).default([]);

export const readingsSchema = z
  .object({
    mainsVoltageLn: requiredPositiveNumber("Voltage L-N must be a number greater than 0"),
    mainsVoltageNe: requiredPositiveNumber("Voltage N-E must be a number greater than 0"),
    chargingReadings: chargingReadingsSchema,
    dischargingReadings: dischargingReadingsSchema,
  })
  .merge(batteryBankSchema);

export const loadRecordSchema = z.object({
  acProvided: z.boolean({ error: "AC Provided is required" }),
  dgProvided: z.boolean({ error: "DG Provided is required" }),
  environmentDuty: z.boolean({ error: "Environment Duty is required" }),
  upsLocation: z.enum(UPS_LOCATIONS),
  pcDetails: pcDetailsSchema,
  printerDetails: printerDetailsSchema,
  scannerDetails: scannerDetailsSchema,
});

export const powerConditionSchema = z.object({
  powerFailuresCount: optionalNonNegativeInt,
  powerFailuresDurationMin: z.preprocess(
    emptyToUndefined,
    z.coerce.number().nonnegative().max(1440).optional(),
  ),
  loadOnDgPercent: z.preprocess(
    emptyToUndefined,
    z.coerce.number().nonnegative().max(100).optional(),
  ),
  dgSetCapacityKva: optionalNonNegativeNumber,
  dgSet: z.boolean({ error: "DG Set is required" }),
  amfPanel: z.boolean({ error: "AMF Panel is required" }),
  operateNonBusinessHours: z.boolean({ error: "Operation during non-business hours is required" }),
  operateHolidays: z.boolean({ error: "Operation on holidays is required" }),
});

export const partReplacementSchema = z.object({
  item: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  oldSrNo: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  newSrNo: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  charges: optionalNonNegativeNumber,
  qty: optionalNonNegativeInt,
  // Serial-photo evidence (B1.6): storage path of the captured serial photo.
  // Required at finalize whenever oldSrNo/newSrNo is present (see gate
  // below). camelCase like its siblings; mapped to photo_path for the DB.
  photoPath: z.preprocess(emptyToUndefined, z.string().max(500).optional()),
});

export const partReplacementsSchema = z.array(partReplacementSchema).max(5).default([]);

// ---------------------------------------------------------------------------
// Serial-photo evidence gate.
//
// A serial-bearing line (old/new Sr. No present) must carry photo evidence
// or finalize-fsr.functions.ts rejects it LOUDLY before any write. The form
// captures it per part row (B1.6) into `photo_path`; SERIAL_PHOTO_KEYS keeps
// forward-compat with any serialPhoto-style aliases.
// ---------------------------------------------------------------------------

/** Storage keys tolerated as serial-photo evidence (none exist in stored rows today). */
const SERIAL_PHOTO_KEYS = [
  "photo_path",
  "photoPath",
  "serial_photo",
  "serialPhoto",
  "serial_photo_path",
  "serialPhotoPath",
  "photo",
  "photo_url",
  "photoUrl",
] as const;

const SERIAL_OLD_KEYS = ["oldSrNo", "old_sr_no"] as const;
const SERIAL_NEW_KEYS = ["newSrNo", "new_sr_no"] as const;

function isNonBlankString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function pickLineField(line: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = line[k];
    if (isNonBlankString(v)) return v;
  }
  return null;
}

/** True when old Sr. No or new Sr. No is non-blank (whitespace counts as blank). */
export function partLineHasSerialNumber(line: Record<string, unknown>): boolean {
  return (
    pickLineField(line, SERIAL_OLD_KEYS) !== null ||
    pickLineField(line, SERIAL_NEW_KEYS) !== null
  );
}

/**
 * True when any tolerated photo-evidence key is non-blank. Always false for
 * rows written by the current form (no photo field exists in the shape).
 */
export function partLineHasSerialPhoto(line: Record<string, unknown>): boolean {
  return pickLineField(line, SERIAL_PHOTO_KEYS) !== null;
}

/**
 * 0-based indices of serial-bearing lines with no photo evidence.
 * Non-array input (null/missing column) yields [] — nothing to gate.
 */
export function findSerialLinesWithoutPhoto(list: unknown): number[] {
  if (!Array.isArray(list)) return [];
  const missing: number[] = [];
  list.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const line = entry as Record<string, unknown>;
    if (partLineHasSerialNumber(line) && !partLineHasSerialPhoto(line)) missing.push(i);
  });
  return missing;
}

/** Human ref for one offending line: report + line are 1-based for engineers. */
export function serialPhotoLineRef(reportIndex: number, lineIndex: number): string {
  return `part line ${lineIndex + 1} (report ${reportIndex + 1}) has a serial number but no serial photo evidence`;
}

/** Finalize rejection: lists every offending line, states nothing was written. */
export function buildSerialPhotoBlockedError(refs: string[]): string {
  return `Serial photo required — finalize blocked: ${refs.join("; ")}. Nothing was departed or closed.`;
}

// ---------------------------------------------------------------------------
// Submit identity gate (FIX 2): identity failure blocks, never orphans.
// ---------------------------------------------------------------------------

/** Retryable block message shown when engineer identity cannot be verified. Nothing is saved. */
export const IDENTITY_BLOCK_MESSAGE =
  "Could not verify your engineer identity — check connection and retry. Nothing was saved.";

export type SubmitIdentity =
  | { blocked: true; message: string }
  | { blocked: false; employeeId: string; engineerName: string; engineerPhone: string | null };

/**
 * Maps a fetchMyIdentity result to submit identity. Non-ok (not_linked,
 * ambiguous) blocks with IDENTITY_BLOCK_MESSAGE; ok passes the row through
 * with the exact legacy fallbacks (null name → fallback, null phone → null).
 */
export function resolveSubmitIdentity(
  identity: IdentityResult,
  fallbackName: string,
): SubmitIdentity {
  if (identity.status !== "ok") return { blocked: true, message: IDENTITY_BLOCK_MESSAGE };
  const employee = identity.employee as unknown as {
    id: string;
    name: string | null;
    phone?: string | null;
  };
  return {
    blocked: false,
    employeeId: employee.id,
    engineerName: employee.name ?? fallbackName,
    engineerPhone: employee.phone ?? null,
  };
}

// ---------------------------------------------------------------------------
// Latest-open-visit picker (FIX 3): single latest open visit, never all.
// ---------------------------------------------------------------------------

export type OpenVisitCandidate = {
  id: string;
  arrival_at: string | null;
  departure_at: string | null;
  created_at?: string | null;
};

/**
 * Returns the single latest open visit (arrival set, departure unset),
 * newest arrival first with created_at as tiebreak. Null/empty/all-closed/
 * arrival-less input yields null (no phantom departures).
 */
export function pickLatestOpenVisit<T extends OpenVisitCandidate>(
  rows: readonly T[] | null | undefined,
): T | null {
  if (!rows || rows.length === 0) return null;
  const toTime = (v: string | null | undefined): number => {
    if (!v) return Number.NEGATIVE_INFINITY;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  };
  let best: T | null = null;
  for (const row of rows) {
    if (!row || !row.arrival_at || row.departure_at) continue;
    if (!best) {
      best = row;
      continue;
    }
    const arrivalDelta = toTime(row.arrival_at) - toTime(best.arrival_at);
    if (
      arrivalDelta > 0 ||
      (arrivalDelta === 0 && toTime(row.created_at) - toTime(best.created_at) > 0)
    ) {
      best = row;
    }
  }
  return best;
}

export const ratingSchema = z.preprocess(
  emptyToUndefined,
  z.coerce
    .number({ error: "Overall rating is required" })
    .int()
    .min(1, "Rating must be between 1 and 10")
    .max(10, "Rating must be between 1 and 10"),
);

const optionalRemarks = z.preprocess(emptyToUndefined, z.string().trim().max(1000).optional());

export const fieldServiceReportSchema = readingsSchema
  .merge(loadRecordSchema)
  .merge(powerConditionSchema)
  .merge(z.object({ partReplacements: partReplacementsSchema }))
  .merge(z.object({ rating: ratingSchema }))
  .merge(z.object({ customerRemarks: optionalRemarks, engineerRemarks: optionalRemarks }))
  .merge(
    z.object({
      customerSignaturePath: z.string().min(1, "Customer signature is required"),
      signatureCapturedAt: z.preprocess(emptyToUndefined, z.string().datetime().optional()),
    }),
  );

export type FieldServiceReportInput = z.infer<typeof fieldServiceReportSchema>;

export type FieldServiceReportPayload = {
  ticket_id: string;
  mains_voltage_ln: number;
  mains_voltage_ne: number;
  battery_bank_make: string | null;
  battery_bank_ah: string | null;
  battery_bank_qty: number | null;
  charging_readings: { volts: number | null }[];
  discharging_readings: { volts: number | null }[];
  ac_provided: boolean;
  dg_provided: boolean;
  environment_duty: boolean;
  ups_location: (typeof UPS_LOCATIONS)[number];
  pc_details: { monitor_size_in: number | null; qty: number | null }[];
  printer_details: { rating_w: number | null; qty: number | null }[];
  scanner_details: { rating_w: number | null; qty: number | null }[];
  power_failures_count: number | null;
  power_failures_duration_min: number | null;
  load_on_dg_percent: number | null;
  dg_set: boolean;
  dg_set_capacity_kva: number | null;
  amf_panel: boolean;
  operate_non_business_hours: boolean;
  operate_holidays: boolean;
  rating: number;
  engineer_employee_id: string | null;
  engineer_name: string;
  engineer_phone: string | null;
  submission_id: string | null;
  customer_signature_path: string;
  signature_captured_at: string | null;
  customer_remarks: string | null;
  engineer_remarks: string | null;
  part_replacements: {
    item: string | null;
    old_sr_no: string | null;
    new_sr_no: string | null;
    charges: number | null;
    qty: number | null;
    photo_path: string | null;
  }[];
};

export function buildFsrPayload(
  input: FieldServiceReportInput,
  ticketId: string,
  engineer: FsrEngineer,
): FieldServiceReportPayload {
  return {
    ticket_id: ticketId,
    mains_voltage_ln: input.mainsVoltageLn,
    mains_voltage_ne: input.mainsVoltageNe,
    battery_bank_make: input.batteryBankMake ?? null,
    battery_bank_ah: input.batteryBankAh ?? null,
    battery_bank_qty: input.batteryBankQty ?? null,
    charging_readings: input.chargingReadings.map((r) => ({
      volts: r.volts ?? null,
    })),
    discharging_readings: input.dischargingReadings.map((r) => ({
      volts: r.volts ?? null,
    })),
    ac_provided: input.acProvided,
    dg_provided: input.dgProvided,
    environment_duty: input.environmentDuty,
    ups_location: input.upsLocation,
    pc_details: input.pcDetails.map((p) => ({
      monitor_size_in: p.monitorSizeIn ?? null,
      qty: p.qty ?? null,
    })),
    printer_details: input.printerDetails.map((p) => ({
      rating_w: p.ratingW ?? null,
      qty: p.qty ?? null,
    })),
    scanner_details: input.scannerDetails.map((s) => ({
      rating_w: s.ratingW ?? null,
      qty: s.qty ?? null,
    })),
    power_failures_count: input.powerFailuresCount ?? null,
    power_failures_duration_min: input.powerFailuresDurationMin ?? null,
    load_on_dg_percent: input.loadOnDgPercent ?? null,
    dg_set: input.dgSet,
    dg_set_capacity_kva: input.dgSetCapacityKva ?? null,
    amf_panel: input.amfPanel,
    operate_non_business_hours: input.operateNonBusinessHours,
    operate_holidays: input.operateHolidays,
    rating: input.rating,
    engineer_employee_id: engineer.employeeId ?? null,
    engineer_name: engineer.name,
    engineer_phone: engineer.phone ?? null,
    // Idempotency key: the submitter generates one uuid per Report attempt and
    // reuses it across retries, so an ambiguous failure never creates a second
    // row (UNIQUE index on field_service_reports.submission_id).
    submission_id: engineer.submissionId ?? null,
    customer_signature_path: input.customerSignaturePath,
    signature_captured_at: input.signatureCapturedAt ?? null,
    customer_remarks: input.customerRemarks ?? null,
    engineer_remarks: input.engineerRemarks ?? null,
    part_replacements: input.partReplacements.map((p) => ({
      item: p.item ?? null,
      old_sr_no: p.oldSrNo ?? null,
      new_sr_no: p.newSrNo ?? null,
      charges: p.charges ?? null,
      qty: p.qty ?? null,
      photo_path: p.photoPath ?? null,
    })),
  };
}
