import { describe, it, expect } from "vitest";
import {
  fieldServiceReportSchema,
  partReplacementsSchema,
  buildFsrPayload,
  UPS_LOCATIONS,
  buildSerialPhotoBlockedError,
  findSerialLinesWithoutPhoto,
  IDENTITY_BLOCK_MESSAGE,
  partLineHasSerialNumber,
  partLineHasSerialPhoto,
  pickLatestOpenVisit,
  resolveSubmitIdentity,
  serialPhotoLineRef,
} from "@/lib/fieldServiceReport";

const validLocation = UPS_LOCATIONS[0];

function minimalInput() {
  return {
    mainsVoltageLn: "230",
    mainsVoltageNe: "1.5",
    upsLocation: validLocation,
    chargingReadings: [],
    dischargingReadings: [],
    pcDetails: [],
    printerDetails: [],
    scannerDetails: [],
    acProvided: false,
    dgProvided: false,
    environmentDuty: false,
    dgSet: false,
    amfPanel: false,
    operateNonBusinessHours: false,
    operateHolidays: false,
    rating: "7",
    customerSignaturePath: "signatures/ticket-123.png",
  };
}

function fullValidInput() {
  return {
    mainsVoltageLn: "230.5",
    mainsVoltageNe: "1.2",
    batteryBankMake: "EXIDE",
    batteryBankAh: "100",
    batteryBankQty: "4",
    chargingReadings: [{ volts: "13.5" }, { volts: "13.6" }],
    dischargingReadings: [{ volts: "12.1" }],
    acProvided: true,
    dgProvided: true,
    environmentDuty: true,
    upsLocation: validLocation,
    pcDetails: [{ monitorSizeIn: "21.5", qty: "2" }],
    printerDetails: [{ ratingW: "60", qty: "1" }],
    scannerDetails: [],
    powerFailuresCount: "3",
    powerFailuresDurationMin: "45",
    loadOnDgPercent: "60",
    dgSetCapacityKva: "15",
    dgSet: true,
    amfPanel: true,
    operateNonBusinessHours: true,
    operateHolidays: true,
    rating: "8",
    customerSignaturePath: "signatures/ticket-123.png",
    signatureCapturedAt: "2026-09-14T10:00:00.000Z",
  };
}

