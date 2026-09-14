import { z } from "zod";

export const UPS_LOCATIONS = ["Computer Room", "Electrical Room", "Network Room", "Other"] as const;

export type FsrEngineer = { employeeId: string | null; name: string; phone?: string | null };

const emptyToUndefined = (v: unknown) =>
  v === "" || v === undefined || v === null ? undefined : v;

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

export const batteryReadingSchema = z.object({
  chargeVdc: optionalNonNegativeNumber,
  dischargeVdc: optionalNonNegativeNumber,
});
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
const batteryReadingsSchema = z.array(batteryReadingSchema).max(20);
const pcDetailsSchema = z.array(pcPairSchema).max(20);
const printerDetailsSchema = z.array(printerPairSchema).max(20);
const scannerDetailsSchema = z.array(scannerPairSchema).max(20);

export const readingsSchema = z.object({
  mainsVoltageLn: requiredPositiveNumber("Voltage L-N must be a number greater than 0"),
  mainsVoltageNe: requiredPositiveNumber("Voltage N-E must be a number greater than 0"),
  batteryReadings: batteryReadingsSchema,
});

export const loadRecordSchema = z.object({
  acProvided: z.boolean().default(false),
  dgProvided: z.boolean().default(false),
  environmentDuty: z.boolean().default(false),
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
  dgSet: z.boolean().default(false),
  amfPanel: z.boolean().default(false),
  operateNonBusinessHours: z.boolean().default(false),
  operateHolidays: z.boolean().default(false),
});

export const fieldServiceReportSchema = readingsSchema
  .merge(loadRecordSchema)
  .merge(powerConditionSchema);

export type FieldServiceReportInput = z.infer<typeof fieldServiceReportSchema>;

export type FieldServiceReportPayload = {
  ticket_id: string;
  mains_voltage_ln: number;
  mains_voltage_ne: number;
  battery_readings: { charge_vdc: number | null; discharge_vdc: number | null }[];
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
  engineer_employee_id: string | null;
  engineer_name: string;
  engineer_phone: string | null;
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
    battery_readings: input.batteryReadings.map((b) => ({
      charge_vdc: b.chargeVdc ?? null,
      discharge_vdc: b.dischargeVdc ?? null,
    })),
    ac_provided: input.acProvided ?? false,
    dg_provided: input.dgProvided ?? false,
    environment_duty: input.environmentDuty ?? false,
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
    dg_set: input.dgSet ?? false,
    dg_set_capacity_kva: input.dgSetCapacityKva ?? null,
    amf_panel: input.amfPanel ?? false,
    operate_non_business_hours: input.operateNonBusinessHours ?? false,
    operate_holidays: input.operateHolidays ?? false,
    engineer_employee_id: engineer.employeeId ?? null,
    engineer_name: engineer.name,
    engineer_phone: engineer.phone ?? null,
  };
}
