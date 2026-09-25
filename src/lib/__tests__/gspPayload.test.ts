import { describe, it, expect } from "vitest";
import { toGspInvoiceRequest } from "@/lib/gspPayload";
import type { NicInvoiceJson } from "@/lib/invoiceJson";

// ── fixtures ────────────────────────────────────────────────────────────────
// A representative intra-state B2B invoice. The transform must be a *shape*
// change only: every money/rate field is copied, never recomputed.

function nic(overrides: Partial<NicInvoiceJson> = {}): NicInvoiceJson {
  return {
    Version: "1.03",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", EcmGstin: null, IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: "PHS/INV/26-27/0001", Dt: "01/09/2026", OrgInvNo: null },
    SellerDtls: {
      Gstin: "06AEHPA2697G1ZL",
      LglNm: "Prokon Hi-Tech Systems",
      TrdNm: "Prokon",
      Addr1: "3C-58, BP, NIT-3",
      Addr2: "Ggn-Fbd Road",
      Loc: "Faridabad",
      Pin: 121001,
      Stcd: "06",
      Ph: "01294059682",
      Em: "support@prokonhitech.com",
    },
    BuyerDtls: {
      Gstin: "29AAGCB7383J1Z4",
      LglNm: "Bharath Traders",
      TrdNm: "Bharath",
      Addr1: "12 MG Road",
      Addr2: null,
      Loc: "Bengaluru",
      Pin: 560001,
      Stcd: "29",
      Ph: null,
      Em: null,
      Pos: "29",
    },
    DispDtls: {
      Nm: "Prokon Warehouse",
      Addr1: "Plot 7, IMT",
      Addr2: null,
      Loc: "Faridabad",
      Pin: 121001,
      Stcd: "06",
    },
    ShipDtls: null,
    ItemList: [
      {
        SlNo: "1",
        PrdDesc: "HD CCTV Camera",
        IsServc: "N",
        HsnCd: "85258900",
        Barcde: null,
        Qty: 2,
        FreeQty: 0,
        Unit: "NOS",
        UnitPrice: 5000,
        TotAmt: 10000,
        Discount: 0,
        PreTaxVal: 10000,
        AssAmt: 10000,
        GstRt: 18,
        IgstAmt: 0,
        CgstAmt: 900,
        SgstAmt: 900,
        CesRt: 0,
        CesAmt: 0,
        CesNonAdvlAmt: 0,
        StateCesRt: 0,
        StateCesAmt: 0,
        StateCesNonAdvlAmt: 0,
        OthChrg: 0,
        TotItemVal: 11800,
      },
    ],
    ValDtls: {
      AssVal: 10000,
      CgstVal: 900,
      SgstVal: 900,
      IgstVal: 0,
      CesVal: 0,
      StCesVal: 0,
      Discount: 0,
      OthChrg: 0,
      RndOffAmt: 0,
      TotInvVal: 11800,
      TotInvValFc: 0,
    },
    PayDtls: null,
    RefDtls: {
      InvRm: "Thanks for your business",
      DocPerdDtls: null,
      PrecDocDtls: null,
      ContrDtls: null,
    },
    AddlDocDtls: null,
    ExpDtls: null,
    EwbDtls: {
      TransId: "29ABCDE1234F1Z5",
      TransName: "BlueDart",
      TransMode: "1",
      Distance: 1650,
      TransDocNo: "BD-9911",
      TransDocDt: "01/09/2026",
      VehNo: "HR26AB1234",
      VehType: "R",
    },
    ...overrides,
  };
}

const SELLER_GSTIN = "06AEHPA2697G1ZL";

describe("toGspInvoiceRequest — envelope", () => {
  it("adds the two fields the NIC schema has no place for", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.user_gstin).toBe(SELLER_GSTIN);
    expect(gsp.data_source).toBe("erp");
  });

  it("rejects a missing user_gstin rather than sending a half-formed request", () => {
    expect(() => toGspInvoiceRequest(nic(), { userGstin: "" })).toThrow(/gstin/i);
  });

  it("does not send a Version field (G5 is unresolved in the GSP docs)", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp).not.toHaveProperty("version");
    expect(gsp).not.toHaveProperty("Version");
  });
});

describe("toGspInvoiceRequest — transaction and document blocks", () => {
  it("maps TranDtls to snake_case transaction_details", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.transaction_details).toEqual({
      supply_type: "B2B",
      charge_type: "N",
      igst_on_intra: "N",
      ecommerce_gstin: "",
    });
  });

  it("maps DocDtls to document_details, keeping dd/mm/yyyy verbatim", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.document_details).toEqual({
      document_type: "INV",
      document_number: "PHS/INV/26-27/0001",
      document_date: "01/09/2026",
    });
  });

  it("carries the EcmGstin through as ecommerce_gstin when present", () => {
    const base = nic();
    const src = { ...base, TranDtls: { ...base.TranDtls, EcmGstin: "29AAGCB7383J1Z4" } };
    expect(
      toGspInvoiceRequest(src, { userGstin: SELLER_GSTIN }).transaction_details.ecommerce_gstin,
    ).toBe("29AAGCB7383J1Z4");
  });
});