describe("fieldServiceReportSchema", () => {
  it("parses a full valid payload with new battery bank + readings + rating", () => {
    const result = fieldServiceReportSchema.safeParse(fullValidInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryBankMake).toBe("EXIDE");
    expect(result.data.batteryBankAh).toBe("100");
    expect(result.data.batteryBankQty).toBe(4);
    expect(result.data.chargingReadings).toEqual([{ volts: 13.5 }, { volts: 13.6 }]);
    expect(result.data.dischargingReadings).toEqual([{ volts: 12.1 }]);
    expect(result.data.rating).toBe(8);
    expect(result.data.acProvided).toBe(true);
    expect(result.data.dgSet).toBe(true);
    expect(result.data.pcDetails).toEqual([{ monitorSizeIn: 21.5, qty: 2 }]);
    expect(result.data.printerDetails).toEqual([{ ratingW: 60, qty: 1 }]);
  });

  it("parses a minimal payload with empty readings arrays, answered tri-states and rating", () => {
    const result = fieldServiceReportSchema.safeParse(minimalInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.chargingReadings).toEqual([]);
    expect(result.data.dischargingReadings).toEqual([]);
    expect(result.data.rating).toBe(7);
    expect(result.data.acProvided).toBe(false);
    expect(result.data.dgProvided).toBe(false);
    expect(result.data.environmentDuty).toBe(false);
    expect(result.data.dgSet).toBe(false);
    expect(result.data.amfPanel).toBe(false);
    expect(result.data.operateNonBusinessHours).toBe(false);
    expect(result.data.operateHolidays).toBe(false);
  });

  it("fails when acProvided is unanswered (null is compulsory Yes/No)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      acProvided: null,
    });
    expect(result.success).toBe(false);
  });

  it("fails when environmentDuty is missing entirely", () => {
    const input = minimalInput() as Record<string, unknown>;
    delete input.environmentDuty;
    expect(fieldServiceReportSchema.safeParse(input).success).toBe(false);
  });

  it("fails when dgSet is unanswered (null)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      dgSet: null,
    });
    expect(result.success).toBe(false);
  });

  it("fails when operateHolidays is missing entirely", () => {
    const input = minimalInput() as Record<string, unknown>;
    delete input.operateHolidays;
    expect(fieldServiceReportSchema.safeParse(input).success).toBe(false);
  });

  it("fails when rating is missing", () => {
    const input = minimalInput() as Record<string, unknown>;
    delete input.rating;
    expect(fieldServiceReportSchema.safeParse(input).success).toBe(false);
  });

  it('fails on blank rating "" (must pick 1-10)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      rating: "",
    });
    expect(result.success).toBe(false);
  });

  it('fails on rating "0" and "11" (must be 1-10)', () => {
    expect(fieldServiceReportSchema.safeParse({ ...minimalInput(), rating: "0" }).success).toBe(
      false,
    );
    expect(fieldServiceReportSchema.safeParse({ ...minimalInput(), rating: "11" }).success).toBe(
      false,
    );
  });

  it('parses rating "10" as the top of the scale', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      rating: "10",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.rating).toBe(10);
  });

  it('fails on batteryBankQty "17" (cap is 16)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankQty: "17",
    });
    expect(result.success).toBe(false);
  });

  it("fails when mainsVoltageLn is missing", () => {
    const input = minimalInput() as Record<string, unknown>;
    delete input.mainsVoltageLn;
    expect(fieldServiceReportSchema.safeParse(input).success).toBe(false);
  });

  it("fails on non-numeric mains voltage", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      mainsVoltageLn: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("fails on empty-string mains voltage (must not coerce to 0)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      mainsVoltageLn: "",
    });
    expect(result.success).toBe(false);
  });

  it("fails when upsLocation is missing", () => {
    const input = minimalInput() as Record<string, unknown>;
    delete input.upsLocation;
    expect(fieldServiceReportSchema.safeParse(input).success).toBe(false);
  });

  it("fails on invalid upsLocation", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      upsLocation: "Server Room",
    });
    expect(result.success).toBe(false);
  });

  it('fails on batteryBankMake "Amaron" (not in allowlist)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankMake: "Amaron",
    });
    expect(result.success).toBe(false);
  });

  it('parses batteryBankMake "EXIDE" (in allowlist)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankMake: "EXIDE",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryBankMake).toBe("EXIDE");
  });

  it('parses batteryBankAh "150"', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankAh: "150",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryBankAh).toBe("150");
  });

  it('fails on batteryBankAh "999" (not in allowlist)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankAh: "999",
    });
    expect(result.success).toBe(false);
  });

  it('fails on fractional batteryBankQty "2.5" (must be int)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankQty: "2.5",
    });
    expect(result.success).toBe(false);
  });

  it('fails on non-numeric charging volts "abc"', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      chargingReadings: [{ volts: "abc" }],
    });
    expect(result.success).toBe(false);
  });

  it("fails when chargingReadings exceeds 16 rows", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      chargingReadings: Array.from({ length: 17 }, () => ({ volts: "13.5" })),
    });
    expect(result.success).toBe(false);
  });

  it('fails on non-numeric discharging volts "abc"', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      dischargingReadings: [{ volts: "abc" }],
    });
    expect(result.success).toBe(false);
  });

  it("fails when dischargingReadings exceeds 16 rows", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      dischargingReadings: Array.from({ length: 17 }, () => ({ volts: "12.1" })),
    });
    expect(result.success).toBe(false);
  });

  it("parses 16 charging readings (full bank)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      chargingReadings: Array.from({ length: 16 }, () => ({ volts: "13.5" })),
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.chargingReadings).toHaveLength(16);
  });

  it("parses empty dischargingReadings", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      dischargingReadings: [],
    });
    expect(result.success).toBe(true);
  });

  it("strips the removed frontIndication key (unknown keys are ignored)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      frontIndication: { opMode: "on_mains" },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect("frontIndication" in result.data).toBe(false);
  });

  it("fails on fractional pc qty (must be int)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      pcDetails: [{ monitorSizeIn: "22", qty: "2.5" }],
    });
    expect(result.success).toBe(false);
  });

  it("fails when loadOnDgPercent exceeds 100", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...fullValidInput(),
      loadOnDgPercent: "101",
    });
    expect(result.success).toBe(false);
  });

  it("fails when powerFailuresDurationMin exceeds minutes in a day", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...fullValidInput(),
      powerFailuresDurationMin: "1500",
    });
    expect(result.success).toBe(false);
  });

  it('parses blank batteryBankMake "" as undefined (fixed: emptyToUndefined)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankMake: "",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryBankMake).toBeUndefined();
  });

  it('parses blank batteryBankAh "" as undefined (fixed: emptyToUndefined)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankAh: "",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryBankAh).toBeUndefined();
  });

  it("parses all blank optional enums together as undefined (fixed: emptyToUndefined)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankMake: "",
      batteryBankAh: "",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryBankMake).toBeUndefined();
    expect(result.data.batteryBankAh).toBeUndefined();
  });

  it('coerces blank volts "" to undefined (empty section stays valid)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      chargingReadings: [{ volts: "" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.chargingReadings).toEqual([{ volts: undefined }]);
  });

  it('coerces blank batteryBankQty "" to undefined', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryBankQty: "",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryBankQty).toBeUndefined();
  });

  it("stays valid when pc/printer/scanner sections are omitted (fixed: .default([]))", () => {
    const input = minimalInput() as Record<string, unknown>;
    delete input.pcDetails;
    delete input.printerDetails;
    delete input.scannerDetails;
    const result = fieldServiceReportSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pcDetails).toEqual([]);
    expect(result.data.printerDetails).toEqual([]);
    expect(result.data.scannerDetails).toEqual([]);
  });

  it('does not coerce whitespace-only volts " " to 0 (fixed: trim to undefined)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      chargingReadings: [{ volts: " " }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.chargingReadings[0].volts).not.toBe(0);
    expect(result.data.chargingReadings[0].volts).toBeUndefined();
  });

  it("fails when pcDetails exceeds 20 rows", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      pcDetails: Array.from({ length: 21 }, () => ({ monitorSizeIn: "21.5", qty: "1" })),
    });
    expect(result.success).toBe(false);
  });

  it("fails when printerDetails exceeds 20 rows", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      printerDetails: Array.from({ length: 21 }, () => ({ ratingW: "60", qty: "1" })),
    });
    expect(result.success).toBe(false);
  });

  it("fails when scannerDetails exceeds 20 rows", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      scannerDetails: Array.from({ length: 21 }, () => ({ ratingW: "60", qty: "1" })),
    });
    expect(result.success).toBe(false);
  });

  it("defaults partReplacements to [] when key is omitted", () => {
    const result = fieldServiceReportSchema.safeParse(minimalInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.partReplacements).toEqual([]);
  });

  it("parses explicit empty partReplacements", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      partReplacements: [],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.partReplacements).toEqual([]);
  });

  it("parses a full valid part replacement record (no barcode field)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      partReplacements: [
        {
          item: "Battery",
          oldSrNo: "OLD1",
          newSrNo: "NEW1",
          charges: "1500",
          qty: "2",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.partReplacements).toEqual([
      {
        item: "Battery",
        oldSrNo: "OLD1",
        newSrNo: "NEW1",
        charges: 1500,
        qty: 2,
      },
    ]);
  });

  it("fails when partReplacements exceeds 5 records", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      partReplacements: Array.from({ length: 6 }, () => ({ item: "Battery" })),
    });
    expect(result.success).toBe(false);
  });

  it('fails on non-numeric part charges "abc"', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      partReplacements: [{ item: "Battery", charges: "abc" }],
    });
    expect(result.success).toBe(false);
  });

  it('fails on negative part qty "-1" (must be non-negative)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      partReplacements: [{ item: "Battery", qty: "-1" }],
    });
    expect(result.success).toBe(false);
  });

  it("parses all blank part replacement strings as undefined (fixed: emptyToUndefined)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      partReplacements: [
        {
          item: "",
          oldSrNo: "",
          newSrNo: "",
          charges: "",
          qty: "",
        },
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.partReplacements).toEqual([
      {
        item: undefined,
        oldSrNo: undefined,
        newSrNo: undefined,
        charges: undefined,
        qty: undefined,
      },
    ]);
  });

  it("fails when customerSignaturePath is missing", () => {
    const input = minimalInput() as Record<string, unknown>;
    delete input.customerSignaturePath;
    expect(fieldServiceReportSchema.safeParse(input).success).toBe(false);
  });

  it('fails on empty customerSignaturePath "" (signature required)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      customerSignaturePath: "",
    });
    expect(result.success).toBe(false);
  });

  it("parses optional signatureCapturedAt ISO string", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      signatureCapturedAt: "2026-09-14T10:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.signatureCapturedAt).toBe("2026-09-14T10:00:00.000Z");
  });
});

