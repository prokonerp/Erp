import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys } from "@/lib/queryKeys";
import {
  payableWindow,
  type AdminEngineer,
  type AdminRate,
  type AdminWarning,
} from "@/lib/engineersAdmin";

/**
 * Engineers admin reads (TASK 1): direct table/RPC reads under the admin
 * RLS policies (admin all engineer_daily_logs, expenses, rates/settlements)
 * — no read server fns. Every section degrades independently: one failure
 * pushes a { section, message } warning, never blanks the rest. Empty
 * results never warn on their own — RLS-denied reads return 0 rows, so
 * warnings come only from caught errors.
 */

type DayRow = {
  log_date: string | null;
  morning_odometer: number | null;
  evening_odometer: number | null;
};

type ExpenseRow = {
  expense_date: string | null;
  charge_type: string | null;
  amount: number | string | null;
  receipt_path: string | null;
};

type SettlementRow = {
  employee_id: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string | null;
};

function errMessage(e: unknown): { message: string; code?: string } {
  const err = e as { message?: unknown; code?: unknown } | null;
  return {
    message: typeof err?.message === "string" && err.message !== "" ? err.message : "failed",
    code: typeof err?.code === "string" ? err.code : undefined,
  };
}

/** Friendly pointer when a conveyance table is missing in the DB, or a
 *  column's type no longer matches what the query assumes. Mirrors
 *  useEngineerDashboard's hintFor, pinned to migration 20260925000001. */
function hintFor(e: unknown, migration: string): string {
  const { message, code } = errMessage(e);
  if (code === "42703" || code === "42P01" || /does not exist/i.test(message)) {
    return `not set up yet — ask admin to run migration ${migration}`;
  }
  if (code === "22P02" && /enum/i.test(message)) {
    return `data-type fix needed — ask admin to run migration ${migration}`;
  }
  return message;
}

/** Field-engineer roster via list_engineers() (is_field_engineer gate lives
 *  inside the function body — non-admins get zero rows, never a warning). */
export function useEngineerRoster() {
  const query = useQuery({
    queryKey: adminEngKeys.roster(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{ roster: AdminEngineer[]; warnings: AdminWarning[] }> => {
      const warnings: AdminWarning[] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- list_engineers() pending generated types
        const { data, error } = await (supabase as any).rpc("list_engineers");
        if (error) throw error;
        return { roster: Array.isArray(data) ? (data as AdminEngineer[]) : [], warnings };
      } catch (e) {
        warnings.push({ section: "roster", message: hintFor(e, "20260925000001") });
        return { roster: [], warnings };
      }
    },
  });

  return {
    roster: query.data?.roster ?? [],
    warnings: query.data?.warnings ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}

/** One engineer's IST-bounded payables: day logs + flat expenses + rates. */
export function useEngineerPayables(input: {
  employeeId: string | null;
  from: string;
  to: string;
}) {
  const { employeeId, from: rawFrom, to: rawTo } = input;
  const window = payableWindow(rawFrom, rawTo);

  const query = useQuery({
    queryKey: adminEngKeys.payables(employeeId, window.from, window.to),
    enabled: !!employeeId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{
      days: DayRow[];
      expenses: ExpenseRow[];
      rates: AdminRate[];
      warnings: AdminWarning[];
    }> => {
      const warnings: AdminWarning[] = [];
      let days: DayRow[] = [];
      let expenses: ExpenseRow[] = [];
      let rates: AdminRate[] = [];

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_daily_logs")
          .select("log_date, morning_odometer, evening_odometer")
          .eq("employee_id", employeeId!)
          .gte("log_date", window.from)
          .lte("log_date", window.to)
          .order("log_date", { ascending: true });
        if (error) throw error;
        days = Array.isArray(data) ? (data as DayRow[]) : [];
      } catch (e) {
        warnings.push({ section: "days", message: hintFor(e, "20260925000001") });
        days = [];
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_expenses")
          .select("expense_date, charge_type, amount, receipt_path")
          .eq("employee_id", employeeId!)
          .gte("expense_date", window.from)
          .lte("expense_date", window.to)
          .order("expense_date", { ascending: true });
        if (error) throw error;
        expenses = Array.isArray(data) ? (data as ExpenseRow[]) : [];
      } catch (e) {
        warnings.push({ section: "expenses", message: hintFor(e, "20260925000001") });
        expenses = [];
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_rates")
          .select("employee_id, rate_per_km, effective_from")
          .eq("employee_id", employeeId!)
          .lte("effective_from", window.to)
          .order("effective_from", { ascending: true });
        if (error) throw error;
        rates = Array.isArray(data) ? (data as AdminRate[]) : [];
      } catch (e) {
        warnings.push({ section: "rates", message: hintFor(e, "20260925000001") });
        rates = [];
      }

      return { days, expenses, rates, warnings };
    },
  });

  return {
    days: query.data?.days ?? [],
    expenses: query.data?.expenses ?? [],
    rates: query.data?.rates ?? [],
    warnings: query.data?.warnings ?? [],
    window,
    isLoading: !!employeeId && query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}

/** Cross-engineer settlement ledger for an IST window, plus rates in force. */
export function useEngineerLedger(input: { from: string; to: string }) {
  const window = payableWindow(input.from, input.to);

  const query = useQuery({
    queryKey: adminEngKeys.ledger(window.from, window.to),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{
      settlements: SettlementRow[];
      rates: AdminRate[];
      warnings: AdminWarning[];
    }> => {
      const warnings: AdminWarning[] = [];
      let settlements: SettlementRow[] = [];
      let rates: AdminRate[] = [];

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_settlements")
          .select("employee_id, period_start, period_end, status")
          .lte("period_start", window.to)
          .gte("period_end", window.from)
          .order("period_start", { ascending: true });
        if (error) throw error;
        settlements = Array.isArray(data) ? (data as SettlementRow[]) : [];
      } catch (e) {
        warnings.push({ section: "settlements", message: hintFor(e, "20260925000001") });
        settlements = [];
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_rates")
          .select("employee_id, rate_per_km, effective_from")
          .lte("effective_from", window.to)
          .order("effective_from", { ascending: true });
        if (error) throw error;
        rates = Array.isArray(data) ? (data as AdminRate[]) : [];
      } catch (e) {
        warnings.push({ section: "rates", message: hintFor(e, "20260925000001") });
        rates = [];
      }

      return { settlements, rates, warnings };
    },
  });

  return {
    settlements: query.data?.settlements ?? [],
    rates: query.data?.rates ?? [],
    warnings: query.data?.warnings ?? [],
    window,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}
