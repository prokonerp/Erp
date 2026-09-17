// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import {
  useEmployeeDocuments,
  useEngineerConveyance,
  useEngineerTickets,
} from "@/hooks/useEngineerAdmin";

const mocks = vi.hoisted(() => {
  const payloads: Record<string, { data: unknown; error: unknown }> = {};
  const limit = vi.fn();
  const eq = vi.fn();
  const not = vi.fn();
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.eq = vi.fn((...args: never[]) => {
      (eq as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.is = vi.fn(() => b);
    b.not = vi.fn((...args: never[]) => {
      (not as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.order = vi.fn(() => b);
    b.limit = vi.fn((...args: never[]) => {
      (limit as (...a: never[]) => unknown)(...args);
      return b;
    });
    b.gte = vi.fn(() => b);
    b.lte = vi.fn(() => b);
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

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
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
    mocks.setPayload("tickets", Array.from({ length: 1000 }, (_, i) => ticket(`t${i}`)));
    const { result } = renderHook(() => useEngineerTickets(null), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1000));
    expect(result.current.warnings).toHaveLength(1);
    expect(result.current.warnings[0].section).toBe("tickets");
    expect(result.current.warnings[0].message).toMatch(/truncat/i);
  });

  it("emits no warning at 999 rows", async () => {
    mocks.setPayload("tickets", Array.from({ length: 999 }, (_, i) => ticket(`t${i}`)));
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
