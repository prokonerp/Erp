import { describe, it, expect } from "vitest";
import {
  esc,
  tallyDate,
  tallyAmount,
  tallyQty,
  taxLedgerName,
  gstBuckets,
  buildSalesVoucher,
  buildReceiptVoucher,
  assertVoucherBalances,
  voucherXml,
  tallyImportEnvelope,
  parseTallyResponse,
  buildSalesExport,
  looksFabricatedIrn,
  salesCsv,
  recomputeInvoiceTotals,
  DEFAULT_LEDGER_MAP,
  type TallyInvoiceRow,
  type TallyInvoiceItemRow,
} from "@/lib/tallyExport";

// ── fixtures ────────────────────────────────────────────────────────────────
// Intra-state invoice, 2 items at different GST rates → proves per-rate buckets.
const inv: TallyInvoiceRow = {
  id: "11111111-1111-1111-1111-111111111111",
  invoice_no: "PHS/INV/26-27/0008",
  invoice_date: "2026-09-14",
  branch_id: "b1",
  customer_id: "c1",
  buyer_name: "Customer ABC Pvt Ltd",
  buyer_gstin: "05AAAPG7885R002",
  buyer_state_code: "05",
  seller_state_code: "05",
  is_interstate: false,
  sales_type: "local_itemwise",
  taxable_value: 20762.71,
  discount: 0,
  cgst: 1868.64,
  sgst: 1868.64,
  igst: 0,
  cess: 0,
  round_off: 0.01,
  total: 24500.0,
  status: "issued",
};

const items: TallyInvoiceItemRow[] = [
  {
    sr_no: 1,
    description: "UPS-600VA",
    item_name: "UPS-600VA",
    hsn: "8504",
    qty: 2,
    unit: "NOS",
    rate: 9000,
    gst_rate: 18,
    taxable_value: 18000,
    cgst: 1620,
    sgst: 1620,
    igst: 0,
    line_total: 21240,
  },
  {
    sr_no: 2,
    description: "Battery 42Ah",
    item_name: "Battery 42Ah",
    hsn: "8507",
    qty: 1,
    unit: "NOS",
    rate: 2762.71,
    gst_rate: 18,
    taxable_value: 2762.71,
    cgst: 248.64,
    sgst: 248.64,
    igst: 0,
    line_total: 3260,
  },
];

