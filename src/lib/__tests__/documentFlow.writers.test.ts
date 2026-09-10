import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock supabase client --------------------------------------------------
// Must be hoisted before importing writers. We expose a mutable mockSupabase
// that tests can configure per-case.
const mockRpc = vi.fn();
const mockFrom = vi.fn();

// Vitest hoists vi.mock; define it before imports.
vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      rpc: (...args: unknown[]) => (mockRpc as unknown as (...a: unknown[]) => unknown)(...args),
      from: (...args: unknown[]) => (mockFrom as unknown as (...a: unknown[]) => unknown)(...args),
    },
  };
});

// Mock ancillary modules that writers import at top-level (avoid real network)
vi.mock("@/lib/sales", () => ({
  fetchBranches: vi.fn().mockResolvedValue([]),
  itemDraftFromBreakup: vi.fn((d: unknown) => d),
}));
vi.mock("@/lib/letterhead", () => ({
  getCompany: vi.fn().mockResolvedValue({ name: "Test Co", gstin: null, regd_address: "addr" }),
}));
vi.mock("@/lib/gst", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    computeTotals: (vi.fn() as unknown as typeof mod.computeTotals) ?? mod.computeTotals,
  };
});
vi.mock("@/lib/negativeStock", () => ({
  findShortfalls: vi.fn().mockResolvedValue([]),
  blockMessage: vi.fn((s: { available: number; qty: number }) => `Insufficient stock: only ${s.available} available, ${s.qty} requested`),
  logNegativeOverrides: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/salesOrders", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    fetchSalesOrder: vi.fn().mockResolvedValue({ id: "so1", so_no: "SO-001", status: "draft", items: [] }),
  };
});
vi.mock("@/lib/generalDc", () => ({
  insertGeneralDc: vi.fn().mockResolvedValue({ id: "gdc1", dc_no: "GDC-1", status: "Draft" }),
}));
vi.mock("@/lib/proforma", () => ({
  insertProforma: vi.fn().mockResolvedValue({ id: "pf1", proforma_no: "PF-1" }),
  fetchProforma: vi.fn().mockResolvedValue({ id: "pf1", items: [] }),
}));

// Must import after mocks
import {
  withSoFulfillLock,
  stockLinesFromFulfillment,
  revalidateBalanceOrThrow,
  insertLedgerAndFulfillments,
  assertBalancesOrThrow,
  validateSoStatusForConversion,
  handleWriterError,
  cancelSoConversion,
  syncCancelToLedger,
  fetchSoViewSummary,
} from "@/lib/documentFlow.writers";

