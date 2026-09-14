import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
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

let rowSeq = 0;
const nextRowId = () => `row-${++rowSeq}`;
type BatteryReading = { id: string; chargeVdc: string; dischargeVdc: string };
type PcDetail = { id: string; monitorSizeIn: string; qty: string };
type PrinterDetail = { id: string; ratingW: string; qty: string };
type ScannerDetail = { id: string; ratingW: string; qty: string };

type FormState = {
  mainsVoltageLn: string;
  mainsVoltageNe: string;
  batteryReadings: BatteryReading[];
  acProvided: boolean;
  dgProvided: boolean;
  environmentDuty: boolean;
  upsLocation: string;
  pcDetails: PcDetail[];
  printerDetails: PrinterDetail[];
  scannerDetails: ScannerDetail[];
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
  batteryReadings: [],
  acProvided: false,
  dgProvided: false,
  environmentDuty: false,
  upsLocation: "",
  pcDetails: [],
  printerDetails: [],
  scannerDetails: [],
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

  const setBatteryCount = (v: string) => {
    if (v === "") {
      setForm((f) => ({ ...f, batteryReadings: [] }));
      return;
    }
    if (!/^\d+$/.test(v)) return;
    const n = parseInt(v, 10);
    if (n > 20) {
      toast.error("Maximum 20 batteries");
      return;
    }
    setForm((f) => {
      const next = [...f.batteryReadings];
      while (next.length < n) next.push({ id: nextRowId(), chargeVdc: "", dischargeVdc: "" });
      return { ...f, batteryReadings: next.slice(0, n) };
    });
  };

  const setReading = (i: number, k: keyof BatteryReading, v: string) =>
    setForm((f) => ({
      ...f,
      batteryReadings: f.batteryReadings.map((r, j) => (j === i ? { ...r, [k]: v } : r)),
    }));

  const addPc = () =>
    setForm((f) =>
      f.pcDetails.length >= 20
        ? f
        : {
            ...f,
            pcDetails: [...f.pcDetails, { id: nextRowId(), monitorSizeIn: "", qty: "" }],
          },
    );
  const removePc = (i: number) =>
    setForm((f) => ({ ...f, pcDetails: f.pcDetails.filter((_, j) => j !== i) }));
  const setPc = (i: number, k: keyof PcDetail, v: string) =>
    setForm((f) => ({
      ...f,
      pcDetails: f.pcDetails.map((r, j) => (j === i ? { ...r, [k]: v } : r)),
    }));

  const addPrinter = () =>
    setForm((f) =>
      f.printerDetails.length >= 20
        ? f
        : {
            ...f,
            printerDetails: [...f.printerDetails, { id: nextRowId(), ratingW: "", qty: "" }],
          },
    );
  const removePrinter = (i: number) =>
    setForm((f) => ({ ...f, printerDetails: f.printerDetails.filter((_, j) => j !== i) }));
  const setPrinter = (i: number, k: keyof PrinterDetail, v: string) =>
    setForm((f) => ({
      ...f,
      printerDetails: f.printerDetails.map((r, j) => (j === i ? { ...r, [k]: v } : r)),
    }));

  const addScanner = () =>
    setForm((f) =>
      f.scannerDetails.length >= 20
        ? f
        : {
            ...f,
            scannerDetails: [...f.scannerDetails, { id: nextRowId(), ratingW: "", qty: "" }],
          },
    );
  const removeScanner = (i: number) =>
    setForm((f) => ({ ...f, scannerDetails: f.scannerDetails.filter((_, j) => j !== i) }));
  const setScanner = (i: number, k: keyof ScannerDetail, v: string) =>
    setForm((f) => ({
      ...f,
      scannerDetails: f.scannerDetails.map((r, j) => (j === i ? { ...r, [k]: v } : r)),
    }));

  const readingsValid = readingsSchema.safeParse({
    mainsVoltageLn: form.mainsVoltageLn,
    mainsVoltageNe: form.mainsVoltageNe,
    batteryReadings: form.batteryReadings,
  }).success;
  const loadValid = loadRecordSchema.safeParse({
    acProvided: form.acProvided,
    dgProvided: form.dgProvided,
    environmentDuty: form.environmentDuty,
    upsLocation: form.upsLocation,
    pcDetails: form.pcDetails,
    printerDetails: form.printerDetails,
    scannerDetails: form.scannerDetails,
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
        const key = issue.path.join(".");
        if (key && !errs[key]) errs[key] = issue.message;
      }
      setErrors(errs);
      const topLevel = Object.entries(errs).find(([k]) => !k.includes("."));
      if (topLevel) toast.error(topLevel[1]);
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
            <FieldRow label="No. of Batteries">
              <NumInput
                value={String(form.batteryReadings.length)}
                onChange={setBatteryCount}
                placeholder="0"
                error={errors.batteryReadings}
              />
            </FieldRow>
            {form.batteryReadings.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No batteries recorded — enter a count above.
              </p>
            ) : (
              form.batteryReadings.map((reading, i) => (
                <FieldRow
                  key={reading.id}
                  label={`Battery ${i + 1} — Charging / Discharging (Vdc)`}
                >
                  <div className="grid grid-cols-2 gap-3 max-[380px]:grid-cols-1">
                    <NumInput
                      value={reading.chargeVdc}
                      onChange={(v) => setReading(i, "chargeVdc", v)}
                      placeholder="Charging (Vdc)"
                      error={errors[`batteryReadings.${i}.chargeVdc`]}
                    />
                    <NumInput
                      value={reading.dischargeVdc}
                      onChange={(v) => setReading(i, "dischargeVdc", v)}
                      placeholder="Discharging (Vdc)"
                      error={errors[`batteryReadings.${i}.dischargeVdc`]}
                    />
                  </div>
                </FieldRow>
              ))
            )}
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

            <div className="flex items-center justify-between gap-3">
              <SubHead>PC Details</SubHead>
              <Button
                type="button"
                variant="outline"
                onClick={addPc}
                disabled={busy || form.pcDetails.length >= 20}
                className="min-h-[44px]"
              >
                <Plus className="size-4" /> Add PC
              </Button>
            </div>
            {form.pcDetails.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No PCs at site.</p>
            ) : (
              form.pcDetails.map((pc, i) => (
                <FieldRow key={pc.id} label={`PC ${i + 1} — Monitor Size (Inch) / Qty`}>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-3 max-[380px]:grid-cols-1">
                    <NumInput
                      value={pc.monitorSizeIn}
                      onChange={(v) => setPc(i, "monitorSizeIn", v)}
                      placeholder="Monitor size"
                      error={errors[`pcDetails.${i}.monitorSizeIn`]}
                    />
                    <NumInput
                      value={pc.qty}
                      onChange={(v) => setPc(i, "qty", v)}
                      placeholder="Qty"
                      error={errors[`pcDetails.${i}.qty`]}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removePc(i)}
                      disabled={busy}
                      aria-label={`Remove PC ${i + 1}`}
                      className="size-11 min-h-[44px] min-w-[44px] p-0"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </FieldRow>
              ))
            )}

            <div className="flex items-center justify-between gap-3">
              <SubHead>Printer Details</SubHead>
              <Button
                type="button"
                variant="outline"
                onClick={addPrinter}
                disabled={busy || form.printerDetails.length >= 20}
                className="min-h-[44px]"
              >
                <Plus className="size-4" /> Add Printer
              </Button>
            </div>
            {form.printerDetails.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No printers at site.</p>
            ) : (
              form.printerDetails.map((printer, i) => (
                <FieldRow key={printer.id} label={`Printer ${i + 1} — Rating (W) / Qty`}>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-3 max-[380px]:grid-cols-1">
                    <NumInput
                      value={printer.ratingW}
                      onChange={(v) => setPrinter(i, "ratingW", v)}
                      placeholder="Rating (W)"
                      error={errors[`printerDetails.${i}.ratingW`]}
                    />
                    <NumInput
                      value={printer.qty}
                      onChange={(v) => setPrinter(i, "qty", v)}
                      placeholder="Qty"
                      error={errors[`printerDetails.${i}.qty`]}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removePrinter(i)}
                      disabled={busy}
                      aria-label={`Remove Printer ${i + 1}`}
                      className="size-11 min-h-[44px] min-w-[44px] p-0"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </FieldRow>
              ))
            )}

            <div className="flex items-center justify-between gap-3">
              <SubHead>Scanner Details</SubHead>
              <Button
                type="button"
                variant="outline"
                onClick={addScanner}
                disabled={busy || form.scannerDetails.length >= 20}
                className="min-h-[44px]"
              >
                <Plus className="size-4" /> Add Scanner
              </Button>
            </div>
            {form.scannerDetails.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No scanners at site.</p>
            ) : (
              form.scannerDetails.map((scanner, i) => (
                <FieldRow key={scanner.id} label={`Scanner ${i + 1} — Rating (W) / Qty`}>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-3 max-[380px]:grid-cols-1">
                    <NumInput
                      value={scanner.ratingW}
                      onChange={(v) => setScanner(i, "ratingW", v)}
                      placeholder="Rating (W)"
                      error={errors[`scannerDetails.${i}.ratingW`]}
                    />
                    <NumInput
                      value={scanner.qty}
                      onChange={(v) => setScanner(i, "qty", v)}
                      placeholder="Qty"
                      error={errors[`scannerDetails.${i}.qty`]}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeScanner(i)}
                      disabled={busy}
                      aria-label={`Remove Scanner ${i + 1}`}
                      className="size-11 min-h-[44px] min-w-[44px] p-0"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </FieldRow>
              ))
            )}
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
