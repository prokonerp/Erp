import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { reportDbError } from "@/lib/format-error";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys, engKeys } from "@/lib/queryKeys";
import { compressImageToLimit } from "@/lib/image-compress";
import {
  conveyanceLoadMessage,
  kmTravelled,
  todayLocal,
  type ChargeType,
} from "@/lib/engineer-conveyance";
import {
  deleteEngineerAttachment,
  saveConveyanceExpense,
  saveEngineerDailyLog,
  uploadEngineerAttachment,
} from "@/lib/engineer-conveyance.functions";
import { MAX_ACCEPTED_BYTES, acceptedUploadMessage } from "@/lib/upload-limits";
import { expenseFingerprint, nextExpenseKey, type ExpenseKeyState } from "@/lib/expense-client-key";
import { formatINR } from "@/lib/fsrPrint";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** Signed-URL cache for locked-card photo previews (path -> { url, expiresAt }). */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

function SavedPhoto({ path, alt }: { path: string | null; alt: string }) {
  const [url, setUrl] = useState<string | null>(() => {
    if (!path) return null;
    const cached = signedUrlCache.get(path);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      signedUrlCache.delete(path);
      return null;
    }
    return cached.url;
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() => {
    if (!path) return "loading";
    const cached = signedUrlCache.get(path);
    if (!cached) return "loading";
    if (cached.expiresAt <= Date.now()) {
      signedUrlCache.delete(path);
      return "loading";
    }
    return "ready";
  });

  useEffect(() => {
    if (!path) {
      setStatus("error");
      setUrl(null);
      return;
    }
    const cached = signedUrlCache.get(path);
    if (cached) {
      if (cached.expiresAt <= Date.now()) {
        signedUrlCache.delete(path);
      } else {
        setUrl(cached.url);
        setStatus("ready");
        return;
      }
    }
    let cancelled = false;
    setStatus("loading");
    supabase.storage
      .from("engineer-uploads")
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) {
          setStatus("error");
        } else {
          if (signedUrlCache.size >= 25) {
            const oldest = signedUrlCache.keys().next().value;
            if (oldest !== undefined) signedUrlCache.delete(oldest);
          }
          signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 3500 * 1000 });
          setUrl(data.signedUrl);
          setStatus("ready");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) {
    return null;
  }
  if (status === "error") {
    return <p className="text-xs text-muted-foreground">Photo unavailable</p>;
  }
  if (status === "loading" || !url) {
    return <p className="text-xs text-muted-foreground">Loading photo…</p>;
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setStatus("error")}
      className="h-24 w-auto rounded-lg border border-border object-cover"
    />
  );
}

