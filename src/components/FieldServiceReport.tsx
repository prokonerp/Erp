import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  BATTERY_AH,
  BATTERY_MAKES,
  MAX_BATTERY_READINGS,
  UPS_LOCATIONS,
  buildFsrPayload,
  fieldServiceReportSchema,
  loadRecordSchema,
  partReplacementsSchema,
  powerConditionSchema,
  ratingSchema,
  readingsSchema,
} from "@/lib/fieldServiceReport";
import { fieldServiceReportKeys } from "@/lib/queryKeys";
import { syncFsrPartsToTicket } from "@/lib/sync-fsr-parts.functions";
import { finalizeFsrSubmission } from "@/lib/finalize-fsr.functions";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SignaturePad } from "./eng/SignaturePad";
import { FsrPrintButton, type FsrDbRow } from "./fsr/FsrPrintButton";

let rowSeq = 0;
const nextRowId = () => `row-${++rowSeq}`;
type VoltReading = { id: string; volts: string };
type PcDetail = { id: string; monitorSizeIn: string; qty: string };
type PrinterDetail = { id: string; ratingW: string; qty: string };
type ScannerDetail = { id: string; ratingW: string; qty: string };
type PartReplacement = {
  id: string;
  item: string;
  oldSrNo: string;
  newSrNo: string;
  charges: string;
  qty: string;
};

type FormState = {
  mainsVoltageLn: string;
  mainsVoltageNe: string;
  batteryBankMake: string;
  batteryBankAh: string;
  batteryBankQty: string;
  chargingReadings: VoltReading[];
  dischargingReadings: VoltReading[];
  acProvided: boolean | null;
  dgProvided: boolean | null;
  environmentDuty: boolean | null;
  upsLocation: string;
  pcDetails: PcDetail[];
  printerDetails: PrinterDetail[];
  scannerDetails: ScannerDetail[];
  powerFailuresCount: string;
  powerFailuresDurationMin: string;
  loadOnDgPercent: string;
  dgSetCapacityKva: string;
  dgSet: boolean | null;
  amfPanel: boolean | null;
  operateNonBusinessHours: boolean | null;
  operateHolidays: boolean | null;
  partReplacements: PartReplacement[];
  rating: string;
  customerSignaturePath: string;
  signatureCapturedAt: string;
};

