import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, Settings, AlertTriangle, CalendarClock, Eye, CalendarCheck, Ticket as TicketIcon, Briefcase } from "lucide-react";
import { type Amc, amcStatus, fmtDate, statusBadgeClass, statusLabel, statusRowClass } from "@/lib/amc";
import { ExportButtons } from "@/components/ExportButtons";
import { usePermissions } from "@/lib/usePermissions";
import { type DateRange, type RangeMode, currentMonth, resolveRange, overlaps } from "@/lib/dateRange";
import { DateFilterBar } from "@/components/DateFilterBar";

export const Route = createFileRoute("/_app/amc/")({
  component: AmcDashboard,
  head: () => ({ meta: [{ title: "AMC Dashboard — Prokon" }] }),
});

function AmcDashboard() {
  const [rows, setRows] = useState<Amc[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "expiring" | "expired">("all");
  const [rangeMode, setRangeMode] = useState<RangeMode>("month");
  const [customRange, setCustomRange] = useState<DateRange>(currentMonth());
  const { can } = usePermissions();
  const canCreateTicket = can("tickets", "create");

  useEffect(() => {
    supabase.from("amcs").select("*").order("end_date", { ascending: true })
      .then(({ data }) => setRows((data || []) as unknown as Amc[]));
  }, []);

  const range = useMemo(() => resolveRange(rangeMode, customRange), [rangeMode, customRange]);
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
    if (!overlaps(r.start_date, r.end_date, range.from, range.to)) return false;
    const s = q.toLowerCase();
    if (!s) return true;
      return r.agreement_no.toLowerCase().includes(s)
      || r.client_name.toLowerCase().includes(s)
      || (r.client_company || "").toLowerCase().includes(s)
      || (r.units || []).some((u) =>
        (u.category || "").toLowerCase().includes(s) ||
        (u.model || "").toLowerCase().includes(s) ||
        (u.serial_no || "").toLowerCase().includes(s),
      );
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
          <Link to="/amc/oem"><Button variant="outline" size="sm"><Briefcase className="h-4 w-4 mr-1" />AMC OEM Data</Button></Link>
          <Link to="/amc/pm"><Button variant="outline" size="sm"><CalendarCheck className="h-4 w-4 mr-1" />PM Schedule</Button></Link>
          <Link to="/amc/settings"><Button variant="outline" size="sm"><Settings className="h-4 w-4 mr-1" />Terms Template</Button></Link>
          <Link to="/amc/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" />New AMC</Button></Link>
        </div>
      </div>

      <DateFilterBar mode={rangeMode} setMode={setRangeMode} range={customRange} setRange={setCustomRange} />

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
                <span><span className="font-mono">{fmtDate(p.date)}</span> — {p.amc.client_company || p.amc.client_name}</span>
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
                <span>{r.client_company || r.client_name} — ends <span className="font-mono">{fmtDate(r.end_date)}</span></span>
                <Link to="/amc/$id" params={{ id: r.id }} className="text-orange-700 underline">{r.agreement_no}</Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>AMC Records ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-8 w-64" placeholder="Search agreement / client / serial" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <ExportButtons
              name="Prokon_AMC"
              title="AMC Records"
              rows={filtered}
              columns={[
                { header: "Agreement", get: (r) => r.agreement_no },
                { header: "Client", get: (r) => r.client_company || r.client_name },
                { header: "Contact Person", get: (r) => r.client_name || "" },
                { header: "Contact", get: (r) => r.contact_no || "" },
                { header: "Email", get: (r) => r.email || "" },
                { header: "GST", get: (r) => r.client_gst || "" },
                { header: "Start", get: (r) => fmtDate(r.start_date) },
                { header: "End", get: (r) => fmtDate(r.end_date) },
                { header: "Status", get: (r) => statusLabel(r._status) },
                { header: "Units", get: (r) => (r.units || []).length },
                { header: "Category", get: (r) => (r.units || []).map((u) => u.category || "").filter(Boolean).join(" | ") },
                { header: "Model", get: (r) => (r.units || []).map((u) => u.model || "").filter(Boolean).join(" | ") },
                { header: "Serial No.", get: (r) => (r.units || []).map((u) => u.serial_no || "").filter(Boolean).join(" | ") },
                { header: "AMC Value", get: (r) => Number(r.amc_value || 0) },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agreement</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Serial No.</TableHead>
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
                      <div className="font-medium">{r.client_company || r.client_name}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {(r.units || []).map((u, i) => <div key={i}>{u.category || "—"}</div>)}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {(r.units || []).map((u, i) => <div key={i}>{u.model || "—"}</div>)}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {(r.units || []).map((u, i) => <div key={i}>{u.serial_no || "—"}</div>)}
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{fmtDate(r.start_date)}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{fmtDate(r.end_date)}</TableCell>
                    <TableCell><span className={`text-xs border rounded px-2 py-0.5 ${statusBadgeClass(r._status)}`}>{statusLabel(r._status)}</span></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {canCreateTicket && (
                          <a href={`/tickets/new?amc=${r.id}`} title="Create ticket from this AMC">
                            <Button size="sm" variant="outline"><TicketIcon className="h-4 w-4" /></Button>
                          </a>
                        )}
                        <Link to="/amc/$id" params={{ id: r.id }}>
                          <Button size="sm" variant="outline"><Eye className="h-4 w-4 mr-1" />Open</Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No AMC records</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}