describe("formatting helpers", () => {
  it("escapes XML metacharacters", () => {
    expect(esc(`A & B <"x"> 'y'`)).toBe("A &amp; B &lt;&quot;x&quot;&gt; &apos;y&apos;");
  });

  it("escapes null/undefined to empty string", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  it("converts ISO date to Tally YYYYMMDD", () => {
    expect(tallyDate("2026-09-14")).toBe("20260914");
    expect(tallyDate("2026-01-05")).toBe("20260105");
  });

  it("throws on an unparseable date instead of emitting a wrong one", () => {
    expect(() => tallyDate("not-a-date")).toThrow();
    expect(() => tallyDate(null)).toThrow();
  });

  it("formats amounts to 2dp and avoids exponential notation", () => {
    expect(tallyAmount(24500)).toBe("24500.00");
    expect(tallyAmount(0.005)).toBe("0.01");
    expect(tallyAmount(-1868.64)).toBe("-1868.64");
    expect(tallyAmount(null)).toBe("0.00");
    expect(tallyAmount(1e21)).not.toMatch(/e\+/i);
  });

  it("formats quantity with a unit, defaulting to NOS", () => {
    expect(tallyQty(2, "NOS")).toBe("2 NOS");
    expect(tallyQty(1.5, "KGS")).toBe("1.5 KGS");
    expect(tallyQty(3, null)).toBe("3 NOS");
    expect(tallyQty(3, "  ")).toBe("3 NOS");
  });

  it("names tax ledgers conventionally and honours overrides", () => {
    expect(taxLedgerName("CGST", 9)).toBe("CGST 9%");
    expect(taxLedgerName("IGST", 18)).toBe("IGST 18%");
    expect(
      taxLedgerName("CGST", 9, { ...DEFAULT_LEDGER_MAP, taxOverrides: { CGST9: "Central Tax 9" } }),
    ).toBe("Central Tax 9");
  });
});

describe("gstBuckets", () => {
  it("aggregates per rate and keeps CGST/SGST separate (intra-state)", () => {
    const b = gstBuckets(items, false);
    const map = Object.fromEntries(b.map((x) => [x.ledger, x.amount]));
    expect(map["CGST 18%"]).toBe(1868.64);
    expect(map["SGST 18%"]).toBe(1868.64);
    expect(map["IGST 18%"]).toBeUndefined();
  });

  it("uses IGST instead of CGST/SGST when interstate", () => {
    const interstate = items.map((i) => ({ ...i, igst: 1868.64, cgst: 0, sgst: 0 }));
    const b = gstBuckets(interstate, true);
    const ledgers = b.map((x) => x.ledger);
    expect(ledgers).toContain("IGST 18%");
    expect(ledgers).not.toContain("CGST 18%");
    expect(ledgers.find((l) => l === "IGST 18%")).toBeTruthy();
  });

  it("emits one bucket per distinct rate", () => {
    const mixed: TallyInvoiceItemRow[] = [
      { description: "a", qty: 1, rate: 100, gst_rate: 5, cgst: 2.5, sgst: 2.5, igst: 0 },
      { description: "b", qty: 1, rate: 100, gst_rate: 18, cgst: 9, sgst: 9, igst: 0 },
    ];
    const ledgers = gstBuckets(mixed, false)
      .map((x) => x.ledger)
      .sort();
    expect(ledgers).toEqual(["CGST 18%", "CGST 5%", "SGST 18%", "SGST 5%"]);
  });

  it("drops zero-amount buckets", () => {
    const zero: TallyInvoiceItemRow[] = [
      { description: "a", qty: 1, rate: 100, gst_rate: 0, cgst: 0, sgst: 0, igst: 0 },
    ];
    expect(gstBuckets(zero, false)).toHaveLength(0);
  });
});

describe("buildSalesVoucher", () => {
  const v = buildSalesVoucher({ invoice: inv, items });

  it("signs the party entry negative (Tally deemed-positive convention)", () => {
    const party = v.ledgerEntries.find((e) => e.isPartyLedger);
    expect(party?.amount).toBe(-24500);
    expect(party?.isDeemedPositive).toBe(true);
  });

  it("credits sales with the taxable value", () => {
    const sales = v.ledgerEntries.find((e) => e.ledger === DEFAULT_LEDGER_MAP.sales);
    expect(sales?.amount).toBe(20762.71);
    expect(sales?.isDeemedPositive).toBe(false);
  });

  it("includes GST buckets and the round-off line", () => {
    const byLedger = Object.fromEntries(v.ledgerEntries.map((e) => [e.ledger, e.amount]));
    expect(byLedger["CGST 18%"]).toBe(1868.64);
    expect(byLedger["SGST 18%"]).toBe(1868.64);
    expect(byLedger["Round Off"]).toBe(0.01);
  });

  it("carries branch narration, reference and GUID", () => {
    const withBranch = buildSalesVoucher({
      invoice: inv,
      items,
      branch: { id: "b1", name: "Jaipur Main" },
    });
    expect(withBranch.narration).toContain("[Jaipur Main]");
    expect(withBranch.reference).toBe("PHS/INV/26-27/0008");
    expect(withBranch.guid).toBe(inv.id);
  });

  it("builds inventory entries from the lines", () => {
    expect(v.inventoryEntries).toHaveLength(2);
    expect(v.inventoryEntries[0].itemName).toBe("UPS-600VA");
    expect(v.inventoryEntries[0].qty).toBe(2);
    expect(v.inventoryEntries[0].amount).toBe(18000);
    expect(v.inventoryEntries[0].hsn).toBe("8504");
  });
});

describe("assertVoucherBalances", () => {
  it("balances a correctly built sales voucher", () => {
    const v = buildSalesVoucher({ invoice: inv, items });
    const check = assertVoucherBalances(v);
    expect(check.balanced).toBe(true);
    expect(check.sum).toBe(0);
    expect(check.expected).toBe(24500);
  });

  it("balances a voucher with a header discount (taxable_value is stored NET)", () => {
    // invoices.taxable_value is net of discount, so Sales must be credited GROSS
    // and the discount debited as a contra. Crediting net AND debiting discount
    // would leave the voucher short by exactly the discount.
    const discounted: TallyInvoiceRow = {
      ...inv,
      taxable_value: 900,
      discount: 100,
      cgst: 81,
      sgst: 81,
      round_off: 0,
      total: 1062,
    };
    const v = buildSalesVoucher({
      invoice: discounted,
      items: [
        {
          description: "a",
          qty: 1,
          rate: 1000,
          gst_rate: 18,
          taxable_value: 900,
          cgst: 81,
          sgst: 81,
          igst: 0,
        },
      ],
    });
    const sales = v.ledgerEntries.find((e) => e.ledger === DEFAULT_LEDGER_MAP.sales);
    const disc = v.ledgerEntries.find((e) => e.ledger === DEFAULT_LEDGER_MAP.discount);
    expect(sales?.amount).toBe(1000); // gross
    expect(disc?.amount).toBe(-100); // contra
    const check = assertVoucherBalances(v, discounted.total);
    expect(check.balanced).toBe(true);
    expect(check.sum).toBe(0);
  });

  it("balances with a NEGATIVE round-off", () => {
    const v = buildSalesVoucher({
      invoice: { ...inv, round_off: -0.4, total: 1179.6, taxable_value: 1000, cgst: 90, sgst: 90 },
      items: [
        {
          description: "a",
          qty: 1,
          rate: 1000,
          gst_rate: 18,
          taxable_value: 1000,
          cgst: 90,
          sgst: 90,
          igst: 0,
        },
      ],
    });
    const ro = v.ledgerEntries.find((e) => e.ledger === DEFAULT_LEDGER_MAP.roundOff);
    expect(ro?.amount).toBe(-0.4);
    expect(ro?.isDeemedPositive).toBe(true); // sign and flag must agree
    expect(assertVoucherBalances(v, 1179.6).balanced).toBe(true);
  });

  it("balances when there are no items", () => {
    const v = buildSalesVoucher({
      invoice: { ...inv, taxable_value: 0, cgst: 0, sgst: 0, round_off: 0, total: 0 },
      items: [],
    });
    expect(assertVoucherBalances(v, 0).balanced).toBe(true);
  });

  it("detects an unbalanced voucher", () => {
    const v = buildSalesVoucher({ invoice: inv, items });
    v.ledgerEntries[0].amount = -24000; // corrupt the party debit
    expect(assertVoucherBalances(v).balanced).toBe(false);
  });

  it("balances a voucher with no GST", () => {
    const v = buildSalesVoucher({
      invoice: { ...inv, cgst: 0, sgst: 0, round_off: 0, total: 100, taxable_value: 100 },
      items: [{ description: "svc", qty: 1, rate: 100, gst_rate: 0, cgst: 0, sgst: 0, igst: 0 }],
    });
    expect(assertVoucherBalances(v).balanced).toBe(true);
  });

  it("balances a receipt voucher", () => {
    const r = buildReceiptVoucher({
      payment: {
        id: "p1",
        payment_no: "RCP/1",
        payment_date: "2026-09-15",
        customer_id: "c1",
        mode: "bank",
        amount: 5000,
      },
      partyLedger: "Customer ABC Pvt Ltd",
    });
    const check = assertVoucherBalances(r);
    expect(check.balanced).toBe(true);
    const bank = r.ledgerEntries.find((e) => e.ledger === "Bank Account");
    expect(bank?.amount).toBe(-5000);
  });
});

describe("voucherXml", () => {
  const xml = voucherXml(buildSalesVoucher({ invoice: inv, items }));

  it("emits a well-formed voucher with required Tally tags", () => {
    expect(xml).toMatch(/^<VOUCHER VCHTYPE="Sales"/);
    expect(xml).toContain("<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>");
    expect(xml).toContain("<DATE>20260914</DATE>");
    expect(xml).toContain("<VOUCHERNUMBER>PHS/INV/26-27/0008</VOUCHERNUMBER>");
    expect(xml).toContain("<PARTYLEDGERNAME>Customer ABC Pvt Ltd</PARTYLEDGERNAME>");
    expect(xml).toContain("<GUID>11111111-1111-1111-1111-111111111111</GUID>");
    expect(xml).toContain("<ALLLEDGERENTRIES.LIST>");
    expect(xml).toContain("<INVENTORYENTRIES.LIST>");
    expect(xml.endsWith("</VOUCHER>")).toBe(true);
  });

  it("emits ISTDEEMEDPOSITIVE and AMOUNT for every ledger entry", () => {
    const entries = xml.match(/<ALLLEDGERENTRIES\.LIST>/g) ?? [];
    const amounts = xml.match(/<AMOUNT>/g) ?? [];
    expect(entries.length).toBe(5); // party, sales, cgst, sgst, roundoff
    // 5 voucher-level AMOUNTs + 2 per inventory entry (item amount +
    // ACCOUNTINGALLOCATIONS amount) × 2 items = 9
    expect(amounts.length).toBe(9);
  });

  it("omits IRN/EWB tags when they are absent", () => {
    expect(xml).not.toContain("<IRNNO>");
    expect(xml).not.toContain("<EWAYBILLNO>");
  });

  it("includes IRN and EWB tags when present", () => {
    const withIrn = voucherXml(
      buildSalesVoucher({
        invoice: {
          ...inv,
          irn: "a".repeat(64),
          ack_date: "2026-09-14",
          ewaybill_no: "321009218808",
        },
        items,
      }),
    );
    expect(withIrn).toContain(`<IRNNO>${"a".repeat(64)}</IRNNO>`);
    expect(withIrn).toContain("<IRNDATE>20260914</IRNDATE>");
    expect(withIrn).toContain("<EWAYBILLNO>321009218808</EWAYBILLNO>");
  });

  it("escapes party names containing XML metacharacters", () => {
    const x = voucherXml(
      buildSalesVoucher({ invoice: { ...inv, buyer_name: "Ram & Sons <Pvt>" }, items }),
    );
    expect(x).toContain("<PARTYLEDGERNAME>Ram &amp; Sons &lt;Pvt&gt;</PARTYLEDGERNAME>");
    expect(x).not.toContain("<Pvt>");
  });
});

describe("tallyImportEnvelope", () => {
  it("wraps vouchers in the Import Data envelope", () => {
    const env = tallyImportEnvelope([voucherXml(buildSalesVoucher({ invoice: inv, items }))]);
    expect(env).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(env).toContain("<REPORTNAME>Vouchers</REPORTNAME>");
    expect(env).toContain('<TALLYMESSAGE xmlns:UDF="TallyUDF">');
    expect(env.startsWith("<ENVELOPE>")).toBe(true);
    expect(env.endsWith("</ENVELOPE>")).toBe(true);
  });

  it("produces one TALLYMESSAGE per voucher", () => {
    const env = tallyImportEnvelope([
      voucherXml(buildSalesVoucher({ invoice: inv, items })),
      voucherXml(buildSalesVoucher({ invoice: inv, items })),
    ]);
    expect(env.match(/<TALLYMESSAGE/g)).toHaveLength(2);
  });
});

describe("parseTallyResponse", () => {
  it("parses a successful import response", () => {
    const r = parseTallyResponse(
      "<ENVELOPE><BODY><DATA><LINE><TALLYRESPONSE>" +
        "<CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS>" +
        "</TALLYRESPONSE></LINE></DATA></BODY></ENVELOPE>",
    );
    expect(r.created).toBe(1);
    expect(r.errors).toBe(0);
    expect(r.lineError).toBeNull();
  });

  it("surfaces a LINEERROR even though Tally returns HTTP 200", () => {
    const r = parseTallyResponse(
      "<ENVELOPE><BODY><DATA><LINE><TALLYRESPONSE>" +
        "<CREATED>0</CREATED><ERRORS>1</ERRORS>" +
        "<LINEERROR>Ledger &quot;Foo&quot; does not exist</LINEERROR>" +
        "</TALLYRESPONSE></LINE></DATA></BODY></ENVELOPE>",
    );
    expect(r.errors).toBe(1);
    expect(r.lineError).toContain("does not exist");
  });

  it("defaults to zeroes on a malformed response", () => {
    const r = parseTallyResponse("<html>not tally</html>");
    expect(r.created).toBe(0);
    expect(r.errors).toBe(0);
  });
});

describe("buildSalesExport", () => {
  const itemsByInvoice = new Map([[inv.id, items]]);

  it("builds one voucher and a single envelope", () => {
    const res = buildSalesExport({ invoices: [inv], itemsByInvoice });
    expect(res.voucherCount).toBe(1);
    expect(res.unbalanced).toHaveLength(0);
    expect(res.xml).toContain("<TALLYMESSAGE");
  });

  it("skips cancelled invoices", () => {
    const res = buildSalesExport({
      invoices: [inv, { ...inv, id: "x", status: "cancelled" }],
      itemsByInvoice,
    });
    expect(res.voucherCount).toBe(1);
    expect(res.skippedCancelled).toBe(1);
  });

  it("attaches branch names via branchesById", () => {
    const res = buildSalesExport({
      invoices: [inv],
      itemsByInvoice,
      branchesById: new Map([["b1", { id: "b1", name: "Jaipur Main" }]]),
    });
    expect(res.vouchers[0].narration).toContain("[Jaipur Main]");
  });

  it("reports an unbalanced voucher instead of hiding it", () => {
    const broken: TallyInvoiceRow = { ...inv, total: 99999 }; // header disagrees with lines+GST
    const res = buildSalesExport({ invoices: [broken], itemsByInvoice });
    expect(res.unbalanced).toHaveLength(1);
    expect(res.unbalanced[0].voucherNumber).toBe(inv.invoice_no);
  });
});

describe("salesCsv", () => {
  it("emits a header plus one row per ledger entry", () => {
    const res = buildSalesExport({ invoices: [inv], itemsByInvoice: new Map([[inv.id, items]]) });
    const lines = salesCsv(res).split("\n");
    expect(lines[0]).toContain("voucher_type,voucher_date,voucher_number,party_ledger");
    expect(lines.length).toBe(6); // header + 5 ledger entries
    expect(lines[1]).toContain("14-09-2026");
  });

  it("quotes cells containing commas", () => {
    const res = buildSalesExport({
      invoices: [{ ...inv, buyer_name: "Smith, Jones & Co" }],
      itemsByInvoice: new Map([[inv.id, items]]),
    });
    expect(salesCsv(res)).toContain('"Smith, Jones & Co"');
  });
});

describe("recomputeInvoiceTotals", () => {
  it("reproduces the stored intra-state totals from the lines", () => {
    const t = recomputeInvoiceTotals({
      sellerStateCode: "05",
      buyerStateCode: "05",
      items,
      salesType: "local_itemwise",
    });
    expect(t.taxable_value).toBe(20762.71);
    // NOTE: the engine rounds CGST and SGST independently *per line*, so an
    // odd-paisa line can leave them one paisa apart (248.65 vs 248.64 on the
    // 2762.71 line). The invoice header stores 1868.64/1868.64. That is exactly
    // what `drift` reports in buildSalesExport — the export posts the STORED
    // header (that is what the IRN and the customer's paper say), while this
    // recompute is a detector, not a source of truth.
    expect(t.cgst).toBe(1868.65);
    expect(t.sgst).toBe(1868.64);
    expect(t.igst).toBe(0);
  });

  it("switches to IGST for an inter-state buyer", () => {
    const t = recomputeInvoiceTotals({
      sellerStateCode: "05",
      buyerStateCode: "09",
      items,
      salesType: "local_itemwise",
    });
    expect(t.igst).toBe(3737.29);
    expect(t.cgst).toBe(0);
    expect(t.sgst).toBe(0);
  });
});

describe("looksFabricatedIrn / reference warnings", () => {
  it("detects the deprecated mockIrnPayload pattern (8-hex block x 8)", () => {
    expect(looksFabricatedIrn("f31a6ff6".repeat(8))).toBe(true);
    expect(looksFabricatedIrn("e64b2b54".repeat(8))).toBe(true);
  });

  it("accepts a realistic non-repeating 64-hex IRN", () => {
    const real = "d812d43cf9a8951e25973390fcd2b2fbaa4786e77a277768422e7302d50fcdec";
    expect(real).toHaveLength(64);
    expect(looksFabricatedIrn(real)).toBe(false);
  });

  it("ignores absent or wrong-length values", () => {
    expect(looksFabricatedIrn(null)).toBe(false);
    expect(looksFabricatedIrn("")).toBe(false);
    expect(looksFabricatedIrn("abc")).toBe(false);
  });

  it("warns about a fabricated IRN on a real voucher", () => {
    const fake: TallyInvoiceRow = { ...inv, irn: "f31a6ff6".repeat(8) };
    const res = buildSalesExport({
      invoices: [fake],
      itemsByInvoice: new Map([[fake.id, items]]),
    });
    expect(res.referenceWarnings).toHaveLength(1);
    expect(res.referenceWarnings[0].field).toBe("irn");
  });

  it("warns about a non-12-digit E-Way Bill number", () => {
    const bad: TallyInvoiceRow = { ...inv, ewaybill_no: "1234567890123" };
    const res = buildSalesExport({
      invoices: [bad],
      itemsByInvoice: new Map([[bad.id, items]]),
    });
    expect(res.referenceWarnings.some((w) => w.field === "ewaybill_no")).toBe(true);
  });

  it("strips fabricated references from the emitted XML when asked", () => {
    const fake: TallyInvoiceRow = {
      ...inv,
      irn: "f31a6ff6".repeat(8),
      ewaybill_no: "EWB83440626047",
    };
    const plain = buildSalesExport({
      invoices: [fake],
      itemsByInvoice: new Map([[fake.id, items]]),
    });
    // Without stripping, the fabricated values reach the XML.
    expect(plain.xml).toContain("<IRNNO>");
    expect(plain.xml).toContain("<EWAYBILLNO>");

    const stripped = buildSalesExport({
      invoices: [fake],
      itemsByInvoice: new Map([[fake.id, items]]),
      stripBadReferences: true,
    });
    // Still reported…
    expect(stripped.referenceWarnings).toHaveLength(2);
    // …but never written as statutory fields.
    expect(stripped.xml).not.toContain("<IRNNO>");
    expect(stripped.xml).not.toContain("<EWAYBILLNO>");
    expect(stripped.xml).not.toContain("f31a6ff6");
  });

  it("stays silent for a genuine IRN and a 12-digit EWB", () => {
    const good: TallyInvoiceRow = {
      ...inv,
      irn: "d812d43cf9a8951e25973390fcd2b2fbaa4786e77a277768422e7302d50fcdec",
      ewaybill_no: "321009218808",
    };
    const res = buildSalesExport({
      invoices: [good],
      itemsByInvoice: new Map([[good.id, items]]),
    });
    expect(res.referenceWarnings).toHaveLength(0);
  });
});

describe("buildSalesExport drift detection", () => {
  const itemsByInvoice = new Map([[inv.id, items]]);

  it("reports the stored-vs-recomputed 1-paise delta instead of hiding it", () => {
    const res = buildSalesExport({ invoices: [inv], itemsByInvoice });
    const cgstDrift = res.drift.find((d) => d.field === "cgst");
    expect(cgstDrift).toBeDefined();
    expect(cgstDrift?.stored).toBe(1868.64);
    expect(cgstDrift?.recomputed).toBe(1868.65);
    expect(cgstDrift?.delta).toBe(0.01);
  });

  it("keeps the voucher balanced even when drift exists", () => {
    const res = buildSalesExport({ invoices: [inv], itemsByInvoice });
    expect(res.unbalanced).toHaveLength(0);
  });

  it("reports no drift for an invoice whose header matches its lines exactly", () => {
    const clean: TallyInvoiceRow = {
      ...inv,
      // zero-GST invoice: engine and header agree exactly
      taxable_value: 100,
      cgst: 0,
      sgst: 0,
      igst: 0,
      round_off: 0,
      total: 100,
    };
    const res = buildSalesExport({
      invoices: [clean],
      itemsByInvoice: new Map([
        [
          clean.id,
          [{ description: "svc", qty: 1, rate: 100, gst_rate: 0, cgst: 0, sgst: 0, igst: 0 }],
        ],
      ]),
    });
    expect(res.drift).toHaveLength(0);
  });
});
