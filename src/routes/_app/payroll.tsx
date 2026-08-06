import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ExportButtons } from "@/components/ExportButtons";
import { toast } from "sonner";
import {
  AlertTriangle, BadgeIndianRupee, CalendarDays, CheckCircle2, ChevronDown, ChevronRight,
  CircleCheck, IndianRupee, Loader2, Plus, RefreshCw, Users, Wallet,
} from "lucide-react";
import {
  MONTHS, type AttCode, type Advance, type ComputedRow, type Employee, type SalaryRecord,
  computeRow, daysInMonth, incrementDue, isoDate, listAdvances, listAttendance, listEmployees,
  listSalaryRecords, money, saveAttendance, upsertSalaryRecord,
} from "@/lib/payroll";

export const Route = createFileRoute("/_app/payroll")({
  component: PayrollPage,
  head: () => ({
    meta: [
      { title: "Salary & Attendance — Prokon ERP" },
      { name: "description", content: "Monthly attendance grid, automated salary calculation, advances and payroll approval for your team." },
      { property: "og:title", content: "Salary & Attendance — Prokon ERP" },
      { property: "og:description", content: "Automated payroll: attendance grid, per-day salary, advances and approvals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const codeCls: Record<AttCode, string> = {
  P: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  A: "bg-destructive/15 text-destructive",
  H: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
};
const nextCode = (c: AttCode | undefined): AttCode => (c === "P" ? "H" : c === "H" ? "A" : "P");

function PayrollPage() {
  const { isAdmin } = useIsAdmin();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [att, setAtt] = useState<Record<string, Record<number, AttCode>>>({});
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [records, setRecords] = useState<SalaryRecord[]>([]);
  const [deductions, setDeductions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const dim = daysInMonth(year, month);

  async function load() {
    setLoading(true);
    try {
      const [emps, a, adv, recs] = await Promise.all([
        listEmployees(), listAttendance(year, month), listAdvances(year, month), listSalaryRecords(year, month),
      ]);
      setEmployees(emps);
      setAtt(a);
      setAdvances(adv);
      setRecords(recs);
      const d: Record<string, number> = {};
      recs.forEach((r) => { d[r.employee_id] = Number(r.deductions ?? 0); });
      setDeductions(d);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load payroll");
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year, month]);

  const advByEmp = useMemo(() => {
    const m: Record<string, number> = {};
    advances.forEach((a) => { m[a.employee_id] = (m[a.employee_id] ?? 0) + Number(a.amount ?? 0); });
    return m;
  }, [advances]);

  const recByEmp = useMemo(() => {
    const m: Record<string, SalaryRecord> = {};
    records.forEach((r) => { m[r.employee_id] = r; });
    return m;
  }, [records]);

  const rows: ComputedRow[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees
      .filter((e) => e.active !== false)
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.role ?? "").toLowerCase().includes(q))
      .map((e) => computeRow(e, year, month, att[e.id] ?? {}, advByEmp[e.id] ?? 0, deductions[e.id] ?? 0, recByEmp[e.id] ?? null))
      .filter((r) => r.eligible.end >= r.eligible.start);
  }, [employees, att, advByEmp, deductions, recByEmp, year, month, search]);

  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.totalSalary,
      advance: acc.advance + r.advance,
      net: acc.net + r.netSalary,
      paid: acc.paid + (r.record?.status === "paid" ? 1 : 0),
    }),
    { gross: 0, advance: 0, net: 0, paid: 0 },
  ), [rows]);

  const dueList = useMemo(
    () => employees.filter((e) => e.active !== false).map((e) => ({ e, ...incrementDue(e) })).filter((x) => x.due),
    [employees],
  );

  function setCell(empId: string, day: number, code: AttCode) {
    setAtt((prev) => ({ ...prev, [empId]: { ...(prev[empId] ?? {}), [day]: code } }));
  }

  async function persistAttendance(empId: string, days?: number[]) {
    if (!isAdmin) return;
    const map = att[empId] ?? {};
    const list = (days ?? Object.keys(map).map(Number)).map((d) => ({
      employee_id: empId, work_date: isoDate(year, month, d), code: (map[d] ?? "A") as AttCode,
    }));
    try { await saveAttendance(list); } catch (e: any) { toast.error(e.message); }
  }

  async function markAllPresent(row: ComputedRow) {
    if (!isAdmin) return;
    const days: number[] = [];
    const map: Record<number, AttCode> = { ...(att[row.emp.id] ?? {}) };
    for (let d = row.eligible.start; d <= row.eligible.end; d++) { map[d] = "P"; days.push(d); }
    setAtt((p) => ({ ...p, [row.emp.id]: map }));
    try {
      await saveAttendance(days.map((d) => ({ employee_id: row.emp.id, work_date: isoDate(year, month, d), code: "P" as AttCode })));
      toast.success(`All present — ${row.emp.name}`);
    } catch (e: any) { toast.error(e.message); }
  }

  async function bulkMarkAllPresent() {
    if (!isAdmin) return;
    setSaving(true);
    const payload: { employee_id: string; work_date: string; code: AttCode }[] = [];
    const next = { ...att };
    for (const r of rows) {
      const map: Record<number, AttCode> = { ...(next[r.emp.id] ?? {}) };
      for (let d = r.eligible.start; d <= r.eligible.end; d++) {
        map[d] = "P";
        payload.push({ employee_id: r.emp.id, work_date: isoDate(year, month, d), code: "P" });
      }
      next[r.emp.id] = map;
    }
    setAtt(next);
    try { await saveAttendance(payload); toast.success("Marked all present for the month"); }
    catch (e: any) { toast.error(e.message); }
    setSaving(false);
  }

  async function saveSheet(status?: string) {
    if (!isAdmin) return;
    setSaving(true);
    try {
      for (const r of rows) await upsertSalaryRecord(r, year, month, status);
      toast.success(status === "paid" ? "Marked as paid" : status === "approved" ? "Salary approved" : "Salary sheet saved");
      const recs = await listSalaryRecords(year, month);
      setRecords(recs);
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  }

  async function rowAction(r: ComputedRow, status: string) {
    if (!isAdmin) return;
    try {
      await upsertSalaryRecord(r, year, month, status);
      setRecords(await listSalaryRecords(year, month));
      toast.success(status === "paid" ? "Marked paid" : "Approved");
    } catch (e: any) { toast.error(e.message); }
  }

  async function deleteRecord(r: ComputedRow) {
    if (!isAdmin || !r.record) return;
    if (r.record.status === "paid") return toast.error("Paid salary records cannot be deleted");
    if (!confirm(`Delete salary record for ${r.emp.name}?`)) return;
    const { error } = await supabase.from("salary_records").delete().eq("id", r.record.id);
    if (error) return toast.error(error.message);
    setRecords(await listSalaryRecords(year, month));
    toast.success("Salary record deleted");
  }

  const exportCols = [
    { header: "Name", get: (r: ComputedRow) => r.emp.name },
    { header: "Designation", get: (r: ComputedRow) => r.emp.role ?? "" },
    { header: "Basic (Monthly)", get: (r: ComputedRow) => Number(r.emp.monthly_salary ?? 0) },
    { header: "Days", get: (r: ComputedRow) => r.daysInMonth },
    { header: "Per Day", get: (r: ComputedRow) => Number(r.perDay.toFixed(2)) },
    { header: "Working Days", get: (r: ComputedRow) => r.workingDays },
    { header: "Total", get: (r: ComputedRow) => Number(r.totalSalary.toFixed(2)) },
    { header: "Advance", get: (r: ComputedRow) => r.advance },
    { header: "Deductions", get: (r: ComputedRow) => r.deductions },
    { header: "Net", get: (r: ComputedRow) => Number(r.netSalary.toFixed(2)) },
    { header: "Status", get: (r: ComputedRow) => r.record?.status ?? "draft" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gradient-to-r from-primary to-primary/70 text-primary-foreground p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2"><BadgeIndianRupee className="h-6 w-6" />Salary &amp; Attendance</h1>
            <p className="text-sm opacity-90">Auto month days, attendance grid, advances and approvals — {MONTHS[month - 1]} {year} ({dim} days)</p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-xs opacity-90">Month</Label>
              <select className="h-9 rounded-md border bg-background text-foreground px-2 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs opacity-90">Year</Label>
              <select className="h-9 rounded-md border bg-background text-foreground px-2 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {Array.from({ length: 7 }, (_, i) => now.getFullYear() - 4 + i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          </div>
        </div>
      </div>

      {dueList.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="py-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" />
            <div>
              <span className="font-medium">Salary revision due</span> for {dueList.length} employee(s):{" "}
              {dueList.map((d) => d.e.name).join(", ")}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={<Users className="h-4 w-4" />} label="Employees" value={String(rows.length)} />
        <KpiCard icon={<IndianRupee className="h-4 w-4" />} label="Gross Payable" value={`₹${money(totals.gross)}`} />
        <KpiCard icon={<Wallet className="h-4 w-4" />} label="Advances" value={`₹${money(totals.advance)}`} />
        <KpiCard icon={<CircleCheck className="h-4 w-4" />} label="Net Payable" value={`₹${money(totals.net)}`} accent />
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4" />Salary Sheet — {MONTHS[month - 1]} {year}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search employee…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-44" />
            <ExportButtons name={`Salary_${MONTHS[month - 1]}_${year}`} title={`Salary Sheet — ${MONTHS[month - 1]} ${year}`} rows={rows} columns={exportCols} />
            {isAdmin && <AdvanceDialog employees={employees} year={year} month={month} onSaved={load} />}
            {isAdmin && <Button size="sm" variant="outline" onClick={bulkMarkAllPresent} disabled={saving}>Mark All Present</Button>}
            {isAdmin && <Button size="sm" variant="outline" onClick={() => saveSheet()} disabled={saving}>Save</Button>}
            {isAdmin && <Button size="sm" variant="outline" onClick={() => saveSheet("approved")} disabled={saving}>Approve All</Button>}
            {isAdmin && <Button size="sm" onClick={() => saveSheet("paid")} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}Mark Paid</Button>}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading payroll…</div>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No active employees for this month. Add them in Masters → Employees.</div>
          ) : (
            <div className="overflow-auto max-h-[70vh] rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="w-12">S.No</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Designation</TableHead>
                    <TableHead className="text-right">Basic</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Per Day</TableHead>
                    <TableHead className="text-right">Working</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Advance</TableHead>
                    <TableHead className="text-right">Deduct.</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead className="w-40">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => {
                    const open = expanded === r.emp.id;
                    const status = r.record?.status ?? "draft";
                    return (
                      <Fragment key={r.emp.id}>
                        <TableRow className="hover:bg-muted/50">
                          <TableCell>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpanded(open ? null : r.emp.id)}>
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                          <TableCell className="font-medium whitespace-nowrap">{r.emp.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{r.emp.role ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">₹{money(Number(r.emp.monthly_salary ?? 0))}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.daysInMonth}</TableCell>
                          <TableCell className="text-right tabular-nums">₹{money(r.perDay)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{r.workingDays}</TableCell>
                          <TableCell className="text-right tabular-nums">₹{money(r.totalSalary)}</TableCell>
                          <TableCell className="text-right tabular-nums text-amber-600">₹{money(r.advance)}</TableCell>
                          <TableCell className="text-right">
                            {isAdmin ? (
                              <Input
                                type="number"
                                className="h-8 w-24 text-right"
                                value={deductions[r.emp.id] ?? 0}
                                onChange={(e) => setDeductions((p) => ({ ...p, [r.emp.id]: Number(e.target.value || 0) }))}
                              />
                            ) : <span className="tabular-nums">₹{money(r.deductions)}</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">₹{money(r.netSalary)}</TableCell>
                          <TableCell>
                            <Badge variant={status === "paid" ? "default" : status === "approved" ? "secondary" : "outline"} className="capitalize">{status}</Badge>
                          </TableCell>
                          <TableCell>
                            {isAdmin ? (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => markAllPresent(r)}>All P</Button>
                                {status !== "paid" && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => rowAction(r, "approved")}>Approve</Button>}
                                {status !== "paid" && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => rowAction(r, "paid")}>Pay</Button>}
                                {r.record && status !== "paid" && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => deleteRecord(r)}>Del</Button>}
                              </div>
                            ) : <span className="text-xs text-muted-foreground">View only</span>}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow>
                            <TableCell colSpan={14} className="bg-muted/30">
                              <div className="space-y-2 py-1">
                                <div className="text-xs text-muted-foreground">
                                  Attendance — click a day to cycle P → H → A{r.eligible.start > 1 || r.eligible.end < r.daysInMonth ? ` · eligible days ${r.eligible.start}–${r.eligible.end}` : ""}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {Array.from({ length: r.daysInMonth }, (_, k) => k + 1).map((d) => {
                                    const inRange = d >= r.eligible.start && d <= r.eligible.end;
                                    const c = (r.attendance[d] ?? (inRange ? "A" : undefined)) as AttCode | undefined;
                                    return (
                                      <button
                                        key={d}
                                        disabled={!isAdmin || !inRange}
                                        onClick={() => { const n = nextCode(c); setCell(r.emp.id, d, n); void persistAttendance(r.emp.id, [d]); }}
                                        className={`w-9 rounded-md border px-1 py-1 text-[11px] leading-tight transition-colors ${inRange ? codeCls[(c ?? "A") as AttCode] : "opacity-40"} ${isAdmin && inRange ? "hover:ring-1 hover:ring-primary" : ""}`}
                                        title={`Day ${d}`}
                                      >
                                        <div className="font-medium">{d}</div>
                                        <div>{inRange ? (c ?? "A") : "–"}</div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <Card className={accent ? "border-primary/40" : undefined}>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
        <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function AdvanceDialog({ employees, year, month, onSaved }: { employees: Employee[]; year: number; month: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(isoDate(year, month, 1));
  const [notes, setNotes] = useState("");

  async function save() {
    if (!employeeId || !Number(amount)) return toast.error("Select employee and amount");
    const { error } = await supabase.from("employee_advances").insert({
      employee_id: employeeId, amount: Number(amount), advance_date: date,
      period_year: year, period_month: month, notes: notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Advance recorded");
    setOpen(false); setAmount(""); setNotes("");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />Advance</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record Advance — {MONTHS[month - 1]} {year}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Employee</Label>
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">— Select —</option>
              {employees.filter((e) => e.active !== false).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Amount (₹)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save}>Save Advance</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
