import { describe, expect, it } from "vitest";
import {
  buildOraclesFromDefectiveParts,
  oracleIsComplete,
  sectionMissingFields,
  type OracleBlock,
} from "@/lib/indent";
import { identityKey, isIdentifyingSerial, sanitizeSerial } from "@/lib/serial";

describe("serial identity", () => {
  it.each([",", ".", "..", "...", ",,", "|", "-", "", "   "])("rejects the placeholder %j", (v) => {
    expect(isIdentifyingSerial(v)).toBe(false);
    expect(sanitizeSerial(v)).toBe("");
    expect(identityKey("0J-31-013149", v)).toBe("");
  });

  it.each(["W53182904G26D11500082", "111111", "A-1", "0"])("accepts %j", (v) => {
    expect(isIdentifyingSerial(v)).toBe(true);
    expect(identityKey("0j-31-013149", v)).toBe(`0J-31-013149|${v.toUpperCase()}`);
  });

  it("upper-trims stored serials", () => {
    expect(sanitizeSerial("  w53182904g26d11500082 ")).toBe("W53182904G26D11500082");
  });
});

describe("buildOraclesFromDefectiveParts", () => {
  it("drops placeholder serials and never merges two units of the same model", () => {
    const blocks = buildOraclesFromDefectiveParts([
      {
        name: "APC 0J-31-013149",
        model_no: "0J-31-013149",
        serial: ",",
        qty: "1",
        oracle_no: "41220083",
      },
      {
        name: "APC 0J-31-013149",
        model_no: "0J-31-013149",
        serial: ",",
        qty: "1",
        oracle_no: "41220083",
      },
      {
        name: "APC 0J-31-012914",
        model_no: "0J-31-012914",
        serial: ",",
        qty: "1",
        oracle_no: "41220083",
      },
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].defective_rows).toHaveLength(3);
    expect(blocks[0].defective_rows.map((r) => r.def_serial_no)).toEqual(["", "", ""]);
  });

  it("keeps a real serial (upper-trimmed) and groups rows by oracle", () => {
    const blocks = buildOraclesFromDefectiveParts([
      { model_no: "M1", serial: " abc123 ", qty: "1", oracle_no: "41220083" },
      { model_no: "M2", serial: "def456", qty: "1", oracle_no: "41229999" },
    ]);

    expect(blocks.map((b) => b.oracle_no)).toEqual(["41220083", "41229999"]);
    expect(blocks[0].defective_rows[0].def_serial_no).toBe("ABC123");
    expect(blocks[1].defective_rows[0].def_serial_no).toBe("DEF456");
  });
});

function completeBlock(defSerial: string): OracleBlock {
  return {
    oracle_no: "41220083",
    defective_rows: [{ def_model_no: "0J-31-013149", def_serial_no: defSerial, qty: "1" }],
    exchange_rows: [
      {
        warehouse_id: "w",
        warehouse_name: "W",
        model_no: "0J-31-013149",
        serial_no: "NEW1",
        qty: "1",
      },
    ],
    received_rows: [
      {
        warehouse_id: "w",
        warehouse_name: "W",
        model_no: "0J-31-013149",
        serial_no: "RCV1",
        qty: "1",
        received_date: "2026-10-19",
        remarks: "",
      },
    ],
    customer_received_rows: [
      {
        warehouse_id: "w",
        warehouse_name: "W",
        model_no: "0J-31-013149",
        serial_no: "CUST1",
        qty: "1",
        received_date: "2026-10-19",
        remarks: "",
        product_tag: "defective",
      },
    ],
    status: "open",
  };
}

describe("completeness gates", () => {
  it("treats a punctuation placeholder as a missing serial", () => {
    expect(oracleIsComplete(completeBlock(","))).toBe(false);
    expect(sectionMissingFields(completeBlock(","), "A")).toContain("Serial No");
  });

  it("accepts a real serial", () => {
    const block = completeBlock("W53182904G26D11500082");
    expect(oracleIsComplete(block)).toBe(true);
    expect(sectionMissingFields(block, "A")).not.toContain("Serial No");
  });
});
