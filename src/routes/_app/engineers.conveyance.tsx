import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Flag, IndianRupee, Receipt, Route as RouteIcon } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/crm/StatCard";
import { DateFilterBar } from "@/components/DateFilterBar";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEngineerConveyance, useEngineerRoster } from "@/hooks/useEngineerAdmin";
import { rateInForce, type ConveyanceMatrixRow } from "@/lib/engineersAdmin";
import type { DateRange, RangeMode } from "@/lib/dateRange";
import { currentMonth, resolveRange } from "@/lib/dateRange";
import { istDateKey } from "@/lib/time";

export const Route = createFileRoute("/_app/engineers/conveyance")({
  component: EngineerConveyancePage,
  head: () => ({ meta: [{ title: "Conveyance — Prokon" }] }),
});

function formatKm(km: number | null): string {
  return km == null ? "—" : `${km.toFixed(1)} km`;
}

function formatAmount(amount: number | string | null): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN")}`;
}

function FlagBadges({ flags }: { flags: string[] }) {
  if (flags.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.includes("negative-km") && <StatusBadge tone="danger">Reversal</StatusBadge>}
      {flags.includes("km-outlier") && <StatusBadge tone="warning">Outlier &gt;300 km</StatusBadge>}
      {flags.includes("missing-reading") && (
        <StatusBadge tone="warning">Missing reading</StatusBadge>
      )}
    </span>
  );
}

const MATRIX_COLUMNS: ColumnDef<ConveyanceMatrixRow>[] = [
  {
    key: "log_date",
    header: "Date",
    sortable: true,
    render: (r) => <span className="font-mono text-xs">{r.log_date.slice(0, 10)}</span>,
  },
  {
    key: "morning",
    header: "Morning",
    align: "right",
    render: (r) =>
      r.morning == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{r.morning}</span>
      ),
  },
  {
    key: "evening",
    header: "Evening",
    align: "right",
    render: (r) =>
      r.evening == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{r.evening}</span>
      ),
  },
  {
    key: "km",
    header: "Km",
    align: "right",
    sortable: true,
    render: (r) =>
      r.km == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{r.km.toFixed(1)}</span>
      ),
  },
  {
    key: "flags",
    header: "Flags",
    render: (r) => <FlagBadges flags={r.flags} />,
  },
];

/** Mirrors the hook's row shape (useEngineerAdmin.ts:38) — not exported there. */
type ExpenseRow = {
  expense_date: string | null;
  charge_type: string | null;
  amount: number | string | null;
  receipt_path: string | null;
};

type ExpenseTableRow = ExpenseRow & { id: string };

const EXPENSE_COLUMNS: ColumnDef<ExpenseTableRow>[] = [
  {
    key: "expense_date",
    header: "Date",
    sortable: true,
    render: (r) => (
      <span className="font-mono text-xs">{(r.expense_date ?? "").slice(0, 10) || "—"}</span>
    ),
  },
  {
    key: "charge_type",
    header: "Type",
    sortable: true,
    render: (r) => <span>{r.charge_type ?? "—"}</span>,
  },
  {
    key: "amount",
    header: "Amount",
    align: "right",
    sortable: true,
    render: (r) => <span className="tabular-nums">{formatAmount(r.amount)}</span>,
  },
  {
    key: "receipt_path",
    header: "Receipt",
    render: (r) =>
      r.receipt_path && r.receipt_path.trim() !== "" ? (
        <StatusBadge tone="success">Present</StatusBadge>
      ) : (
        <StatusBadge tone="warning">Missing</StatusBadge>
      ),
  },
];

