import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { ArrowLeft, CheckCircle2, Circle, Download, Printer, Search, Ticket as TicketIcon } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { fmtDate } from "@/lib/amc";
import { usePermissions } from "@/lib/usePermissions";
import { DateFilterBar } from "@/components/DateFilterBar";
import { type DateRange, type RangeMode, currentMonth, resolveRange, inRange } from "@/lib/dateRange";

export const Route = createFileRoute("/_app/amc/pm")({
  component: PMSchedule,
  head: () => ({ meta: [{ title: "PM Schedule — Prokon" }] }),
});

type PMRow = {
  id: string;
  amc_id: string;
  scheduled_date: string;
  completed_at: string | null;
  notes: string | null;
};

type AmcLite = {
  id: string;
  agreement_no: string;
  client_name: string;
  client_company: string | null;
  contact_no: string | null;
  units: { model: string; serial_no: string }[];
};

function PMSchedule() {
  const [pms, setPms] = useState<PMRow[]>([]);
  const [amcs, setAmcs] = useState<Record<string, AmcLite>>({});
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "done" | "overdue">("all");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState<string>("");
  const [rangeMode, setRangeMode] = useState<RangeMode>("month");
  const [customRange, setCustomRange] = useState<DateRange>(currentMonth());
  const { can } = usePermissions();
  const canCreateTicket = can("tickets", "create");

  const load = async () => {
    const [{ data: pmData }, { data: amcData }] = await Promise.all([
      supabase.from("pm_visits").select("*").order("scheduled_date", { ascending: true }),
      supabase.from("amcs").select("id,agreement_no,client_name,client_company,contact_no,units"),
    ]);
    setPms((pmData || []) as PMRow[]);
    const map: Record<string, AmcLite> = {};
    for (const a of (amcData || []) as unknown as AmcLite[]) map[a.id] = a;
    setAmcs(map);
  };

  useEffect(() => { load(); }, []);

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);

  const isOverdue = (p: PMRow) =>
    !p.completed_at && new Date(p.scheduled_date + "T00:00:00") < today;

  const toggleDone = async (p: PMRow) => {
    setBusy(p.id);
    const { data: u } = await supabase.auth.getUser();
    const patch = p.completed_at
      ? { completed_at: null, completed_by: null }
      : { completed_at: new Date().toISOString(), completed_by: u.user?.id ?? null };
    const { error } = await supabase.from("pm_visits").update(patch).eq("id", p.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(p.completed_at ? "Marked pending" : "PM marked as done");
    load();
  };

  const filtered = pms.filter((p) => {
    const r = resolveRange(rangeMode, customRange);
    if (!inRange(p.scheduled_date, r)) return false;
    const a = amcs[p.amc_id];
    if (filter === "pending" && p.completed_at) return false;
    if (filter === "done" && !p.completed_at) return false;
    if (filter === "overdue" && !isOverdue(p)) return false;
    if (selectedDate) {
      const sel = selectedDate.toISOString().slice(0, 10);
      if (p.scheduled_date !== sel) return false;
    }
    if (dateInput && p.scheduled_date !== dateInput) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (a?.agreement_no || "").toLowerCase().includes(s)
      || (a?.client_name || "").toLowerCase().includes(s)
      || (a?.client_company || "").toLowerCase().includes(s)
      || p.scheduled_date.includes(s);
  });

  // Calendar modifiers — color days by PM status
  const { doneDays, pendingDays, overdueDays } = useMemo(() => {
    const done: Date[] = [], pending: Date[] = [], overdue: Date[] = [];
    const byDate = new Map<string, PMRow[]>();
    for (const p of pms) {
      if (!byDate.has(p.scheduled_date)) byDate.set(p.scheduled_date, []);
      byDate.get(p.scheduled_date)!.push(p);
    }
    for (const [date, list] of byDate) {
      const d = new Date(date + "T00:00:00");
      const allDone = list.every((x) => x.completed_at);
      const anyOverdue = list.some((x) => !x.completed_at && new Date(x.scheduled_date + "T00:00:00") < today);
      if (allDone) done.push(d);
      else if (anyOverdue) overdue.push(d);
      else pending.push(d);
    }
    return { doneDays: done, pendingDays: pending, overdueDays: overdue };
  }, [pms, today]);

  const counts = {
    total: pms.length,
    pending: pms.filter((p) => !p.completed_at).length,
    done: pms.filter((p) => p.completed_at).length,
    overdue: pms.filter(isOverdue).length,
  };

  const exportExcel = () => {
    const rows = filtered.map((p) => {
      const a = amcs[p.amc_id];
      return {
        "PM Date": fmtDate(p.scheduled_date),
        "Status": p.completed_at ? "Done" : isOverdue(p) ? "Overdue" : "Pending",
        "Completed On": p.completed_at ? fmtDate(p.completed_at.slice(0, 10)) : "",
        "Agreement No": a?.agreement_no || "",
        "Client": a?.client_name || "",
        "Company": a?.client_company || "",
        "Contact": a?.contact_no || "",
        "Units": (a?.units || []).map((u) => `${u.model} (${u.serial_no})`).join("; "),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PM Schedule");
    XLSX.writeFile(wb, `PM_Schedule_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to="/amc"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
          <h1 className="text-2xl font-bold">PM Schedule</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <label className="text-xs text-muted-foreground">Filter date:</label>
          <Input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} className="w-40 h-8" />
          {(dateInput || selectedDate) && (
            <Button variant="outline" size="sm" onClick={() => { setDateInput(""); setSelectedDate(undefined); }}>
              Clear
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportExcel}><Download className="h-4 w-4 mr-1" />Excel</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print A4</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 print:hidden">
        <button onClick={() => setFilter("all")} className={`text-left rounded-lg border-2 p-3 bg-muted ${filter === "all" ? "ring-2 ring-primary" : ""}`}>
          <div className="text-xs uppercase opacity-70">Total PMs</div><div className="text-2xl font-bold">{counts.total}</div>
        </button>
        <button onClick={() => setFilter("pending")} className={`text-left rounded-lg border-2 p-3 bg-orange-100 border-orange-300 text-orange-900 ${filter === "pending" ? "ring-2 ring-primary" : ""}`}>
          <div className="text-xs uppercase opacity-70">Pending</div><div className="text-2xl font-bold">{counts.pending}</div>
        </button>
        <button onClick={() => setFilter("overdue")} className={`text-left rounded-lg border-2 p-3 bg-red-100 border-red-300 text-red-900 ${filter === "overdue" ? "ring-2 ring-primary" : ""}`}>
          <div className="text-xs uppercase opacity-70">Overdue</div><div className="text-2xl font-bold">{counts.overdue}</div>
        </button>
        <button onClick={() => setFilter("done")} className={`text-left rounded-lg border-2 p-3 bg-green-100 border-green-300 text-green-900 ${filter === "done" ? "ring-2 ring-primary" : ""}`}>
          <div className="text-xs uppercase opacity-70">Completed</div><div className="text-2xl font-bold">{counts.done}</div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1 print:hidden">
          <CardHeader className="pb-2"><CardTitle className="text-base">Calendar</CardTitle></CardHeader>
          <CardContent>
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              modifiers={{ done: doneDays, pending: pendingDays, overdue: overdueDays }}
              modifiersClassNames={{
                done: "bg-green-200 text-green-900 font-bold rounded",
                pending: "bg-orange-200 text-orange-900 font-bold rounded",
                overdue: "bg-red-200 text-red-900 font-bold rounded",
              }}
              className="pointer-events-auto"
            />
            <div className="flex flex-wrap gap-2 text-xs mt-3">
              <span className="px-2 py-0.5 rounded bg-orange-200 text-orange-900">Pending</span>
              <span className="px-2 py-0.5 rounded bg-red-200 text-red-900">Overdue</span>
              <span className="px-2 py-0.5 rounded bg-green-200 text-green-900">Done</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Click a date to filter the table below.</p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base">PM Visits ({filtered.length})</CardTitle>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-8 w-56" placeholder="Search client / agreement" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Agreement</TableHead>
                    <TableHead>Units</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const a = amcs[p.amc_id];
                    const overdue = isOverdue(p);
                    const rowCls = p.completed_at
                      ? "bg-green-50 hover:bg-green-100/70"
                      : overdue
                      ? "bg-red-50 hover:bg-red-100/70"
                      : "bg-orange-50 hover:bg-orange-100/70";
                    return (
                      <TableRow key={p.id} className={rowCls}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {fmtDate(p.scheduled_date)}
                          {p.completed_at && <div className="text-[10px] text-green-700">Done {fmtDate(p.completed_at.slice(0, 10))}</div>}
                          {overdue && !p.completed_at && <div className="text-[10px] text-red-700 font-semibold">OVERDUE</div>}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{a?.client_name || "—"}</div>
                          {a?.client_company && <div className="text-xs text-muted-foreground">{a.client_company}</div>}
                        </TableCell>
                        <TableCell className="text-xs">
                          {a ? (
                            <Link to="/amc/$id" params={{ id: a.id }} className="font-mono underline">{a.agreement_no}</Link>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{(a?.units || []).length}</TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1">
                          {canCreateTicket && (
                            <a href={`/tickets/new?pm=${p.id}`} title="Create ticket from this PM visit">
                              <Button size="sm" variant="outline"><TicketIcon className="h-4 w-4" /></Button>
                            </a>
                          )}
                          <Button
                            size="sm"
                            disabled={busy === p.id}
                            onClick={() => toggleDone(p)}
                            className={p.completed_at
                              ? "bg-green-600 hover:bg-green-700 text-white"
                              : "bg-red-600 hover:bg-red-700 text-white"}
                          >
                            {p.completed_at
                              ? (<><CheckCircle2 className="h-4 w-4 mr-1" />Done</>)
                              : (<><Circle className="h-4 w-4 mr-1" />Mark Done</>)}
                          </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No PM visits match the filter</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body { background: white !important; }
          header, nav { display: none !important; }
        }
      `}</style>
    </div>
  );
}