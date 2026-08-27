import {
  computeTotals,
  apportionHeaderDiscount,
  stateCodeFromGSTIN,
  stateNameFromCode,
  isValidGSTIN,
  amountInWords,
} from "@/lib/gst";
import { GSTIN_STATE_CODES } from "@/lib/india";

const validCode = Object.keys(GSTIN_STATE_CODES)[0];
const validGstin = validCode + "ABCDE1234F1Z5"; // 15 chars, matches GSTIN pattern

describe("gst/stateCodeFromGSTIN", () => {
  it("extracts the 2-char state code from a valid GSTIN", () => {
    expect(stateCodeFromGSTIN(validGstin)).toBe(validCode);
  });
  it("returns null for empty / malformed input", () => {
    expect(stateCodeFromGSTIN("")).toBeNull();
    expect(stateCodeFromGSTIN("invalid")).toBeNull();
    expect(stateCodeFromGSTIN("00")).toBeNull(); // not a valid state code
  });
});

describe("gst/stateNameFromCode", () => {
  it("maps a known state code to its name", () => {
    expect(stateNameFromCode(validCode)).toBe(GSTIN_STATE_CODES[validCode]);
  });
  it("returns null for unknown codes", () => {
    expect(stateNameFromCode("99")).toBeNull();
  });
});

describe("gst/isValidGSTIN", () => {
  it("accepts a well-formed 15-char GSTIN", () => {
    expect(isValidGSTIN(validGstin)).toBe(true);
  });
  it("rejects junk", () => {
    expect(isValidGSTIN("")).toBe(false);
    expect(isValidGSTIN("ABCDE1234F1Z5")).toBe(false);
  });
});

describe("gst/computeTotals — intrastate", () => {
  it("splits GST into CGST + SGST, zero IGST", () => {
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: "29",
      items: [{ qty: 10, rate: 100, gst_rate: 18 }],
      roundOff: true,
    });
    expect(r.is_interstate).toBe(false);
    expect(r.subtotal).toBe(1000);
    expect(r.cgst).toBe(90);
    expect(r.sgst).toBe(90);
    expect(r.igst).toBe(0);
    expect(r.subtotal).toBe(1000);
    expect(r.total).toBe(1180);
    expect(r.round_off).toBe(0);
  });

  it("applies line discounts before tax", () => {
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: "29",
      items: [{ qty: 10, rate: 100, discount_pct: 10, gst_rate: 18 }],
      roundOff: true,
    });
    expect(r.subtotal).toBe(900);
    expect(r.cgst).toBe(81);
    expect(r.sgst).toBe(81);
    expect(r.total).toBe(1062);
  });
});

describe("gst/computeTotals — interstate", () => {
  it("charges IGST only, zero CGST/SGST", () => {
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: "07",
      items: [{ qty: 10, rate: 100, gst_rate: 18 }],
      roundOff: true,
    });
    expect(r.is_interstate).toBe(true);
    expect(r.igst).toBe(180);
    expect(r.cgst).toBe(0);
    expect(r.sgst).toBe(0);
    expect(r.total).toBe(1180);
  });
});