describe("buildFsrPayload", () => {
  it("maps new battery bank + readings + rating to snake_case", () => {
    const parsed = fieldServiceReportSchema.parse(fullValidInput());
    const payload = buildFsrPayload(parsed, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    }) as Record<string, unknown>;

    expect(payload.ticket_id).toBe("ticket-123");
    expect(payload.mains_voltage_ln).toBe(230.5);
    expect(payload.mains_voltage_ne).toBe(1.2);
    expect(payload.battery_bank_make).toBe("EXIDE");
    expect(payload.battery_bank_ah).toBe("100");
    expect(payload.battery_bank_qty).toBe(4);
    expect(payload.charging_readings).toEqual([{ volts: 13.5 }, { volts: 13.6 }]);
    expect(payload.discharging_readings).toEqual([{ volts: 12.1 }]);
    expect(payload.rating).toBe(8);
    expect(payload.ac_provided).toBe(true);
    expect(payload.dg_set).toBe(true);
    expect(payload.pc_details).toEqual([{ monitor_size_in: 21.5, qty: 2 }]);
    expect(payload.printer_details).toEqual([{ rating_w: 60, qty: 1 }]);
    expect(payload.scanner_details).toEqual([]);
    expect(payload.ups_location).toBe(validLocation);

    // Old array-model key must be gone, no camelCase leakage
    expect("battery_readings" in payload).toBe(false);
    expect("batteryReadings" in payload).toBe(false);

    // Removed front_indication key must be gone
    expect("front_indication" in payload).toBe(false);

    // No id / submitted_at keys
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("submitted_at");
  });

  it("propagates the client submission id for idempotent retries", () => {
    const parsed = fieldServiceReportSchema.parse(fullValidInput());
    const payload = buildFsrPayload(parsed, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
      submissionId: "sub-0001",
    }) as Record<string, unknown>;

    expect(payload.submission_id).toBe("sub-0001");
  });

  it("defaults a missing submission id to null (legacy callers)", () => {
    const parsed = fieldServiceReportSchema.parse(fullValidInput());
    const payload = buildFsrPayload(parsed, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    }) as Record<string, unknown>;

    expect(payload.submission_id).toBeNull();
  });

  it("maps undefined optionals to null and contains no legacy keys", () => {
    const parsed = fieldServiceReportSchema.parse({
      ...minimalInput(),
      chargingReadings: [{}],
      dischargingReadings: [{}],
      pcDetails: [{}],
    });
    const payload = buildFsrPayload(parsed, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    }) as Record<string, unknown>;

    // Empty row objects map missing readings to null
    expect(payload.charging_readings).toEqual([{ volts: null }]);
    expect(payload.discharging_readings).toEqual([{ volts: null }]);
    expect(payload.pc_details).toEqual([{ monitor_size_in: null, qty: null }]);
    expect(payload.battery_bank_make).toBeNull();
    expect(payload.battery_bank_ah).toBeNull();
    expect(payload.battery_bank_qty).toBeNull();
    expect(payload.power_failures_count).toBeNull();
    expect(payload.power_failures_duration_min).toBeNull();
    expect(payload.load_on_dg_percent).toBeNull();
    expect(payload.dg_set_capacity_kva).toBeNull();

    // No legacy fixed-field or old-model keys
    expect("battery_readings" in payload).toBe(false);
    expect("batteryReadings" in payload).toBe(false);
    expect("pc_qty_1" in payload).toBe(false);
    expect("printer_rating_w_1" in payload).toBe(false);
    expect("scanner_qty_2" in payload).toBe(false);

    // No id / submitted_at keys
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("submitted_at");
  });

  it("sets engineer fields and ticket_id with null employeeId/phone, omits id/submitted_at", () => {
    const parsed = fieldServiceReportSchema.parse(fullValidInput());
    const payload = buildFsrPayload(parsed, "ticket-456", {
      employeeId: null,
      name: "John Engineer",
    }) as Record<string, unknown>;

    expect(payload.ticket_id).toBe("ticket-456");
    expect(payload.engineer_employee_id).toBeNull();
    expect(payload.engineer_name).toBe("John Engineer");
    expect(payload.engineer_phone).toBeNull();
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("submitted_at");
  });

  it("maps minimal input partReplacements to []", () => {
    const parsed = fieldServiceReportSchema.parse(minimalInput());
    const payload = buildFsrPayload(parsed, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    }) as Record<string, unknown>;

    expect(payload.part_replacements).toEqual([]);
  });

  it("maps a full part replacement record to snake_case keys (no barcode)", () => {
    const parsed = fieldServiceReportSchema.parse({
      ...minimalInput(),
      partReplacements: [
        {
          item: "Battery",
          oldSrNo: "OLD1",
          newSrNo: "NEW1",
          charges: "1500",
          qty: "2",
        },
      ],
    });
    const payload = buildFsrPayload(parsed, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    }) as Record<string, unknown>;

    expect(payload.part_replacements).toEqual([
      {
        item: "Battery",
        old_sr_no: "OLD1",
        new_sr_no: "NEW1",
        charges: 1500,
        qty: 2,
        photo_path: null,
      },
    ]);
  });

  it("maps customer signature fields to snake_case with null fallback", () => {
    const withSignature = fieldServiceReportSchema.parse(fullValidInput());
    const withPayload = buildFsrPayload(withSignature, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    }) as Record<string, unknown>;
    expect(withPayload.customer_signature_path).toBe("signatures/ticket-123.png");
    expect(withPayload.signature_captured_at).toBe("2026-09-14T10:00:00.000Z");

    const minimal = fieldServiceReportSchema.parse(minimalInput());
    const minimalPayload = buildFsrPayload(minimal, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    }) as Record<string, unknown>;
    expect(minimalPayload.customer_signature_path).toBe("signatures/ticket-123.png");
    expect(minimalPayload.signature_captured_at).toBeNull();
  });
});

