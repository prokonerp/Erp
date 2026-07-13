import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/lib/usePermissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Ticket, ShieldCheck, ClipboardList, Briefcase, Warehouse, Truck,
  Plus, ExternalLink, AlertTriangle, CheckCircle2, Clock, Activity,
  TrendingUp, FileText, PackageCheck, Send, LayoutDashboard,
} from "lucide-react";
import { hoursExcludingSundays } from "@/lib/tickets";
import type { ModuleKey } from "@/lib/permissions";
import { useRealtimeRefetch } from "@/lib/softDelete";
import { EngineerWorkloadSection } from "@/components/EngineerWorkloadSection";
import { ExecutionTimeSection } from "@/components/ExecutionTimeSection";
import { OpenAgeSection, PerformanceSplitSection } from "@/components/OpenAgeSection";
import { ExecutiveKpisSection } from "@/components/ExecutiveKpisSection";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Dashboard — Prokon" }] }),
});

type Profile = { user_id: string; name: string | null };

function DashboardPage() {
  const { loading: permLoading, isAdmin, can } = usePermissions();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return;
      const { data } = await supabase
        .from("app_users")
        .select("user_id,name")
        .eq("user_id", uid)
        .maybeSingle();
      setProfile((data as Profile) || { user_id: uid, name: u.user?.email ?? null });
    })();
  }, []);

  if (permLoading) {
    return <div className="p-8 text-muted-foreground">Loading dashboard…</div>;
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary shrink-0">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">
              {isAdmin ? "Admin Overview" : `Welcome${profile?.name ? `, ${profile.name}` : ""}`}
            </h1>
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? "Enterprise-wide view across all modules"
                : "Your personal operational view, filtered to your assigned modules"}
            </p>
          </div>
        </div>
        {isAdmin && <Badge variant="default" className="bg-purple-100 text-purple-800 hover:bg-purple-100">Administrator</Badge>}
      </header>

      <QuickActions can={can} isAdmin={isAdmin} />

      {isAdmin ? <AdminGrid /> : <UserGrid can={can} engineerName={profile?.name ?? null} />}

      <ActivityFeed can={can} isAdmin={isAdmin} engineerName={profile?.name ?? null} />
    </div>
  );
}

/* ───────────── Quick Actions ───────────── */

function QuickActions({ can, isAdmin }: { can: (m: ModuleKey, a?: any) => boolean; isAdmin: boolean }) {
  const actions: { label: string; to: string; module: ModuleKey | "*"; icon: any }[] = [
    { label: "New Ticket", to: "/tickets/new", module: "tickets", icon: Ticket },
    { label: "New AMC", to: "/amc/new", module: "amc", icon: ShieldCheck },
    { label: "New Indent", to: "/indent/new", module: "indent", icon: ClipboardList },
    { label: "New Quotation", to: "/crm/quotations", module: "quotations", icon: Briefcase },
    { label: "New Gatepass", to: "/gatepass/new", module: "gatepass", icon: FileText },
    { label: "New Delivery Challan", to: "/challan/new", module: "gatepass", icon: Send },
    { label: "New GRN", to: "/grn/new", module: "gatepass", icon: PackageCheck },
  ];
  const visible = actions.filter((a) => isAdmin || a.module === "*" || can(a.module as ModuleKey, "create"));
  if (!visible.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-1">Quick actions</span>
      {visible.map((a) => (
        <Link key={a.to + a.label} to={a.to}>
          <Button size="sm" variant="outline" className="h-8 gap-1.5">
            <a.icon className="h-3.5 w-3.5" /> <Plus className="h-3 w-3" /> {a.label}
          </Button>
        </Link>
      ))}
    </div>
  );
}

/* ───────────── User Grid (permission-driven) ───────────── */

function UserGrid({ can, engineerName }: { can: (m: ModuleKey, a?: any) => boolean; engineerName: string | null }) {
  const hasTickets = can("tickets", "read");
  const visible: { key: ModuleKey; node: ReactNode }[] = [];
  if (hasTickets) visible.push({ key: "tickets", node: <TicketsWidget scope={{ engineerName: null }} /> });
  if (can("amc", "read")) visible.push({ key: "amc", node: <AmcWidget /> });
  if (can("indent", "read")) visible.push({ key: "indent", node: <IndentWidget /> });
  if (can("quotations", "read")) visible.push({ key: "quotations", node: <CrmWidget /> });
  if (can("ims", "read")) visible.push({ key: "ims", node: <ImsWidget /> });
  if (can("gatepass", "read")) visible.push({ key: "gatepass", node: <MaterialMovementWidget /> });

  if (!visible.length) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto text-amber-500 mb-2" />
          <h2 className="font-semibold mb-1">No modules assigned</h2>
          <p className="text-sm text-muted-foreground">
            Your account does not have access to any module yet. Please ask an administrator to grant module permissions in Users &amp; Roles.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {hasTickets && (
        <>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">Ticket Operations Summary</h2>
            <ExecutiveKpisSection />
          </div>
          <EngineerWorkloadSection />
        </>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visible.map((v) => <div key={v.key}>{v.node}</div>)}
      </div>
    </div>
  );
}