/** One engineer's conveyance: daily odometer matrix + expenses for the window. */
function EngineerConveyancePage() {
  const rosterQuery = useEngineerRoster();
  const [employeeId, setEmployeeId] = useState<string>("");
  const [mode, setMode] = useState<RangeMode>("month");
  const [range, setRange] = useState<DateRange>(() => currentMonth());

  useEffect(() => {
    if (employeeId === "" && rosterQuery.roster.length > 0) {
      setEmployeeId(rosterQuery.roster[0].employee_id);
    }
  }, [employeeId, rosterQuery.roster]);

  const effective = resolveRange(mode, range);
  const conv = useEngineerConveyance(
    employeeId === "" ? null : employeeId,
    effective.from,
    effective.to,
  );

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of rosterQuery.roster) {
      if (e && typeof e.employee_id === "string" && e.employee_id !== "") {
        map.set(e.employee_id, e.name && e.name !== "" ? e.name : e.employee_id);
      }
    }
    return map;
  }, [rosterQuery.roster]);

  const matrix = conv.data.matrix;
  const totalKm = useMemo(() => matrix.reduce((sum, r) => sum + (r.km ?? 0), 0), [matrix]);
  const flaggedCount = useMemo(() => matrix.filter((r) => r.flags.length > 0).length, [matrix]);
  const rate = rateInForce(
    conv.data.rates,
    employeeId === "" ? null : employeeId,
    istDateKey(),
  );

  const expenseRows = useMemo<ExpenseTableRow[]>(
    () => conv.data.expenses.map((e, i) => ({ ...e, id: `${e.expense_date ?? "nodate"}-${i}` })),
    [conv.data.expenses],
  );

  const warnings = useMemo(
    () => [...rosterQuery.warnings, ...conv.warnings],
    [rosterQuery.warnings, conv.warnings],
  );
  const loading = rosterQuery.isLoading || conv.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Conveyance"
        description={`Daily odometer matrix and expenses for ${conv.data.window.from} → ${conv.data.window.to}.`}
      />

      {warnings.length > 0 && (
        <ul role="status" aria-live="polite" className="space-y-1 rounded-lg border p-3 text-sm text-muted-foreground">
          {warnings.map((w) => (
            <li key={`${w.section}::${w.message}`}>
              <span className="font-medium text-foreground">{w.section}:</span> {w.message}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="conveyance-engineer">Engineer</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger
              id="conveyance-engineer"
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SelectValue placeholder="Select engineer" />
            </SelectTrigger>
            <SelectContent>
              {rosterQuery.roster.map((e) => (
                <SelectItem key={e.employee_id} value={e.employee_id}>
                  {nameById.get(e.employee_id) ?? e.employee_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="conveyance-date">Period</Label>
          <div id="conveyance-date">
            <DateFilterBar mode={mode} setMode={setMode} range={range} setRange={setRange} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Days logged"
          value={matrix.length}
          icon={CalendarDays}
          loading={loading}
          hint="Days in the matrix"
        />
        <StatCard
          label="Total km"
          value={`${totalKm.toFixed(1)} km`}
          icon={RouteIcon}
          loading={loading}
          hint="Sum of daily km"
        />
        <StatCard
          label="Flagged days"
          value={flaggedCount}
          icon={Flag}
          tone={flaggedCount > 0 ? "warning" : "default"}
          loading={loading}
          hint="Rows needing review"
        />
        <StatCard
          label="Rate in force"
          value={rate == null ? "None" : `₹${rate}/km`}
          icon={IndianRupee}
          tone={rate == null ? "warning" : "default"}
          loading={loading}
          hint="Per-km rate today"
        />
      </div>

      {rate == null && !loading && employeeId !== "" && (
        <p
          role="note"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        >
          No conveyance rate in force for {nameById.get(employeeId) ?? employeeId} —{" "}
          <Link
            to="/engineers/rates"
            className="font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            set a rate
          </Link>{" "}
          before approving.
        </p>
      )}

      <section aria-label="Day matrix">
        <DataTable
          columns={MATRIX_COLUMNS}
          data={matrix}
          isLoading={loading}
          rowKey="log_date"
          emptyIcon={CalendarDays}
          emptyTitle="No conveyance days in this window"
          emptyHint="Pick an engineer or a different period."
        />
      </section>

      <section aria-label="Expenses">
        <DataTable
          columns={EXPENSE_COLUMNS}
          data={expenseRows}
          isLoading={loading}
          rowKey="id"
          emptyIcon={Receipt}
          emptyTitle="No expenses in this window"
          emptyHint="Pick an engineer or a different period."
        />
      </section>

      <p className="text-xs text-muted-foreground tabular-nums">
        {formatKm(totalKm)} total{rate != null ? ` × ₹${rate}/km` : " — no rate in force"}.
      </p>
    </div>
  );
}