describe("serial photo evidence gate", () => {
  it("flags oldSrNo-only and newSrNo-only lines (camelCase)", () => {
    expect(findSerialLinesWithoutPhoto([{ oldSrNo: "OLD1" }])).toEqual([0]);
    expect(findSerialLinesWithoutPhoto([{ newSrNo: "NEW1" }])).toEqual([0]);
  });

  it("flags snake_case serial keys as stored in the DB rows", () => {
    expect(findSerialLinesWithoutPhoto([{ old_sr_no: "OLD1" }])).toEqual([0]);
    expect(findSerialLinesWithoutPhoto([{ new_sr_no: "NEW1" }])).toEqual([0]);
  });

  it("returns [] for serial-less, blank, and whitespace-only lines", () => {
    expect(findSerialLinesWithoutPhoto([])).toEqual([]);
    expect(
      findSerialLinesWithoutPhoto([
        { item: "Battery", qty: 2 },
        { item: "", oldSrNo: "", newSrNo: "  ", charges: "", qty: "" },
      ]),
    ).toEqual([]);
  });

  it("returns [] for non-array input (null/missing column)", () => {
    expect(findSerialLinesWithoutPhoto(null)).toEqual([]);
    expect(findSerialLinesWithoutPhoto(undefined)).toEqual([]);
    expect(findSerialLinesWithoutPhoto("OLD1")).toEqual([]);
  });

  it("skips non-object entries, indexes only offending lines", () => {
    expect(
      findSerialLinesWithoutPhoto([
        { item: "Fuse" },
        null,
        { item: "Battery", oldSrNo: "OLD1" },
        "junk",
        { item: "Board", newSrNo: "NEW9" },
      ]),
    ).toEqual([2, 4]);
  });

  it("partLineHasSerialNumber tolerates both casings, ignores blanks", () => {
    expect(partLineHasSerialNumber({ oldSrNo: "A" })).toBe(true);
    expect(partLineHasSerialNumber({ new_sr_no: "B" })).toBe(true);
    expect(partLineHasSerialNumber({ oldSrNo: "  ", newSrNo: "" })).toBe(false);
    expect(partLineHasSerialNumber({ item: "Battery" })).toBe(false);
  });

  it("partLineHasSerialPhoto is false for current-form rows, true for future photo keys", () => {
    expect(partLineHasSerialPhoto({ oldSrNo: "OLD1", newSrNo: "NEW1" })).toBe(false);
    expect(
      findSerialLinesWithoutPhoto([{ oldSrNo: "OLD1", photo_path: "serials/p1.jpg" }]),
    ).toEqual([]);
    expect(partLineHasSerialPhoto({ serialPhoto: "serials/p2.jpg" })).toBe(true);
  });

  it("B1.6: schema keeps photoPath and payload maps it to photo_path", () => {
    const parsed = partReplacementsSchema.safeParse([
      { item: "PCB", oldSrNo: "O1", photoPath: "engineer/e1/serial_photo/2026-09-17/x.jpg" },
    ]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data[0]?.photoPath).toBe("engineer/e1/serial_photo/2026-09-17/x.jpg");
    const payload = buildFsrPayload(
      { ...minimalInput(), partReplacements: parsed.data } as never,
      "T-1",
      { employeeId: "E1", name: "Jane", phone: null, submissionId: "S1" },
    );
    expect(payload.part_replacements[0]?.photo_path).toBe(
      "engineer/e1/serial_photo/2026-09-17/x.jpg",
    );
  });

  it("error refs are 1-based and the blocked error states nothing was written", () => {
    expect(serialPhotoLineRef(0, 1)).toBe(
      "part line 2 (report 1) has a serial number but no serial photo evidence",
    );
    const err = buildSerialPhotoBlockedError([serialPhotoLineRef(0, 0), serialPhotoLineRef(1, 2)]);
    expect(err).toBe(
      "Serial photo required — finalize blocked: part line 1 (report 1) has a serial number but no serial photo evidence; part line 3 (report 2) has a serial number but no serial photo evidence. Nothing was departed or closed.",
    );
  });
});

