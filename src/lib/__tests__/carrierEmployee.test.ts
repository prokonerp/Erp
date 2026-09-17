import { describe, it, expect } from "vitest";
import {
  applyCarrierSelection,
  clearCarrierSelection,
  escapeIlike,
  matchPrefillCarrierByName,
  parsePrefillCarrier,
  preferUserText,
  resolveCarrierDisplay,
} from "@/lib/carrierEmployee";

describe("applyCarrierSelection", () => {
  it("sets FK and auto-fills driver text from employee", () => {
    const out = applyCarrierSelection(
      { driver_name: "", driver_mobile: "", carrier_employee_id: null },
      { id: "e1", name: "Ravi Kumar", phone: "9811111111" },
    );
    expect(out).toEqual({
      carrier_employee_id: "e1",
      driver_name: "Ravi Kumar",
      driver_mobile: "9811111111",
    });
  });

  it("normalises null phone to empty text", () => {
    const out = applyCarrierSelection(
      { driver_name: "Old", driver_mobile: "000", carrier_employee_id: null },
      { id: "e2", name: "Sita", phone: null },
    );
    expect(out.driver_name).toBe("Sita");
    expect(out.driver_mobile).toBe("");
    expect(out.carrier_employee_id).toBe("e2");
  });
});

describe("clearCarrierSelection", () => {
  it("nulls FK and leaves text editable", () => {
    const out = clearCarrierSelection({
      driver_name: "Ravi Kumar",
      driver_mobile: "9811111111",
      carrier_employee_id: "e1",
    });
    expect(out).toEqual({
      carrier_employee_id: null,
      driver_name: "Ravi Kumar",
      driver_mobile: "9811111111",
    });
  });
});

describe("resolveCarrierDisplay", () => {
  it("prefers linked carrier name when FK present", () => {
    expect(
      resolveCarrierDisplay({
        carrier_employee_id: "e1",
        carrier_employee_name: "Ravi Kumar",
        driver_name: "Stale Text",
        driver_mobile: "999",
      }),
    ).toEqual({ name: "Ravi Kumar", mobile: "999", linked: true });
  });

  it("falls back to driver text when no FK", () => {
    expect(
      resolveCarrierDisplay({
        carrier_employee_id: null,
        carrier_employee_name: null,
        driver_name: "Walk-in Driver",
        driver_mobile: "888",
      }),
    ).toEqual({ name: "Walk-in Driver", mobile: "888", linked: false });
  });

  it("falls back to driver text when FK present but name lookup missing", () => {
    expect(
      resolveCarrierDisplay({
        carrier_employee_id: "e9",
        carrier_employee_name: null,
        driver_name: "Ravi Kumar",
        driver_mobile: "",
      }),
    ).toEqual({ name: "Ravi Kumar", mobile: "", linked: true });
  });
});

describe("parsePrefillCarrier", () => {
  it("extracts FK truth and trimmed name from a ticket prefill payload", () => {
    expect(
      parsePrefillCarrier({ assigned_employee_id: "emp-1", assigned_engineer_name: "  Asha " }),
    ).toEqual({ employeeId: "emp-1", engineerName: "Asha" });
  });

  it("returns empty hint when the prefill carries no engineer", () => {
    expect(parsePrefillCarrier({})).toEqual({ employeeId: null, engineerName: "" });
    expect(
      parsePrefillCarrier({ assigned_employee_id: null, assigned_engineer_name: null }),
    ).toEqual({ employeeId: null, engineerName: "" });
  });

  it("ignores non-string payload values", () => {
    expect(
      parsePrefillCarrier({ assigned_employee_id: 42, assigned_engineer_name: ["x"] }),
    ).toEqual({ employeeId: null, engineerName: "" });
  });
});

describe("matchPrefillCarrierByName", () => {
  const rows = [
    { id: "e1", name: "Ravi Kumar" },
    { id: "e2", name: "Asha Devi" },
  ];

  it("matches a single exact name case-insensitively", () => {
    expect(matchPrefillCarrierByName(rows, "asha devi")).toEqual({ id: "e2", name: "Asha Devi" });
  });

  it("returns null on zero or ambiguous hits", () => {
    expect(matchPrefillCarrierByName(rows, "Nobody")).toBeNull();
    expect(
      matchPrefillCarrierByName(
        [...rows, { id: "e3", name: "asha devi" }],
        "Asha Devi",
      ),
    ).toBeNull();
    expect(matchPrefillCarrierByName(rows, "  ")).toBeNull();
  });
});

describe("escapeIlike", () => {
  it("escapes LIKE wildcards so lookups stay exact", () => {
    expect(escapeIlike("100%_x\\y")).toBe("100\\%\\_x\\\\y");
    expect(escapeIlike("Asha Devi")).toBe("Asha Devi");
    expect(escapeIlike(null)).toBe("");
  });
});

describe("preferUserText", () => {
  it("keeps non-blank user text verbatim", () => {
    expect(preferUserText(" Ravi ", "Asha")).toBe(" Ravi ");
  });

  it("falls back to the prefill on blank or missing text", () => {
    expect(preferUserText("   ", "Asha")).toBe("Asha");
    expect(preferUserText("", "Asha")).toBe("Asha");
    expect(preferUserText(null, "Asha")).toBe("Asha");
    expect(preferUserText(null, null)).toBe("");
  });
});
