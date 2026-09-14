import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  UPS_LOCATIONS,
  buildFsrPayload,
  fieldServiceReportSchema,
  loadRecordSchema,
  powerConditionSchema,
  readingsSchema,
} from "@/lib/fieldServiceReport";
import { fieldServiceReportKeys } from "@/lib/queryKeys";
import { useFieldServiceReport } from "@/hooks/useFieldServiceReport";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FieldRow } from "./CustomerForm";

type FormState = {
  mainsVoltageLn: string;
  mainsVoltageNe: string;
  batt1ChargeVdc: string;
  batt2ChargeVdc: string;
  batt1DischargeVdc: string;
  batt2DischargeVdc: string;
  acProvided: boolean;
  dgProvided: boolean;
  environmentDuty: boolean;
  upsLocation: string;
  pcMonitorSizeIn1: string;
  pcQty1: string;
  pcMonitorSizeIn2: string;
  pcQty2: string;
  printerRatingW1: string;
  printerQty1: string;
  printerRatingW2: string;
  printerQty2: string;
  scannerRatingW1: string;
  scannerQty1: string;
  scannerRatingW2: string;
  scannerQty2: string;
  powerFailuresCount: string;
  powerFailuresDurationMin: string;
  loadOnDgPercent: string;
  dgSetCapacityKva: string;
  dgSet: boolean;
  amfPanel: boolean;
  operateNonBusinessHours: boolean;
  operateHolidays: boolean;
};

const initialForm: FormState = {
  mainsVoltageLn: "",
  mainsVoltageNe: "",
  batt1ChargeVdc: "",
  batt2ChargeVdc: "",
  batt1DischargeVdc: "",
  batt2DischargeVdc: "",
  acProvided: false,
  dgProvided: false,
  environmentDuty: false,
  upsLocation: "",
  pcMonitorSizeIn1: "",
  pcQty1: "",
  pcMonitorSizeIn2: "",
  pcQty2: "",
  printerRatingW1: "",
  printerQty1: "",
  printerRatingW2: "",
  printerQty2: "",
  scannerRatingW1: "",
  scannerQty1: "",
  scannerRatingW2: "",
  scannerQty2: "",
  powerFailuresCount: "",
  powerFailuresDurationMin: "",
  loadOnDgPercent: "",
  dgSetCapacityKva: "",
  dgSet: false,
  amfPanel: false,
  operateNonBusinessHours: false,
  operateHolidays: false,
};

function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-[0.8rem] font-medium text-destructive mt-1">
      {message}
    </p>
  );
}

function NumInput({
  value,
  onChange,
  placeholder,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
}) {
  const fieldId = useId();
  return (
    <div>
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`h-11 min-h-[44px] ${error ? "border-destructive" : ""}`}
      />
      <FieldError message={error} id={`${fieldId}-error`} />
    </div>
  );
}

function YesNo({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <RadioGroup
      value={value ? "yes" : "no"}
      onValueChange={(v) => onChange(v === "yes")}
      aria-label={label}
      className="flex gap-6"
    >
      <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm">
        <RadioGroupItem value="yes" className="size-5" /> Yes
      </label>
      <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm">
        <RadioGroupItem value="no" className="size-5" /> No
      </label>
    </RadioGroup>
  );
}

