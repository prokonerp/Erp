import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRealtimeRefetch } from "@/lib/softDelete";
import { Activity, ShieldCheck, Wrench, AlertOctagon, Clock } from "lucide-react";

function fmtH(h: number) {
  if (!isFinite(h) || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h - d * 24);
  return `${d}d ${rem}h`;
}

type Full = {
  id: string; status: string; created_at: string; closed_at: string | null;
  oem_call: boolean | null; defective_parts_received: boolean | null;
};

export function PerformanceSplitSection() {
  const [rows, setRows] = useState<Full[] | null>(null);
  const load = async () => {
    const { data } = await supabase
      .from("tickets")
      .select("id,status,created_at,closed_at,oem_call,defective_parts_received")
      .eq("is_deleted", false)
      .limit(10000);
    setRows((data || []) as Full[]);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefetch("tickets", load);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const stats = useMemo(() => {
    const r = rows || [];
    const closed = r.filter((x) => x.status === "Closed" && x.closed_at).map((x) => ({
      ...x, hours: (new Date(x.closed_at!).getTime() - new Date(x.created_at).getTime()) / 3_600_000,
    }));
    const open = r.filter((x) => x.status !== "Closed" && x.status !== "Cancelled").map((x) => ({
      ...x, hours: (Date.now() - new Date(x.created_at).getTime()) / 3_600_000,
    }));
    const avg = (a: { hours: number }[]) => a.length ? a.reduce((s, v) => s + v.hours, 0) / a.length : 0;
    const filt = <U extends { oem_call: boolean | null }>(a: U[], oem: boolean) => a.filter((x) => !!x.oem_call === oem);
    return {
      closedOem: { count: filt(closed, true).length, avg: avg(filt(closed, true)) },
      closedNonOem: { count: filt(closed, false).length, avg: avg(filt(closed, false)) },
      openOem: { count: filt(open, true).length, avg: avg(filt(open, true)) },
      openNonOem: { count: filt(open, false).length, avg: avg(filt(open, false)) },
      withParts: { count: closed.filter((x) => x.defective_parts_received).length, avg: avg(closed.filter((x) => x.defective_parts_received)) },
      withoutParts: { count: closed.filter((x) => !x.defective_parts_received).length, avg: avg(closed.filter((x) => !x.defective_parts_received)) },
    };
  }, [rows]);

  const loading = rows === null;

  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b bg-muted/30">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Performance Summary · OEM vs Non-OEM
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          <PerfTile to="/tickets" search={{ status: "Closed", oem: "oem" }}
            icon={ShieldCheck} label="Closed OEM" count={stats.closedOem.count} avg={stats.closedOem.avg}
            avgLabel="avg execution" accent="border-l-purple-500" loading={loading} />
          <PerfTile to="/tickets" search={{ status: "Closed", oem: "phs" }}
            icon={Wrench} label="Closed Non-OEM" count={stats.closedNonOem.count} avg={stats.closedNonOem.avg}
            avgLabel="avg execution" accent="border-l-emerald-500" loading={loading} />
          <PerfTile to="/tickets" search={{ scope: "active", oem: "oem" }}
            icon={ShieldCheck} label="Open OEM" count={stats.openOem.count} avg={stats.openOem.avg}
            avgLabel="avg age" accent="border-l-blue-500" loading={loading} />
          <PerfTile to="/tickets" search={{ scope: "active", oem: "phs" }}
            icon={Wrench} label="Open Non-OEM" count={stats.openNonOem.count} avg={stats.openNonOem.avg}
            avgLabel="avg age" accent="border-l-sky-500" loading={loading} />
          <PerfTile to="/tickets" search={{ status: "Closed", parts: "with" }}
            icon={AlertOctagon} label="With Parts" count={stats.withParts.count} avg={stats.withParts.avg}
            avgLabel="avg execution" accent="border-l-orange-500" loading={loading} />
          <PerfTile to="/tickets" search={{ status: "Closed", parts: "without" }}
            icon={Clock} label="Without Parts" count={stats.withoutParts.count} avg={stats.withoutParts.avg}
            avgLabel="avg execution" accent="border-l-teal-500" loading={loading} />
        </div>
      </CardContent>
    </Card>
  );
}

function PerfTile({
  to, search, icon: Icon, label, count, avg, avgLabel, accent, loading,
}: {
  to: string; search: any; icon: any; label: string; count: number; avg: number; avgLabel: string; accent: string; loading?: boolean;
}) {
  return (
    <Link to={to} search={search} className={`block rounded-md border border-l-4 ${accent} bg-card p-3 hover:shadow-sm transition`}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />{label}
        </div>
        <div className="text-[10px] text-muted-foreground font-mono">{loading ? "…" : `${count}`}</div>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-bold tabular-nums">{loading ? "…" : fmtH(avg)}</div>
        <div className="text-[10px] text-muted-foreground">{avgLabel}</div>
      </div>
    </Link>
  );
}
