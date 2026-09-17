import { Receipt } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";

export type ExpenseLine = {
  expense_date: string | null;
  charge_type: string | null;
  amount: number | string | null;
  receipt_path: string | null;
};

function formatAmount(amount: number | string | null): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN")}`;
}

type ExpenseTableRow = ExpenseLine & { id: string };

const EXPENSE_COLUMNS: ColumnDef<ExpenseTableRow>[] = [
  {
    key: "expense_date",
    header: "Date",
    sortable: true,
    render: (r) => (
      <span className="font-mono text-xs">{(r.expense_date ?? "").slice(0, 10) || "—"}</span>
    ),
  },
  {
    key: "charge_type",
    header: "Type",
    sortable: true,
    render: (r) => <span>{r.charge_type ?? "—"}</span>,
  },
  {
    key: "amount",
    header: "Amount",
    align: "right",
    sortable: true,
    render: (r) => <span className="tabular-nums">{formatAmount(r.amount)}</span>,
  },
  {
    key: "receipt_path",
    header: "Receipt",
    render: (r) =>
      r.receipt_path && r.receipt_path.trim() !== "" ? (
        <StatusBadge tone="success">Present</StatusBadge>
      ) : (
        <StatusBadge tone="warning">Missing</StatusBadge>
      ),
  },
];

export function ExpenseLinesTable({
  expenses,
  isLoading,
}: {
  expenses: ExpenseLine[];
  isLoading: boolean;
}) {
  const rows: ExpenseTableRow[] = expenses.map((e, i) => ({
    ...e,
    id: `${e.expense_date ?? "nodate"}-${i}`,
  }));
  return (
    <DataTable
      columns={EXPENSE_COLUMNS}
      data={rows}
      isLoading={isLoading}
      rowKey="id"
      emptyIcon={Receipt}
      emptyTitle="No expenses in this window"
      emptyHint="Pick an engineer or a different period."
    />
  );
}
