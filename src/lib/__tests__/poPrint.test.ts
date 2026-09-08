import { describe, it, expect } from "vitest";
import { resolvePoLetterhead, DEFAULT_PO_LOGO } from "@/lib/poPrint";
import { DEFAULT_COMPANY_PROFILE } from "@/lib/companyProfile";

const company = {
  ...DEFAULT_COMPANY_PROFILE,
  regd_address: "Regd: B-505, Sector-61, Gurgaon",
  factory_address: "Factory: Plot 12, Ind Area",
  sales_office_address: "Sales: MG Road, New Delhi",
};
const branch = { id: "b1", name: "Delhi", address: "Branch: Nehru Place, Delhi", is_default: true } as any;

describe("resolvePoLetterhead", () => {
  it("defaults to branch address", () => {
    const r = resolvePoLetterhead({ source: "branch", branch, company });
    expect(r.address).toBe("Branch: Nehru Place, Delhi");
    expect(r.officialLabel).toBe("Branch");
  });
  it("resolves registered office from company profile", () => {
    const r = resolvePoLetterhead({ source: "company_registered", branch, company });
    expect(r.address).toBe("Regd: B-505, Sector-61, Gurgaon");
  });
  it("falls back to branch when company office is empty", () => {
    const r = resolvePoLetterhead({ source: "company_sales", branch, company: { ...company, sales_office_address: null } });
    expect(r.address).toBe("Branch: Nehru Place, Delhi");
  });
  it("falls back to branch when branch missing", () => {
    const r = resolvePoLetterhead({ source: "company_factory", branch: null, company: { ...company, factory_address: null } });
    expect(r.address).toBe("");
  });
});

describe("DEFAULT_PO_LOGO", () => {
  it("is the preloaded prokon logo", () => {
    expect(DEFAULT_PO_LOGO).toBe("/prokon-logo.jpeg");
  });
});
