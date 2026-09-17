import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { fetchMyIdentity } from "@/lib/engineer-identity";
import { engKeys } from "@/lib/queryKeys";

/**
 * Read-only hook: fetch tickets assigned to the current engineer.
 *
 * Resolution strategy (no writes):
 *  1. Central identity policy (fetchMyIdentity): auth_user_id exact link,
 *     unique-email fallback, AMBIGUOUS_EMPLOYEE_MATCH on dupes.
 *     Both surface in the UI as "contact admin" (fail-loud, never silent).
 *  2. FK-only: match tickets.assigned_employee_id = employee.id
 *     (via .filter() so missing generated types can't break the build).
 *     The legacy assigned_engineer_name fallback was removed with
 *     20260923000003_remove_name_fallback_rls — RLS returns zero rows for
 *     name-only tickets, so no client-side name query exists anymore.
 *
 * No realtime subscription. staleTime 30s + refetchInterval 15s while visible.
 */

const QUEUE_COLS =
  "id,case_id,status,priority,customer_name,customer_phone,product,serial_no,location,complaint,created_at,assigned_engineer_name,assigned_engineer_phone,call_type,assigned_at,sector";
// NOTE: assigned_employee_id is intentionally NOT in the projection — it is
// not yet in the generated Supabase types and would poison the select type.
// FK matching uses .filter("assigned_employee_id",...) which takes a plain
// string. Add the column here after types are regenerated.

export type QueueTicket = {
  id: string;
  case_id: string;
  status: string;
  priority: string | null;
  customer_name: string;
  customer_phone: string | null;
  product: string | null;
  serial_no: string | null;
  location: string | null;
  complaint: string | null;
  created_at: string;
  assigned_engineer_name: string | null;
  assigned_engineer_phone: string | null;
  call_type: string;
  assigned_at: string | null;
  sector: string | null;
};

/**
 * Read-only opt-in carried-parts count for the current engineer.
 * Disabled by default (enabled=false) so the queue list issues no new
 * queries. When enabled, resolves the employee id by email (same as
 * useMyQueue) then counts ims_stock_items by custodian_employee_id.
 * Never throws to the UI: lookup failure → count 0 ("Unknown" fallback
 * handled by callers via custodianBadgeLabel).
 */
export function useMyCarriedPartsCount(enabled = false) {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;

  return useQuery({
    queryKey: engKeys.carriedCount(uid),
    enabled: !!uid && !!email && enabled,
    staleTime: 30_000,
    refetchInterval: false,
    queryFn: async (): Promise<{ count: number; employeeId: string | null }> => {
      try {
        if (!email) return { count: 0, employeeId: null };
        const { data: emps, error: empErr } = await supabase
          .from("employees")
          .select("id")
          .eq("email", email)
          .eq("active", true)
          .limit(1);
        if (empErr || !emps || emps.length === 0) return { count: 0, employeeId: null };
        const empId = (emps[0] as { id: string }).id;
        const { count, error } = await supabase
          .from("ims_stock_items")
          .select("id", { count: "exact", head: true })
          .filter("custodian_employee_id", "eq", empId);
        if (error) return { count: 0, employeeId: empId };
        return { count: count ?? 0, employeeId: empId };
      } catch {
        return { count: 0, employeeId: null };
      }
    },
  });
}

export function useMyQueue() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;

  return useQuery({
    queryKey: engKeys.queue(uid),
    enabled: !!uid,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<QueueTicket[]> => {
      if (!uid) return [];

      // Central identity policy (auth_user_id exact, unique-email fallback,
      // fail-loud on ambiguity). Error mapping preserved: unlinked or
      // unresolvable -> ACCOUNT_NOT_LINKED, dupes -> AMBIGUOUS_EMPLOYEE_MATCH.
      const identity = await fetchMyIdentity(supabase, {
        authUid: uid,
        email,
        columns: "id,name",
      });
      if (identity.status === "ambiguous") throw new Error("AMBIGUOUS_EMPLOYEE_MATCH");
      if (identity.status !== "ok") throw new Error("ACCOUNT_NOT_LINKED");
      const empId = identity.employee.id;

      const baseSelect = QUEUE_COLS;

      // FK-only: exact engineer match (safe under duplicate names).
      // .filter() takes a plain string column so the not-yet-regenerated
      // Supabase types can't break this query at build time.
      const fkRes = await supabase
        .from("tickets")
        .select(baseSelect)
        .eq("is_deleted", false)
        .filter("assigned_employee_id", "eq", empId)
        .not("status", "in", '("Closed","Cancelled")')
        .order("created_at", { ascending: false });
      if (fkRes.error) {
        console.error("[useMyQueue]", fkRes.error.message);
        throw fkRes.error;
      }
      return (fkRes.data || []) as QueueTicket[];
    },
  });
}
