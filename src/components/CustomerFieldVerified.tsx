import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const LABEL_MAP: Record<string, string> = {
  customer_name: "Customer name",
  phone: "Phone",
  email: "Email",
  address: "Address",
  sector: "Sector",
  location: "Location",
};

export function correctedRows(
  corrected: Record<string, unknown> | null | undefined,
): Array<{ label: string; value: string }> {
  if (!corrected) return [];
  return Object.entries(corrected)
    .filter(([, v]) => v != null && typeof v === "string" && v.trim() !== "")
    .map(([k, v]) => ({ label: LABEL_MAP[k] ?? k, value: v as string }));
}

export function formatFieldVerified(r: {
  engineer_name?: string | null;
  verified_at?: string | null;
}): string {
  return `${r.engineer_name ?? "Engineer"} · ${r.verified_at ? new Date(r.verified_at).toLocaleString() : ""}`;
}

export function CustomerFieldVerified({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer-field-verified", customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("ticket_customer_verifications")
        .select("id,ticket_id,verdict,corrected,engineer_name,verified_at")
        .eq("customer_id", customerId)
        .order("verified_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
    staleTime: 10_000,
  });

  if (isLoading) {
    return <div className="text-xs text-muted-foreground border rounded p-3">Loading…</div>;
  }

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
      {data.map((r: Record<string, unknown>) => {
        const rows = correctedRows(r.corrected as Record<string, unknown> | null | undefined);
        const verdict = r.verdict as string | null | undefined;
        const isVerified = verdict === "verified" || verdict === "correct";
        return (
          <div key={String(r.id)} className="border rounded p-2 text-xs space-y-1">
            <div className="flex items-center gap-2">
              <span>
                {formatFieldVerified(
                  r as { engineer_name?: string | null; verified_at?: string | null },
                )}
                {" · Ticket "}
                {String(r.ticket_id).slice(0, 8)}
              </span>
              {verdict ? (
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    isVerified
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                  }`}
                >
                  {isVerified ? "Verified" : "Corrected"}
                </span>
              ) : null}
            </div>
            {rows.length > 0 ? (
              <table className="w-full border-collapse">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label} className="border border-slate-200 dark:border-slate-700">
                      <td className="px-2 py-1 font-medium text-muted-foreground whitespace-nowrap">
                        {row.label}
                      </td>
                      <td className="px-2 py-1">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-muted-foreground">No corrections recorded.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
