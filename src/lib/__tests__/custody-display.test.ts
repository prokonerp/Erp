import { describe, it, expect } from "vitest";
import {
  custodianDisplayName,
  custodianBadgeLabel,
  filterByCustodian,
  filterMyCarried,
  countCarriedByCustodian,
} from "@/lib/custody-utils";

describe("custodianDisplayName", () => {
  it("returns trimmed custodian name", () => {
    expect(custodianDisplayName({ custodian_employee_id: "e1", custodian_name: " Asha " })).toBe(
      "Asha",
    );
  });
  it("returns null when no custodian id", () => {
    expect(
      custodianDisplayName({ custodian_employee_id: null, custodian_name: "Asha" }),
    ).toBeNull();
    expect(custodianDisplayName({})).toBeNull();
  });
  it("returns null when id present but name missing (caller falls back)", () => {
    expect(custodianDisplayName({ custodian_employee_id: "e1" })).toBeNull();
    expect(custodianDisplayName({ custodian_employee_id: "e1", custodian_name: "  " })).toBeNull();
  });
});

describe("custodianBadgeLabel", () => {
  it("labels with resolved name", () => {
    expect(custodianBadgeLabel({ custodian_employee_id: "e1", custodian_name: "Asha" })).toBe(
      "In custody: Asha",
    );
  });
  it("falls back to Unknown custodian when id present but name missing", () => {
    expect(custodianBadgeLabel({ custodian_employee_id: "e1" })).toBe(
      "In custody: Unknown custodian",
    );
  });
  it("returns null when no custodian", () => {
    expect(custodianBadgeLabel({ custodian_employee_id: null })).toBeNull();
    expect(custodianBadgeLabel({})).toBeNull();
  });
});

describe("filterByCustodian", () => {
  const rows = [
    { id: "a", custodian_employee_id: "e1" },
    { id: "b", custodian_employee_id: null },
    { id: "c", custodian_employee_id: undefined },
  ];
  it("all returns everything (default off)", () => {
    expect(filterByCustodian(rows, "all")).toHaveLength(3);
  });
  it("in-custody returns only rows with id", () => {
    expect(filterByCustodian(rows, "in-custody").map((r) => r.id)).toEqual(["a"]);
  });
  it("no-custodian returns rows without id", () => {
    expect(filterByCustodian(rows, "no-custodian").map((r) => r.id)).toEqual(["b", "c"]);
  });
});

describe("filterMyCarried / countCarriedByCustodian", () => {
  const rows = [
    { id: "a", custodian_employee_id: "e1" },
    { id: "b", custodian_employee_id: "e2" },
    { id: "c", custodian_employee_id: "e1" },
  ];
  it("filters to my id only, empty when no id", () => {
    expect(filterMyCarried(rows, "e1").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterMyCarried(rows, null)).toEqual([]);
    expect(filterMyCarried(rows, "")).toEqual([]);
  });
  it("counts per custodian", () => {
    expect(countCarriedByCustodian(rows)).toEqual({ e1: 2, e2: 1 });
  });
});
