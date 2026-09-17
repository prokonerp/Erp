import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Clock, Search, Ticket } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { ExportButtons } from "@/components/ExportButtons";
import { StatCard } from "@/components/crm/StatCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEngineerRoster, useEngineerTickets } from "@/hooks/useEngineerAdmin";
import type { ExportColumn } from "@/lib/exports";

export const Route = createFileRoute("/_app/engineers/tickets")({
  component: EngineerTicketsPage,
  head: () => ({ meta: [{ title: "Tickets — Prokon" }] }),
});

type StatusFilter = "all" | "open" | "closed";

/** Open = not Closed/Cancelled — tickets-dashboard convention
 *  (tickets.dashboard.tsx:81,123; isTerminalStatus in lib/tickets.ts). */
function isOpen(status: string | null): boolean {
  return status !== "Closed" && status !== "Cancelled";
}

function ticketTone(status: string | null): StatusTone {
  if (status === "Closed") return "success";
  if (status === "Cancelled") return "neutral";
  return "info";
}

/** Whole days from created_at to closed_at (or now for open tickets). */
function ageDays(created: string | null, closed: string | null): number | null {
  if (!created) return null;
  const start = new Date(created).getTime();
  if (Number.isNaN(start)) return null;
  const endMs = closed ? new Date(closed).getTime() : Date.now();
  if (Number.isNaN(endMs)) return null;
  return Math.max(0, Math.floor((endMs - start) / 86_400_000));
}

type QueueRow = {
  id: string;
  case_id: string | null;
  customer_name: string | null;
  product: string | null;
  serial_no: string | null;
  status: string | null;
  assigned_employee_id: string | null;
  assigned_engineer_name: string | null;
  created_at: string | null;
  closed_at: string | null;
  engineerLabel: string;
  age: number | null;
};