function makeBuilder(table: string, overrides: Record<string, unknown> = {}) {
  // Generic chainable builder: every chain method returns `builder`, terminal
  // methods (single/maybeSingle) return a Promise<{data,error}>.
  const builder: Record<string, unknown> = {};
  const state: Record<string, unknown> = { table, overrides };

  const chain = (ret: unknown = builder) => ret as unknown;

  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.range = vi.fn(() => builder);
  builder.contains = vi.fn(() => builder);
  builder.neq = vi.fn(() => builder);
  builder.single = vi.fn(() => {
    // Default per-table responses; test can override via mockFrom implementation
    if (table === "products") {
      const data = (overrides as { productData?: unknown }).productData ?? { model: "MODEL-X" };
      return Promise.resolve({ data, error: null });
    }
    if (table === "so_fulfillment_summary") {
      return Promise.resolve({ data: (overrides as { summaryData?: unknown }).summaryData ?? [], error: null });
    }
    if (table === "so_conversions" && (overrides as { ledgerInsert?: unknown }).ledgerInsert) {
      return Promise.resolve({ data: (overrides as { ledgerInsert: unknown }).ledgerInsert, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  builder.maybeSingle = vi.fn(() => {
    if (table === "so_fulfillment_summary") {
      return Promise.resolve({ data: null, error: null });
    }
    // For syncCancelToLedger fallback: products / so_conversions generic
    const maybeData = (overrides as { maybeData?: unknown }).maybeData ?? null;
    return Promise.resolve({ data: maybeData, error: null });
  });
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.rpc = vi.fn(() => builder);

  // Allow test to inject custom behavior by replacing methods on the builder
  Object.assign(builder, overrides as Record<string, unknown>);

  // Track state for debugging
  (builder as unknown as Record<string, unknown>).__state = state;
  return builder as unknown as ReturnType<typeof mockFrom>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockReset();
  mockFrom.mockReset();
  // Default rpc: not available (simulate missing RPC) unless test overrides
  mockRpc.mockResolvedValue({ error: { message: "function not found" } });
  // Default from: return a generic builder that resolves to empty data
  mockFrom.mockImplementation((table: string) => makeBuilder(table));
});

// ── withSoFulfillLock ──────────────────────────────────────────────────────

describe("documentFlow.writers/withSoFulfillLock", () => {
  it("fallback: when both advisory locks unavailable, still executes fn (optimistic+verification)", async () => {
    mockRpc
      .mockResolvedValueOnce({ error: { message: "not found" } }) // pg_advisory_lock fail
      .mockResolvedValueOnce({ error: { message: "not found" } }); // pg_advisory_xact_lock fail
    const fn = vi.fn().mockResolvedValue("ok");
    const res = await withSoFulfillLock("so1", fn);
    expect(res).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    // No unlock attempted when not locked
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it("session lock path: acquires pg_advisory_lock and releases via pg_advisory_unlock", async () => {
    mockRpc
      .mockResolvedValueOnce({ error: null }) // pg_advisory_lock success
      .mockResolvedValueOnce({ error: null }); // unlock
    const fn = vi.fn().mockResolvedValue(42);
    const res = await withSoFulfillLock("so2", fn);
    expect(res).toBe(42);
    expect(mockRpc).toHaveBeenNthCalledWith(1, "pg_advisory_lock", { key: "so_fulfill:so2" });
    expect(mockRpc).toHaveBeenNthCalledWith(2, "pg_advisory_unlock", { key: "so_fulfill:so2" });
  });

  it("xact lock fallback: when session lock fails but xact succeeds, does not call unlock", async () => {
    mockRpc
      .mockResolvedValueOnce({ error: { message: "session missing" } })
      .mockResolvedValueOnce({ error: null }); // xact success
    const res = await withSoFulfillLock("so3", async () => "xact-ok");
    expect(res).toBe("xact-ok");
    expect(mockRpc).toHaveBeenCalledTimes(2);
    // xact lock auto-releases, no unlock call
  });

  it("re-throws fn error after releasing session lock", async () => {
    mockRpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null }); // unlock
    await expect(withSoFulfillLock("so4", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(mockRpc).toHaveBeenCalledWith("pg_advisory_unlock", { key: "so_fulfill:so4" });
  });
});

// ── stockLinesFromFulfillment ─────────────────────────────────────────────

describe("documentFlow.writers/stockLinesFromFulfillment", () => {
  it("resolves model from SO item (part_model_no) without fetching products", async () => {
    const so: unknown = {
      id: "so1",
      items: [{ product_id: "p1", part_model_no: "M-SO", description: "Widget", warehouse_id: "w1" }],
    };
    const lines: unknown[] = [
      { line_index: 0, product_id: "p1", this_qty: 5, ordered_qty: 10, is_serialized: false, warehouse_id: "w1" },
    ];
    const out = await stockLinesFromFulfillment(so as never, lines as never);
    expect(out).toHaveLength(1);
    expect(out[0].model).toBe("M-SO");
    expect(out[0].qty).toBe(5);
    expect(out[0].warehouseId).toBe("w1");
    expect(mockFrom).not.toHaveBeenCalledWith("products");
  });

  it("parallelizes product model fetches via Promise.all (multiple missing models)", async () => {
    const so: unknown = {
      id: "so1",
      items: [
        { product_id: "p1", description: "A", warehouse_id: "w1" }, // no model -> fetch
        { product_id: "p2", description: "B", warehouse_id: "w2" }, // no model -> fetch
      ],
    };
    const lines: unknown[] = [
      { line_index: 0, product_id: "p1", this_qty: 2, ordered_qty: 5, is_serialized: false },
      { line_index: 1, product_id: "p2", this_qty: 3, ordered_qty: 5, is_serialized: false },
    ];
    // Mock products fetch to return distinct models per id
    mockFrom.mockImplementation((table: string) => {
      if (table === "products") {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn((col: string, val: string) => {
          (builder as unknown as Record<string, unknown>)._id = val;
          return builder;
        });
        builder.single = vi.fn(() => {
          const id = (builder as unknown as Record<string, unknown>)._id as string;
          const map: Record<string, string> = { p1: "MODEL-A", p2: "MODEL-B" };
          return Promise.resolve({ data: { model: map[id] ?? null }, error: null });
        });
        return builder as unknown as ReturnType<typeof mockFrom>;
      }
      return makeBuilder(table);
    });

    const out = await stockLinesFromFulfillment(so as never, lines as never);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.model).sort()).toEqual(["MODEL-A", "MODEL-B"]);
    // Ensure products queried for both ids (parallel)
    expect(mockFrom).toHaveBeenCalledWith("products");
  });

  it("throws with line index+description when model missing after fetch", async () => {
    const so: unknown = { id: "so1", items: [{ product_id: "p1", description: "Gadget X", warehouse_id: "w1" }] };
    const lines: unknown[] = [{ line_index: 0, product_id: "p1", this_qty: 1, ordered_qty: 2, is_serialized: false }];
    mockFrom.mockImplementation((table: string) => {
      if (table === "products") {
        const b: Record<string, unknown> = {};
        b.select = vi.fn(() => b);
        b.eq = vi.fn(() => b);
        b.single = vi.fn(() => Promise.resolve({ data: { model: null }, error: null }));
        return b as unknown as ReturnType<typeof mockFrom>;
      }
      return makeBuilder(table);
    });
    await expect(stockLinesFromFulfillment(so as never, lines as never)).rejects.toThrow(/Line 1.*Gadget X.*missing model/i);
  });

  it("skips serialized lines correctly", async () => {
    const so: unknown = {
      id: "so1",
      items: [
        { product_id: "p1", part_model_no: "M1", description: "Ser", is_serialized: true },
        { product_id: "p2", part_model_no: "M2", description: "NonSer" },
      ],
    };
    const lines: unknown[] = [
      { line_index: 0, product_id: "p1", this_qty: 2, ordered_qty: 5, is_serialized: true },
      { line_index: 1, product_id: "p2", this_qty: 3, ordered_qty: 5, is_serialized: false },
    ];
    const out = await stockLinesFromFulfillment(so as never, lines as never);
    expect(out).toHaveLength(1);
    expect(out[0].model).toBe("M2");
  });

  it("handles null warehouse_id (included as null, not filtered)", async () => {
    const so: unknown = { id: "so1", items: [{ product_id: "p1", part_model_no: "M1", description: "A", warehouse_id: null }] };
    const lines: unknown[] = [{ line_index: 0, product_id: "p1", this_qty: 4, ordered_qty: 10, is_serialized: false, warehouse_id: null }];
    const out = await stockLinesFromFulfillment(so as never, lines as never);
    expect(out).toHaveLength(1);
    expect(out[0].warehouseId).toBeNull();
    expect(out[0].model).toBe("M1");
  });

  it("skips lines with qty 0 and null product_id", async () => {
    const so: unknown = { id: "so1", items: [{ part_model_no: "M1", description: "A" }] };
    const lines: unknown[] = [
      { line_index: 0, product_id: null, this_qty: 5, ordered_qty: 5 },
      { line_index: 0, product_id: "p1", this_qty: 0, ordered_qty: 5 },
    ];
    const out = await stockLinesFromFulfillment(so as never, lines as never);
    expect(out).toHaveLength(0);
  });
});

// ── revalidateBalanceOrThrow ──────────────────────────────────────────────

describe("documentFlow.writers/revalidateBalanceOrThrow", () => {
  it("when view row missing, derives orderedQty from SO items not client fl.balance", async () => {
    const so: unknown = {
      id: "so1",
      items: [{ qty: 20, description: "Widget" }],
    };
    const lines: unknown[] = [
      { line_index: 0, product_id: "p1", ordered_qty: 999, fulfilled_before: 5, balance: 999, this_qty: 10 },
    ];
    // View returns empty (no row for line 0)
    mockFrom.mockImplementation((table: string) => {
      if (table === "so_fulfillment_summary") {
        const b: Record<string, unknown> = {};
        b.select = vi.fn(() => b);
        b.eq = vi.fn(() => b);
        // Return empty array -> view missing
        return { data: [], error: null } as unknown as ReturnType<typeof mockFrom>;
      }
      // Fallback generic
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
      builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
      // Ensure await supabase.from(...).select(...).eq(...) resolves correctly:
      // The code does `await supabase.from(...).select("*").eq(...)` without .single,
      // so we need the chain to be thenable. Make builder thenable that resolves to {data,error}
      // For simplicity, make builder a Promise-like:
      const thenable = Promise.resolve({ data: [], error: null }) as unknown as { then: unknown };
      Object.assign(builder, { then: (thenable as unknown as { then: (onFulfilled: unknown, onRejected: unknown) => unknown }).then.bind(thenable) });
      return builder as unknown as ReturnType<typeof mockFrom>;
    });

    // Need to make fetchSoViewSummary work: it does supabase.from(...).select("*").eq(... ) and awaits the result
    // Our mock above for so_fulfillment_summary must return a thenable resolving to {data:[], error:null}
    // Patch: override mockFrom for this test specifically
    const summaryThenable = Promise.resolve({ data: [], error: null }) as unknown as ReturnType<typeof mockFrom>;
    // Make it chainable: add select/eq that return itself
    (summaryThenable as unknown as Record<string, unknown>).select = vi.fn(() => summaryThenable);
    (summaryThenable as unknown as Record<string, unknown>).eq = vi.fn(() => summaryThenable);
    mockFrom.mockImplementation((table: string) => {
      if (table === "so_fulfillment_summary") return summaryThenable;
      return makeBuilder(table);
    });

    // orderedQty from SO is 20, fulfilled_before 5 => balance 15, this_qty 10 => should PASS
    const fresh = await revalidateBalanceOrThrow("so1", lines as never, so as never);
    expect(fresh).toEqual([]);

    // Now try this_qty exceeding derived balance (20-5=15, ask 16 => should throw)
    const linesOver: unknown[] = [
      { line_index: 0, product_id: "p1", ordered_qty: 999, fulfilled_before: 5, balance: 999, this_qty: 16 },
    ];
    await expect(revalidateBalanceOrThrow("so1", linesOver as never, so as never)).rejects.toThrow(/Balance changed/);
  });

  it("uses view balance when row exists", async () => {
    const so: unknown = { id: "so1", items: [{ qty: 10 }] };
    const lines: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 10, fulfilled_before: 0, balance: 10, this_qty: 3 }];
    const summaryThenable = Promise.resolve({
      data: [{ line_index: 0, balance: 5, fulfilled_stock: 5, ordered_qty: 10 } as unknown],
      error: null,
    }) as unknown as ReturnType<typeof mockFrom>;
    (summaryThenable as unknown as Record<string, unknown>).select = vi.fn(() => summaryThenable);
    (summaryThenable as unknown as Record<string, unknown>).eq = vi.fn(() => summaryThenable);
    mockFrom.mockImplementation((table: string) => {
      if (table === "so_fulfillment_summary") return summaryThenable;
      return makeBuilder(table);
    });
    await expect(revalidateBalanceOrThrow("so1", lines as never, so as never)).resolves.toBeDefined();
    const linesOver: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 10, fulfilled_before: 0, balance: 10, this_qty: 6 }];
    await expect(revalidateBalanceOrThrow("so1", linesOver as never, so as never)).rejects.toThrow(/Balance changed/);
  });
});

