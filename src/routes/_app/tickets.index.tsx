import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TICKET_STATUSES, CALL_TYPES, STATUS_COLOR, PRIORITIES, PRIORITY_COLOR, waOpen, engineerAssignMsg, customerClosedMsg } from "@/lib/tickets";
import { Plus, Eye, Trash2, UserCog, MessageCircle } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/useRole";

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

  const load = async () => {
    setLoading(true);
    let query = supabase.from("tickets").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(500);
    if (status !== "all") query = query.eq("status", status);
    if (type !== "all") query = query.eq("call_type", type);
    const { data } = await query;
    setRows((data || []) as Row[]);
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

  return (
    <div className="space-y-4">
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
                { header: "Priority", get: (r) => r.priority || "" },
                { header: "Customer", get: (r) => r.customer_name },
                { header: "Phone", get: (r) => r.customer_phone || "" },
                { header: "Product", get: (r) => r.product || "" },
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
                  <th className="p-2">Priority</th>
                  <th className="p-2">Customer</th>
                  <th className="p-2">Product / Serial</th>
                  <th className="p-2">Sector / Colony</th>
                  <th className="p-2">City / Area</th>
                  <th className="p-2">Engineer</th>
                  <th className="p-2">Raised By</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={11} className="p-4 text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={11} className="p-4 text-muted-foreground">No tickets.</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-mono">{r.case_id}</td>
                    <td className="p-2">{r.call_type}</td>
                    <td className="p-2">
                      <Select value={r.priority || "P3"} onValueChange={(v) => setPriority(r.id, v)}>
                        <SelectTrigger className={`h-7 w-20 ${PRIORITY_COLOR[r.priority || "P3"] || ""}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                      </Select>
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
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        <Link to="/tickets/$id" params={{ id: r.id }}>
                          <Button size="icon" variant="ghost" title="View"><Eye className="h-4 w-4" /></Button>
                        </Link>

                        <Popover>
                          <PopoverTrigger asChild>
                            <Button size="icon" variant="ghost" title="Change Engineer"><UserCog className="h-4 w-4" /></Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-2" align="end">
                            <div className="text-xs font-medium mb-1 text-muted-foreground">Reassign Engineer</div>
                            <div className="max-h-60 overflow-auto">
                              {employees.length === 0 && <div className="p-2 text-sm text-muted-foreground">No employees</div>}
                              {employees.map((e) => (
                                <button
                                  key={e.id}
                                  className="w-full text-left p-2 text-sm rounded hover:bg-muted"
                                  onClick={() => reassign(r, e)}
                                >
                                  <div className="font-medium">{e.name}</div>
                                  <div className="text-xs text-muted-foreground">{[e.department, e.phone].filter(Boolean).join(" · ")}</div>
                                </button>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>

                        {r.status === "Closed" && (
                          <Button size="icon" variant="ghost" title="Notify Customer" onClick={() => notifyCustomer(r)}>
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                        )}

                        {isAdmin && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="icon" variant="ghost" title="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete ticket {r.case_id}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will hide the ticket from listings (soft delete). It can be restored from the database if needed.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => softDelete(r)} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
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