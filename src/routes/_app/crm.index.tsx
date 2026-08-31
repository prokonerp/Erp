import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type Lead,
  type Quotation,
  type Incentive,
  type IncentiveRule,
  type Customer,
  fmtMoney,
  fmtDate,
  computeIncentive,
  timeAgo,
  fetchCustomersByIds,
} from "@/lib/crm";
import {
  Target,
  Calendar,
  Trophy,
  TrendingDown,
  FileSpreadsheet,
  BellRing,
  CalendarClock,
  Wallet,
  Percent,
  IndianRupee,
  LayoutDashboard,
  ChevronRight,
  Clock,
  TrendingUp,
} from "lucide-react";
import { StatCard } from "@/components/crm/StatCard";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { EmptyState } from "@/components/crm/EmptyState";
import { PageLoader } from "@/components/shared/skeletons";

export const Route = createFileRoute("/_app/crm/")({
  component: CrmDashboard,
});

function CrmDashboard() {
  const nav = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [incentives, setIncentives] = useState<Incentive[]>([]);
  const [rules, setRules] = useState<IncentiveRule[]>([]);
  const [staff, setStaff] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Phase 0.2 debloat: explicit cols + limit 200 + keep Promise.all smaller payload
      const [l, q, i, r] = await Promise.all([
        supabase.from("leads").select("id,customer_id,title,status,expected_value,closed_value,next_followup,owner_id,assigned_to,assigned_at,acknowledged_at,updated_at").order("updated_at", { ascending: false }).limit(200).range(0, 199),
        supabase.from("quotations").select("id,customer_id,quote_no,quote_date,status,total,created_at").order("created_at", { ascending: false }).limit(200).range(0, 199),
        supabase.from("incentives").select("id,period,closed_value,payout,status,created_at").order("created_at", { ascending: false }).limit(200).range(0, 199),
        supabase.from("incentive_rules").select("id,sort_order,percent,threshold").order("sort_order").limit(200),
      ]);
      const lData = (l.data || []) as unknown as Lead[];
      const qData = (q.data || []) as unknown as Quotation[];
      setLeads(lData);
      setQuotes(qData);
      setIncentives((i.data || []) as unknown as Incentive[]);
      setRules((r.data || []) as unknown as IncentiveRule[]);
      const custRows = await fetchCustomersByIds([
        ...lData.map((x) => x.customer_id),
        ...qData.map((x) => x.customer_id),
      ]);
      const cmap: Record<string, Customer> = {};
      for (const x of custRows) cmap[x.id] = x;
      setCustomers(cmap);
      const { data: su } = await supabase.from("app_users").select("user_id,name,email");
      const smap: Record<string, string> = {};
      for (const u of (su || []) as Array<{
        user_id: string;
        name: string | null;
        email: string | null;
      }>)
        if (u.user_id) smap[u.user_id] = u.name || u.email || u.user_id;
      setStaff(smap);
      setLoading(false);
    })();
  }, []);

  const counts = useMemo(
    () => ({
      open: leads.filter((l) => l.status !== "won" && l.status !== "lost").length,
      followup: leads.filter((l) => l.status === "follow_up").length,
      won: leads.filter((l) => l.status === "won").length,
      lost: leads.filter((l) => l.status === "lost").length,
      total: leads.length,
      pipeline: leads
        .filter((l) => l.status !== "won" && l.status !== "lost")
        .reduce((s, l) => s + Number(l.expected_value || 0), 0),
      closed: leads
        .filter((l) => l.status === "won")
        .reduce((s, l) => s + Number(l.closed_value || 0), 0),
    }),
    [leads],
  );

  const projected = useMemo(() => computeIncentive(rules, counts.closed), [rules, counts.closed]);

  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = new Date(today);
    limit.setDate(limit.getDate() + 14);
    return leads
      .filter(
        (l) =>
          l.next_followup &&
          new Date(l.next_followup + "T00:00:00") <= limit &&
          l.status !== "won" &&
          l.status !== "lost",
      )
      .sort((a, b) => (a.next_followup || "").localeCompare(b.next_followup || ""))
      .slice(0, 10);
  }, [leads]);

  const pendingAck = useMemo(
    () =>
      leads
        .filter((l) => l.assigned_at && !l.acknowledged_at)
        .sort((a, b) => (a.assigned_at || "").localeCompare(b.assigned_at || "")),
    [leads],
  );

  const effectiveRate =
    counts.won + counts.lost > 0 ? (counts.won / (counts.won + counts.lost)) * 100 : 0;

  if (loading) return <PageLoader label="Loading CRM dashboard…" />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 print:hidden">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Customers (Sales &amp; CRM)
            </div>
            <h1 className="truncate text-xl font-semibold tracking-tight">CRM Dashboard</h1>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              Pipeline, follow-ups and team activity at a glance.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/crm/quotations">
              <FileSpreadsheet className="h-4 w-4" />
              New Quotation
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/crm/leads">
              <Target className="h-4 w-4" />
              View Leads
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Target}
          label="Open leads"
          value={counts.open}
          tone="default"
          hint={`${counts.won} won · ${counts.lost} lost of ${counts.total}`}
          onClick={() => nav({ to: "/crm/leads" })}
        />
        <StatCard
          icon={Clock}
          label="Follow-ups"
          value={counts.followup}
          tone="warning"
          hint="Due in next 14 days"
          onClick={() => nav({ to: "/crm/leads" })}
        />
        <StatCard
          icon={Trophy}
          label="Won"
          value={counts.won}
          tone="success"
          hint={fmtMoney(counts.closed)}
          onClick={() => nav({ to: "/crm/leads" })}
        />
        <StatCard
          icon={TrendingDown}
          label="Lost"
          value={counts.lost}
          tone="danger"
          hint="Pipeline at risk"
          onClick={() => nav({ to: "/crm/leads" })}
        />
        <StatCard
          icon={Wallet}
          label="Pipeline value"
          value={fmtMoney(counts.pipeline)}
          tone="info"
          onClick={() => nav({ to: "/crm/leads" })}
        />
        <StatCard
          icon={IndianRupee}
          label="Closed (Won) value"
          value={fmtMoney(counts.closed)}
          tone="success"
          onClick={() => nav({ to: "/crm/leads" })}
        />
        <StatCard
          icon={Percent}
          label="Win rate"
          value={counts.won + counts.lost > 0 ? effectiveRate.toFixed(0) + "%" : "—"}
          tone="default"
          hint={effectiveRate.toFixed(1) + "% effective rate"}
          onClick={() => nav({ to: "/crm/leads" })}
        />
        <StatCard
          icon={TrendingUp}
          label="Projected incentive"
          value={fmtMoney(projected.payout)}
          tone="success"
          hint={`${projected.applied_percent.toFixed(2)}% of closed`}
          onClick={() => nav({ to: "/crm/incentives" })}
        />
      </div>

      <Card className={pendingAck.length ? "border-amber-300/70" : undefined}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
              <BellRing className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Pending acknowledgment</CardTitle>
              <p className="text-xs text-muted-foreground">
                Leads waiting for the assignee to accept.
              </p>
            </div>
          </div>
          {pendingAck.length > 0 && (
            <Badge className="bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 border-0 hover:bg-amber-100">
              {pendingAck.length}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {pendingAck.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              All assigned leads have been acknowledged.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Lead
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Customer
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Assigned to
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Assigned on
                  </TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Pending
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingAck.slice(0, 10).map((l) => (
                  <TableRow key={l.id} className="hover:bg-muted/40 transition-colors">
                    <TableCell>
                      <Link
                        to="/crm/leads/$id"
                        params={{ id: l.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {l.title}
                      </Link>
                    </TableCell>
                    <TableCell>{customers[l.customer_id]?.company || "—"}</TableCell>
                    <TableCell>{staff[l.assigned_to || l.owner_id] || "—"}</TableCell>
                    <TableCell>{fmtDate(l.assigned_at)}</TableCell>
                    <TableCell className="text-right text-amber-700 font-medium tabular-nums">
                      {timeAgo(l.assigned_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-600">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Upcoming follow-ups</CardTitle>
              <p className="text-xs text-muted-foreground">Next 14 days</p>
            </div>
          </div>
          <Button asChild size="sm" variant="ghost" className="gap-1 text-muted-foreground">
            <Link to="/crm/leads">
              All leads
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <div className="text-sm text-muted-foreground">No follow-ups scheduled.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Date
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Customer
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Lead
                  </TableHead>
                  <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Status
                  </TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Expected
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcoming.map((l) => (
                  <TableRow key={l.id} className="hover:bg-muted/40 transition-colors">
                    <TableCell className="tabular-nums">{fmtDate(l.next_followup)}</TableCell>
                    <TableCell>{customers[l.customer_id]?.company || "—"}</TableCell>
                    <TableCell>
                      <Link
                        to="/crm/leads/$id"
                        params={{ id: l.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {l.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind="lead" value={l.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtMoney(l.expected_value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-600">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <CardTitle className="text-base">Recent quotations</CardTitle>
          </CardHeader>
          <CardContent>
            {quotes.length === 0 ? (
              <EmptyState
                icon={FileSpreadsheet}
                title="No quotations yet"
                description="Create your first quote to see it here."
                action={{
                  label: "New Quotation",
                  to: "/crm/quotations/new",
                  icon: FileSpreadsheet,
                }}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Quote No
                    </TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Date
                    </TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Status
                    </TableHead>
                    <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Total
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quotes.slice(0, 5).map((q) => (
                    <TableRow key={q.id} className="hover:bg-muted/40 transition-colors">
                      <TableCell>
                        <Link
                          to="/crm/quotations/$id"
                          params={{ id: q.id }}
                          className="font-medium text-primary hover:underline"
                        >
                          {q.quote_no}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular-nums">{fmtDate(q.quote_date)}</TableCell>
                      <TableCell>
                        <StatusBadge kind="quote" value={q.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(q.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
              <Trophy className="h-4 w-4" />
            </div>
            <CardTitle className="text-base">Incentive payouts</CardTitle>
          </CardHeader>
          <CardContent>
            {incentives.length === 0 ? (
              <EmptyState
                icon={Trophy}
                title="No payouts recorded"
                description="Closed deals will appear here once invoiced."
                action={{
                  label: "Incentive Settings",
                  to: "/crm/incentives",
                  icon: Trophy,
                }}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Period
                    </TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Closed
                    </TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Payout
                    </TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incentives.slice(0, 5).map((i) => (
                    <TableRow key={i.id} className="hover:bg-muted/40 transition-colors">
                      <TableCell>{i.period || "—"}</TableCell>
                      <TableCell className="tabular-nums">{fmtMoney(i.closed_value)}</TableCell>
                      <TableCell className="font-semibold tabular-nums">
                        {fmtMoney(i.payout)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            i.status === "paid"
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20"
                              : "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20",
                          )}
                        >
                          {i.status === "paid" ? "Paid" : "Pending"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