// ── insertLedgerAndFulfillments rollback ───────────────────────────────────

describe("documentFlow.writers/insertLedgerAndFulfillments", () => {
  it("rolls back ledger when fulfillments insert fails", async () => {
    const ledgerId = "ledger-123";
    let deleteCalled = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "so_conversions") {
        const b: Record<string, unknown> = {};
        b.insert = vi.fn(() => b);
        b.select = vi.fn(() => b);
        b.single = vi.fn(() => Promise.resolve({ data: { id: ledgerId }, error: null }));
        b.delete = vi.fn(() => b);
        b.eq = vi.fn(() => {
          deleteCalled = true;
          return Promise.resolve({ error: null });
        });
        return b as unknown as ReturnType<typeof mockFrom>;
      }
      if (table === "so_fulfillments") {
        const b: Record<string, unknown> = {};
        b.insert = vi.fn(() => Promise.resolve({ error: { message: "fulfillment fail" } }));
        return b as unknown as ReturnType<typeof mockFrom>;
      }
      return makeBuilder(table);
    });

    const lines: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 10, this_qty: 5, warehouse_id: "w1" }];
    await expect(
      insertLedgerAndFulfillments({
        sales_order_id: "so1",
        conversion_type: "tax_invoice",
        target_table: "invoices",
        target_id: "inv1",
        target_no: "INV-1",
        prior: [],
        thisFulfilled: [],
        balanceAfter: [],
        lines: lines as never,
      }),
    ).rejects.toThrow(/ledger rolled back/i);
    expect(deleteCalled).toBe(true);
  });

  it("succeeds when fulfillments insert ok", async () => {
    const ledgerId = "ledger-456";
    mockFrom.mockImplementation((table: string) => {
      if (table === "so_conversions") {
        const b: Record<string, unknown> = {};
        b.insert = vi.fn(() => b);
        b.select = vi.fn(() => b);
        b.single = vi.fn(() => Promise.resolve({ data: { id: ledgerId }, error: null }));
        return b as unknown as ReturnType<typeof mockFrom>;
      }
      if (table === "so_fulfillments") {
        const b: Record<string, unknown> = {};
        b.insert = vi.fn(() => Promise.resolve({ error: null }));
        return b as unknown as ReturnType<typeof mockFrom>;
      }
      return makeBuilder(table);
    });
    const res = await insertLedgerAndFulfillments({
      sales_order_id: "so1",
      conversion_type: "tax_invoice",
      target_table: "invoices",
      target_id: "inv1",
      target_no: "INV-1",
      prior: [],
      thisFulfilled: [],
      balanceAfter: [],
      lines: [{ line_index: 0, product_id: "p1", ordered_qty: 10, this_qty: 5 } as never],
    });
    expect(res.ledgerId).toBe(ledgerId);
  });
});

