import { describe, it, expect } from "vitest";
import {
  applyCarrierSelection,
  clearCarrierSelection,
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
