import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { useMyQueue } from "@/hooks/useMyQueue";
import {
  assembleDashboardStats,
  todayLocal,
  type DashboardPendingMaterial,
  type DashboardStats,
} from "@/lib/engineer-conveyance";

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

/** Friendly pointer when a conveyance/material table is missing in the DB. */
function hintFor(e: unknown, migration: string): string {
  const { message, code } = errMessage(e);
  if (code === "42703" || code === "42P01" || /does not exist/i.test(message)) {
    return `not set up yet — ask admin to run migration ${migration}`;
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
  const today = todayLocal();

  const rest = useQuery({
    queryKey: ["eng", "dashboard-direct", employeeId, today] as const,
    enabled: !!employeeId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const warnings: string[] = [];
      const [completedVisits, dayLog, material] = await Promise.all([
        (async () => {
          try {
            const { count, error } = await supabase
              .from("field_service_reports")
              .select("id", { count: "exact", head: true })
              .eq("engineer_employee_id", employeeId!);
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
            warnings.push(`material: ${hintFor(e, "20260921000001")}`);
            return { holding: 0, pending: [] } satisfies MaterialRpc;
          }
        })(),
      ]);
      return { completedVisits, dayLog, material, warnings };
    },
  });

  const stats: DashboardStats | null =
    employeeId && rest.data
      ? assembleDashboardStats({
          employeeName: employee?.name ?? null,
          tickets: (queue.data ?? []).map((t) => ({ id: t.id, status: t.status })),
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
    isLoading: queue.isLoading || rest.isLoading,
    isError: queue.isError || (!rest.isLoading && !!employeeId && rest.isError),
    error: queue.error ?? rest.error,
    refetch: () => {
      void Promise.all([queue.refetch(), rest.refetch()]);
    },
    isFetching: queue.isFetching || rest.isFetching,
  };
}
