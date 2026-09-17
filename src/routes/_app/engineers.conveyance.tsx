import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Flag, IndianRupee, Route as RouteIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/crm/StatCard";
import { DateFilterBar } from "@/components/DateFilterBar";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { EngineerSelect } from "@/components/engineer/EngineerSelect";
import { ConveyanceMatrixTable } from "@/components/engineer/ConveyanceMatrixTable";
import { ExpenseLinesTable } from "@/components/engineer/ExpenseLinesTable";
import { useEngineerConveyance, useEngineerRoster } from "@/hooks/useEngineerAdmin";
import { rateInForce, rosterNameMap } from "@/lib/engineersAdmin";
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

  const nameById = useMemo(() => rosterNameMap(rosterQuery.roster), [rosterQuery.roster]);

  const matrix = conv.data.matrix;
  const totalKm = useMemo(() => matrix.reduce((sum, r) => sum + (r.km ?? 0), 0), [matrix]);
  const flaggedCount = useMemo(() => matrix.filter((r) => r.flags.length > 0).length, [matrix]);
  const rate = rateInForce(
    conv.data.rates,
    employeeId === "" ? null : employeeId,
    istDateKey(),
  );

  const loading = rosterQuery.isLoading || conv.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Conveyance"
        description={`Daily odometer matrix and expenses for ${conv.data.window.from} → ${conv.data.window.to}.`}
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
        <ConveyanceMatrixTable matrix={matrix} isLoading={loading} />
      </section>

      <section aria-label="Expenses">
        <ExpenseLinesTable expenses={conv.data.expenses} isLoading={loading} />
      </section>

      <p className="text-xs text-muted-foreground tabular-nums">
        {formatKm(totalKm)} total{rate != null ? ` × ₹${rate}/km` : " — no rate in force"}.
      </p>
    </div>
  );
}
