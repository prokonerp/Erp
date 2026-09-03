// TDD for quotations address auto-populate HIGH fixes H1-H3 (c984c05)
// Tests pure helpers that mirror the fixed applyCustomer logic in both routes.
// No Supabase network - we test the decision logic that was buggy.
type CustLike = Record<string, unknown> & {
  billing_address?: string | null;
  shipping_address?: string | null;
  address?: string | null;
  state?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
};

// Helper extracted from new.tsx / $id.tsx fixed code
function isStale(anyC: Record<string, unknown>): boolean {
  return ["billing_address", "shipping_address", "address"].some(
    (k) => !(k in anyC) || anyC[k] === undefined,
  );
}

function resolveBilling(full: CustLike, prev: string | null): string {
  if ((full.billing_address || "").trim()) return full.billing_address as string;
  if (((full as any).address || "").trim()) return (full as any).address as string;
  return prev || "";
}
function resolveShipping(full: CustLike, prev: string | null): string {
  if ((full.shipping_address || "").trim()) return full.shipping_address as string;
  if ((full.billing_address || "").trim()) return full.billing_address as string;
  if (((full as any).address || "").trim()) return (full as any).address as string;
  return prev || "";
}
function resolvePlace(full: CustLike, prev: string | null): string {
  return (full.state || "").trim() ? (full.state as string) : prev || "";
}
function resolveContact(full: CustLike, key: string, prev: string | null): string {
  const v = (full as any)[key] as string | null;
  return (v || "").trim() ? (v as string) : prev || "";
}

// Race guard simulation: seq ref
class SeqGuard {
  seq = 0;
  next() { return ++this.seq; }
  isStale(seq: number) { return seq !== this.seq; }
}

describe("H3 stale-cache detection", () => {
  it("stale when any of the three keys missing (robust OR check)", () => {
    expect(isStale({ shipping_address: "a", address: "b" } as any)).toBe(true); // billing missing
    expect(isStale({ billing_address: "a", address: "b" } as any)).toBe(true);
    expect(isStale({ billing_address: "a", shipping_address: "b" } as any)).toBe(true);
  });
  it("stale when any is explicitly undefined (partial stale)", () => {
    expect(isStale({ billing_address: undefined, shipping_address: null, address: null } as any)).toBe(true);
    expect(isStale({ billing_address: "x", shipping_address: undefined, address: "y" } as any)).toBe(true);
  });
  it("NOT stale when all three present even if null (Supabase returns null not undefined)", () => {
    // null means field was selected but empty - not stale, no refetch needed
    expect(isStale({ billing_address: null, shipping_address: null, address: null } as any)).toBe(false);
    expect(isStale({ billing_address: "", shipping_address: null, address: "x" } as any)).toBe(false);
  });
  it("NOT stale when all three present with values", () => {
    expect(isStale({ billing_address: "A", shipping_address: "B", address: "C" } as any)).toBe(false);
  });

  it("old buggy &&-undefined check would miss partial stale", () => {
    const anyC = { billing_address: undefined, shipping_address: "keep", address: "keep" } as any;
    const oldBuggy = anyC["billing_address"] === undefined && anyC["shipping_address"] === undefined && anyC["address"] === undefined;
    expect(oldBuggy).toBe(false); // buggy says not stale -> misses fetch
    expect(isStale(anyC)).toBe(true); // fixed correctly detects stale
  });
});

describe("H2 preserve semantics (don't wipe manual edits)", () => {
  it("billing: prefers billing_address, falls back to address, else preserves prev", () => {
    expect(resolveBilling({ billing_address: "BILL", address: "ADDR" }, "PREV")).toBe("BILL");
    expect(resolveBilling({ billing_address: "", address: "ADDR" }, "PREV")).toBe("ADDR");
    expect(resolveBilling({ billing_address: "   ", address: "   " }, "PREV")).toBe("PREV");
    expect(resolveBilling({ billing_address: null, address: null } as any, "PREV")).toBe("PREV");
    expect(resolveBilling({ billing_address: null, address: "" } as any, "")).toBe("");
  });
  it("shipping: prefers shipping, then billing, then address, else preserves", () => {
    expect(resolveShipping({ shipping_address: "S", billing_address: "B", address: "A" }, "PREV")).toBe("S");
    expect(resolveShipping({ shipping_address: "", billing_address: "B", address: "A" }, "PREV")).toBe("B");
    expect(resolveShipping({ shipping_address: "", billing_address: "", address: "A" }, "PREV")).toBe("A");
    expect(resolveShipping({ shipping_address: "", billing_address: "", address: "" }, "PREV")).toBe("PREV");
    expect(resolveShipping({ shipping_address: null, billing_address: null, address: null } as any, "MY MANUAL")).toBe("MY MANUAL");
  });
  it("place_of_supply preserves prev when state empty", () => {
    expect(resolvePlace({ state: "Haryana" }, "Delhi")).toBe("Haryana");
    expect(resolvePlace({ state: "" }, "Delhi")).toBe("Delhi");
    expect(resolvePlace({ state: "   " }, "Delhi")).toBe("Delhi");
    expect(resolvePlace({ state: null } as any, "Delhi")).toBe("Delhi");
  });
  it("contact preserves prev when customer contact empty", () => {
    expect(resolveContact({ contact_name: "New" }, "contact_name", "Old")).toBe("New");
    expect(resolveContact({ contact_name: "" }, "contact_name", "Old")).toBe("Old");
    expect(resolveContact({ phone: "999" } as any, "phone", "OldPhone")).toBe("999");
    expect(resolveContact({ phone: "" } as any, "phone", "OldPhone")).toBe("OldPhone");
    expect(resolveContact({ email: null } as any, "email", "old@e.com")).toBe("old@e.com");
  });
});

describe("H1 seq guard avoids A→B race", () => {
  it("aborts stale fetch when seq mismatches", async () => {
    const guard = new SeqGuard();
    const seqA = guard.next(); // 1
    const seqB = guard.next(); // 2 - user picked B quickly
    // A fetch resolves late
    expect(guard.isStale(seqA)).toBe(true);
    expect(guard.isStale(seqB)).toBe(false);
  });

  it("functional setQ vs stale closure: last write wins when using seq", async () => {
    // simulate two async applyCustomer calls with delays
    const guard = new SeqGuard();
    let state = { billing_address: "INITIAL", customer_id: "init" };
    const apply = async (id: string, billing: string, delay: number, seq: number) => {
      await new Promise((r) => setTimeout(r, delay));
      if (guard.isStale(seq)) return; // abort stale
      // functional update would read latest prev, not captured stale state
      state = { ...state, customer_id: id, billing_address: billing };
    };
    const seqA = guard.next();
    const pA = apply("A", "Billing A", 30, seqA);
    const seqB = guard.next();
    const pB = apply("B", "Billing B", 10, seqB);
    await Promise.all([pA, pB]);
    expect(state.customer_id).toBe("B");
    expect(state.billing_address).toBe("Billing B");
  });

  it("on fetch failure keeps old values (no wipe)", () => {
    // fetch failure path: full stays as c, preserve logic keeps prev when c empty
    const prev = "Manual edit keeps";
    const full = { billing_address: "", address: "", shipping_address: "" } as any;
    // simulate catch branch where we don't overwrite data
    expect(resolveBilling(full, prev)).toBe(prev);
    expect(resolveShipping(full, prev)).toBe(prev);
  });
});
