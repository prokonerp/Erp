import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TICKET_STATUSES, CALL_TYPES, STATUS_COLOR, PRIORITIES, PRIORITY_COLOR, waOpen, engineerAssignMsg, customerClosedMsg, hoursExcludingSundays, timerBadgeColor, formatHours } from "@/lib/tickets";
import { Plus, Eye, Trash2, MoreHorizontal, UserCog, MessageCircle, RefreshCw } from "lucide-react";
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

export const Route = createFileRoute("/_app/tickets/")({
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
  oem_call?: boolean | null;
  special_instruction?: string | null;
  special_instruction_acknowledged?: boolean | null;
  has_special_activity?: boolean;
};

type Employee = { id: string; name: string; phone: string | null; department: string | null; active: boolean };

function TicketsList() {
  const { isAdmin } = useIsAdmin();
  const [rows, setRows] = useState<Row[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [, setNowTick] = useState(0);

  // Tick once per minute so the timer column stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    setLoading(true);
    let query = supabase.from("tickets").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(500);
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

  const cities = useMemo(() => Array.from(new Set(rows.map((r) => (r.location || "").trim()).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => {
    const out = rows.filter((r) => {
      if (cityFilter !== "all" && (r.location || "").trim() !== cityFilter) return false;
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
  }, [rows, q, cityFilter]);

  const setPriority = async (id: string, p: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, priority: p } : r)));
    const { error } = await supabase.from("tickets").update({ priority: p } as never).eq("id", id);
    if (error) toast.error(error.message);
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
      await waOpen(r.customer_phone, customerClosedMsg({ case_id: r.case_id, customer_name: r.customer_name, product: r.product }));
    }
    load();
  };

  const softDelete = async (r: Row) => {
    const { error } = await supabase.from("tickets").update({ deleted_at: new Date().toISOString() } as never).eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(`Ticket ${r.case_id} deleted`);
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
      const ok = await waOpen(emp.phone, engineerAssignMsg({
        case_id: r.case_id, call_type: r.call_type, customer_name: r.customer_name,
        customer_phone: r.customer_phone, location: r.location, customer_address: r.customer_address,
        product: r.product, serial_no: r.serial_no, complaint: r.complaint,
      }));
      if (!ok) toast.error("Engineer phone invalid — WhatsApp not opened");
    }
    load();
  };

  const notifyCustomer = async (r: Row) => {
    const ok = await waOpen(r.customer_phone, customerClosedMsg({ case_id: r.case_id, customer_name: r.customer_name, product: r.product }));
    if (!ok) return toast.error("Customer phone invalid");
    toast.success("Opening WhatsApp…");
  };

  const notifyEngineer = async (r: Row) => {
    if (!r.assigned_engineer_phone) return toast.error("No engineer assigned");
    const ok = await waOpen(r.assigned_engineer_phone, engineerAssignMsg({
      case_id: r.case_id, call_type: r.call_type, customer_name: r.customer_name,
      customer_phone: r.customer_phone, location: r.location, customer_address: r.customer_address,
      product: r.product, serial_no: r.serial_no, complaint: r.complaint,
    }));
    if (!ok) return toast.error("Engineer phone invalid");
    toast.success("Opening WhatsApp…");
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
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Case ID</th>
                  <th className="p-2">Type</th>
                  <th className="p-2 w-16">Tag</th>
                  <th className="p-2 w-16">Pr.</th>
                  <th className="p-2 w-20">Timer</th>
                  <th className="p-2">Customer</th>
                  <th className="p-2">Model / Serial</th>
                  <th className="p-2">Sector / Colony</th>
                  <th className="p-2">City / Area</th>
                  <th className="p-2">Engineer</th>
                  <th className="p-2">Raised By</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 w-12 text-center">·</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={13} className="p-4 text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={13} className="p-4 text-muted-foreground">No tickets.</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-mono">
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
                      <div>{r.case_id}</div>
                    </td>
                    <td className="p-2">{r.call_type}</td>
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
                      <div>{r.customer_name}</div>
                      <div className="text-xs text-muted-foreground">{r.customer_phone}</div>
                    </td>
                    <td className="p-2">
                      <div>{r.product || "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.serial_no}</div>
                    </td>
                    <td className="p-2">{r.sector || "—"}</td>
                    <td className="p-2">{r.location || "—"}</td>
                    <td className="p-2">{r.assigned_engineer_name || <span className="text-muted-foreground">Unassigned</span>}</td>
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