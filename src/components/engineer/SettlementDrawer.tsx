import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Lock, TriangleAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { ControlledActionDialog } from "@/components/ControlledActionDialog";
import { ExportButtons } from "@/components/ExportButtons";
import type { ExportColumn } from "@/lib/exports";
import {
  groupExpensesByType,
  kmFlags,
  payableForPeriod,
  type AdminRate,
} from "@/lib/engineersAdmin";
import { reportDbError } from "@/lib/format-error";
import { setSettlementStatus, upsertSettlement } from "@/lib/engineer-settlement.functions";

export type DrawerDay = {
  log_date?: string | null;
  morning_odometer?: number | null;
  evening_odometer?: number | null;
};

export type DrawerExpense = {
  expense_date?: string | null;
  charge_type?: string | null;
  amount?: number | string | null;
  receipt_path?: string | null;
};

export type DrawerSettlement = {
  id: string;
  locked_at?: string | null;
  status?: string | null;
};

type DayRow = {
  date: string;
  km: number;
  rate: number | null;
  amount: number;
  flags: string[];
};

type ExpenseTotalRow = { type: string; count: number; total: number };

const DAY_COLUMNS: ColumnDef<DayRow>[] = [
  { key: "date", header: "Date", sortable: true },
  {
    key: "km",
    header: "Km",
    align: "right",
    sortable: true,
    render: (r) => <span className="tabular-nums">{r.km}</span>,
  },
  {
    key: "rate",
    header: "Rate/km",
    align: "right",
    render: (r) => (
      <span className="tabular-nums">{r.rate === null ? "No rate" : `₹${r.rate}`}</span>
    ),
  },
  {
    key: "amount",
    header: "Amount",
    align: "right",
    sortable: true,
    render: (r) => <span className="tabular-nums">₹{r.amount.toLocaleString("en-IN")}</span>,
  },
  {
    key: "flags",
    header: "Flags",
    render: (r) =>
      r.flags.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          <TriangleAlert className="h-3.5 w-3.5" />
          {r.flags.join(", ")}
        </span>
      ),
  },
];

