import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys } from "@/lib/queryKeys";
import { istDateKey } from "@/lib/time";
import { asEmployeeDocuments } from "@/lib/engineer-conveyance";
import {
  attentionQueue,
  conveyanceMatrix,
  custodyLedger,
  docCompliance,
  payableWindow,
  perEngineerSummary,
  rosterKpis,
  type AdminEngineer,
  type AdminRate,
  type AdminWarning,
  type AttentionQueueItem,
  type ConveyanceMatrixRow,
  type CustodyLedgerRow,
  type RosterKpis,
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

// ---- Engineers console Phase 1: overview foundation -------------------
// Six overview hooks. Same contract as the TASK 1 reads above: direct
// table/RPC reads (no server fns), every read in its own try/catch pushing
// { section, message }, empty results never warn (RLS-denied reads return
// 0 rows). Each returns { data, warnings, isLoading }; pure composition
// (rosterKpis / perEngineerSummary / attentionQueue / conveyanceMatrix /
// custodyLedger / docCompliance) runs client-side on the fetched rows.

type OverviewTicketRow = {
  id: string;
  assigned_employee_id: string | null;
  status: string | null;
};

type TicketRow = {
  id: string;
  case_id: string | null;
  status: string | null;
  created_at: string | null;
  closed_at: string | null;
  customer_name: string | null;
  product: string | null;
  serial_no: string | null;
  assigned_employee_id: string | null;
  assigned_engineer_name: string | null;
};

type AllLogRow = DayRow & { employee_id: string | null };

type AllExpenseRow = ExpenseRow & { employee_id: string | null };

type AllRateRow = AdminRate;

type DocRow = { id: string; documents: unknown };

type CustodyRpcRow = {
  stock_item_id: string | null;
  custodian_employee_id: string | null;
  custodian_name: string | null;
  part_serial_no: string | null;
  ticket_id: string | null;
  set_at: string | null;
};

/** Console KPIs: roster + open-ticket counts + current-month logs. */
export function useEngineerOverview(): {
  data: { roster: AdminEngineer[]; kpis: RosterKpis };
  warnings: AdminWarning[];
  isLoading: boolean;
} {
  const today = istDateKey();
  const monthStart = `${today.slice(0, 7)}-01`;

  // Single roster source: list_engineers is fetched once by useEngineerRoster
  // and shared here (and by useAttentionQueue) instead of one RPC per hook.
  const rosterQ = useEngineerRoster();

  const query = useQuery({
    queryKey: adminEngKeys.overview(),
    enabled: !rosterQ.isLoading,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{
      tickets: OverviewTicketRow[];
      days: DayRow[];
      warnings: AdminWarning[];
    }> => {
      const warnings: AdminWarning[] = [];
      let tickets: OverviewTicketRow[] = [];
      let days: DayRow[] = [];

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tickets pending generated types
        const { data, error } = await (supabase as any)
          .from("tickets")
          .select("id, assigned_employee_id, status")
          .eq("is_deleted", false)
          .limit(2000);
        if (error) throw error;
        tickets = Array.isArray(data) ? (data as OverviewTicketRow[]) : [];
        if (tickets.length === 2000) {
          warnings.push({ section: "tickets", message: "large dataset truncated — refine filters" });
        }
      } catch (e) {
        warnings.push({ section: "tickets", message: hintFor(e, "20260925000001") });
        tickets = [];
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_daily_logs")
          .select("log_date, morning_odometer, evening_odometer")
          .gte("log_date", monthStart)
          .lte("log_date", today)
          .order("log_date", { ascending: true })
          .limit(5000);
        if (error) throw error;
        days = Array.isArray(data) ? (data as DayRow[]) : [];
        if (days.length === 5000) {
          warnings.push({ section: "days", message: "large dataset truncated — refine filters" });
        }
      } catch (e) {
        warnings.push({ section: "days", message: hintFor(e, "20260925000001") });
        days = [];
      }

      return { tickets, days, warnings };
    },
  });

  const tickets = query.data?.tickets ?? [];
  const days = query.data?.days ?? [];
  return {
    data: { roster: rosterQ.roster, kpis: rosterKpis(rosterQ.roster, tickets, days, today) },
    warnings: [...rosterQ.warnings, ...(query.data?.warnings ?? [])],
    isLoading: rosterQ.isLoading || query.isLoading,
  };
}