/* ───────────── Admin Grid ───────────── */

function AdminGrid() {
  return (
    <div className="space-y-5">
      {/* Section 1 · Executive KPI row */}
      <ExecutiveKpisSection />

      {/* Section 2 · Engineer workload */}
      <EngineerWorkloadSection />

      {/* Section 3 · Two focused charts side-by-side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ExecutionTimeSection />
        <OpenAgeSection />
      </div>

      {/* Section 4 · Performance summary: OEM vs Non-OEM + Parts */}
      <PerformanceSplitSection />

      {/* Section 5 · Module snapshots */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <TicketsWidget scope={{ engineerName: null }} />
        <AmcWidget />
        <IndentWidget />
        <CrmWidget />
        <ImsWidget />
        <MaterialMovementWidget />
      </div>

      {/* Section 6 · Trends & leaderboards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <QuarterlyTicketsCard />
        <TeamPerformanceCard />
      </div>
    </div>
  );
}

/* ───────────── Module Card shell + KPI tile ───────────── */

function ModuleCard({
  title, icon: Icon, to, children, loading,
}: {
  title: string; icon: any; to: string; children: React.ReactNode; loading?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 py-3 px-4 border-b bg-muted/30">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <Link to={to}>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
            View <ExternalLink className="h-3 w-3" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="p-3">
        {loading ? <SkeletonTiles /> : children}
      </CardContent>
    </Card>
  );
}

function SkeletonTiles() {
  return (
    <div className="grid grid-cols-4 gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-md bg-muted animate-pulse" />
      ))}
    </div>
  );
}

type Tone = "neutral" | "positive" | "alert" | "active" | "muted";
const TONE_BAR: Record<Tone, string> = {
  neutral: "border-l-zinc-400",
  positive: "border-l-emerald-500",
  alert: "border-l-red-500",
  active: "border-l-blue-500",
  muted: "border-l-zinc-300",
};
const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  positive: "text-emerald-700",
  alert: "text-red-700",
  active: "text-blue-700",
  muted: "text-muted-foreground",
};

