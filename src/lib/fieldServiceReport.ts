import { z } from "zod";

export const UPS_LOCATIONS = ["Computer Room", "Electrical Room", "Network Room", "Other"] as const;

export type FsrEngineer = { employeeId: string | null; name: string; phone?: string | null };

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
const optionalPositiveInt = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().positive().optional(),
);
export const batteryBankSchema = z.object({
  batteryBankMake: z.preprocess(emptyToUndefined, z.enum(BATTERY_MAKES).optional()),
  batteryBankAh: z.preprocess(emptyToUndefined, z.enum(BATTERY_AH).optional()),
  batteryBankQty: optionalPositiveInt,
});
const voltsReadingSchema = z.object({ volts: optionalNonNegativeNumber });
export const chargingReadingsSchema = z.array(voltsReadingSchema).max(20).default([]);
export const dischargingReadingsSchema = z.array(voltsReadingSchema).max(20).default([]);
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

export const frontIndicationSchema = z.object({
  opMode: z.preprocess(emptyToUndefined, z.enum(["on_mains", "on_battery"]).optional()),
  bypassState: z.preprocess(emptyToUndefined, z.enum(["on_bypass", "dead"]).optional()),
  leadFound: optionalNonNegativeNumber,
  leadCorrected: optionalNonNegativeNumber,
  chargeFound: optionalNonNegativeNumber,
  chargeCorrected: optionalNonNegativeNumber,
  fault0Found: optionalNonNegativeNumber,
  fault0Corrected: optionalNonNegativeNumber,
  faultGeFound: optionalNonNegativeNumber,
  faultGeCorrected: optionalNonNegativeNumber,
  remarks: z.preprocess(emptyToUndefined, z.string().max(500).optional()),
  remarksTarget: z.preprocess(emptyToUndefined, z.enum(["UPS", "PCB", "Transformer"]).optional()),
});

export const partReplacementSchema = z.object({
  item: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  oldSrNo: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  newSrNo: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  charges: optionalNonNegativeNumber,
  qty: optionalNonNegativeInt,
  oldBarcode: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  newChallan: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
});

export const partReplacementsSchema = z.array(partReplacementSchema).max(5).default([]);

export const fieldServiceReportSchema = readingsSchema
  .merge(loadRecordSchema)
  .merge(powerConditionSchema)
  .merge(z.object({ frontIndication: frontIndicationSchema }))
  .merge(z.object({ partReplacements: partReplacementsSchema }));

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
  front_indication: {
    op_mode: string | null;
    bypass_state: string | null;
    lead_found: number | null;
    lead_corrected: number | null;
    charge_found: number | null;
    charge_corrected: number | null;
    fault_0_found: number | null;
    fault_0_corrected: number | null;
    fault_ge_found: number | null;
    fault_ge_corrected: number | null;
    remarks: string | null;
    remarks_target: string | null;
  };
  engineer_employee_id: string | null;
  engineer_name: string;
  engineer_phone: string | null;
  part_replacements: {
    item: string | null;
    old_sr_no: string | null;
    new_sr_no: string | null;
    charges: number | null;
    qty: number | null;
    old_barcode: string | null;
    new_challan: string | null;
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
    front_indication: {
      op_mode: input.frontIndication.opMode ?? null,
      bypass_state: input.frontIndication.bypassState ?? null,
      lead_found: input.frontIndication.leadFound ?? null,
      lead_corrected: input.frontIndication.leadCorrected ?? null,
      charge_found: input.frontIndication.chargeFound ?? null,
      charge_corrected: input.frontIndication.chargeCorrected ?? null,
      fault_0_found: input.frontIndication.fault0Found ?? null,
      fault_0_corrected: input.frontIndication.fault0Corrected ?? null,
      fault_ge_found: input.frontIndication.faultGeFound ?? null,
      fault_ge_corrected: input.frontIndication.faultGeCorrected ?? null,
      remarks: input.frontIndication.remarks ?? null,
      remarks_target: input.frontIndication.remarksTarget ?? null,
    },
    engineer_employee_id: engineer.employeeId ?? null,
    engineer_name: engineer.name,
    engineer_phone: engineer.phone ?? null,
    part_replacements: input.partReplacements.map((p) => ({
      item: p.item ?? null,
      old_sr_no: p.oldSrNo ?? null,
      new_sr_no: p.newSrNo ?? null,
      charges: p.charges ?? null,
      qty: p.qty ?? null,
      old_barcode: p.oldBarcode ?? null,
      new_challan: p.newChallan ?? null,
    })),
  };
}
