import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys } from "@/lib/queryKeys";
import { useEngineerPayables, useEngineerPayablesAll, useEngineerRoster } from "@/hooks/useEngineerAdmin";
import { DateFilterBar } from "@/components/DateFilterBar";
import { SettlementDrawer } from "@/components/engineer/SettlementDrawer";
import { ConveyanceDayTable, DAY_EXPORT_COLUMNS } from "@/components/engineer/ConveyanceDayTable";
import { ExportButtons } from "@/components/ExportButtons";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatCard } from "@/components/crm/StatCard";
import { Button } from "@/components/ui/button";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { EngineerSelect } from "@/components/engineer/EngineerSelect";
import { payableForPeriod, rosterNameMap } from "@/lib/engineersAdmin";
import type { ConveyanceDayRow } from "@/lib/engineersAdmin";
import type { ExportColumn } from "@/lib/exports";
import type { DateRange, RangeMode } from "@/lib/dateRange";
import { currentWeek, resolveRange } from "@/lib/dateRange";

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
  const [view, setView] = useState<"single" | "all">("single");
  const [mode, setMode] = useState<RangeMode>("week");
  const [range, setRange] = useState<DateRange>(() => currentWeek());
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!selectedId && roster.length > 0) setSelectedId(roster[0].employee_id);
  }, [selectedId, roster]);

  const effective = resolveRange(mode, range);
  const payables = useEngineerPayables({
    employeeId: selectedId,
    from: effective.from,
    to: effective.to,
  });
  const selected = roster.find((e) => e.employee_id === selectedId) ?? null;

  const all = useEngineerPayablesAll({
    from: effective.from,
    to: effective.to,
    enabled: view === "all",
  });

  const nameById = useMemo(() => rosterNameMap(roster), [roster]);

  // Roster order first, then any grouped engineer outside the roster.
  const orderedGroups = useMemo(() => {
    const byId = new Map(all.groups.map((g) => [g.employeeId, g]));
    const seen = new Set<string>();
    const out: { engineerId: string; name: string; group: (typeof all.groups)[0] }[] = [];
    for (const e of roster) {
      const g = byId.get(e.employee_id);
      if (g && !seen.has(e.employee_id)) {
        seen.add(e.employee_id);
        out.push({ engineerId: e.employee_id, name: e.name ?? e.employee_id, group: g });
      }
    }
    for (const g of all.groups) {
      if (!seen.has(g.employeeId)) {
        seen.add(g.employeeId);
        out.push({
          engineerId: g.employeeId,
          name: nameById.get(g.employeeId) ?? g.employeeId,
          group: g,
        });
      }
    }
    return out;
  }, [roster, all.groups, nameById]);

  const allExportColumns: ExportColumn<{ engineer: string; row: ConveyanceDayRow }>[] =
    useMemo(
      () => [
        { header: "Engineer", get: (r) => r.engineer },
        ...DAY_EXPORT_COLUMNS.map((c) => ({
          header: c.header,
          get: (r: { engineer: string; row: ConveyanceDayRow }) => c.get(r.row),
        })),
      ],
      [],
    );
  const allExportRows = useMemo(
    () =>
      orderedGroups.flatMap(({ name, group }) => group.rows.map((row) => ({ engineer: name, row }))),
    [orderedGroups],
  );

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
  const { data: settlementData, refetch: refetchSettlements } = useQuery({
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
    // Approve/reject reshapes ledger + derived views (no ledger *Prefix
    // factory exists, so use the family prefix).
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.conveyancePrefix });
    void queryClient.invalidateQueries({ queryKey: ["admin-eng", "ledger"] });
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.attentionPrefix });
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.overviewPrefix });
    void payables.refetch();
    void refetchSettlements();
  }

  function handleAllReviewChanged() {
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.payablesAllPrefix });
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.conveyancePrefix });
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.attentionPrefix });
    void all.refetch();
  }

  const settlementWarnings = settlementsWarning
    ? [{ section: "settlements", message: settlementsWarning }]
    : [];

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

      <AdminWarnings lists={[rosterWarnings, payables.warnings, all.warnings, settlementWarnings]} />

      <div
        className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1 sm:max-w-xs"
        role="tablist"
        aria-label="Payables view"
      >
        {(
          [
            { value: "single", label: "Single engineer" },
            { value: "all", label: "All engineers" },
          ] as const
        ).map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => setView(v.value)}
            className={`min-h-[40px] rounded-lg text-sm font-medium ${
              view === v.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "single" ? (
        <>
          <div className="grid gap-3 md:grid-cols-[320px_1fr]">
        <EngineerSelect
          id="expense-engineer"
          value={selectedId ?? ""}
          onChange={setSelectedId}
          engineers={roster}
          placeholder="Select an engineer"
        />
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
        </>
      ) : (
        <>
          <DateFilterBar mode={mode} setMode={setMode} range={range} setRange={setRange} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground tabular-nums">
              {orderedGroups.length} engineer{orderedGroups.length === 1 ? "" : "s"} with
              activity · {all.window.from} → {all.window.to}
            </p>
            <ExportButtons
              name={`payables_all_${all.window.from}_${all.window.to}`}
              title={`Payables — all engineers (${all.window.from} → ${all.window.to})`}
              rows={allExportRows}
              columns={allExportColumns}
              disabled={all.isLoading || allExportRows.length === 0}
            />
          </div>
          {all.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading all engineers…</p>
          ) : orderedGroups.length === 0 ? (
            <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
              No conveyance activity for any engineer in {all.window.from} → {all.window.to}.
            </div>
          ) : (
            <div className="space-y-4">
              {orderedGroups.map(({ engineerId, name, group }) => (
                <section
                  key={engineerId}
                  aria-label={`Payables for ${name}`}
                  className="space-y-2 rounded-lg border p-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">{name}</h3>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {group.totals.days} day{group.totals.days === 1 ? "" : "s"} ·{" "}
                      {group.totals.km.toFixed(1)} km · ₹
                      {group.totals.total.toLocaleString("en-IN")}
                      {group.totals.flagged > 0
                        ? ` · ${group.totals.flagged} flagged`
                        : ""}
                    </p>
                  </div>
                  <ConveyanceDayTable
                    engineerId={engineerId}
                    rows={group.rows}
                    isLoading={false}
                    onReviewChanged={handleAllReviewChanged}
                  />
                </section>
              ))}
            </div>
          )}
        </>
      )}

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