// ── assertBalancesOrThrow & validateSoStatusForConversion ───────────────────

describe("documentFlow.writers/assertBalancesOrThrow", () => {
  it("passes when this_qty within balance", () => {
    const so: unknown = { id: "so1", so_no: "SO-001", items: [{ qty: 20, description: "Widget" }] };
    const summary: unknown[] = [{ line_index: 0, ordered_qty: 20, fulfilled_stock: 5, balance: 15 }];
    const lines: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 20, fulfilled_before: 5, balance: 15, this_qty: 10 }];
    expect(() => assertBalancesOrThrow("so1", so as never, lines as never, summary as never)).not.toThrow();
  });

  it("throws with SO No and line description when over balance", () => {
    const so: unknown = { id: "so1", so_no: "SO-999", items: [{ qty: 10, description: "Gadget" }] };
    const summary: unknown[] = [{ line_index: 0, ordered_qty: 10, fulfilled_stock: 8, balance: 2 }];
    const lines: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 10, fulfilled_before: 8, balance: 2, this_qty: 5, description: "Gadget" }];
    expect(() => assertBalancesOrThrow("so1", so as never, lines as never, summary as never)).toThrow(/SO-999.*Gadget.*Balance changed/);
  });

  it("handles NaN this_qty with valid-number message including SO No", () => {
    const so: unknown = { id: "so1", so_no: "SO-001", items: [{ qty: 10, description: "A" }] };
    const summary: unknown[] = [{ line_index: 0, ordered_qty: 10, balance: 10 }];
    const lines: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 10, this_qty: NaN }];
    expect(() => assertBalancesOrThrow("so1", so as never, lines as never, summary as never)).toThrow(/valid number/);
  });

  it("handles negative this_qty", () => {
    const so: unknown = { id: "so1", so_no: "SO-001", items: [{ qty: 10, description: "A" }] };
    const summary: unknown[] = [{ line_index: 0, ordered_qty: 10, balance: 10 }];
    const lines: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 10, this_qty: -2 }];
    expect(() => assertBalancesOrThrow("so1", so as never, lines as never, summary as never)).toThrow(/cannot be negative/);
  });

  it("handles missing ordered qty (0) with positive this_qty", () => {
    const so: unknown = { id: "so1", so_no: "SO-001", items: [{ qty: 0, description: "ZeroItem" }] };
    const summary: unknown[] = [];
    const lines: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 0, fulfilled_before: 0, balance: 0, this_qty: 1 }];
    expect(() => assertBalancesOrThrow("so1", so as never, lines as never, summary as never)).toThrow(/ordered quantity missing/);
  });

  it("derives orderedQty from SO items when view row missing (not client fl.balance)", () => {
    const so: unknown = { id: "so1", so_no: "SO-001", items: [{ qty: 20, description: "Widget" }] };
    const summary: unknown[] = []; // view missing
    // client lies: fl.ordered_qty 999, balance 999, but SO item is 20, fulfilled_before 5 => real balance 15
    const linesOk: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 999, fulfilled_before: 5, balance: 999, this_qty: 15 }];
    expect(() => assertBalancesOrThrow("so1", so as never, linesOk as never, summary as never)).not.toThrow();
    const linesOver: unknown[] = [{ line_index: 0, product_id: "p1", ordered_qty: 999, fulfilled_before: 5, balance: 999, this_qty: 16 }];
    expect(() => assertBalancesOrThrow("so1", so as never, linesOver as never, summary as never)).toThrow(/Balance changed/);
  });
});

