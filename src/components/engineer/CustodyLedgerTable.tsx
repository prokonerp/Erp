import { Link } from "@tanstack/react-router";
import { Package } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { CustodyLedgerRow } from "@/lib/engineersAdmin";
import { usePermissions } from "@/lib/usePermissions";

function custodianLabel(row: CustodyLedgerRow, nameById: Map<string, string>): string {
  if (row.custodian_name && row.custodian_name !== "") return row.custodian_name;
  if (row.custodian_employee_id) {
    const rosterName = nameById.get(row.custodian_employee_id);
    if (rosterName) return rosterName;
    return row.custodian_employee_id.slice(0, 8);
  }
  return "—";
}

/** Same tickets/read gate as TicketQueueTable.TicketCase — without read
 *  access the ticket id renders as plain text instead of a deny-wall link. */
function CustodyTicket({ ticketId }: { ticketId: string }) {
  const { can } = usePermissions();
  if (!can("tickets", "read")) {
    return <span className="font-mono text-xs text-muted-foreground">{ticketId.slice(0, 8)}</span>;
  }
  return (
    <Link
      to="/tickets/$id"
      params={{ id: ticketId }}
      className="font-mono text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {ticketId.slice(0, 8)}
    </Link>
  );
}

export function CustodyLedgerTable({
  rows,
  nameById,
  isLoading,
  showCustodian,
}: {
  rows: CustodyLedgerRow[];
  nameById: Map<string, string>;
  isLoading: boolean;
  showCustodian?: boolean;
}) {
  const columns: ColumnDef<CustodyLedgerRow>[] = [
    ...(showCustodian === false
      ? []
      : [
          {
            key: "custodian_employee_id",
            header: "Custodian",
            sortable: true,
            render: (r: CustodyLedgerRow) => <span>{custodianLabel(r, nameById)}</span>,
          } as ColumnDef<CustodyLedgerRow>,
        ]),
    {
      key: "part_name",
      header: "Part",
      render: (r) => <span className="text-xs">{r.part_name ?? "—"}</span>,
    },
    {
      key: "part_serial_no",
      header: "Part serial",
      sortable: true,
      render: (r) => <span className="font-mono text-xs">{r.part_serial_no ?? "—"}</span>,
    },
    {
      key: "stock_type",
      header: "Type",
      sortable: true,
      render: (r) => {
        const t = (r.stock_type ?? "").toLowerCase();
        if (t === "good") return <StatusBadge tone="success">Good</StatusBadge>;
        if (t === "defective") return <StatusBadge tone="info">Defective</StatusBadge>;
        return <span className="text-muted-foreground">—</span>;
      },
    },
    {
      key: "ticket_id",
      header: "Ticket",
      render: (r) =>
        r.ticket_id ? (
          <CustodyTicket ticketId={r.ticket_id} />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "set_at",
      header: "Since",
      sortable: true,
      align: "right",
      render: (r) => <span className="tabular-nums">{(r.set_at ?? "").slice(0, 10) || "—"}</span>,
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      isLoading={isLoading}
      rowKey={(r) =>
        `${r.stock_item_id ?? "item"}::${r.custodian_employee_id ?? "none"}::${r.part_serial_no ?? "noserial"}::${r.ticket_id ?? "noticket"}`
      }
      emptyIcon={Package}
      emptyTitle="No custody records"
      emptyHint="Nothing is currently checked out to engineers."
    />
  );
}
