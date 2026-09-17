import { useMemo } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  FileText,
  IndianRupee,
  Package,
  Ticket,
  Truck,
  UserX,
  Wallet,
} from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/crm/StatCard";
import {
  useAttentionQueue,
  useEmployeeDocuments,
  useEngineerConveyance,
  useEngineerCustody,
  useEngineerLedger,
  useEngineerRoster,
  useEngineerTickets,
} from "@/hooks/useEngineerAdmin";
import { rateInForce } from "@/lib/engineersAdmin";
import type { AdminWarning } from "@/lib/engineersAdmin";
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
  if (status === "Approved") return "success";
  if (status === "Pending") return "warning";
  if (status === "Rejected") return "danger";
  return "neutral";
}

function ticketTone(status: string | null): StatusTone {
  if (status === "Closed") return "success";
  if (status === "Cancelled") return "neutral";
  return "info";
}

function asNumber(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function SectionWarnings({ warnings }: { warnings: AdminWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul role="status" aria-live="polite" className="space-y-1 rounded-lg border p-3 text-sm text-muted-foreground">
      {warnings.map((w) => (
        <li key={`${w.section}::${w.message}`}>
          <span className="font-medium text-foreground">{w.section}:</span> {w.message}
        </li>
      ))}
    </ul>
  );
}

type TicketRow = {
  id: string;
  case_id: string | null;
  status: string | null;
  created_at: string | null;
  closed_at: string | null;
};

const TICKET_COLUMNS: ColumnDef<TicketRow>[] = [
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
    key: "status",
    header: "Status",
    render: (r) => <StatusBadge tone={ticketTone(r.status)}>{r.status ?? "Unknown"}</StatusBadge>,
  },
  {
    key: "created_at",
    header: "Created",
    render: (r) => (
      <span className="font-mono text-xs">{(r.created_at ?? "—").slice(0, 10)}</span>
    ),
  },
  {
    key: "closed_at",
    header: "Closed",
    render: (r) => (
      <span className="font-mono text-xs">
        {r.closed_at ? r.closed_at.slice(0, 10) : "—"}
      </span>
    ),
  },
];

type SettlementRow = {
  key: string;
  period_start: string | null;
  period_end: string | null;
  status: string | null;
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
    render: (r) => (
      <StatusBadge tone={settlementTone(r.status)}>{r.status ?? "Unknown"}</StatusBadge>
    ),
  },
];

type CustodyRow = Record<string, unknown> & {
  stock_item_id: string | null;
  part_serial_no: string | null;
  ticket_id: string | null;
  set_at: string | null;
};

const CUSTODY_COLUMNS: ColumnDef<CustodyRow>[] = [
  { key: "stock_item_id", header: "Item", render: (r) => r.stock_item_id ?? "—" },
  {
    key: "part_serial_no",
    header: "Serial",
    render: (r) => (
      <span className="font-mono text-xs">{r.part_serial_no ?? "—"}</span>
    ),
  },
  {
    key: "ticket_id",
    header: "Ticket",
    render: (r) => (
      <span className="font-mono text-xs">
        {r.ticket_id ? r.ticket_id.slice(0, 8) : "—"}
      </span>
    ),
  },
  {
    key: "set_at",
    header: "Since",
    render: (r) => <span className="font-mono text-xs">{(r.set_at ?? "—").slice(0, 10)}</span>,
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
      Math.round(
        conveyanceQuery.data.matrix.reduce((s, row) => s + (row.km ?? 0), 0) * 10,
      ) / 10,
    [conveyanceQuery.data.matrix],
  );
  const expensesTotal = useMemo(
    () =>
      Math.round(
        conveyanceQuery.data.expenses.reduce((s, e) => s + asNumber(e?.amount), 0) * 100,
      ) / 100,
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

  const docBlocks = [
    ...docsQuery.data.compliance.present.map((name) => ({ name, present: true })),
    ...docsQuery.data.compliance.missing.map((name) => ({ name, present: false })),
  ];

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
            engineer.active ? (
              <StatusBadge tone="success">Active</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Inactive</StatusBadge>
            )
          ) : undefined
        }
      />

      <section aria-label="Needs attention" className="space-y-2">
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <SectionWarnings warnings={attentionQuery.warnings} />
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
        <SectionWarnings warnings={docsQuery.warnings} />
        {docsQuery.isLoading ? (
          <div className="rounded-lg border p-4 text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {docBlocks.map((d) => (
              <div key={d.name} className="rounded-lg border p-3 text-sm">
                <div className="font-medium">{d.name}</div>
                <div className="mt-2">
                  {d.present ? (
                    <StatusBadge tone="success">On file</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Missing</StatusBadge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Conveyance rate" className="space-y-2">
        <h2 className="text-sm font-semibold">Conveyance rate</h2>
        <SectionWarnings warnings={conveyanceQuery.warnings} />
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
        <SectionWarnings warnings={conveyanceQuery.warnings} />
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
      </section>

      <section aria-label="Settlements" className="space-y-2">
        <h2 className="text-sm font-semibold">Settlements</h2>
        <SectionWarnings warnings={ledgerQuery.warnings} />
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
        <SectionWarnings warnings={ticketsQuery.warnings} />
        <DataTable
          columns={TICKET_COLUMNS}
          data={tickets}
          isLoading={ticketsQuery.isLoading}
          rowKey="id"
          emptyIcon={Ticket}
          emptyTitle="No tickets assigned"
          emptyHint="Tickets assigned to this engineer appear here, newest first."
        />
      </section>

      <section aria-label="Parts in custody" className="space-y-2">
        <h2 className="text-sm font-semibold">Parts in custody</h2>
        <SectionWarnings warnings={custodyQuery.warnings} />
        <DataTable
          columns={CUSTODY_COLUMNS}
          data={custodyQuery.data}
          isLoading={custodyQuery.isLoading}
          rowKey={(r) => `${r.stock_item_id ?? ""}::${r.set_at ?? ""}`}
          emptyIcon={Package}
          emptyTitle="No parts in custody"
          emptyHint="Stock handed to this engineer appears here until returned."
        />
      </section>
    </div>
  );
}
