import { useMemo } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Bell, ChevronRight, Ticket, Truck, Users } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/crm/StatCard";
import { Button } from "@/components/ui/button";
import {
  useAttentionQueue,
  useEngineerOverview,
  useEngineerRoster,
} from "@/hooks/useEngineerAdmin";
import type { AdminWarning } from "@/lib/engineersAdmin";

export const Route = createFileRoute("/_app/engineers/")({
  component: EngineersIndex,
  head: () => ({ meta: [{ title: "Engineers Overview — Prokon" }] }),
});

const SEVERITY_TONE: Record<string, StatusTone> = {
  high: "danger",
  medium: "warning",
  low: "info",
};

function dedupeWarnings(lists: AdminWarning[][]): AdminWarning[] {
  const seen = new Set<string>();
  const out: AdminWarning[] = [];
  for (const w of lists.flat()) {
    const key = `${w.section}::${w.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

type RosterRow = {
  employee_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean | null;
  attentionCount: number;
  hasHigh: boolean;
};

const ROSTER_COLUMNS: ColumnDef<RosterRow>[] = [
  {
    key: "name",
    header: "Engineer",
    sortable: true,
    render: (r) => (
      <Link
        to="/engineers/directory/$employeeId"
        params={{ employeeId: r.employee_id }}
        className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {r.name}
      </Link>
    ),
  },
  { key: "phone", header: "Phone", render: (r) => r.phone ?? "—" },
  { key: "email", header: "Email", render: (r) => r.email ?? "—" },
  {
    key: "active",
    header: "Status",
    render: (r) =>
      r.active ? (
        <StatusBadge tone="success">Active</StatusBadge>
      ) : (
        <StatusBadge tone="neutral">Inactive</StatusBadge>
      ),
  },
  {
    key: "attentionCount",
    header: "Attention",
    align: "right",
    sortable: true,
    render: (r) =>
      r.attentionCount > 0 ? (
        <StatusBadge tone={r.hasHigh ? "danger" : "warning"}>
          {r.attentionCount} item{r.attentionCount === 1 ? "" : "s"}
        </StatusBadge>
      ) : (
        <span className="text-muted-foreground">None</span>
      ),
  },
  {
    key: "_open",
    header: "",
    render: (r) => (
      <Link
        to="/engineers/directory/$employeeId"
        params={{ employeeId: r.employee_id }}
        aria-label={`Open ${r.name}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    ),
  },
];

/** Field-ops overview: KPI strip → roster table → attention queue. */
function EngineersIndex() {
  const overview = useEngineerOverview();
  const rosterQuery = useEngineerRoster();
  const attentionQuery = useAttentionQueue();

  const attentionByEngineer = useMemo(() => {
    const map = new Map<string, { count: number; hasHigh: boolean }>();
    for (const item of attentionQuery.data) {
      const slot = map.get(item.employeeId) ?? { count: 0, hasHigh: false };
      slot.count += 1;
      if (item.severity === "high") slot.hasHigh = true;
      map.set(item.employeeId, slot);
    }
    return map;
  }, [attentionQuery.data]);

  // Real high-attention count: distinct engineers carrying ≥1 high item.
  // (useEngineerOverview has no per-engineer summaries, so it cannot count
  // this itself — counting here is exactly what rosterKpis(summaries) does.)
  // attentionQuery is per-engineer derived, so this distinct-high count matches rosterKpis(summaries).
  const attentionHigh = useMemo(() => {
    const ids = new Set<string>();
    for (const item of attentionQuery.data) {
      if (item.severity === "high") ids.add(item.employeeId);
    }
    return ids.size;
  }, [attentionQuery.data]);

  const rows = useMemo<RosterRow[]>(
    () =>
      rosterQuery.roster.map((e) => {
        const slot = attentionByEngineer.get(e.employee_id);
        return {
          employee_id: e.employee_id,
          name: typeof e.name === "string" && e.name !== "" ? e.name : e.employee_id,
          phone: e.phone,
          email: e.email,
          active: e.active,
          attentionCount: slot?.count ?? 0,
          hasHigh: slot?.hasHigh ?? false,
        };
      }),
    [rosterQuery.roster, attentionByEngineer],
  );

  const attentionPreview = useMemo(
    () => attentionQuery.data.filter((i) => i.severity === "high" || i.severity === "medium").slice(0, 5),
    [attentionQuery.data],
  );

  const warnings = dedupeWarnings([overview.warnings, rosterQuery.warnings, attentionQuery.warnings]);
  const loading = overview.isLoading || rosterQuery.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Engineers"
        description="Field operations overview"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/engineers/directory">Open directory</Link>
          </Button>
        }
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
      {rosterQuery.isError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Could not load roster:{" "}
          {rosterQuery.error instanceof Error ? rosterQuery.error.message : "failed"}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Engineers"
          value={overview.data.kpis.totalEngineers}
          icon={Users}
          loading={overview.isLoading}
          hint="On field roster"
        />
        <StatCard
          label="Open tickets"
          value={overview.data.kpis.openTickets}
          icon={Ticket}
          loading={overview.isLoading}
          hint="Assigned, not closed"
        />
        <StatCard
          label="High attention"
          value={attentionHigh}
          icon={Bell}
          tone={attentionHigh > 0 ? "danger" : "default"}
          loading={attentionQuery.isLoading}
          hint={attentionHigh > 0 ? "Engineers needing action" : "Nothing urgent"}
        />
        <StatCard
          label="KM this month"
          value={overview.data.kpis.kmMonth}
          icon={Truck}
          loading={overview.isLoading}
          hint="Logged odometer distance"
        />
      </div>

      <section aria-label="Roster">
        <DataTable
          columns={ROSTER_COLUMNS}
          data={rows}
          isLoading={loading}
          rowKey="employee_id"
          emptyIcon={Users}
          emptyTitle="No engineers on roster"
          emptyHint="Field engineers appear here once they are added to the roster."
        />
      </section>

      <section aria-label="Needs attention" className="space-y-2">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        {attentionQuery.isLoading ? (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">Loading…</div>
        ) : attentionPreview.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No attention items"
            hint="Nothing needs action right now."
          />
        ) : (
          <ul className="space-y-2">
            {attentionPreview.map((item) => (
              <li
                key={`${item.employeeId}::${item.key}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
              >
                <StatusBadge tone={SEVERITY_TONE[item.severity] ?? "neutral"}>
                  {item.severity === "high"
                    ? "High"
                    : item.severity === "medium"
                      ? "Medium"
                      : "Low"}
                </StatusBadge>
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground">{item.label}</span>
                <Link
                  to="/engineers/directory/$employeeId"
                  params={{ employeeId: item.employeeId }}
                  aria-label={`View ${item.name}`}
                  className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