function SectionHeader({ num, title, valid }: { num: string; title: string; valid: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {num}
      </span>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {valid && <Check className="size-4 text-primary" aria-label={`${title} complete`} />}
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function PhaseDot({ num, valid }: { num: string; valid: boolean }) {
  return (
    <span
      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        valid ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
      }`}
    >
      {valid ? <Check className="size-3.5" /> : num}
    </span>
  );
}

export function FieldServiceReport({ ticketId }: { ticketId: string }) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const {
    data: rows,
    isLoading: latestLoading,
    error: latestError,
  } = useFieldServiceReport(ticketId);

  const set = (k: keyof FormState, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const readingsValid = readingsSchema.safeParse({
    mainsVoltageLn: form.mainsVoltageLn,
    mainsVoltageNe: form.mainsVoltageNe,
    batt1ChargeVdc: form.batt1ChargeVdc,
    batt2ChargeVdc: form.batt2ChargeVdc,
    batt1DischargeVdc: form.batt1DischargeVdc,
    batt2DischargeVdc: form.batt2DischargeVdc,
  }).success;
  const loadValid = loadRecordSchema.safeParse({
    acProvided: form.acProvided,
    dgProvided: form.dgProvided,
    environmentDuty: form.environmentDuty,
    upsLocation: form.upsLocation,
    pcMonitorSizeIn1: form.pcMonitorSizeIn1,
    pcQty1: form.pcQty1,
    pcMonitorSizeIn2: form.pcMonitorSizeIn2,
    pcQty2: form.pcQty2,
    printerRatingW1: form.printerRatingW1,
    printerQty1: form.printerQty1,
    printerRatingW2: form.printerRatingW2,
    printerQty2: form.printerQty2,
    scannerRatingW1: form.scannerRatingW1,
    scannerQty1: form.scannerQty1,
    scannerRatingW2: form.scannerRatingW2,
    scannerQty2: form.scannerQty2,
  }).success;
  const powerValid = powerConditionSchema.safeParse({
    powerFailuresCount: form.powerFailuresCount,
    powerFailuresDurationMin: form.powerFailuresDurationMin,
    loadOnDgPercent: form.loadOnDgPercent,
    dgSetCapacityKva: form.dgSetCapacityKva,
    dgSet: form.dgSet,
    amfPanel: form.amfPanel,
    operateNonBusinessHours: form.operateNonBusinessHours,
    operateHolidays: form.operateHolidays,
  }).success;

  const handleSubmit = async (e: React.FormEvent) => {
    if (busy) return;
    e.preventDefault();
    const parsed = fieldServiceReportSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !errs[key]) errs[key] = issue.message;
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        toast.error("Not signed in");
        return;
      }
      const email = u.user.email;
      let employeeId: string | null = null;
      let engineerName = email ?? "Engineer";
      let engineerPhone: string | null = null;
      if (email) {
        const { data: emps } = await supabase
          .from("employees")
          .select("id,name,phone")
          .eq("email", email)
          .eq("active", true)
          .limit(1);
        if (emps && emps.length > 0) {
          employeeId = emps[0].id as string;
          engineerName = (emps[0].name as string) ?? email;
          engineerPhone = (emps[0].phone as string | null) ?? null;
        }
      }
      const { error } = await supabase.from("field_service_reports").insert(
        buildFsrPayload(parsed.data, ticketId, {
          employeeId,
          name: engineerName,
          phone: engineerPhone,
        }),
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Field Service Report submitted");
      await queryClient.invalidateQueries({
        queryKey: fieldServiceReportKeys.list({ ticket: ticketId }),
      });
      setForm(initialForm);
    } finally {
      setBusy(false);
    }
  };

  const latest = rows?.[0] as unknown as
    | {
        submitted_at: string;
        mains_voltage_ln: number | null;
        mains_voltage_ne: number | null;
        ups_location: string;
        power_failures_count: number | null;
        engineer_name: string | null;
      }
    | undefined;

  return (
    <div className="space-y-3">
      <form
        id="fsr-form"
        onSubmit={handleSubmit}
        className="space-y-3 pb-[calc(8rem+env(safe-area-inset-bottom,0px))]"
      >
        <section className="space-y-3">
          <SectionHeader num="1" title="Phase 1 — Readings" valid={readingsValid} />
          <div className="space-y-3">
            <FieldRow label="Voltage L-N (VAC)" required>
              <NumInput
                value={form.mainsVoltageLn}
                onChange={(v) => set("mainsVoltageLn", v)}
                placeholder="Voltage reading"
                error={errors.mainsVoltageLn}
              />
            </FieldRow>
            <FieldRow label="Voltage N-E (VAC)" required>
              <NumInput
                value={form.mainsVoltageNe}
                onChange={(v) => set("mainsVoltageNe", v)}
                placeholder="Voltage reading"
                error={errors.mainsVoltageNe}
              />
            </FieldRow>
            <FieldRow label="Battery One Voltage during Charging (Vdc)">
              <NumInput
                value={form.batt1ChargeVdc}
                onChange={(v) => set("batt1ChargeVdc", v)}
                placeholder="Voltage reading"
                error={errors.batt1ChargeVdc}
              />
            </FieldRow>
            <FieldRow label="Battery Two Voltage during Charging (Vdc)">
              <NumInput
                value={form.batt2ChargeVdc}
                onChange={(v) => set("batt2ChargeVdc", v)}
                placeholder="Voltage reading"
                error={errors.batt2ChargeVdc}
              />
            </FieldRow>
            <FieldRow label="Battery One Voltage during Discharging (Vdc)">
              <NumInput
                value={form.batt1DischargeVdc}
                onChange={(v) => set("batt1DischargeVdc", v)}
                placeholder="Voltage reading"
                error={errors.batt1DischargeVdc}
              />
            </FieldRow>
            <FieldRow label="Battery Two Voltage during Discharging (Vdc)">
              <NumInput
                value={form.batt2DischargeVdc}
                onChange={(v) => set("batt2DischargeVdc", v)}
                placeholder="Voltage reading"
                error={errors.batt2DischargeVdc}
              />
            </FieldRow>
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader num="2" title="Phase 2 — Load Record" valid={loadValid} />
          <div className="space-y-3">
            <FieldRow label="AC Provided">
              <label className="flex min-h-[44px] cursor-pointer items-center">
                <Checkbox
                  checked={form.acProvided}
                  onCheckedChange={(c) => set("acProvided", c === true)}
                  className="size-5"
                />
              </label>
            </FieldRow>
            <FieldRow label="DG Provided">
              <label className="flex min-h-[44px] cursor-pointer items-center">
                <Checkbox
                  checked={form.dgProvided}
                  onCheckedChange={(c) => set("dgProvided", c === true)}
                  className="size-5"
                />
              </label>
            </FieldRow>
            <FieldRow label="Is Environment Duty">
              <label className="flex min-h-[44px] cursor-pointer items-center">
                <Checkbox
                  checked={form.environmentDuty}
                  onCheckedChange={(c) => set("environmentDuty", c === true)}
                  className="size-5"
                />
              </label>
            </FieldRow>
            <FieldRow label="Location where UPS Installed" required>
              <div>
                <Select
                  value={form.upsLocation || undefined}
                  onValueChange={(v) => set("upsLocation", v)}
                >
                  <SelectTrigger
                    className={`h-11 min-h-[44px] w-full ${errors.upsLocation ? "border-destructive" : ""}`}
                  >
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {UPS_LOCATIONS.map((loc) => (
                      <SelectItem key={loc} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.upsLocation} />
              </div>
            </FieldRow>

            <SubHead>PC Details</SubHead>
            <FieldRow label="PC Row 1 — Monitor Size (Inch) / Qty">
              <div className="grid grid-cols-2 gap-3 max-[380px]:grid-cols-1">
                <NumInput
                  value={form.pcMonitorSizeIn1}
                  onChange={(v) => set("pcMonitorSizeIn1", v)}
                  placeholder="Monitor size"
                  error={errors.pcMonitorSizeIn1}
                />
                <NumInput
                  value={form.pcQty1}
                  onChange={(v) => set("pcQty1", v)}
                  placeholder="Qty"
                  error={errors.pcQty1}
                />
              </div>
            </FieldRow>
            <FieldRow label="PC Row 2 — Monitor Size (Inch) / Qty">
              <div className="grid grid-cols-2 gap-3 max-[380px]:grid-cols-1">
                <NumInput
                  value={form.pcMonitorSizeIn2}
                  onChange={(v) => set("pcMonitorSizeIn2", v)}
                  placeholder="Monitor size"
                  error={errors.pcMonitorSizeIn2}
                />
                <NumInput
                  value={form.pcQty2}
                  onChange={(v) => set("pcQty2", v)}
                  placeholder="Qty"
                  error={errors.pcQty2}
                />
              </div>
            </FieldRow>

            <SubHead>Printer Details</SubHead>
            <FieldRow label="Printer Row 1 — Rating (W) / Qty">
              <div className="grid grid-cols-2 gap-3 max-[380px]:grid-cols-1">
                <NumInput
                  value={form.printerRatingW1}
                  onChange={(v) => set("printerRatingW1", v)}
                  placeholder="Rating (W)"
                  error={errors.printerRatingW1}
                />
                <NumInput
                  value={form.printerQty1}
                  onChange={(v) => set("printerQty1", v)}
                  placeholder="Qty"
                  error={errors.printerQty1}
                />
              </div>
            </FieldRow>
            <FieldRow label="Printer Row 2 — Rating (W) / Qty">
              <div className="grid grid-cols-2 gap-3 max-[380px]:grid-cols-1">
                <NumInput
                  value={form.printerRatingW2}
                  onChange={(v) => set("printerRatingW2", v)}
                  placeholder="Rating (W)"
                  error={errors.printerRatingW2}
                />
                <NumInput
                  value={form.printerQty2}
                  onChange={(v) => set("printerQty2", v)}
                  placeholder="Qty"
                  error={errors.printerQty2}
                />
              </div>
            </FieldRow>

            <SubHead>Scanner Details</SubHead>
            <FieldRow label="Scanner Row 1 — Rating (W) / Qty">
              <div className="grid grid-cols-2 gap-3 max-[380px]:grid-cols-1">
                <NumInput
                  value={form.scannerRatingW1}
                  onChange={(v) => set("scannerRatingW1", v)}
                  placeholder="Rating (W)"
                  error={errors.scannerRatingW1}
                />
                <NumInput
                  value={form.scannerQty1}
                  onChange={(v) => set("scannerQty1", v)}
                  placeholder="Qty"
                  error={errors.scannerQty1}
                />
              </div>
            </FieldRow>
            <FieldRow label="Scanner Row 2 — Rating (W) / Qty">
              <div className="grid grid-cols-2 gap-3 max-[380px]:grid-cols-1">
                <NumInput
                  value={form.scannerRatingW2}
                  onChange={(v) => set("scannerRatingW2", v)}
                  placeholder="Rating (W)"
                  error={errors.scannerRatingW2}
                />
                <NumInput
                  value={form.scannerQty2}
                  onChange={(v) => set("scannerQty2", v)}
                  placeholder="Qty"
                  error={errors.scannerQty2}
                />
              </div>
            </FieldRow>
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeader num="3" title="Phase 3 — Power Condition" valid={powerValid} />
          <div className="space-y-3">
            <FieldRow label="No. of Power Failures in a Day">
              <NumInput
                value={form.powerFailuresCount}
                onChange={(v) => set("powerFailuresCount", v)}
                placeholder="Number"
                error={errors.powerFailuresCount}
              />
            </FieldRow>
            <FieldRow label="Duration of Power Failures in a Day (minutes)">
              <NumInput
                value={form.powerFailuresDurationMin}
                onChange={(v) => set("powerFailuresDurationMin", v)}
                placeholder="Duration"
                error={errors.powerFailuresDurationMin}
              />
            </FieldRow>
            <FieldRow label="Load ON DG (%)">
              <NumInput
                value={form.loadOnDgPercent}
                onChange={(v) => set("loadOnDgPercent", v)}
                placeholder="Percentage"
                error={errors.loadOnDgPercent}
              />
            </FieldRow>
            <FieldRow label="DG Set">
              <YesNo value={form.dgSet} onChange={(v) => set("dgSet", v)} label="DG Set" />
            </FieldRow>
            <FieldRow label="AMF Panel">
              <YesNo value={form.amfPanel} onChange={(v) => set("amfPanel", v)} label="AMF Panel" />
            </FieldRow>
            <FieldRow label="Operation during non-business hours">
              <YesNo
                value={form.operateNonBusinessHours}
                onChange={(v) => set("operateNonBusinessHours", v)}
                label="Operation during non-business hours"
              />
            </FieldRow>
            <FieldRow label="Operation on holidays">
              <YesNo
                value={form.operateHolidays}
                onChange={(v) => set("operateHolidays", v)}
                label="Operation on holidays"
              />
            </FieldRow>
            <FieldRow label="DG Set Capacity (kVA)">
              <NumInput
                value={form.dgSetCapacityKva}
                onChange={(v) => set("dgSetCapacityKva", v)}
                placeholder="Capacity"
                error={errors.dgSetCapacityKva}
              />
            </FieldRow>
          </div>
        </section>
      </form>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur px-4 pt-2 pb-safe">
        <div className="flex items-center gap-3 pb-2">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <PhaseDot num="1" valid={readingsValid} />
            <PhaseDot num="2" valid={loadValid} />
            <PhaseDot num="3" valid={powerValid} />
          </div>
          <Button type="submit" form="fsr-form" disabled={busy} className="h-11 flex-1">
            {busy ? "Submitting…" : "Submit Report"}
          </Button>
        </div>
      </div>

      {latestLoading && <p className="text-sm text-muted-foreground">Loading previous report…</p>}
      {latestError && (
        <p className="text-sm text-destructive">
          Could not load previous report:{" "}
          {latestError instanceof Error ? latestError.message : String(latestError)}
        </p>
      )}

      {latest && (
        <div className="rounded-xl border p-4 space-y-2 text-sm">
          <p className="text-[13px] font-medium">
            Latest submission — {new Date(latest.submitted_at).toLocaleString()}
          </p>
          <p className="text-[13px]">
            Voltage L-N: {latest.mains_voltage_ln ?? "—"} VAC · Voltage N-E:{" "}
            {latest.mains_voltage_ne ?? "—"} VAC
          </p>
          <p className="text-[13px]">
            UPS location: {latest.ups_location} · Power failures/day:{" "}
            {latest.power_failures_count ?? "—"}
          </p>
          <p className="text-[13px]">Submitted by: {latest.engineer_name ?? "—"}</p>
        </div>
      )}
    </div>
  );
}
