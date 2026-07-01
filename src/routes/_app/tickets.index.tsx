import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TICKET_STATUSES, CALL_TYPES, STATUS_COLOR, PRIORITIES, PRIORITY_COLOR, waOpen, engineerAssignMsg, customerClosedMsg, hoursExcludingSundays, timerBadgeColor, formatHours } from "@/lib/tickets";
import { Plus, Eye, Trash2, MoreHorizontal, UserCog, MessageCircle, RefreshCw, ClipboardList } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger,
  DropdownMenuSubContent, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/useRole";
import { FormPageHeader } from "@/components/FormPageHeader";
import { softDelete as softDeleteRow, useRealtimeRefetch } from "@/lib/softDelete";

export const Route = createFileRoute("/_app/tickets/")({
  validateSearch: (s: Record<string, unknown>) => ({
    engineer: typeof s.engineer === "string" ? s.engineer : undefined,
    status: typeof s.status === "string" ? s.status : undefined,
    scope: typeof s.scope === "string" ? s.scope : undefined,
    priority: typeof s.priority === "string" ? s.priority : undefined,
    bucket: typeof s.bucket === "string" ? s.bucket : undefined,
    oem: typeof s.oem === "string" ? s.oem : undefined,
    parts: typeof s.parts === "string" ? s.parts : undefined,
  }),
  component: TicketsList,
});

type Row = {
  id: string;
  case_id: string;
  call_type: string;
  product: string | null;
  serial_no: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  customer_email: string | null;
  location: string | null;
  sector: string | null;
  complaint: string | null;
  status: string;
  priority: string | null;
  assigned_engineer_name: string | null;
  assigned_engineer_phone: string | null;
  raised_by_type: string | null;
  raised_by_name: string | null;
  created_at: string;
  closed_at?: string | null;
  oem_call?: boolean | null;
  parts_used?: boolean | null;
  parts_details?: Array<{ name?: string; confirmed?: boolean }> | null;
  defective_parts_received?: boolean | null;
  good_parts_used?: boolean | null;
  special_instruction?: string | null;
  special_instruction_acknowledged?: boolean | null;
  has_special_activity?: boolean;
};

type Employee = { id: string; name: string; phone: string | null; department: string | null; active: boolean };

