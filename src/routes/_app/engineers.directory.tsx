import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Users } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAttentionQueue, useEngineerRoster } from "@/hooks/useEngineerAdmin";
import type { AdminWarning } from "@/lib/engineersAdmin";

export const Route = createFileRoute("/_app/engineers/directory")({
  component: EngineerDirectoryPage,
  head: () => ({ meta: [{ title: "Engineer Directory — Prokon" }] }),
});

type DirectoryRow = {
  employee_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean | null;
  attentionCount: number;
  hasHigh: boolean;
};

const DIRECTORY_COLUMNS: ColumnDef<DirectoryRow>[] = [
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

/** Searchable roster. Per-row counts come from the bulk attention queue —
 *  no per-row queries. Per-engineer open-ticket counts live on the detail
 *  page (single-engineer query); the cross-roster queue, including the
 *  null-employee all-tickets mode, lives on the Tickets tab. */
function EngineerDirectoryPage() {
  const rosterQuery = useEngineerRoster();
  const attentionQuery = useAttentionQueue();
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"active" | "all">("active");

  const rows = useMemo<DirectoryRow[]>(() => {
    const counts = new Map<string, { count: number; hasHigh: boolean }>();
    for (const item of attentionQuery.data) {
      const slot = counts.get(item.employeeId) ?? { count: 0, hasHigh: false };
      slot.count += 1;
      if (item.severity === "high") slot.hasHigh = true;
      counts.set(item.employeeId, slot);
    }
    const q = search.trim().toLowerCase();
    return rosterQuery.roster
      .filter((e) => (show === "all" ? true : e.active))
      .filter((e) => {
        if (!q) return true;
        return (
          (e.name ?? "").toLowerCase().includes(q) || (e.phone ?? "").toLowerCase().includes(q)
        );
      })
      .map((e) => {
        const slot = counts.get(e.employee_id);
        return {
          employee_id: e.employee_id,
          name: typeof e.name === "string" && e.name !== "" ? e.name : e.employee_id,
          phone: e.phone,
          email: e.email,
          active: e.active,
          attentionCount: slot?.count ?? 0,
          hasHigh: slot?.hasHigh ?? false,
        };
      });
  }, [rosterQuery.roster, attentionQuery.data, search, show]);

  const warnings: AdminWarning[] = [...rosterQuery.warnings, ...attentionQuery.warnings];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Engineer Directory"
        description="Field engineers, searchable by name or phone"
        backTo="/engineers"
        backLabel="Overview"
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
          Could not load directory:{" "}
          {rosterQuery.error instanceof Error ? rosterQuery.error.message : "failed"}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          aria-label="Search engineers by name or phone"
          className="max-w-xs"
        />
        <div className="flex items-center gap-1" role="group" aria-label="Status filter">
          {(["active", "all"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              variant={show === v ? "default" : "ghost"}
              size="sm"
              aria-pressed={show === v}
              onClick={() => setShow(v)}
            >
              {v === "active" ? "Active" : "All"}
            </Button>
          ))}
        </div>
      </div>

      <DataTable
        columns={DIRECTORY_COLUMNS}
        data={rows}
        isLoading={rosterQuery.isLoading}
        rowKey="employee_id"
        emptyIcon={Users}
        emptyTitle={search.trim() ? "No engineers match this search" : "No engineers on roster"}
        emptyHint={
          search.trim()
            ? "Try a different name or phone number."
            : "Field engineers appear here once they are added to the roster."
        }
      />
    </div>
  );
}
