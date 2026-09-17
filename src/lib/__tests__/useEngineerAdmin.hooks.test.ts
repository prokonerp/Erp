// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import {
  useAttentionQueue,
  useEmployeeDocuments,
  useEngineerConveyance,
  useEngineerTickets,
} from "@/hooks/useEngineerAdmin";

const mocks = vi.hoisted(() => {
  const payloads: Record<string, { data: unknown; error: unknown }> = {};
  const limit = vi.fn();
  const eq = vi.fn();
  const not = vi.fn();
  const is = vi.fn();
  const lt = vi.fn();
  const neq = vi.fn();
  const or = vi.fn();
  const gte = vi.fn();
  const lte = vi.fn();
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.eq = vi.fn((...args: never[]) => {
      (eq as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.is = vi.fn((...args: never[]) => {
      (is as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.not = vi.fn((...args: never[]) => {
      (not as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.order = vi.fn(() => b);
    b.limit = vi.fn((...args: never[]) => {
      (limit as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.gte = vi.fn((...args: never[]) => {
      (gte as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.lte = vi.fn((...args: never[]) => {
      (lte as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.lt = vi.fn((...args: never[]) => {
      (lt as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.neq = vi.fn((...args: never[]) => {
      (neq as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.or = vi.fn((...args: never[]) => {
      (or as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.maybeSingle = vi.fn(() => b);
    b.single = vi.fn(() => b);
    b.then = (
      resolve?: (v: { data: unknown; error: unknown }) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(payloads[table] ?? { data: [], error: null }).then(resolve, reject);
    return b;
  }
  const from = vi.fn((table: string) => builder(table));
  const rpc = vi.fn(() => builder("__rpc__"));
  return {
    payloads,
    limit,
    eq,
    not,
    is,
    lt,
    neq,
    or,
    gte,
    lte,
    from,
    rpc,
    setPayload(table: string, data: unknown, error: unknown = null) {
      payloads[table] = { data, error };
    },
    clearPayloads() {
      for (const k of Object.keys(payloads)) delete payloads[k];
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

const ticket = (id: string) => ({
  id,
  case_id: `C-${id}`,
  status: "open",
  created_at: "2026-09-01T00:00:00Z",
  closed_at: null,
  customer_name: "Acme",
  product: "Pump",
  serial_no: "S1",
  assigned_employee_id: "e1",
  assigned_engineer_name: "Aarav",
});

beforeEach(() => {
  mocks.clearPayloads();
  vi.clearAllMocks();
});

describe("enabled-flag guards (null id)", () => {
  it("useEngineerConveyance(null) never touches supabase, returns empty data + isLoading false", () => {
    const { result } = renderHook(() => useEngineerConveyance(null, "2026-09-01", "2026-09-30"), {
      wrapper: createWrapper(),
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data.days).toEqual([]);
    expect(result.current.data.expenses).toEqual([]);
    expect(result.current.warnings).toEqual([]);
  });

  it("useEmployeeDocuments(null) never touches supabase, returns empty docs + isLoading false", () => {
    const { result } = renderHook(() => useEmployeeDocuments(null), { wrapper: createWrapper() });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data.docs).toEqual([]);
    expect(result.current.warnings).toEqual([]);
  });
});

describe("useEngineerTickets all-mode (null)", () => {
  it("calls from('tickets') with limit(1000) and returns rows", async () => {
    mocks.setPayload("tickets", [ticket("t1"), ticket("t2")]);
    const { result } = renderHook(() => useEngineerTickets(null), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(mocks.from).toHaveBeenCalledWith("tickets");
    expect(mocks.limit).toHaveBeenCalledWith(1000);
    expect(result.current.warnings).toEqual([]);
  });

  it("pushes the truncation warning at exactly 1000 rows", async () => {
    mocks.setPayload(
      "tickets",
      Array.from({ length: 1000 }, (_, i) => ticket(`t${i}`)),
    );
    const { result } = renderHook(() => useEngineerTickets(null), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1000));
    expect(result.current.warnings).toHaveLength(1);
    expect(result.current.warnings[0].section).toBe("tickets");
    expect(result.current.warnings[0].message).toMatch(/truncat/i);
  });

  it("emits no warning at 999 rows", async () => {
    mocks.setPayload(
      "tickets",
      Array.from({ length: 999 }, (_, i) => ticket(`t${i}`)),
    );
    const { result } = renderHook(() => useEngineerTickets(null), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(999));
    expect(result.current.warnings).toEqual([]);
  });
});

describe("useEngineerTickets per-id mode", () => {
  it("uses limit(500) + eq on the employee id", async () => {
    mocks.setPayload("tickets", [ticket("t1")]);
    const { result } = renderHook(() => useEngineerTickets("e1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(mocks.from).toHaveBeenCalledWith("tickets");
    expect(mocks.limit).toHaveBeenCalledWith(500);
    expect(mocks.eq).toHaveBeenCalledWith("assigned_employee_id", "e1");
  });
});

describe("error path", () => {
  it("surfaces a warnings entry without throwing", async () => {
    mocks.setPayload("tickets", null, { message: "boom" });
    const { result } = renderHook(() => useEngineerTickets("e1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.warnings).toHaveLength(1));
    expect(result.current.data).toEqual([]);
    expect(result.current.warnings[0].section).toBe("tickets");
    expect(result.current.warnings[0].message).toMatch(/boom/);
  });
});

describe("BUG1: legacy name-only tickets are included in the admin queue", () => {
  it("all-tickets query has no assigned_employee_id exclusion (null-FK rows included)", async () => {
    mocks.setPayload("tickets", [
      ticket("t1"),
      {
        id: "t-legacy",
        case_id: "C-legacy",
        status: "open",
        created_at: "2026-08-01T00:00:00Z",
        closed_at: null,
        customer_name: "Legacy Co",
        product: "Pump",
        serial_no: "S9",
        assigned_employee_id: null,
        assigned_engineer_name: "Legacy Name",
      },
    ]);
    const { result } = renderHook(() => useEngineerTickets(null), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(mocks.from).toHaveBeenCalledWith("tickets");
    expect(mocks.eq).toHaveBeenCalledWith("is_deleted", false);
    expect(mocks.not).not.toHaveBeenCalledWith("assigned_employee_id", "is", null);
    // Legacy row survives the query layer (no FK exclusion filtering it out).
    expect(result.current.data.some((t) => t.assigned_employee_id === null)).toBe(true);
  });

  it("per-id mode filters is_deleted via eq (consistent with sibling queries)", async () => {
    mocks.setPayload("tickets", [ticket("t1")]);
    const { result } = renderHook(() => useEngineerTickets("e1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(mocks.eq).toHaveBeenCalledWith("is_deleted", false);
    expect(mocks.is).not.toHaveBeenCalledWith("is_deleted", false);
  });
});

describe("BUG2: attention settlements include pre-month unsettled rows", () => {
  it("fetches legacy unsettled settlements (period_end < monthStart, not Approved, paid_at null) and fires unapproved-past-cutoff", async () => {
    mocks.setPayload("__rpc__", [
      {
        employee_id: "e1",
        name: "Aarav",
        phone: null,
        email: null,
        active: true,
        auth_user_id: null,
        photo_path: null,
      },
    ]);
    mocks.setPayload("tickets", []);
    mocks.setPayload("engineer_daily_logs", []);
    mocks.setPayload("engineer_conveyance_rates", []);
    mocks.setPayload("engineer_conveyance_expenses", []);
    mocks.setPayload("employees", []);
    mocks.setPayload("engineer_conveyance_settlements", [
      {
        employee_id: "e1",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        status: "Pending",
        paid_at: null,
      },
    ]);
    const { result } = renderHook(() => useAttentionQueue(), { wrapper: createWrapper() });
    await waitFor(() =>
      expect(result.current.data.some((i) => i.key === "unapproved-past-cutoff")).toBe(true),
    );
    const calls = mocks.from.mock.calls.filter(
      (c) => (c as unknown[])[0] === "engineer_conveyance_settlements",
    );
    // Widened fetch: current-window query + legacy unsettled query merged.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.lt).toHaveBeenCalledWith("period_end", expect.any(String));
    expect(mocks.neq).toHaveBeenCalledWith("status", "Approved");
    expect(mocks.is).toHaveBeenCalledWith("paid_at", null);
    expect(result.current.data.find((i) => i.key === "unapproved-past-cutoff")).toMatchObject({
      employeeId: "e1",
      severity: "high",
    });
  });
});