const EXPENSE_EXPORT_COLUMNS: ExportColumn<ExpenseTotalRow>[] = [
  { header: "Charge type", get: (r) => r.type },
  { header: "Lines", get: (r) => r.count },
  { header: "Total (₹)", get: (r) => r.total },
];

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function SettlementDrawer({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  from,
  to,
  rates,
  days,
  expenses,
  settlement,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employeeId: string | null;
  employeeName: string | null;
  from: string;
  to: string;
  rates: AdminRate[];
  days: DrawerDay[];
  expenses: DrawerExpense[];
  settlement: DrawerSettlement | null;
  onChanged: () => void;
}) {
  const callUpsert = useServerFn(upsertSettlement);
  const callStatus = useServerFn(setSettlementStatus);

  const [overrideAmount, setOverrideAmount] = useState("");
  const [dialog, setDialog] = useState<"override" | "approve" | "reject" | null>(null);

  const payable = useMemo(
    () => payableForPeriod({ employeeId, rates, days, expenses }),
    [employeeId, rates, days, expenses],
  );

  // Per-day rows join computed km·rate·amount with odometer flags from the
  // raw day logs (payable rows alone carry no morning/evening readings).
  const dayRows = useMemo<DayRow[]>(() => {
    const flagsByDate = new Map<string, string[]>();
    for (const d of days) {
      if (!d || typeof d.log_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.log_date.slice(0, 10))) continue;
      const key = d.log_date.slice(0, 10);
      if (!flagsByDate.has(key)) flagsByDate.set(key, kmFlags(d.morning_odometer, d.evening_odometer));
    }
    return payable.perDay.map((d) => ({ ...d, flags: flagsByDate.get(d.date) ?? [] }));
  }, [payable, days]);

  const expenseTotals = useMemo<ExpenseTotalRow[]>(
    () =>
      Object.entries(groupExpensesByType(expenses)).map(([type, v]) => ({
        type,
        count: v.count,
        total: v.total,
      })),
    [expenses],
  );

  const warnedRows = useMemo(() => dayRows.filter((r) => r.flags.length > 0), [dayRows]);

  const isLocked =
    !!settlement &&
    (settlement.status === "Approved" ||
      (typeof settlement.locked_at === "string"
        ? settlement.locked_at.trim() !== ""
        : settlement.locked_at != null));

  const canDecide = !!settlement && !isLocked;

  async function confirmOverride({ reason }: { reason: string }) {
    if (!employeeId) throw new Error("Select an engineer first.");
    const amt = Number(overrideAmount);
    if (!Number.isFinite(amt) || amt < 0) throw new Error("Override must be a non-negative number.");
    try {
      await callUpsert({
        data: {
          employee_id: employeeId,
          period_start: from,
          period_end: to,
          overridden_amount: Math.round(amt * 100) / 100,
          reason,
        },
      });
      toast.success(`Settlement saved for ${from} → ${to}.`);
      setOverrideAmount("");
      onChanged();
    } catch (e) {
      throw new Error(reportDbError("save settlement", e, "Could not save settlement"));
    }
  }

  async function confirmStatus(status: "Approved" | "Rejected", { reason }: { reason: string }) {
    if (!settlement) throw new Error("Save the period first, then approve or reject.");
    try {
      await callStatus({ data: { settlement_id: settlement.id, status, reason } });
      toast.success(status === "Approved" ? "Settlement approved and locked." : "Settlement rejected.");
      onChanged();
    } catch (e) {
      throw new Error(reportDbError("update settlement", e, "Could not update settlement"));
    }
  }

  function openOverride() {
    if (!employeeId) {
      toast.error("Select an engineer first.");
      return;
    }
    const amt = Number(overrideAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      toast.error("Enter an override amount first.");
      return;
    }
    setDialog("override");
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader className="pb-3 border-b">
          <SheetTitle>
            {employeeName ?? employeeId ?? "Settlement"} · {from} → {to}
          </SheetTitle>
          <SheetDescription>
            Per-day conveyance plus flat expenses. Totals recompute server-side on save.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {isLocked ? (
            <p id="settlement-lock-hint" className="flex items-center gap-2 rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Lock className="h-3.5 w-3.5" />
              Period locked{settlement?.status ? ` · ${settlement.status}` : ""} — read-only.
            </p>
          ) : settlement ? (
            <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
              Status: <span className="font-medium text-foreground">{settlement.status ?? "Pending"}</span>
              {" "}— save recomputes and reopens as Pending; approve locks the period.
            </p>
          ) : (
            <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
              No settlement row for this period yet — saving creates a Pending row.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Km total", value: `${payable.perDay.reduce((s, d) => s + d.km, 0)} km` },
              { label: "Conveyance", value: inr(payable.amountTotal) },
              { label: "Flat expenses", value: inr(payable.flatTotal) },
              { label: "Grand total", value: inr(payable.grandTotal) },
            ].map((s) => (
              <div key={s.label} className="rounded-md border bg-card px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                <div className="text-sm font-semibold tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Per-day payable</h3>
              {warnedRows.length > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  {warnedRows.length} flagged day(s)
                </span>
              )}
            </div>
            <DataTable
              columns={DAY_COLUMNS}
              data={dayRows}
              rowKey={(r) => r.date}
              emptyIcon={Wallet}
              emptyTitle="No day logs"
              emptyHint="No conveyance logs in this period."
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Expenses by type</h3>
              <ExportButtons
                name={`expenses_${employeeId ?? "all"}_${from}_${to}`}
                title={`Expenses ${from} → ${to}`}
                rows={expenseTotals}
                columns={EXPENSE_EXPORT_COLUMNS}
              />
            </div>
            <DataTable
              columns={[
                { key: "type", header: "Charge type", sortable: true },
                {
                  key: "count",
                  header: "Lines",
                  align: "right",
                  render: (r) => <span className="tabular-nums">{r.count}</span>,
                },
                {
                  key: "total",
                  header: "Total",
                  align: "right",
                  sortable: true,
                  render: (r) => <span className="tabular-nums">{inr(r.total)}</span>,
                },
              ]}
              data={expenseTotals}
              rowKey={(r) => r.type}
              emptyIcon={Wallet}
              emptyTitle="No expenses"
              emptyHint="No flat expenses in this period."
            />
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Gated override</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="override-amount">Override amount (₹)</Label>
                <Input
                  id="override-amount"
                  inputMode="decimal"
                  placeholder={String(payable.grandTotal)}
                  value={overrideAmount}
                  onChange={(e) => setOverrideAmount(e.target.value)}
                  disabled={isLocked}
                  className="w-44 tabular-nums"
                />
              </div>
              <Button onClick={openOverride} disabled={isLocked || !employeeId}>
                Save with reason…
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Override wins only with a reason — without one the computed {inr(payable.grandTotal)} stands.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canDecide}
              aria-describedby={!canDecide ? (!settlement ? "settlement-decide-hint" : "settlement-lock-hint") : undefined}
              onClick={() => setDialog("approve")}
            >
              Approve & lock
            </Button>
            <Button
              variant="destructive"
              disabled={!canDecide}
              aria-describedby={!canDecide ? (!settlement ? "settlement-decide-hint" : "settlement-lock-hint") : undefined}
              onClick={() => setDialog("reject")}
            >
              Reject
            </Button>
            {!settlement && (
              <span id="settlement-decide-hint" className="self-center text-xs text-muted-foreground">
                Save the period first, then approve or reject.
              </span>
            )}
          </div>
        </div>

        <ControlledActionDialog
          open={dialog === "override"}
          onOpenChange={(v) => !v && setDialog(null)}
          title="Save settlement with override"
          description={`Computed ${inr(payable.grandTotal)} for ${from} → ${to}. The override of ₹${overrideAmount || "—"} applies only with a reason.`}
          confirmLabel="Save settlement"
          onConfirm={confirmOverride}
        />
        <ControlledActionDialog
          open={dialog === "approve"}
          onOpenChange={(v) => !v && setDialog(null)}
          title="Approve & lock period"
          description={`Approve ${from} → ${to} at ${inr(payable.grandTotal)}? Locking is permanent — corrections go in a new period.`}
          warning="Locked periods are immutable."
          confirmLabel="Approve & lock"
          onConfirm={(args) => confirmStatus("Approved", args)}
        />
        <ControlledActionDialog
          open={dialog === "reject"}
          onOpenChange={(v) => !v && setDialog(null)}
          title="Reject settlement"
          description={`Reject ${from} → ${to}? The engineer can revise and the period can be re-saved as Pending.`}
          confirmLabel="Reject"
          onConfirm={(args) => confirmStatus("Rejected", args)}
        />
      </SheetContent>
    </Sheet>
  );
}
