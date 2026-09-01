import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pageRange } from "@/lib/sales.hooks";

export type TicketTableRow = {
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
  closed_at?: string | null;
  oem_call?: boolean | null;
  parts_used?: boolean | null;
  defective_parts_received?: boolean | null;
  good_parts_used?: boolean | null;
  special_instruction?: string | null;
  special_instruction_acknowledged?: boolean | null;
  has_special_activity?: boolean;
  good_parts_details?: unknown;
  defective_parts_details?: unknown;
};

const TICKET_LIST_COLS =
  "id,case_id,status,priority,customer_name,customer_id,serial_no,created_at,assigned_engineer_name,good_parts_details,defective_parts_details,call_type,product,customer_phone,customer_address,customer_email,location,sector,complaint,assigned_engineer_phone,raised_by_type,raised_by_name,oem_call,parts_used,defective_parts_received,good_parts_used,special_instruction,special_instruction_acknowledged,closed_at,assigned_at";

export function useTicketsTable(opts: {
  status: string;
  type: string;
  q: string;
  page: number;
  pageSize: number;
  /** "open" = active statuses, "closed" = Closed + Cancelled, "all" = no filter */
  tab?: "open" | "closed" | "all";
}) {
  const { status, type, q, page, pageSize, tab = "all" } = opts;
  const term = q.trim();
  return useQuery({
    queryKey: ["tickets", "table", { status, type, q: term, page, pageSize, tab }] as const,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const { from, to } = pageRange(page, pageSize);
      let sel = supabase
        .from("tickets")
        .select(TICKET_LIST_COLS, { count: "exact" })
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .range(from, to);

      // Server-side tab filtering: open = not terminal, closed = terminal only
      if (tab === "open") {
        sel = sel.not("status", "in", '("Closed","Cancelled")');
      } else if (tab === "closed") {
        sel = sel.in("status", ["Closed", "Cancelled"]);
      }

      if (status !== "all") sel = sel.eq("status", status);
      if (type !== "all") sel = sel.eq("call_type", type);
      if (term) {
        const safe = term.replace(/[%_]/g, "\\$&");
        const p = `%${safe}%`;
        // Server-side free-text: cover the fields the UI searches client-side
        sel = sel.or(
          `case_id.ilike.${p},customer_name.ilike.${p},serial_no.ilike.${p},product.ilike.${p},customer_phone.ilike.${p},location.ilike.${p}`,
        );
      }
      const { data, count, error } = await sel;
      if (error) throw error;
      const baseRows = (data || []) as unknown as TicketTableRow[];
      const ids = baseRows.map((r) => r.id);
      let flagged = new Set<string>();
      if (ids.length) {
        const { data: acts } = await supabase
          .from("ticket_activities")
          .select("ticket_id")
          .eq("special_instruction", true)
          .in("ticket_id", ids)
          .limit(200);
        flagged = new Set(((acts as { ticket_id: string }[] | null) || []).map((a) => a.ticket_id));
      }
      const rows = baseRows.map((r) => ({ ...r, has_special_activity: flagged.has(r.id) }));
      return { rows, count: count ?? 0 };
    },
  });
}

/** Lightweight count for Open vs Closed tabs — runs in parallel, no row data fetched. */
export function useTicketTabCounts() {
  return useQuery({
    queryKey: ["tickets", "tab_counts"] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const [openRes, closedRes] = await Promise.all([
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("is_deleted", false)
          .not("status", "in", '("Closed","Cancelled")'),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("is_deleted", false)
          .in("status", ["Closed", "Cancelled"]),
      ]);
      return {
        open: openRes.count ?? 0,
        closed: closedRes.count ?? 0,
      };
    },
  });
}

export function useAssignableEngineers() {
  return useQuery({
    queryKey: ["tickets", "assignable_engineers"] as const,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assignable_engineers")
        .select("id,name,phone,department,active")
        .order("name")
        .limit(200);
      if (error) throw error;
      return (data || []) as {
        id: string;
        name: string;
        phone: string | null;
        department: string | null;
        active: boolean;
      }[];
    },
  });
}
