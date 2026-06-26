import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_COLOR, TICKET_STATUSES, CALL_TYPES } from "@/lib/tickets";
import { Eye } from "lucide-react";

export const Route = createFileRoute("/_app/tickets/dashboard")({
  component: TicketsDashboard,
});

type Row = {
  id: string;
  case_id: string;
  call_type: string;
  status: string;
  customer_name: string;
  product: string | null;
  assigned_engineer_name: string | null;
  assigned_at: string | null;
  closed_at: string | null;
  created_at: string;
};

type Range = "day" | "week" | "month" | "year" | "all";

function rangeStart(r: Range): Date | null {
  if (r === "all") return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (r === "day") return d;
  if (r === "week") { d.setDate(d.getDate() - 6); return d; }
  if (r === "month") { d.setMonth(d.getMonth() - 1); return d; }
  if (r === "year") { d.setFullYear(d.getFullYear() - 1); return d; }
  return null;
}

function TicketsDashboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [range, setRange] = useState<Range>("month");
  const [loading, setLoading] = useState(true);
  type Filter =
    | { kind: "all" }
    | { kind: "open" }
    | { kind: "closed" }
    | { kind: "unassigned" }
    | { kind: "status"; value: string }
    | { kind: "type"; value: string }
    | { kind: "engineer"; value: string };
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const isActive = (f: Filter) =>
    JSON.stringify(f) === JSON.stringify(filter);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("tickets")
        .select("id,case_id,call_type,status,customer_name,product,assigned_engineer_name,assigned_at,closed_at,created_at")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(2000);
      setRows((data || []) as Row[]);
      setLoading(false);
    })();
  }, []);

  const start = rangeStart(range);

  const inRange = useMemo(
    () => rows.filter((r) => !start || new Date(r.created_at) >= start),
    [rows, start],
  );

  // KPIs
  const total = inRange.length;
  const open = inRange.filter((r) => r.status !== "Closed" && r.status !== "Cancelled").length;
  const closed = inRange.filter((r) => r.status === "Closed").length;
  const unassigned = inRange.filter((r) => !r.assigned_engineer_name && r.status !== "Closed" && r.status !== "Cancelled").length;

  // Status breakdown
  const statusCounts: Record<string, number> = {};
  TICKET_STATUSES.forEach((s) => (statusCounts[s] = 0));
  inRange.forEach((r) => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });

  // Call type breakdown
  const typeCounts: Record<string, number> = {};
  CALL_TYPES.forEach((s) => (typeCounts[s] = 0));
  inRange.forEach((r) => { typeCounts[r.call_type] = (typeCounts[r.call_type] || 0) + 1; });

  // Engineer breakdown — counts for assigned, in-progress, closed (attended) over range
  type Eng = { name: string; assigned: number; inProgress: number; closed: number; total: number };
  const engMap = new Map<string, Eng>();
  inRange.forEach((r) => {
    const name = r.assigned_engineer_name?.trim();
    if (!name) return;
    const e = engMap.get(name) || { name, assigned: 0, inProgress: 0, closed: 0, total: 0 };
    e.total += 1;
    if (r.status === "Closed") e.closed += 1;
    else if (r.status === "In Progress") e.inProgress += 1;
    else e.assigned += 1;
    engMap.set(name, e);
  });
  const engineers = Array.from(engMap.values()).sort((a, b) => b.total - a.total);

  // Attended report — closed_at falls in day/week/month/year per engineer
  function attendedSince(name: string, days: number): number {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));
    return rows.filter(
      (r) => r.assigned_engineer_name === name && r.closed_at && new Date(r.closed_at) >= since,
    ).length;
  }
  const allEngineerNames = Array.from(
    new Set(rows.map((r) => r.assigned_engineer_name).filter((n): n is string => !!n)),
  ).sort();

  const isOpen = (r: Row) => r.status !== "Closed" && r.status !== "Cancelled";
  const filtered = useMemo(() => {
    return inRange.filter((r) => {
      switch (filter.kind) {
        case "all": return true;
        case "open": return isOpen(r);
        case "closed": return r.status === "Closed";
        case "unassigned": return !r.assigned_engineer_name && isOpen(r);
        case "status": return r.status === filter.value;
        case "type": return r.call_type === filter.value;
        case "engineer": return r.assigned_engineer_name === filter.value;
      }
    });
  }, [inRange, filter]);

  const filterLabel = (() => {
    switch (filter.kind) {
      case "all": return "All tickets";
      case "open": return "Open tickets";
      case "closed": return "Closed tickets";
      case "unassigned": return "Unassigned tickets";
      case "status": return `Status: ${filter.value}`;
      case "type": return `Call type: ${filter.value}`;
      case "engineer": return `Engineer: ${filter.value}`;
    }
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Tickets Dashboard</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Range</span>
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Today</SelectItem>
              <SelectItem value="week">Last 7 days</SelectItem>
              <SelectItem value="month">Last 30 days</SelectItem>
              <SelectItem value="year">Last 12 months</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Total" value={total} tone="bg-blue-50 text-blue-800 border-blue-200" onClick={() => setFilter({ kind: "all" })} active={isActive({ kind: "all" })} />
          <Kpi label="Open" value={open} tone="bg-amber-50 text-amber-800 border-amber-200" onClick={() => setFilter({ kind: "open" })} active={isActive({ kind: "open" })} />
          <Kpi label="Closed" value={closed} tone="bg-green-50 text-green-800 border-green-200" onClick={() => setFilter({ kind: "closed" })} active={isActive({ kind: "closed" })} />
          <Kpi label="Unassigned" value={unassigned} tone="bg-rose-50 text-rose-800 border-rose-200" onClick={() => setFilter({ kind: "unassigned" })} active={isActive({ kind: "unassigned" })} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">By Status (click to filter)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {TICKET_STATUSES.map((s) => {
                const active = isActive({ kind: "status", value: s });
                return (
                  <button
                    key={s}
                    onClick={() => setFilter({ kind: "status", value: s })}
                    className={`rounded transition ${active ? "ring-2 ring-offset-1 ring-primary" : ""}`}
                  >
                    <Badge variant="secondary" className={`${STATUS_COLOR[s]} text-xs cursor-pointer`}>
                      {s}: {statusCounts[s] || 0}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By Call Type (click to filter)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {CALL_TYPES.map((s) => {
                const active = isActive({ kind: "type", value: s });
                return (
                  <button
                    key={s}
                    onClick={() => setFilter({ kind: "type", value: s })}
                    className={`rounded transition ${active ? "ring-2 ring-offset-1 ring-primary" : ""}`}
                  >
                    <Badge variant="secondary" className="bg-zinc-100 text-zinc-800 text-xs cursor-pointer">
                      {s}: {typeCounts[s] || 0}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Engineer-wise Load ({rangeLabel(range)}) — click row to filter</CardTitle></CardHeader>
        <CardContent>
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">Engineer</th>
                    <th className="p-2 text-right">Assigned / Pending</th>
                    <th className="p-2 text-right">In Progress</th>
                    <th className="p-2 text-right">Closed</th>
                    <th className="p-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {engineers.length === 0 ? (
                    <tr><td colSpan={5} className="p-4 text-muted-foreground">No assigned tickets in this range.</td></tr>
                  ) : engineers.map((e) => (
                    <tr
                      key={e.name}
                      onClick={() => setFilter({ kind: "engineer", value: e.name })}
                      className={`border-t cursor-pointer hover:bg-muted/40 ${isActive({ kind: "engineer", value: e.name }) ? "bg-primary/10" : ""}`}
                    >
                      <td className="p-2 font-medium">{e.name}</td>
                      <td className="p-2 text-right">{e.assigned}</td>
                      <td className="p-2 text-right">{e.inProgress}</td>
                      <td className="p-2 text-right">{e.closed}</td>
                      <td className="p-2 text-right font-semibold">{e.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Calls Attended (Closed) per Engineer</CardTitle></CardHeader>
        <CardContent>
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">Engineer</th>
                    <th className="p-2 text-right">Today</th>
                    <th className="p-2 text-right">Last 7 days</th>
                    <th className="p-2 text-right">Last 30 days</th>
                    <th className="p-2 text-right">Last 365 days</th>
                  </tr>
                </thead>
                <tbody>
                  {allEngineerNames.length === 0 ? (
                    <tr><td colSpan={5} className="p-4 text-muted-foreground">No engineers assigned yet.</td></tr>
                  ) : allEngineerNames.map((n) => (
                    <tr
                      key={n}
                      onClick={() => setFilter({ kind: "engineer", value: n })}
                      className={`border-t cursor-pointer hover:bg-muted/40 ${isActive({ kind: "engineer", value: n }) ? "bg-primary/10" : ""}`}
                    >
                      <td className="p-2 font-medium">{n}</td>
                      <td className="p-2 text-right">{attendedSince(n, 1)}</td>
                      <td className="p-2 text-right">{attendedSince(n, 7)}</td>
                      <td className="p-2 text-right">{attendedSince(n, 30)}</td>
                      <td className="p-2 text-right">{attendedSince(n, 365)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">
            {filterLabel} <span className="text-muted-foreground font-normal">({filtered.length})</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {filter.kind !== "all" && (
              <Button size="sm" variant="ghost" onClick={() => setFilter({ kind: "all" })}>Clear filter</Button>
            )}
            <Link to="/tickets"><Button variant="ghost" size="sm">View all</Button></Link>
          </div>
        </CardHeader>
        <CardContent>
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">Case ID</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Customer</th>
                    <th className="p-2">Engineer</th>
                    <th className="p-2">Status</th>
                    <th className="p-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="p-4 text-muted-foreground text-center">No tickets match this filter.</td></tr>
                  ) : filtered.slice(0, 50).map((r) => (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="p-2 font-mono">{r.case_id}</td>
                      <td className="p-2">{r.call_type}</td>
                      <td className="p-2">{r.customer_name}</td>
                      <td className="p-2">{r.assigned_engineer_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-2">
                        <Badge variant="secondary" className={STATUS_COLOR[r.status] || "bg-zinc-100 text-zinc-700"}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <Link to="/tickets/$id" params={{ id: r.id }}>
                          <Button size="icon" variant="ghost"><Eye className="h-4 w-4" /></Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone, onClick, active }: { label: string; value: number; tone: string; onClick: () => void; active: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border-2 p-4 transition ${tone} ${active ? "ring-2 ring-offset-2 ring-primary" : ""}`}
    >
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
    </button>
  );
}

function rangeLabel(r: Range) {
  return r === "day" ? "Today"
    : r === "week" ? "Last 7 days"
    : r === "month" ? "Last 30 days"
    : r === "year" ? "Last 12 months"
    : "All time";
}