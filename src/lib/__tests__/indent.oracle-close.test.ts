import {
  normalizeOracle,
  oracleIsComplete,
  sectionMissingFields,
  oracleDocRequirements,
  docSatisfied,
  docStatusSettled,
  oracleCanAutoClose,
  oracleProgress,
  buildOraclesFromDefectiveParts,
  requiresCustomerReturn,
} from "@/lib/indent";

// Mirrors the live stuck oracle 41220112: A/C/D full, Section B has a
// warehouse + qty but blank model/serial.
const stuckOracle = () => ({
  oracle_no: "41220112",
  status: "open",
  defective_rows: [
    {
      part_name: "APC BX1000UXI",
      def_model_no: "BX1000UXI",
      def_serial_no: "9B2532A16722",
      qty: "1",
    },
  ],
  exchange_rows: [
    {
      warehouse_id: "wh-roi-ggn",
      warehouse_name: "ROI-GGN",
      model_no: "",
      serial_no: "",
      qty: "1",
    },
  ],
  received_rows: [
    {
      warehouse_id: "wh-roi-ggn",
      warehouse_name: "ROI-GGN",
      model_no: "BX1000UXI",
      serial_no: "9B2524A11831",
      qty: "1",
      received_date: "2026-10-07",
    },
  ],
  customer_received_rows: [
    {
      warehouse_id: "wh-roi-ggn",
      warehouse_name: "ROI-GGN",
      model_no: "BX1000UXI",
      serial_no: "9B2524A11831",
      qty: "1",
      received_date: "2026-10-09",
      product_tag: "defective",
    },
  ],
});

const settledDocs = () => ({
  dc: { pending: 0, settled: 1 },
  oem_grn: { pending: 0, settled: 1 },
  customer_grn: { pending: 0, settled: 1 },
});

describe("indent/oracleIsComplete — the stuck-oracle rule", () => {
  it("is NOT complete when Section B model/serial are blank (reported bug)", () => {
    expect(oracleIsComplete(stuckOracle() as any, "rma_advance_exchange")).toBe(false);
  });

  it("becomes complete once Section B model+serial are filled (B was the blocker)", () => {
    const o = stuckOracle();
    o.exchange_rows[0].model_no = "BX1000UXI";
    o.exchange_rows[0].serial_no = "9B2524A11831";
    expect(oracleIsComplete(o as any, "rma_advance_exchange")).toBe(true);
  });

  it("is never complete with zero defective rows", () => {
    expect(oracleIsComplete({ defective_rows: [] } as any, "rma_advance_exchange")).toBe(false);
  });

  it("service_ship requires Section D once rows are normalized (prefilled serial trips custTouched)", () => {
    const o = stuckOracle() as any;
    o.customer_received_rows = [];
    o.exchange_rows[0].model_no = "BX1000UXI";
    o.exchange_rows[0].serial_no = "9B2524A11831";
    // normalizeOracle pads a customer row with the defective serial, which
    // counts as "touched" -> D (warehouse + received date) stays required.
    expect(oracleIsComplete(o, "rma_service_ship")).toBe(false);
    o.customer_received_rows = [
      {
        warehouse_id: "wh-roi-ggn",
        model_no: "BX1000UXI",
        serial_no: "9B2524A11831",
        qty: "1",
        received_date: "2026-10-09",
        product_tag: "defective",
      },
    ];
    expect(oracleIsComplete(o, "rma_service_ship")).toBe(true);
  });

  it("rma_service_ship WITH a touched customer row requires a full Section D", () => {
    const o = stuckOracle() as any;
    o.customer_received_rows = [{ warehouse_id: "wh-roi-ggn" }]; // touched, incomplete
    o.exchange_rows[0].model_no = "BX1000UXI";
    o.exchange_rows[0].serial_no = "9B2524A11831";
    expect(oracleIsComplete(o, "rma_service_ship")).toBe(false);
    o.customer_received_rows = [
      {
        warehouse_id: "wh-roi-ggn",
        model_no: "BX1000UXI",
        serial_no: "9B2524A11831",
        qty: "1",
        received_date: "2026-10-09",
        product_tag: "defective",
      },
    ];
    expect(oracleIsComplete(o, "rma_service_ship")).toBe(true);
  });
});

describe("indent/sectionMissingFields", () => {
  it("Section B reports exactly Model + Serial when warehouse+qty are set", () => {
    expect(sectionMissingFields(stuckOracle() as any, "B", "rma_advance_exchange")).toEqual([
      "Model",
      "Serial",
    ]);
  });

  it("Section D on a normalized-but-untouched row reports Warehouse + Received Date", () => {
    const o = stuckOracle() as any;
    o.customer_received_rows = [];
    // Padding pre-fills model/serial/qty/tag from the defective row.
    expect(sectionMissingFields(o, "D", "rma_service_ship")).toEqual([
      "Warehouse",
      "Received Date",
    ]);
  });
});

