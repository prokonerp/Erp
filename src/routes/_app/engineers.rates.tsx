import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys } from "@/lib/queryKeys";
import { useEngineerRoster } from "@/hooks/useEngineerAdmin";
import type { AdminRate } from "@/lib/engineersAdmin";
import { RateEditor } from "@/components/engineer/RateEditor";

export const Route = createFileRoute("/_app/engineers/rates")({
  component: EngineerRatesPage,
  head: () => ({ meta: [{ title: "Engineer Rates — Prokon" }] }),
});

/** Admin rates: rate-today hero + append-only timeline per engineer. */
function EngineerRatesPage() {
  const queryClient = useQueryClient();
  const { roster, isLoading: rosterLoading } = useEngineerRoster();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && roster.length > 0) setSelectedId(roster[0].employee_id);
  }, [selectedId, roster]);

  const {
    data: rates = [],
    isLoading: ratesLoading,
    error: ratesError,
    refetch,
  } = useQuery({
    queryKey: adminEngKeys.rates(selectedId),
    enabled: !!selectedId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<AdminRate[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
      const { data, error } = await (supabase as any)
        .from("engineer_conveyance_rates")
        .select("employee_id, rate_per_km, effective_from")
        .eq("employee_id", selectedId!)
        .order("effective_from", { ascending: true });
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? (data as AdminRate[]) : [];
    },
  });

  function handleSaved() {
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.ratesPrefix });
    // Rates feed payable math — bust the derived families too (no
    // payables/ledger *Prefix factory exists, so use the family prefixes).
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.conveyancePrefix });
    void queryClient.invalidateQueries({ queryKey: ["admin-eng", "payables"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-eng", "ledger"] });
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.attentionPrefix });
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.overviewPrefix });
    void refetch();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Conveyance Rates</h1>
        <p className="text-sm text-muted-foreground">
          Per-engineer ₹/km, effective-dated. Append-only — corrections are new rows.
        </p>
      </div>
      {ratesError ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          Could not load rates: {(ratesError as Error).message}
        </p>
      ) : null}
      <RateEditor
        engineers={roster}
        selectedEmployeeId={selectedId}
        onSelectEmployee={setSelectedId}
        rates={rates}
        isLoading={rosterLoading || ratesLoading}
        onSaved={handleSaved}
      />
    </div>
  );
}