function KpiTile({ label, value, tone = "neutral", hint }: { label: string; value: number | string; tone?: Tone; hint?: string }) {
  return (
    <div className={`rounded-md border border-l-4 ${TONE_BAR[tone]} bg-card px-3 py-2 min-w-0`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className={`text-xl font-bold leading-tight ${TONE_TEXT[tone]}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}

function TileRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{children}</div>;
}

/* ───────────── Tickets ───────────── */

type TicketRow = {
  id: string; case_id: string; status: string; priority: string | null;
  assigned_engineer_name: string | null; created_at: string; closed_at: string | null;
};

function TicketsWidget({ scope }: { scope: { engineerName: string | null } }) {
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const load = async () => {
    let q = supabase.from("tickets")
      .select("id,case_id,status,priority,assigned_engineer_name,created_at,closed_at")
      .eq("is_deleted", false).order("created_at", { ascending: false }).limit(1000);
    if (scope.engineerName) q = q.eq("assigned_engineer_name", scope.engineerName);
    const { data } = await q;
    setRows((data || []) as TicketRow[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [scope.engineerName]);
  useRealtimeRefetch("tickets", load);

  const k = useMemo(() => {
    const r = rows || [];
    const open = r.filter((t) => t.status !== "Closed" && t.status !== "Cancelled");
    const inProgress = r.filter((t) => t.status === "In Progress");
    const closed = r.filter((t) => t.status === "Closed");
    const overdue = open.filter((t) => hoursExcludingSundays(t.created_at) > 24).length;
    return { total: r.length, open: open.length, inProgress: inProgress.length, closed: closed.length, overdue };
  }, [rows]);

  return (
    <ModuleCard title={scope.engineerName ? "My Tickets" : "Tickets"} icon={Ticket} to="/tickets" loading={rows === null}>
      <TileRow>
        <KpiTile label="Total" value={k.total} tone="neutral" />
        <KpiTile label="Open" value={k.open} tone="active" />
        <KpiTile label="Closed" value={k.closed} tone="positive" />
        <KpiTile label="Overdue >24h" value={k.overdue} tone={k.overdue ? "alert" : "muted"} />
      </TileRow>
      <div className="mt-2 text-[11px] text-muted-foreground">In progress: {k.inProgress}</div>
    </ModuleCard>
  );
}

/* ───────────── AMC ───────────── */

type AmcRow = { id: string; agreement_no: string; end_date: string | null };
type PmRow = { id: string; scheduled_date: string; completed_at: string | null };

function AmcWidget() {
  const [amcs, setAmcs] = useState<AmcRow[] | null>(null);
  const [pms, setPms] = useState<PmRow[] | null>(null);
  const load = async () => {
    const { data: a } = await supabase.from("amcs").select("id,agreement_no,end_date").eq("is_deleted", false).order("end_date", { ascending: true }).limit(1000);
    setAmcs((a || []) as AmcRow[]);
    const { data: p } = await supabase.from("pm_visits").select("id,scheduled_date,completed_at").limit(1000);
    setPms((p || []) as PmRow[]);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefetch("amcs", load);

  const k = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in30 = new Date(today); in30.setDate(in30.getDate() + 30);
    const a = amcs || []; const p = pms || [];
    const active = a.filter((x) => x.end_date && new Date(x.end_date) >= today);
    const expiring = a.filter((x) => {
      if (!x.end_date) return false;
      const d = new Date(x.end_date); return d >= today && d <= in30;
    });
    const expired = a.filter((x) => x.end_date && new Date(x.end_date) < today);
    const pmDue = p.filter((v) => !v.completed_at && new Date(v.scheduled_date) <= in30).length;
    return { active: active.length, expiring: expiring.length, expired: expired.length, pmDue };
  }, [amcs, pms]);

  return (
    <ModuleCard title="AMC" icon={ShieldCheck} to="/amc" loading={amcs === null || pms === null}>
      <TileRow>
        <KpiTile label="Active" value={k.active} tone="active" />
        <KpiTile label="Expiring 30d" value={k.expiring} tone={k.expiring ? "alert" : "muted"} />
        <KpiTile label="Expired" value={k.expired} tone={k.expired ? "alert" : "muted"} />
        <KpiTile label="PM due 30d" value={k.pmDue} tone={k.pmDue ? "active" : "muted"} />
      </TileRow>
    </ModuleCard>
  );
}

/* ───────────── Indent ───────────── */

type IndentRow = { id: string; indent_no: string; created_at: string; oracles_data: any; created_by: string | null };

function IndentWidget() {
  const [rows, setRows] = useState<IndentRow[] | null>(null);
  const load = async () => {
    const { data } = await supabase.from("indents" as never).select("id,indent_no,created_at,oracles_data,created_by").eq("is_deleted", false).order("created_at", { ascending: false }).limit(1000);
    setRows((data || []) as unknown as IndentRow[]);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefetch("indents", load);
  const k = useMemo(() => {
    const r = rows || [];
    let openOracles = 0, closedOracles = 0, fullyOpen = 0, fullyClosed = 0;
    for (const ind of r) {
      const arr = (ind.oracles_data || []) as any[];
      if (!arr.length) { fullyOpen++; continue; }
      let c = 0;
      for (const o of arr) {
        const closed = (o.status || "").toLowerCase() === "closed" || !!o.closed_at;
        if (closed) { closedOracles++; c++; } else openOracles++;
      }
      if (c === arr.length) fullyClosed++; else fullyOpen++;
    }
    return { total: r.length, openIndents: fullyOpen, closedIndents: fullyClosed, openOracles, closedOracles };
  }, [rows]);
  return (
    <ModuleCard title="Indent" icon={ClipboardList} to="/indent" loading={rows === null}>
      <TileRow>
        <KpiTile label="Total" value={k.total} tone="neutral" />
        <KpiTile label="Open" value={k.openIndents} tone="active" />
        <KpiTile label="Closed" value={k.closedIndents} tone="positive" />
        <KpiTile label="Open Oracles" value={k.openOracles} tone={k.openOracles ? "alert" : "muted"} />
      </TileRow>
    </ModuleCard>
  );
}

/* ───────────── CRM / Quotations ───────────── */

type LeadRow = { id: string; status: string | null; expected_value: number | null; next_followup: string | null; owner_id: string | null };
type QuoteRow = { id: string; status: string | null; total: number | null };

function CrmWidget() {
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [quotes, setQuotes] = useState<QuoteRow[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data: l } = await supabase.from("leads").select("id,status,expected_value,next_followup,owner_id").limit(1000);
      setLeads((l || []) as LeadRow[]);
      const { data: q } = await supabase.from("quotations").select("id,status,total").limit(1000);
      setQuotes((q || []) as QuoteRow[]);
    })();
  }, []);
  const k = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    const l = leads || []; const q = quotes || [];
    const openLeads = l.filter((x) => (x.status || "").toLowerCase() !== "won" && (x.status || "").toLowerCase() !== "lost");
    const dueFollowups = l.filter((x) => x.next_followup && new Date(x.next_followup) <= in7 && (x.status || "").toLowerCase() !== "won" && (x.status || "").toLowerCase() !== "lost").length;
    const pipeline = openLeads.reduce((s, x) => s + (Number(x.expected_value) || 0), 0);
    const openQuotes = q.filter((x) => (x.status || "").toLowerCase() !== "accepted" && (x.status || "").toLowerCase() !== "rejected").length;
    return { leads: l.length, openLeads: openLeads.length, dueFollowups, pipeline, openQuotes };
  }, [leads, quotes]);
  const inr = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)}L` : `₹${n.toLocaleString("en-IN")}`;
  return (
    <ModuleCard title="Sales CRM" icon={Briefcase} to="/crm" loading={leads === null || quotes === null}>
      <TileRow>
        <KpiTile label="Open Leads" value={k.openLeads} tone="active" />
        <KpiTile label="Follow-ups ≤7d" value={k.dueFollowups} tone={k.dueFollowups ? "alert" : "muted"} />
        <KpiTile label="Open Quotes" value={k.openQuotes} tone="neutral" />
        <KpiTile label="Pipeline" value={inr(k.pipeline)} tone="positive" />
      </TileRow>
    </ModuleCard>
  );
}

/* ───────────── IMS ───────────── */

type StockRow = { id: string; stock_status: string | null; part_name: string | null };
type GrnRow = { id: string; status: string | null; grn_date: string | null };

function ImsWidget() {
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [grns, setGrns] = useState<GrnRow[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("ims_stock_items").select("id,stock_status,part_name").limit(2000);
      setStock((s || []) as StockRow[]);
      const { data: g } = await supabase.from("grns").select("id,status,grn_date").order("created_at", { ascending: false }).limit(500);
      setGrns((g || []) as GrnRow[]);
    })();
  }, []);
  const k = useMemo(() => {
    const s = stock || []; const g = grns || [];
    const available = s.filter((x) => (x.stock_status || "") === "available").length;
    const reserved = s.filter((x) => (x.stock_status || "") === "reserved").length;
    const inTransit = s.filter((x) => (x.stock_status || "") === "in_transit").length;
    // Low stock by part_name (qty < 3)
    const byPart = new Map<string, number>();
    for (const x of s) {
      if (!x.part_name || (x.stock_status || "") !== "available") continue;
      byPart.set(x.part_name, (byPart.get(x.part_name) || 0) + 1);
    }
    const lowStock = Array.from(byPart.values()).filter((c) => c < 3).length;
    const pendingGrns = g.filter((x) => (x.status || "").toLowerCase() !== "completed" && (x.status || "").toLowerCase() !== "closed").length;
    return { available, reserved, inTransit, lowStock, pendingGrns };
  }, [stock, grns]);
  return (
    <ModuleCard title="Inventory (IMS)" icon={Warehouse} to="/ims" loading={stock === null || grns === null}>
      <TileRow>
        <KpiTile label="Available" value={k.available} tone="positive" />
        <KpiTile label="Reserved" value={k.reserved} tone="active" />
        <KpiTile label="In Transit" value={k.inTransit} tone="neutral" />
        <KpiTile label="Low Stock SKUs" value={k.lowStock} tone={k.lowStock ? "alert" : "muted"} />
      </TileRow>
      <div className="mt-2 text-[11px] text-muted-foreground">Pending GRNs: {k.pendingGrns}</div>
    </ModuleCard>
  );
}

