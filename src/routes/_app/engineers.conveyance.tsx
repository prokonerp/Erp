import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { DateFilterBar } from "@/components/DateFilterBar";
import { ExportButtons } from "@/components/ExportButtons";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { EngineerSelect } from "@/components/engineer/EngineerSelect";
import { ConveyanceDayTable, DAY_EXPORT_COLUMNS } from "@/components/engineer/ConveyanceDayTable";
import { useEngineerConveyance, useEngineerRoster } from "@/hooks/useEngineerAdmin";
import { adminEngKeys } from "@/lib/queryKeys";
import { rateInForce, rosterNameMap } from "@/lib/engineersAdmin";
import type { DateRange, RangeMode } from "@/lib/dateRange";
import { currentWeek, resolveRange } from "@/lib/dateRange";
import { istDateKey } from "@/lib/time";

export const Route = createFileRoute("/_app/engineers/conveyance")({
  component: EngineerConveyancePage,
  head: () => ({ meta: [{ title: "Conveyance — Prokon" }] }),
});

/** Dense inline stat — the four headline numbers without card chrome. */
function CompactStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        warn ? "border-amber-200 bg-amber-50" : "border-border bg-card"
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`text-base font-semibold tabular-nums ${warn ? "text-amber-800" : ""}`}>
        {value}
      </p>
    </div>
  );
}

/** One engineer's conveyance: compact stats + day-wise review table. */
function EngineerConveyancePage() {
  const queryClient = useQueryClient();
  const rosterQuery = useEngineerRoster();
  const [employeeId, setEmployeeId] = useState<string>("");
  const [mode, setMode] = useState<RangeMode>("week");
  const [range, setRange] = useState<DateRange>(() => currentWeek());

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

  const nameById = useMemo(() => rosterNameMap(rosterQuery.roster), [rosterQuery.roster]);
  const engineerName =
    employeeId === "" ? "" : (nameById.get(employeeId) ?? employeeId);

  const rows = conv.data.rows;
  const totalKm = useMemo(() => rows.reduce((sum, r) => sum + (r.km ?? 0), 0), [rows]);
  const flaggedCount = useMemo(
    () => rows.filter((r) => r.flags.length > 0 || r.adminStatus === "Flagged").length,
    [rows],
  );
  const rate = rateInForce(
    conv.data.rates,
    employeeId === "" ? null : employeeId,
    effective.to ?? istDateKey(),
  );

  const loading = rosterQuery.isLoading || conv.isLoading;

  function handleReviewChanged() {
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.conveyancePrefix });
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.payablesAllPrefix });
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.settlementsPrefix });
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.attentionPrefix });
  }

  const exportName = `conveyance_${engineerName.replace(/[^a-z0-9]+/gi, "_") || "engineer"}_${conv.data.window.from}_${conv.data.window.to}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Conveyance"
        description={`Day-wise review for ${conv.data.window.from} → ${conv.data.window.to}.`}
      />

      <AdminWarnings lists={[rosterQuery.warnings, conv.warnings]} />

      <div className="grid gap-3 sm:grid-cols-2">
        <EngineerSelect
          id="conveyance-engineer"
          value={employeeId}
          onChange={setEmployeeId}
          engineers={rosterQuery.roster}
          placeholder="Select engineer"
        />
        <DateFilterBar mode={mode} setMode={setMode} range={range} setRange={setRange} />
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CompactStat label="Days logged" value={loading ? "…" : rows.length} />
        <CompactStat label="Total km" value={loading ? "…" : `${totalKm.toFixed(1)} km`} />
        <CompactStat label="Flagged days" value={loading ? "…" : flaggedCount} warn={flaggedCount > 0} />
        <CompactStat
          label="Rate in force"
          value={loading ? "…" : rate == null ? "None" : `₹${rate}/km`}
          warn={rate == null}
        />
      </div>

      {rate == null && !loading && employeeId !== "" && (
        <p
          role="note"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        >
          No conveyance rate in force for {engineerName} —{" "}
          <Link
            to="/engineers/rates"
            className="font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            set a rate
          </Link>{" "}
          before approving.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {rows.length} day{rows.length === 1 ? "" : "s"} · {conv.data.window.from} →{" "}
          {conv.data.window.to}
        </p>
        <ExportButtons
          name={exportName}
          title={`Conveyance — ${engineerName} (${conv.data.window.from} → ${conv.data.window.to})`}
          rows={rows}
          columns={DAY_EXPORT_COLUMNS}
          disabled={loading || rows.length === 0}
        />
      </div>

      <section aria-label="Day-wise conveyance">
        <ConveyanceDayTable
          engineerId={employeeId === "" ? null : employeeId}
          rows={rows}
          isLoading={loading}
          onReviewChanged={handleReviewChanged}
        />
      </section>
    </div>
  );
}