describe("gst/computeTotals — header discount apportionment (B-03)", () => {
  it("reduces line taxable values so Σ(lines) equals the discounted header", () => {
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: "29",
      items: [{ qty: 10, rate: 100, gst_rate: 18 }],
      headerDiscount: 100,
      roundOff: true,
    });
    expect(r.subtotal).toBe(1000);
    expect(r.discount).toBe(100);
    expect(r.taxable_value).toBe(900);
    const sumLines = r.items.reduce((s, b) => s + b.taxable_value, 0);
    expect(sumLines).toBeCloseTo(r.taxable_value, 2);
    // GST must be charged on the post-discount value
    expect(r.cgst).toBe(81);
    expect(r.sgst).toBe(81);
    expect(r.total).toBe(1062);
  });

  it("splits evenly when lines have equal value", () => {
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: "07",
      items: [
        { qty: 1, rate: 100, gst_rate: 18 },
        { qty: 2, rate: 50, gst_rate: 18 },
      ],
      headerDiscount: 30,
      roundOff: false,
    });
    expect(r.taxable_value).toBe(170);
    expect(r.igst).toBeCloseTo(30.6, 2);
  });

  it("largest-remainder keeps paise exact across uneven lines", () => {
    const items = [
      { qty: 1, rate: 100, gst_rate: 0 },
      { qty: 1, rate: 100, gst_rate: 0 },
    ];
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: "07",
      items,
      headerDiscount: 10.01,
      roundOff: false,
    });
    expect(r.taxable_value).toBe(189.99);
    const sumLines = r.items.reduce((s, b) => s + b.taxable_value, 0);
    expect(sumLines).toBeCloseTo(189.99, 2);
  });

  it("apportionHeaderDiscount never discounts a line below zero", () => {
    const out = apportionHeaderDiscount(
      [{ qty: 1, rate: 10, gst_rate: 0 }, { qty: 1, rate: 90, gst_rate: 0 }],
      500,
      false,
    );
    expect(out.every((b) => b.taxable_value >= 0)).toBe(true);
    const sum = out.reduce((s, b) => s + b.taxable_value, 0);
    expect(sum).toBeCloseTo(0, 2);
  });

  it("returns unchanged breakups when there is no header discount", () => {
    const items = [{ qty: 2, rate: 50, gst_rate: 18 }];
    const out = apportionHeaderDiscount(items, 0, true);
    expect(out[0].taxable_value).toBe(100);
    expect(out[0].igst).toBe(18);
  });
});

describe("gst/computeTotals — round off", () => {
  it("produces an integer total and reports the rounding delta", () => {
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: "29",
      items: [{ qty: 1, rate: 99.99, gst_rate: 18 }],
      roundOff: true,
    });
    // 99.99 + 18% = 117.9882 -> r2 117.99 -> round 118, delta 0.01
    expect(r.total).toBe(118);
    expect(r.round_off).toBeCloseTo(0.01, 2);
  });
});

describe("gst/amountInWords", () => {
  it("handles zero", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
  });
  it("handles lakh/crore grouping", () => {
    expect(amountInWords(1234567)).toBe(
      "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only",
    );
    expect(amountInWords(10000000)).toBe("Rupees One Crore Only");
  });
  it("handles paise", () => {
    expect(amountInWords(2500.5)).toBe(
      "Rupees Two Thousand Five Hundred and Fifty Paise Only",
    );
  });
});

describe("gst/computeTotals — M20 missing state (place of supply fallback)", () => {
  it("returns zero tax + a warning when buyer state AND place of supply are missing", () => {
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: null,
      items: [{ qty: 10, rate: 100, gst_rate: 18 }],
      roundOff: true,
    });
    expect(r.cgst).toBe(0);
    expect(r.sgst).toBe(0);
    expect(r.igst).toBe(0);
    expect(r.taxable_value).toBe(1000);
    expect(r.total).toBe(1000);
    expect(r.gstWarning).toBeTruthy();
  });
  it("falls back to place of supply when buyer state is empty", () => {
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: undefined,
      placeOfSupplyStateCode: "29",
      items: [{ qty: 10, rate: 100, gst_rate: 18 }],
      roundOff: true,
    });
    expect(r.is_interstate).toBe(false);
    expect(r.cgst).toBe(90);
    expect(r.sgst).toBe(90);
    expect(r.igst).toBe(0);
    expect(r.gstWarning).toBeUndefined();
  });
  it("treats an unknown place of supply as inter-state via the fallback", () => {
    const r = computeTotals({
      sellerStateCode: "29",
      buyerStateCode: null,
      placeOfSupplyStateCode: "07",
      items: [{ qty: 10, rate: 100, gst_rate: 18 }],
      roundOff: true,
    });
    expect(r.is_interstate).toBe(true);
    expect(r.igst).toBe(180);
    expect(r.cgst).toBe(0);
  });
});
