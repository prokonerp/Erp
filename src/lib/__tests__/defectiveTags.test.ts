import { describe, expect, it } from "vitest";
import {
  dedupeDefectiveRecords,
  findTagIdentityConflict,
  type DefectiveInRecord,
} from "@/lib/defectiveTags";

function rec(patch: Partial<DefectiveInRecord>): DefectiveInRecord {
  return {
    key: "k",
    source: "txn",
    txn_id: null,
    stock_item_id: null,
    txn_no: null,
    txn_date: "2026-10-22",
    service_request_no: null,
    oem_ref_id: null,
    oracle_order_no: null,
    model_no: "MODEL",
    part_name: null,
    serial_no: "SN1",
    customer_name: null,
    asp_code: null,
    warehouse_id: null,
    engineer_name: null,
    replacement_date: null,
    reason: null,
    tag_generated: false,
    tag_no: null,
    is_available: false,
    sent_to_oem: false,
    ...patch,
  };
}

describe("defective tag identity guards", () => {
  it("dedupes the same transaction row", () => {
    const a = rec({ key: "txn:a", txn_id: "a" });
    const b = rec({ key: "txn:a", txn_id: "a", reason: "duplicate" });
    expect(dedupeDefectiveRecords([a, b])).toEqual([a]);
  });

  it("keeps two different source rows even when model+serial match", () => {
    const a = rec({ key: "txn:a", txn_id: "a" });
    const b = rec({ key: "txn:b", txn_id: "b" });
    const out = dedupeDefectiveRecords([a, b]);
    expect(out).toHaveLength(2);
    expect(findTagIdentityConflict(out)).toMatchObject({
      model: "MODEL",
      serial: "SN1",
      sources: ["txn:a", "txn:b"],
    });
  });

  it("does not flag the same source twice", () => {
    const a = rec({ key: "stock:s", stock_item_id: "s" });
    expect(findTagIdentityConflict(dedupeDefectiveRecords([a, { ...a }]))).toBeNull();
  });

  it("does not flag placeholders or different models", () => {
    expect(
      findTagIdentityConflict([
        rec({ txn_id: "a", serial_no: "," }),
        rec({ txn_id: "b", serial_no: "..." }),
      ]),
    ).toBeNull();
    expect(
      findTagIdentityConflict([
        rec({ txn_id: "a", model_no: "M1" }),
        rec({ txn_id: "b", model_no: "M2" }),
      ]),
    ).toBeNull();
  });

  it("flags two stock rows sharing one serial", () => {
    expect(
      findTagIdentityConflict([
        rec({ txn_id: null, stock_item_id: "s1", key: "stock:s1", source: "stock" }),
        rec({ txn_id: null, stock_item_id: "s2", key: "stock:s2", source: "stock" }),
      ])?.sources,
    ).toEqual(["stock:s1", "stock:s2"]);
  });
});
