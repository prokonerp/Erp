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
  UPS_LOCATIONS,
  buildFsrPayload,
  fieldServiceReportSchema,
  frontIndicationSchema,
  loadRecordSchema,
  partReplacementsSchema,
  powerConditionSchema,
  readingsSchema,
} from "@/lib/fieldServiceReport";
import { fieldServiceReportKeys } from "@/lib/queryKeys";
import { syncFsrPartsToTicket } from "@/lib/sync-fsr-parts.functions";
import { useFieldServiceReport } from "@/hooks/useFieldServiceReport";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { SignaturePad } from "./eng/SignaturePad";

let rowSeq = 0;
const nextRowId = () => `row-${++rowSeq}`;
type VoltReading = { id: string; volts: string };
type FrontIndicationState = {
  opMode: string;
  bypassState: string;
  leadFound: string;
  leadCorrected: string;
  chargeFound: string;
  chargeCorrected: string;
  fault0Found: string;
  fault0Corrected: string;
  faultGeFound: string;
  faultGeCorrected: string;
  remarks: string;
  remarksTarget: string;
};
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
  oldBarcode: string;
  newChallan: string;
};

type FormState = {
  mainsVoltageLn: string;
  mainsVoltageNe: string;
  batteryBankMake: string;
  batteryBankAh: string;
  batteryBankQty: string;
  chargingReadings: VoltReading[];
  dischargingReadings: VoltReading[];
  frontIndication: FrontIndicationState;
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
  partReplacements: PartReplacement[];
  customerSignaturePath: string;
  signatureCapturedAt: string;
};

const initialFrontIndication: FrontIndicationState = {
  opMode: "",
  bypassState: "",
  leadFound: "",
  leadCorrected: "",
  chargeFound: "",
  chargeCorrected: "",
  fault0Found: "",
  fault0Corrected: "",
  faultGeFound: "",
  faultGeCorrected: "",
  remarks: "",
  remarksTarget: "",
};

