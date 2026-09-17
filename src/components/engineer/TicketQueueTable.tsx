import { Link } from "@tanstack/react-router";
import { Ticket } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { usePermissions } from "@/lib/usePermissions";

export type TicketQueueRow = {
  id: string;
  case_id: string | null;
  customer_name: string | null;
  product: string | null;
  serial_no: string | null;
  status: string | null;
  engineerLabel: string;
  created_at: string | null;
  closed_at: string | null;
};

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

/** Ticket deep-link gated on tickets/read — engineers.read-only admins hit a
 *  deny wall on /tickets/$id, so without read access the case renders as
 *  plain text. Same `can("tickets", "read")` check as the dashboard widget
 *  gate (dashboard.tsx) and the ModuleGate pattern. */
function TicketCase({ id, label }: { id: string; label: string }) {
  const { can } = usePermissions();
  if (!can("tickets", "read")) {
    return <span className="font-mono text-xs text-muted-foreground">{label}</span>;
  }
  return (
    <Link
      to="/tickets/$id"
      params={{ id }}
      className="font-mono text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </Link>
  );
}

const QUEUE_COLUMNS: ColumnDef<TicketQueueRow>[] = [
  {
    key: "case_id",
    header: "Case",
    sortable: true,
    render: (r) => <TicketCase id={r.id} label={r.case_id ?? r.id.slice(0, 8)} />,
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
    render: (r) => {
      const age = ageDays(r.created_at, r.closed_at);
      return (
        <span className="tabular-nums">
          {age == null ? <span className="text-muted-foreground">—</span> : `${age}d`}
          <span className="block font-mono text-xs font-normal text-muted-foreground">
            {(r.created_at ?? "").slice(0, 10) || "—"}
          </span>
        </span>
      );
    },
  },
];

export function TicketQueueTable({
  rows,
  isLoading,
}: {
  rows: TicketQueueRow[];
  isLoading: boolean;
}) {
  return (
    <DataTable
      columns={QUEUE_COLUMNS}
      data={rows}
      isLoading={isLoading}
      rowKey="id"
      emptyIcon={Ticket}
      emptyTitle="No tickets match these filters"
      emptyHint="Try a different engineer, status, or search."
    />
  );
}
