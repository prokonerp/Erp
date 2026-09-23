import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mock supabase client --------------------------------------------------
// Hoisted vi.mock; factory runs lazily on first import, so the const below is
// initialized by then. Same pattern as documentFlow.writers.test.ts.
const mockFrom = vi.fn();

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from: (...args: unknown[]) => mockFrom(...args),
    },
  };
});

import { insertProforma, updateProforma, writeWithSchemaColumnFallback } from "@/lib/proforma";

type Err = { code: string; message: string };

const PGRST204: Err = {
  code: "PGRST204",
  message: "Could not find the 'contact_email' column of 'proforma_invoices' in the schema cache",
};

const SUCCESS_ROW = { id: "pi-1", proforma_no: "PHS/PI/0001", items: "not-an-array" };

/** Sequential outcomes fed to the mocked chain; also captures each payload. */
function scriptWrite(outcomes: Array<{ data?: unknown; error?: Err }>) {
  const payloads: Array<Record<string, unknown>> = [];
  const next = (p: Record<string, unknown>) => {
    payloads.push(p);
    const o = outcomes.shift();
    if (!o) throw new Error("mock: no outcome left");
    return Promise.resolve({ data: (o.data ?? null) as never, error: o.error ?? null });
  };
  mockFrom.mockImplementation(() => ({
    insert: (p: Record<string, unknown>) => ({
      select: () => ({ single: () => next(p) }),
    }),
    update: (p: Record<string, unknown>) => ({
      eq: () => ({ select: () => ({ single: () => next(p) }) }),
    }),
  }));
  return payloads;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockFrom.mockReset();
});

describe("insertProforma schema-drift fallback", () => {
  it("drops the unknown column, retries, and still normalizes items", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const payloads = scriptWrite([{ error: PGRST204 }, { data: SUCCESS_ROW }]);

    const out = await insertProforma({
      branch_id: "b1",
      contact_email: "a@b.c",
      contact_mobile: "999",
      sales_type: "retail",
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toHaveProperty("contact_email", "a@b.c");
    // retry payload lost exactly the one column PostgREST rejected…
    expect(payloads[1]).not.toHaveProperty("contact_email");
    // …and kept every other carry-through column
    expect(payloads[1]).toMatchObject({ branch_id: "b1", contact_mobile: "999", sales_type: "retail" });
    expect(out.id).toBe("pi-1");
    expect(Array.isArray(out.items)).toBe(true); // normalizeProforma still ran
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("contact_email");
  });

  it("propagates a non-schema error untouched (single attempt)", async () => {
    const other: Err = { code: "42501", message: "permission denied for table proforma_invoices" };
    const payloads = scriptWrite([{ error: other }]);

    await expect(insertProforma({ notes: "x" })).rejects.toBe(other);
    expect(payloads).toHaveLength(1);
  });
});

describe("updateProforma schema-drift fallback", () => {
  it("drops the unknown column from the patch and retries", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const missingPaymentTerms: Err = {
      code: "PGRST204",
      message: "Could not find the 'payment_terms' column of 'proforma_invoices' in the schema cache",
    };
    const payloads = scriptWrite([{ error: missingPaymentTerms }, { data: SUCCESS_ROW }]);

    const out = await updateProforma("pi-1", { notes: "n", payment_terms: "Net 30" });

    expect(payloads).toHaveLength(2);
    expect(payloads[1]).not.toHaveProperty("payment_terms");
    expect(payloads[1]).toHaveProperty("notes", "n");
    expect(out.id).toBe("pi-1");
  });
});

describe("writeWithSchemaColumnFallback guardrails", () => {
  it("throws the original error when the missing column is not in our payload", async () => {
    const payload = { notes: "only" };
    const result = { data: null, error: PGRST204 };
    await expect(writeWithSchemaColumnFallback(payload, () => Promise.resolve(result))).rejects.toBe(
      PGRST204,
    );
  });

  it("drops multiple unknown columns across retries (one per attempt)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const errs: Err[] = [
      { code: "PGRST204", message: "Could not find the 'a' column of 't' in the schema cache" },
      { code: "PGRST204", message: "Could not find the 'b' column of 't' in the schema cache" },
    ];
    const seen: Array<Record<string, unknown>> = [];
    const out = await writeWithSchemaColumnFallback<string>({ a: 1, b: 2, keep: 3 }, (p) => {
      seen.push({ ...p });
      const err = errs.shift();
      return Promise.resolve(
        err ? { data: null, error: err } : { data: "ok", error: null },
      );
    });

    expect(out).toBe("ok");
    expect(seen).toEqual([{ a: 1, b: 2, keep: 3 }, { b: 2, keep: 3 }, { keep: 3 }]);
  });
});
