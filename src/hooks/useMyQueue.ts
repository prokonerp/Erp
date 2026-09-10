import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";

/**
 * Read-only hook: fetch tickets assigned to the current engineer.
 *
 * Resolution strategy (no writes):
 *  1. Resolve auth user → employee record (by email). Zero rows →
 *     ACCOUNT_NOT_LINKED. Multiple rows → AMBIGUOUS_EMPLOYEE_MATCH.
 *     Both surface in the UI as "contact admin" (fail-loud, never silent).
 *  2. FK-first: match tickets.assigned_employee_id = employee.id
 *     (via .filter() so missing generated types can't break the build).
 *  3. Name fallback ONLY when the employee name is unique across active
 *     employees — otherwise same-name engineers would see each other's
 *     tickets. With duplicate names the queue is FK-only (safe subset).
 *
 * No realtime subscription. staleTime 30s + refetchInterval 15s while visible.
 */

const QUEUE_COLS =
  "id,case_id,status,priority,customer_name,customer_phone,product,serial_no,location,complaint,created_at,assigned_engineer_name,assigned_engineer_phone,call_type,assigned_at";
// NOTE: assigned_employee_id is intentionally NOT in the projection — it is
// not yet in the generated Supabase types and would poison the select type.
// FK matching uses .filter("assigned_employee_id",...) which takes a plain
// string. Add the column here after types are regenerated.

type QueueTicket = {
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
};

export function useMyQueue() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;

  return useQuery({
    queryKey: ["eng", "queue", uid] as const,
    enabled: !!uid,
    staleTime: 30_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<QueueTicket[]> => {
      if (!uid) return [];
      if (!email) throw new Error("ACCOUNT_NOT_LINKED");

      // Resolve employee (id + name) from auth user email
      const { data: emps, error: empErr } = await supabase
        .from("employees")
        .select("id,name")
        .eq("email", email)
        .eq("active", true);
      if (empErr) {
        console.error("[useMyQueue]", empErr.message);
        throw empErr;
      }
      if (!emps || emps.length === 0) throw new Error("ACCOUNT_NOT_LINKED");
      if (emps.length > 1) throw new Error("AMBIGUOUS_EMPLOYEE_MATCH");
      const empId = emps[0].id as string;
      const engineerName = emps[0].name as string;

      const baseSelect = QUEUE_COLS;

      // FK-first: exact engineer match (safe under duplicate names).
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
      const fkTickets = (fkRes.data || []) as QueueTicket[];

      // Name fallback only when the name is unique across active employees.
      const { count: nameCount } = await supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("name", engineerName)
        .eq("active", true);
      if ((nameCount ?? 0) > 1) return fkTickets;

      const nameRes = await supabase
        .from("tickets")
        .select(baseSelect)
        .eq("is_deleted", false)
        .eq("assigned_engineer_name", engineerName)
        .not("status", "in", '("Closed","Cancelled")')
        .order("created_at", { ascending: false });
      if (nameRes.error) {
        console.error("[useMyQueue]", nameRes.error.message);
        throw nameRes.error;
      }
      const seen = new Set(fkTickets.map((t) => t.id));
      return [
        ...fkTickets,
        ...((nameRes.data || []) as QueueTicket[]).filter((t) => !seen.has(t.id)),
      ];
    },
  });
}