/** One engineer's tickets (newest first, max 500) — or all assigned
 *  tickets across the roster when employeeId is null (newest first,
 *  max 1000). Same return shape either way; empty results never warn. */
export function useEngineerTickets(employeeId: string | null): {
  data: TicketRow[];
  warnings: AdminWarning[];
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: adminEngKeys.tickets(employeeId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{ rows: TicketRow[]; warnings: AdminWarning[] }> => {
      const warnings: AdminWarning[] = [];
      try {
        if (employeeId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tickets pending generated types
          const { data, error } = await (supabase as any)
            .from("tickets")
            .select("id, case_id, status, created_at, closed_at, customer_name, product, serial_no, assigned_employee_id, assigned_engineer_name")
            .eq("assigned_employee_id", employeeId)
            .is("is_deleted", false)
            .order("created_at", { ascending: false })
            .limit(500);
          if (error) throw error;
          return { rows: Array.isArray(data) ? (data as TicketRow[]) : [], warnings };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tickets pending generated types
        const { data, error } = await (supabase as any)
          .from("tickets")
          .select("id, case_id, status, created_at, closed_at, customer_name, product, serial_no, assigned_employee_id, assigned_engineer_name")
          .eq("is_deleted", false)
          .not("assigned_employee_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1000);
        if (error) throw error;
        const rows = Array.isArray(data) ? (data as TicketRow[]) : [];
        if (rows.length === 1000) {
          warnings.push({ section: "tickets", message: "large dataset truncated — refine filters" });
        }
        return { rows, warnings };
      } catch (e) {
        warnings.push({ section: "tickets", message: hintFor(e, "20260925000001") });
        return { rows: [], warnings };
      }
    },
  });

  return {
    data: query.data?.rows ?? [],
    warnings: query.data?.warnings ?? [],
    isLoading: query.isLoading,
  };
}

/** One engineer's IST-window conveyance: logs + expenses + rates + matrix. */
export function useEngineerConveyance(
  employeeId: string | null,
  from: string,
  to: string,
): {
  data: {
    window: { from: string; to: string };
    matrix: ConveyanceMatrixRow[];
    days: DayRow[];
    expenses: ExpenseRow[];
    rates: AdminRate[];
  };
  warnings: AdminWarning[];
  isLoading: boolean;
} {
  const window = payableWindow(from, to);

  const query = useQuery({
    queryKey: adminEngKeys.conveyance(employeeId, window.from, window.to),
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

  const days = query.data?.days ?? [];
  return {
    data: {
      window,
      matrix: conveyanceMatrix(days),
      days,
      expenses: query.data?.expenses ?? [],
      rates: query.data?.rates ?? [],
    },
    warnings: query.data?.warnings ?? [],
    isLoading: !!employeeId && query.isLoading,
  };
}

/** One employee's profile documents + 6-block compliance. */
export function useEmployeeDocuments(employeeId: string | null): {
  data: {
    docs: { name: string; path: string; uploaded_at: string }[];
    compliance: { present: string[]; missing: string[] };
  };
  warnings: AdminWarning[];
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: adminEngKeys.documents(employeeId),
    enabled: !!employeeId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{
      docs: { name: string; path: string; uploaded_at: string }[];
      warnings: AdminWarning[];
    }> => {
      const warnings: AdminWarning[] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- employees.documents pending generated types
        const { data, error } = await (supabase as any)
          .from("employees")
          .select("id, documents")
          .eq("id", employeeId!)
          .maybeSingle();
        if (error) throw error;
        return { docs: asEmployeeDocuments((data as DocRow | null)?.documents), warnings };
      } catch (e) {
        warnings.push({ section: "documents", message: hintFor(e, "20260925000001") });
        return { docs: [], warnings };
      }
    },
  });

  const docs = query.data?.docs ?? [];
  return {
    data: { docs, compliance: docCompliance(docs) },
    warnings: query.data?.warnings ?? [],
    isLoading: !!employeeId && query.isLoading,
  };
}