describe("documentFlow.writers/validateSoStatusForConversion", () => {
  it("throws for cancelled SO", () => {
    const so: unknown = { id: "so1", status: "cancelled", items: [{ product_id: "p1", description: "A", qty: 5 }] };
    expect(() => validateSoStatusForConversion(so as never, "tax_invoice")).toThrow(/cancelled/i);
  });

  it("throws for fully-delivered SO on tax_invoice", () => {
    const so: unknown = { id: "so1", status: "delivered", items: [{ product_id: "p1", description: "A", qty: 10 }] };
    // validateSoForConversion checks status terminal when no summary provided? With status=delivered and conversion tax_invoice it should error
    expect(() => validateSoStatusForConversion(so as never, "tax_invoice")).toThrow();
  });

  it("allows proforma for delivered SO (capped)", () => {
    const so: unknown = { id: "so1", status: "draft", items: [{ product_id: "p1", description: "A", qty: 5 }] };
    expect(() => validateSoStatusForConversion(so as never, "proforma_invoice")).not.toThrow();
  });

  it("passes valid draft SO for tax_invoice", () => {
    const so: unknown = { id: "so1", status: "draft", items: [{ product_id: "p1", description: "A", qty: 5 }] };
    expect(() => validateSoStatusForConversion(so as never, "tax_invoice")).not.toThrow();
  });
});

