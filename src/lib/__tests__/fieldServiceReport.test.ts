import { describe, it, expect } from "vitest";
import { fieldServiceReportSchema, buildFsrPayload, UPS_LOCATIONS } from "@/lib/fieldServiceReport";

const validLocation = UPS_LOCATIONS[0];

function minimalInput() {
  return {
    mainsVoltageLn: "230",
    mainsVoltageNe: "1.5",
    batteryReadings: [],
    upsLocation: validLocation,
    pcDetails: [],
    printerDetails: [],
    scannerDetails: [],
  };
}

function fullValidInput() {
  return {
    mainsVoltageLn: "230.5",
    mainsVoltageNe: "1.2",
    batteryReadings: [
      { chargeVdc: "13.5", dischargeVdc: "12.1" },
      { chargeVdc: "13.6", dischargeVdc: "12.0" },
    ],
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
  };
}

describe("fieldServiceReportSchema", () => {
  it("parses a full valid payload with array details and string-coerced numerics", () => {
    const result = fieldServiceReportSchema.safeParse(fullValidInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryReadings).toEqual([
      { chargeVdc: 13.5, dischargeVdc: 12.1 },
      { chargeVdc: 13.6, dischargeVdc: 12.0 },
    ]);
    expect(result.data.pcDetails).toEqual([{ monitorSizeIn: 21.5, qty: 2 }]);
    expect(result.data.printerDetails).toEqual([{ ratingW: 60, qty: 1 }]);
    expect(result.data.scannerDetails).toEqual([]);
  });

  it("parses a minimal payload with empty arrays and defaults booleans to false", () => {
    const result = fieldServiceReportSchema.safeParse(minimalInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryReadings).toEqual([]);
    expect(result.data.pcDetails).toEqual([]);
    expect(result.data.printerDetails).toEqual([]);
    expect(result.data.scannerDetails).toEqual([]);
    expect(result.data.acProvided).toBe(false);
    expect(result.data.dgProvided).toBe(false);
    expect(result.data.environmentDuty).toBe(false);
    expect(result.data.dgSet).toBe(false);
    expect(result.data.amfPanel).toBe(false);
    expect(result.data.operateNonBusinessHours).toBe(false);
    expect(result.data.operateHolidays).toBe(false);
  });

  it("fails when mainsVoltageLn is missing", () => {
    const { mainsVoltageLn: _omitted, ...rest } = minimalInput();
    const result = fieldServiceReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("fails when upsLocation is missing", () => {
    const { upsLocation: _omitted, ...rest } = minimalInput();
    const result = fieldServiceReportSchema.safeParse(rest);
    expect(result.success).toBe(false);
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

  it("fails on invalid upsLocation", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      upsLocation: "Server Room",
    });
    expect(result.success).toBe(false);
  });

  it("fails on fractional pc qty (must be int)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      pcDetails: [{ monitorSizeIn: "22", qty: "2.5" }],
    });
    expect(result.success).toBe(false);
  });

  it("fails on negative pc qty (must be non-negative)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      pcDetails: [{ monitorSizeIn: "22", qty: "-1" }],
    });
    expect(result.success).toBe(false);
  });

  it("parses fractional monitorSizeIn (fractional size is OK)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      pcDetails: [{ monitorSizeIn: "21.5", qty: "2" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pcDetails).toEqual([{ monitorSizeIn: 21.5, qty: 2 }]);
  });

  it("fails on non-numeric battery chargeVdc", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryReadings: [{ chargeVdc: "abc", dischargeVdc: "12" }],
    });
    expect(result.success).toBe(false);
  });

  it("parses empty batteryReadings", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryReadings: [],
    });
    expect(result.success).toBe(true);
  });

  it("fails when batteryReadings exceeds 20 rows", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      batteryReadings: Array.from({ length: 21 }, () => ({
        chargeVdc: "13.5",
        dischargeVdc: "12.1",
      })),
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
});

describe("buildFsrPayload", () => {
  it("maps arrays to snake_case JSONB objects", () => {
    const parsed = fieldServiceReportSchema.parse(fullValidInput());
    const payload = buildFsrPayload(parsed, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    });

    expect(payload.ticket_id).toBe("ticket-123");
    expect(payload.mains_voltage_ln).toBe(230.5);
    expect(payload.mains_voltage_ne).toBe(1.2);
    expect(payload.battery_readings).toEqual([
      { charge_vdc: 13.5, discharge_vdc: 12.1 },
      { charge_vdc: 13.6, discharge_vdc: 12.0 },
    ]);
    expect(payload.pc_details).toEqual([{ monitor_size_in: 21.5, qty: 2 }]);
    expect(payload.printer_details).toEqual([{ rating_w: 60, qty: 1 }]);
    expect(payload.scanner_details).toEqual([]);
    expect(payload.ups_location).toBe(validLocation);
  });

  it("maps undefined optionals to null and contains no legacy keys", () => {
    const parsed = fieldServiceReportSchema.parse({
      ...minimalInput(),
      batteryReadings: [{}],
      pcDetails: [{}],
    });
    const payload = buildFsrPayload(parsed, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    }) as Record<string, unknown>;

    // Empty row objects map missing readings to null
    expect(payload.battery_readings).toEqual([{ charge_vdc: null, discharge_vdc: null }]);
    expect(payload.pc_details).toEqual([{ monitor_size_in: null, qty: null }]);
    expect(payload.power_failures_count).toBeNull();
    expect(payload.power_failures_duration_min).toBeNull();
    expect(payload.load_on_dg_percent).toBeNull();
    expect(payload.dg_set_capacity_kva).toBeNull();

    // No legacy fixed-field keys
    expect("pc_qty_1" in payload).toBe(false);
    expect("batt1_charge_vdc" in payload).toBe(false);
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
});
