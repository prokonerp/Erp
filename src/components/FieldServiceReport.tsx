import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { UPS_LOCATIONS, buildFsrPayload, fieldServiceReportSchema } from "@/lib/fieldServiceReport";
import { fieldServiceReportKeys } from "@/lib/queryKeys";
import { useFieldServiceReport } from "@/hooks/useFieldServiceReport";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[0.8rem] font-medium text-destructive mt-1">{message}</p>;
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
  return (
    <div>
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={error ? "border-destructive" : ""}
      />
      <FieldError message={error} />
    </div>
  );
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <RadioGroup
      value={value ? "yes" : "no"}
      onValueChange={(v) => onChange(v === "yes")}
      className="flex gap-6"
    >
      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <RadioGroupItem value="yes" /> Yes
      </label>
      <label className="flex items-center gap-2 cursor-pointer text-sm">
        <RadioGroupItem value="no" /> No
      </label>
    </RadioGroup>
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
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Field Service Report</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <Tabs defaultValue="readings" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="readings">Phase 1: Readings</TabsTrigger>
              <TabsTrigger value="load">Phase 2: Load Record</TabsTrigger>
              <TabsTrigger value="power">Phase 3: Power Condition</TabsTrigger>
            </TabsList>

            <TabsContent value="readings" className="space-y-4">
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
            </TabsContent>

            <TabsContent value="load" className="space-y-4">
              <FieldRow label="AC Provided">
                <Checkbox
                  checked={form.acProvided}
                  onCheckedChange={(c) => set("acProvided", c === true)}
                />
              </FieldRow>
              <FieldRow label="DG Provided">
                <Checkbox
                  checked={form.dgProvided}
                  onCheckedChange={(c) => set("dgProvided", c === true)}
                />
              </FieldRow>
              <FieldRow label="Is Environment Duty">
                <Checkbox
                  checked={form.environmentDuty}
                  onCheckedChange={(c) => set("environmentDuty", c === true)}
                />
              </FieldRow>
              <FieldRow label="Location where UPS Installed" required>
                <div>
                  <Select value={form.upsLocation} onValueChange={(v) => set("upsLocation", v)}>
                    <SelectTrigger
                      className={`w-full ${errors.upsLocation ? "border-destructive" : ""}`}
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

              <h3 className="font-medium text-sm text-gray-500">PC Details</h3>
              <FieldRow label="PC Row 1 — Monitor Size (Inch) / Qty">
                <div className="grid grid-cols-2 gap-2">
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
                <div className="grid grid-cols-2 gap-2">
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

              <h3 className="font-medium text-sm text-gray-500">Printer Details</h3>
              <FieldRow label="Printer Row 1 — Rating (W) / Qty">
                <div className="grid grid-cols-2 gap-2">
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
                <div className="grid grid-cols-2 gap-2">
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

              <h3 className="font-medium text-sm text-gray-500">Scanner Details</h3>
              <FieldRow label="Scanner Row 1 — Rating (W) / Qty">
                <div className="grid grid-cols-2 gap-2">
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
                <div className="grid grid-cols-2 gap-2">
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
            </TabsContent>

            <TabsContent value="power" className="space-y-4">
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
                <YesNo value={form.dgSet} onChange={(v) => set("dgSet", v)} />
              </FieldRow>
              <FieldRow label="AMF Panel">
                <YesNo value={form.amfPanel} onChange={(v) => set("amfPanel", v)} />
              </FieldRow>
              <FieldRow label="Operation during non-business hours">
                <YesNo
                  value={form.operateNonBusinessHours}
                  onChange={(v) => set("operateNonBusinessHours", v)}
                />
              </FieldRow>
              <FieldRow label="Operation on holidays">
                <YesNo value={form.operateHolidays} onChange={(v) => set("operateHolidays", v)} />
              </FieldRow>
              <FieldRow label="DG Set Capacity (kVA)">
                <NumInput
                  value={form.dgSetCapacityKva}
                  onChange={(v) => set("dgSetCapacityKva", v)}
                  placeholder="Capacity"
                  error={errors.dgSetCapacityKva}
                />
              </FieldRow>
            </TabsContent>
          </Tabs>
          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting…" : "Submit Report"}
            </Button>
          </div>
        </form>

        {latestLoading && (
          <p className="mt-6 text-sm text-muted-foreground">Loading previous report…</p>
        )}
        {latestError && (
          <p className="mt-6 text-sm text-destructive">
            Could not load previous report:{" "}
            {latestError instanceof Error ? latestError.message : String(latestError)}
          </p>
        )}

        {latest && (
          <div className="mt-6 rounded-md border p-3 text-sm space-y-1">
            <p className="font-medium">
              Latest submission — {new Date(latest.submitted_at).toLocaleString()}
            </p>
            <p>
              Voltage L-N: {latest.mains_voltage_ln ?? "—"} VAC · Voltage N-E:{" "}
              {latest.mains_voltage_ne ?? "—"} VAC
            </p>
            <p>
              UPS location: {latest.ups_location} · Power failures/day:{" "}
              {latest.power_failures_count ?? "—"}
            </p>
            <p>Submitted by: {latest.engineer_name ?? "—"}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
