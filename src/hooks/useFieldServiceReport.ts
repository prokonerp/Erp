import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fieldServiceReportKeys } from "@/lib/queryKeys";

export function useFieldServiceReport(ticketId: string | null) {
  return useQuery({
    queryKey: ticketId
      ? fieldServiceReportKeys.list({ ticket: ticketId })
      : ["field_service_reports", "list", "none"],
    enabled: !!ticketId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("field_service_reports")
        .select("*")
        .eq("ticket_id", ticketId!)
        .order("submitted_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
