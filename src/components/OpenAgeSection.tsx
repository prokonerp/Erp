import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRealtimeRefetch } from "@/lib/softDelete";
import { Hourglass } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList, Cell,
} from "recharts";

type T = {
  id: string;
  status: string;
  created_at: string;
  oem_call: boolean | null;
};

const BUCKETS = [
  { key: "lt24", label: "< 24 h", min: 0, max: 24, color: "#10b981" },
  { key: "24-48", label: "24–48 h", min: 24, max: 48, color: "#eab308" },
  { key: "48-72", label: "48–72 h", min: 48, max: 72, color: "#f97316" },
  { key: "gt72", label: "> 72 h", min: 72, max: Infinity, color: "#ef4444" },
] as const;

function fmtH(h: number) {
  if (!isFinite(h) || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h - d * 24);
  return `${d}d ${rem}h`;
}

export function OpenAgeSection() {
  const [rows, setRows] = useState<T[] | null>(null);
  const load = async () => {
    const { data } = await supabase
      .from("tickets")
      .select("id,status,created_at,oem_call")
      .eq("is_deleted", false)
      .not("status", "in", '("Closed","Cancelled")')
      .limit(5000);
    setRows((data || []) as T[]);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefetch("tickets", load);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const open = useMemo(() => {
    return (rows || []).map((r) => ({
      ...r,
      hours: (Date.now() - new Date(r.created_at).getTime()) / 3_600_000,
    })).filter((r) => r.hours >= 0 && isFinite(r.hours));
  }, [rows]);

  const buckets = useMemo(() => BUCKETS.map((b) => {
    const inB = open.filter((r) => r.hours >= b.min && r.hours < b.max);
    const avg = inB.length ? inB.reduce((s, r) => s + r.hours, 0) / inB.length : 0;
    return {
      key: b.key, label: b.label, color: b.color,
      count: inB.length,
      pct: open.length ? (inB.length / open.length) * 100 : 0,
      avg,
    };
  }), [open]);

  const loading = rows === null;

  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b bg-muted/30">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Hourglass className="h-4 w-4 text-amber-600" />
          Open Ticket Age Distribution
          <span className="ml-2 text-[10px] font-normal text-muted-foreground uppercase tracking-wide">Active tickets · live</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        <div className="h-56 w-full">
          {loading ? <Sk /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 20, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip content={<BucketTooltip />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} onClick={(d: any) => { window.location.href = `/tickets?ageBucket=${d.key}`; }} cursor="pointer">
                  <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 600 }} />
                  {buckets.map((b) => <Cell key={b.key} fill={b.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {buckets.map((b) => (
            <Link key={b.key} to="/tickets" search={{ ageBucket: b.key }}
              className="text-xs px-2 py-1 rounded border hover:bg-muted flex items-center gap-1.5"
              title={`Avg age: ${fmtH(b.avg)}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: b.color }} />
              <span className="font-medium">{b.label}</span>
              <span className="font-mono">{b.count}</span>
              <span className="text-muted-foreground">({b.pct.toFixed(0)}%)</span>
            </Link>
          ))}
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
      <div>Avg age: <span className="font-mono">{fmtH(p.avg)}</span></div>
      <div className="text-muted-foreground mt-1">Click to view →</div>
    </div>
  );
}

function Sk() {
  return <div className="h-full w-full rounded-md bg-muted animate-pulse" />;
}
