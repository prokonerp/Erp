import { useMemo } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Bell, FileText, IndianRupee, Truck, UserX, Wallet } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/crm/StatCard";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { ConveyanceMatrixTable } from "@/components/engineer/ConveyanceMatrixTable";
import { CustodyLedgerTable } from "@/components/engineer/CustodyLedgerTable";
import { DocComplianceGrid } from "@/components/engineer/DocComplianceGrid";
import { ExpenseLinesTable, type ExpenseLine } from "@/components/engineer/ExpenseLinesTable";
import { TicketQueueTable, type TicketQueueRow } from "@/components/engineer/TicketQueueTable";
import {
  useAttentionQueue,
  useEmployeeDocuments,
  useEngineerConveyance,
  useEngineerCustody,
  useEngineerLedger,
  useEngineerRoster,
  useEngineerTickets,
} from "@/hooks/useEngineerAdmin";
import { rateInForce, rosterNameMap } from "@/lib/engineersAdmin";
import { useLiveRoster } from "@/hooks/useEngineerMovement";
import { LiveBadge } from "@/components/engineer/LiveBadge";
import { istDateKey } from "@/lib/time";

export const Route = createFileRoute("/_app/engineers/directory/$employeeId")({
  component: EngineerDetailPage,
  head: () => ({ meta: [{ title: "Engineer Detail — Prokon" }] }),
});

const SEVERITY_TONE: Record<string, StatusTone> = {
  high: "danger",
  medium: "warning",
  low: "info",
};

function severityLabel(s: string): string {
  return s === "high" ? "High" : s === "medium" ? "Medium" : "Low";
}

function settlementTone(status: string | null): StatusTone {
  if (status === "Paid") return "success";
  if (status === "Approved") return "success";
  if (status === "Pending") return "warning";
  if (status === "Rejected") return "danger";
  return "neutral";
}

function isNonBlankPaid(v: string | null | undefined): boolean {
  return typeof v === "string" ? v.trim() !== "" : v != null;
}

