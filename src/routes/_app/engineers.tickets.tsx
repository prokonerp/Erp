import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, Search, Ticket } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
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
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { EngineerSelect } from "@/components/engineer/EngineerSelect";
import { TicketQueueTable, type TicketQueueRow } from "@/components/engineer/TicketQueueTable";
import { useEngineerRoster, useEngineerTickets } from "@/hooks/useEngineerAdmin";
import { partitionOrphans, rosterNameMap } from "@/lib/engineersAdmin";
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

/** Whole days from created_at to closed_at (or now for open tickets). */
function ageDays(created: string | null, closed: string | null): number | null {
  if (!created) return null;
  const start = new Date(created).getTime();
  if (Number.isNaN(start)) return null;
  const endMs = closed ? new Date(closed).getTime() : Date.now();
  if (Number.isNaN(endMs)) return null;
  return Math.max(0, Math.floor((endMs - start) / 86_400_000));
}

/** Queue row plus the roster id needed for orphan partitioning (TicketQueueRow drops it). */
type FilteredRow = TicketQueueRow & { assigned_employee_id: string | null };

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

  const nameById = useMemo(() => rosterNameMap(rosterQuery.roster), [rosterQuery.roster]);

  const filtered = useMemo<FilteredRow[]>(() => {
    const q = search.trim().toLowerCase();
    const out: FilteredRow[] = [];
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
        created_at: t.created_at,
        closed_at: t.closed_at,
        engineerLabel:
          rosterName ?? (t.assigned_engineer_name || "Unknown engineer"),
      });
    }
    return out;
  }, [ticketsQuery.data, engineerId, status, search, nameById]);

  // Orphans: assigned ids with no roster entry. Partitioned into their own
  // section below so they are counted and visible, never silently dropped.
  const { roster: rosterRows, orphans: orphanRows } = useMemo(
    () => partitionOrphans(filtered, nameById, (r) => r.assigned_employee_id),
    [filtered, nameById],
  );

  const openCount = useMemo(() => filtered.filter((r) => isOpen(r.status)).length, [filtered]);

  const exportRows = useMemo<ExportRow[]>(
    () =>
      filtered.map((r) => {
        const age = ageDays(r.created_at, r.closed_at);
        return {
          case_id: r.case_id ?? r.id.slice(0, 8),
          customer: r.customer_name ?? "—",
          product: r.product ?? "—",
          serial_no: r.serial_no ?? "—",
          status: r.status ?? "Unknown",
          engineer: r.engineerLabel,
          created: (r.created_at ?? "").slice(0, 10) || "—",
          age_days: age ?? "—",
        };
      }),
    [filtered],
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

      <AdminWarnings lists={[rosterQuery.warnings, ticketsQuery.warnings]} />

      <div className="grid gap-3 sm:grid-cols-3">
        <EngineerSelect
          id="tickets-engineer"
          value={engineerId}
          onChange={setEngineerId}
          engineers={rosterQuery.roster}
          allowAll
          allLabel="All engineers"
        />
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
        <TicketQueueTable rows={rosterRows} isLoading={loading} />
      </section>

      {orphanRows.length > 0 && (
        <section aria-label="Unknown engineer" className="space-y-2">
          <h2 className="text-sm font-semibold">
            Unknown engineer{" "}
            <span className="font-normal tabular-nums text-muted-foreground">
              ({orphanRows.length} ticket{orphanRows.length === 1 ? "" : "s"} assigned outside the roster)
            </span>
          </h2>
          <TicketQueueTable rows={orphanRows} isLoading={loading} />
        </section>
      )}
    </div>
  );
}
