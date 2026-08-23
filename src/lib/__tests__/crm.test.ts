import { isIntraSupply, computeQuoteTotals, type QuoteItem } from "@/lib/crm";

const item = (rate = 100): QuoteItem => ({
  description: "x",
  qty: 1,
  unit: "Nos",
  rate,
  discount_percent: 0,
  tax_percent: 18,
  amount: rate,
} as unknown as QuoteItem);

describe("crm/isIntraSupply (B-04)", () => {
  it("GSTIN codes take precedence over state names", () => {
    // Names differ but GSTIN codes are both Karnataka (29) → intra.
    expect(
      isIntraSupply({
        seller_gstin: "29ABCDE1234F1Z5",
        buyer_gstin: "29ZZZZE1234F1Z5",
        place_of_supply: "Delhi",
        business_state: "Karnataka",
      }),
    ).toBe(true);
    // Names match but GSTIN codes differ → inter (this is the old bug).
    expect(
      isIntraSupply({
        seller_gstin: "29ABCDE1234F1Z5",
        buyer_gstin: "07ABCDE1234F1Z5",
        place_of_supply: "Karnataka",
        business_state: "Karnataka",
      }),
    ).toBe(false);
  });

  it("falls back to state-name comparison when GSTINs missing", () => {
    expect(
      isIntraSupply({ place_of_supply: "Karnataka", business_state: "karnataka" }),
    ).toBe(true);
    expect(
      isIntraSupply({ place_of_supply: "Delhi", business_state: "Karnataka" }),
    ).toBe(false);
    expect(isIntraSupply({ place_of_supply: null, business_state: "Karnataka" })).toBe(false);
  });
});

describe("crm/computeQuoteTotals with GSTIN precedence", () => {
  const base = {
    items: [item(100)],
    discount_amount: 0,
    shipping_charges: 0,
    adjustment: 0,
    tcs_percent: 0,
    round_off: 0,
  };
  it("charges IGST when GSTINs differ even if names match", () => {
    const r = computeQuoteTotals({
      ...base,
      place_of_supply: "Karnataka",
      business_state: "Karnataka",
      seller_gstin: "29ABCDE1234F1Z5",
      buyer_gstin: "07ABCDE1234F1Z5",
    });
    expect(r.cgst_amount).toBe(0);
    expect(r.sgst_amount).toBe(0);
    expect(r.igst_amount).toBeCloseTo(18, 2);
  });
});
