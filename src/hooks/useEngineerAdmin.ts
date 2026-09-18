import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys } from "@/lib/queryKeys";
import { istDateKey } from "@/lib/time";
import { asEmployeeDocuments } from "@/lib/engineer-conveyance";
import {
  attentionQueue,
  conveyanceDayRows,
  conveyanceMatrix,
  custodyLedger,
  docCompliance,
  normalizeSerial,
  payableWindow,
  perEngineerSummary,
  rosterKpis,
  stagedTicketParts,
  type AdminEngineer,
  type AdminRate,
  type AdminWarning,
  type AttentionQueueItem,
  type ConveyanceDayInputDay,
  type ConveyanceDayPlace,
  type ConveyanceDayRow,
  type ConveyanceMatrixRow,
  type CustodyLedgerRow,
  type RosterKpis,
  type StagedPartRow,
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
  /** Reading photos + day-review state (migration 20260927000001 adds the
   *  admin_* columns; absent on older DBs — always read tolerantly). */
  morning_photo_path?: string | null;
  evening_photo_path?: string | null;
  admin_status?: string | null;
  admin_remarks?: string | null;
};

type PlaceVisitRow = {
  employee_id: string | null;
  visited_at: string | null;
  note: string | null;
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
  paid_at?: string | null;
  locked_at?: string | null;
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

/** Shift a YYYY-MM-DD calendar key by N days (UTC date math, key output). */
function shiftDay(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return iso;
  return new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000).toISOString().slice(0, 10);
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
          .select("*")
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

export type PayablesAllGroup = {
  employeeId: string;
  rows: ConveyanceDayRow[];
  totals: {
    days: number;
    km: number;
    conveyance: number;
    charges: number;
    total: number;
    flagged: number;
  };
};

/**
 * All engineers' IST-window conveyance in four reads, grouped client-side
 * by employee. Only engineers with at least one log/expense/visit in the
 * window appear. Same fail-soft contract as the single-engineer hooks.
 */
export function useEngineerPayablesAll(input: { from: string; to: string; enabled?: boolean }) {
  const window = payableWindow(input.from, input.to);

  const query = useQuery({
    queryKey: adminEngKeys.payablesAll(window.from, window.to),
    enabled: input.enabled !== false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{ groups: PayablesAllGroup[]; warnings: AdminWarning[] }> => {
      const warnings: AdminWarning[] = [];
      let days: AllLogRow[] = [];
      let expenses: AllExpenseRow[] = [];
      let rates: AdminRate[] = [];
      let visits: PlaceVisitRow[] = [];

      try {
        // select("*") tolerates the admin_* review columns pre-migration.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_daily_logs")
          .select("*")
          .gte("log_date", window.from)
          .lte("log_date", window.to)
          .order("employee_id", { ascending: true })
          .order("log_date", { ascending: true });
        if (error) throw error;
        days = Array.isArray(data) ? (data as AllLogRow[]) : [];
      } catch (e) {
        warnings.push({ section: "all-days", message: hintFor(e, "20260925000001") });
        days = [];
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_expenses")
          .select("employee_id, expense_date, charge_type, amount, receipt_path")
          .gte("expense_date", window.from)
          .lte("expense_date", window.to)
          .order("employee_id", { ascending: true })
          .order("expense_date", { ascending: true });
        if (error) throw error;
        expenses = Array.isArray(data) ? (data as AllExpenseRow[]) : [];
      } catch (e) {
        warnings.push({ section: "all-expenses", message: hintFor(e, "20260925000001") });
        expenses = [];
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_rates")
          .select("employee_id, rate_per_km, effective_from")
          .lte("effective_from", window.to)
          .order("employee_id", { ascending: true })
          .order("effective_from", { ascending: true });
        if (error) throw error;
        rates = Array.isArray(data) ? (data as AdminRate[]) : [];
      } catch (e) {
        warnings.push({ section: "all-rates", message: hintFor(e, "20260925000001") });
        rates = [];
      }

      try {
        // ±1-day widened window; IST-grouped client-side (see shiftDay).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- place visits pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_place_visits")
          .select("employee_id, visited_at, note")
          .gte("visited_at", shiftDay(window.from, -1))
          .lte("visited_at", shiftDay(window.to, 1))
          .order("employee_id", { ascending: true })
          .order("visited_at", { ascending: true });
        if (error) throw error;
        visits = Array.isArray(data) ? (data as PlaceVisitRow[]) : [];
      } catch (e) {
        warnings.push({ section: "all-place-visits", message: hintFor(e, "20260926000001") });
        visits = [];
      }

      const byEmp = new Map<
        string,
        { days: AllLogRow[]; expenses: AllExpenseRow[]; visits: PlaceVisitRow[] }
      >();
      const bucket = (id: unknown) => {
        if (typeof id !== "string" || id === "") return null;
        let b = byEmp.get(id);
        if (!b) {
          b = { days: [], expenses: [], visits: [] };
          byEmp.set(id, b);
        }
        return b;
      };
      for (const d of days) {
        const b = bucket((d as { employee_id?: unknown }).employee_id);
        if (b) b.days.push(d);
      }
      for (const e of expenses) {
        const b = bucket((e as { employee_id?: unknown }).employee_id);
        if (b) b.expenses.push(e);
      }
      for (const v of visits) {
        const b = bucket(v.employee_id);
        if (b) b.visits.push(v);
      }

      const r2 = (n: number) => Math.round(n * 100) / 100;
      const groups: PayablesAllGroup[] = [];
      for (const [employeeId, b] of byEmp) {
        if (b.days.length === 0 && b.expenses.length === 0 && b.visits.length === 0) continue;
        const rows = conveyanceDayRows({
          employeeId,
          rates,
          days: b.days,
          expenses: b.expenses,
          placeVisits: b.visits,
        });
        groups.push({
          employeeId,
          rows,
          totals: {
            days: rows.length,
            km: r2(rows.reduce((s, r) => s + (r.km ?? 0), 0)),
            conveyance: r2(rows.reduce((s, r) => s + r.conveyanceAmount, 0)),
            charges: r2(rows.reduce((s, r) => s + r.charges, 0)),
            total: r2(rows.reduce((s, r) => s + r.total, 0)),
            flagged: rows.filter((r) => r.flags.length > 0 || r.adminStatus === "Flagged").length,
          },
        });
      }
      groups.sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1));
      return { groups, warnings };
    },
  });

  return {
    groups: query.data?.groups ?? [],
    window,
    warnings: query.data?.warnings ?? [],
    isLoading: query.isLoading,
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
          .select("employee_id, period_start, period_end, status, paid_at, locked_at")
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
          warnings.push({
            section: "tickets",
            message: "large dataset truncated — refine filters",
          });
        }
      } catch (e) {
        warnings.push({ section: "tickets", message: hintFor(e, "20260925000001") });
        tickets = [];
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_daily_logs")
          .select("*")
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
            .select(
              "id, case_id, status, created_at, closed_at, customer_name, product, serial_no, assigned_employee_id, assigned_engineer_name",
            )
            .eq("assigned_employee_id", employeeId)
            .eq("is_deleted", false)
            .order("created_at", { ascending: false })
            .limit(500);
          if (error) throw error;
          return { rows: Array.isArray(data) ? (data as TicketRow[]) : [], warnings };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tickets pending generated types
        const { data, error } = await (supabase as any)
          .from("tickets")
          .select(
            "id, case_id, status, created_at, closed_at, customer_name, product, serial_no, assigned_employee_id, assigned_engineer_name",
          )
          .eq("is_deleted", false)
          .order("created_at", { ascending: false })
          .limit(1000);
        if (error) throw error;
        const rows = Array.isArray(data) ? (data as TicketRow[]) : [];
        if (rows.length === 1000) {
          warnings.push({
            section: "tickets",
            message: "large dataset truncated — refine filters",
          });
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

/** One engineer's IST-window conveyance: logs + expenses + rates + place visits + day rows. */
export function useEngineerConveyance(
  employeeId: string | null,
  from: string,
  to: string,
): {
  data: {
    window: { from: string; to: string };
    matrix: ConveyanceMatrixRow[];
    rows: ConveyanceDayRow[];
    days: DayRow[];
    expenses: ExpenseRow[];
    rates: AdminRate[];
    placeVisits: PlaceVisitRow[];
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
      placeVisits: PlaceVisitRow[];
      warnings: AdminWarning[];
    }> => {
      const warnings: AdminWarning[] = [];
      let days: DayRow[] = [];
      let expenses: ExpenseRow[] = [];
      let rates: AdminRate[] = [];
      let placeVisits: PlaceVisitRow[] = [];

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_daily_logs")
          .select("*")
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

      try {
        // Place visits are IST-grouped client-side, so read a ±1-day
        // widened window (a 00:30 IST visit is the previous UTC day).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- place visits pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_place_visits")
          .select("employee_id, visited_at, note")
          .eq("employee_id", employeeId!)
          .gte("visited_at", shiftDay(window.from, -1))
          .lte("visited_at", shiftDay(window.to, 1))
          .order("visited_at", { ascending: true });
        if (error) throw error;
        placeVisits = Array.isArray(data) ? (data as PlaceVisitRow[]) : [];
      } catch (e) {
        warnings.push({ section: "place-visits", message: hintFor(e, "20260926000001") });
        placeVisits = [];
      }

      return { days, expenses, rates, placeVisits, warnings };
    },
  });

  const days = query.data?.days ?? [];
  const expenses = query.data?.expenses ?? [];
  const rates = query.data?.rates ?? [];
  const placeVisits = query.data?.placeVisits ?? [];
  return {
    data: {
      window,
      matrix: conveyanceMatrix(days),
      rows: conveyanceDayRows({ employeeId, rates, days, expenses, placeVisits }),
      days,
      expenses,
      rates,
      placeVisits,
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

/** Custody ledger: all holdings (null) or one engineer's — plus staged ticket lines. */
export function useEngineerCustody(employeeId: string | null): {
  data: CustodyLedgerRow[];
  staged: StagedPartRow[];
  warnings: AdminWarning[];
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: adminEngKeys.custody(employeeId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{
      rows: CustodyLedgerRow[];
      staged: StagedPartRow[];
      warnings: AdminWarning[];
    }> => {
      const warnings: AdminWarning[] = [];
      let rows: CustodyLedgerRow[] = [];
      try {
        // Direct table read (no RPC): surfaces stock_type/part_name so good
        // vs defective is visible. Admin / ims.read RLS already allows it;
        // names resolve client-side via the roster (see the custody page).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ims_stock_items pending generated types
        let q = (supabase as any)
          .from("ims_stock_items")
          .select(
            "id, part_serial_no, part_name, stock_type, stock_status, ticket_id, custodian_employee_id, custodian_set_at",
          )
          .not("custodian_employee_id", "is", null)
          .not("stock_status", "in", '("returned_to_oem","scrapped")')
          .order("custodian_set_at", { ascending: false, nullsFirst: false });
        if (employeeId) q = q.eq("custodian_employee_id", employeeId);
        const { data, error } = await q;
        if (error) throw error;
        const shaped = (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
          stock_item_id: r.id,
          custodian_employee_id: r.custodian_employee_id,
          custodian_name: null,
          part_serial_no: r.part_serial_no,
          ticket_id: r.ticket_id,
          set_at: r.custodian_set_at,
          stock_type: r.stock_type,
          stock_status: r.stock_status,
          part_name: r.part_name,
        }));
        rows = custodyLedger(shaped);
      } catch (e) {
        warnings.push({ section: "custody", message: hintFor(e, "20260925000002") });
        rows = [];
      }

      let staged: StagedPartRow[] = [];
      try {
        // Staged ticket lines (open tickets): material the engineer holds
        // via the ticket that never became a custody row — unconfirmed FSR
        // lines, or confirmed lines whose serial matched no stock row.
        // Already-custodied serials are suppressed to avoid double counting.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tickets pending generated types
        let tq = (supabase as any)
          .from("tickets")
          .select(
            "id, case_id, status, assigned_employee_id, defective_parts_details, good_parts_details",
          )
          .eq("is_deleted", false)
          .not("status", "in", '("Closed","Cancelled")')
          .order("created_at", { ascending: false })
          .limit(employeeId ? 500 : 1000);
        if (employeeId) tq = tq.eq("assigned_employee_id", employeeId);
        const { data, error } = await tq;
        if (error) throw error;
        const all = stagedTicketParts(Array.isArray(data) ? data : []);
        const held = new Set(
          rows
            .map((r) => normalizeSerial(r.part_serial_no))
            .filter((s): s is string => s !== null),
        );
        staged = all.filter((s) => s.serialKey === null || !held.has(s.serialKey));
        if (!employeeId && Array.isArray(data) && data.length >= 1000) {
          warnings.push({
            section: "staged",
            message: "large dataset truncated — refine filters",
          });
        }
      } catch (e) {
        warnings.push({ section: "staged", message: hintFor(e, "20260925000002") });
        staged = [];
      }
      return { rows, staged, warnings };
    },
  });

  return {
    data: query.data?.rows ?? [],
    staged: query.data?.staged ?? [],
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
          warnings.push({
            section: "tickets",
            message: "large dataset truncated — refine filters",
          });
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
          warnings.push({
            section: "expenses",
            message: "large dataset truncated — refine filters",
          });
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
          warnings.push({
            section: "documents",
            message: "large dataset truncated — refine filters",
          });
        }
      } catch (e) {
        warnings.push({ section: "documents", message: hintFor(e, "20260925000001") });
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_settlements")
          .select("employee_id, period_start, period_end, status, paid_at, locked_at")
          .lte("period_start", today)
          .gte("period_end", monthStart)
          .order("period_end", { ascending: true });
        if (error) throw error;
        settlements = Array.isArray(data) ? (data as SettlementRow[]) : [];
      } catch (e) {
        warnings.push({ section: "settlements", message: hintFor(e, "20260925000001") });
      }

      try {
        // Legacy unsettled fetch: pre-month rows that are not Approved and
        // unpaid would otherwise never load, so the unapproved-past-cutoff
        // warning could never fire for them. Merged into `settlements`;
        // the latest-per-engineer map below collapses duplicates.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data: legacyData, error: legacyError } = await (supabase as any)
          .from("engineer_conveyance_settlements")
          .select("employee_id, period_start, period_end, status, paid_at")
          .lt("period_end", monthStart)
          .neq("status", "Approved")
          .is("paid_at", null)
          .order("period_end", { ascending: true });
        if (legacyError) throw legacyError;
        if (Array.isArray(legacyData)) {
          settlements = [...settlements, ...(legacyData as SettlementRow[])];
        }
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
