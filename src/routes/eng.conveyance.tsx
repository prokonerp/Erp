import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { supabase } from "@/integrations/supabase/client";
import { engKeys } from "@/lib/queryKeys";
import { compressImageToLimit } from "@/lib/image-compress";
import { CHARGE_TYPES, conveyanceLoadMessage, kmTravelled, todayLocal, type ChargeType } from "@/lib/engineer-conveyance";
import {
  deleteConveyanceExpense,
  deleteEngineerAttachment,
  saveConveyanceExpense,
  saveEngineerDailyLog,
  uploadEngineerAttachment,
} from "@/lib/engineer-conveyance.functions";
import { formatINR } from "@/lib/fsrPrint";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CardSkeleton } from "@/components/shared/skeletons";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Loader2,
  Receipt,
  Sunrise,
  Sunset,
  Trash2,
  Upload,
} from "lucide-react";

export const Route = createFileRoute("/eng/conveyance")({
  component: EngConveyance,
});

type DailyLogRow = {
  morning_odometer: number | null;
  morning_photo_path: string | null;
  evening_odometer: number | null;
  evening_photo_path: string | null;
  notes: string | null;
};

type ExpenseRow = {
  id: string;
  charge_type: string;
  amount: number;
  receipt_path: string | null;
  notes: string | null;
};

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

async function fileToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Could not read the photo");
  return base64;
}

/** Error taxonomy lives in the lib (unit-tested): see conveyanceLoadMessage. */

function PhotoPicker({
  label,
  file,
  onPick,
  disabled,
}: {
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={disabled}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-[44px] w-full"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        <Camera className="h-4 w-4 mr-1" aria-hidden />
        {file ? file.name : label}
      </Button>
    </div>
  );
}

