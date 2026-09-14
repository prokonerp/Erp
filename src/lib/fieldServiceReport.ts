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

export const readingsSchema = z.object({
  mainsVoltageLn: requiredPositiveNumber("Voltage L-N must be a number greater than 0"),
  mainsVoltageNe: requiredPositiveNumber("Voltage N-E must be a number greater than 0"),
  batt1ChargeVdc: optionalNonNegativeNumber,
  batt2ChargeVdc: optionalNonNegativeNumber,
  batt1DischargeVdc: optionalNonNegativeNumber,
  batt2DischargeVdc: optionalNonNegativeNumber,
});

export const loadRecordSchema = z.object({
  acProvided: z.boolean().default(false),
  dgProvided: z.boolean().default(false),
  environmentDuty: z.boolean().default(false),
  upsLocation: z.enum(UPS_LOCATIONS),
  pcMonitorSizeIn1: optionalNonNegativeNumber,
  pcQty1: optionalNonNegativeInt,
  pcMonitorSizeIn2: optionalNonNegativeNumber,
  pcQty2: optionalNonNegativeInt,
  printerRatingW1: optionalNonNegativeInt,
  printerQty1: optionalNonNegativeInt,
  printerRatingW2: optionalNonNegativeInt,
  printerQty2: optionalNonNegativeInt,
  scannerRatingW1: optionalNonNegativeInt,
  scannerQty1: optionalNonNegativeInt,
  scannerRatingW2: optionalNonNegativeInt,
  scannerQty2: optionalNonNegativeInt,
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
  batt1_charge_vdc: number | null;
  batt2_charge_vdc: number | null;
  batt1_discharge_vdc: number | null;
  batt2_discharge_vdc: number | null;
  ac_provided: boolean;
  dg_provided: boolean;
  environment_duty: boolean;
  ups_location: (typeof UPS_LOCATIONS)[number];
  pc_monitor_size_in_1: number | null;
  pc_qty_1: number | null;
  pc_monitor_size_in_2: number | null;
  pc_qty_2: number | null;
  printer_rating_w_1: number | null;
  printer_qty_1: number | null;
  printer_rating_w_2: number | null;
  printer_qty_2: number | null;
  scanner_rating_w_1: number | null;
  scanner_qty_1: number | null;
  scanner_rating_w_2: number | null;
  scanner_qty_2: number | null;
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
    batt1_charge_vdc: input.batt1ChargeVdc ?? null,
    batt2_charge_vdc: input.batt2ChargeVdc ?? null,
    batt1_discharge_vdc: input.batt1DischargeVdc ?? null,
    batt2_discharge_vdc: input.batt2DischargeVdc ?? null,
    ac_provided: input.acProvided ?? false,
    dg_provided: input.dgProvided ?? false,
    environment_duty: input.environmentDuty ?? false,
    ups_location: input.upsLocation,
    pc_monitor_size_in_1: input.pcMonitorSizeIn1 ?? null,
    pc_qty_1: input.pcQty1 ?? null,
    pc_monitor_size_in_2: input.pcMonitorSizeIn2 ?? null,
    pc_qty_2: input.pcQty2 ?? null,
    printer_rating_w_1: input.printerRatingW1 ?? null,
    printer_qty_1: input.printerQty1 ?? null,
    printer_rating_w_2: input.printerRatingW2 ?? null,
    printer_qty_2: input.printerQty2 ?? null,
    scanner_rating_w_1: input.scannerRatingW1 ?? null,
    scanner_qty_1: input.scannerQty1 ?? null,
    scanner_rating_w_2: input.scannerRatingW2 ?? null,
    scanner_qty_2: input.scannerQty2 ?? null,
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