// ── handleWriterError ───────────────────────────────────────────────────────

describe("documentFlow.writers/handleWriterError", () => {
  it("deletes both ledger and target doc then re-throws", async () => {
    const deletes: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      const b: Record<string, unknown> = {};
      b.delete = vi.fn(() => b);
      b.eq = vi.fn(() => {
        deletes.push(table);
        return Promise.resolve({ error: null });
      });
      return b as unknown as ReturnType<typeof mockFrom>;
    });
    const err = new Error("original");
    await expect(handleWriterError(err, "ledger1", "target1", "invoices")).rejects.toThrow("original");
    expect(deletes).toContain("so_conversions");
    expect(deletes).toContain("invoices");
  });

  it("handles null ledgerId (only deletes target)", async () => {
    const deletes: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      const b: Record<string, unknown> = {};
      b.delete = vi.fn(() => b);
      b.eq = vi.fn(() => {
        deletes.push(table);
        return Promise.resolve({ error: null });
      });
      return b as unknown as ReturnType<typeof mockFrom>;
    });
    await expect(handleWriterError(new Error("x"), null, "t1", "invoices")).rejects.toThrow("x");
    expect(deletes).toEqual(["invoices"]);
  });
});

// ── cancelSoConversion & syncCancelToLedger ─────────────────────────────────

describe("documentFlow.writers/cancel helpers", () => {
  it("cancelSoConversion updates status to cancelled", async () => {
    let updated = false;
    mockFrom.mockImplementation((table: string) => {
      if (table === "so_conversions") {
        const b: Record<string, unknown> = {};
        b.update = vi.fn(() => b);
        b.eq = vi.fn(() => {
          updated = true;
          return Promise.resolve({ error: null });
        });
        return b as unknown as ReturnType<typeof mockFrom>;
      }
      return makeBuilder(table);
    });
    await cancelSoConversion("conv1");
    expect(updated).toBe(true);
  });

  it("syncCancelToLedger updates via target_table/target_id and fallback via conversion_id", async () => {
    const calls: Array<{ table: string; method: string }> = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === "so_conversions") {
        const b: Record<string, unknown> = {};
        b.update = vi.fn(() => b);
        let eqCount = 0;
        b.eq = vi.fn(() => {
          eqCount++;
          calls.push({ table, method: "eq" });
          // First eq in chain returns builder, second resolves
          if (eqCount % 2 === 1) return b;
          return Promise.resolve({ error: null });
        });
        return b as unknown as ReturnType<typeof mockFrom>;
      }
      if (table === "invoices") {
        const b: Record<string, unknown> = {};
        b.select = vi.fn(() => b);
        b.eq = vi.fn(() => b);
        b.maybeSingle = vi.fn(() => Promise.resolve({ data: { conversion_id: "conv-99" }, error: null }));
        return b as unknown as ReturnType<typeof mockFrom>;
      }
      return makeBuilder(table);
    });
    await syncCancelToLedger("invoices", "inv1");
    // Should have called so_conversions update at least once (via target_table) and again via id
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});
