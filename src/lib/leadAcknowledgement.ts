import { supabase } from "@/integrations/supabase/client";

export type PendingLeadAck = {
  assignment_id: string;
  lead_id: string;
  lead_title: string | null;
  lead_source: string | null;
  customer_name: string | null;
  priority: string | null;
  remarks: string | null;
  assigned_at: string;
  assigned_by: string | null;
  assigned_by_name: string | null;
};

export type LeadAssignment = {
  id: string;
  lead_id: string;
  assigned_to: string;
  assigned_by: string | null;
  assigned_at: string;
  acknowledgement_status: "pending" | "acknowledged";
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledged_by_name: string | null;
  acknowledgement_device: string | null;
  acknowledgement_ip: string | null;
  is_current: boolean;
  created_at: string;
};

/** Pending (unacknowledged) assignments for the signed-in user. */
export async function fetchPendingAcks(): Promise<PendingLeadAck[]> {
  const { data, error } = await (supabase as any).rpc("my_pending_lead_acknowledgements");
  if (error) throw error;
  return (data || []) as PendingLeadAck[];
}

/** Assignment history for a lead, newest first. */
export async function fetchLeadAssignments(leadId: string): Promise<LeadAssignment[]> {
  const { data, error } = await (supabase as any)
    .from("lead_assignments")
    .select("*")
    .eq("lead_id", leadId)
    .order("assigned_at", { ascending: false });
  if (error) throw error;
  return (data || []) as LeadAssignment[];
}

/** Acknowledge one assignment. Server enforces assignee-only + once-only. */
export async function acknowledgeAssignment(assignmentId: string) {
  const device = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 250) : null;
  const { error } = await (supabase as any).rpc("acknowledge_lead_assignment", {
    _assignment_id: assignmentId,
    _device: device,
    _ip: null,
  });
  if (error) throw error;
}

export const ackStatusLabel = (s?: string | null) =>
  s === "acknowledged" ? "Acknowledged" : s === "pending_acknowledgement" || s === "pending" ? "Pending Acknowledgement" : "—";

export const ackStatusClass = (s?: string | null) =>
  s === "acknowledged"
    ? "bg-green-100 text-green-800 border-green-300"
    : "bg-orange-100 text-orange-800 border-orange-300";