/** Custody ledger: all holdings (null) or one engineer's. */
export function useEngineerCustody(employeeId: string | null): {
  data: CustodyLedgerRow[];
  warnings: AdminWarning[];
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: adminEngKeys.custody(employeeId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{ rows: CustodyLedgerRow[]; warnings: AdminWarning[] }> => {
      const warnings: AdminWarning[] = [];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin_stock_custody() pending generated types
        const { data, error } = await (supabase as any).rpc("admin_stock_custody", {
          _employee_id: employeeId ?? null,
        });
        if (error) throw error;
        return {
          rows: custodyLedger((Array.isArray(data) ? data : []) as CustodyRpcRow[]),
          warnings,
        };
      } catch (e) {
        warnings.push({ section: "custody", message: hintFor(e, "20260925000002") });
        return { rows: [], warnings };
      }
    },
  });

  return {
    data: query.data?.rows ?? [],
    warnings: query.data?.warnings ?? [],
    isLoading: query.isLoading,
  };
}

/**
 * Cross-engineer attention queue: roster + per-engineer month inputs
 * composed via perEngineerSummary, flattened via attentionQueue. Latest
 * overlapping settlement wins per engineer; expenses are read for the IST
 * month window so missing-receipt can fire per engineer.
 */
export function useAttentionQueue(): {
  data: AttentionQueueItem[];
  warnings: AdminWarning[];
  isLoading: boolean;
} {
  const today = istDateKey();
  const monthStart = `${today.slice(0, 7)}-01`;

  // Roster comes from the shared useEngineerRoster() cache (see
  // useEngineerOverview) — no second list_engineers RPC.
  const rosterQ = useEngineerRoster();

  const query = useQuery({
    queryKey: adminEngKeys.attention(),
    enabled: !rosterQ.isLoading,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{ items: AttentionQueueItem[]; warnings: AdminWarning[] }> => {
      const warnings: AdminWarning[] = [];
      let tickets: (OverviewTicketRow & { closed_at: string | null })[] = [];
      let logs: AllLogRow[] = [];
      let rates: AllRateRow[] = [];
      let expenses: AllExpenseRow[] = [];
      let docRows: DocRow[] = [];
      let settlements: SettlementRow[] = [];

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tickets pending generated types
        const { data, error } = await (supabase as any)
          .from("tickets")
          .select("id, assigned_employee_id, status, closed_at")
          .eq("is_deleted", false)
          .limit(2000);
        if (error) throw error;
        tickets = Array.isArray(data)
          ? (data as (OverviewTicketRow & { closed_at: string | null })[])
          : [];
        if (tickets.length === 2000) {
          warnings.push({ section: "tickets", message: "large dataset truncated — refine filters" });
        }
      } catch (e) {
        warnings.push({ section: "tickets", message: hintFor(e, "20260925000001") });
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_daily_logs")
          .select("employee_id, log_date, morning_odometer, evening_odometer")
          .gte("log_date", monthStart)
          .lte("log_date", today)
          .order("log_date", { ascending: true })
          .limit(5000);
        if (error) throw error;
        logs = Array.isArray(data) ? (data as AllLogRow[]) : [];
        if (logs.length === 5000) {
          warnings.push({ section: "days", message: "large dataset truncated — refine filters" });
        }
      } catch (e) {
        warnings.push({ section: "days", message: hintFor(e, "20260925000001") });
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_rates")
          .select("employee_id, rate_per_km, effective_from")
          .lte("effective_from", today)
          .order("effective_from", { ascending: true })
          .limit(2000);
        if (error) throw error;
        rates = Array.isArray(data) ? (data as AllRateRow[]) : [];
        if (rates.length === 2000) {
          warnings.push({ section: "rates", message: "large dataset truncated — refine filters" });
        }
      } catch (e) {
        warnings.push({ section: "rates", message: hintFor(e, "20260925000001") });
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_expenses")
          .select("employee_id, expense_date, charge_type, amount, receipt_path")
          .gte("expense_date", monthStart)
          .lte("expense_date", today)
          .order("expense_date", { ascending: true })
          .limit(2000);
        if (error) throw error;
        expenses = Array.isArray(data) ? (data as AllExpenseRow[]) : [];
        if (expenses.length === 2000) {
          warnings.push({ section: "expenses", message: "large dataset truncated — refine filters" });
        }
      } catch (e) {
        warnings.push({ section: "expenses", message: hintFor(e, "20260925000001") });
        expenses = [];
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- employees.documents pending generated types
        const { data, error } = await (supabase as any)
          .from("employees")
          .select("id, documents")
          .limit(2000);
        if (error) throw error;
        docRows = Array.isArray(data) ? (data as DocRow[]) : [];
        if (docRows.length === 2000) {
          warnings.push({ section: "documents", message: "large dataset truncated — refine filters" });
        }
      } catch (e) {
        warnings.push({ section: "documents", message: hintFor(e, "20260925000001") });
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_settlements")
          .select("employee_id, period_start, period_end, status")
          .lte("period_start", today)
          .gte("period_end", monthStart)
          .order("period_end", { ascending: true });
        if (error) throw error;
        settlements = Array.isArray(data) ? (data as SettlementRow[]) : [];
      } catch (e) {
        warnings.push({ section: "settlements", message: hintFor(e, "20260925000001") });
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin_stock_custody() pending generated types
        // Custody rows are consumed by the Custody tab via useEngineerCustody;
        // here the RPC acts as a health probe so custody failures still warn.
        const { error } = await (supabase as any).rpc("admin_stock_custody", {
          _employee_id: null,
        });
        if (error) throw error;
      } catch (e) {
        warnings.push({ section: "custody", message: hintFor(e, "20260925000002") });
      }

      const docsById = new Map<string, DocRow["documents"]>();
      for (const d of docRows) {
        if (d && typeof d.id === "string") docsById.set(d.id, d.documents);
      }
      // Latest overlapping settlement per engineer wins (period_end max).
      const settlementById = new Map<string, SettlementRow>();
      for (const s of settlements) {
        if (!s || typeof s.employee_id !== "string") continue;
        const prev = settlementById.get(s.employee_id);
        if (!prev || (s.period_end ?? "") > (prev.period_end ?? "")) {
          settlementById.set(s.employee_id, s);
        }
      }

      const summaries = rosterQ.roster
        .filter((r) => !!r && typeof r.employee_id === "string" && r.employee_id !== "")
        .map((r) =>
          perEngineerSummary({
            engineer: r,
            rates: rates.filter((x) => !!x && x.employee_id === r.employee_id),
            days: logs.filter((x) => !!x && x.employee_id === r.employee_id),
            expenses: expenses.filter((x) => !!x && x.employee_id === r.employee_id),
            docs: asEmployeeDocuments(docsById.get(r.employee_id)),
            settlement: settlementById.get(r.employee_id) ?? null,
            tickets: tickets
              .filter((t) => !!t && t.assigned_employee_id === r.employee_id)
              .map((t) => ({ status: t.status, closed_at: t.closed_at })),
            todayISO: today,
          }),
        );
      return { items: attentionQueue(summaries), warnings };
    },
  });

  return {
    data: query.data?.items ?? [],
    warnings: [...rosterQ.warnings, ...(query.data?.warnings ?? [])],
    isLoading: rosterQ.isLoading || query.isLoading,
  };
}
