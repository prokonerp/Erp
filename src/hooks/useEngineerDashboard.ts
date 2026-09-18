import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { engKeys } from "@/lib/queryKeys";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { useMyQueue } from "@/hooks/useMyQueue";
import {
  assembleDashboardStats,
  pendingPayoutWithUnsettled,
  type DashboardPendingMaterial,
  type DashboardStats,
  type SettlementPayoutRow,
  type UnsettledDay,
  type UnsettledExpense,
} from "@/lib/engineer-conveyance";
import type { AdminRate } from "@/lib/engineersAdmin";
import { istDateKey } from "@/lib/time";

/**
 * Engineer dashboard data without any server-function hop (no serverless
 * cold start): queue rows (cached/shared with the queue page) + three
 * parallel direct queries (FSR count, today's log, material RPC).
 * Every section degrades independently — one failure warns, never blanks.
 */

type MaterialRpc = { holding: number; pending: DashboardPendingMaterial[] };

function errMessage(e: unknown): { message: string; code?: string } {
  const err = e as { message?: unknown; code?: unknown } | null;
  return {
    message: typeof err?.message === "string" && err.message !== "" ? err.message : "failed",
    code: typeof err?.code === "string" ? err.code : undefined,
  };
}

/** Friendly pointer when a conveyance/material table is missing in the DB,
 *  or a column's type no longer matches what the query assumes (e.g. the
 *  22P02 enum-coercion failure fixed by 20260925000004). Exported for tests. */
export function hintFor(e: unknown, migration: string): string {
  const { message, code } = errMessage(e);
  if (code === "42703" || code === "42P01" || /does not exist/i.test(message)) {
    return `not set up yet — ask admin to run migration ${migration}`;
  }
  if (code === "22P02" && /enum/i.test(message)) {
    return `data-type fix needed — ask admin to run migration ${migration}`;
  }
  return message;
}

async function fetchMaterial(): Promise<MaterialRpc> {
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string) => Promise<{ data: unknown; error: { message: string } | null }>;
    }
  ).rpc("get_engineer_material_stats");
  if (error) throw error;
  const d = (data ?? {}) as { holding?: unknown; pending?: unknown };
  return {
    holding: typeof d.holding === "number" ? d.holding : 0,
    pending: Array.isArray(d.pending) ? (d.pending as DashboardPendingMaterial[]) : [],
  };
}

export function useEngineerDashboard() {
  const { employee } = useMyEmployee();
  const employeeId = employee?.id ?? null;
  const queue = useMyQueue();
  const today = istDateKey();

  const rest = useQuery({
    queryKey: engKeys.dashboard(employeeId, today),
    enabled: !!employeeId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const warnings: string[] = [];
      const dayStart = new Date(`${today}T00:00:00+05:30`);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const [completedVisits, dayLog, material, todayTickets, pendingPayout] = await Promise.all([
        (async () => {
          try {
            // IST day window: submitted_at is a timestamptz, so bound it
            // between IST midnight and the next IST midnight.
            const { count, error } = await supabase
              .from("field_service_reports")
              .select("id", { count: "exact", head: true })
              .eq("engineer_employee_id", employeeId!)
              .gte("submitted_at", dayStart.toISOString())
              .lt("submitted_at", dayEnd.toISOString());
            if (error) throw error;
            return count ?? 0;
          } catch (e) {
            warnings.push(`visits: ${errMessage(e).message}`);
            return 0;
          }
        })(),
        (async () => {
          try {
            const { data, error } = await supabase
              .from("engineer_daily_logs")
              .select("morning_odometer, evening_odometer")
              .eq("employee_id", employeeId!)
              .eq("log_date", today)
              .maybeSingle();
            if (error) throw error;
            return (
              (data as {
                morning_odometer: number | null;
                evening_odometer: number | null;
              } | null) ?? null
            );
          } catch (e) {
            warnings.push(`today: ${hintFor(e, "20260920000001")}`);
            return null;
          }
        })(),
        (async () => {
          try {
            return await fetchMaterial();
          } catch (e) {
            warnings.push(`material: ${hintFor(e, "20260925000004")}`);
            return { holding: 0, pending: [] } satisfies MaterialRpc;
          }
        })(),
        (async () => {
          // Today's assigned calls: assigned_at inside the IST day window.
          try {
            const { data, error } = await supabase
              .from("tickets")
              .select("id, status")
              .filter("assigned_employee_id", "eq", employeeId!)
              .eq("is_deleted", false)
              .gte("assigned_at", dayStart.toISOString())
              .lt("assigned_at", dayEnd.toISOString());
            if (error) throw error;
            return (data ?? []) as { id: string; status: string | null }[];
          } catch (e) {
            warnings.push(`today: ${errMessage(e).message}`);
            return [] as { id: string; status: string | null }[];
          }
        })(),
        (async () => {
          // Pending payout: unpaid settlements PLUS live (unsettled) km +
          // flat expenses for days outside any non-rejected settlement
          // window. Reads the caller's own rows via RLS (policy "own …" on
          // all four tables), so unsettled conveyance surfaces instead of ₹0.
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- conveyance tables pending generated select nuance
            const client = supabase as any;
            const [settlements, days, expenses, rates] = await Promise.all([
              client
                .from("engineer_conveyance_settlements")
                .select(
                  "computed_amount, flat_expenses, adjusted_amount, status, paid_at, period_start, period_end",
                )
                .eq("employee_id", employeeId!),
              client
                .from("engineer_daily_logs")
                .select("log_date, morning_odometer, evening_odometer")
                .eq("employee_id", employeeId!),
              client
                .from("engineer_conveyance_expenses")
                .select("expense_date, amount")
                .eq("employee_id", employeeId!),
              client
                .from("engineer_conveyance_rates")
                .select("employee_id, rate_per_km, effective_from")
                .eq("employee_id", employeeId!),
            ]);
            for (const r of [settlements, days, expenses, rates]) {
              if (r.error) throw r.error;
            }
            return pendingPayoutWithUnsettled({
              employeeId: employeeId!,
              settlements: (settlements.data ?? []) as SettlementPayoutRow[],
              days: (days.data ?? []) as UnsettledDay[],
              expenses: (expenses.data ?? []) as UnsettledExpense[],
              rates: (rates.data ?? []) as AdminRate[],
            });
          } catch (e) {
            warnings.push(`payout: ${errMessage(e).message}`);
            return 0;
          }
        })(),
      ]);
      return { completedVisits, dayLog, material, warnings, todayTickets, pendingPayout };
    },
  });

  const stats: DashboardStats | null =
    employeeId && rest.data
      ? assembleDashboardStats({
          employeeName: employee?.name ?? null,
          tickets: (queue.data ?? []).map((t) => ({ id: t.id, status: t.status })),
          todayTickets: rest.data.todayTickets,
          pendingPayout: rest.data.pendingPayout,
          completedVisits: rest.data.completedVisits,
          dayLog: rest.data.dayLog,
          materialHolding: rest.data.material.holding,
          materialPending: rest.data.material.pending,
          warnings: rest.data.warnings,
          todayLogDate: today,
        })
      : null;

  return {
    stats,
    // A disabled query reports isLoading while idle — gate on employeeId so a
    // never-linked login can't spin skeletons forever (queue error surfaces).
    isLoading: queue.isLoading || (!!employeeId && rest.isLoading),
    isError: queue.isError || (!rest.isLoading && !!employeeId && rest.isError),
    error: queue.error ?? rest.error,
    refetch: () => {
      void Promise.all([queue.refetch(), rest.refetch()]);
    },
    isFetching: queue.isFetching || rest.isFetching,
  };
}
