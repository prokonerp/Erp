import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Lead, type Quotation, type Incentive, type IncentiveRule, type Customer, statusLabel, statusClass, fmtMoney, fmtDate, computeIncentive } from "@/lib/crm";
import { Target, TrendingUp, Calendar, Trophy, FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/_app/crm/")({
  component: CrmDashboard,
});

function CrmDashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [incentives, setIncentives] = useState<Incentive[]>([]);
  const [rules, setRules] = useState<IncentiveRule[]>([]);

  useEffect(() => {
    (async () => {
      const [l, q, i, r, c] = await Promise.all([
        supabase.from("leads").select("*").order("updated_at", { ascending: false }),
        supabase.from("quotations").select("*").order("created_at", { ascending: false }),
        supabase.from("incentives").select("*").order("created_at", { ascending: false }),
        supabase.from("incentive_rules").select("*").order("sort_order"),
        supabase.from("customers").select("*"),
      ]);
      setLeads((l.data || []) as unknown as Lead[]);
      setQuotes((q.data || []) as unknown as Quotation[]);
      setIncentives((i.data || []) as unknown as Incentive[]);
      setRules((r.data || []) as unknown as IncentiveRule[]);
      const cmap: Record<string, Customer> = {};
      for (const x of (c.data || []) as unknown as Customer[]) cmap[x.id] = x;
      setCustomers(cmap);
    })();
  }, []);

  const counts = useMemo(() => ({
    open: leads.filter((l) => l.status !== "won" && l.status !== "lost").length,
    followup: leads.filter((l) => l.status === "follow_up").length,
    won: leads.filter((l) => l.status === "won").length,
    lost: leads.filter((l) => l.status === "lost").length,
    pipeline: leads.filter((l) => l.status !== "won" && l.status !== "lost").reduce((s, l) => s + Number(l.expected_value || 0), 0),
    closed: leads.filter((l) => l.status === "won").reduce((s, l) => s + Number(l.closed_value || 0), 0),
  }), [leads]);

  const projected = useMemo(() => computeIncentive(rules, counts.closed), [rules, counts.closed]);

  const upcoming = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const limit = new Date(today); limit.setDate(limit.getDate() + 14);
    return leads
      .filter((l) => l.next_followup && new Date(l.next_followup + "T00:00:00") <= limit && l.status !== "won" && l.status !== "lost")
      .sort((a, b) => (a.next_followup || "").localeCompare(b.next_followup || ""))
      .slice(0, 10);
  }, [leads]);

  const StatCard = ({ icon: Icon, label, value, tone = "default" }: any) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`text-2xl font-bold ${tone === "green" ? "text-green-700" : tone === "red" ? "text-red-700" : ""}`}>{value}</div>
          </div>
          <Icon className={`h-8 w-8 ${tone === "green" ? "text-green-600" : tone === "red" ? "text-red-600" : "text-muted-foreground"}`} />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Target} label="Open leads" value={counts.open} />
        <StatCard icon={Calendar} label="Follow-ups" value={counts.followup} />
        <StatCard icon={Trophy} label="Won" value={counts.won} tone="green" />
        <StatCard icon={TrendingUp} label="Lost" value={counts.lost} tone="red" />
        <StatCard icon={FileSpreadsheet} label="Pipeline value" value={fmtMoney(counts.pipeline)} />
        <StatCard icon={Trophy} label="Closed (Won) value" value={fmtMoney(counts.closed)} tone="green" />
        <StatCard icon={Trophy} label="Projected incentive" value={fmtMoney(projected.payout)} tone="green" />
        <StatCard icon={TrendingUp} label="Effective rate" value={projected.applied_percent.toFixed(2) + "%"} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Upcoming follow-ups (14 days)</CardTitle>
          <Link to="/crm/leads"><Button size="sm" variant="outline">All leads</Button></Link>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <div className="text-sm text-muted-foreground">No follow-ups scheduled.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Lead</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Expected</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {upcoming.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{fmtDate(l.next_followup)}</TableCell>
                    <TableCell>{customers[l.customer_id]?.company || "—"}</TableCell>
                    <TableCell><Link to="/crm/leads/$id" params={{ id: l.id }} className="text-primary hover:underline">{l.title}</Link></TableCell>
                    <TableCell><Badge variant="outline" className={statusClass[l.status]}>{statusLabel[l.status]}</Badge></TableCell>
                    <TableCell className="text-right">{fmtMoney(l.expected_value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Recent quotations</CardTitle></CardHeader>
          <CardContent>
            {quotes.slice(0, 5).length === 0 ? (
              <div className="text-sm text-muted-foreground">No quotations yet.</div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Quote No</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {quotes.slice(0, 5).map((q) => (
                    <TableRow key={q.id}>
                      <TableCell><Link to="/crm/quotations/$id" params={{ id: q.id }} className="text-primary hover:underline">{q.quote_no}</Link></TableCell>
                      <TableCell>{fmtDate(q.quote_date)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(q.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Incentive payouts</CardTitle></CardHeader>
          <CardContent>
            {incentives.slice(0, 5).length === 0 ? (
              <div className="text-sm text-muted-foreground">No payouts recorded.</div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Closed</TableHead><TableHead>Payout</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {incentives.slice(0, 5).map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>{i.period || "—"}</TableCell>
                      <TableCell>{fmtMoney(i.closed_value)}</TableCell>
                      <TableCell>{fmtMoney(i.payout)}</TableCell>
                      <TableCell><Badge variant={i.status === "paid" ? "default" : "secondary"}>{i.status}</Badge></TableCell>
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