import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeRefetch } from "@/lib/softDelete";
import {
  Ticket, CheckCircle2, PlusCircle, RotateCcw, AlertTriangle, Timer, Hourglass,
} from "lucide-react";
import { hoursExcludingSundays } from "@/lib/tickets";

type T = {
  id: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  assigned_at: string | null;
};

function fmtH(h: number) {
  if (!isFinite(h) || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  const d = Math.floor(h / 24);
  const rem = Math.round(h - d * 24);
  return `${d}d ${rem}h`;
}

function isToday(iso: string | null | undefined, start: Date, end: Date) {
  if (!iso) return false;
  const d = new Date(iso);
  return d >= start && d < end;
}

export function ExecutiveKpisSection() {
  const [rows, setRows] = useState<T[] | null>(null);
  const load = async () => {
    const all: T[] = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await supabase
        .from("tickets")
        .select("id,status,created_at,closed_at,assigned_at")
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
  useEffect(() => { load(); }, []);
  useRealtimeRefetch("tickets", load);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const k = useMemo(() => {
    const r = rows || [];
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);

    const open = r.filter((t) => t.status !== "Closed" && t.status !== "Cancelled");
    const closedToday = r.filter((t) => t.status === "Closed" && isToday(t.closed_at, start, end));
    const newToday = r.filter((t) => isToday(t.created_at, start, end));
    const carry = open.filter((t) => !isToday(t.assigned_at || t.created_at, start, end));
    const overdue = open.filter((t) => hoursExcludingSundays(t.created_at) > 24);

    const execHrs = r
      .filter((t) => t.status === "Closed" && t.closed_at)
      .map((t) => (new Date(t.closed_at!).getTime() - new Date(t.created_at).getTime()) / 3_600_000);
    const avgExec = execHrs.length ? execHrs.reduce((s, v) => s + v, 0) / execHrs.length : 0;

    const ageHrs = open.map((t) => (Date.now() - new Date(t.created_at).getTime()) / 3_600_000);
    const avgAge = ageHrs.length ? ageHrs.reduce((s, v) => s + v, 0) / ageHrs.length : 0;

    return {
      open: open.length,
      closedToday: closedToday.length,
      newToday: newToday.length,
      carry: carry.length,
      overdue: overdue.length,
      avgExec, avgAge,
    };
  }, [rows]);

  const loading = rows === null;

  const cards: Array<{
    label: string; value: string | number; icon: any; tone: Tone;
    to?: string; search?: any;
  }> = [
    { label: "Open Tickets", value: k.open, icon: Ticket, tone: "info", to: "/tickets", search: { scope: "active" } },
    { label: "Closed Today", value: k.closedToday, icon: CheckCircle2, tone: "good", to: "/tickets", search: { scope: "closedToday" } },
    { label: "New Today", value: k.newToday, icon: PlusCircle, tone: "info", to: "/tickets", search: { scope: "today" } },
    { label: "Carry-over", value: k.carry, icon: RotateCcw, tone: k.carry ? "warn" : "muted", to: "/tickets", search: { scope: "carry" } },
    { label: "Overdue >24h", value: k.overdue, icon: AlertTriangle, tone: k.overdue ? "bad" : "muted", to: "/tickets", search: { scope: "overdue" } },
    { label: "Avg Execution", value: fmtH(k.avgExec), icon: Timer, tone: "muted" },
    { label: "Avg Open Age", value: fmtH(k.avgAge), icon: Hourglass, tone: k.avgAge > 48 ? "warn" : "muted" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
      {cards.map((c) => <Kpi key={c.label} {...c} loading={loading} />)}
    </div>
  );
}

type Tone = "info" | "good" | "warn" | "bad" | "muted";
const RING: Record<Tone, string> = {
  info: "bg-blue-50 text-blue-700 ring-blue-100",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  warn: "bg-amber-50 text-amber-700 ring-amber-100",
  bad: "bg-red-50 text-red-700 ring-red-100",
  muted: "bg-zinc-50 text-zinc-600 ring-zinc-100",
};
const VAL: Record<Tone, string> = {
  info: "text-blue-700",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-red-700",
  muted: "text-foreground",
};

function Kpi({
  label, value, icon: Icon, tone, to, search, loading,
}: {
  label: string; value: string | number; icon: any; tone: Tone;
  to?: string; search?: any; loading?: boolean;
}) {
  const body = (
    <div className="rounded-xl border bg-card p-3 hover:shadow-sm transition h-full">
      <div className="flex items-start justify-between">
        <div className={`h-8 w-8 grid place-items-center rounded-lg ring-1 ${RING[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className={`text-xl font-bold leading-tight tabular-nums ${VAL[tone]}`}>{loading ? "…" : value}</div>
    </div>
  );
  if (to) return <Link to={to} search={search} className="block">{body}</Link>;
  return body;
}