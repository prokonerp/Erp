import {
  emptyGrnItem,
  missingAttributionRows,
  type GrnItem,
} from "@/lib/grn";

const row = (patch: Partial<GrnItem>): GrnItem => ({
  ...emptyGrnItem(),
  ...patch,
});

describe("grn/missingAttributionRows", () => {
  it("returns [] for standalone GRNs (no indent linked), even with blank oracle_no", () => {
    const items = [row({ part_no: "P1", part_name: "Motor" })];
    expect(missingAttributionRows(items, "")).toEqual([]);
    expect(missingAttributionRows(items, null)).toEqual([]);
    expect(missingAttributionRows(items, undefined)).toEqual([]);
  });

  it("reports 1-indexed displayed row numbers missing oracle_no when indent linked", () => {
    const items = [
      row({ part_no: "P1", part_name: "Motor", oracle_no: "41207623" }),
      row({ part_no: "P2", part_name: "Drive" }),
      row({ part_no: "", part_name: "" }), // blank row ignored, numbering untouched
      row({ part_no: "P4", part_name: "Fan", oracle_no: "  " }),
    ];
    expect(missingAttributionRows(items, "indent-123")).toEqual([2, 4]);
  });

  it("returns [] when every material row has an oracle_no", () => {
    const items = [
      row({ part_no: "P1", part_name: "Motor", oracle_no: "OR1" }),
      row({ part_no: "P2", part_name: "Drive", oracle_no: "or1" }),
    ];
    expect(missingAttributionRows(items, "indent-123")).toEqual([]);
  });
});