function TicketsList() {
  const search = Route.useSearch();
  const { isAdmin } = useIsAdmin();
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(search.status || "all");
  const [type, setType] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [engineerFilter, setEngineerFilter] = useState<string>(search.engineer || "all");
  const [priorityFilter, setPriorityFilter] = useState<string>(search.priority || "all");
  const [scope, setScope] = useState<string>(search.scope || "all");
  const [bucket, setBucket] = useState<string>(search.bucket || "all");
  const [oemFilter, setOemFilter] = useState<string>(search.oem || "all");
  const [partsFilter, setPartsFilter] = useState<string>(search.parts || "all");
  const [loading, setLoading] = useState(true);
  const [, setNowTick] = useState(0);

  // sync URL → state when navigating to /tickets?engineer=… from dashboard
  useEffect(() => {
    if (search.engineer !== undefined) setEngineerFilter(search.engineer || "all");
    if (search.status !== undefined) setStatus(search.status || "all");
    if (search.scope !== undefined) setScope(search.scope || "all");
    if (search.priority !== undefined) setPriorityFilter(search.priority || "all");
    if (search.bucket !== undefined) setBucket(search.bucket || "all");
    if (search.oem !== undefined) setOemFilter(search.oem || "all");
    if (search.parts !== undefined) setPartsFilter(search.parts || "all");
  }, [search.engineer, search.status, search.scope, search.priority, search.bucket, search.oem, search.parts]);

  // Tick once per minute so the timer column stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    setLoading(true);
    let query = supabase.from("tickets").select("*").eq("is_deleted", false).order("created_at", { ascending: false }).limit(500);
    if (status !== "all") query = query.eq("status", status);
    if (type !== "all") query = query.eq("call_type", type);
    const { data } = await query;
    const baseRows = (data || []) as Row[];
    const ids = baseRows.map((r) => r.id);
    let flagged = new Set<string>();
    if (ids.length) {
      const { data: acts } = await supabase
        .from("ticket_activities")
        .select("ticket_id")
        .eq("special_instruction", true)
        .in("ticket_id", ids);
      flagged = new Set(((acts as { ticket_id: string }[] | null) || []).map((a) => a.ticket_id));
    }
    setRows(baseRows.map((r) => ({ ...r, has_special_activity: flagged.has(r.id) })));
    const { data: emps } = await supabase.from("employees").select("id,name,phone,department,active").eq("active", true).order("name");
    setEmployees((emps || []) as Employee[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, type]);
  useRealtimeRefetch("tickets", () => load());

  const cities = useMemo(() => Array.from(new Set(rows.map((r) => (r.location || "").trim()).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday); endOfToday.setDate(endOfToday.getDate() + 1);
    const inToday = (iso: string | null | undefined) => {
      if (!iso) return false;
      const d = new Date(iso);
      return d >= startOfToday && d < endOfToday;
    };
    const out = rows.filter((r) => {
      if (cityFilter !== "all" && (r.location || "").trim() !== cityFilter) return false;
      if (engineerFilter !== "all" && (r.assigned_engineer_name || "") !== engineerFilter) return false;
      if (priorityFilter !== "all" && (r.priority || "") !== priorityFilter) return false;
      if (oemFilter === "oem" && !r.oem_call) return false;
      if (oemFilter === "phs" && r.oem_call) return false;
      if (partsFilter === "with" && !r.defective_parts_received) return false;
      if (partsFilter === "without" && r.defective_parts_received) return false;
      if (bucket !== "all") {
        if (r.status !== "Closed" || !r.closed_at) return false;
        const h = (new Date(r.closed_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000;
        if (bucket === "lt24" && !(h < 24)) return false;
        if (bucket === "24-48" && !(h >= 24 && h < 48)) return false;
        if (bucket === "48-72" && !(h >= 48 && h < 72)) return false;
        if (bucket === "gt72" && !(h >= 72)) return false;
      }
      if (scope === "today") {
        const at = (r as any).assigned_at || r.created_at;
        if (!inToday(at)) return false;
      } else if (scope === "carry") {
        const at = (r as any).assigned_at || r.created_at;
        if (inToday(at) || !at) return false;
        if (r.status === "Closed") return false;
      } else if (scope === "active") {
        if (r.status === "Closed" || r.status === "Cancelled") return false;
      } else if (scope === "closedToday") {
        if (r.status !== "Closed") return false;
        if (!inToday((r as any).closed_at)) return false;
      } else if (scope === "highPriority") {
        if (r.status === "Closed" || r.status === "Cancelled") return false;
        if (r.priority !== "P1" && r.priority !== "P2") return false;
      } else if (scope === "overdue") {
        if (r.status === "Closed" || r.status === "Cancelled") return false;
        if (hoursExcludingSundays(r.created_at) <= 24) return false;
      }
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      return (
        r.case_id.toLowerCase().includes(s) ||
        r.customer_name.toLowerCase().includes(s) ||
        (r.customer_phone || "").toLowerCase().includes(s) ||
        (r.product || "").toLowerCase().includes(s) ||
        (r.serial_no || "").toLowerCase().includes(s) ||
        (r.location || "").toLowerCase().includes(s) ||
        (r.sector || "").toLowerCase().includes(s)
      );
    });
    // Closed tickets to bottom, otherwise keep created_at desc
    return out.sort((a, b) => {
      const ac = a.status === "Closed" ? 1 : 0;
      const bc = b.status === "Closed" ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [rows, q, cityFilter, engineerFilter, priorityFilter, scope, bucket, oemFilter, partsFilter]);

  const setPriority = async (id: string, p: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, priority: p } : r)));
    const { error } = await supabase.from("tickets").update({ priority: p } as never).eq("id", id);
    if (error) toast.error(error.message);
  };

  const launchTicketWhatsApp = async (r: Row, phone: string | null | undefined, message: string, recipientLabel: string) => {
    const ok = await waOpen(phone, message, {
      module: "ticket",
      recordId: r.id,
      recordNumber: r.case_id,
      recipientLabel,
      preferWeb: true,
    });
    if (!ok) return toast.error(`${recipientLabel} phone invalid`);
    toast.success("Opening WhatsApp Web…");
  };

  const updateStatus = async (r: Row, next: string, opts: { notify?: boolean } = {}) => {
    const patch: Record<string, unknown> = { status: next };
    if (next === "Closed") patch.closed_at = new Date().toISOString();
    const { error } = await supabase.from("tickets").update(patch as never).eq("id", r.id);
    if (error) return toast.error(error.message);
    await supabase.from("ticket_activities").insert({
      ticket_id: r.id, kind: "status", from_status: r.status, to_status: next,
      notes: `Status changed: ${r.status} → ${next}`,
    } as never);
    toast.success(`Status updated to ${next}`);
    if (opts.notify && r.customer_phone) {
      await launchTicketWhatsApp(r, r.customer_phone, customerClosedMsg({ case_id: r.case_id, customer_name: r.customer_name, product: r.product }), "Customer");
    }
    load();
  };

  const softDelete = async (r: Row) => {
    const { error } = await softDeleteRow("tickets", r.id);
    if (error) return toast.error(error.message);
    toast.success(`Ticket ${r.case_id} moved to Archive`);
    load();
  };

  const reassign = async (r: Row, emp: Employee) => {
    const { error } = await supabase.from("tickets").update({
      assigned_engineer_name: emp.name,
      assigned_engineer_phone: emp.phone,
      assigned_at: new Date().toISOString(),
    } as never).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(`Assigned to ${emp.name}`);
    if (emp.phone) {
      await launchTicketWhatsApp(r, emp.phone, engineerAssignMsg({
        case_id: r.case_id, call_type: r.call_type, customer_name: r.customer_name,
        customer_phone: r.customer_phone, location: r.location, customer_address: r.customer_address,
        product: r.product, serial_no: r.serial_no, complaint: r.complaint,
      }), "Engineer");
    }
    load();
  };

  const notifyCustomer = async (r: Row) => {
    await launchTicketWhatsApp(r, r.customer_phone, customerClosedMsg({ case_id: r.case_id, customer_name: r.customer_name, product: r.product }), "Customer");
  };

  const notifyEngineer = async (r: Row) => {
    if (!r.assigned_engineer_phone) return toast.error("No engineer assigned");
    await launchTicketWhatsApp(r, r.assigned_engineer_phone, engineerAssignMsg({
      case_id: r.case_id, call_type: r.call_type, customer_name: r.customer_name,
      customer_phone: r.customer_phone, location: r.location, customer_address: r.customer_address,
      product: r.product, serial_no: r.serial_no, complaint: r.complaint,
    }), "Engineer");
  };

  return (
    <div className="space-y-4">
      <FormPageHeader
        title="Service Tickets"
        subtitle="OEM-tagged tickets are highlighted; create Indent from OEM tickets"
      />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle>All Tickets</CardTitle>
          <div className="flex items-center gap-2">
            <ExportButtons
              name="Prokon_Tickets"
              title="Service Tickets"
              rows={filtered}
              columns={[
                { header: "Case ID", get: (r) => r.case_id },
                { header: "Type", get: (r) => r.call_type },
                { header: "Tag", get: (r) => (r.oem_call ? "OEM" : "PHS") },
                { header: "Priority", get: (r) => r.priority || "" },
                { header: "Customer", get: (r) => r.customer_name },
                { header: "Phone", get: (r) => r.customer_phone || "" },
                { header: "Model", get: (r) => r.product || "" },
                { header: "Serial", get: (r) => r.serial_no || "" },
                { header: "Sector/Colony", get: (r) => r.sector || "" },
                { header: "City/Area", get: (r) => r.location || "" },
                { header: "Engineer", get: (r) => r.assigned_engineer_name || "" },
                { header: "Raised By", get: (r) => r.raised_by_name || (r.raised_by_type === "external" ? "Customer" : "") },
                { header: "Status", get: (r) => r.status },
                { header: "Created", get: (r) => new Date(r.created_at).toLocaleString() },
              ]}
            />
            <Link to="/tickets/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" />New Ticket</Button></Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {(engineerFilter !== "all" || priorityFilter !== "all" || scope !== "all" || bucket !== "all" || oemFilter !== "all" || partsFilter !== "all") && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground uppercase tracking-wide">Active filter:</span>
              {engineerFilter !== "all" && (
                <Badge variant="outline" className="gap-1">Engineer: {engineerFilter}
                  <button className="ml-1" onClick={() => setEngineerFilter("all")}>×</button>
                </Badge>
              )}
              {priorityFilter !== "all" && (
                <Badge variant="outline" className="gap-1">Priority: {priorityFilter}
                  <button className="ml-1" onClick={() => setPriorityFilter("all")}>×</button>
                </Badge>
              )}
              {scope !== "all" && (
                <Badge variant="outline" className="gap-1">Scope: {scope}
                  <button className="ml-1" onClick={() => setScope("all")}>×</button>
                </Badge>
              )}
              {bucket !== "all" && (
                <Badge variant="outline" className="gap-1">Exec: {({lt24:"<24h","24-48":"24–48h","48-72":"48–72h",gt72:">72h"} as Record<string,string>)[bucket] || bucket}
                  <button className="ml-1" onClick={() => setBucket("all")}>×</button>
                </Badge>
              )}
              {oemFilter !== "all" && (
                <Badge variant="outline" className="gap-1">{oemFilter === "oem" ? "OEM only" : "PHS only"}
                  <button className="ml-1" onClick={() => setOemFilter("all")}>×</button>
                </Badge>
              )}
              {partsFilter !== "all" && (
                <Badge variant="outline" className="gap-1">{partsFilter === "with" ? "With Parts" : "Without Parts"}
                  <button className="ml-1" onClick={() => setPartsFilter("all")}>×</button>
                </Badge>
              )}
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setEngineerFilter("all"); setPriorityFilter("all"); setScope("all"); setBucket("all"); setOemFilter("all"); setPartsFilter("all"); }}>Clear all</Button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Input placeholder="Search case / customer / serial / sector…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {TICKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue placeholder="All call types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All call types</SelectItem>
                {CALL_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={cityFilter} onValueChange={setCityFilter}>
              <SelectTrigger><SelectValue placeholder="All cities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities / areas</SelectItem>
                {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-2">Case ID</th>
                  <th className="p-2">Type</th>
                  <th className="p-2 w-14">Tag</th>
                  <th className="p-2 w-14">Pr.</th>
                  <th className="p-2 w-20">Timer</th>
                  <th className="p-2">Customer</th>
                  <th className="p-2">Model / Serial</th>
                  <th className="p-2">Sector · City</th>
                  <th className="p-2">Engineer</th>
                  <th className="p-2">Raised By</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 w-12 text-center">·</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={12} className="p-4 text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={12} className="p-4 text-muted-foreground">No tickets.</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-t align-top hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs whitespace-nowrap">
                      {(r.has_special_activity || (r.special_instruction && r.special_instruction.trim())) && (
                        r.special_instruction_acknowledged ? (
                          <div className="mb-1 inline-flex items-center gap-1 rounded border border-green-400 bg-green-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-green-800" title="Special instruction acknowledged">
                            <AlertTriangle className="h-2.5 w-2.5" />Special · Ack
                          </div>
                        ) : (
                          <div className="mb-1 inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-700 animate-pulse" title={r.special_instruction || "Special instruction tagged in activity log"}>
                            <AlertTriangle className="h-2.5 w-2.5" />Special
                          </div>
                        )
                      )}
                      <div className="font-semibold text-foreground">{r.case_id}</div>
                    </td>
                    <td className="p-2 text-xs whitespace-nowrap">{r.call_type}</td>
                    <td className="p-2">
                      {r.oem_call ? (
                        <Badge className="bg-purple-100 text-purple-800" variant="secondary">OEM</Badge>
                      ) : (
                        <Badge variant="outline">PHS</Badge>
                      )}
                    </td>
                    <td className="p-2">
                      <Select value={r.priority || "P3"} onValueChange={(v) => setPriority(r.id, v)}>
                        <SelectTrigger className={`h-7 w-14 px-2 ${PRIORITY_COLOR[r.priority || "P3"] || ""}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="p-2">
                      {(() => {
                        const h = hoursExcludingSundays(r.created_at, new Date());
                        return (
                          <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${timerBadgeColor(h)}`} title={`${h.toFixed(2)}h since creation (excl. Sundays)`}>
                            {formatHours(h)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="p-2">
                      <div className="text-sm font-semibold text-foreground leading-tight">{r.customer_name}</div>
                      <div className="text-[11px] text-muted-foreground leading-tight font-mono">{r.customer_phone || "—"}</div>
                    </td>
                    <td className="p-2">
                      <div className="text-sm font-semibold text-foreground leading-tight">{r.product || "—"}</div>
                      <div className="text-[11px] text-muted-foreground leading-tight font-mono">{r.serial_no || "—"}</div>
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <div className="text-sm leading-tight">{r.sector || "—"}</div>
                      <div className="text-[11px] text-muted-foreground leading-tight">{r.location || "—"}</div>
                    </td>
                    <td className="p-2 text-xs whitespace-nowrap">{r.assigned_engineer_name || <span className="text-muted-foreground">Unassigned</span>}</td>
                    <td className="p-2 text-xs">
                      {r.raised_by_type === "external" ? (
                        <Badge variant="outline">Customer</Badge>
                      ) : (
                        <span className="text-muted-foreground">{r.raised_by_name || "—"}</span>
                      )}
                    </td>
                    <td className="p-2">
                      <Badge className={STATUS_COLOR[r.status] || "bg-zinc-100 text-zinc-700"} variant="secondary">{r.status}</Badge>
                    </td>
                    <td className="p-2 text-center">
                      <RowActions
                        r={r}
                        employees={employees}
                        isAdmin={isAdmin}
                        onReassign={reassign}
                        onStatusChange={updateStatus}
                        onNotifyCustomer={notifyCustomer}
                        onNotifyEngineer={notifyEngineer}
                        onSoftDelete={softDelete}
                      />
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

function RowActions({
  r, employees, isAdmin,
  onReassign, onStatusChange, onNotifyCustomer, onNotifyEngineer, onSoftDelete,
}: {
  r: Row;
  employees: Employee[];
  isAdmin: boolean;
  onReassign: (r: Row, e: Employee) => void;
  onStatusChange: (r: Row, next: string, opts?: { notify?: boolean }) => void;
  onNotifyCustomer: (r: Row) => void;
  onNotifyEngineer: (r: Row) => void;
  onSoftDelete: (r: Row) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" title="Actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">Ticket actions</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/tickets/$id" params={{ id: r.id }}>
            <Eye className="h-4 w-4 mr-2" />View / Edit
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {(() => {
          const defOn = !!r.defective_parts_received;
          const goodOn = !!r.good_parts_used;
          const canIndent = !!r.oem_call && (defOn || goodOn);
          const title = !r.oem_call
            ? "Enable OEM Call on the ticket to create an Indent"
            : !(defOn || goodOn)
            ? "Enable Defective Parts Received or Good Parts Used on the ticket to create an Indent"
            : "Create Indent from this OEM ticket";
          return (
            <DropdownMenuItem asChild disabled={!canIndent}>
              <Link to="/indent/new" search={{ ticket_id: r.id }} title={title}>
                <ClipboardList className="h-4 w-4 mr-2" />Create Indent
              </Link>
            </DropdownMenuItem>
          );
        })()}

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger><UserCog className="h-4 w-4 mr-2" />Reassign Engineer</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="max-h-72 overflow-auto w-56">
              {employees.length === 0 && (
                <DropdownMenuItem disabled>No employees</DropdownMenuItem>
              )}
              {employees.map((e) => (
                <DropdownMenuItem key={e.id} onClick={() => onReassign(r, e)}>
                  <div className="flex flex-col">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-xs text-muted-foreground">{[e.department, e.phone].filter(Boolean).join(" · ")}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger><RefreshCw className="h-4 w-4 mr-2" />Update Status</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-48">
              {TICKET_STATUSES.map((s) => (
                <DropdownMenuItem key={s} disabled={s === r.status} onClick={() => onStatusChange(r, s)}>
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!r.assigned_engineer_phone}
          onClick={() => onNotifyEngineer(r)}
        >
          <MessageCircle className="h-4 w-4 mr-2" />Notify Engineer
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!r.customer_phone}
          onClick={() => onNotifyCustomer(r)}
        >
          <MessageCircle className="h-4 w-4 mr-2" />Notify Customer
        </DropdownMenuItem>

        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                if (confirm(`Delete ticket ${r.case_id}? This will hide it from listings (soft delete).`)) onSoftDelete(r);
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}