function asNumber(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

type SettlementRow = {
  key: string;
  period_start: string | null;
  period_end: string | null;
  status: string | null;
  paid_at: string | null;
  locked_at: string | null;
};

const SETTLEMENT_COLUMNS: ColumnDef<SettlementRow>[] = [
  {
    key: "period_start",
    header: "Period",
    render: (r) => (
      <span className="font-mono text-xs">
        {(r.period_start ?? "—").slice(0, 10)} → {(r.period_end ?? "—").slice(0, 10)}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (r) => {
      const paid = isNonBlankPaid(r.paid_at);
      const label = paid ? "Paid" : (r.status ?? "Unknown");
      return <StatusBadge tone={settlementTone(label)}>{label}</StatusBadge>;
    },
  },
];

type RateRow = Record<string, unknown> & { effective_from: string; rate: number };

const RATE_COLUMNS: ColumnDef<RateRow>[] = [
  {
    key: "effective_from",
    header: "Effective from",
    sortable: true,
    render: (r) => <span className="font-mono text-xs">{r.effective_from}</span>,
  },
  {
    key: "rate",
    header: "Rate / km",
    align: "right",
    sortable: true,
    render: (r) => <span className="tabular-nums">₹{r.rate}</span>,
  },
];

/** One engineer's console: profile → attention → docs → rate →
 *  conveyance → settlements → tickets → custody. Each section reads its own
 *  hook and degrades on that hook's warnings alone. */
function EngineerDetailPage() {
  const { employeeId } = Route.useParams();
  const today = istDateKey();
  const monthStart = `${today.slice(0, 7)}-01`;

  const rosterQuery = useEngineerRoster();
  const attentionQuery = useAttentionQueue();
  const docsQuery = useEmployeeDocuments(employeeId);
  const conveyanceQuery = useEngineerConveyance(employeeId, monthStart, today);
  const ledgerQuery = useEngineerLedger({ from: monthStart, to: today });
  const ticketsQuery = useEngineerTickets(employeeId);
  const custodyQuery = useEngineerCustody(employeeId);
  const liveQuery = useLiveRoster();
  const liveRow = useMemo(
    () => liveQuery.data?.find((e) => e.employee_id === employeeId) ?? null,
    [liveQuery.data, employeeId],
  );

  const engineer = useMemo(
    () => rosterQuery.roster.find((e) => e.employee_id === employeeId) ?? null,
    [rosterQuery.roster, employeeId],
  );

  const attentionItems = useMemo(
    () => attentionQuery.data.filter((i) => i.employeeId === employeeId),
    [attentionQuery.data, employeeId],
  );

  const rateToday = useMemo(
    () => rateInForce(conveyanceQuery.data.rates, employeeId, today),
    [conveyanceQuery.data.rates, employeeId, today],
  );

  const rateRows = useMemo<RateRow[]>(
    () =>
      conveyanceQuery.data.rates
        .filter((r) => r && r.employee_id === employeeId)
        .map((r) => ({
          effective_from: (r.effective_from ?? "").slice(0, 10),
          rate: asNumber(r.rate_per_km),
        }))
        .filter((r) => r.effective_from !== "")
        .sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1)),
    [conveyanceQuery.data.rates, employeeId],
  );

  const kmTotal = useMemo(
    () =>
      Math.round(conveyanceQuery.data.matrix.reduce((s, row) => s + (row.km ?? 0), 0) * 10) / 10,
    [conveyanceQuery.data.matrix],
  );
  const expensesTotal = useMemo(
    () =>
      Math.round(conveyanceQuery.data.expenses.reduce((s, e) => s + asNumber(e?.amount), 0) * 100) /
      100,
    [conveyanceQuery.data.expenses],
  );

  const settlements = useMemo<SettlementRow[]>(
    () =>
      ledgerQuery.settlements
        .filter((s) => s && s.employee_id === employeeId)
        .map((s, i) => ({
          key: `${s.period_start ?? ""}::${s.period_end ?? ""}::${i}`,
          period_start: s.period_start,
          period_end: s.period_end,
          status: s.status,
          paid_at: s.paid_at ?? null,
          locked_at: (s as { locked_at?: string | null }).locked_at ?? null,
        })),
    [ledgerQuery.settlements, employeeId],
  );

  const tickets = useMemo(() => ticketsQuery.data.slice(0, 20), [ticketsQuery.data]);

  if (!rosterQuery.isLoading && !engineer) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Engineer"
          description="Field operations detail"
          backTo="/engineers/directory"
          backLabel="Directory"
        />
        <EmptyState
          icon={UserX}
          title="Engineer not found"
          hint="This id is not on the field roster. It may have been removed."
          action={
            <Link
              to="/engineers/directory"
              className="text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Back to directory
            </Link>
          }
        />
      </div>
    );
  }

  const displayName =
    engineer && typeof engineer.name === "string" && engineer.name !== ""
      ? engineer.name
      : employeeId;
  const initials = displayName
    .split(/\s+/)
    .map((p: string) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground"
            >
              {rosterQuery.isLoading ? "…" : initials}
            </span>
            {rosterQuery.isLoading ? "Loading…" : displayName}
          </span>
        }
        description={
          engineer
            ? [engineer.phone, engineer.email].filter(Boolean).join(" · ") || "No contact on file"
            : "Field operations detail"
        }
        crumbs={[
          { label: "Engineers", to: "/engineers" },
          { label: "Directory", to: "/engineers/directory" },
          { label: displayName },
        ]}
        backTo="/engineers/directory"
        backLabel="Directory"
        actions={
          engineer ? (
            <span className="flex items-center gap-2">
              <LiveBadge live={liveRow} />
              {engineer.active ? (
                <StatusBadge tone="success">Active</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Inactive</StatusBadge>
              )}
            </span>
          ) : undefined
        }
      />

      <section aria-label="Needs attention" className="space-y-2">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <AdminWarnings lists={[attentionQuery.warnings]} />
        {attentionQuery.isLoading ? (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">Loading…</div>
        ) : attentionItems.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No attention items"
            hint="Nothing needs action for this engineer right now."
          />
        ) : (
          <ul className="space-y-2">
            {attentionItems.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
              >
                <StatusBadge tone={SEVERITY_TONE[item.severity] ?? "neutral"}>
                  {severityLabel(item.severity)}
                </StatusBadge>
                <span className="text-muted-foreground">{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Documents" className="space-y-2">
        <h2 className="text-sm font-semibold">Documents</h2>
        <AdminWarnings lists={[docsQuery.warnings]} />
        <DocComplianceGrid
          docs={docsQuery.data.docs}
          present={docsQuery.data.compliance.present}
          missing={docsQuery.data.compliance.missing}
          isLoading={docsQuery.isLoading}
        />
      </section>

      <section aria-label="Conveyance rate" className="space-y-2">
        <h2 className="text-sm font-semibold">Conveyance rate</h2>
        <AdminWarnings lists={[conveyanceQuery.warnings]} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Rate in force today"
            value={rateToday === null ? "No rate set" : `₹${rateToday}/km`}
            icon={IndianRupee}
            tone={rateToday === null ? "warning" : "default"}
            loading={conveyanceQuery.isLoading}
            hint={rateToday === null ? "Set one before approving" : "Per km, effective-dated"}
          />
        </div>
        {rateToday === null && !conveyanceQuery.isLoading && (
          <p className="text-sm text-muted-foreground">
            No rate in force —{" "}
            <Link
              to="/engineers/rates"
              className="font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              set one in Rates
            </Link>
            .
          </p>
        )}
        <DataTable
          columns={RATE_COLUMNS}
          data={rateRows}
          isLoading={conveyanceQuery.isLoading}
          rowKey="effective_from"
          emptyIcon={IndianRupee}
          emptyTitle="No rates on file"
          emptyHint="Rates are append-only — add the first one to start billing km."
          emptyAction={
            <Link
              to="/engineers/rates"
              className="text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Set a rate
            </Link>
          }
        />
      </section>

      <section aria-label="Conveyance this month" className="space-y-2">
        <h2 className="text-sm font-semibold">Conveyance this month</h2>
        <AdminWarnings lists={[conveyanceQuery.warnings]} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="KM logged"
            value={kmTotal}
            icon={Truck}
            loading={conveyanceQuery.isLoading}
            hint={`${monthStart} → ${today}`}
          />
          <StatCard
            label="Days logged"
            value={conveyanceQuery.data.days.length}
            icon={FileText}
            loading={conveyanceQuery.isLoading}
            hint="Daily log rows"
          />
          <StatCard
            label="Expenses"
            value={`₹${expensesTotal}`}
            icon={Wallet}
            loading={conveyanceQuery.isLoading}
            hint="Flat claims this month"
          />
        </div>
        <ConveyanceMatrixTable
          matrix={conveyanceQuery.data.matrix}
          isLoading={conveyanceQuery.isLoading}
        />
        <ExpenseLinesTable
          expenses={conveyanceQuery.data.expenses.map(
            (e): ExpenseLine => ({
              expense_date: e?.expense_date ?? null,
              charge_type: e?.charge_type ?? null,
              amount: e?.amount ?? null,
              receipt_path: e?.receipt_path ?? null,
            }),
          )}
          isLoading={conveyanceQuery.isLoading}
        />
      </section>

      <section aria-label="Settlements" className="space-y-2">
        <h2 className="text-sm font-semibold">Settlements</h2>
        <AdminWarnings lists={[ledgerQuery.warnings]} />
        <DataTable
          columns={SETTLEMENT_COLUMNS}
          data={settlements}
          isLoading={ledgerQuery.isLoading}
          rowKey="key"
          emptyIcon={Wallet}
          emptyTitle="No settlements this month"
          emptyHint="Settlement periods appear here once they are opened."
        />
      </section>

      <section aria-label="Assigned tickets" className="space-y-2">
        <h2 className="text-sm font-semibold">Assigned tickets</h2>
        <AdminWarnings lists={[ticketsQuery.warnings]} />
        <TicketQueueTable
          rows={tickets.map(
            (t): TicketQueueRow => ({
              id: t.id,
              case_id: t.case_id,
              customer_name: t.customer_name,
              product: t.product,
              serial_no: t.serial_no,
              status: t.status,
              engineerLabel: displayName,
              created_at: t.created_at,
              closed_at: t.closed_at,
            }),
          )}
          isLoading={ticketsQuery.isLoading}
        />
      </section>

      <section aria-label="Parts in custody" className="space-y-2">
        <h2 className="text-sm font-semibold">Parts in custody</h2>
        <AdminWarnings lists={[custodyQuery.warnings]} />
        <CustodyLedgerTable
          rows={custodyQuery.data}
          nameById={rosterNameMap(rosterQuery.roster)}
          isLoading={custodyQuery.isLoading}
          showCustodian={false}
        />
      </section>
    </div>
  );
}
