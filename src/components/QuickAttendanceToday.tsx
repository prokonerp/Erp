import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { CalendarDays, CheckCheck, Loader2, Lock, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import {
  MAX_WORK_HOURS, MONTHS, STANDARD_SHIFT_HOURS,
  type AttCode, type AttEntry, type AttendanceLock, type Employee,
  dayValueFor, eligibleRange, getAttendanceLock, isSundayDate, listAttendance, listEmployees, saveAttendance,
} from "@/lib/payroll";

const QUICK: { code: AttCode; label: string; cls: string }[] = [
  { code: "P", label: "Present", cls: "bg-emerald-600 text-white hover:bg-emerald-600 border-emerald-600" },
  { code: "H", label: "Half Day", cls: "bg-amber-500 text-white hover:bg-amber-500 border-amber-500" },
  { code: "A", label: "Absent", cls: "bg-destructive text-destructive-foreground hover:bg-destructive border-destructive" },
];

const MORE_TYPES: { value: AttCode; label: string }[] = [
  { value: "P", label: "Present" },
  { value: "H", label: "Half Day" },
  { value: "A", label: "Absent" },
  { value: "OT", label: "Overtime Entry" },
  { value: "SW", label: "Sunday Work" },
];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Fast one-tap daily attendance marking. Reads and writes the exact same
 * attendance rows the Salary Sheet grid uses (saveAttendance / dayValueFor),
 * so numbers stay identical between both views.
 */
export function QuickAttendanceToday({ isAdmin, onChanged }: { isAdmin: boolean; onChanged?: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [att, setAtt] = useState<Record<string, AttEntry>>({});
  const [lock, setLock] = useState<AttendanceLock | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulking, setBulking] = useState(false);
  const [search, setSearch] = useState("");

  const [y, m, d] = date.split("-").map(Number);
  const sunday = isSundayDate(y, m, d);
  const locked = !!lock?.locked;
  const canEdit = isAdmin && !locked;

  async function load() {
    setLoading(true);
    try {
      const [emps, monthAtt, lk] = await Promise.all([listEmployees(), listAttendance(y, m), getAttendanceLock(y, m)]);
      setEmployees(emps);
      const day: Record<string, AttEntry> = {};
      for (const [empId, days] of Object.entries(monthAtt)) {
        const e = days[d];
        if (e) day[empId] = e;
      }
      setAtt(day);
      setLock(lk);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load attendance");
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees
      .filter((e) => e.active !== false)
      .filter((e) => {
        const r = eligibleRange(e, y, m);
        return r.end >= r.start && d >= r.start && d <= r.end;
      })
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.role ?? "").toLowerCase().includes(q));
  }, [employees, search, y, m, d]);

  const markedCount = rows.filter((e) => att[e.id]).length;

  async function mark(empId: string, patch: { code?: AttCode; hours?: number | null }) {
    if (!isAdmin) return;
    if (locked) return toast.error(`${MONTHS[m - 1]} ${y} attendance is locked. Unlock it to edit.`);
    const cur = att[empId];
    const code = patch.code ?? cur?.code ?? "P";
    const hours = patch.hours !== undefined ? patch.hours : (cur?.hours ?? null);
    if (hours != null && (hours < 0 || hours > MAX_WORK_HOURS)) return toast.error(`Work hours must be 0–${MAX_WORK_HOURS}`);
    const entry: AttEntry = { code, hours, dayValue: dayValueFor(code, hours, sunday), edited: true };
    setAtt((p) => ({ ...p, [empId]: entry }));
    setBusy(empId);
    try {
      await saveAttendance([{ employee_id: empId, work_date: date, code, hours }], "quick_mark_today");
      const name = employees.find((e) => e.id === empId)?.name ?? "Employee";
      toast.success(`${name} — ${MORE_TYPES.find((t) => t.value === code)?.label ?? code}${hours != null ? ` (${hours}h)` : ""}`);
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message);
      await load();
    }
    setBusy(null);
  }

  async function markAllUnmarkedPresent() {
    if (!canEdit) return;
    const pending = rows.filter((e) => !att[e.id]);
    if (pending.length === 0) return toast.info("Everyone is already marked for this date");
    setBulking(true);
    const next = { ...att };
    for (const e of pending) next[e.id] = { code: "P", hours: null, dayValue: dayValueFor("P", null, sunday) };
    setAtt(next);
    try {
      await saveAttendance(
        pending.map((e) => ({ employee_id: e.id, work_date: date, code: "P" as AttCode, hours: null })),
        "quick_mark_today",
      );
      toast.success(`Marked ${pending.length} employee(s) present`);
      onChanged?.();
    } catch (e: any) {
      toast.error(e.message);
      await load();
    }
    setBulking(false);
  }

  const prettyDate = new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4 w-4" />Quick Attendance — {date === todayIso() ? "Today" : prettyDate}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="font-medium text-foreground tabular-nums">{markedCount} of {rows.length}</span> employees marked for {prettyDate}
            {sunday && <Badge variant="outline" className="ml-2 text-orange-600 border-orange-500/50">Sunday</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Input
              type="date"
              className="h-9 w-40"
              value={date}
              max={todayIso()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search employee…" className="h-9 w-44 pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          {isAdmin && (
            <Button size="sm" onClick={markAllUnmarkedPresent} disabled={!canEdit || bulking}>
              {bulking ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-1" />}Mark all Present
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {locked && (
          <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            <span>
              Attendance for {MONTHS[m - 1]} {y} is locked{lock?.locked_by_email ? ` by ${lock.locked_by_email}` : ""}.
              {isAdmin ? " Unlock it in the Salary Sheet tab to edit." : " Ask an admin to unlock it."}
            </span>
          </div>
        )}
        {!isAdmin && (
          <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">Admin access required to mark attendance.</div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading employees…</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No active employees for this date.</div>
        ) : (
          <div className="divide-y rounded-md border">
            {rows.map((e) => {
              const entry = att[e.id];
              const active = entry?.code;
              const hasHours = entry?.hours != null && Number(entry.hours) > 0;
              return (
                <div key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate flex items-center gap-2">
                      {e.name}
                      {!entry && <Badge variant="outline" className="text-[10px] text-muted-foreground">unmarked</Badge>}
                      {entry && (
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {entry.dayValue} day{entry.dayValue === 1 ? "" : "s"}{hasHours ? ` · ${entry.hours}h` : ""}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{e.role ?? "—"}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {QUICK.map((q) => (
                      <Button
                        key={q.code}
                        size="sm"
                        variant="outline"
                        disabled={!canEdit || busy === e.id}
                        className={`h-8 px-3 text-xs ${active === q.code && !hasHours ? q.cls : ""}`}
                        onClick={() => mark(e.id, { code: q.code, hours: null })}
                      >
                        {q.label}
                      </Button>
                    ))}
                    <MorePopover
                      disabled={!canEdit}
                      entry={entry}
                      sunday={sunday}
                      onApply={(code, hours) => mark(e.id, { code, hours })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MorePopover({
  disabled, entry, sunday, onApply,
}: {
  disabled: boolean;
  entry: AttEntry | undefined;
  sunday: boolean;
  onApply: (code: AttCode, hours: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<AttCode>(entry?.code ?? "P");
  const [hours, setHours] = useState<string>(entry?.hours != null ? String(entry.hours) : "");

  useEffect(() => {
    if (open) {
      setCode(entry?.code ?? "P");
      setHours(entry?.hours != null ? String(entry.hours) : "");
    }
  }, [open, entry]);

  const h = hours === "" ? null : Number(hours);
  const preview = dayValueFor(code, h, sunday);
  const special = entry && (entry.code === "OT" || entry.code === "SW" || (entry.hours != null && Number(entry.hours) > 0));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={special ? "secondary" : "ghost"} disabled={disabled} className="h-8 px-2 text-xs">
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />More
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3 pointer-events-auto" align="end">
        <div>
          <Label className="text-xs">Attendance type</Label>
          <select
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60"
            value={code}
            disabled={h != null && h > 0}
            onChange={(e) => setCode(e.target.value as AttCode)}
          >
            {MORE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Work hours (1 day = {STANDARD_SHIFT_HOURS} hrs)</Label>
          <Input
            type="number" min="0" max={MAX_WORK_HOURS} step="0.5"
            className="mt-1 h-9"
            placeholder="—"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Credit: <span className="font-medium text-foreground tabular-nums">{preview} day(s)</span>
          {sunday && " · Sunday credit applied"}
        </div>
        <Button size="sm" className="w-full" onClick={() => { onApply(code, h); setOpen(false); }}>Save entry</Button>
      </PopoverContent>
    </Popover>
  );
}