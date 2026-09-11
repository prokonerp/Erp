import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function formatFieldVerified(r: {
  engineer_name?: string | null;
  verified_at?: string | null;
}): string {
  return `${r.engineer_name ?? "Engineer"} · ${r.verified_at ? new Date(r.verified_at).toLocaleString() : ""}`;
}

export function CustomerFieldVerified({ customerId }: { customerId: string }) {
  const { data } = useQuery({
    queryKey: ["customer-field-verified", customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ticket_customer_verifications")
        .select("id,ticket_id,verdict,corrected,engineer_name,verified_at")
        .eq("customer_id", customerId)
        .order("verified_at", { ascending: false });
      return data ?? [];
    },
  });

  if (!data?.length) {
    return (
      <div className="text-xs text-muted-foreground border rounded p-3">
        No field-verified reports yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Field Verified (from site) — read-only</h4>
      {data.map((r: Record<string, unknown>) => (
        <div key={String(r.id)} className="border rounded p-2 text-xs">
          <div>
            {formatFieldVerified(
              r as { engineer_name?: string | null; verified_at?: string | null },
            )}
            {" · Ticket "}
            {String(r.ticket_id).slice(0, 8)}
          </div>
          <pre className="whitespace-pre-wrap">{JSON.stringify(r.corrected ?? {}, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
