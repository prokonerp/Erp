import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { ChevronDown, ChevronRight, Wallet } from "lucide-react";
import {
  MONTHS, type Advance, type AdvancePayment, type Employee,
  advanceSummary, closeAdvance, deleteAdvance, emiDueFor, money, paymentFor, skipAdvanceMonth, updateAdvance,
} from "@/lib/payroll";

type Props = {
  employees: Employee[];
  advances: Advance[];
  payments: AdvancePayment[];
  year: number;
  month: number;
  isAdmin: boolean;
  onChanged: () => void;
};

const period = (y: number | null, m: number | null) => (y && m ? `${MONTHS[m - 1].slice(0, 3)} ${y}` : "—");

/** Per-employee advance ledger: schedule, installments paid/pending, balance and admin overrides. */
export function AdvanceLedger({ employees, advances, payments, year, month, isAdmin, onChanged }: Props) {
  const confirm = useConfirm();
  const [open, setOpen] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [edit, setEdit] = useState<Advance | null>(null);

  const byEmp = useMemo(() => {
    const m = new Map<string, Advance[]>();
    for (const a of advances) {
      if (!showClosed && (a.status ?? "active") !== "active") continue;
      m.set(a.employee_id, [...(m.get(a.employee_id) ?? []), a]);
    }
    return m;
  }, [advances, showClosed]);

  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const totals = useMemo(() => {
    let total = 0, paid = 0, balance = 0, dueNow = 0;
    for (const list of byEmp.values()) {
      for (const a of list) {
        const s = advanceSummary(a);
        total += s.total; paid += s.paid; balance += s.balance;
        dueNow += emiDueFor(a, year, month, { payments, employee: empById.get(a.employee_id) ?? null });
      }
    }
    return { total, paid, balance, dueNow };
  }, [byEmp, payments, year, month, empById]);

  async function act(fn: () => Promise<void>, msg: string) {
    try { await fn(); toast.success(msg); onChanged(); }
    catch (e: any) { toast.error(e.message ?? "Action failed"); }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" />Advance Ledger — EMI schedules</CardTitle>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">Advanced <b className="tabular-nums text-foreground">₹{money(totals.total)}</b></span>
          <span className="text-muted-foreground">Recovered <b className="tabular-nums text-emerald-600">₹{money(totals.paid)}</b></span>
          <span className="text-muted-foreground">Balance <b className="tabular-nums text-amber-600">₹{money(totals.balance)}</b></span>
          <span className="text-muted-foreground">Due {MONTHS[month - 1].slice(0, 3)} <b className="tabular-nums text-foreground">₹{money(totals.dueNow)}</b></span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? "Hide closed" : "Show closed"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {byEmp.size === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No advance schedules yet.</div>
        ) : (
          <div className="overflow-auto rounded-md border max-h-[55vh]">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted">
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Recovered</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Due this month</TableHead>
                  <TableHead className="w-40">Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from(byEmp.entries()).map(([empId, list]) => {
                  const emp = empById.get(empId) ?? null;
                  const sums = list.map(advanceSummary);
                  const total = sums.reduce((s, x) => s + x.total, 0);
                  const paid = sums.reduce((s, x) => s + x.paid, 0);
                  const balance = sums.reduce((s, x) => s + x.balance, 0);
                  const due = list.reduce((s, a) => s + emiDueFor(a, year, month, { payments, employee: emp }), 0);
                  const isOpen = open === empId;
                  return (
                    <Fragment key={empId}>
                      <TableRow className="hover:bg-muted/50 cursor-pointer" onClick={() => setOpen(isOpen ? null : empId)}>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7">
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {emp?.name ?? "Unknown"}
                          {emp?.exit_date && <Badge variant="outline" className="ml-2 text-[10px] text-destructive border-destructive/50">exiting {emp.exit_date}</Badge>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">₹{money(total)}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">₹{money(paid)}</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-600">₹{money(balance)}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{money(due)}</TableCell>
                        <TableCell><Progress value={total > 0 ? (paid / total) * 100 : 0} className="h-2" /></TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="overflow-auto py-1">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="text-xs">Advance date</TableHead>
                                    <TableHead className="text-xs text-right">Amount</TableHead>
                                    <TableHead className="text-xs text-right">EMI</TableHead>
                                    <TableHead className="text-xs">Schedule</TableHead>
                                    <TableHead className="text-xs text-right">Paid / Pending</TableHead>
                                    <TableHead className="text-xs text-right">Balance</TableHead>
                                    <TableHead className="text-xs">This month</TableHead>
                                    <TableHead className="text-xs">Status</TableHead>
                                    {isAdmin && <TableHead className="text-xs w-52">Admin</TableHead>}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {list.map((a) => {
                                    const s = advanceSummary(a);
                                    const p = paymentFor(payments, a.id, year, month);
                                    const d = emiDueFor(a, year, month, { payments, employee: emp });
                                    return (
                                      <TableRow key={a.id} className="text-xs">
                                        <TableCell className="whitespace-nowrap">{a.advance_date}</TableCell>
                                        <TableCell className="text-right tabular-nums">₹{money(s.total)}</TableCell>
                                        <TableCell className="text-right tabular-nums">₹{money(s.emi)}</TableCell>
                                        <TableCell className="whitespace-nowrap">
                                          {period(s.startYear, s.startMonth)} → {period(s.endYear, s.endMonth)} · {s.months} inst.
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{s.paidInstallments} / {s.pendingInstallments}</TableCell>
                                        <TableCell className="text-right tabular-nums text-amber-600">₹{money(s.balance)}</TableCell>
                                        <TableCell className="whitespace-nowrap">
                                          {p?.kind === "skip" ? <Badge variant="outline">skipped</Badge>
                                            : p ? <Badge variant="secondary">recovered ₹{money(Number(p.amount))}</Badge>
                                            : d > 0 ? <span className="tabular-nums">₹{money(d)} due</span>
                                            : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell><Badge variant={s.closed ? "outline" : "default"} className="capitalize">{a.status}</Badge></TableCell>
                                        {isAdmin && (
                                          <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEdit(a)}>Edit</Button>
                                              {!s.closed && (
                                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={!!p}
                                                  onClick={() => act(() => skipAdvanceMonth(a, year, month), "Month skipped")}>Skip</Button>
                                              )}
                                              {!s.closed && (
                                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                                                  onClick={async () => {
                                                    const recover = await confirm({
                                                      title: "Close this advance?",
                                                      description: `Balance ₹${money(s.balance)} — "Mark Recovered" records it as fully recovered; "Write Off" removes the remaining balance.`,
                                                      confirmLabel: "Mark Recovered",
                                                      cancelLabel: "Write Off",
                                                      variant: "danger",
                                                    });
                                                    void act(() => closeAdvance(a, recover, year, month), "Advance closed");
                                                  }}>Close</Button>
                                              )}
                                              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive"
                                                onClick={async () => {
                                                  const ok = await confirm({
                                                    title: "Delete this advance?",
                                                    description: "The advance and its full recovery history are permanently removed.",
                                                    confirmLabel: "Delete",
                                                    variant: "danger",
                                                  });
                                                  if (ok) void act(() => deleteAdvance(a.id), "Advance deleted");
                                                }}>Del</Button>
                                            </div>
                                          </TableCell>
                                        )}
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                              <RecoveryHistory advances={list} payments={payments} />
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
      <EditAdvanceDialog advance={edit} onClose={() => setEdit(null)} onSaved={onChanged} />
    </Card>
  );
}

function RecoveryHistory({ advances, payments }: { advances: Advance[]; payments: AdvancePayment[] }) {
  const ids = new Set(advances.map((a) => a.id));
  const rows = payments.filter((p) => ids.has(p.advance_id));
  if (rows.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Recovery history: </span>
      {rows.map((p) => (
        <span key={p.id} className="mr-3 whitespace-nowrap">
          {MONTHS[p.period_month - 1].slice(0, 3)} {p.period_year} · {p.kind === "skip" ? "skipped" : `₹${money(Number(p.amount))}${p.kind !== "emi" ? ` (${p.kind.replace("_", " ")})` : ""}`}
        </span>
      ))}
    </div>
  );
}

function EditAdvanceDialog({ advance, onClose, onSaved }: { advance: Advance | null; onClose: () => void; onSaved: () => void }) {
  const s = advance ? advanceSummary(advance) : null;
  const [amount, setAmount] = useState("");
  const [emi, setEmi] = useState("");
  const [months, setMonths] = useState("");
  const [startYear, setStartYear] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [seed, setSeed] = useState<string | null>(null);

  if (advance && seed !== advance.id) {
    setSeed(advance.id);
    setAmount(String(advance.amount ?? 0));
    setEmi(String(s?.emi ?? 0));
    setMonths(String(advance.emi_months ?? 1));
    setStartYear(String(advance.start_year ?? advance.period_year ?? new Date().getFullYear()));
    setStartMonth(String(advance.start_month ?? advance.period_month ?? 1));
  }

  async function save() {
    if (!advance) return;
    try {
      await updateAdvance(advance.id, {
        amount: Number(amount) || 0,
        emi_amount: Number(emi) || 0,
        emi_months: Math.max(1, Number(months) || 1),
        start_year: Number(startYear) || null,
        start_month: Number(startMonth) || null,
      });
      toast.success("Advance updated");
      onClose(); onSaved();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <Dialog open={!!advance} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit advance schedule</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Total amount (₹)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label className="text-xs">EMI amount (₹)</Label><Input type="number" value={emi} onChange={(e) => setEmi(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs">Installments</Label><Input type="number" min="1" value={months} onChange={(e) => setMonths(e.target.value)} /></div>
            <div>
              <Label className="text-xs">Start month</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div><Label className="text-xs">Start year</Label><Input type="number" value={startYear} onChange={(e) => setStartYear(e.target.value)} /></div>
          </div>
          {s && <div className="text-xs text-muted-foreground">Recovered ₹{money(s.paid)} · balance ₹{money(s.balance)} · {s.paidInstallments} installment(s) paid</div>}
        </div>
        <DialogFooter><Button onClick={save}>Save changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