describe("resolveSubmitIdentity (identity failure blocks, never orphans)", () => {
  it("passes ok identity through with legacy fallbacks", () => {
    const res = resolveSubmitIdentity(
      { status: "ok", employee: { id: "EMP-1", name: "Jane", phone: "999" } },
      "fallback@example.com",
    );
    expect(res).toEqual({
      blocked: false,
      employeeId: "EMP-1",
      engineerName: "Jane",
      engineerPhone: "999",
    });
  });

  it("falls back to the email-as-name default only when name is null", () => {
    const res = resolveSubmitIdentity(
      { status: "ok", employee: { id: "EMP-1", name: null } },
      "fallback@example.com",
    );
    expect(res).toEqual({
      blocked: false,
      employeeId: "EMP-1",
      engineerName: "fallback@example.com",
      engineerPhone: null,
    });
  });

  it("blocks not_linked and ambiguous with the exact retryable message", () => {
    expect(resolveSubmitIdentity({ status: "not_linked" }, "e@x.com")).toEqual({
      blocked: true,
      message: IDENTITY_BLOCK_MESSAGE,
    });
    expect(resolveSubmitIdentity({ status: "ambiguous", count: 2 }, "e@x.com")).toEqual({
      blocked: true,
      message: IDENTITY_BLOCK_MESSAGE,
    });
    expect(IDENTITY_BLOCK_MESSAGE).toBe(
      "Could not verify your engineer identity — check connection and retry. Nothing was saved.",
    );
  });
});

