import { describe, it, expect } from "vitest";
import { fieldServiceReportSchema, buildFsrPayload, UPS_LOCATIONS } from "@/lib/fieldServiceReport";

const validLocation = UPS_LOCATIONS[0];

function fullValidInput() {
  return {
    mainsVoltageLn: "230.5",
    mainsVoltageNe: "1.2",
    batt1ChargeVdc: "13.8",
    batt2ChargeVdc: "13.7",
    batt1DischargeVdc: "12.1",
    batt2DischargeVdc: "12.0",
    acProvided: true,
    dgProvided: true,
    environmentDuty: true,
    upsLocation: validLocation,
    pcMonitorSizeIn1: "21.5",
    pcQty1: 4,
    pcMonitorSizeIn2: "18.5",
    pcQty2: 2,
    printerRatingW1: "500",
    printerQty1: 1,
    printerRatingW2: "300",
    printerQty2: 1,
    scannerRatingW1: "50",
    scannerQty1: 1,
    scannerRatingW2: "40",
    scannerQty2: 1,
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
  it("parses a full valid payload with string-coerced numerics", () => {
    const result = fieldServiceReportSchema.safeParse(fullValidInput());
    expect(result.success).toBe(true);
  });

  it("parses a minimal payload and defaults booleans to false", () => {
    const result = fieldServiceReportSchema.safeParse({
      mainsVoltageLn: "230",
      mainsVoltageNe: "1.5",
      upsLocation: validLocation,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.acProvided).toBe(false);
    expect(result.data.dgProvided).toBe(false);
    expect(result.data.environmentDuty).toBe(false);
    expect(result.data.dgSet).toBe(false);
    expect(result.data.amfPanel).toBe(false);
    expect(result.data.operateNonBusinessHours).toBe(false);
    expect(result.data.operateHolidays).toBe(false);
  });

  it("fails when mainsVoltageLn is missing", () => {
    const result = fieldServiceReportSchema.safeParse({
      mainsVoltageNe: "1.5",
      upsLocation: validLocation,
    });
    expect(result.success).toBe(false);
  });

  it("fails when upsLocation is missing", () => {
    const result = fieldServiceReportSchema.safeParse({
      mainsVoltageLn: "230",
      mainsVoltageNe: "1.5",
    });
    expect(result.success).toBe(false);
  });

  it("fails on non-numeric voltage", () => {
    const result = fieldServiceReportSchema.safeParse({
      mainsVoltageLn: "abc",
      mainsVoltageNe: "1.5",
      upsLocation: validLocation,
    });
    expect(result.success).toBe(false);
  });

  it("fails on empty-string mains voltage (must not coerce to 0)", () => {
    const result = fieldServiceReportSchema.safeParse({
      mainsVoltageLn: "",
      mainsVoltageNe: "1.5",
      upsLocation: validLocation,
    });
    expect(result.success).toBe(false);
  });

  it("fails on invalid upsLocation", () => {
    const result = fieldServiceReportSchema.safeParse({
      mainsVoltageLn: "230",
      mainsVoltageNe: "1.5",
      upsLocation: "Server Room",
    });
    expect(result.success).toBe(false);
  });

  it("fails on negative pcQty1", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...fullValidInput(),
      pcQty1: -1,
    });
    expect(result.success).toBe(false);
  });

  it("fails on fractional pcQty1 (must be int)", () => {
    const result = fieldServiceReportSchema.safeParse({
      ...fullValidInput(),
      pcQty1: 2.5,
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
  it("maps camelCase to snake_case, nulls undefined optionals, sets ticket/engineer fields, omits id/submitted_at", () => {
    const parsed = fieldServiceReportSchema.parse({
      mainsVoltageLn: "230.5",
      mainsVoltageNe: "1.2",
      upsLocation: validLocation,
    });
    const payload = buildFsrPayload(parsed, "ticket-123", {
      employeeId: "EMP-1",
      name: "Jane Engineer",
      phone: "9999999999",
    }) as Record<string, unknown>;

    expect(payload.ticket_id).toBe("ticket-123");
    expect(payload.mains_voltage_ln).toBe(230.5);
    expect(payload.mains_voltage_ne).toBe(1.2);
    expect(payload.ups_location).toBe(validLocation);
    expect(payload.engineer_employee_id).toBe("EMP-1");
    expect(payload.engineer_name).toBe("Jane Engineer");
    expect(payload.engineer_phone).toBe("9999999999");

    // Undefined optionals map to null
    expect(payload.batt1_charge_vdc).toBeNull();
    expect(payload.pc_qty_1).toBeNull();
    expect(payload.power_failures_count).toBeNull();

    // No id / submitted_at keys
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("submitted_at");
  });

  it("maps null engineer phone and null employeeId without id/submitted_at", () => {
    const parsed = fieldServiceReportSchema.parse(fullValidInput());
    const payload = buildFsrPayload(parsed, "ticket-456", {
      employeeId: null,
      name: "John Engineer",
    }) as Record<string, unknown>;

    expect(payload.ticket_id).toBe("ticket-456");
    expect(payload.engineer_employee_id).toBeNull();
    expect(payload.engineer_name).toBe("John Engineer");
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("submitted_at");
  });
});
