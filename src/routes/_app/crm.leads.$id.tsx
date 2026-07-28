import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Save, Plus, FileSpreadsheet, Trophy, X, MessageCircle, Mail } from "lucide-react";
import { toast } from "sonner";
import { type Lead, type LeadActivity, type Customer, statusLabel, statusClass, fmtMoney, fmtDate, computeIncentive, type IncentiveRule, fyLabel } from "@/lib/crm";
import { waOpen } from "@/lib/tickets";
import {
  ackStatusClass, ackStatusLabel, acknowledgeAssignment, fetchLeadAssignments, type LeadAssignment,
} from "@/lib/leadAcknowledgement";

export const Route = createFileRoute("/_app/crm/leads/$id")({ component: LeadDetail });

type AssignableUser = { user_id: string; name: string | null; email: string | null };

function LeadDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [act, setAct] = useState<any>({ kind: "note", notes: "", next_followup: "" });
  const [closeVal, setCloseVal] = useState<string>("");
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [assignments, setAssignments] = useState<LeadAssignment[]>([]);
  const [acking, setAcking] = useState(false);

  const load = async () => {
    const { data: l } = await supabase.from("leads").select("*").eq("id", id).single();
    if (!l) return;
    setLead(l as unknown as Lead);
    const { data: authUser } = await supabase.auth.getUser();
    setCurrentUserId(authUser.user?.id || "");
    const [{ data: c }, { data: a }, { data: us }] = await Promise.all([
      supabase.from("customers").select("*").eq("id", (l as any).customer_id).single(),
      supabase.from("lead_activities").select("*").eq("lead_id", id).order("activity_date", { ascending: false }),
      supabase.from("app_users").select("user_id,name,email,status").eq("status", "active").order("name"),
    ]);
    setCustomer((c as unknown as Customer) || null);
    setActivities((a || []) as unknown as LeadActivity[]);
    setUsers(((us || []) as any[]).map((r) => ({ user_id: r.user_id, name: r.name, email: r.email })));
    setCloseVal(String((l as any).closed_value || (l as any).expected_value || ""));
    try { setAssignments(await fetchLeadAssignments(id)); } catch { setAssignments([]); }
  };
  useEffect(() => { load(); }, [id]);

  const umap = Object.fromEntries(users.map((u) => [u.user_id, u]));
  const userLabel = (uid?: string | null) => {
    if (!uid) return "Unassigned";
    const u = umap[uid];
    return (u?.name || u?.email || "User").trim();
  };

  const assign = async (userId: string | null) => {
    const currentAssignmentPlaceholder = null;
    const patch: any = {
      assigned_to: userId,
      assigned_at: userId ? new Date().toISOString() : null,
      assigned_by: userId ? currentUserId || null : null,
    };
    const { error } = await supabase.from("leads").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(userId ? "Lead assigned successfully" : "Lead unassigned");
    load();
  };

  const updateLead = async (patch: Partial<Lead>) => {
    const { error } = await supabase.from("leads").update(patch as any).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Updated"); load();
  };

  const addActivity = async () => {
    if (!act.notes?.trim()) return toast.error("Add a note");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const payload = {
      lead_id: id, owner_id: u.user.id,
      kind: act.kind, notes: act.notes,
      next_followup: act.next_followup || null,
    };
    const { error } = await supabase.from("lead_activities").insert(payload as any);
    if (error) return toast.error(error.message);
    // Auto-bump lead status & next_followup
    const patch: any = { status: "follow_up" };
    if (act.next_followup) patch.next_followup = act.next_followup;
    await supabase.from("leads").update(patch).eq("id", id);
    setAct({ kind: "note", notes: "", next_followup: "" });
    toast.success("Follow-up logged"); load();
  };

  const markWon = async () => {
    const v = Number(closeVal || 0);
    if (!v) return toast.error("Enter closed value");
    // 1. update lead
    await supabase.from("leads").update({ status: "won", closed_value: v, closed_at: new Date().toISOString().slice(0, 10) } as any).eq("id", id);
    // 2. compute incentive against current rules
    const { data: rules } = await supabase.from("incentive_rules").select("*").order("sort_order");
    const { payout, applied_percent } = computeIncentive((rules || []) as unknown as IncentiveRule[], v);
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("incentives").insert({
      lead_id: id, owner_id: u.user!.id,
      period: fyLabel(), closed_value: v, applied_percent, payout, status: "pending",
    } as any);
    toast.success(`Won! Incentive ${"₹" + payout.toLocaleString("en-IN")} recorded`);
    load();
  };

  const markLost = async () => {
    if (!confirm("Mark this lead as lost?")) return;
    await supabase.from("leads").update({ status: "lost", closed_at: new Date().toISOString().slice(0, 10) } as any).eq("id", id);
    toast.success("Marked lost"); load();
  };

  const sendWhatsapp = async () => {
    if (!customer?.phone) return toast.error("No phone");
    const msg = `Dear ${customer.contact_name || customer.company} Team,\n\nGentle follow-up regarding "${lead?.title}".\n\nPlease let us know your decision.\n\nRegards,\nProkon Hi-Tech Systems\nPhone: +91-9810000000 | Email: info@prokonhitech.com`;
    const ok = await waOpen(customer.phone, msg);
    if (!ok) return toast.error("Valid mobile number is required before sending WhatsApp message.");
    toast.success("Opening WhatsApp…");
  };
  const sendEmail = () => {
    if (!customer?.email) return toast.error("No email");
    const subj = `Follow-up: ${lead?.title}`;
    const body = `Dear ${customer.contact_name || customer.company} Team,\n\nGentle follow-up regarding "${lead?.title}".\n\nPlease let us know your decision.\n\nRegards,\nProkon Hi-Tech Systems\nPhone: +91-9810000000 | Email: info@prokonhitech.com`;
    window.open(`mailto:${customer.email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`);
  };

  const createQuote = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user || !lead) return;
    const { data, error } = await supabase.from("quotations").insert({
      lead_id: id, customer_id: lead.customer_id, owner_id: u.user.id,
      items: [], subtotal: 0, gst_percent: 18, gst_amount: 0, total: 0, status: "draft",
    } as any).select().single();
    if (error) return toast.error(error.message);
    await supabase.from("leads").update({ status: "quoted" } as any).eq("id", id);
    nav({ to: "/crm/quotations/$id", params: { id: (data as any).id } });
  };

  if (!lead) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/crm/leads"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
        <Badge variant="outline" className={statusClass[lead.status]}>{statusLabel[lead.status]}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{lead.title}</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-semibold mb-1">{customer?.company}</div>
            <div className="text-muted-foreground">{customer?.contact_name}</div>
            <div>{customer?.phone} · {customer?.email}</div>
            <div className="text-xs mt-1">{customer?.address}</div>
            <div className="text-xs">GST: {customer?.gst || "—"}</div>
          </div>
          <div className="space-y-1">
            <div>Source: <span className="text-muted-foreground">{lead.source || "—"}</span></div>
            <div>Expected: <span className="font-semibold">{fmtMoney(lead.expected_value)}</span></div>
            <div>Next follow-up: <span className="font-semibold">{fmtDate(lead.next_followup)}</span></div>
            {lead.status === "won" && <div>Closed: <span className="font-semibold text-green-700">{fmtMoney(lead.closed_value)}</span> on {fmtDate(lead.closed_at)}</div>}
            {lead.remarks && <div className="text-xs text-muted-foreground">{lead.remarks}</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Assignment</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid md:grid-cols-3 gap-3 items-end">
          <div>
            <Label>Assigned To</Label>
            <Select value={lead.assigned_to || "__none"} onValueChange={(v) => assign(v === "__none" ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Unassigned</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>{u.name || u.email || "User"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Assigned On</div>
            <div className="font-medium">{lead.assigned_at ? new Date(lead.assigned_at).toLocaleString() : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Assigned By</div>
            <div className="font-medium">{userLabel(lead.assigned_by)}</div>
          </div>
          </div>
          {lead.assigned_to && (
            <div className="grid md:grid-cols-3 gap-3 items-end border-t pt-3">
              <div>
                <div className="text-xs text-muted-foreground">Acknowledgement Status</div>
                <Badge variant="outline" className={ackStatusClass(lead.assignment_status)}>
                  {ackStatusLabel(lead.assignment_status)}
                </Badge>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Acknowledged By</div>
                <div className="font-medium">{lead.acknowledged_by ? userLabel(lead.acknowledged_by) : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Acknowledged On</div>
                <div className="font-medium">{lead.acknowledged_at ? new Date(lead.acknowledged_at).toLocaleString() : "—"}</div>
              </div>
              {lead.assignment_status !== "acknowledged" && (
                <div className="md:col-span-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Awaiting acknowledgement from the assigned user.</span>
                  {currentAssignment && currentAssignment.assigned_to === currentUserId && (
                    <Button size="sm" disabled={acking} onClick={() => void doAck()}>
                      {acking ? "Saving…" : "Acknowledge"}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          {assignments.length > 0 && (
            <div className="border-t pt-3">
              <div className="text-xs font-medium mb-2">Assignment history</div>
              <ul className="space-y-1 text-xs">
                {assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-3 border-b last:border-0 py-1">
                    <span className="font-medium">{userLabel(a.assigned_to)}</span>
                    <span className="text-muted-foreground">by {userLabel(a.assigned_by)}</span>
                    <span className="text-muted-foreground">{new Date(a.assigned_at).toLocaleString()}</span>
                    <Badge variant="outline" className={ackStatusClass(a.acknowledgement_status)}>
                      {ackStatusLabel(a.acknowledgement_status)}
                    </Badge>
                    {a.acknowledged_at && (
                      <span className="text-muted-foreground">
                        by {a.acknowledged_by_name || userLabel(a.acknowledged_by)} on {new Date(a.acknowledged_at).toLocaleString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={createQuote}><FileSpreadsheet className="h-4 w-4 mr-1" />Create quotation</Button>
        <Button size="sm" variant="outline" className="bg-green-600 hover:bg-green-700 text-white border-green-700" onClick={sendWhatsapp}><MessageCircle className="h-4 w-4 mr-1" />WhatsApp</Button>
        <Button size="sm" variant="outline" onClick={sendEmail}><Mail className="h-4 w-4 mr-1" />Email</Button>
        {lead.status !== "won" && lead.status !== "lost" && (
          <>
            <div className="flex items-center gap-1">
              <Input type="number" placeholder="Closed value" value={closeVal} onChange={(e) => setCloseVal(e.target.value)} className="w-36" />
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={markWon}><Trophy className="h-4 w-4 mr-1" />Mark Won</Button>
            </div>
            <Button size="sm" variant="destructive" onClick={markLost}><X className="h-4 w-4 mr-1" />Mark Lost</Button>
          </>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Add follow-up</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-4 gap-3">
          <div>
            <Label>Type</Label>
            <Select value={act.kind} onValueChange={(v) => setAct({ ...act, kind: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Next follow-up</Label><Input type="date" value={act.next_followup} onChange={(e) => setAct({ ...act, next_followup: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Notes</Label><Textarea rows={2} value={act.notes} onChange={(e) => setAct({ ...act, notes: e.target.value })} /></div>
          <div className="md:col-span-4"><Button size="sm" onClick={addActivity}><Plus className="h-4 w-4 mr-1" />Log</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Activity timeline</CardTitle></CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <div className="text-sm text-muted-foreground">No activity yet.</div>
          ) : (
            <ul className="space-y-3">
              {activities.map((a) => (
                <li key={a.id} className="border-l-2 border-primary pl-3">
                  <div className="text-xs text-muted-foreground">{fmtDate(a.activity_date)} · <span className="uppercase">{a.kind}</span>{a.next_followup ? ` · next: ${fmtDate(a.next_followup)}` : ""}</div>
                  <div className="text-sm">{a.notes}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}