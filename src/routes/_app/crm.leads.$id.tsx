import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus,
  FileSpreadsheet,
  Trophy,
  X,
  MessageCircle,
  Mail,
  UserCheck,
  BellRing,
  ChevronLeft,
  Target,
  Phone,
  FileText,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  type Lead,
  type LeadActivity,
  type Customer,
  fmtMoney,
  fmtDate,
  computeIncentive,
  type IncentiveRule,
  fyLabel,
} from "@/lib/crm";
import { useLeadAssignment } from "@/lib/useLeadAssignment";
import { istTodayIso } from "@/lib/dateRange";
import { AdminOnlySection } from "@/components/AdminAccessNotices";
import { waOpen } from "@/lib/tickets";
import { companySignature } from "@/lib/documentHeader";
import { PageHeader } from "@/components/crm/PageHeader";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { EmptyState } from "@/components/crm/EmptyState";
import { PageLoader } from "@/components/shared/skeletons";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/crm/leads/$id")({ component: LeadDetail });

const LOST_REASONS = [
  "Price too high",
  "Chose a competitor",
  "No budget",
  "Bad timing",
  "Went with in-house solution",
  "Other",
];

const KIND_ICON: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  whatsapp: MessageCircle,
  note: FileText,
};

const KIND_TONE: Record<string, string> = {
  call: "bg-blue-50 text-blue-600",
  email: "bg-sky-50 text-sky-600",
  meeting: "bg-violet-50 text-violet-600",
  whatsapp: "bg-emerald-50 text-emerald-600",
  note: "bg-slate-50 text-slate-600",
};

const KIND_LABEL: Record<string, string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  whatsapp: "WhatsApp",
  note: "Note",
};

function LeadDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [lead, setLead] = useState<Lead | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [act, setAct] = useState<any>({ kind: "note", notes: "", next_followup: "" });
  const [closeVal, setCloseVal] = useState<string>("");
  const [wonOpen, setWonOpen] = useState(false);
  const [wonRemarks, setWonRemarks] = useState("");
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [lostRemarks, setLostRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const { isAdmin, userId, staff, nameOf, myName, logActivity, assignLeadTo } = useLeadAssignment();
  const [assignTo, setAssignTo] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);

  const load = async () => {
    const { data: l } = await supabase.from("leads").select("*").eq("id", id).single();
    if (!l) return;
    setLead(l as unknown as Lead);
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .eq("id", (l as any).customer_id)
        .single(),
      supabase
        .from("lead_activities")
        .select("*")
        .eq("lead_id", id)
        .order("activity_date", { ascending: false }),
    ]);
    setCustomer((c as unknown as Customer) || null);
    setActivities((a || []) as unknown as LeadActivity[]);
    setCloseVal(String((l as any).closed_value || (l as any).expected_value || ""));
  };
  useEffect(() => {
    load();
  }, [id]);

  const assignLead = async () => {
    if (!assignTo) return toast.error("Select a staff member");
    setAssignBusy(true);
    const { error } = await assignLeadTo(id, assignTo);
    if (error) {
      setAssignBusy(false);
      return toast.error(error);
    }
    setAssignBusy(false);
    setAssignTo("");
    toast.success("Lead assigned");
    load();
  };

  const acknowledge = async () => {
    setAssignBusy(true);
    const { error } = await supabase
      .from("leads")
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: userId,
        acknowledged: true,
      } as any)
      .eq("id", id);
    if (error) {
      setAssignBusy(false);
      return toast.error(error.message);
    }
    await logActivity(id, `Acknowledged by ${myName()}`);
    setAssignBusy(false);
    toast.success("Acknowledged");
    load();
  };

  const updateLead = async (patch: Partial<Lead>) => {
    const { error } = await supabase
      .from("leads")
      .update(patch as any)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Updated");
    load();
  };

  const addActivity = async () => {
    if (!act.notes?.trim()) return toast.error("Add a note");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const payload = {
      lead_id: id,
      owner_id: u.user.id,
      kind: act.kind,
      notes: act.notes,
      next_followup: act.next_followup || null,
    };
    const { error } = await supabase.from("lead_activities").insert(payload as any);
    if (error) return toast.error(error.message);
    // Auto-bump lead status & next_followup
    const patch: any = { status: "follow_up" };
    if (act.next_followup) patch.next_followup = act.next_followup;
    await supabase.from("leads").update(patch).eq("id", id);
    setAct({ kind: "note", notes: "", next_followup: "" });
    toast.success("Follow-up logged");
    load();
  };

  const openWon = () => {
    if (!Number(closeVal || 0)) return toast.error("Enter closed value");
    setWonRemarks("");
    setWonOpen(true);
  };

  const markWon = async () => {
    const v = Number(closeVal || 0);
    if (!v) return toast.error("Enter closed value");
    setBusy(true);
    // 1. update lead
    const { error } = await supabase
      .from("leads")
      .update({
        status: "won",
        closed_value: v,
        closed_at: istTodayIso(),
        closed_remarks: wonRemarks.trim() || null,
      } as any)
      .eq("id", id);
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    // 2. compute incentive against current rules
    const { data: rules } = await supabase.from("incentive_rules").select("*").order("sort_order");
    const { payout, applied_percent } = computeIncentive(
      (rules || []) as unknown as IncentiveRule[],
      v,
    );
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("incentives").insert({
      lead_id: id,
      owner_id: u.user!.id,
      period: fyLabel(),
      closed_value: v,
      applied_percent,
      payout,
      status: "pending",
    } as any);
    setBusy(false);
    setWonOpen(false);
    toast.success(`Won! Incentive ${"₹" + payout.toLocaleString("en-IN")} recorded`);
    load();
  };

  const markLost = async () => {
    if (!lostReason) return toast.error("Select a reason");
    if (!lostRemarks.trim()) return toast.error("Remarks are required");
    setBusy(true);
    const { error } = await supabase
      .from("leads")
      .update({
        status: "lost",
        closed_at: istTodayIso(),
        lost_reason: lostReason,
        closed_remarks: lostRemarks.trim(),
      } as any)
      .eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    setLostOpen(false);
    toast.success("Marked lost");
    load();
  };

  const sendWhatsapp = useCallback(async () => {
    if (!customer?.phone) return toast.error("No phone");
    const sig = await companySignature();
    const msg = `Dear ${customer.contact_name || customer.company} Team,\n\nGentle follow-up regarding "${lead?.title}".\n\nPlease let us know your decision.\n\nRegards,\n${sig}`;
    const ok = await waOpen(customer.phone, msg);
    if (!ok) return toast.error("Valid mobile number is required before sending WhatsApp message.");
    toast.success("Opening WhatsApp…");
  }, [customer, lead]);
  const sendEmail = useCallback(async () => {
    if (!customer?.email) return toast.error("No email");
    const subj = `Follow-up: ${lead?.title}`;
    const sig = await companySignature();
    const body = `Dear ${customer.contact_name || customer.company} Team,\n\nGentle follow-up regarding "${lead?.title}".\n\nPlease let us know your decision.\n\nRegards,\n${sig}`;
    window.open(
      `mailto:${customer.email}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`,
    );
  }, [customer, lead]);

  const createQuote = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user || !lead) return;
    const { data, error } = await supabase
      .from("quotations")
      .insert({
        lead_id: id,
        customer_id: lead.customer_id,
        owner_id: u.user.id,
        items: [],
        subtotal: 0,
        gst_percent: 18,
        gst_amount: 0,
        total: 0,
        status: "draft",
      } as any)
      .select()
      .single();
    if (error) return toast.error(error.message);
    await supabase
      .from("leads")
      .update({ status: "quoted" } as any)
      .eq("id", id);
    nav({ to: "/crm/quotations/$id", params: { id: (data as any).id } });
  };

  if (!lead) return <PageLoader label="Loading lead…" />;

  const needsAck =
    !!userId && lead.owner_id === userId && !!lead.assigned_at && !lead.acknowledged_at;
  const isClosed = lead.status === "won" || lead.status === "lost";
  const headerDescription = `${customer?.company || "—"} · Source: ${lead.source || "—"}`;

  return (
    <div className="space-y-4 pb-20">
      <Link
        to="/crm/leads"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground print:hidden"
      >
        <ChevronLeft className="h-3 w-3" /> All leads
      </Link>

      <PageHeader
        title={lead.title || "(loading…)"}
        description={headerDescription}
        group="Leads"
        icon={Target}
        secondary={[
          { label: "WhatsApp", onClick: sendWhatsapp, icon: MessageCircle, variant: "outline" },
          { label: "Email", onClick: sendEmail, icon: Mail, variant: "outline" },
        ]}
        className="print:hidden"
      />

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground -mt-2">
        <StatusBadge kind="lead" value={lead.status} size="md" />
        <span>Created: {fmtDate(lead.created_at)}</span>
        <span>Next follow-up: {fmtDate(lead.next_followup)}</span>
        {lead.status === "won" && (
          <span className="text-emerald-700 font-medium">
            Closed: {fmtMoney(lead.closed_value)}
          </span>
        )}
      </div>

      <Card>
        {needsAck && (
          <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200">
              <BellRing className="h-4 w-4" />
              <span>
                Assigned to you on {fmtDate(lead.assigned_at)} — Acknowledge to confirm you've seen
                this
              </span>
            </div>
            <Button size="sm" onClick={acknowledge} disabled={assignBusy}>
              <UserCheck className="h-4 w-4 mr-1" />
              Acknowledge
            </Button>
          </div>
        )}
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Overview</CardTitle>
            <StatusBadge kind="lead" value={lead.status} />
          </div>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-6 text-sm">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Customer
            </div>
            <div className="font-semibold text-base">{customer?.company}</div>
            <div className="text-muted-foreground">{customer?.contact_name}</div>
            <div>
              {customer?.phone} · {customer?.email}
            </div>
            <div className="text-xs mt-1">{customer?.address}</div>
            <div className="text-xs">GST: {customer?.gst || "—"}</div>
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Lead details
            </div>
            <div>
              Source: <span className="text-muted-foreground">{lead.source || "—"}</span>
            </div>
            <div>
              Expected: <span className="font-semibold">{fmtMoney(lead.expected_value)}</span>
            </div>
            <div>
              Next follow-up: <span className="font-semibold">{fmtDate(lead.next_followup)}</span>
            </div>
            {lead.status === "won" && (
              <div>
                Closed:{" "}
                <span className="font-semibold text-emerald-700">
                  {fmtMoney(lead.closed_value)}
                </span>{" "}
                on {fmtDate(lead.closed_at)}
              </div>
            )}
            {lead.status === "lost" && (
              <div>
                Lost on {fmtDate(lead.closed_at)}
                {lead.lost_reason ? (
                  <>
                    {" "}
                    · <span className="font-semibold text-destructive">{lead.lost_reason}</span>
                  </>
                ) : null}
              </div>
            )}
            {(lead.status === "won" || lead.status === "lost") && lead.closed_remarks && (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                Closing remarks: {lead.closed_remarks}
              </div>
            )}
            {lead.remarks && (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                Remarks: {lead.remarks}
              </div>
            )}
            {lead.assigned_at && (
              <div className="text-xs text-muted-foreground">
                Assigned {fmtDate(lead.assigned_at)} ·{" "}
                {lead.acknowledged_at
                  ? `acknowledged ${fmtDate(lead.acknowledged_at)}`
                  : "not yet acknowledged"}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <AdminOnlySection label="Admin access required to assign this lead">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assignment</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-56">
              <Label>Assign to</Label>
              <Select value={assignTo} onValueChange={setAssignTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Select staff member" />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.user_id} value={s.user_id}>
                      {s.name || s.email || s.user_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={assignLead} disabled={assignBusy || !assignTo}>
              <UserCheck className="h-4 w-4 mr-1" />
              {assignBusy ? "Assigning…" : "Assign"}
            </Button>
            <div className="text-xs text-muted-foreground">
              Current owner: {nameOf(lead.owner_id)}
            </div>
          </CardContent>
        </Card>
      </AdminOnlySection>

      {isClosed ? (
        <Card>
          <CardContent className="py-4 text-sm flex flex-wrap items-center gap-2">
            <StatusBadge kind="lead" value={lead.status} />
            <span>Closed on {fmtDate(lead.closed_at)}.</span>
            {lead.status === "won" && (
              <span className="text-emerald-700">Closed value {fmtMoney(lead.closed_value)}.</span>
            )}
            {lead.status === "lost" && lead.lost_reason && (
              <span className="text-destructive">Reason: {lead.lost_reason}.</span>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="sticky bottom-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/90 backdrop-blur border-t print:hidden flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={createQuote}>
            <FileSpreadsheet className="h-4 w-4 mr-1" />
            Create quotation
          </Button>
          <Button size="sm" variant="outline" onClick={sendWhatsapp}>
            <MessageCircle className="h-4 w-4 mr-1" />
            WhatsApp
          </Button>
          <Button size="sm" variant="outline" onClick={sendEmail}>
            <Mail className="h-4 w-4 mr-1" />
            Email
          </Button>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              placeholder="Closed value"
              value={closeVal}
              onChange={(e) => setCloseVal(e.target.value)}
              className="w-36"
            />
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={openWon}>
              <Trophy className="h-4 w-4 mr-1" />
              Mark Won
            </Button>
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setLostReason("");
              setLostRemarks("");
              setLostOpen(true);
            }}
          >
            <X className="h-4 w-4 mr-1" />
            Mark Lost
          </Button>
        </div>
      )}

      <Dialog
        open={wonOpen}
        onOpenChange={(v) => {
          if (!busy) setWonOpen(v);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark lead as Won</DialogTitle>
            <DialogDescription>
              Confirm the closed value and add any closing remarks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Closed value (₹) *</Label>
              <Input type="number" value={closeVal} onChange={(e) => setCloseVal(e.target.value)} />
            </div>
            <div>
              <Label>Closing remarks</Label>
              <Textarea
                rows={4}
                value={wonRemarks}
                onChange={(e) => setWonRemarks(e.target.value)}
                placeholder="What sealed the deal, special terms agreed…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWonOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="min-w-24 bg-emerald-600 hover:bg-emerald-700"
              onClick={markWon}
              disabled={busy || !Number(closeVal || 0)}
            >
              {busy ? "Saving…" : "Confirm Won"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={lostOpen}
        onOpenChange={(v) => {
          if (!busy) setLostOpen(v);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark lead as Lost</DialogTitle>
            <DialogDescription>
              A reason and remarks are required before closing this lead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason *</Label>
              <Select value={lostReason} onValueChange={setLostReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {LOST_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Remarks *</Label>
              <Textarea
                rows={4}
                value={lostRemarks}
                onChange={(e) => setLostRemarks(e.target.value)}
                placeholder="What happened? Add detail, especially if reason is Other."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              className="min-w-24"
              variant="destructive"
              onClick={markLost}
              disabled={busy || !lostReason || !lostRemarks.trim()}
            >
              {busy ? "Saving…" : "Confirm Lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add follow-up</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-4 gap-3">
          <div>
            <Label>Type</Label>
            <Select value={act.kind} onValueChange={(v) => setAct({ ...act, kind: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="note">Note</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Next follow-up</Label>
            <Input
              type="date"
              value={act.next_followup}
              onChange={(e) => setAct({ ...act, next_followup: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={act.notes}
              onChange={(e) => setAct({ ...act, notes: e.target.value })}
            />
          </div>
          <div className="md:col-span-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              Logs also update the lead status to Follow-up.
            </p>
            <Button size="sm" onClick={addActivity}>
              <Plus className="h-4 w-4 mr-1" />
              Log
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No activity yet"
              description="Activities logged against this lead will appear here."
            />
          ) : (
            <ol className="relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-border">
              {activities.map((a) => {
                const Icon = KIND_ICON[a.kind] ?? FileText;
                return (
                  <li key={a.id} className="relative pl-9 pb-4 last:pb-0">
                    <span
                      className={cn(
                        "absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full",
                        KIND_TONE[a.kind] || "bg-primary/10 text-primary",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{fmtDate(a.activity_date)}</span>
                      <span>·</span>
                      <span>{KIND_LABEL[a.kind] || a.kind}</span>
                      {a.next_followup && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 ring-1 ring-sky-600/20 px-2 py-0.5 text-[11px] font-medium">
                          Next: {fmtDate(a.next_followup)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm whitespace-pre-wrap">{a.notes}</div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
