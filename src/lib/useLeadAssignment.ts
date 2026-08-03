import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/useRole";

export type StaffUser = { user_id: string; name: string | null; email: string | null };

/**
 * Shared lead-assignment logic used by both the Leads list (inline select-to-assign)
 * and the Lead detail Assignment card. Admin-gated via useIsAdmin().
 */
export function useLeadAssignment() {
  const { isAdmin, userId, loading } = useIsAdmin();
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const { data } = await supabase.from("app_users").select("user_id,name,email").order("name");
      setStaff(((data || []) as any[]).filter((u) => u.user_id));
    })();
  }, [isAdmin]);

  const nameOf = useCallback(
    (uid: string | null) => {
      const s = staff.find((x) => x.user_id === uid);
      return s?.name || s?.email || "staff member";
    },
    [staff]
  );

  const myName = useCallback(() => nameOf(userId), [nameOf, userId]);

  const logActivity = useCallback(
    async (leadId: string, notes: string) => {
      if (!userId) return;
      await supabase.from("lead_activities").insert({ lead_id: leadId, owner_id: userId, kind: "note", notes } as any);
    },
    [userId]
  );

  /** Assign a lead to a staff member; returns an error message when it fails. */
  const assignLeadTo = useCallback(
    async (leadId: string, staffId: string): Promise<{ error?: string }> => {
      if (!staffId) return { error: "Select a staff member" };
      setBusy(true);
      const { error } = await supabase
        .from("leads")
        .update({
          owner_id: staffId,
          assigned_to: staffId,
          assigned_by: userId,
          assigned_at: new Date().toISOString(),
          acknowledged_at: null,
        } as any)
        .eq("id", leadId);
      if (error) {
        setBusy(false);
        return { error: error.message };
      }
      await logActivity(leadId, `Assigned to ${nameOf(staffId)} by ${myName()}`);
      setBusy(false);
      return {};
    },
    [userId, logActivity, nameOf, myName]
  );

  return { isAdmin, loading, userId, staff, busy, nameOf, myName, logActivity, assignLeadTo };
}
