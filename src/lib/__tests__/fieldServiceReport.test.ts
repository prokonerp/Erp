import { describe, it, expect } from "vitest";
import { fieldServiceReportSchema, buildFsrPayload, UPS_LOCATIONS } from "@/lib/fieldServiceReport";

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
    frontIndication: {},
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
    frontIndication: {
      opMode: "on_mains",
      bypassState: "on_bypass",
      leadFound: "90",
      remarks: "ok",
      remarksTarget: "UPS",
    },
  };
}

describe("fieldServiceReportSchema", () => {
  it("parses a full valid payload with new battery bank + readings + frontIndication", () => {
    const result = fieldServiceReportSchema.safeParse(fullValidInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.batteryBankMake).toBe("EXIDE");
    expect(result.data.batteryBankAh).toBe("100");
    expect(result.data.batteryBankQty).toBe(4);
    expect(result.data.chargingReadings).toEqual([{ volts: 13.5 }, { volts: 13.6 }]);
    expect(result.data.dischargingReadings).toEqual([{ volts: 12.1 }]);
    expect(result.data.frontIndication).toMatchObject({
      opMode: "on_mains",
      bypassState: "on_bypass",
      leadFound: 90,
      remarks: "ok",
      remarksTarget: "UPS",
    });
    expect(result.data.pcDetails).toEqual([{ monitorSizeIn: 21.5, qty: 2 }]);
    expect(result.data.printerDetails).toEqual([{ ratingW: 60, qty: 1 }]);
  });

  it("parses a minimal payload with empty readings arrays and empty frontIndication", () => {
    const result = fieldServiceReportSchema.safeParse(minimalInput());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.chargingReadings).toEqual([]);
    expect(result.data.dischargingReadings).toEqual([]);
    expect(result.data.frontIndication).toEqual({});
    expect(result.data.acProvided).toBe(false);
    expect(result.data.dgProvided).toBe(false);
    expect(result.data.environmentDuty).toBe(false);
    expect(result.data.dgSet).toBe(false);
    expect(result.data.amfPanel).toBe(false);
    expect(result.data.operateNonBusinessHours).toBe(false);
    expect(result.data.operateHolidays).toBe(false);
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

  it("fails when chargingReadings exceeds 20 rows", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      chargingReadings: Array.from({ length: 21 }, () => ({ volts: "13.5" })),
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

  it("fails when dischargingReadings exceeds 20 rows", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      dischargingReadings: Array.from({ length: 21 }, () => ({ volts: "12.1" })),
    });
    expect(result.success).toBe(false);
  });

  it("parses empty dischargingReadings", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      dischargingReadings: [],
    });
    expect(result.success).toBe(true);
  });

  it('fails on frontIndication opMode "on_solar"', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      frontIndication: { opMode: "on_solar" },
    });
    expect(result.success).toBe(false);
  });

  it('fails on frontIndication leadFound "-5" (must be non-negative)', () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      frontIndication: { leadFound: "-5" },
    });
    expect(result.success).toBe(false);
  });

  it("fails on frontIndication remarks longer than 500 chars", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...minimalInput(),
      frontIndication: { remarks: "a".repeat(501) },
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
  it("maps new battery bank + readings + front_indication to snake_case", () => {
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
    expect(payload.front_indication).toMatchObject({
      op_mode: "on_mains",
      bypass_state: "on_bypass",
      lead_found: 90,
      remarks: "ok",
      remarks_target: "UPS",
    });
    expect(payload.pc_details).toEqual([{ monitor_size_in: 21.5, qty: 2 }]);
    expect(payload.printer_details).toEqual([{ rating_w: 60, qty: 1 }]);
    expect(payload.scanner_details).toEqual([]);
    expect(payload.ups_location).toBe(validLocation);

    // Old array-model key must be gone, no camelCase leakage
    expect("battery_readings" in payload).toBe(false);
    expect("batteryReadings" in payload).toBe(false);

    // No id / submitted_at keys
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("submitted_at");
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
});