describe("pickLatestOpenVisit (single latest open visit, never all)", () => {
  const open = (id: string, arrival_at: string | null, created_at: string | null = null) => ({
    id,
    arrival_at,
    departure_at: null,
    created_at,
  });

  it("returns null for null/empty/all-departed/arrival-less rows (no phantom departures)", () => {
    expect(pickLatestOpenVisit(null)).toBeNull();
    expect(pickLatestOpenVisit([])).toBeNull();
    expect(
      pickLatestOpenVisit([
        { id: "a", arrival_at: "2026-09-14T10:00:00.000Z", departure_at: "2026-09-14T12:00:00.000Z" },
      ]),
    ).toBeNull();
    expect(pickLatestOpenVisit([open("b", null)])).toBeNull();
  });

  it("picks the newest arrival and ignores departed rows", () => {
    const rows = [
      open("old", "2026-09-13T10:00:00.000Z"),
      {
        id: "departed",
        arrival_at: "2026-09-15T10:00:00.000Z",
        departure_at: "2026-09-15T12:00:00.000Z",
      },
      open("new", "2026-09-14T10:00:00.000Z"),
    ];
    expect(pickLatestOpenVisit(rows)?.id).toBe("new");
  });

  it("breaks arrival ties by created_at", () => {
    const rows = [
      open("first", "2026-09-14T10:00:00.000Z", "2026-09-14T10:01:00.000Z"),
      open("second", "2026-09-14T10:00:00.000Z", "2026-09-14T10:02:00.000Z"),
    ];
    expect(pickLatestOpenVisit(rows)?.id).toBe("second");
  });
});