const initialForm: FormState = {
  mainsVoltageLn: "",
  mainsVoltageNe: "",
  batteryBankMake: "",
  batteryBankAh: "",
  batteryBankQty: "",
  chargingReadings: [],
  dischargingReadings: [],
  acProvided: null,
  dgProvided: null,
  environmentDuty: null,
  upsLocation: "",
  pcDetails: [],
  printerDetails: [],
  scannerDetails: [],
  powerFailuresCount: "",
  powerFailuresDurationMin: "",
  loadOnDgPercent: "",
  dgSetCapacityKva: "",
  dgSet: null,
  amfPanel: null,
  operateNonBusinessHours: null,
  operateHolidays: null,
  partReplacements: [],
  rating: "",
  customerSignaturePath: "",
  signatureCapturedAt: "",
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

function FsrField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[13px] font-medium text-card-foreground">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * YesNoRequired — compulsory tri-state Yes/No. Starts with neither selected;
 * the section is only valid once the engineer picks one.
 */
function YesNoRequired({
  value,
  onChange,
  label,
  error,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  label: string;
  error?: string;
}) {
  const base =
    "flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-lg text-sm font-medium";
  return (
    <div>
      <RadioGroup
        value={value === null ? undefined : value ? "yes" : "no"}
        onValueChange={(v) => onChange(v === "yes")}
        aria-label={label}
        aria-invalid={!!error}
        className={`grid grid-cols-2 gap-1 rounded-xl border bg-muted p-1 ${error ? "border-destructive" : "border-border"}`}
      >
        <label
          className={`${base} ${value === true ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          <RadioGroupItem value="yes" className="sr-only" />
          Yes
        </label>
        <label
          className={`${base} ${value === false ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          <RadioGroupItem value="no" className="sr-only" />
          No
        </label>
      </RadioGroup>
      <FieldError message={error} />
    </div>
  );
}

/**
 * BatteryGrid — compact QTY-driven cell grid (max 4 columns per row).
 * Each cell carries a small centered "Bat N" label on its top border.
 */
function BatteryGrid({
  title,
  readings,
  onChange,
  errors,
  errorPrefix,
}: {
  title: string;
  readings: VoltReading[];
  onChange: (i: number, v: string) => void;
  errors: Record<string, string>;
  errorPrefix: "chargingReadings" | "dischargingReadings";
}) {
  if (readings.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Enter the battery Qty above — the cells generate automatically.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <SubHead>
        {title} ({readings.length})
      </SubHead>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {readings.map((reading, i) => {
          const err = errors[`${errorPrefix}.${i}.volts`];
          return (
            <div key={reading.id} className="rounded-lg border border-border bg-card">
              <p className="border-b border-border py-1 text-center text-[11px] font-medium text-muted-foreground">
                Bat {i + 1}
              </p>
              <div className="p-1.5">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={reading.volts}
                  onChange={(e) => onChange(i, e.target.value)}
                  placeholder="Vdc"
                  aria-label={`${title} battery ${i + 1} volts`}
                  aria-invalid={!!err}
                  className={`h-11 min-h-[44px] text-center ${err ? "border-destructive" : ""}`}
                />
                <FieldError message={err} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * RatingScale — linear 1-to-10 scale. Required; nothing pre-selected.
 */
function RatingScale({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div>
      <RadioGroup
        value={value || undefined}
        onValueChange={onChange}
        aria-label="Overall rating from 1 to 10"
        aria-invalid={!!error}
        className={`grid grid-cols-5 gap-1.5 sm:grid-cols-10 ${error ? "rounded-xl border border-destructive p-1" : ""}`}
      >
        {Array.from({ length: 10 }, (_, i) => String(i + 1)).map((n) => (
          <label
            key={n}
            className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold ${
              value === n
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            <RadioGroupItem value={n} className="sr-only" />
            {n}
          </label>
        ))}
      </RadioGroup>
      <FieldError message={error} />
    </div>
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
  const [submittedOk, setSubmittedOk] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const callSyncFsrParts = useServerFn(syncFsrPartsToTicket);
  const callFinalizeFsr = useServerFn(finalizeFsrSubmission);
  const {
    data: rows,
    isLoading: latestLoading,
    error: latestError,
  } = useFieldServiceReport(ticketId);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const set = (k: keyof FormState, v: string | boolean | null) =>
    setForm((f) => ({ ...f, [k]: v }));

  // QTY-driven battery cells: charging + discharging grids always mirror the
  // battery bank qty (preserving entered volts by index on grow/shrink).
  // Blank/invalid qty clears both grids.
  useEffect(() => {
    const qty = Number(form.batteryBankQty);
    const validQty =
      form.batteryBankQty.trim() !== "" &&
      Number.isInteger(qty) &&
      qty >= 1 &&
      qty <= MAX_BATTERY_READINGS
        ? qty
        : 0;
    setForm((f) => {
      if (f.chargingReadings.length === validQty && f.dischargingReadings.length === validQty)
        return f;
      const resize = (rows: VoltReading[]) =>
        Array.from({ length: validQty }, (_, i) => rows[i] ?? { id: nextRowId(), volts: "" });
      return {
        ...f,
        chargingReadings: resize(f.chargingReadings),
        dischargingReadings: resize(f.dischargingReadings),
      };
    });
  }, [form.batteryBankQty]);

  const setCharging = (i: number, v: string) =>
    setForm((f) => ({
      ...f,
      chargingReadings: f.chargingReadings.map((r, j) => (j === i ? { ...r, volts: v } : r)),
    }));

  const setDischarging = (i: number, v: string) =>
    setForm((f) => ({
      ...f,
      dischargingReadings: f.dischargingReadings.map((r, j) => (j === i ? { ...r, volts: v } : r)),
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

  const addPart = () =>
    setForm((f) =>
      f.partReplacements.length >= 5
        ? f
        : {
            ...f,
            partReplacements: [
              ...f.partReplacements,
              {
                id: nextRowId(),
                item: "",
                oldSrNo: "",
                newSrNo: "",
                charges: "",
                qty: "",
              },
            ],
          },
    );
  const removePart = (i: number) =>
    setForm((f) => ({ ...f, partReplacements: f.partReplacements.filter((_, j) => j !== i) }));
  const setPart = (i: number, k: keyof Omit<PartReplacement, "id">, v: string) =>
    setForm((f) => ({
      ...f,
      partReplacements: f.partReplacements.map((r, j) => (j === i ? { ...r, [k]: v } : r)),
    }));

  const emptyStr = (v: string) => (v.trim() === "" ? undefined : v);

  const readingsValid = readingsSchema.safeParse({
    mainsVoltageLn: form.mainsVoltageLn,
    mainsVoltageNe: form.mainsVoltageNe,
    batteryBankMake: emptyStr(form.batteryBankMake),
    batteryBankAh: emptyStr(form.batteryBankAh),
    batteryBankQty: form.batteryBankQty,
    chargingReadings: form.chargingReadings,
    dischargingReadings: form.dischargingReadings,
  }).success;
  const partValid = partReplacementsSchema.safeParse(form.partReplacements).success;
  const ratingValid = ratingSchema.safeParse(form.rating).success;
  const signatureValid = form.customerSignaturePath.trim() !== "";
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

  const offline = !isOnline;
  const offlineReason = "No internet connection. Reconnect and retry — nothing was uploaded.";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!navigator.onLine) {
      toast.error(offlineReason);
      return;
    }
    const parsed = fieldServiceReportSchema.safeParse({
      ...form,
      batteryBankMake: emptyStr(form.batteryBankMake),
      batteryBankAh: emptyStr(form.batteryBankAh),
      customerSignaturePath: form.customerSignaturePath,
      signatureCapturedAt: emptyStr(form.signatureCapturedAt),
    });
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table pending generated types (migration 20260917000003)
      const { error } = await (supabase as any).from("field_service_reports").insert(
        buildFsrPayload(parsed.data, ticketId, {
          employeeId,
          name: engineerName,
          phone: engineerPhone,
        }) as never,
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Field Service Report submitted");
      setSubmittedOk(true);
      await queryClient.invalidateQueries({
        queryKey: fieldServiceReportKeys.list({ ticket: ticketId }),
      });
      try {
        const staged = await callSyncFsrParts({ data: { ticketId } });
        const defectiveAdded = staged?.defectiveAdded ?? 0;
        const goodAdded = staged?.goodAdded ?? 0;
        if (defectiveAdded > 0 || goodAdded > 0) {
          toast.success(
            `Parts staged: ${defectiveAdded} defective received, ${goodAdded} good used`,
          );
        }
      } catch {
        toast.warning("Report saved; parts staging pending — admin can Sync FSR parts.");
      }
      // Auto-depart + auto-close: the report submit ends the site visit.
      // Failure only warns (FSR is already saved; admin can close manually).
      try {
        const done = await callFinalizeFsr({ data: { ticketId } });
        if (done?.closed) toast.success("Ticket closed");
      } catch {
        toast.warning("Report saved; auto-depart/close pending — an admin can close the ticket.");
      }
      // Prevent the view-only gate from flashing during the transition out.
      // NOTE: the submittedOk banner below stays in code but is superseded by
      // this immediate navigation (Sonner toasts persist across routes).
      setJustSubmitted(true);
      navigate({ to: "/eng/queue" });
      setForm({ ...initialForm });
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

  // View-only gate: engineers have no update/delete on FSR (RLS), so a ticket
  // with submissions renders read-only — no inputs, no submit bar. Loading
  // never renders view-only (avoids flash-before-fetch). After an admin reopen
  // deletes the rows, submissions go empty and the form returns automatically.
  const hasSubmission = (rows?.length ?? 0) > 0;
  const readOnly = !latestLoading && hasSubmission && !justSubmitted;

  if (readOnly && latest) {
    return (
      <div className="space-y-3">
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-4" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-card-foreground">
              Submitted — view only. Only an admin can reopen this report for editing.
            </p>
          </div>
        </div>

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
          <div className="flex flex-wrap gap-2 pt-1">
            <FsrPrintButton ticketId={ticketId} fsrRow={latest as unknown as FsrDbRow} />
          </div>
        </div>

        {latestError && (
          <p className="text-sm text-destructive">
            Could not load previous report:{" "}
            {latestError instanceof Error ? latestError.message : String(latestError)}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        className="sticky top-0 z-10 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5"
        aria-label="Form progress"
      >
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <PhaseDot num="1" valid={readingsValid} />
          <PhaseDot num="2" valid={loadValid} />
          <PhaseDot num="3" valid={powerValid} />
          <PhaseDot num="4" valid={signatureValid} />
          <PhaseDot num="5" valid={ratingValid} />
        </div>
        <p className="text-xs text-muted-foreground">Phases 1 · 2 · 3 · 4 · 5</p>
      </div>

      {submittedOk && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-4" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-card-foreground">
              Field Service Report submitted
            </p>
            <p className="text-[13px] text-muted-foreground">
              The latest submission summary below reflects the saved report.
            </p>
          </div>
        </div>
      )}

      <form
        id="fsr-form"
        onSubmit={handleSubmit}
        className="space-y-3 pb-[calc(8rem+env(safe-area-inset-bottom,0px))]"
      >
        <section
          aria-label="Phase 1 readings"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader num="1" title="Phase 1 — Readings" valid={readingsValid} />
          <div className="space-y-4">
            <FsrField label="Voltage L-N (VAC)" required>
              <NumInput
                value={form.mainsVoltageLn}
                onChange={(v) => set("mainsVoltageLn", v)}
                placeholder="Voltage reading"
                error={errors.mainsVoltageLn}
              />
            </FsrField>
            <FsrField label="Voltage N-E (VAC)" required>
              <NumInput
                value={form.mainsVoltageNe}
                onChange={(v) => set("mainsVoltageNe", v)}
                placeholder="Voltage reading"
                error={errors.mainsVoltageNe}
              />
            </FsrField>
            <div className="space-y-4">
              <SubHead>Battery Bank</SubHead>
              <FsrField label="Make">
                <div>
                  <Select
                    value={form.batteryBankMake || undefined}
                    onValueChange={(v) => set("batteryBankMake", v)}
                  >
                    <SelectTrigger
                      className={`h-11 min-h-[44px] w-full ${errors.batteryBankMake ? "border-destructive" : ""}`}
                    >
                      <SelectValue placeholder="Select make" />
                    </SelectTrigger>
                    <SelectContent>
                      {BATTERY_MAKES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError message={errors.batteryBankMake} />
                </div>
              </FsrField>
              <FsrField label="Ah">
                <div>
                  <Select
                    value={form.batteryBankAh || undefined}
                    onValueChange={(v) => set("batteryBankAh", v)}
                  >
                    <SelectTrigger
                      className={`h-11 min-h-[44px] w-full ${errors.batteryBankAh ? "border-destructive" : ""}`}
                    >
                      <SelectValue placeholder="Select Ah" />
                    </SelectTrigger>
                    <SelectContent>
                      {BATTERY_AH.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError message={errors.batteryBankAh} />
                </div>
              </FsrField>
              <FsrField label="Qty" required>
                <NumInput
                  value={form.batteryBankQty}
                  onChange={(v) => set("batteryBankQty", v)}
                  placeholder="Qty (1–32)"
                  error={errors.batteryBankQty}
                />
              </FsrField>
              <p className="-mt-2 text-[12px] text-muted-foreground">
                Entering the qty auto-generates the charging + discharging cells below.
              </p>
            </div>
            <BatteryGrid
              title="Reading During Charging"
              readings={form.chargingReadings}
              onChange={setCharging}
              errors={errors}
              errorPrefix="chargingReadings"
            />
            <BatteryGrid
              title="Reading During Discharging"
              readings={form.dischargingReadings}
              onChange={setDischarging}
              errors={errors}
              errorPrefix="dischargingReadings"
            />
          </div>
        </section>

        <section
          aria-label="Phase 2 load record"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader num="2" title="Phase 2 — Load Record" valid={loadValid} />
          <div className="space-y-4">
            <FsrField label="AC Provided" required>
              <YesNoRequired
                value={form.acProvided}
                onChange={(v) => set("acProvided", v)}
                label="AC Provided"
                error={errors.acProvided}
              />
            </FsrField>
            <FsrField label="DG Provided" required>
              <YesNoRequired
                value={form.dgProvided}
                onChange={(v) => set("dgProvided", v)}
                label="DG Provided"
                error={errors.dgProvided}
              />
            </FsrField>
            <FsrField label="Is Environment Duty" required>
              <YesNoRequired
                value={form.environmentDuty}
                onChange={(v) => set("environmentDuty", v)}
                label="Is Environment Duty"
                error={errors.environmentDuty}
              />
            </FsrField>
            <FsrField label="Location where UPS Installed" required>
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
            </FsrField>

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
                <div key={pc.id} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium text-card-foreground">PC {i + 1}</p>
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
                  <FsrField label="Monitor size (Inch)">
                    <NumInput
                      value={pc.monitorSizeIn}
                      onChange={(v) => setPc(i, "monitorSizeIn", v)}
                      placeholder="Monitor size"
                      error={errors[`pcDetails.${i}.monitorSizeIn`]}
                    />
                  </FsrField>
                  <FsrField label="Qty">
                    <NumInput
                      value={pc.qty}
                      onChange={(v) => setPc(i, "qty", v)}
                      placeholder="Qty"
                      error={errors[`pcDetails.${i}.qty`]}
                    />
                  </FsrField>
                </div>
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
                <div key={printer.id} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium text-card-foreground">Printer {i + 1}</p>
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
                  <FsrField label="Rating (W)">
                    <NumInput
                      value={printer.ratingW}
                      onChange={(v) => setPrinter(i, "ratingW", v)}
                      placeholder="Rating (W)"
                      error={errors[`printerDetails.${i}.ratingW`]}
                    />
                  </FsrField>
                  <FsrField label="Qty">
                    <NumInput
                      value={printer.qty}
                      onChange={(v) => setPrinter(i, "qty", v)}
                      placeholder="Qty"
                      error={errors[`printerDetails.${i}.qty`]}
                    />
                  </FsrField>
                </div>
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
                <div key={scanner.id} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium text-card-foreground">Scanner {i + 1}</p>
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
                  <FsrField label="Rating (W)">
                    <NumInput
                      value={scanner.ratingW}
                      onChange={(v) => setScanner(i, "ratingW", v)}
                      placeholder="Rating (W)"
                      error={errors[`scannerDetails.${i}.ratingW`]}
                    />
                  </FsrField>
                  <FsrField label="Qty">
                    <NumInput
                      value={scanner.qty}
                      onChange={(v) => setScanner(i, "qty", v)}
                      placeholder="Qty"
                      error={errors[`scannerDetails.${i}.qty`]}
                    />
                  </FsrField>
                </div>
              ))
            )}
          </div>
        </section>

        <section
          aria-label="Phase 3 power condition"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader num="3" title="Phase 3 — Power Condition" valid={powerValid} />
          <div className="space-y-4">
            <FsrField label="No. of Power Failures in a Day">
              <NumInput
                value={form.powerFailuresCount}
                onChange={(v) => set("powerFailuresCount", v)}
                placeholder="Number"
                error={errors.powerFailuresCount}
              />
            </FsrField>
            <FsrField label="Duration of Power Failures in a Day (minutes)">
              <NumInput
                value={form.powerFailuresDurationMin}
                onChange={(v) => set("powerFailuresDurationMin", v)}
                placeholder="Duration"
                error={errors.powerFailuresDurationMin}
              />
            </FsrField>
            <FsrField label="Load ON DG (%)">
              <NumInput
                value={form.loadOnDgPercent}
                onChange={(v) => set("loadOnDgPercent", v)}
                placeholder="Percentage"
                error={errors.loadOnDgPercent}
              />
            </FsrField>
            <FsrField label="DG Set" required>
              <YesNoRequired
                value={form.dgSet}
                onChange={(v) => set("dgSet", v)}
                label="DG Set"
                error={errors.dgSet}
              />
            </FsrField>
            <FsrField label="AMF Panel" required>
              <YesNoRequired
                value={form.amfPanel}
                onChange={(v) => set("amfPanel", v)}
                label="AMF Panel"
                error={errors.amfPanel}
              />
            </FsrField>
            <FsrField label="Operation during non-business hours" required>
              <YesNoRequired
                value={form.operateNonBusinessHours}
                onChange={(v) => set("operateNonBusinessHours", v)}
                label="Operation during non-business hours"
                error={errors.operateNonBusinessHours}
              />
            </FsrField>
            <FsrField label="Operation on holidays" required>
              <YesNoRequired
                value={form.operateHolidays}
                onChange={(v) => set("operateHolidays", v)}
                label="Operation on holidays"
                error={errors.operateHolidays}
              />
            </FsrField>
            <FsrField label="DG Set Capacity (kVA)">
              <NumInput
                value={form.dgSetCapacityKva}
                onChange={(v) => set("dgSetCapacityKva", v)}
                placeholder="Capacity"
                error={errors.dgSetCapacityKva}
              />
            </FsrField>
          </div>
        </section>

        <section
          aria-label="Part replacement details"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader num="4" title="Part Replacement Details" valid={partValid} />
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <SubHead>Parts</SubHead>
              <Button
                type="button"
                variant="outline"
                onClick={addPart}
                disabled={busy || form.partReplacements.length >= 5}
                className="min-h-[44px]"
              >
                <Plus className="size-4" /> Add
              </Button>
            </div>
            {form.partReplacements.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No part replacements — add.</p>
            ) : (
              form.partReplacements.map((part, i) => (
                <div key={part.id} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium text-card-foreground">Part {i + 1}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removePart(i)}
                      disabled={busy}
                      aria-label={`Remove part ${i + 1}`}
                      className="size-11 min-h-[44px] min-w-[44px] p-0"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <FsrField label="Item / part description">
                    <div>
                      <Input
                        type="text"
                        value={part.item}
                        onChange={(e) => setPart(i, "item", e.target.value)}
                        placeholder="Item / part description"
                        aria-invalid={!!errors[`partReplacements.${i}.item`]}
                        className={`h-11 min-h-[44px] ${errors[`partReplacements.${i}.item`] ? "border-destructive" : ""}`}
                      />
                      <FieldError message={errors[`partReplacements.${i}.item`]} />
                    </div>
                  </FsrField>
                  <FsrField label="Old Sr. No">
                    <div>
                      <Input
                        type="text"
                        value={part.oldSrNo}
                        onChange={(e) => setPart(i, "oldSrNo", e.target.value)}
                        placeholder="Old Sr. No"
                        aria-invalid={!!errors[`partReplacements.${i}.oldSrNo`]}
                        className={`h-11 min-h-[44px] ${errors[`partReplacements.${i}.oldSrNo`] ? "border-destructive" : ""}`}
                      />
                      <FieldError message={errors[`partReplacements.${i}.oldSrNo`]} />
                    </div>
                  </FsrField>
                  <FsrField label="New Sr. No">
                    <div>
                      <Input
                        type="text"
                        value={part.newSrNo}
                        onChange={(e) => setPart(i, "newSrNo", e.target.value)}
                        placeholder="New Sr. No"
                        aria-invalid={!!errors[`partReplacements.${i}.newSrNo`]}
                        className={`h-11 min-h-[44px] ${errors[`partReplacements.${i}.newSrNo`] ? "border-destructive" : ""}`}
                      />
                      <FieldError message={errors[`partReplacements.${i}.newSrNo`]} />
                    </div>
                  </FsrField>
                  <FsrField label="Charges (₹)">
                    <NumInput
                      value={part.charges}
                      onChange={(v) => setPart(i, "charges", v)}
                      placeholder="Charges (₹)"
                      error={errors[`partReplacements.${i}.charges`]}
                    />
                  </FsrField>
                  <FsrField label="Qty">
                    <NumInput
                      value={part.qty}
                      onChange={(v) => setPart(i, "qty", v)}
                      placeholder="Qty"
                      error={errors[`partReplacements.${i}.qty`]}
                    />
                  </FsrField>
                </div>
              ))
            )}
          </div>
        </section>

        <section
          aria-label="Phase 4 customer signature"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader num="4" title="Phase 4 — Customer Signature" valid={signatureValid} />
          <FsrField label="Customer signature" required>
            <div>
              <SignaturePad
                ticketId={ticketId}
                value={form.customerSignaturePath || null}
                onChange={(path) =>
                  setForm((f) => ({
                    ...f,
                    customerSignaturePath: path,
                    signatureCapturedAt: new Date().toISOString(),
                  }))
                }
              />
              <FieldError message={errors.customerSignaturePath} />
            </div>
          </FsrField>
        </section>

        <section
          aria-label="Phase 5 overall rating"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader num="5" title="Phase 5 — Overall Rating" valid={ratingValid} />
          <FsrField
            label="How would you rate this service visit? (1 = poor, 10 = excellent)"
            required
          >
            <RatingScale
              value={form.rating}
              onChange={(v) => set("rating", v)}
              error={errors.rating}
            />
          </FsrField>
        </section>
      </form>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur px-4 pt-2 pb-[env(safe-area-inset-bottom,0px)]">
        {offline && (
          <p role="status" className="pb-1 text-[13px] font-medium text-destructive">
            {offlineReason}
          </p>
        )}
        <div className="flex items-center gap-3 pb-2">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <PhaseDot num="1" valid={readingsValid} />
            <PhaseDot num="2" valid={loadValid} />
            <PhaseDot num="3" valid={powerValid} />
            <PhaseDot num="4" valid={signatureValid} />
            <PhaseDot num="5" valid={ratingValid} />
          </div>
          <Button
            type="submit"
            form="fsr-form"
            disabled={busy || offline}
            className="h-11 min-h-[44px] flex-1"
          >
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
        <div className="rounded-xl border p-4 space-y-2 text-sm mb-[calc(5rem+env(safe-area-inset-bottom,0px))]">
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
