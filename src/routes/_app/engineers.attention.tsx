import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Bell, CircleAlert, TriangleAlert } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/crm/StatCard";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAttentionQueue } from "@/hooks/useEngineerAdmin";
import type { AttentionQueueItem } from "@/lib/engineersAdmin";

export const Route = createFileRoute("/_app/engineers/attention")({
  component: EngineersAttentionPage,
  head: () => ({ meta: [{ title: "Needs Attention — Prokon" }] }),
});

type SeverityFilter = "all" | "high" | "medium" | "low";

const SEVERITY_TONE: Record<AttentionQueueItem["severity"], StatusTone> = {
  high: "danger",
  medium: "warning",
  low: "info",
};

const ATTENTION_COLUMNS: ColumnDef<AttentionQueueItem>[] = [
  {
    key: "severity",
    header: "Severity",
    sortable: true,
    render: (r) => <StatusBadge tone={SEVERITY_TONE[r.severity]}>{r.severity}</StatusBadge>,
  },
  {
    key: "name",
    header: "Engineer",
    sortable: true,
    render: (r) => (
      <Link
        to="/engineers/directory/$employeeId"
        params={{ employeeId: r.employeeId }}
        className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {r.name}
      </Link>
    ),
  },
  {
    key: "key",
    header: "Issue",
    sortable: true,
    render: (r) => <span className="font-mono text-xs">{r.key}</span>,
  },
  {
    key: "label",
    header: "Details",
    render: (r) => <span>{r.label}</span>,
  },
];

/** Severity-ordered defect queue — one row per defect. Items arrive
 *  pre-sorted (severity-then-name) from the hook; filters preserve
 *  that order and never re-sort. */
function EngineersAttentionPage() {
  const attentionQuery = useAttentionQueue();
  const [severity, setSeverity] = useState<SeverityFilter>("all");

  const filtered = useMemo(() => {
    if (severity === "all") return attentionQuery.data;
    return attentionQuery.data.filter((item) => item.severity === severity);
  }, [attentionQuery.data, severity]);

  const counts = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    for (const item of attentionQuery.data) {
      if (item.severity === "high") high += 1;
      else if (item.severity === "medium") medium += 1;
      else if (item.severity === "low") low += 1;
    }
    return { high, medium, low };
  }, [attentionQuery.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Needs Attention"
        description="Severity-ordered queue across the roster — one row per defect."
      />

      {attentionQuery.warnings.length > 0 && (
        <ul role="status" aria-live="polite" className="space-y-1 rounded-lg border p-3 text-sm text-muted-foreground">
          {attentionQuery.warnings.map((w) => (
            <li key={`${w.section}::${w.message}`}>
              <span className="font-medium text-foreground">{w.section}:</span> {w.message}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="attention-severity">Severity</Label>
        <Select value={severity} onValueChange={(v) => setSeverity(v as SeverityFilter)}>
          <SelectTrigger id="attention-severity">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="High"
          value={counts.high}
          icon={TriangleAlert}
          tone={counts.high > 0 ? "danger" : "default"}
          loading={attentionQuery.isLoading}
          hint="Needs action first"
        />
        <StatCard
          label="Medium"
          value={counts.medium}
          icon={CircleAlert}
          tone={counts.medium > 0 ? "warning" : "default"}
          loading={attentionQuery.isLoading}
          hint="Review soon"
        />
        <StatCard
          label="Low"
          value={counts.low}
          icon={Bell}
          loading={attentionQuery.isLoading}
          hint="Informational"
        />
      </div>

      <section aria-label="Attention queue">
        <DataTable
          columns={ATTENTION_COLUMNS}
          data={filtered}
          isLoading={attentionQuery.isLoading}
          rowKey={(r) => `${r.employeeId}::${r.key}`}
          emptyIcon={Bell}
          emptyTitle="All clear"
          emptyHint="No attention items for this filter."
        />
      </section>
    </div>
  );
}
