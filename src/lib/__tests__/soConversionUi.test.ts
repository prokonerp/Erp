import {
  UI_CONVERSION_TYPES,
  isUiConversionType,
  toUiConversionType,
  toUiType,
  toUiDefault,
  resolveConvertTarget,
  uiConversionLabel,
} from "@/lib/soConversionUi";

describe("soConversionUi/validPassthrough", () => {
  it.each(UI_CONVERSION_TYPES)("passes through %s unchanged", (type) => {
    expect(toUiConversionType(type)).toBe(type);
    expect(isUiConversionType(type)).toBe(true);
  });
});

describe("soConversionUi/whitespaceTolerance", () => {
  it("trims whitespace from tax_invoice", () => {
    expect(toUiConversionType("  tax_invoice  ")).toBe("tax_invoice");
  });
  it("trims whitespace from general_dc", () => {
    expect(toUiConversionType(" general_dc ")).toBe("general_dc");
  });
  it("trims whitespace from proforma_invoice", () => {
    expect(toUiConversionType("\tproforma_invoice\t")).toBe("proforma_invoice");
  });
});

describe("soConversionUi/legacyMapping", () => {
  it("maps delivery_challan to general_dc", () => {
    expect(toUiConversionType("delivery_challan")).toBe("general_dc");
  });
});

describe("soConversionUi/garbageFallback", () => {
  it.each([
    ["random_garbage", "tax_invoice"],
    ["unknown", "tax_invoice"],
    ["DELIVERY_CHALLAN", "tax_invoice"],
    ["Delivery_Challan", "tax_invoice"],
  ])("maps %s to tax_invoice", (input, expected) => {
    expect(toUiConversionType(input)).toBe(expected);
  });

  it("returns tax_invoice for null", () => {
    expect(toUiConversionType(null)).toBe("tax_invoice");
  });

  it("returns tax_invoice for undefined", () => {
    expect(toUiConversionType(undefined)).toBe("tax_invoice");
  });

  it("returns tax_invoice for a number", () => {
    expect(toUiConversionType(42 as any)).toBe("tax_invoice");
  });
});

describe("soConversionUi/isUiConversionType", () => {
  it("returns true for all UI types", () => {
    expect(isUiConversionType("tax_invoice")).toBe(true);
    expect(isUiConversionType("general_dc")).toBe(true);
    expect(isUiConversionType("proforma_invoice")).toBe(true);
  });

  it("returns false for garbage", () => {
    expect(isUiConversionType("delivery_challan")).toBe(false);
    expect(isUiConversionType("random")).toBe(false);
  });

  it("returns false for non-strings", () => {
    expect(isUiConversionType(null)).toBe(false);
    expect(isUiConversionType(undefined)).toBe(false);
    expect(isUiConversionType(123)).toBe(false);
    expect(isUiConversionType({})).toBe(false);
  });
});

describe("soConversionUi/resolveConvertTarget", () => {
  it("returns tax_invoice route", () => {
    const result = resolveConvertTarget("tax_invoice", "abc123");
    expect(result).toEqual({
      to: "/sales/invoices/$id",
      params: { id: "abc123" },
    });
  });

  it("returns general_dc route", () => {
    const result = resolveConvertTarget("general_dc", "def456");
    expect(result).toEqual({
      to: "/sales/general-dc/$id",
      params: { id: "def456" },
    });
  });

  it("returns proforma_invoice route", () => {
    const result = resolveConvertTarget("proforma_invoice", "ghi789");
    expect(result).toEqual({
      to: "/sales/proforma/$id",
      params: { id: "ghi789" },
    });
  });

  it("returns null for unknown type", () => {
    expect(resolveConvertTarget("unknown", "abc")).toBeNull();
  });

  it("returns null for null type", () => {
    expect(resolveConvertTarget(null, "abc")).toBeNull();
  });

  it("returns null for null id", () => {
    expect(resolveConvertTarget("tax_invoice", null)).toBeNull();
  });

  it("returns null for empty string id", () => {
    expect(resolveConvertTarget("tax_invoice", "")).toBeNull();
  });

  it("returns null for whitespace-only id", () => {
    expect(resolveConvertTarget("tax_invoice", "   ")).toBeNull();
  });

  it("trims whitespace from id", () => {
    const result = resolveConvertTarget("tax_invoice", "  id123  ");
    expect(result).toEqual({
      to: "/sales/invoices/$id",
      params: { id: "id123" },
    });
  });
});

describe("soConversionUi/uiConversionLabel", () => {
  it("returns Tax Invoice", () => {
    expect(uiConversionLabel("tax_invoice")).toBe("Tax Invoice");
  });

  it("returns General Challan", () => {
    expect(uiConversionLabel("general_dc")).toBe("General Challan");
  });

  it("returns Proforma", () => {
    expect(uiConversionLabel("proforma_invoice")).toBe("Proforma");
  });
});

describe("soConversionUi/aliases", () => {
  it("toUiType behaves identically to toUiConversionType", () => {
    expect(toUiType("tax_invoice")).toBe(toUiConversionType("tax_invoice"));
    expect(toUiType("delivery_challan")).toBe(toUiConversionType("delivery_challan"));
    expect(toUiType(null)).toBe(toUiConversionType(null));
  });

  it("toUiDefault behaves identically to toUiConversionType", () => {
    expect(toUiDefault("general_dc")).toBe(toUiConversionType("general_dc"));
    expect(toUiDefault("proforma_invoice")).toBe(toUiConversionType("proforma_invoice"));
    expect(toUiDefault(undefined)).toBe(toUiConversionType(undefined));
  });
});