function ExpenseSection({
  title,
  charge,
  entries,
  busy,
  onAdd,
}: {
  title: string;
  charge: ChargeType;
  entries: ExpenseRow[];
  busy: boolean;
  onAdd: (
    charge: ChargeType,
    form: { amount: string; receiptFile: File | null; notes: string; reset: () => void },
  ) => void;
}) {
  const [amount, setAmount] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const subtotal = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  return (
    <Card className="rounded-xl">
      <CardContent className="space-y-3 p-4">
        <p className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Receipt className="h-4 w-4" aria-hidden /> {title}
        </p>
        <div className="space-y-2 rounded-xl border border-border p-3">
          <div>
            <Label className="text-xs">Charges (₹)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 120"
              className="mt-1 h-11 min-h-[44px]"
              aria-label={`${title} amount`}
            />
          </div>
          <PhotoPicker
            label="Receipt photo (optional)"
            file={receiptFile}
            onPick={setReceiptFile}
            disabled={busy}
          />
          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Toll plaza name"
              className="mt-1 h-11 min-h-[44px]"
              aria-label={`${title} notes`}
            />
          </div>
          <Button
            className="min-h-[44px] w-full"
            disabled={busy}
            onClick={() =>
              onAdd(charge, {
                amount,
                receiptFile,
                notes,
                reset: () => {
                  setAmount("");
                  setReceiptFile(null);
                  setNotes("");
                },
              })
            }
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
            ) : (
              <Upload className="h-4 w-4 mr-1" aria-hidden />
            )}
            Add expense
          </Button>
        </div>

        {entries.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No {title.toLowerCase()} expenses for this day.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex min-h-[44px] items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {e.charge_type} · ₹{e.amount}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[e.notes, e.receipt_path ? "receipt ✓" : null].filter(Boolean).join(" · ") ||
                        "—"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-right text-sm font-semibold tabular-nums">
              {title} subtotal: {formatINR(subtotal)}
            </p>
          </>
        )}
      </CardContent>
    </Card>
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
  // Ref-based re-entry locks: `saving`/`expenseBusy` state commits
  // on re-render, so two taps in the same tick would both fire (double upload,
  // duplicate expense rows). Refs flip synchronously — second call bails.
  const savingRef = useRef<"morning" | "evening" | null>(null);
  const [morningReviewing, setMorningReviewing] = useState(false);
  const [eveningReviewing, setEveningReviewing] = useState(false);
  const [morningPreviewUrl, setMorningPreviewUrl] = useState<string | null>(null);
  const [eveningPreviewUrl, setEveningPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!morningFile) {
      setMorningPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(morningFile);
    setMorningPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [morningFile]);

  useEffect(() => {
    if (!eveningFile) {
      setEveningPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(eveningFile);
    setEveningPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [eveningFile]);

  useEffect(() => {
    setMorningReviewing(false);
    setEveningReviewing(false);
    setOdoErrors({});
  }, [date]);

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

  function validateOdo(which: "morning" | "evening"): string | null {
    const odoText = which === "morning" ? morningOdo : eveningOdo;
    const existingOdo = which === "morning" ? log?.morning_odometer : log?.evening_odometer;
    const label = which === "morning" ? "Morning" : "Evening";
    const text = odoText.trim();
    if (text === "") {
      if (existingOdo == null) return `${label} reading is required`;
    } else {
      const n = Number(text);
      if (!Number.isFinite(n)) return `${label} reading must be a number`;
      if (n < 0) return `${label} reading cannot be negative`;
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
      return "Evening reading cannot be less than the morning reading";
    }
    return null;
  }

  // Shared add-expense lock: the three ExpenseSection forms hold their own
  // amount/receipt/notes state, but only one add runs at a time.
  const [expenseBusy, setExpenseBusy] = useState(false);
  const expenseBusyRef = useRef(false);

  // Expense idempotency key: fingerprint-aware. The {key, fingerprint}
  // pair is minted lazily at submit via nextExpenseKey — the same payload
  // reuses the key (in-flight retry / double-tap dedupes on client_key),
  // any payload change mints a fresh key so an edited resubmit after a
  // client-side timeout never hits ON CONFLICT DO NOTHING on a stale row.
  // Reset only after a successful save.
  const expenseKeyRef = useRef<ExpenseKeyState | null>(null);

  async function uploadPhoto(
    file: File,
    kind: "morning_reading" | "evening_reading" | "receipt",
    label?: string,
  ): Promise<string> {
    if (file.size > MAX_ACCEPTED_BYTES) throw new Error(acceptedUploadMessage());
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowed.includes(file.type)) throw new Error("Only JPEG, PNG, WebP, HEIC images allowed");
    const compressed = await compressImageToLimit(
      file,
      kind === "receipt" ? { preset: "document" } : undefined,
    );
    const base64 = await fileToBase64(compressed.blob);
    const res = await callUpload({
      data: {
        kind,
        filename: compressed.name,
        content_type: compressed.contentType,
        data_base64: base64,
        date,
        ...(label ? { label } : {}),
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
    const fail = (message: string) => {
      setOdoErrors((prev) => ({ ...prev, [which]: message }));
      toast.error(message);
    };
    const err = validateOdo(which);
    if (err) {
      fail(err);
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
      // Same-day edits feed the admin-eng payables/conveyance matrix,
      // attention queue, and overview — bust those families too (no payables
      // *Prefix factory exists, so use the family prefix).
      await queryClient.invalidateQueries({ queryKey: adminEngKeys.conveyancePrefix });
      await queryClient.invalidateQueries({ queryKey: ["admin-eng", "payables"] });
      await queryClient.invalidateQueries({ queryKey: adminEngKeys.attentionPrefix });
      await queryClient.invalidateQueries({ queryKey: adminEngKeys.overviewPrefix });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already confirmed and locked")) {
        await queryClient.invalidateQueries({ queryKey: logKey });
        if (typeof (toast as unknown as { message?: unknown }).message === "function") {
          (toast as unknown as { message: (msg: string) => void }).message(
            "Already confirmed — showing the saved entry",
          );
        } else {
          toast.success("Already confirmed — showing the saved entry");
        }
        return;
      }
      toast.error(reportDbError("conveyance save", err, "Save failed"));
    } finally {
      setSaving(null);
      savingRef.current = null;
    }
  }

  async function addExpense(
    charge: ChargeType,
    form: { amount: string; receiptFile: File | null; notes: string; reset: () => void },
  ) {
    if (!navigator.onLine) {
      toast.error("No internet connection. Reconnect and retry.");
      return;
    }
    if (expenseBusyRef.current) return;
    if (form.amount.trim() === "") {
      toast.error("Enter the charges");
      return;
    }
    const amt = Number(form.amount.trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Charges must be above 0");
      return;
    }
    setExpenseBusy(true);
    expenseBusyRef.current = true;
    const fingerprint = expenseFingerprint({
      charge_type: charge,
      amount: form.amount.trim(),
      expense_date: date,
      receipt_name: form.receiptFile?.name ?? null,
    });
    const next = nextExpenseKey(expenseKeyRef.current, fingerprint);
    expenseKeyRef.current = { key: next.key, fingerprint: next.fingerprint };
    const clientKey = next.key;
    try {
      let receiptPath: string | null = null;
      if (form.receiptFile) receiptPath = await uploadPhoto(form.receiptFile, "receipt", charge);
      try {
        await callSaveExpense({
          data: {
            expense_date: date,
            charge_type: charge,
            amount: form.amount.trim(),
            receipt_path: receiptPath,
            notes: form.notes.trim() === "" ? null : form.notes.trim(),
            client_key: clientKey,
          },
        });
      } catch (saveErr) {
        // Best-effort orphan cleanup (mirrors saveHalf above): a failed
        // expense save must not leave its just-uploaded receipt behind.
        // Never masks the original save error.
        if (receiptPath) {
          try {
            await callDeleteUpload({ data: { path: receiptPath } });
          } catch (cleanupErr) {
            console.warn("Expense receipt cleanup failed:", cleanupErr);
          }
        }
        throw saveErr;
      }
      toast.success("Expense added");
      form.reset();
      expenseKeyRef.current = null;
      await queryClient.invalidateQueries({ queryKey: expKey });
      // Cross-namespace fan-out: expense adds feed the admin payables /
      // conveyance matrix, attention and overview (same as saveHalf above).
      await queryClient.invalidateQueries({ queryKey: adminEngKeys.conveyancePrefix });
      await queryClient.invalidateQueries({ queryKey: ["admin-eng", "payables"] });
      await queryClient.invalidateQueries({ queryKey: adminEngKeys.attentionPrefix });
      await queryClient.invalidateQueries({ queryKey: adminEngKeys.overviewPrefix });
    } catch (err) {
      toast.error(reportDbError("expense save", err, "Save failed"));
    } finally {
      setExpenseBusy(false);
      expenseBusyRef.current = false;
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
                  <>
                    <p className="text-sm font-semibold">Morning entry locked</p>
                    <p className="text-[11px] font-medium text-emerald-700">
                      Saved: {log.morning_odometer} km{log.morning_photo_path ? " · photo ✓" : ""}
                    </p>
                    <p className="text-[20px] font-semibold tabular-nums leading-tight">
                      {log.morning_odometer} km
                    </p>
                    <SavedPhoto path={log.morning_photo_path} alt="Morning odometer photo" />
                  </>
                ) : morningReviewing ? (
                  <div className="space-y-2 rounded-xl border border-border p-3">
                    <p className="text-sm font-semibold">Review morning entry</p>
                    <p className="text-[20px] font-semibold tabular-nums leading-tight">
                      {morningOdo.trim()} km
                    </p>
                    {odoErrors.morning ? (
                      <p className="text-xs text-destructive">{odoErrors.morning}</p>
                    ) : null}
                    {morningFile && morningPreviewUrl ? (
                      <img
                        src={morningPreviewUrl}
                        alt="Morning odometer photo preview"
                        className="h-24 w-auto rounded-lg border border-border object-cover"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">Existing photo kept</p>
                    )}
                    <Button
                      className="min-h-[44px] w-full"
                      disabled={saving !== null}
                      onClick={() => saveHalf("morning")}
                    >
                      {saving === "morning" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
                      ) : null}
                      Confirm morning entry
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[44px] w-full"
                      disabled={saving !== null}
                      onClick={() => setMorningReviewing(false)}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
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
                      disabled={
                        saving !== null ||
                        morningOdo.trim() === "" ||
                        (morningFile == null && log?.morning_photo_path == null) ||
                        odoErrors.morning != null
                      }
                      onClick={() => {
                        const err = validateOdo("morning");
                        if (err) {
                          setOdoErrors((prev) => ({ ...prev, morning: err }));
                          toast.error(err);
                          return;
                        }
                        setMorningReviewing(true);
                      }}
                    >
                      Review morning entry
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-xl">
              <CardContent className="space-y-2 p-4">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                  <Sunset className="h-4 w-4" aria-hidden /> Evening reading
                </p>
                {log?.evening_odometer != null ? (
                  <>
                    <p className="text-sm font-semibold">Evening entry locked</p>
                    <p className="text-[11px] font-medium text-emerald-700">
                      Saved: {log.evening_odometer} km{log.evening_photo_path ? " · photo ✓" : ""}
                    </p>
                    <p className="text-[20px] font-semibold tabular-nums leading-tight">
                      {log.evening_odometer} km
                    </p>
                    <SavedPhoto path={log.evening_photo_path} alt="Evening odometer photo" />
                  </>
                ) : eveningReviewing ? (
                  <div className="space-y-2 rounded-xl border border-border p-3">
                    <p className="text-sm font-semibold">Review evening entry</p>
                    <p className="text-[20px] font-semibold tabular-nums leading-tight">
                      {eveningOdo.trim()} km
                    </p>
                    {odoErrors.evening ? (
                      <p className="text-xs text-destructive">{odoErrors.evening}</p>
                    ) : null}
                    {eveningFile && eveningPreviewUrl ? (
                      <img
                        src={eveningPreviewUrl}
                        alt="Evening odometer photo preview"
                        className="h-24 w-auto rounded-lg border border-border object-cover"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">Existing photo kept</p>
                    )}
                    <Button
                      className="min-h-[44px] w-full"
                      disabled={saving !== null}
                      onClick={() => saveHalf("evening")}
                    >
                      {saving === "evening" ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
                      ) : null}
                      Confirm evening entry
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-[44px] w-full"
                      disabled={saving !== null}
                      onClick={() => setEveningReviewing(false)}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
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
                      disabled={
                        saving !== null ||
                        eveningOdo.trim() === "" ||
                        (eveningFile == null && log?.evening_photo_path == null) ||
                        odoErrors.evening != null
                      }
                      onClick={() => {
                        const err = validateOdo("evening");
                        if (err) {
                          setOdoErrors((prev) => ({ ...prev, evening: err }));
                          toast.error(err);
                          return;
                        }
                        setEveningReviewing(true);
                      }}
                    >
                      Review evening entry
                    </Button>
                  </>
                )}
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

          <ExpenseSection
            title="Toll"
            charge="Toll"
            entries={expenses.filter((e) => e.charge_type === "Toll")}
            busy={expenseBusy}
            onAdd={addExpense}
          />
          <ExpenseSection
            title="Parking"
            charge="Parking"
            entries={expenses.filter((e) => e.charge_type === "Parking")}
            busy={expenseBusy}
            onAdd={addExpense}
          />
          <ExpenseSection
            title="Places visit"
            charge="Place Visit"
            entries={expenses.filter((e) => e.charge_type === "Place Visit")}
            busy={expenseBusy}
            onAdd={addExpense}
          />
          <p className="text-right text-sm font-semibold tabular-nums">
            Day total: {formatINR(dayTotal)}
          </p>
        </>
      )}
    </div>
  );
}
