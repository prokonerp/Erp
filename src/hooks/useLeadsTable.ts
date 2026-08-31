import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pageRange } from "@/lib/sales.hooks";
import type { Lead } from "@/lib/crm";

const LEAD_LIST_COLS =
  "id,customer_id,title,source,status,expected_value,closed_value,next_followup,owner_id,assigned_to,assigned_at,acknowledged_at,updated_at,lost_reason,closed_at,closed_remarks,remarks";

export function useLeadsTable(opts: {
  search: string;
  status: string;
  page: number;
  pageSize: number;
}) {
  const { search, status, page, pageSize } = opts;
  const term = search.trim();
  return useQuery({
    queryKey: ["leads", "table", { term, status, page, pageSize }] as const,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const { from, to } = pageRange(page, pageSize);
      let q = supabase
        .from("leads")
        .select(LEAD_LIST_COLS, { count: "exact" })
        .order("updated_at", { ascending: false })
        .range(from, to);
      if (status !== "all") q = q.eq("status", status);
      if (term) {
        const safe = term.replace(/[%_]/g, "\\$&");
        const p = `%${safe}%`;
        q = q.or(`title.ilike.${p},source.ilike.${p}`);
      }
      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data || []) as unknown as Lead[], count: count ?? 0 };
    },
  });
}
