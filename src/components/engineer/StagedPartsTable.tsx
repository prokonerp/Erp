import { Link } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { StagedPartRow } from "@/lib/engineersAdmin";
import { usePermissions } from "@/lib/usePermissions";

function engineerLabel(id: string | null, nameById: Map<string, string>): string {
  if (!id) return "—";
  return nameById.get(id) ?? id.slice(0, 8);
}

/** Same tickets/read gate as CustodyLedgerTable.CustodyTicket. */
function StagedTicket({ ticketId, caseId }: { ticketId: string; caseId: string | null }) {
  const { can } = usePermissions();
  const label = caseId && caseId !== "" ? caseId : ticketId.slice(0, 8);
  if (!can("tickets", "read")) {
    return <span className="font-mono text-xs text-muted-foreground">{label}</span>;
  }
  return (
    <Link
      to="/tickets/$id"
      params={{ id: ticketId }}
      className="font-mono text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </Link>
  );
}

/**
 * Open-ticket lines not yet in custody (unconfirmed FSR lines, or confirmed
 * lines whose serial matched no stock row). Companion to CustodyLedgerTable.
 */
export function StagedPartsTable({
  rows,
  nameById,
  showEngineer,
  isLoading,
}: {
  rows: StagedPartRow[];
  nameById: Map<string, string>;
  showEngineer?: boolean;
  isLoading: boolean;
}) {
  const columns: ColumnDef<StagedPartRow>[] = [
    ...(showEngineer === false
      ? []
      : [
          {
            key: "assigned_employee_id",
            header: "Engineer",
            sortable: true,
            render: (r: StagedPartRow) => (
              <span>{engineerLabel(r.assigned_employee_id, nameById)}</span>
            ),
          } as ColumnDef<StagedPartRow>,
        ]),
    {
      key: "ticket_id",
      header: "Ticket",
      render: (r) => <StagedTicket ticketId={r.ticket_id} caseId={r.case_id} />,
    },
    {
      key: "kind",
      header: "Type",
      sortable: true,
      render: (r) =>
        r.kind === "good" ? (
          <StatusBadge tone="success">Good</StatusBadge>
        ) : (
          <StatusBadge tone="info">Defective</StatusBadge>
        ),
    },
    {
      key: "name",
      header: "Part",
      render: (r) => <span className="text-xs">{r.name ?? "—"}</span>,
    },
    {
      key: "serial",
      header: "Serial",
      sortable: true,
      render: (r) => <span className="font-mono text-xs">{r.serial ?? "—"}</span>,
    },
    {
      key: "source",
      header: "Source",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.source && r.source !== "" ? r.source : "—"}
        </span>
      ),
    },
    {
      key: "confirmed",
      header: "Status",
      sortable: true,
      render: (r) =>
        r.confirmed ? (
          <StatusBadge tone="success">Confirmed</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Staged</StatusBadge>
        ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      isLoading={isLoading}
      rowKey={(r) =>
        `${r.ticket_id}::${r.kind}::${r.name ?? ""}::${r.serial ?? ""}::${r.source ?? ""}::${r.confirmed ? "c" : "s"}`
      }
      emptyIcon={ClipboardList}
      emptyTitle="No staged parts"
      emptyHint="Nothing in open tickets beyond what's already in custody."
    />
  );
}
