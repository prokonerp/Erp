import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";

/**
 * Read-only hook: fetch tickets assigned to the current engineer.
 *
 * Resolution strategy (no writes):
 *  1. Resolve auth user → employee record (by email).
 *  2. Match tickets by assigned_engineer_name = employee.name.
 *
 * NOTE: assigned_employee_id column is not yet in generated Supabase types.
 * When the column is added to the schema and types are regenerated, upgrade
 * to FK matching first and keep name match as fallback.
 *
 * No realtime subscription. staleTime 30s + refetchInterval 15s while visible.
 */

const QUEUE_COLS =
  "id,case_id,status,priority,customer_name,customer_phone,product,serial_no,location,complaint,created_at,assigned_engineer_name,assigned_engineer_phone,call_type,assigned_at";

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

      // Resolve employee name from auth user email
      let engineerName: string | null = null;
      if (email) {
        const { data: emp } = await supabase
          .from("employees")
          .select("name")
          .eq("email", email)
          .eq("active", true)
          .maybeSingle();
        if (emp) engineerName = emp.name;
      }

      if (!engineerName) return [];

      // Fetch open tickets assigned to this engineer by name
      const { data, error } = await supabase
        .from("tickets")
        .select(QUEUE_COLS)
        .eq("is_deleted", false)
        .eq("assigned_engineer_name", engineerName)
        .not("status", "in", '("Closed","Cancelled")')
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[useMyQueue]", error.message);
        return [];
      }
      return (data || []) as QueueTicket[];
    },
  });
}