/* ───────────── Material Movement ───────────── */

type GpRow = { id: string; return_type: string | null; created_at: string };
type DcRow = { id: string; status: string | null; challan_date: string | null };

function MaterialMovementWidget() {
  const [gps, setGps] = useState<GpRow[] | null>(null);
  const [dcs, setDcs] = useState<DcRow[] | null>(null);
  const [grns, setGrns] = useState<GrnRow[] | null>(null);
  useEffect(() => {
    (async () => {
      const { data: g } = await supabase.from("gatepasses").select("id,return_type,created_at").order("created_at", { ascending: false }).limit(500);
      setGps((g || []) as GpRow[]);
      const { data: d } = await supabase.from("delivery_challans").select("id,status,challan_date").order("challan_date", { ascending: false }).limit(500);
      setDcs((d || []) as DcRow[]);
      const { data: r } = await supabase.from("grns").select("id,status,grn_date").order("grn_date", { ascending: false }).limit(500);
      setGrns((r || []) as GrnRow[]);
    })();
  }, []);
  const k = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    const g = gps || []; const d = dcs || []; const r = grns || [];
    const recentGp = g.filter((x) => new Date(x.created_at) >= weekAgo).length;
    const dcThisWeek = d.filter((x) => x.challan_date && new Date(x.challan_date) >= weekAgo).length;
    const grnsRecv = r.filter((x) => x.grn_date && new Date(x.grn_date) >= weekAgo).length;
    return { totalGp: g.length, recentGp, dcThisWeek, grnsRecv };
  }, [gps, dcs, grns]);
  return (
    <ModuleCard title="Material Movement" icon={Truck} to="/challan" loading={gps === null || dcs === null || grns === null}>
      <TileRow>
        <KpiTile label="Gatepasses (Total)" value={k.totalGp} tone="neutral" />
        <KpiTile label="Gatepasses 7d" value={k.recentGp} tone="active" />
        <KpiTile label="DCs 7d" value={k.dcThisWeek} tone="active" />
        <KpiTile label="GRNs 7d" value={k.grnsRecv} tone="positive" />
      </TileRow>
    </ModuleCard>
  );
}