describe("indent/oracleDocRequirements — pipeline display contract", () => {
  it("service_ship + touched customer row => needCustomerGrn (pipeline must show D)", () => {
    const o = stuckOracle() as any;
    o.customer_received_rows = [{ warehouse_id: "wh-roi-ggn" }];
    expect(oracleDocRequirements(o, "rma_service_ship").needCustomerGrn).toBe(true);
  });

  it("service_ship with 'no' customer rows still needs customer GRN after padding (pipeline shows D)", () => {
    const o = stuckOracle() as any;
    o.customer_received_rows = [];
    expect(oracleDocRequirements(o, "rma_service_ship").needCustomerGrn).toBe(true);
  });

  it("exchange type with customer rows => needCustomerGrn true", () => {
    expect(
      oracleDocRequirements(stuckOracle() as any, "rma_advance_exchange").needCustomerGrn,
    ).toBe(true);
  });
});

describe("indent/docSatisfied + docStatusSettled", () => {
  it("docSatisfied is false without a counts object", () => {
    expect(docSatisfied(undefined as any)).toBe(false);
  });

  it("docSatisfied needs settled>0 AND pending===0", () => {
    expect(docSatisfied({ pending: 0, settled: 0 } as any)).toBe(false);
    expect(docSatisfied({ pending: 1, settled: 1 } as any)).toBe(false);
    expect(docSatisfied({ pending: 0, settled: 2 } as any)).toBe(true);
  });

  it("docStatusSettled accepts Submitted/Closed/Challan Generated (any case)", () => {
    for (const s of [
      "Submitted",
      "Closed",
      "Challan Generated",
      "submitted",
      "challan generated",
    ]) {
      expect(docStatusSettled(s)).toBe(true);
    }
  });

  it("docStatusSettled rejects Draft/Cancelled/blank", () => {
    for (const s of ["Draft", "Cancelled", "", null, undefined]) {
      expect(docStatusSettled(s as any)).toBe(false);
    }
  });
});

describe("indent/oracleCanAutoClose", () => {
  it("closes when rows are full and every required doc is settled", () => {
    const o = stuckOracle();
    o.exchange_rows[0].model_no = "BX1000UXI";
    o.exchange_rows[0].serial_no = "9B2524A11831";
    expect(oracleCanAutoClose(o as any, settledDocs() as any, "rma_advance_exchange")).toBe(true);
  });

  it("stays open when the DC is still pending", () => {
    const o = stuckOracle();
    o.exchange_rows[0].model_no = "BX1000UXI";
    o.exchange_rows[0].serial_no = "9B2524A11831";
    const docs = settledDocs() as any;
    docs.dc = { pending: 1, settled: 0 };
    expect(oracleCanAutoClose(o as any, docs, "rma_advance_exchange")).toBe(false);
  });

  it("stays open when doc counts are missing (unlinked docs must not close)", () => {
    const o = stuckOracle();
    o.exchange_rows[0].model_no = "BX1000UXI";
    o.exchange_rows[0].serial_no = "9B2524A11831";
    expect(oracleCanAutoClose(o as any, undefined, "rma_advance_exchange")).toBe(false);
  });

  it("never closes on documents alone while Section B is blank", () => {
    expect(
      oracleCanAutoClose(stuckOracle() as any, settledDocs() as any, "rma_advance_exchange"),
    ).toBe(false);
  });
});

describe("indent/oracleProgress", () => {
  it("maps closed / untouched / partial blocks", () => {
    expect(oracleProgress({ status: "closed" } as any, "rma_advance_exchange")).toBe("closed");
    expect(
      oracleProgress(
        { defective_rows: [], exchange_rows: [], received_rows: [] } as any,
        "rma_advance_exchange",
      ),
    ).toBe("pending");
    expect(oracleProgress(stuckOracle() as any, "rma_advance_exchange")).toBe("in_progress");
  });
});

describe("indent/normalizeOracle seeding contract", () => {
  it("B seeds blank (qty only); C seeds model; D seeds model+serial+tag", () => {
    const n = normalizeOracle({
      defective_rows: [{ def_model_no: "M1", def_serial_no: "S1", qty: "2" }],
      exchange_rows: [],
      received_rows: [],
      customer_received_rows: [],
    } as any);
    expect(n.exchange_rows[0].model_no).toBe("");
    expect(n.exchange_rows[0].serial_no).toBe("");
    expect(n.exchange_rows[0].qty).toBe("2");
    expect(n.received_rows[0].model_no).toBe("M1");
    expect(n.received_rows[0].serial_no).toBe("");
    expect(n.customer_received_rows![0].model_no).toBe("M1");
    expect(n.customer_received_rows![0].serial_no).toBe("S1");
    expect(n.customer_received_rows![0].product_tag).toBe("defective");
  });
});

describe("indent/buildOraclesFromDefectiveParts empty input", () => {
  it("returns [] — the precondition the resync guard protects", () => {
    expect(buildOraclesFromDefectiveParts([])).toEqual([]);
  });
});

describe("indent/requiresCustomerReturn", () => {
  it("requires D for exchange types, not for service_ship; undefined counts as exchange", () => {
    expect(requiresCustomerReturn("rma_advance_exchange")).toBe(true);
    expect(requiresCustomerReturn("rma_exchange")).toBe(true);
    expect(requiresCustomerReturn("rma_service_ship")).toBe(false);
    // NOTE: undefined => true on the client; the DB trigger treats a NULL
    // indent_type as not-requiring-D, and the revalidator mirrors the DB.
    expect(requiresCustomerReturn(undefined)).toBe(true);
  });
});