const QUEUE_COLUMNS: ColumnDef<QueueRow>[] = [
  {
    key: "case_id",
    header: "Case",
    sortable: true,
    render: (r) => (
      <Link
        to="/tickets/$id"
        params={{ id: r.id }}
        className="font-mono text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {r.case_id ?? r.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: "customer_name",
    header: "Customer",
    sortable: true,
    render: (r) => <span>{r.customer_name ?? "—"}</span>,
  },
  {
    key: "product",
    header: "Product / Serial",
    render: (r) => (
      <span className="block max-w-48 truncate">
        <span>{r.product ?? "—"}</span>
        {r.serial_no ? (
          <span className="block font-mono text-xs text-muted-foreground">{r.serial_no}</span>
        ) : null}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    sortable: true,
    render: (r) => <StatusBadge tone={ticketTone(r.status)}>{r.status ?? "Unknown"}</StatusBadge>,
  },
  {
    key: "engineerLabel",
    header: "Engineer",
    sortable: true,
    render: (r) => <span>{r.engineerLabel}</span>,
  },
  {
    key: "age",
    header: "Age / Wait",
    align: "right",
    sortable: true,
    render: (r) => (
      <span className="tabular-nums">
        {r.age == null ? <span className="text-muted-foreground">—</span> : `${r.age}d`}
        <span className="block font-mono text-xs font-normal text-muted-foreground">
          {(r.created_at ?? "").slice(0, 10) || "—"}
        </span>
      </span>
    ),
  },
];

type ExportRow = {
  case_id: string;
  customer: string;
  product: string;
  serial_no: string;
  status: string;
  engineer: string;
  created: string;
  age_days: number | string;
};

const EXPORT_COLUMNS: ExportColumn<ExportRow>[] = [
  { header: "Case", get: (r) => r.case_id },
  { header: "Customer", get: (r) => r.customer },
  { header: "Product", get: (r) => r.product },
  { header: "Serial", get: (r) => r.serial_no },
  { header: "Status", get: (r) => r.status },
  { header: "Engineer", get: (r) => r.engineer },
  { header: "Created", get: (r) => r.created },
  { header: "Age (days)", get: (r) => r.age_days },
];

/** Roster-scoped ticket queue: engineer + status + search filters over
 *  all assigned tickets. Orphan rows (assigned_employee_id outside the
 *  roster) render under an "Unknown engineer" section — never dropped. */
function EngineerTicketsPage() {
  const rosterQuery = useEngineerRoster();
  const [engineerId, setEngineerId] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const ticketsQuery = useEngineerTickets(engineerId === "all" ? null : engineerId);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of rosterQuery.roster) {
      if (e && typeof e.employee_id === "string" && e.employee_id !== "") {
        map.set(e.employee_id, e.name && e.name !== "" ? e.name : e.employee_id);
      }
    }
    return map;
  }, [rosterQuery.roster]);

  const filtered = useMemo<QueueRow[]>(() => {
    const q = search.trim().toLowerCase();
    const out: QueueRow[] = [];
    for (const t of ticketsQuery.data) {
      if (!t || typeof t.id !== "string") continue;
      if (engineerId !== "all" && t.assigned_employee_id !== engineerId) continue;
      if (status === "open" && !isOpen(t.status)) continue;
      if (status === "closed" && t.status !== "Closed") continue;
      if (q !== "") {
        const hay = `${t.case_id ?? ""} ${t.customer_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const rosterName = t.assigned_employee_id ? nameById.get(t.assigned_employee_id) : undefined;
      out.push({
        id: t.id,
        case_id: t.case_id,
        customer_name: t.customer_name,
        product: t.product,
        serial_no: t.serial_no,
        status: t.status,
        assigned_employee_id: t.assigned_employee_id,
        assigned_engineer_name: t.assigned_engineer_name,
        created_at: t.created_at,
        closed_at: t.closed_at,
        engineerLabel:
          rosterName ?? (t.assigned_engineer_name || "Unknown engineer"),
        age: ageDays(t.created_at, t.closed_at),
      });
    }
    return out;
  }, [ticketsQuery.data, engineerId, status, search, nameById]);

  // Orphans: assigned ids with no roster entry. Partitioned into their own
  // section below so they are counted and visible, never silently dropped.
  const { rosterRows, orphanRows } = useMemo(() => {
    const roster: QueueRow[] = [];
    const orphans: QueueRow[] = [];
    for (const r of filtered) {
      if (r.assigned_employee_id && !nameById.has(r.assigned_employee_id)) orphans.push(r);
      else roster.push(r);
    }
    return { rosterRows: roster, orphanRows: orphans };
  }, [filtered, nameById]);

  const openCount = useMemo(() => filtered.filter((r) => isOpen(r.status)).length, [filtered]);

  const exportRows = useMemo<ExportRow[]>(
    () =>
      filtered.map((r) => ({
        case_id: r.case_id ?? r.id.slice(0, 8),
        customer: r.customer_name ?? "—",
        product: r.product ?? "—",
        serial_no: r.serial_no ?? "—",
        status: r.status ?? "Unknown",
        engineer: r.engineerLabel,
        created: (r.created_at ?? "").slice(0, 10) || "—",
        age_days: r.age ?? "—",
      })),
    [filtered],
  );

  const warnings = useMemo(
    () => [...rosterQuery.warnings, ...ticketsQuery.warnings],
    [rosterQuery.warnings, ticketsQuery.warnings],
  );
  const loading = rosterQuery.isLoading || ticketsQuery.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tickets"
        description="Roster ticket queue — filter by engineer, status, or search."
        actions={
          <ExportButtons
            name="Engineer_Tickets"
            title="Engineer Tickets"
            rows={exportRows}
            columns={EXPORT_COLUMNS}
          />
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

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="tickets-engineer">Engineer</Label>
          <Select value={engineerId} onValueChange={setEngineerId}>
            <SelectTrigger id="tickets-engineer">
              <SelectValue placeholder="All engineers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All engineers</SelectItem>
              {rosterQuery.roster.map((e) => (
                <SelectItem key={e.employee_id} value={e.employee_id}>
                  {nameById.get(e.employee_id) ?? e.employee_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tickets-status">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger id="tickets-status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tickets-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="tickets-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Case ID or customer"
              className="pl-8"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Tickets"
          value={filtered.length}
          icon={Ticket}
          loading={loading}
          hint="Matching these filters"
        />
        <StatCard
          label="Open"
          value={openCount}
          icon={Clock}
          tone={openCount > 0 ? "warning" : "default"}
          loading={loading}
          hint="Not Closed or Cancelled"
        />
      </div>

      <section aria-label="Ticket queue">
        <DataTable
          columns={QUEUE_COLUMNS}
          data={rosterRows}
          isLoading={loading}
          rowKey="id"
          emptyIcon={Ticket}
          emptyTitle="No tickets match these filters"
          emptyHint="Try a different engineer, status, or search."
        />
      </section>

      {orphanRows.length > 0 && (
        <section aria-label="Unknown engineer" className="space-y-2">
          <h2 className="text-sm font-semibold">
            Unknown engineer{" "}
            <span className="font-normal tabular-nums text-muted-foreground">
              ({orphanRows.length} ticket{orphanRows.length === 1 ? "" : "s"} assigned outside the roster)
            </span>
          </h2>
          <DataTable
            columns={QUEUE_COLUMNS}
            data={orphanRows}
            isLoading={loading}
            rowKey="id"
            emptyIcon={Ticket}
            emptyTitle="No tickets match these filters"
            emptyHint="Try a different engineer, status, or search."
          />
        </section>
      )}
    </div>
  );
}
