import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys } from "@/lib/queryKeys";
import { useEngineerPayables, useEngineerRoster } from "@/hooks/useEngineerAdmin";
import { DateFilterBar } from "@/components/DateFilterBar";
import { SettlementDrawer } from "@/components/engineer/SettlementDrawer";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatCard } from "@/components/crm/StatCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { payableForPeriod } from "@/lib/engineersAdmin";
import type { DateRange, RangeMode } from "@/lib/dateRange";
import { currentMonth, resolveRange } from "@/lib/dateRange";

export const Route = createFileRoute("/_app/engineers/expenses")({
  component: EngineerExpensesPage,
  head: () => ({ meta: [{ title: "Payable & Expenses — Prokon" }] }),
});

type SettlementListRow = {
  id: string;
  employee_id: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string | null;
  locked_at: string | null;
  computed_amount: number | string | null;
  flat_expenses: number | string | null;
  adjusted_amount: number | string | null;
};

const PERIOD_COLUMNS: ColumnDef<SettlementListRow>[] = [
  {
    key: "period",
    header: "Period",
    sortable: true,
    render: (r) => (
      <span className="font-mono text-xs">
        {(r.period_start ?? "—").slice(0, 10)} → {(r.period_end ?? "—").slice(0, 10)}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (r) => <span className="text-sm">{r.status ?? "Pending"}</span>,
  },
  {
    key: "locked",
    header: "Locked",
    render: (r) =>
      r.locked_at && String(r.locked_at).trim() !== "" ? (
        <span className="text-xs font-medium">Yes</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "computed",
    header: "Computed",
    align: "right",
    render: (r) => <span className="tabular-nums">₹{Number(r.computed_amount ?? 0)}</span>,
  },
  {
    key: "adjusted",
    header: "Adjusted",
    align: "right",
    render: (r) =>
      r.adjusted_amount == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">₹{Number(r.adjusted_amount)}</span>
      ),
  },
];

/** Admin payable & expenses: roster + period filter + settlement periods + drawer host. */
function EngineerExpensesPage() {
  const queryClient = useQueryClient();
  const { roster, isLoading: rosterLoading, warnings: rosterWarnings } = useEngineerRoster();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<RangeMode>("month");
  const [range, setRange] = useState<DateRange>(() => currentMonth());
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!selectedId && roster.length > 0) setSelectedId(roster[0].employee_id);
  }, [selectedId, roster]);

  const effective = resolveRange(mode, range);
  const payables = useEngineerPayables({ employeeId: selectedId, from: effective.from, to: effective.to });
  const selected = roster.find((e) => e.employee_id === selectedId) ?? null;

  const totals = useMemo(
    () =>
      payableForPeriod({
        employeeId: selectedId,
        rates: payables.rates,
        days: payables.days,
        expenses: payables.expenses,
      }),
    [selectedId, payables.rates, payables.days, payables.expenses],
  );

  // Settlement periods overlapping the window (fail-soft: errors warn, never blank).
  const {
    data: settlementData,
    refetch: refetchSettlements,
  } = useQuery({
    queryKey: [...adminEngKeys.settlements(selectedId), payables.window.from, payables.window.to],
    enabled: !!selectedId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{ rows: SettlementListRow[]; warning: string | null }> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_settlements")
          .select(
            "id, employee_id, period_start, period_end, status, locked_at, computed_amount, flat_expenses, adjusted_amount",
          )
          .eq("employee_id", selectedId!)
          .lte("period_start", payables.window.to)
          .gte("period_end", payables.window.from)
          .order("period_start", { ascending: false });
        if (error) throw error;
        return { rows: Array.isArray(data) ? (data as SettlementListRow[]) : [], warning: null };
      } catch (e) {
        return { rows: [], warning: (e as { message?: string })?.message ?? "failed" };
      }
    },
  });
  const settlements = settlementData?.rows ?? [];
  const settlementsWarning = settlementData?.warning ?? null;

  const exactMatch =
    settlements.find(
      (s) =>
        (s.period_start ?? "").slice(0, 10) === payables.window.from &&
        (s.period_end ?? "").slice(0, 10) === payables.window.to,
    ) ?? null;

  function openDrawerFor(row: SettlementListRow) {
    const from = (row.period_start ?? "").slice(0, 10);
    const to = (row.period_end ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      setMode("custom");
      setRange({ from, to });
    }
    setDrawerOpen(true);
  }

  function handleChanged() {
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.settlementsPrefix });
    void payables.refetch();
    void refetchSettlements();
  }

  const allWarnings = [
    ...rosterWarnings.map((w) => `Roster: ${w.message}`),
    ...payables.warnings.map((w) => `${w.section}: ${w.message}`),
    ...(settlementsWarning ? [`settlements: ${settlementsWarning}`] : []),
  ];

  const tableColumns: ColumnDef<SettlementListRow>[] = [
    ...PERIOD_COLUMNS,
    {
      key: "_actions",
      header: "Actions",
      align: "right",
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            openDrawerFor(r);
          }}
        >
          Review
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Payable & Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Period payable per engineer — review days, gate overrides, approve or reject.
          </p>
        </div>
        <Button
          disabled={!selectedId}
          onClick={() => {
            setMode("custom");
            setRange({ from: payables.window.from, to: payables.window.to });
            setDrawerOpen(true);
          }}
        >
          Review {payables.window.from} → {payables.window.to}
        </Button>
      </div>

      {allWarnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          {allWarnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[320px_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="expense-engineer">Engineer</Label>
          <Select value={selectedId ?? ""} onValueChange={setSelectedId}>
            <SelectTrigger id="expense-engineer">
              <SelectValue placeholder="Select an engineer" />
            </SelectTrigger>
            <SelectContent>
              {roster.map((e) => (
                <SelectItem key={e.employee_id} value={e.employee_id}>
                  {e.name ?? e.employee_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DateFilterBar mode={mode} setMode={setMode} range={range} setRange={setRange} />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <StatCard
          label="Conveyance"
          value={`₹${totals.amountTotal.toLocaleString("en-IN")}`}
          icon={Wallet}
          tone="default"
          hint={`${totals.perDay.length} day(s) · ${payables.window.from} → ${payables.window.to}`}
          loading={rosterLoading || payables.isLoading}
        />
        <StatCard
          label="Flat expenses"
          value={`₹${totals.flatTotal.toLocaleString("en-IN")}`}
          icon={Wallet}
          tone="default"
          hint={`${payables.expenses.length} line(s)`}
          loading={rosterLoading || payables.isLoading}
        />
        <StatCard
          label="Grand total"
          value={`₹${totals.grandTotal.toLocaleString("en-IN")}`}
          icon={Wallet}
          tone={exactMatch?.status === "Approved" ? "success" : "warning"}
          hint={exactMatch ? `Period ${exactMatch.status ?? "Pending"}` : "No settlement saved"}
          loading={rosterLoading || payables.isLoading}
        />
      </div>

      <DataTable
        columns={tableColumns}
        data={settlements}
        isLoading={payables.isLoading}
        rowKey={(r) => r.id}
        onRowClick={openDrawerFor}
        emptyIcon={Wallet}
        emptyTitle="No settlements"
        emptyHint="No settlement periods overlap this window — review the current period to create one."
      />

      <SettlementDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        employeeId={selectedId}
        employeeName={selected?.name ?? null}
        from={payables.window.from}
        to={payables.window.to}
        rates={payables.rates}
        days={payables.days}
        expenses={payables.expenses}
        settlement={
          exactMatch
            ? { id: exactMatch.id, locked_at: exactMatch.locked_at, status: exactMatch.status }
            : null
        }
        onChanged={handleChanged}
      />
    </div>
  );
}