/* ───────────── Admin extras: Quarterly + Team ───────────── */

function quarterRange(offset = 0) {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3) + offset;
  const year = now.getFullYear() + Math.floor(q / 4);
  const qNorm = ((q % 4) + 4) % 4;
  const start = new Date(year, qNorm * 3, 1);
  const end = new Date(year, qNorm * 3 + 3, 1);
  return { start, end, label: `Q${qNorm + 1} ${year}` };
}

function QuarterlyTicketsCard() {
  const [rows, setRows] = useState<{ created_at: string; status: string }[] | null>(null);
  const load = async () => {
    const { data } = await supabase.from("tickets").select("created_at,status").eq("is_deleted", false).order("created_at", { ascending: false }).limit(5000);
    setRows((data || []) as any);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefetch("tickets", load);
  const cur = quarterRange(0); const prev = quarterRange(-1);
  const inRange = (iso: string, s: Date, e: Date) => { const d = new Date(iso); return d >= s && d < e; };
  const r = rows || [];
  const curCount = r.filter((x) => inRange(x.created_at, cur.start, cur.end)).length;
  const prevCount = r.filter((x) => inRange(x.created_at, prev.start, prev.end)).length;
  const delta = curCount - prevCount;
  const pct = prevCount ? Math.round((delta / prevCount) * 100) : 0;
  const max = Math.max(curCount, prevCount, 1);
  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b bg-muted/30">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" /> Quarterly Tickets Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {rows === null ? <SkeletonTiles /> : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2 md:col-span-2">
              <BarLine label={prev.label} value={prevCount} max={max} tone="muted" />
              <BarLine label={cur.label} value={curCount} max={max} tone="active" />
            </div>
            <div className={`rounded-md border p-3 ${delta >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Change vs last quarter</div>
              <div className={`text-2xl font-bold ${delta >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {delta >= 0 ? "+" : ""}{delta} ({pct >= 0 ? "+" : ""}{pct}%)
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BarLine({ label, value, max, tone }: { label: string; value: number; max: number; tone: Tone }) {
  const pct = Math.round((value / max) * 100);
  const bar = tone === "active" ? "bg-blue-500" : "bg-zinc-400";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
      <div className="h-2 rounded bg-muted overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TeamPerformanceCard() {
  const [rows, setRows] = useState<{ assigned_engineer_name: string | null; status: string; closed_at: string | null }[] | null>(null);
  const load = async () => {
    const since = new Date(); since.setDate(since.getDate() - 90);
    const { data } = await supabase.from("tickets")
      .select("assigned_engineer_name,status,closed_at")
      .eq("is_deleted", false)
      .gte("created_at", since.toISOString())
      .limit(5000);
    setRows((data || []) as any);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefetch("tickets", load);
  const top = useMemo(() => {
    const r = rows || [];
    const m = new Map<string, { closed: number; total: number }>();
    for (const t of r) {
      const k = t.assigned_engineer_name || "Unassigned";
      const cur = m.get(k) || { closed: 0, total: 0 };
      cur.total++; if (t.status === "Closed") cur.closed++;
      m.set(k, cur);
    }
    return Array.from(m.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.closed - a.closed)
      .slice(0, 5);
  }, [rows]);
  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b bg-muted/30">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary" /> Team Performance (last 90 days)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows === null ? <div className="p-4"><SkeletonTiles /></div> : top.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No ticket activity in the last 90 days.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/40">
              <tr><th className="text-left p-2">Engineer</th><th className="text-right p-2">Closed</th><th className="text-right p-2">Total</th><th className="text-right p-2">Closure %</th></tr>
            </thead>
            <tbody>
              {top.map((t) => (
                <tr key={t.name} className="border-t">
                  <td className="p-2 font-medium">{t.name}</td>
                  <td className="p-2 text-right text-emerald-700 font-semibold">{t.closed}</td>
                  <td className="p-2 text-right">{t.total}</td>
                  <td className="p-2 text-right">{t.total ? Math.round((t.closed / t.total) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────── Activity Feed ───────────── */

type FeedItem = { id: string; module: ModuleKey; title: string; subtitle: string; ts: string; to: string };

function ActivityFeed({ can, isAdmin, engineerName }: { can: (m: ModuleKey, a?: any) => boolean; isAdmin: boolean; engineerName: string | null }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);

  const load = async () => {
      const collected: FeedItem[] = [];
      const showAll = isAdmin;
      if (showAll || can("tickets", "read")) {
        let q = supabase.from("tickets").select("id,case_id,status,customer_name,assigned_engineer_name,created_at")
          .eq("is_deleted", false).order("created_at", { ascending: false }).limit(15);
        if (!showAll && engineerName) q = q.eq("assigned_engineer_name", engineerName);
        const { data } = await q;
        (data || []).forEach((t: any) => collected.push({
          id: `t-${t.id}`, module: "tickets",
          title: `${t.case_id} · ${t.customer_name}`, subtitle: `Ticket ${t.status}`,
          ts: t.created_at, to: `/tickets/${t.id}`,
        }));
      }
      if (showAll || can("indent", "read")) {
        const { data } = await supabase.from("indents" as never)
          .select("id,indent_no,company,created_at").eq("is_deleted", false).order("created_at", { ascending: false }).limit(10);
        (data || []).forEach((x: any) => collected.push({
          id: `i-${x.id}`, module: "indent",
          title: `${x.indent_no} · ${x.company || "—"}`, subtitle: "Indent created",
          ts: x.created_at, to: `/indent/${x.id}`,
        }));
      }
      if (showAll || can("amc", "read")) {
        const { data } = await supabase.from("amcs")
          .select("id,agreement_no,client_company,client_name,created_at").eq("is_deleted", false).order("created_at", { ascending: false }).limit(10);
        (data || []).forEach((x: any) => collected.push({
          id: `a-${x.id}`, module: "amc",
          title: `${x.agreement_no} · ${x.client_company || x.client_name || "—"}`, subtitle: "AMC created",
          ts: x.created_at, to: `/amc/${x.id}`,
        }));
      }
      collected.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      setItems(collected.slice(0, 15));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [isAdmin, engineerName]);
  useRealtimeRefetch(["tickets", "indents", "amcs"], load);

  const moduleIcon = (m: ModuleKey) => {
    if (m === "tickets") return Ticket;
    if (m === "amc") return ShieldCheck;
    if (m === "indent") return ClipboardList;
    return Activity;
  };

  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b bg-muted/30">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items === null ? (
          <div className="p-4"><SkeletonTiles /></div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No recent activity.</div>
        ) : (
          <ul className="divide-y">
            {items.map((it) => {
              const I = moduleIcon(it.module);
              return (
                <li key={it.id} className="px-4 py-2 flex items-center gap-3 hover:bg-muted/30">
                  <I className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{it.title}</div>
                    <div className="text-xs text-muted-foreground">{it.subtitle}</div>
                  </div>
                  <div className="text-[11px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {timeAgo(it.ts)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}