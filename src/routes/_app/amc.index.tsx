import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, Settings, AlertTriangle, CalendarClock, Eye } from "lucide-react";
import { type Amc, amcStatus, statusBadgeClass, statusLabel, statusRowClass } from "@/lib/amc";

export const Route = createFileRoute("/_app/amc/")({
  component: AmcDashboard,
  head: () => ({ meta: [{ title: "AMC Dashboard — Prokon" }] }),
});

function AmcDashboard() {
  const [rows, setRows] = useState<Amc[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "expiring" | "expired">("all");

  useEffect(() => {
    supabase.from("amcs").select("*").order("end_date", { ascending: true })
      .then(({ data }) => setRows((data || []) as unknown as Amc[]));
  }, []);

  const decorated = useMemo(() => rows.map((r) => ({ ...r, _status: amcStatus(r.end_date) })), [rows]);

  const counts = useMemo(() => ({
    active: decorated.filter((r) => r._status === "active").length,
    expiring: decorated.filter((r) => r._status === "expiring").length,
    expired: decorated.filter((r) => r._status === "expired").length,
  }), [decorated]);

  // PM reminders: any pm_date within next 14 days, not in the past
  const pmReminders = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const limit = new Date(today); limit.setDate(limit.getDate() + 14);
    const out: { amc: Amc; date: string }[] = [];
    for (const a of rows) {
      for (const d of (a.pm_dates || [])) {
        const dd = new Date(d + "T00:00:00");
        if (dd >= today && dd <= limit) out.push({ amc: a, date: d });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  const filtered = decorated.filter((r) => {
    if (filter !== "all" && r._status !== filter) return false;
    const s = q.toLowerCase();
    if (!s) return true;
    return r.agreement_no.toLowerCase().includes(s)
      || r.client_name.toLowerCase().includes(s)
      || (r.client_company || "").toLowerCase().includes(s)
      || JSON.stringify(r.units).toLowerCase().includes(s);
  });

  const StatCard = ({ label, value, color, onClick, active }: { label: string; value: number; color: string; onClick: () => void; active: boolean }) => (
    <button onClick={onClick} className={`text-left rounded-lg border-2 p-4 transition ${color} ${active ? "ring-2 ring-offset-2 ring-primary" : ""}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-3xl font-bold">{value}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">AMC Management</h1>
        <div className="flex gap-2">
          <Link to="/amc/settings"><Button variant="outline" size="sm"><Settings className="h-4 w-4 mr-1" />Terms Template</Button></Link>
          <Link to="/amc/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" />New AMC</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" value={decorated.length} color="bg-muted border-border text-foreground" onClick={() => setFilter("all")} active={filter === "all"} />
        <StatCard label="Active" value={counts.active} color="bg-green-100 border-green-300 text-green-900" onClick={() => setFilter("active")} active={filter === "active"} />
        <StatCard label="Expiring (≤30d)" value={counts.expiring} color="bg-orange-100 border-orange-300 text-orange-900" onClick={() => setFilter("expiring")} active={filter === "expiring"} />
        <StatCard label="Expired" value={counts.expired} color="bg-red-100 border-red-300 text-red-900" onClick={() => setFilter("expired")} active={filter === "expired"} />
      </div>

      {pmReminders.length > 0 && (
        <Card className="border-blue-300 bg-blue-50">
          <CardHeader className="pb-2"><CardTitle className="text-blue-900 flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4" />Upcoming PM Visits (next 14 days)</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {pmReminders.slice(0, 8).map((p, i) => (
              <div key={i} className="flex justify-between border-b border-blue-200/50 py-1">
                <span><span className="font-mono">{p.date}</span> — {p.amc.client_name} {p.amc.client_company ? `(${p.amc.client_company})` : ""}</span>
                <Link to="/amc/$id" params={{ id: p.amc.id }} className="text-blue-700 underline">{p.amc.agreement_no}</Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {counts.expiring > 0 && (
        <Card className="border-orange-300 bg-orange-50">
          <CardHeader className="pb-2"><CardTitle className="text-orange-900 flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />Renewal due within 30 days</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {decorated.filter((r) => r._status === "expiring").slice(0, 6).map((r) => (
              <div key={r.id} className="flex justify-between border-b border-orange-200/50 py-1">
                <span>{r.client_name} {r.client_company ? `(${r.client_company})` : ""} — ends <span className="font-mono">{r.end_date}</span></span>
                <Link to="/amc/$id" params={{ id: r.id }} className="text-orange-700 underline">{r.agreement_no}</Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>AMC Records ({filtered.length})</CardTitle>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8 w-64" placeholder="Search agreement / client / serial" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agreement</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Units</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className={statusRowClass(r._status)}>
                    <TableCell className="font-mono text-xs">{r.agreement_no}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.client_name}</div>
                      {r.client_company && <div className="text-xs text-muted-foreground">{r.client_company}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{(r.units || []).length} unit(s)</TableCell>
                    <TableCell className="font-mono text-xs">{r.start_date}</TableCell>
                    <TableCell className="font-mono text-xs">{r.end_date}</TableCell>
                    <TableCell><span className={`text-xs border rounded px-2 py-0.5 ${statusBadgeClass(r._status)}`}>{statusLabel(r._status)}</span></TableCell>
                    <TableCell>
                      <Link to="/amc/$id" params={{ id: r.id }}>
                        <Button size="sm" variant="outline"><Eye className="h-4 w-4 mr-1" />Open</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No AMC records</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}