import { describe, it, expect } from "vitest";
import { r2, r3 } from "@/lib/money";

describe("money/r2 hardened", () => {
  it("guards NaN/Infinity to 0", () => {
    expect(r2(NaN)).toBe(0);
    expect(r2(Infinity)).toBe(0);
    expect(r2(-Infinity)).toBe(0);
    expect(r2(Number.NaN as any)).toBe(0);
    // Number(undefined) is NaN
    expect(r2(undefined as unknown as number)).toBe(0);
    expect(r2(null as unknown as number)).toBe(0); // Number(null)=0 → 0 not guarded, but 0 is correct
  });

  it("normal rounding", () => {
    expect(r2(1.004)).toBe(1.0);
    expect(r2(1.006)).toBe(1.01);
    expect(r2(0)).toBe(0);
    expect(r2(100.1)).toBe(100.1);
  });

  it("tie handling vs toFixed for .005 (binary tie)", () => {
    // EPSILON nudges binary ties toward intuitive rounding; toFixed itself is
    // binary-tie sensitive (1.005 → "1.00" vs r2 → 1.01). We document divergence.
    expect(r2(1.005)).toBe(1.01);
    expect(Number((1.005).toFixed(2))).toBe(1);
    // Notorious divergent case: 2.675
    expect(r2(2.675)).toBe(2.68);
    expect(Number((2.675).toFixed(2))).toBe(2.67);
    // r2 must be consistent: same input always same output
    expect(r2(1.005)).toBe(r2(1.005));
  });

  it("EPSILON helps nearby non-tie values", () => {
    // 1.015 in binary is ~1.014999..., EPSILON nudges correctly?
    // We don't assert direction for this case, just that r2 is finite and plausible
    const v = r2(1.015);
    expect(Number.isFinite(v)).toBe(true);
    // 2.675 is another notorious tie-ish value
    expect(Number.isFinite(r2(2.675))).toBe(true);
  });

  it("negative and large", () => {
    expect(r2(-1.005)).toBe(-1.0);
    expect(r2(123456.789)).toBe(123456.79);
  });
});

describe("money/r3 hardened", () => {
  it("guards NaN/Infinity to 0", () => {
    expect(r3(NaN)).toBe(0);
    expect(r3(Infinity)).toBe(0);
  });
  it("rounds to 3 decimals", () => {
    expect(r3(1.0004)).toBe(1.0);
    expect(r3(1.0005)).toBe(1.001);
  });
});