function EngConveyance() {
  const queryClient = useQueryClient();
  const { employee } = useMyEmployee();
  const employeeId = employee?.id ?? null;
  const today = todayLocal();
  const [date, setDate] = useState(today);
  const isToday = date === today;

  const callUpload = useServerFn(uploadEngineerAttachment);
  const callSaveLog = useServerFn(saveEngineerDailyLog);
  const callDeleteUpload = useServerFn(deleteEngineerAttachment);
  const callSaveExpense = useServerFn(saveConveyanceExpense);
  const callDeleteExpense = useServerFn(deleteConveyanceExpense);

  const logKey = engKeys.conveyanceLog(employeeId, date);
  const expKey = engKeys.conveyanceExpenses(employeeId, date);

  const {
    data: log,
    isLoading: logLoading,
    isError: logError,
    error: logQueryError,
  } = useQuery({
    queryKey: logKey,
    enabled: !!employeeId,
    staleTime: 15_000,
    queryFn: async (): Promise<DailyLogRow | null> => {
      const { data, error } = await supabase
        .from("engineer_daily_logs")
        .select("morning_odometer, morning_photo_path, evening_odometer, evening_photo_path, notes")
        .eq("employee_id", employeeId!)
        .eq("log_date", date)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as DailyLogRow | null) ?? null;
    },
  });

  const { data: expenses = [], isLoading: expLoading } = useQuery({
    queryKey: expKey,
    enabled: !!employeeId,
    staleTime: 15_000,
    queryFn: async (): Promise<ExpenseRow[]> => {
      const { data, error } = await supabase
        .from("engineer_conveyance_expenses")
        .select("id, charge_type, amount, receipt_path, notes")
        .eq("employee_id", employeeId!)
        .eq("expense_date", date)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data as ExpenseRow[] | null) ?? [];
    },
  });

  // Form state mirrors the loaded log so re-saves keep prior values.
  const [morningOdo, setMorningOdo] = useState("");
  const [eveningOdo, setEveningOdo] = useState("");
  const [odoErrors, setOdoErrors] = useState<{ morning?: string; evening?: string }>({});
  // Dirty once the engineer types/picks, so background refetches can't
  // clobber mid-edit input. Cleared on successful save and day change.
  const [formDirty, setFormDirty] = useState(false);
  const [morningFile, setMorningFile] = useState<File | null>(null);
  const [eveningFile, setEveningFile] = useState<File | null>(null);
  const [saving, setSaving] = useState<"morning" | "evening" | null>(null);
  // Ref-based re-entry locks: `saving`/`expenseBusy`/`removingId` state commits
  // on re-render, so two taps in the same tick would both fire (double upload,
  // duplicate expense rows). Refs flip synchronously — second call bails.
  const savingRef = useRef<"morning" | "evening" | null>(null);

  const mirroredDateRef = useRef(date);
  useEffect(() => {
    // Skip mirroring on background refetches while the engineer is editing;
    // only fresh server values on an untouched form (or a new day) win.
    if (formDirty && mirroredDateRef.current === date) return;
    setMorningOdo(log?.morning_odometer != null ? String(log.morning_odometer) : "");
    setEveningOdo(log?.evening_odometer != null ? String(log.evening_odometer) : "");
    setMorningFile(null);
    setEveningFile(null);
    mirroredDateRef.current = date;
    setFormDirty(false);
    setOdoErrors({});
  }, [log?.morning_odometer, log?.evening_odometer, date, formDirty]);

  function clearOdoError(which: "morning" | "evening") {
    setOdoErrors((prev) => {
      if (prev[which] == null) return prev;
      const next = { ...prev };
      delete next[which];
      return next;
    });
  }

  // Expense form state.
  const [chargeType, setChargeType] = useState<ChargeType | "">("");
  const [amount, setAmount] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [expenseBusy, setExpenseBusy] = useState(false);
  const expenseBusyRef = useRef(false);

  async function uploadPhoto(
    file: File,
    kind: "morning_reading" | "evening_reading" | "receipt",
  ): Promise<string> {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowed.includes(file.type)) throw new Error("Only JPEG, PNG, WebP, HEIC images allowed");
    const compressed = await compressImageToLimit(file);
    const base64 = await fileToBase64(compressed.blob);
    const res = await callUpload({
      data: {
        kind,
        filename: compressed.name,
        content_type: compressed.contentType,
        data_base64: base64,
        date,
      },
    });
    return res.path;
  }

  async function saveHalf(which: "morning" | "evening") {
    if (!navigator.onLine) {
      toast.error("No internet connection. Reconnect and retry.");
      return;
    }
    if (savingRef.current) return;
    const odoText = which === "morning" ? morningOdo : eveningOdo;
    const file = which === "morning" ? morningFile : eveningFile;
    const existingOdo = which === "morning" ? log?.morning_odometer : log?.evening_odometer;
    const existingPhoto = which === "morning" ? log?.morning_photo_path : log?.evening_photo_path;
    if (odoText.trim() === "" && existingOdo == null) {
      toast.error(`${which === "morning" ? "Morning" : "Evening"} reading is required`);
      return;
    }
    if (!file && !existingPhoto) {
      toast.error(
        `${which === "morning" ? "Morning" : "Evening"} photo is required with the reading`,
      );
      return;
    }
    // Client-side odometer check (same rules as the zod schema) before any
    // upload, so rejects surface inline without orphaning a photo.
    const label = which === "morning" ? "Morning" : "Evening";
    const fail = (message: string) => {
      setOdoErrors((prev) => ({ ...prev, [which]: message }));
      toast.error(message);
    };
    const text = odoText.trim();
    if (text !== "") {
      const n = Number(text);
      if (!Number.isFinite(n)) {
        fail(`${label} reading must be a number`);
        return;
      }
      if (n < 0) {
        fail(`${label} reading cannot be negative`);
        return;
      }
    }
    const otherText = (which === "morning" ? eveningOdo : morningOdo).trim();
    const mText = which === "morning" ? text : otherText;
    const eText = which === "evening" ? text : otherText;
    const mNum = mText !== "" ? Number(mText) : (log?.morning_odometer ?? null);
    const eNum = eText !== "" ? Number(eText) : (log?.evening_odometer ?? null);
    if (
      typeof mNum === "number" &&
      typeof eNum === "number" &&
      Number.isFinite(mNum) &&
      Number.isFinite(eNum) &&
      eNum < mNum
    ) {
      fail("Evening reading cannot be less than the morning reading");
      return;
    }
    clearOdoError(which);
    setSaving(which);
    savingRef.current = which;
    try {
      let photoPath: string | null = existingPhoto ?? null;
      let uploadedPath: string | null = null;
      if (file) {
        photoPath = await uploadPhoto(file, `${which}_reading`);
        uploadedPath = photoPath;
      }
      try {
        await callSaveLog({
          data: {
            log_date: date,
            ...(which === "morning"
              ? {
                  morning_odometer: odoText.trim() === "" ? undefined : odoText.trim(),
                  morning_photo_path: photoPath,
                }
              : {
                  evening_odometer: odoText.trim() === "" ? undefined : odoText.trim(),
                  evening_photo_path: photoPath,
                }),
          },
        });
      } catch (saveErr) {
        // Best-effort orphan cleanup (mirrors the ticket-verification
        // delete-on-failure): never mask the original save error.
        if (uploadedPath) {
          try {
            await callDeleteUpload({ data: { path: uploadedPath } });
          } catch (cleanupErr) {
            console.warn("Conveyance photo cleanup failed:", cleanupErr);
          }
        }
        throw saveErr;
      }
      toast.success(`${which === "morning" ? "Morning" : "Evening"} entry saved`);
      setFormDirty(false);
      if (file) {
        if (which === "morning") setMorningFile(null);
        else setEveningFile(null);
      }
      await queryClient.invalidateQueries({ queryKey: logKey });
      // Dashboard shows today's km — refresh its direct-query cache too.
      await queryClient.invalidateQueries({ queryKey: engKeys.dashboardPrefix });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(null);
      savingRef.current = null;
    }
  }

  async function addExpense() {
    if (!navigator.onLine) {
      toast.error("No internet connection. Reconnect and retry.");
      return;
    }
    if (expenseBusyRef.current) return;
    if (!chargeType) {
      toast.error("Select the charge type");
      return;
    }
    if (amount.trim() === "") {
      toast.error("Enter the charges");
      return;
    }
    setExpenseBusy(true);
    expenseBusyRef.current = true;
    try {
      let receiptPath: string | null = null;
      if (receiptFile) receiptPath = await uploadPhoto(receiptFile, "receipt");
      await callSaveExpense({
        data: {
          expense_date: date,
          charge_type: chargeType,
          amount: amount.trim(),
          receipt_path: receiptPath,
          notes: notes.trim() === "" ? null : notes.trim(),
        },
      });
      toast.success("Expense added");
      setChargeType("");
      setAmount("");
      setReceiptFile(null);
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: expKey });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setExpenseBusy(false);
      expenseBusyRef.current = false;
    }
  }

  const [removingId, setRemovingId] = useState<string | null>(null);
  const removingRef = useRef<string | null>(null);

  async function removeExpense(id: string) {
    if (removingRef.current) return;
    removingRef.current = id;
    setRemovingId(id);
    try {
      await callDeleteExpense({ data: { id } });
      toast.success("Expense removed");
      await queryClient.invalidateQueries({ queryKey: expKey });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      removingRef.current = null;
      setRemovingId(null);
    }
  }

  const km =
    log != null
      ? kmTravelled({
          morning_odometer: log.morning_odometer,
          evening_odometer: log.evening_odometer,
        })
      : null;
  const dayTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Conveyance</h1>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] min-w-[44px]"
            aria-label="Previous day"
            onClick={() => setDate((d) => shiftDate(d, -1))}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-11 min-h-[44px] w-auto"
            aria-label="Conveyance date"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] min-w-[44px]"
            aria-label="Next day"
            disabled={!isToday && shiftDate(date, 1) > today}
            onClick={() => setDate((d) => (shiftDate(d, 1) > today ? d : shiftDate(d, 1)))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {logError ? (
        <Card className="rounded-xl border-amber-700/30">
          <CardContent className="p-4 text-sm text-amber-700">
            {conveyanceLoadMessage(logQueryError)}
          </CardContent>
        </Card>
      ) : null}

      {logLoading || expLoading ? (
        <div className="space-y-3" role="status" aria-busy="true">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="rounded-xl">
              <CardContent className="space-y-2 p-4">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                  <Sunrise className="h-4 w-4" aria-hidden /> Morning reading
                </p>
                {log?.morning_odometer != null ? (
                  <p className="text-[11px] font-medium text-emerald-700">
                    Saved: {log.morning_odometer} km{log.morning_photo_path ? " · photo ✓" : ""}
                  </p>
                ) : null}
                <div>
                  <Label className="text-xs">Odometer (km)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={morningOdo}
                    onChange={(e) => {
                      setMorningOdo(e.target.value);
                      setFormDirty(true);
                      clearOdoError("morning");
                    }}
                    placeholder="e.g. 12540.5"
                    className="mt-1 h-11 min-h-[44px]"
                    aria-label="Morning odometer reading"
                    aria-invalid={odoErrors.morning ? true : undefined}
                  />
                  {odoErrors.morning ? (
                    <p className="text-xs text-destructive">{odoErrors.morning}</p>
                  ) : null}
                </div>
                <PhotoPicker
                  label="Morning photo"
                  file={morningFile}
                  onPick={(f) => {
                    setMorningFile(f);
                    setFormDirty(true);
                  }}
                  disabled={saving !== null}
                />
                <Button
                  className="min-h-[44px] w-full"
                  disabled={saving !== null}
                  onClick={() => saveHalf("morning")}
                >
                  {saving === "morning" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
                  ) : null}
                  Save morning entry
                </Button>
              </CardContent>
            </Card>

            <Card className="rounded-xl">
              <CardContent className="space-y-2 p-4">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                  <Sunset className="h-4 w-4" aria-hidden /> Evening reading
                </p>
                {log?.evening_odometer != null ? (
                  <p className="text-[11px] font-medium text-emerald-700">
                    Saved: {log.evening_odometer} km{log.evening_photo_path ? " · photo ✓" : ""}
                  </p>
                ) : null}
                <div>
                  <Label className="text-xs">Odometer (km)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={eveningOdo}
                    onChange={(e) => {
                      setEveningOdo(e.target.value);
                      setFormDirty(true);
                      clearOdoError("evening");
                    }}
                    placeholder="e.g. 12615"
                    className="mt-1 h-11 min-h-[44px]"
                    aria-label="Evening odometer reading"
                    aria-invalid={odoErrors.evening ? true : undefined}
                  />
                  {odoErrors.evening ? (
                    <p className="text-xs text-destructive">{odoErrors.evening}</p>
                  ) : null}
                </div>
                <PhotoPicker
                  label="Evening photo"
                  file={eveningFile}
                  onPick={(f) => {
                    setEveningFile(f);
                    setFormDirty(true);
                  }}
                  disabled={saving !== null}
                />
                <Button
                  className="min-h-[44px] w-full"
                  disabled={saving !== null}
                  onClick={() => saveHalf("evening")}
                >
                  {saving === "evening" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
                  ) : null}
                  Save evening entry
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-xl">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Gauge className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">
                  Km travelled{isToday ? " today" : ""}
                </p>
                <p className="text-[20px] font-semibold tabular-nums leading-tight">
                  {km != null ? `${km} km` : "—"}
                </p>
                {km == null ? (
                  <p className="text-[11px] text-muted-foreground">
                    Shows here after the evening reading
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardContent className="space-y-3 p-4">
              <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                <Receipt className="h-4 w-4" aria-hidden /> Places visited · Parking · Tolls
              </p>
              <div className="space-y-2 rounded-xl border border-border p-3">
                <div>
                  <Label className="text-xs">Charge type</Label>
                  <Select value={chargeType} onValueChange={(v) => setChargeType(v as ChargeType)}>
                    <SelectTrigger className="mt-1 min-h-[44px]" aria-label="Charge type">
                      <SelectValue placeholder="Select charge type" />
                    </SelectTrigger>
                    <SelectContent>
                      {CHARGE_TYPES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Charges (₹)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 120"
                    className="mt-1 h-11 min-h-[44px]"
                    aria-label="Charges amount"
                  />
                </div>
                <PhotoPicker
                  label="Receipt photo (optional)"
                  file={receiptFile}
                  onPick={setReceiptFile}
                  disabled={expenseBusy}
                />
                <div>
                  <Label className="text-xs">Notes (optional)</Label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Toll plaza name"
                    className="mt-1 h-11 min-h-[44px]"
                    aria-label="Expense notes"
                  />
                </div>
                <Button className="min-h-[44px] w-full" disabled={expenseBusy} onClick={addExpense}>
                  {expenseBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
                  ) : (
                    <Upload className="h-4 w-4 mr-1" aria-hidden />
                  )}
                  Add expense
                </Button>
              </div>

              {expenses.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No expenses for this day.</p>
              ) : (
                <>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {expenses.map((e) => (
                      <li
                        key={e.id}
                        className="flex min-h-[44px] items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {e.charge_type} · ₹{e.amount}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[e.notes, e.receipt_path ? "receipt ✓" : null]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-[44px] min-w-[44px] shrink-0"
                          aria-label={`Remove ${e.charge_type} expense`}
                          disabled={removingId !== null}
                          onClick={() => removeExpense(e.id)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-right text-sm font-semibold tabular-nums">
                    Day total: {formatINR(dayTotal)}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
