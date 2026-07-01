import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight, Users, AlertTriangle, TrendingUp, PieChart as PieIcon, BarChart3 } from "lucide-react";
import { PRIORITY_COLOR, STATUS_COLOR, hoursExcludingSundays } from "@/lib/tickets";
import { useRealtimeRefetch } from "@/lib/softDelete";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";

type T = {
  id: string;
  case_id: string;
  status: string;
  priority: string | null;
  assigned_engineer_name: string | null;
  assigned_at: string | null;
  created_at: string;
  closed_at: string | null;
  customer_name: string;
  location: string | null;
};

const CAPACITY_GREEN = 5;
const CAPACITY_YELLOW = 8;

function isToday(iso: string | null | undefined, start: Date, end: Date) {
  if (!iso) return false;
  const d = new Date(iso);
  return d >= start && d < end;
}
function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

const WAITING_STATUSES = new Set([
  "Waiting for Parts", "Parts Received", "Under Observation",
]);
const OPEN_STATUSES = new Set(["New", "Call Log"]);

export function EngineerWorkloadSection() {
  const [rows, setRows] = useState<T[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [engineerQ, setEngineerQ] = useState("");
  const [sortKey, setSortKey] = useState<"active" | "today" | "carry" | "oldest" | "high">("active");
  const [priorityF, setPriorityF] = useState<string>("all");
  const [statusF, setStatusF] = useState<string>("all");

  const load = async () => {
    // paginate to bypass 1k cap
    const all: T[] = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await supabase
        .from("tickets")
        .select("id,case_id,status,priority,assigned_engineer_name,assigned_at,created_at,closed_at,customer_name,location")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .range(from, from + size - 1);
      if (error) break;
      const batch = (data || []) as T[];
      all.push(...batch);
      if (batch.length < size) break;
      if (from > 20000) break;
    }
    setRows(all);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  useRealtimeRefetch("tickets", load);

  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(startToday); endToday.setDate(endToday.getDate() + 1);
  const sevenDaysAgo = new Date(startToday); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (priorityF !== "all" && (r.priority || "") !== priorityF) return false;
      if (statusF !== "all" && r.status !== statusF) return false;
      return true;
    });
  }, [rows, priorityF, statusF]);

  const summary = useMemo(() => {
    const r = filteredRows;
    const active = r.filter((t) => t.status !== "Closed" && t.status !== "Cancelled");
    const today = r.filter((t) => isToday(t.assigned_at || t.created_at, startToday, endToday));
    const carry = active.filter((t) => {
      const at = t.assigned_at || t.created_at;
      return !isToday(at, startToday, endToday);
    });
    const closedToday = r.filter((t) => t.status === "Closed" && isToday(t.closed_at, startToday, endToday));
    const engineersWithActive = new Set(active.map((t) => t.assigned_engineer_name || "Unassigned"));
    const avg = engineersWithActive.size ? Math.round((active.length / engineersWithActive.size) * 10) / 10 : 0;
    return {
      today: today.length, carry: carry.length, active: active.length,
      closedToday: closedToday.length, avg,
    };
  }, [filteredRows]);

  const engineerStats = useMemo(() => {
    const m = new Map<string, {
      name: string; tickets: T[];
      today: number; carry: number; active: number;
      inProgress: number; open: number; waiting: number; closedToday: number; high: number;
      oldestDays: number;
    }>();
    for (const t of filteredRows) {
      const name = t.assigned_engineer_name || "Unassigned";
      let e = m.get(name);
      if (!e) {
        e = { name, tickets: [], today: 0, carry: 0, active: 0, inProgress: 0, open: 0, waiting: 0, closedToday: 0, high: 0, oldestDays: 0 };
        m.set(name, e);
      }
      e.tickets.push(t);
      const at = t.assigned_at || t.created_at;
      const isActive = t.status !== "Closed" && t.status !== "Cancelled";
      if (isToday(at, startToday, endToday)) e.today++;
      if (isActive && !isToday(at, startToday, endToday)) e.carry++;
      if (isActive) {
        e.active++;
        if (t.status === "In Progress") e.inProgress++;
        if (OPEN_STATUSES.has(t.status)) e.open++;
        if (WAITING_STATUSES.has(t.status)) e.waiting++;
        if (t.priority === "P1" || t.priority === "P2") e.high++;
        const d = daysBetween(new Date(at), now);
        if (d > e.oldestDays) e.oldestDays = d;
      }
      if (t.status === "Closed" && isToday(t.closed_at, startToday, endToday)) e.closedToday++;
    }
    const arr = Array.from(m.values());
    const q = engineerQ.trim().toLowerCase();
    const filtered = q ? arr.filter((e) => e.name.toLowerCase().includes(q)) : arr;
    const sorted = filtered.sort((a, b) => {
      switch (sortKey) {
        case "today": return b.today - a.today;
        case "carry": return b.carry - a.carry;
        case "oldest": return b.oldestDays - a.oldestDays;
        case "high": return b.high - a.high;
        default: return b.active - a.active;
      }
    });
    return sorted;
  }, [filteredRows, engineerQ, sortKey]);

  const overdue = useMemo(() => {
    return filteredRows
      .filter((t) => t.status !== "Closed" && t.status !== "Cancelled" && hoursExcludingSundays(t.created_at) > 24)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .slice(0, 8);
  }, [filteredRows]);

  const topCarry = useMemo(() => engineerStats.filter((e) => e.name !== "Unassigned").slice().sort((a, b) => b.carry - a.carry).slice(0, 5), [engineerStats]);

  const statusDist = useMemo(() => {
    const r = filteredRows;
    const open = r.filter((t) => OPEN_STATUSES.has(t.status)).length;
    const inProgress = r.filter((t) => t.status === "In Progress").length;
    const waiting = r.filter((t) => WAITING_STATUSES.has(t.status)).length;
    const closedToday = r.filter((t) => t.status === "Closed" && isToday(t.closed_at, startToday, endToday)).length;
    return [
      { name: "Open", value: open, fill: "#3b82f6" },
      { name: "In Progress", value: inProgress, fill: "#f59e0b" },
      { name: "Waiting", value: waiting, fill: "#a855f7" },
      { name: "Closed Today", value: closedToday, fill: "#10b981" },
    ];
  }, [filteredRows]);

  const priorityDist = useMemo(() => {
    const active = filteredRows.filter((t) => t.status !== "Closed" && t.status !== "Cancelled");
    const buckets: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0, P5: 0 };
    for (const t of active) if (t.priority && buckets[t.priority] !== undefined) buckets[t.priority]++;
    return [
      { name: "Critical (P1)", value: buckets.P1, fill: "#ef4444" },
      { name: "High (P2)", value: buckets.P2, fill: "#f97316" },
      { name: "Medium (P3)", value: buckets.P3, fill: "#f59e0b" },
      { name: "Low (P4)", value: buckets.P4, fill: "#3b82f6" },
      { name: "Lowest (P5)", value: buckets.P5, fill: "#71717a" },
    ];
  }, [filteredRows]);

  const trend = useMemo(() => {
    const days: { day: string; assigned: number; closed: number; ts: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo); d.setDate(d.getDate() + i);
      days.push({ day: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }), assigned: 0, closed: 0, ts: d.getTime() });
    }
    const dayEnd = (t: number) => t + 86_400_000;
    for (const t of filteredRows) {
      const at = t.assigned_at || t.created_at;
      const atT = at ? new Date(at).getTime() : 0;
      const cT = t.closed_at ? new Date(t.closed_at).getTime() : 0;
      for (const day of days) {
        if (atT && atT >= day.ts && atT < dayEnd(day.ts)) day.assigned++;
        if (cT && cT >= day.ts && cT < dayEnd(day.ts)) day.closed++;
      }
    }
    return days;
  }, [filteredRows]);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SumCard label="Today's New" value={summary.today} tone="active" search={{ scope: "today" }} />
        <SumCard label="Carry-over" value={summary.carry} tone={summary.carry ? "alert" : "muted"} search={{ scope: "carry" }} />
        <SumCard label="Total Active" value={summary.active} tone="neutral" search={{ scope: "active" }} />
        <SumCard label="Closed Today" value={summary.closedToday} tone="positive" search={{ scope: "closedToday" }} />
        <SumCard label="Avg / Engineer" value={summary.avg} tone="muted" />
      </div>

      {/* Engineer Workload Table */}
      <Card>
        <CardHeader className="py-3 px-4 border-b bg-muted/30">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> Engineer Workload (Today)
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Input placeholder="Search engineer…" value={engineerQ} onChange={(e) => setEngineerQ(e.target.value)} className="h-8 w-40 text-xs" />
              <Select value={priorityF} onValueChange={setPriorityF}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priority</SelectItem>
                  {["P1","P2","P3","P4","P5"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusF} onValueChange={setStatusF}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {["New","Call Log","In Progress","Under Observation","Waiting for Parts","Parts Received","Closed"].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortKey} onValueChange={(v: any) => setSortKey(v)}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Sort: Total Active</SelectItem>
                  <SelectItem value="today">Sort: Today's Assigned</SelectItem>
                  <SelectItem value="carry">Sort: Carry-over</SelectItem>
                  <SelectItem value="oldest">Sort: Oldest Ticket</SelectItem>
                  <SelectItem value="high">Sort: High Priority</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows === null ? (
            <div className="p-6 text-sm text-muted-foreground">Loading engineer workload…</div>
          ) : engineerStats.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No tickets match the current filter.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 w-6"></th>
                    <th className="text-left p-2">Engineer</th>
                    <th className="text-right p-2">Today</th>
                    <th className="text-right p-2">Carry-over</th>
                    <th className="text-right p-2">Active</th>
                    <th className="text-right p-2">In Prog.</th>
                    <th className="text-right p-2">Open</th>
                    <th className="text-right p-2">Waiting</th>
                    <th className="text-right p-2">Closed Today</th>
                    <th className="text-right p-2">High Pr.</th>
                    <th className="text-right p-2">Oldest</th>
                    <th className="text-left p-2">Capacity</th>
                  </tr>
                </thead>
                <tbody>
                  {engineerStats.map((e) => {
                    const isOpen = expanded === e.name;
                    return (
                      <>
                        <tr key={e.name} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setExpanded(isOpen ? null : e.name)}>
                          <td className="p-2">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                          <td className="p-2 font-medium">{e.name}</td>
                          <NumCell value={e.today} search={{ scope: "today", engineer: e.name }} />
                          <NumCell value={e.carry} search={{ scope: "carry", engineer: e.name }} />
                          <NumCell value={e.active} search={{ scope: "active", engineer: e.name }} strong />
                          <NumCell value={e.inProgress} search={{ status: "In Progress", engineer: e.name }} />
                          <NumCell value={e.open} search={{ scope: "active", engineer: e.name }} />
                          <NumCell value={e.waiting} search={{ status: "Waiting for Parts", engineer: e.name }} />
                          <NumCell value={e.closedToday} search={{ scope: "closedToday", engineer: e.name }} />
                          <NumCell value={e.high} search={{ scope: "highPriority", engineer: e.name }} />
                          <td className="p-2 text-right whitespace-nowrap">{e.oldestDays > 0 ? `${e.oldestDays}d` : "—"}</td>
                          <td className="p-2"><CapacityBadge count={e.active} /></td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-muted/20">
                            <td></td>
                            <td colSpan={11} className="p-3">
                              <EngineerDetail engineer={e.name} tickets={e.tickets.filter((t) => t.status !== "Closed" && t.status !== "Cancelled").slice(0, 25)} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Ticket Status Distribution" icon={PieIcon}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusDist} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                {statusDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Priority Distribution (Active)" icon={BarChart3}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={priorityDist}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value">
                {priorityDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Assignment Trend (7 days)" icon={TrendingUp}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="assigned" fill="#3b82f6" name="Assigned" />
              <Bar dataKey="closed" fill="#10b981" name="Closed" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Overdue + Top carry-over */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3 px-4 border-b bg-muted/30">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" /> Overdue Tickets (&gt;24h)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {overdue.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No overdue tickets. 🎉</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left p-2">Ticket</th>
                    <th className="text-left p-2">Engineer</th>
                    <th className="text-right p-2">Days Open</th>
                  </tr>
                </thead>
                <tbody>
                  {overdue.map((t) => (
                    <tr key={t.id} className="border-t hover:bg-muted/30">
                      <td className="p-2"><Link to="/tickets/$id" params={{ id: t.id }} className="font-mono text-xs text-primary hover:underline">{t.case_id}</Link></td>
                      <td className="p-2">{t.assigned_engineer_name || <span className="text-muted-foreground">Unassigned</span>}</td>
                      <td className="p-2 text-right">{Math.floor(hoursExcludingSundays(t.created_at) / 24)}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3 px-4 border-b bg-muted/30">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-amber-600" /> Top Carry-over Engineers
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topCarry.filter((e) => e.carry > 0).length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No carry-over tickets.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left p-2">Engineer</th>
                    <th className="text-right p-2">Carry-over</th>
                    <th className="text-right p-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {topCarry.filter((e) => e.carry > 0).map((e) => (
                    <tr key={e.name} className="border-t hover:bg-muted/30">
                      <td className="p-2 font-medium">{e.name}</td>
                      <td className="p-2 text-right font-semibold text-amber-700">{e.carry}</td>
                      <td className="p-2 text-right">{e.active}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── sub components ── */

function SumCard({ label, value, tone, search }: { label: string; value: number | string; tone: "active" | "alert" | "positive" | "neutral" | "muted"; search?: Record<string, string> }) {
  const bar = {
    active: "border-l-blue-500 text-blue-700",
    alert: "border-l-red-500 text-red-700",
    positive: "border-l-emerald-500 text-emerald-700",
    neutral: "border-l-zinc-500 text-foreground",
    muted: "border-l-zinc-300 text-muted-foreground",
  }[tone];
  const body = (
    <div className={`rounded-md border border-l-4 bg-card px-3 py-3 ${bar.split(" ")[0]} hover:shadow-sm transition`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${bar.split(" ")[1]}`}>{value}</div>
    </div>
  );
  return search ? <Link to="/tickets" search={search as any}>{body}</Link> : body;
}

function NumCell({ value, search, strong }: { value: number; search: Record<string, string>; strong?: boolean }) {
  return (
    <td className="p-2 text-right whitespace-nowrap">
      {value > 0 ? (
        <Link
          to="/tickets"
          search={search as any}
          onClick={(e) => e.stopPropagation()}
          className={`hover:underline ${strong ? "font-bold text-primary" : "font-semibold text-foreground"}`}
        >
          {value}
        </Link>
      ) : <span className="text-muted-foreground">0</span>}
    </td>
  );
}

function CapacityBadge({ count }: { count: number }) {
  if (count <= CAPACITY_GREEN) return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">🟢 Light</Badge>;
  if (count <= CAPACITY_YELLOW) return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">🟡 Medium</Badge>;
  return <Badge className="bg-red-100 text-red-800 hover:bg-red-100">🔴 Heavy</Badge>;
}

function ChartCard({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b bg-muted/30">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">{children}</CardContent>
    </Card>
  );
}

function EngineerDetail({ engineer, tickets }: { engineer: string; tickets: T[] }) {
  if (!tickets.length) return <div className="text-sm text-muted-foreground">No active tickets for {engineer}.</div>;
  const now = new Date();
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2 flex items-center justify-between">
        <span><strong>{engineer}</strong> · {tickets.length} active tickets</span>
        <Link to="/tickets" search={{ engineer, scope: "active" } as any} className="text-primary hover:underline">Open in tickets →</Link>
      </div>
      <div className="overflow-x-auto border rounded-md bg-card">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-2">Ticket</th>
              <th className="text-left p-2">Customer</th>
              <th className="text-left p-2">Site</th>
              <th className="text-left p-2">Priority</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Assigned</th>
              <th className="text-right p-2">Age</th>
              <th className="text-left p-2">SLA</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => {
              const at = t.assigned_at || t.created_at;
              const days = daysBetween(new Date(at), now);
              const hrs = hoursExcludingSundays(t.created_at);
              const sla = hrs > 48 ? { text: "Breached", cls: "bg-red-100 text-red-800" } : hrs > 24 ? { text: "At Risk", cls: "bg-amber-100 text-amber-800" } : { text: "On Track", cls: "bg-emerald-100 text-emerald-800" };
              return (
                <tr key={t.id} className="border-t hover:bg-muted/30">
                  <td className="p-2"><Link to="/tickets/$id" params={{ id: t.id }} className="font-mono text-primary hover:underline">{t.case_id}</Link></td>
                  <td className="p-2">{t.customer_name}</td>
                  <td className="p-2">{t.location || "—"}</td>
                  <td className="p-2"><Badge className={PRIORITY_COLOR[t.priority || ""] || ""}>{t.priority || "—"}</Badge></td>
                  <td className="p-2"><Badge className={STATUS_COLOR[t.status] || ""}>{t.status}</Badge></td>
                  <td className="p-2 whitespace-nowrap">{new Date(at).toLocaleDateString()}</td>
                  <td className="p-2 text-right whitespace-nowrap">{days}d</td>
                  <td className="p-2"><Badge className={sla.cls}>{sla.text}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
