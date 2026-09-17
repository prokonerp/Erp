import { CalendarDays } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { ConveyanceMatrixRow } from "@/lib/engineersAdmin";

function FlagBadges({ flags }: { flags: string[] }) {
  if (flags.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.includes("negative-km") && <StatusBadge tone="danger">Reversal</StatusBadge>}
      {flags.includes("km-outlier") && <StatusBadge tone="warning">Outlier &gt;300 km</StatusBadge>}
      {flags.includes("missing-reading") && (
        <StatusBadge tone="warning">Missing reading</StatusBadge>
      )}
    </span>
  );
}

const MATRIX_COLUMNS: ColumnDef<ConveyanceMatrixRow>[] = [
  {
    key: "log_date",
    header: "Date",
    sortable: true,
    render: (r) => <span className="font-mono text-xs">{r.log_date.slice(0, 10)}</span>,
  },
  {
    key: "morning",
    header: "Morning",
    align: "right",
    render: (r) =>
      r.morning == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{r.morning}</span>
      ),
  },
  {
    key: "evening",
    header: "Evening",
    align: "right",
    render: (r) =>
      r.evening == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{r.evening}</span>
      ),
  },
  {
    key: "km",
    header: "Km",
    align: "right",
    sortable: true,
    render: (r) =>
      r.km == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{r.km.toFixed(1)}</span>
      ),
  },
  {
    key: "flags",
    header: "Flags",
    render: (r) => <FlagBadges flags={r.flags} />,
  },
];

export function ConveyanceMatrixTable({
  matrix,
  isLoading,
}: {
  matrix: ConveyanceMatrixRow[];
  isLoading: boolean;
}) {
  return (
    <DataTable
      columns={MATRIX_COLUMNS}
      data={matrix}
      isLoading={isLoading}
      rowKey="log_date"
      emptyIcon={CalendarDays}
      emptyTitle="No conveyance days in this window"
      emptyHint="Pick an engineer or a different period."
    />
  );
}
