import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { verificationKeys } from "@/lib/queryKeys";

export function useTicketVerifications(ticketId: string | null) {
  return useQuery({
    queryKey: ticketId ? verificationKeys.detail(ticketId) : ["verifications", "detail", "none"],
    enabled: !!ticketId,
    staleTime: 30_000,
    queryFn: async () => {
      const [{ data: customer }, { data: equipment }] = await Promise.all([
        supabase
          .from("ticket_customer_verifications")
          .select("*")
          .eq("ticket_id", ticketId!)
          .maybeSingle(),
        supabase
          .from("ticket_equipment_verifications")
          .select("*")
          .eq("ticket_id", ticketId!)
          .maybeSingle(),
      ]);
      return { customer: customer ?? null, equipment: equipment ?? null };
    },
  });
}