const initialForm: FormState = {
  mainsVoltageLn: "",
  mainsVoltageNe: "",
  batteryBankMake: "",
  batteryBankAh: "",
  batteryBankQty: "",
  chargingReadings: [],
  dischargingReadings: [],
  frontIndication: initialFrontIndication,
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
  partReplacements: [],
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

function YesNo({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  const base =
    "flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-lg text-sm font-medium";
  return (
    <RadioGroup
      value={value ? "yes" : "no"}
      onValueChange={(v) => onChange(v === "yes")}
      aria-label={label}
      className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted p-1"
    >
      <label
        className={`${base} ${value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
      >
        <RadioGroupItem value="yes" className="sr-only" />
        Yes
      </label>
      <label
        className={`${base} ${!value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
      >
        <RadioGroupItem value="no" className="sr-only" />
        No
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
  const [submittedOk, setSubmittedOk] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const callSyncFsrParts = useServerFn(syncFsrPartsToTicket);
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

  const set = (k: keyof FormState, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const setFront = (k: keyof FrontIndicationState, v: string) =>
    setForm((f) => ({ ...f, frontIndication: { ...f.frontIndication, [k]: v } }));

  const addCharging = () =>
    setForm((f) =>
      f.chargingReadings.length >= 20
        ? f
        : { ...f, chargingReadings: [...f.chargingReadings, { id: nextRowId(), volts: "" }] },
    );
  const removeCharging = (i: number) =>
    setForm((f) => ({ ...f, chargingReadings: f.chargingReadings.filter((_, j) => j !== i) }));
  const setCharging = (i: number, v: string) =>
    setForm((f) => ({
      ...f,
      chargingReadings: f.chargingReadings.map((r, j) => (j === i ? { ...r, volts: v } : r)),
    }));

  const addDischarging = () =>
    setForm((f) =>
      f.dischargingReadings.length >= 20
        ? f
        : {
            ...f,
            dischargingReadings: [...f.dischargingReadings, { id: nextRowId(), volts: "" }],
          },
    );
  const removeDischarging = (i: number) =>
    setForm((f) => ({
      ...f,
      dischargingReadings: f.dischargingReadings.filter((_, j) => j !== i),
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
                oldBarcode: "",
                newChallan: "",
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
  const frontValid = frontIndicationSchema.safeParse({
    ...form.frontIndication,
    opMode: emptyStr(form.frontIndication.opMode),
    bypassState: emptyStr(form.frontIndication.bypassState),
    remarksTarget: emptyStr(form.frontIndication.remarksTarget),
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
  const partValid = partReplacementsSchema.safeParse(form.partReplacements).success;
  const signatureValid = form.customerSignaturePath.trim() !== "";

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
      frontIndication: {
        ...form.frontIndication,
        opMode: emptyStr(form.frontIndication.opMode),
        bypassState: emptyStr(form.frontIndication.bypassState),
        remarksTarget: emptyStr(form.frontIndication.remarksTarget),
      },
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
      // Prevent the view-only gate from flashing during the transition out.
      // NOTE: the submittedOk banner below stays in code but is superseded by
      // this immediate navigation (Sonner toasts persist across routes).
      setJustSubmitted(true);
      navigate({ to: "/eng/queue" });
      setForm({
        ...initialForm,
        chargingReadings: [],
        dischargingReadings: [],
        frontIndication: { ...initialFrontIndication },
        partReplacements: [],
        customerSignaturePath: "",
        signatureCapturedAt: "",
      });
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
          <PhaseDot num="1A" valid={frontValid} />
          <PhaseDot num="2" valid={loadValid} />
          <PhaseDot num="3" valid={powerValid} />
          <PhaseDot num="4" valid={signatureValid} />
        </div>
        <p className="text-xs text-muted-foreground">Phases 1 · 1A · 2 · 3 · 4</p>
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
              <FsrField label="Qty">
                <NumInput
                  value={form.batteryBankQty}
                  onChange={(v) => set("batteryBankQty", v)}
                  placeholder="Qty"
                  error={errors.batteryBankQty}
                />
              </FsrField>
            </div>
            <div className="flex items-center justify-between gap-3">
              <SubHead>Reading During Charging</SubHead>
              <Button
                type="button"
                variant="outline"
                onClick={addCharging}
                disabled={busy || form.chargingReadings.length >= 20}
                className="min-h-[44px]"
              >
                <Plus className="size-4" /> Add
              </Button>
            </div>
            {form.chargingReadings.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No charging readings — add.</p>
            ) : (
              form.chargingReadings.map((reading, i) => (
                <div
                  key={reading.id}
                  className="space-y-2 rounded-xl border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium text-card-foreground">Battery {i + 1}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeCharging(i)}
                      disabled={busy}
                      aria-label={`Remove charging battery ${i + 1}`}
                      className="size-11 min-h-[44px] min-w-[44px] p-0"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <FsrField label="Volts (Vdc)">
                    <NumInput
                      value={reading.volts}
                      onChange={(v) => setCharging(i, v)}
                      placeholder="Volts (Vdc)"
                      error={errors[`chargingReadings.${i}.volts`]}
                    />
                  </FsrField>
                </div>
              ))
            )}
            <div className="flex items-center justify-between gap-3">
              <SubHead>Reading During Discharging</SubHead>
              <Button
                type="button"
                variant="outline"
                onClick={addDischarging}
                disabled={busy || form.dischargingReadings.length >= 20}
                className="min-h-[44px]"
              >
                <Plus className="size-4" /> Add
              </Button>
            </div>
            {form.dischargingReadings.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No discharging readings — add.</p>
            ) : (
              form.dischargingReadings.map((reading, i) => (
                <div
                  key={reading.id}
                  className="space-y-2 rounded-xl border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium text-card-foreground">Battery {i + 1}</p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => removeDischarging(i)}
                      disabled={busy}
                      aria-label={`Remove discharging battery ${i + 1}`}
                      className="size-11 min-h-[44px] min-w-[44px] p-0"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <FsrField label="Volts (Vdc)">
                    <NumInput
                      value={reading.volts}
                      onChange={(v) => setDischarging(i, v)}
                      placeholder="Volts (Vdc)"
                      error={errors[`dischargingReadings.${i}.volts`]}
                    />
                  </FsrField>
                </div>
              ))
            )}
          </div>
        </section>

        <section
          aria-label="Phase 1A front indication"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader num="1A" title="Phase 1A — Front Indication" valid={frontValid} />
          <div className="space-y-3">
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Operating Mode</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Normal: On Mains
                </span>
              </div>
              <RadioGroup
                value={form.frontIndication.opMode || undefined}
                onValueChange={(v) => setFront("opMode", v)}
                aria-label="Operating mode"
                className="flex gap-6"
              >
                <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm">
                  <RadioGroupItem value="on_mains" className="size-5" /> On Mains
                </label>
                <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm">
                  <RadioGroupItem value="on_battery" className="size-5" /> On Battery
                </label>
              </RadioGroup>
              <FieldError message={errors["frontIndication.opMode"]} />
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Bypass State</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Normal: No Bypass
                </span>
              </div>
              <RadioGroup
                value={form.frontIndication.bypassState || undefined}
                onValueChange={(v) => setFront("bypassState", v)}
                aria-label="Bypass state"
                className="flex gap-6"
              >
                <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm">
                  <RadioGroupItem value="on_bypass" className="size-5" /> On Bypass
                </label>
                <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm">
                  <RadioGroupItem value="dead" className="size-5" /> Dead
                </label>
              </RadioGroup>
              <FieldError message={errors["frontIndication.bypassState"]} />
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Lead</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Normal: Off
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 max-[390px]:grid-cols-1">
                <NumInput
                  value={form.frontIndication.leadFound}
                  onChange={(v) => setFront("leadFound", v)}
                  placeholder="Found"
                  error={errors["frontIndication.leadFound"]}
                />
                <NumInput
                  value={form.frontIndication.leadCorrected}
                  onChange={(v) => setFront("leadCorrected", v)}
                  placeholder="Corrected"
                  error={errors["frontIndication.leadCorrected"]}
                />
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Charge</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Normal: On
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 max-[390px]:grid-cols-1">
                <NumInput
                  value={form.frontIndication.chargeFound}
                  onChange={(v) => setFront("chargeFound", v)}
                  placeholder="Found"
                  error={errors["frontIndication.chargeFound"]}
                />
                <NumInput
                  value={form.frontIndication.chargeCorrected}
                  onChange={(v) => setFront("chargeCorrected", v)}
                  placeholder="Corrected"
                  error={errors["frontIndication.chargeCorrected"]}
                />
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Fault 0</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Normal: Off
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 max-[390px]:grid-cols-1">
                <NumInput
                  value={form.frontIndication.fault0Found}
                  onChange={(v) => setFront("fault0Found", v)}
                  placeholder="Found"
                  error={errors["frontIndication.fault0Found"]}
                />
                <NumInput
                  value={form.frontIndication.fault0Corrected}
                  onChange={(v) => setFront("fault0Corrected", v)}
                  placeholder="Corrected"
                  error={errors["frontIndication.fault0Corrected"]}
                />
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Fault GE</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  Normal: Off
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 max-[390px]:grid-cols-1">
                <NumInput
                  value={form.frontIndication.faultGeFound}
                  onChange={(v) => setFront("faultGeFound", v)}
                  placeholder="Found"
                  error={errors["frontIndication.faultGeFound"]}
                />
                <NumInput
                  value={form.frontIndication.faultGeCorrected}
                  onChange={(v) => setFront("faultGeCorrected", v)}
                  placeholder="Corrected"
                  error={errors["frontIndication.faultGeCorrected"]}
                />
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <span className="text-sm font-medium">Remarks</span>
              <RadioGroup
                value={form.frontIndication.remarksTarget || undefined}
                onValueChange={(v) => setFront("remarksTarget", v)}
                aria-label="Remarks target"
                className="flex flex-wrap gap-6"
              >
                <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm">
                  <RadioGroupItem value="UPS" className="size-5" /> UPS
                </label>
                <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm">
                  <RadioGroupItem value="PCB" className="size-5" /> PCB
                </label>
                <label className="flex min-h-[44px] items-center gap-3 cursor-pointer text-sm">
                  <RadioGroupItem value="Transformer" className="size-5" /> Transformer
                </label>
              </RadioGroup>
              <FieldError message={errors["frontIndication.remarksTarget"]} />
              <Textarea
                value={form.frontIndication.remarks}
                onChange={(e) => setFront("remarks", e.target.value)}
                placeholder="Remarks"
                rows={3}
                aria-invalid={!!errors["frontIndication.remarks"]}
                className={`min-h-[44px] ${errors["frontIndication.remarks"] ? "border-destructive" : ""}`}
              />
              <FieldError message={errors["frontIndication.remarks"]} />
            </div>
          </div>
        </section>

        <section
          aria-label="Phase 2 load record"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <SectionHeader num="2" title="Phase 2 — Load Record" valid={loadValid} />
          <div className="space-y-4">
            <FsrField label="AC Provided">
              <label className="flex min-h-[44px] cursor-pointer items-center">
                <Checkbox
                  checked={form.acProvided}
                  onCheckedChange={(c) => set("acProvided", c === true)}
                  className="size-5"
                />
              </label>
            </FsrField>
            <FsrField label="DG Provided">
              <label className="flex min-h-[44px] cursor-pointer items-center">
                <Checkbox
                  checked={form.dgProvided}
                  onCheckedChange={(c) => set("dgProvided", c === true)}
                  className="size-5"
                />
              </label>
            </FsrField>
            <FsrField label="Is Environment Duty">
              <label className="flex min-h-[44px] cursor-pointer items-center">
                <Checkbox
                  checked={form.environmentDuty}
                  onCheckedChange={(c) => set("environmentDuty", c === true)}
                  className="size-5"
                />
              </label>
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
            <FsrField label="DG Set">
              <YesNo value={form.dgSet} onChange={(v) => set("dgSet", v)} label="DG Set" />
            </FsrField>
            <FsrField label="AMF Panel">
              <YesNo value={form.amfPanel} onChange={(v) => set("amfPanel", v)} label="AMF Panel" />
            </FsrField>
            <FsrField label="Operation during non-business hours">
              <YesNo
                value={form.operateNonBusinessHours}
                onChange={(v) => set("operateNonBusinessHours", v)}
                label="Operation during non-business hours"
              />
            </FsrField>
            <FsrField label="Operation on holidays">
              <YesNo
                value={form.operateHolidays}
                onChange={(v) => set("operateHolidays", v)}
                label="Operation on holidays"
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
                  <FsrField label="Old defective barcode">
                    <div>
                      <Input
                        type="text"
                        value={part.oldBarcode}
                        onChange={(e) => setPart(i, "oldBarcode", e.target.value)}
                        placeholder="Old defective barcode"
                        aria-invalid={!!errors[`partReplacements.${i}.oldBarcode`]}
                        className={`h-11 min-h-[44px] ${errors[`partReplacements.${i}.oldBarcode`] ? "border-destructive" : ""}`}
                      />
                      <FieldError message={errors[`partReplacements.${i}.oldBarcode`]} />
                    </div>
                  </FsrField>
                  <FsrField label="New challan no.">
                    <div>
                      <Input
                        type="text"
                        value={part.newChallan}
                        onChange={(e) => setPart(i, "newChallan", e.target.value)}
                        placeholder="New challan no."
                        aria-invalid={!!errors[`partReplacements.${i}.newChallan`]}
                        className={`h-11 min-h-[44px] ${errors[`partReplacements.${i}.newChallan`] ? "border-destructive" : ""}`}
                      />
                      <FieldError message={errors[`partReplacements.${i}.newChallan`]} />
                    </div>
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
            <PhaseDot num="1A" valid={frontValid} />
            <PhaseDot num="2" valid={loadValid} />
            <PhaseDot num="3" valid={powerValid} />
            <PhaseDot num="4" valid={signatureValid} />
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