describe("toGspInvoiceRequest — party blocks", () => {
  it("maps seller fields to their snake_case names", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.seller_details).toEqual({
      gstin: "06AEHPA2697G1ZL",
      legal_name: "Prokon Hi-Tech Systems",
      trade_name: "Prokon",
      address1: "3C-58, BP, NIT-3",
      address2: "Ggn-Fbd Road",
      location: "Faridabad",
      pincode: 121001,
      state_code: "06",
      phone_number: "01294059682",
      email: "support@prokonhitech.com",
    });
  });

  it("maps buyer fields and adds place_of_supply from Pos", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.buyer_details).toMatchObject({
      gstin: "29AAGCB7383J1Z4",
      legal_name: "Bharath Traders",
      location: "Bengaluru",
      pincode: 560001,
      state_code: "29",
      place_of_supply: "29",
    });
  });

  it("maps dispatch details and leaves ship_details absent when the source is null", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.dispatch_details).toEqual({
      company_name: "Prokon Warehouse",
      address1: "Plot 7, IMT",
      address2: null,
      location: "Faridabad",
      pincode: 121001,
      state_code: "06",
    });
    expect(gsp.ship_details).toBeNull();
  });
});

describe("toGspInvoiceRequest — value_details never re-derives", () => {
  it("copies ValDtls through field-by-field", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.value_details).toEqual({
      total_assessable_value: 10000,
      total_cgst_value: 900,
      total_sgst_value: 900,
      total_igst_value: 0,
      total_cess_value: 0,
      total_cess_value_of_state: 0,
      total_discount: 0,
      total_other_charge: 0,
      total_invoice_value: 11800,
      round_off_amount: 0,
    });
  });

  it("mirrors an odd source total instead of recomputing it from items", () => {
    // Guards the design rule: if the transform ever recomputed, this sentinel
    // would be overwritten with 11800.
    const base = nic();
    const src = { ...base, ValDtls: { ...base.ValDtls, TotInvVal: 12345.67 } };
    expect(
      toGspInvoiceRequest(src, { userGstin: SELLER_GSTIN }).value_details.total_invoice_value,
    ).toBe(12345.67);
  });
});

describe("toGspInvoiceRequest — item_list", () => {
  it("maps every item field to its snake_case name", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.item_list).toHaveLength(1);
    expect(gsp.item_list[0]).toMatchObject({
      item_serial_number: "1",
      product_description: "HD CCTV Camera",
      is_service: "N",
      hsn_code: "85258900",
      quantity: 2,
      unit: "NOS",
      unit_price: 5000,
      total_amount: 10000,
      assessable_value: 10000,
      gst_rate: 18,
      cgst_amount: 900,
      sgst_amount: 900,
      igst_amount: 0,
      total_item_value: 11800,
    });
  });

  it("preserves the item ordinal as a string", () => {
    const base = nic();
    const two = { ...base.ItemList[0], SlNo: "2" };
    const src = { ...base, ItemList: [base.ItemList[0], two] };
    const gsp = toGspInvoiceRequest(src, { userGstin: SELLER_GSTIN });
    expect(gsp.item_list.map((i) => i.item_serial_number)).toEqual(["1", "2"]);
  });
});

describe("toGspInvoiceRequest — ewaybill and reference blocks", () => {
  it("maps EwbDtls to ewaybill_details", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.ewaybill_details).toEqual({
      transporter_id: "29ABCDE1234F1Z5",
      transporter_name: "BlueDart",
      transportation_mode: "1",
      transportation_distance: 1650,
      transporter_document_number: "BD-9911",
      transporter_document_date: "01/09/2026",
      vehicle_number: "HR26AB1234",
      vehicle_type: "R",
    });
  });

  it("carries the invoice remark into reference_details", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.reference_details.invoice_remarks).toBe("Thanks for your business");
  });

  it("maps additional documents when present and null when absent", () => {
    const withDoc = nic({
      AddlDocDtls: [{ Url: "https://x/y.pdf", Docs: "PI", Info: "proforma" }],
    });
    expect(
      toGspInvoiceRequest(withDoc, { userGstin: SELLER_GSTIN }).additional_document_details,
    ).toEqual([
      {
        supporting_document_url: "https://x/y.pdf",
        supporting_document: "PI",
        additional_information: "proforma",
      },
    ]);
    expect(
      toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN }).additional_document_details,
    ).toBeNull();
  });
});

describe("toGspInvoiceRequest — optional blocks", () => {
  it("emits null rather than a partially-filled object for absent blocks", () => {
    const gsp = toGspInvoiceRequest(nic(), { userGstin: SELLER_GSTIN });
    expect(gsp.payment_details).toBeNull();
    expect(gsp.export_details).toBeNull();
  });

  it("maps export details when the source has them", () => {
    const withExport = nic({ ExpDtls: { Addr1: "Mumbai Port", Port: "INMUN1" } });
    const gsp = toGspInvoiceRequest(withExport, { userGstin: SELLER_GSTIN });
    expect(gsp.export_details).toMatchObject({ port_code: "INMUN1" });
  });
});
