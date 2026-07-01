import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRealtimeRefetch } from "@/lib/softDelete";
import { Timer, Zap, TrendingUp, CheckCircle2, Package, PackageX, ShieldCheck } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList, Cell,
} from "recharts";

type T = {
  id: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  oem_call: boolean | null;
  defective_parts_received: boolean | null;
};

const BUCKETS = [
  { key: "lt24", label: "< 24 h", min: 0, max: 24, color: "#10b981" },
  { key: "24-48", label: "24–48 h", min: 24, max: 48, color: "#eab308" },
  { key: "48-72", label: "48–72 h", min: 48, max: 72, color: "#f97316" },
  { key: "gt72", label: "> 72 h", min: 72, max: Infinity, color: "#ef4444" },
] as const;

function fmtH(h: number) {
  if (!isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h - d * 24);
  return `${d}d ${rem}h`;
}

export function ExecutionTimeSection() {
  const [rows, setRows] = useState<T[] | null>(null);
  const load = async () => {
    const { data } = await supabase
      .from("tickets")
      .select("id,status,created_at,closed_at,oem_call,defective_parts_received")
      .eq("is_deleted", false)
      .eq("status", "Closed")
      .not("closed_at", "is", null)
      .limit(5000);
    setRows((data || []) as T[]);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefetch("tickets", load);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const closed = useMemo(() => {
    return (rows || []).map((r) => ({
      ...r,
      hours: (new Date(r.closed_at!).getTime() - new Date(r.created_at).getTime()) / 3_600_000,
    })).filter((r) => r.hours >= 0 && isFinite(r.hours));
  }, [rows]);

  const stats = useMemo(() => {
    const hs = closed.map((r) => r.hours);
    const avg = hs.length ? hs.reduce((s, v) => s + v, 0) / hs.length : 0;
    const min = hs.length ? Math.min(...hs) : 0;
    const max = hs.length ? Math.max(...hs) : 0;
    const oem = closed.filter((r) => r.oem_call);
    const withParts = closed.filter((r) => r.defective_parts_received);
    const noParts = closed.filter((r) => !r.defective_parts_received);
    const avgOf = (a: { hours: number }[]) => a.length ? a.reduce((s, v) => s + v.hours, 0) / a.length : 0;
    return {
      avg, min, max, total: closed.length,
      oemAvg: avgOf(oem), oemCount: oem.length,
      withAvg: avgOf(withParts), withCount: withParts.length,
      withoutAvg: avgOf(noParts), withoutCount: noParts.length,
    };
  }, [closed]);

  const buckets = useMemo(() => BUCKETS.map((b) => {
    const inB = closed.filter((r) => r.hours >= b.min && r.hours < b.max);
    const avg = inB.length ? inB.reduce((s, r) => s + r.hours, 0) / inB.length : 0;
    return {
      key: b.key, label: b.label, color: b.color,
      count: inB.length,
      pct: closed.length ? (inB.length / closed.length) * 100 : 0,
      avg,
    };
  }), [closed]);

  const compareData = useMemo(() => [
    { name: "All", hours: +stats.avg.toFixed(1), color: "#3b82f6" },
    { name: "OEM", hours: +stats.oemAvg.toFixed(1), color: "#a855f7" },
    { name: "With Parts", hours: +stats.withAvg.toFixed(1), color: "#f97316" },
    { name: "No Parts", hours: +stats.withoutAvg.toFixed(1), color: "#10b981" },
  ], [stats]);

  const loading = rows === null;

  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b bg-muted/30">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Timer className="h-4 w-4 text-primary" />
          Execution Time Analytics
          <span className="ml-2 text-[10px] font-normal text-muted-foreground uppercase tracking-wide">Closed tickets · live</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <KpiLink to="/tickets" search={{ status: "Closed" }} icon={CheckCircle2} label="Total Closed" value={stats.total} tone="active" loading={loading} />
          <Kpi icon={TrendingUp} label="Avg Execution" value={fmtH(stats.avg)} tone="neutral" loading={loading} />
          <Kpi icon={Zap} label="Fastest" value={fmtH(stats.min)} tone="positive" loading={loading} />
          <Kpi icon={Timer} label="Longest" value={fmtH(stats.max)} tone="alert" loading={loading} />
        </div>

        {/* Distribution bar chart */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Execution Time Distribution</div>
          <div className="h-56 w-full">
            {loading ? <Sk /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buckets} margin={{ top: 20, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<BucketTooltip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} onClick={(d: any) => { window.location.href = `/tickets?status=Closed&bucket=${d.key}`; }} cursor="pointer">
                    <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 600 }} />
                    {buckets.map((b) => <Cell key={b.key} fill={b.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {buckets.map((b) => (
              <Link key={b.key} to="/tickets" search={{ status: "Closed", bucket: b.key }}
                className="text-xs px-2 py-1 rounded border hover:bg-muted flex items-center gap-1.5"
                title={`Avg: ${fmtH(b.avg)}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />
                <span className="font-medium">{b.label}</span>
                <span className="font-mono">{b.count}</span>
                <span className="text-muted-foreground">({b.pct.toFixed(0)}%)</span>
              </Link>
            ))}
          </div>
        </div>

        {/* OEM + Parts KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <PerfCard
            to="/tickets" search={{ status: "Closed", oem: "oem" }}
            icon={ShieldCheck} label="OEM Tickets"
            avg={stats.oemAvg} count={stats.oemCount} accent="border-l-purple-500" loading={loading} />
          <PerfCard
            to="/tickets" search={{ status: "Closed", parts: "with" }}
            icon={Package} label="With Defective Parts"
            avg={stats.withAvg} count={stats.withCount} accent="border-l-orange-500" loading={loading} />
          <PerfCard
            to="/tickets" search={{ status: "Closed", parts: "without" }}
            icon={PackageX} label="Without Defective Parts"
            avg={stats.withoutAvg} count={stats.withoutCount} accent="border-l-emerald-500" loading={loading} />
        </div>

        {/* Comparison chart */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Avg Execution Time Comparison</div>
          <div className="h-48 w-full">
            {loading ? <Sk /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={compareData} margin={{ top: 20, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} label={{ value: "Hours", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" } }} />
                  <Tooltip formatter={(v: number) => fmtH(v)} />
                  <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="hours" position="top" formatter={(v: number) => fmtH(v)} style={{ fontSize: 11, fontWeight: 600 }} />
                    {compareData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BucketTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-semibold">{p.label}</div>
      <div>Tickets: <span className="font-mono font-medium">{p.count}</span> ({p.pct.toFixed(1)}%)</div>
      <div>Avg: <span className="font-mono">{fmtH(p.avg)}</span></div>
      <div className="text-muted-foreground mt-1">Click to view →</div>
    </div>
  );
}

function Sk() {
  return <div className="h-full w-full rounded-md bg-muted animate-pulse" />;
}

type Tone = "neutral" | "positive" | "alert" | "active";
const BAR: Record<Tone, string> = {
  neutral: "border-l-zinc-400", positive: "border-l-emerald-500", alert: "border-l-red-500", active: "border-l-blue-500",
};
const TXT: Record<Tone, string> = {
  neutral: "text-foreground", positive: "text-emerald-700", alert: "text-red-700", active: "text-blue-700",
};

function Kpi({ icon: Icon, label, value, tone, loading }: { icon: any; label: string; value: string | number; tone: Tone; loading?: boolean }) {
  return (
    <div className={`rounded-md border border-l-4 ${BAR[tone]} bg-card px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Icon className="h-3 w-3" />{label}</div>
      <div className={`text-xl font-bold leading-tight ${TXT[tone]}`}>{loading ? "…" : value}</div>
    </div>
  );
}

function KpiLink({ to, search, ...rest }: { to: string; search: any } & Parameters<typeof Kpi>[0]) {
  return (
    <Link to={to} search={search} className="block hover:opacity-90 transition">
      <Kpi {...rest} />
    </Link>
  );
}

function PerfCard({
  to, search, icon: Icon, label, avg, count, accent, loading,
}: {
  to: string; search: any; icon: any; label: string; avg: number; count: number; accent: string; loading?: boolean;
}) {
  return (
    <Link to={to} search={search} className={`block rounded-md border border-l-4 ${accent} bg-card p-3 hover:shadow-sm transition`}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />{label}
        </div>
        <div className="text-[10px] text-muted-foreground font-mono">{loading ? "…" : `${count} closed`}</div>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-bold">{loading ? "…" : fmtH(avg)}</div>
        <div className="text-[10px] text-muted-foreground">avg execution</div>
      </div>
    </Link>
  );
}