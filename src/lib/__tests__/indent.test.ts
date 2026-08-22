import {
  normalizeOracle,
  buildOraclesFromDefectiveParts,
  indentStatusFromOracles,
  indentClosedAt,
  oracleStatus,
} from "@/lib/indent";

describe("indent/normalizeOracle", () => {
  it("migrates a legacy single-row oracle into row arrays", () => {
    const n = normalizeOracle({
      defective: { def_model_no: "M1", def_serial_no: "S1", qty: "2" },
    } as any);
    expect(n.defective_rows).toHaveLength(1);
    expect(n.defective_rows[0].def_model_no).toBe("M1");
    expect(n.exchange_rows).toHaveLength(1);
    expect(n.received_rows).toHaveLength(1);
  });

  it("pads exchange/received arrays to match defective row count", () => {
    const o: any = {
      defective_rows: [
        { def_model_no: "M1", def_serial_no: "S1", qty: "2" },
        { def_model_no: "M2", def_serial_no: "S2", qty: "1" },
      ],
      exchange_rows: [{ warehouse_id: "", warehouse_name: "", model_no: "", serial_no: "", qty: "2" }],
      received_rows: [],
    };
    const n = normalizeOracle(o);
    expect(n.defective_rows).toHaveLength(2);
    expect(n.exchange_rows).toHaveLength(2);
    expect(n.received_rows).toHaveLength(2);
  });
});

describe("indent/buildOraclesFromDefectiveParts", () => {
  it("groups parts by oracle_no, with unassigned parts in their own block", () => {
    const parts = [
      { oracle_no: "OR1", name: "A", model_no: "M1", serial: "S1", qty: 2 },
      { oracle_no: "OR1", name: "B", qty: 1 },
      { name: "C", qty: 1 },
    ];
    const blocks = buildOraclesFromDefectiveParts(parts);
    expect(blocks).toHaveLength(2);

    const or1 = blocks.find((b) => b.oracle_no === "OR1")!;
    expect(or1.defective_rows).toHaveLength(2);
    expect(or1.status).toBe("open");
    expect(or1.exchange_rows).toHaveLength(2);
    expect(or1.received_rows).toHaveLength(2);

    const unassigned = blocks.find((b) => b.oracle_no === "")!;
    expect(unassigned.defective_rows).toHaveLength(1);
    expect(unassigned.defective_rows[0].part_name).toBe("C");
  });
});

describe("indent/indentStatusFromOracles", () => {
  it("is open when there are no oracles", () => {
    expect(indentStatusFromOracles([])).toBe("open");
    expect(indentStatusFromOracles(null)).toBe("open");
  });
  it("is closed only when every oracle is closed", () => {
    expect(indentStatusFromOracles([{ status: "closed" } as any])).toBe("closed");
    expect(
      indentStatusFromOracles([{ status: "closed" } as any, { status: "open" } as any]),
    ).toBe("open");
  });
});

describe("indent/indentClosedAt", () => {
  it("returns null while any oracle is open", () => {
    expect(indentClosedAt([{ status: "open" } as any])).toBeNull();
  });
  it("returns the latest closed_at across closed oracles", () => {
    const a = indentClosedAt([
      { status: "closed", closed_at: "2026-01-01T10:00:00Z" } as any,
      { status: "closed", closed_at: "2026-03-01T10:00:00Z" } as any,
    ]);
    expect(a).toBe(new Date("2026-03-01T10:00:00Z").toISOString());
  });
  it("returns null when closed oracles have no valid timestamps", () => {
    expect(indentClosedAt([{ status: "closed", closed_at: null } as any])).toBeNull();
  });
});

describe("indent/oracleStatus", () => {
  it("maps status field to open/closed", () => {
    expect(oracleStatus({ status: "closed" } as any)).toBe("closed");
    expect(oracleStatus({ status: "open" } as any)).toBe("open");
  });
});
