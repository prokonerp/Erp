import { createFileRoute, Link } from "@tanstack/react-router";
import { useEngineerDashboard } from "@/hooks/useEngineerDashboard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatINR } from "@/lib/fsrPrint";
import {
  AlertTriangle,
  CalendarClock,
  ClipboardList,
  Gauge,
  Package,
  PackageX,
  RefreshCw,
  Route as RouteIcon,
  Ticket,
  Wallet,
  Wrench,
} from "lucide-react";

export const Route = createFileRoute("/eng/")({
  component: EngDashboard,
});

function StatCard({
  to,
  label,
  value,
  icon: Icon,
  hint,
}: {
  to: string;
  label: string;
  value: string;
  icon: typeof Ticket;
  hint?: string;
}) {
  return (
    <Link
      to={to}
      className="min-h-[44px] rounded-xl border border-border bg-card p-4 active:bg-muted/50"
      aria-label={`${label}: ${value}${hint ? ` — ${hint}` : ""}`}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </span>
      <span className="mt-1 block text-[24px] font-semibold tabular-nums leading-tight">
        {value}
      </span>
      {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
    </Link>
  );
}

/** Compact today-call tile (Assigned / Pending / Completed trio). */
function CompactStat({
  to,
  label,
  value,
  icon: Icon,
}: {
  to: string;
  label: string;
  value: string;
  icon: typeof Ticket;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-border bg-card px-3 py-2.5 active:bg-muted/50"
      aria-label={`${label}: ${value}`}
    >
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </span>
      <span className="mt-0.5 block text-[20px] font-semibold tabular-nums leading-tight">
        {value}
      </span>
    </Link>
  );
}

function EngDashboard() {
  // Direct-query dashboard (no server hop): queue rows + FSR count +
  // today's log + material RPC, all in parallel.
  const { stats, isLoading, isError, error, refetch, isFetching } = useEngineerDashboard();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3" role="status" aria-busy="true">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (isError || !stats) {
    const rawMsg =
      error instanceof Error && error.message ? error.message : null;
    // Fail-loud identity signals from useMyQueue (ACCOUNT_NOT_LINKED /
    // AMBIGUOUS_EMPLOYEE_MATCH), or a null employee row with no fetch error
    // (useMyEmployee fail-soft): the login isn't linked to an employee —
    // not a connection failure.
    const msg =
      rawMsg === "ACCOUNT_NOT_LINKED" ||
      rawMsg === "AMBIGUOUS_EMPLOYEE_MATCH" ||
      rawMsg === null
        ? "Your account isn't linked to an employee record — contact admin to link your account, then retry."
        : rawMsg;
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load your dashboard"
          hint={msg}
          action={
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={isFetching}
              onClick={() => refetch()}
            >
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {stats.employeeName ? `Welcome, ${stats.employeeName}` : "Your day at a glance"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          aria-label="Refresh dashboard"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border px-3 text-sm text-foreground"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </div>

      {stats.warnings.length > 0 ? (
        <Card className="rounded-xl border-amber-700/30">
          <CardContent className="p-4">
            <p className="text-xs text-amber-700">
              Some stats unavailable: {stats.warnings.join(" · ")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        <CompactStat
          to="/eng/queue"
          label="Assigned"
          value={String(stats.assignedToday)}
          icon={ClipboardList}
        />
        <CompactStat
          to="/eng/queue"
          label="Pending"
          value={String(stats.pendingToday)}
          icon={Ticket}
        />
        <CompactStat
          to="/eng/queue"
          label="Completed"
          value={String(stats.completedToday)}
          icon={Wrench}
        />
      </div>

      <Card className="rounded-xl">
        <CardContent className="flex items-center gap-3 p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Wallet className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Pending payout</p>
            <p className="text-[20px] font-semibold tabular-nums leading-tight">
              {formatINR(stats.pendingPayout)}
            </p>
            <p className="text-[11px] text-muted-foreground">Conveyance + charges not yet paid</p>
          </div>
          <Button asChild variant="outline" size="sm" className="min-h-[44px] shrink-0">
            <Link to="/eng/conveyance">Details</Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          to="/eng/queue"
          label="Pending calls"
          value={String(stats.pendingCalls)}
          icon={Ticket}
          hint="Open in your queue"
        />
        <StatCard
          to="/eng/queue"
          label="Completed visits"
          value={String(stats.completedVisits)}
          icon={Wrench}
          hint="Reports submitted"
        />
        <StatCard
          to="/eng/queue"
          label="Material holding"
          value={String(stats.materialHolding)}
          icon={Package}
          hint="Parts in your custody"
        />
        <StatCard
          to="/eng/queue"
          label="Material pending"
          value={String(stats.materialPending.length)}
          icon={PackageX}
          hint="Defective parts awaiting GRN"
        />
      </div>

      <Card className="rounded-xl">
        <CardContent className="flex items-center gap-3 p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Gauge className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Today's km travelled</p>
            <p className="text-[20px] font-semibold tabular-nums leading-tight">
              {stats.todayKm != null ? `${stats.todayKm} km` : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {stats.todayKm != null
                ? `From today's odometer log (${stats.todayLogDate})`
                : "Shows here after your evening reading"}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="min-h-[44px] shrink-0">
            <Link to="/eng/conveyance">
              <RouteIcon className="h-4 w-4 mr-1" /> Conveyance
            </Link>
          </Button>
        </CardContent>
      </Card>

      {stats.materialPending.length > 0 ? (
        <Card className="rounded-xl border-amber-700/30">
          <CardContent className="space-y-2 p-4">
            <p className="flex items-center gap-1.5 text-[15px] font-semibold">
              <PackageX className="h-4 w-4 text-amber-700" aria-hidden />
              Pending material ({stats.materialPending.length})
            </p>
            <p className="text-xs text-muted-foreground">
              Defective parts you are carrying — cleared once the service account generates the GRN
              for the serial.
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {stats.materialPending.map((p, i) => (
                <li key={`${p.ticket_id}-${p.serial}-${i}`}>
                  <Link
                    to="/eng/ticket/$id"
                    params={{ id: p.ticket_id }}
                    className="flex min-h-[44px] items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {p.name} · {p.serial}
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {p.case_id}
                      </span>
                    </span>
                    <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Button asChild className="min-h-[44px]">
          <Link to="/eng/queue">
            <Ticket className="h-4 w-4 mr-1" /> My Queue
          </Link>
        </Button>
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link to="/eng/conveyance">
            <CalendarClock className="h-4 w-4 mr-1" /> Today's log
          </Link>
        </Button>
      </div>
    </div>
  );
}
