import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { acknowledgeAssignment, fetchPendingAcks, type PendingLeadAck } from "@/lib/leadAcknowledgement";

/**
 * Mounted app-wide: after sign-in, prompts the assigned user to explicitly
 * acknowledge every lead assigned to them. Cannot be dismissed implicitly.
 */
export function LeadAcknowledgementGate() {
  const nav = useNavigate();
  const [queue, setQueue] = useState<PendingLeadAck[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    try { setQueue(await fetchPendingAcks()); } catch { /* ignore */ }
  };

  useEffect(() => {
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange((e) => {
      if (e === "SIGNED_IN") void load();
      if (e === "SIGNED_OUT") setQueue([]);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const current = queue[0];
  if (!current) return null;

  const ack = async () => {
    setBusy(true);
    try {
      await acknowledgeAssignment(current.assignment_id);
      toast.success("Lead assignment acknowledged");
      setQueue((q) => q.slice(1));
    } catch (e: any) {
      toast.error(e?.message || "Could not acknowledge");
    } finally { setBusy(false); }
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value || "—"}</span>
    </div>
  );

  return (
    <Dialog open onOpenChange={() => { /* explicit action required */ }}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Lead Assignment
            <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">Pending Acknowledgement</Badge>
          </DialogTitle>
          <DialogDescription>You have been assigned a new lead.</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border p-3">
          {row("Lead", current.lead_title)}
          {row("Customer", current.customer_name)}
          {row("Lead Source", current.lead_source)}
          {row("Assigned By", current.assigned_by_name)}
          {row("Assigned On", new Date(current.assigned_at).toLocaleString())}
          {current.priority && row("Priority", current.priority)}
          {current.remarks && row("Remarks", current.remarks)}
        </div>
        <p className="text-xs text-muted-foreground">
          Please confirm that you have reviewed and acknowledged this lead assignment.
          {queue.length > 1 ? ` (${queue.length} pending)` : ""}
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={() => nav({ to: "/crm/leads/$id", params: { id: current.lead_id } })}>
            View Lead Details
          </Button>
          <Button disabled={busy} onClick={() => void ack()}>{busy ? "Saving…" : "Acknowledge"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
