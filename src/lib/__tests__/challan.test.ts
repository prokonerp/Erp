import { isChallanEditable } from "@/lib/challan";

describe("isChallanEditable", () => {
  it("blocks editing for settled / terminal statuses", () => {
    expect(isChallanEditable("Challan Generated")).toBe(false);
    expect(isChallanEditable("Submitted")).toBe(false);
    expect(isChallanEditable("Cancelled")).toBe(false);
  });

  it("allows editing for open statuses", () => {
    expect(isChallanEditable("Draft")).toBe(true);
    expect(isChallanEditable("")).toBe(true);
  });

  it("is case/space tolerant", () => {
    expect(isChallanEditable("  challan generated  ")).toBe(false);
  });
});
