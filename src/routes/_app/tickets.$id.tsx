import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  CALL_TYPES, TICKET_STATUSES, STATUS_COLOR,
  PRIORITIES, PRIORITY_COLOR,
  waOpen, engineerAssignMsg, customerClosedMsg, renderTemplate, type PartLine,
} from "@/lib/tickets";
import { Save, Trash2, Plus, MessageCircle, FileText, UserPlus, CheckCircle2, ArrowLeft, Printer, CalendarClock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_app/tickets/$id")({
  component: TicketDetail,
});

type Ticket = {
  id: string;
  case_id: string;
  call_type: string;
  product: string | null;
  serial_no: string | null;
  customer_name: string;
  customer_address: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  location: string | null;
  sector: string | null;
  priority: string | null;
  complaint: string | null;
  status: string;
  assigned_engineer_name: string | null;
  assigned_engineer_phone: string | null;
  assigned_at: string | null;
  parts_used: boolean;
  parts_details: PartLine[];
  quotation_id: string | null;
  closed_at: string | null;
  remarks: string | null;
  created_at: string;
  customer_id: string | null;
  oem_call: boolean;
  oem_brand: string | null;
  oem_ref_id: string | null;
  oem_purchase_date: string | null;
  source: string | null;
  amc_id: string | null;
  pm_visit_id: string | null;
  special_instruction: string | null;
  special_instruction_acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  preferred_visit_datetime: string | null;
};

type CustomerBilling = {
  id: string;
  company: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  billing_address: string | null;
  address: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  gst: string | null;
};

type Employee = {
  id: string;
  name: string;
  phone: string | null;
  department: string | null;
  role: string | null;
  active: boolean;
};

type Activity = {
  id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  notes: string | null;
  created_at: string;
  special_instruction?: boolean | null;
};

function TicketDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [t, setT] = useState<Ticket | null>(null);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSpecial, setNoteSpecial] = useState(false);
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [quoteNo, setQuoteNo] = useState<string>("");
  const [customer, setCustomer] = useState<CustomerBilling | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [oemBrands, setOemBrands] = useState<string[]>(["APC","Luminous","Microtek","Eaton","Exide","Quanta"]);

  const load = async () => {
    const [{ data: tk }, { data: pr }, { data: ac }, { data: tpl }, { data: emps }] = await Promise.all([
      supabase.from("tickets").select("*").eq("id", id).single(),
      supabase.from("products").select("id,name").order("name"),
      supabase.from("ticket_activities").select("*").eq("ticket_id", id).order("created_at", { ascending: false }),
      supabase.from("wa_templates").select("id,body"),
      supabase.from("employees").select("id,name,phone,department,role,active").eq("active", true).order("name"),
    ]);
    if (tk) {
      const row = tk as unknown as Ticket;
      const parts = Array.isArray((tk as { parts_details?: unknown }).parts_details)
        ? ((tk as { parts_details: unknown[] }).parts_details as PartLine[])
        : [];
      setT({ ...row, parts_details: parts });
      if (row.quotation_id) {
        const { data: q } = await supabase.from("quotations").select("quote_no").eq("id", row.quotation_id).single();
        setQuoteNo((q as { quote_no?: string } | null)?.quote_no || "");
      } else {
        setQuoteNo("");
      }
      if (row.customer_id) {
        const { data: c } = await supabase
          .from("customers")
          .select("id,company,contact_name,phone,email,billing_address,address,street,city,state,country,gst")
          .eq("id", row.customer_id)
          .single();
        setCustomer((c as CustomerBilling | null) ?? null);
      } else {
        setCustomer(null);
      }
    }
    setProducts((pr || []) as { id: string; name: string }[]);
    setActivities((ac || []) as Activity[]);
    setEmployees((emps || []) as Employee[]);
    const map: Record<string, string> = {};
    for (const r of (tpl || []) as { id: string; body: string }[]) map[r.id] = r.body;
    setTemplates(map);
    const { data: brands } = await supabase.from("oem_brand_master" as never).select("name").order("name");
    const bnames = ((brands as { name: string }[] | null) || []).map((b) => b.name);
    if (bnames.length) setOemBrands(Array.from(new Set(bnames)));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!t) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const update = (patch: Partial<Ticket>) => setT({ ...t, ...patch });

  const tplVars = (extra: Record<string, string> = {}) => ({
    case_id: t.case_id,
    call_type: t.call_type,
    customer_name: t.customer_name,
    customer_phone: t.customer_phone || "",
    location: t.location || "",
    customer_address: t.customer_address || "",
    product: t.product || "",
    serial_no: t.serial_no || "",
    complaint: t.complaint || "",
    product_line: t.product ? ` for ${t.product}` : "",
    quote_no: quoteNo,
    ...extra,
  });

  const renderMsg = (id: "engineer_assign" | "oow_quotation" | "ticket_closed", fallback: string) =>
    templates[id] ? renderTemplate(templates[id], tplVars()) : fallback;

  const logActivity = async (kind: string, notes: string, from_status?: string, to_status?: string, special?: boolean) => {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("ticket_activities").insert({
      ticket_id: t.id, kind, notes, from_status: from_status ?? null, to_status: to_status ?? null,
      actor: u.user?.id ?? null, special_instruction: !!special,
    } as never);
  };

  const save = async (extra: Partial<Ticket> = {}) => {
    setBusy(true);
    const payload = { ...t, ...extra };
    if (payload.oem_call) {
      if (!payload.oem_brand || !payload.oem_ref_id || !payload.oem_purchase_date) {
        setBusy(false);
        toast.error("OEM Call is enabled — Brand, Ref ID and Purchase Date are required.");
        return false;
      }
    }
    const { error } = await supabase.from("tickets").update({
      case_id: payload.case_id,
      call_type: payload.call_type,
      product: payload.product,
      serial_no: payload.serial_no,
      customer_name: payload.customer_name,
      customer_address: payload.customer_address,
      customer_email: payload.customer_email,
      customer_phone: payload.customer_phone,
      location: payload.location,
      sector: payload.sector,
      priority: payload.priority,
      complaint: payload.complaint,
      status: payload.status,
      assigned_engineer_name: payload.assigned_engineer_name,
      assigned_engineer_phone: payload.assigned_engineer_phone,
      assigned_at: payload.assigned_at,
      parts_used: payload.parts_used,
      parts_details: payload.parts_details,
      remarks: payload.remarks,
      closed_at: payload.closed_at,
      oem_call: payload.oem_call,
      oem_brand: payload.oem_call ? payload.oem_brand : null,
      oem_ref_id: payload.oem_call ? payload.oem_ref_id : null,
      oem_purchase_date: payload.oem_call ? payload.oem_purchase_date : null,
      special_instruction: (payload.special_instruction ?? "").toString().trim() || null,
    } as never).eq("id", t.id);
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    toast.success("Saved");
    return true;
  };

  const changeStatus = async (next: string) => {
    const prev = t.status;
    const extra: Partial<Ticket> = { status: next };
    if (next === "Closed") extra.closed_at = new Date().toISOString();
    update(extra);
    const ok = await save(extra);
    if (!ok) return;
    await logActivity("status", `Status changed: ${prev} → ${next}`, prev, next);
    await load();
    if (next === "Closed" && t.customer_phone) {
      await waOpen(t.customer_phone, renderMsg("ticket_closed", customerClosedMsg(t)));
      toast.success("Message copied — opening WhatsApp");
    }
  };

  const assignEngineer = async () => {
    if (!t.assigned_engineer_name || !t.assigned_engineer_phone) {
      return toast.error("Engineer name and phone required");
    }
    const extra: Partial<Ticket> = {
      assigned_at: new Date().toISOString(),
      status: t.status === "New" || t.status === "Call Log" ? "In Progress" : t.status,
    };
    update(extra);
    const ok = await save(extra);
    if (!ok) return;
    await logActivity(
      "assigned",
      `Assigned to ${t.assigned_engineer_name} (${t.assigned_engineer_phone})`,
    );
    await load();
    await waOpen(t.assigned_engineer_phone, renderMsg("engineer_assign", engineerAssignMsg(t)));
    toast.success("Message copied — opening WhatsApp for engineer");
  };

  const addPart = () => update({ parts_details: [...t.parts_details, { name: "", qty: "1" }] });
  const updPart = (i: number, p: Partial<PartLine>) =>
    update({ parts_details: t.parts_details.map((x, idx) => (idx === i ? { ...x, ...p } : x)) });
  const delPart = (i: number) =>
    update({ parts_details: t.parts_details.filter((_, idx) => idx !== i) });

  const addNote = async () => {
    if (!noteText.trim()) return;
    await logActivity("note", noteText, undefined, undefined, noteSpecial);
    setNoteText("");
    setNoteSpecial(false);
    await load();
    toast.success(noteSpecial ? "Special instruction added" : "Note added");
  };

  const createOOWQuote = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Not signed in");
    const item = {
      description: `${t.product || "Service"} — ${t.complaint || "OOW Service"}`,
      hsn: "",
      qty: 1,
      unit: "Nos",
      rate: 0,
      discount_percent: 0,
      tax_percent: 18,
      amount: 0,
    };
    const { data, error } = await supabase.from("quotations").insert({
      quote_no: "",
      owner_id: u.user.id,
      subject: `OOW Service — ${t.case_id}`,
      reference_no: t.case_id,
      customer_notes: `Case: ${t.case_id}\nProduct: ${t.product || "—"}\nSerial: ${t.serial_no || "—"}\nIssue: ${t.complaint || "—"}`,
      items: [item],
    } as never).select("id").single();
    if (error) return toast.error(error.message);
    const qid = (data as { id: string }).id;
    await supabase.from("tickets").update({ quotation_id: qid } as never).eq("id", t.id);
    await logActivity("quote", `OOW quotation created`);
    toast.success("OOW quotation created — opening editor");
    navigate({ to: "/crm/quotations/$id", params: { id: qid } });
  };

  const del = async () => {
    if (!confirm(`Delete ticket ${t.case_id}?`)) return;
    await supabase.from("tickets").delete().eq("id", t.id);
    toast.success("Deleted");
    navigate({ to: "/tickets" });
  };

  const hasSpecialActivity = activities.some((a) => a.special_instruction);
  const showSpecialRibbon = !!(t.special_instruction && t.special_instruction.trim()) || hasSpecialActivity;
  const acknowledged = !!t.special_instruction_acknowledged;

  const acknowledgeSpecial = async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const now = new Date().toISOString();
    const { error } = await supabase.from("tickets").update({
      special_instruction_acknowledged: true,
      acknowledged_by: uid,
      acknowledged_at: now,
    } as never).eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    setT({ ...t, special_instruction_acknowledged: true, acknowledged_by: uid, acknowledged_at: now });
    await logActivity("ack", "Special instruction acknowledged");
    load();
    toast.success("Acknowledged");
  };

  const reopenSpecial = async () => {
    const { error } = await supabase.from("tickets").update({
      special_instruction_acknowledged: false,
      acknowledged_by: null,
      acknowledged_at: null,
    } as never).eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    setT({ ...t, special_instruction_acknowledged: false, acknowledged_by: null, acknowledged_at: null });
    await logActivity("ack", "Special instruction reopened");
    load();
    toast.success("Reopened");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/tickets" })}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
          <div className="flex flex-col gap-1">
            {showSpecialRibbon && (
              <div className={`inline-flex items-center gap-2 self-start rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${acknowledged ? "border-green-400 bg-green-100 text-green-800" : "border-red-300 bg-red-50 text-red-700 animate-pulse"}`}>
                <AlertTriangle className="h-3 w-3" />
                Special Instruction{acknowledged ? " · Acknowledged" : ""}
                {acknowledged ? (
                  <button type="button" onClick={reopenSpecial} className="ml-2 underline decoration-dotted normal-case font-medium tracking-normal">Reopen</button>
                ) : (
                  <button type="button" onClick={acknowledgeSpecial} className="ml-2 rounded bg-red-700 px-2 py-0.5 text-white normal-case font-semibold tracking-normal hover:bg-red-800">Mark as Acknowledged</button>
                )}
              </div>
            )}
            <h2 className="text-xl font-semibold font-mono">{t.case_id}</h2>
          </div>
          <Badge className={STATUS_COLOR[t.status] || ""} variant="secondary">{t.status}</Badge>
          <Badge variant={t.oem_call ? "default" : "outline"} className={t.oem_call ? "bg-purple-600 text-white hover:bg-purple-700" : ""}>
            {t.oem_call ? "OEM" : "PHS"}
          </Badge>
          <div className="flex items-center gap-2 ml-2 text-sm">
            <span className="text-muted-foreground">OEM Call</span>
            <Switch
              checked={t.oem_call}
              onCheckedChange={(v) => update({ oem_call: v, oem_brand: v ? (t.oem_brand || "") : null, oem_ref_id: v ? (t.oem_ref_id || "") : null, oem_purchase_date: v ? (t.oem_purchase_date || "") : null })}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print</Button>
          <Button onClick={() => save()} disabled={busy}><Save className="h-4 w-4 mr-1" />Save</Button>
          <Button variant="destructive" size="icon" onClick={del}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 print:hidden">
        {/* Left: ticket details */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle>Ticket Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>Case ID</Label><Input value={t.case_id} onChange={(e) => update({ case_id: e.target.value })} className="font-mono" /></div>
              <div>
                <Label>Call Type</Label>
                <Select value={t.call_type} onValueChange={(v) => update({ call_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CALL_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Product</Label>
                <Select value={t.product || ""} onValueChange={(v) => update({ product: v })}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Serial Number</Label><Input value={t.serial_no || ""} onChange={(e) => update({ serial_no: e.target.value.toUpperCase() })} className="font-mono" /></div>
              <div className="md:col-span-2"><Label>Complaint</Label><Textarea rows={2} value={t.complaint || ""} onChange={(e) => update({ complaint: e.target.value })} /></div>
              <div className="md:col-span-2">
                <Label>Special Instruction <span className="text-xs text-muted-foreground">(shows blinking ribbon when filled)</span></Label>
                <Textarea rows={2} value={t.special_instruction || ""} onChange={(e) => update({ special_instruction: e.target.value })} placeholder="Critical handling notes for engineer (optional)" />
                {acknowledged && (
                  <div className="mt-1 text-xs text-green-700">
                    Acknowledged{t.acknowledged_at ? ` at ${new Date(t.acknowledged_at).toLocaleString()}` : ""}{t.acknowledged_by ? ` by ${t.acknowledged_by.slice(0, 8)}` : ""}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {t.oem_call && (
            <Card className="border-purple-300">
              <CardHeader><CardTitle className="text-base">OEM Details</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>OEM Brand *</Label>
                  <Select value={t.oem_brand || ""} onValueChange={(v) => update({ oem_brand: v })}>
                    <SelectTrigger><SelectValue placeholder="Select brand" /></SelectTrigger>
                    <SelectContent>
                      {oemBrands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>OEM Ref ID *</Label>
                  <Input value={t.oem_ref_id || ""} onChange={(e) => update({ oem_ref_id: e.target.value })} placeholder="OEM reference / ticket id" />
                </div>
                <div>
                  <Label>OEM Customer Purchase Date *</Label>
                  <Input type="date" value={t.oem_purchase_date || ""} onChange={(e) => update({ oem_purchase_date: e.target.value })} />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>Name *</Label><Input value={t.customer_name} onChange={(e) => update({ customer_name: e.target.value })} /></div>
              <div><Label>Contact Number</Label><Input value={t.customer_phone || ""} onChange={(e) => update({ customer_phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" value={t.customer_email || ""} onChange={(e) => update({ customer_email: e.target.value })} /></div>
              <div><Label>Sector / Colony Name</Label><Input value={t.sector || ""} onChange={(e) => update({ sector: e.target.value })} /></div>
              <div><Label>City / Area</Label><Input value={t.location || ""} onChange={(e) => update({ location: e.target.value })} /></div>
              <div className="md:col-span-2"><Label>Address</Label><Textarea rows={2} value={t.customer_address || ""} onChange={(e) => update({ customer_address: e.target.value })} /></div>
            </CardContent>
          </Card>

          {customer && (
            <Card>
              <CardHeader><CardTitle>Billing Address <span className="text-xs font-normal text-muted-foreground">(from Customer Master)</span></CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <div className="font-semibold">{customer.company}</div>
                {(customer.billing_address || customer.address || customer.street) && (
                  <div className="whitespace-pre-wrap text-muted-foreground">
                    {customer.billing_address || [customer.street, customer.address].filter(Boolean).join("\n")}
                  </div>
                )}
                <div className="text-muted-foreground">
                  {[customer.city, customer.state].filter(Boolean).join(", ")}
                  {customer.country ? `, ${customer.country}` : ""}
                </div>
                {customer.contact_name && <div><span className="text-muted-foreground">Contact: </span>{customer.contact_name}</div>}
                {customer.phone && <div><span className="text-muted-foreground">Phone: </span>{customer.phone}</div>}
                {customer.email && <div><span className="text-muted-foreground">Email: </span>{customer.email}</div>}
                {customer.gst && <div><span className="text-muted-foreground">GSTIN: </span><span className="font-mono">{customer.gst}</span></div>}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Parts</CardTitle>
              <div className="flex items-center gap-2">
                <Label className="text-sm">Parts used</Label>
                <Switch checked={t.parts_used} onCheckedChange={(v) => update({ parts_used: v })} />
              </div>
            </CardHeader>
            <CardContent>
              {t.parts_used ? (
                <div className="space-y-2">
                  {t.parts_details.length === 0 && <p className="text-sm text-muted-foreground">No parts added yet.</p>}
                  {t.parts_details.map((p, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-12 md:col-span-5"><Label>Part / Item</Label><Input value={p.name} onChange={(e) => updPart(i, { name: e.target.value })} /></div>
                      <div className="col-span-4 md:col-span-2"><Label>Qty</Label><Input value={p.qty} onChange={(e) => updPart(i, { qty: e.target.value })} /></div>
                      <div className="col-span-8 md:col-span-2"><Label>Serial</Label><Input value={p.serial || ""} onChange={(e) => updPart(i, { serial: e.target.value })} className="font-mono" /></div>
                      <div className="col-span-10 md:col-span-2"><Label>Remarks</Label><Input value={p.remarks || ""} onChange={(e) => updPart(i, { remarks: e.target.value })} /></div>
                      <div className="col-span-2 md:col-span-1">
                        <Button size="icon" variant="ghost" onClick={() => delPart(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={addPart}><Plus className="h-4 w-4 mr-1" />Add part</Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No parts used for this call.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity Log</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input placeholder="Add a note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                  <Button onClick={addNote}>Add</Button>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox checked={noteSpecial} onCheckedChange={(v) => setNoteSpecial(v === true)} />
                  <span>Tag as <b className="text-red-700">Special Instruction</b> (flags this ticket as critical)</span>
                </label>
              </div>
              <div className="space-y-2 max-h-72 overflow-auto">
                {activities.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
                {activities.map((a) => (
                  <div key={a.id} className={`border rounded-md p-2 text-sm ${a.special_instruction ? "border-red-300 bg-red-50/60" : ""}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize flex items-center gap-2">
                        {a.kind}
                        {a.special_instruction && (
                          <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700">
                            <AlertTriangle className="h-3 w-3" />Special
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                    </div>
                    {a.notes && <div className="text-muted-foreground mt-1">{a.notes}</div>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: status + actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Select value={t.status} onValueChange={changeStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TICKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <div>
                <Label>Priority</Label>
                <Select value={t.priority || "P3"} onValueChange={(v) => { update({ priority: v }); save({ priority: v }); }}>
                  <SelectTrigger className={PRIORITY_COLOR[t.priority || "P3"]}><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {t.closed_at && (
                <p className="text-xs text-muted-foreground">Closed: {new Date(t.closed_at).toLocaleString()}</p>
              )}
              {t.status !== "Closed" && t.status !== "Cancelled" && (
                <Button variant="outline" className="w-full" onClick={() => changeStatus("Closed")}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />Close & Notify Customer
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Assign Engineer</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div>
                <Label>Department filter</Label>
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {Array.from(new Set(employees.map((e) => e.department).filter(Boolean) as string[])).map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Engineer <span className="text-xs text-muted-foreground">(from Employee Master)</span></Label>
                <Select
                  value={employees.find((e) => e.name === t.assigned_engineer_name)?.id || ""}
                  onValueChange={(empId) => {
                    const emp = employees.find((e) => e.id === empId);
                    if (emp) update({ assigned_engineer_name: emp.name, assigned_engineer_phone: emp.phone || "" });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder={employees.length ? "Select engineer" : "No active employees"} /></SelectTrigger>
                  <SelectContent>
                    {employees
                      .filter((e) => deptFilter === "all" || e.department === deptFilter)
                      .map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}{e.department ? ` · ${e.department}` : ""}{e.phone ? ` · ${e.phone}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {employees.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">Add employees in Masters → Employees.</p>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {t.assigned_engineer_name ? <>Selected: <b>{t.assigned_engineer_name}</b>{t.assigned_engineer_phone ? ` (${t.assigned_engineer_phone})` : ""}</> : "No engineer selected"}
              </div>
              {t.assigned_at && <p className="text-xs text-muted-foreground">Assigned: {new Date(t.assigned_at).toLocaleString()}</p>}
              <Button className="w-full" onClick={assignEngineer}>
                <UserPlus className="h-4 w-4 mr-1" />Assign & Send WhatsApp
              </Button>
              {t.assigned_engineer_phone && (
                <Button
                  variant="outline" size="sm" className="w-full"
                  onClick={() => { waOpen(t.assigned_engineer_phone!, renderMsg("engineer_assign", engineerAssignMsg(t))); toast.success("Message copied — opening WhatsApp"); }}
                >
                  <MessageCircle className="h-4 w-4 mr-1" />Resend WhatsApp
                </Button>
              )}
            </CardContent>
          </Card>

          {t.call_type === "OOW" && (
            <Card>
              <CardHeader><CardTitle>OOW Quotation</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {t.quotation_id ? (
                  <>
                    <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/crm/quotations/$id", params: { id: t.quotation_id! } })}>
                      <FileText className="h-4 w-4 mr-1" />Open Quotation {quoteNo && <span className="ml-1 font-mono text-xs">({quoteNo})</span>}
                    </Button>
                    {t.customer_phone && (
                      <Button
                        size="sm" className="w-full"
                        onClick={() => { waOpen(t.customer_phone!, renderMsg("oow_quotation", `Dear ${t.customer_name}, please find our OOW quotation ${quoteNo} for case ${t.case_id}.`)); toast.success("Message copied — opening WhatsApp"); }}
                      >
                        <MessageCircle className="h-4 w-4 mr-1" />Share Quotation on WhatsApp
                      </Button>
                    )}
                  </>
                ) : (
                  <Button className="w-full" onClick={createOOWQuote}>
                    <FileText className="h-4 w-4 mr-1" />Create OOW Quotation
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">Opens the Sales CRM quotation editor pre-filled with case details.</p>
              </CardContent>
            </Card>
          )}

          {t.customer_phone && (
            <Card>
              <CardHeader><CardTitle>Customer WhatsApp</CardTitle></CardHeader>
              <CardContent>
                <Button
                  variant="outline" size="sm" className="w-full"
                  onClick={() => { waOpen(t.customer_phone!, renderMsg("ticket_closed", customerClosedMsg(t))); toast.success("Message copied — opening WhatsApp"); }}
                >
                  <MessageCircle className="h-4 w-4 mr-1" />Send Closure Message
                </Button>
                <p className="text-xs text-muted-foreground mt-2">Opens WhatsApp Desktop/app. Message is also copied to clipboard — paste if needed.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <TicketPrint t={t} customer={customer} />
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 14mm; }
          body { background: white !important; }
          .no-print, header, nav { display: none !important; }
        }
        .ticket-print { display: none; }
        @media print { .ticket-print { display: block !important; } }
      `}</style>
    </div>
  );
}

function TicketPrint({ t, customer }: { t: Ticket; customer: CustomerBilling | null }) {
  const billLines = customer
    ? [
        customer.company,
        customer.billing_address || [customer.street, customer.address].filter(Boolean).join("\n"),
        [customer.city, customer.state, customer.country].filter(Boolean).join(", "),
        customer.contact_name ? `Attn: ${customer.contact_name}` : null,
        customer.phone ? `Phone: ${customer.phone}` : null,
        customer.email ? `Email: ${customer.email}` : null,
        customer.gst ? `GSTIN: ${customer.gst}` : null,
      ].filter(Boolean) as string[]
    : [
        t.customer_name,
        t.customer_address || "",
        t.location || "",
        t.customer_phone ? `Phone: ${t.customer_phone}` : "",
        t.customer_email ? `Email: ${t.customer_email}` : "",
      ].filter(Boolean);
  return (
    <div className="ticket-print bg-white text-black mx-auto max-w-3xl p-6 text-[12px] leading-relaxed">
      <div className="text-center border-b-2 border-[#1e40af] pb-3 mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-[#1e3a8a] via-[#2563eb] to-[#dc2626] bg-clip-text text-transparent">PROKON HI-TECH SYSTEMS</h1>
        <div className="text-sm">B-505, Picasso Centre, Sector-61, Gurgaon</div>
        <div className="mt-2 inline-block px-3 py-0.5 border-2 border-black font-bold tracking-widest text-sm">SERVICE TICKET</div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
        <div><b>Case ID:</b> <span className="font-mono">{t.case_id}</span></div>
        <div className="text-right"><b>Date:</b> {new Date(t.created_at).toLocaleDateString()}</div>
        <div><b>Call Type:</b> {t.call_type}</div>
        <div className="text-right"><b>Status:</b> {t.status}</div>
      </div>
      <table className="w-full border border-black mb-3">
        <tbody>
          <tr>
            <td className="border border-black px-2 py-1 w-32 font-bold align-top">Billing Address</td>
            <td className="border border-black px-2 py-1 whitespace-pre-wrap">{billLines.join("\n")}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1 font-bold">Product</td>
            <td className="border border-black px-2 py-1">{t.product || "-"}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1 font-bold">Serial No.</td>
            <td className="border border-black px-2 py-1 font-mono">{t.serial_no || "-"}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1 font-bold align-top">Complaint</td>
            <td className="border border-black px-2 py-1 whitespace-pre-wrap">{t.complaint || "-"}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1 font-bold">Assigned Engineer</td>
            <td className="border border-black px-2 py-1">
              {t.assigned_engineer_name || "-"}
              {t.assigned_engineer_phone ? ` (${t.assigned_engineer_phone})` : ""}
            </td>
          </tr>
        </tbody>
      </table>
      {t.parts_used && t.parts_details.length > 0 && (
        <>
          <div className="font-bold mb-1">Parts Used</div>
          <table className="w-full border border-black mb-3">
            <thead className="bg-gray-100"><tr>
              <th className="border border-black px-2 py-1 w-8">#</th>
              <th className="border border-black px-2 py-1">Part / Item</th>
              <th className="border border-black px-2 py-1 w-16">Qty</th>
              <th className="border border-black px-2 py-1">Serial</th>
              <th className="border border-black px-2 py-1">Remarks</th>
            </tr></thead>
            <tbody>
              {t.parts_details.map((p, i) => (
                <tr key={i}>
                  <td className="border border-black px-2 py-1 text-center">{i + 1}</td>
                  <td className="border border-black px-2 py-1">{p.name}</td>
                  <td className="border border-black px-2 py-1 text-center">{p.qty}</td>
                  <td className="border border-black px-2 py-1 font-mono">{p.serial || "-"}</td>
                  <td className="border border-black px-2 py-1">{p.remarks || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="grid grid-cols-2 gap-8 mt-12">
        <div><div className="border-t border-black pt-1 text-center">Customer Signature</div></div>
        <div><div className="border-t border-black pt-1 text-center">For Prokon Hi-Tech Systems</div></div>
      </div>
    </div>
  );
}