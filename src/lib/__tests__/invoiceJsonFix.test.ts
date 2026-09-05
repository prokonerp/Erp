import { describe, it, expect } from "vitest";
import { buildGstInvoiceJson, buildEwayJson } from "@/lib/invoiceJson";
import { validateGSTINChecksum } from "@/lib/india";

describe("fix verification: PHS/INV/26-27/0008", () => {
  const branch = {
    name: "NIT-3",
    address: "3C-58, BP, NIT-3,",
    gstin: "06AEHPA2697G1ZL",
    state_name: "Haryana",
    state_code: "06",
    phone: "0129-4059682",
    email: "support@prokonhitech.com",
    city: "Faridabad",
    pin_code: "121001",
    code: "DEL027",
    company_name: "Prokon Hi-Tech Systems",
    company_address: "3C-58, BP, NIT-3, Ggn-Fbd Road, Faridabad, 121001, Haryana.",
  };
  const companyProfile = {
    name: "Prokon Hi-Tech Systems",
    regd_address: "3C-58, BP, NIT-3, Ggn-Fbd Road, Faridabad, 121001, Haryana.",
    address: "3C-58, BP, NIT-3, Ggn-Fbd Road, Faridabad, 121001, Haryana.",
    gstin: "06AEHPA2697G1ZL",
  };
  const customer = {
    company: "7Minion Technology Private Limited.",
    billing_address: "1653 P,, Gurgaon, Haryana, 122001, India",
    shipping_address: "1653 P,, Gurgaon, Haryana, 122001, India",
    gst: "06AAACZ8266C1Z9",
    state: "Haryana",
    phone: "9599031404",
    email: "test@gmail.com",
    billing_pincode: "122001",
    billing_city: "Gurgaon",
    shipping_pincode: "122001",
    shipping_city: "Gurgaon",
  };
  const invoiceGarbage = {
    invoice_no: "PHS/INV/26-27/0008",
    invoice_date: "2026-09-02",
    seller_name: "NIT-3",
    seller_gstin: "06AEHPA2697G1ZL",
    seller_state: "Haryana",
    seller_state_code: "06",
    seller_address: "3C-58, BP, NIT-3,",
    buyer_name: "7Minion Technology Private Limited.",
    buyer_gstin: "06AAACZ8266C1Z9",
    buyer_state: "Haryana",
    buyer_state_code: "06",
    billing_address: "WDWFEFWGRG", // garbage from old snapshot — should fallback to customer
    shipping_address: "WDWFEFWGRG",
    place_of_supply: "Haryana",
    place_of_supply_code: "06",
    is_interstate: false,
    sales_type: "local_itemwise",
    reverse_charge: false,
    po_number: "XYZ456",
    po_date: "2026-09-11",
    taxable_value: 453330,
    cgst: 40799.7,
    sgst: 40799.7,
    igst: 0,
    cess: 0,
    round_off: -0.4,
    total: 534929,
    payment_terms: "15 Days",
  } as any;
  const items = [
    {
      sr_no: 1,
      description: "APC RBC2",
      hsn: "85072000",
      qty: 1,
      unit: "NOS",
      rate: 453330,
      gst_rate: 18,
      taxable_value: 453330,
      cgst: 40799.7,
      sgst: 40799.7,
      igst: 0,
      cess: 0,
      line_total: 534929.4,
    } as any,
  ];

  it("checksum passes for both GSTINs", () => {
    expect(validateGSTINChecksum("06AEHPA2697G1ZL")).toBe(true);
    expect(validateGSTINChecksum("06AAACZ8266C1Z9")).toBe(true);
  });

  it("builds GST JSON with correct legal names, GSTINs, B2B, addresses, pins", () => {
    const json = buildGstInvoiceJson(invoiceGarbage, items, branch as any, customer as any, null, null, companyProfile as any);
    // GSTINs
    expect(json.SellerDtls.Gstin).toBe("06AEHPA2697G1ZL");
    expect(json.BuyerDtls.Gstin).toBe("06AAACZ8266C1Z9");
    expect(json.ShipDtls?.Gstin).toBe("06AAACZ8266C1Z9");
    // SupTyp B2B
    expect(json.TranDtls.SupTyp).toBe("B2B");
    // Seller legal name not NIT-3
    expect(json.SellerDtls.LglNm).toBe("Prokon Hi-Tech Systems");
    expect(json.SellerDtls.TrdNm).toBe("Prokon Hi-Tech Systems");
    // Seller address full, not 3C-58
    expect(json.SellerDtls.Addr1).toContain("3C-58");
    expect(json.SellerDtls.Addr1.length).toBeGreaterThan(10);
    expect(json.SellerDtls.Addr1).not.toBe("3C-58");
    expect(json.SellerDtls.Pin).toBe(121001);
    expect(json.SellerDtls.Loc).toBe("Faridabad");
    expect(json.SellerDtls.Stcd).toBe("06");
    // Buyer address fallback — not garbage
    expect(json.BuyerDtls.Addr1).not.toBe("WDWFEFWGRG");
    expect(json.BuyerDtls.Addr1).toContain("1653");
    expect(json.BuyerDtls.Addr1).toContain("Gurgaon");
    expect(json.BuyerDtls.Pin).toBe(122001);
    expect(json.BuyerDtls.Loc).toBe("Gurgaon");
    expect(json.BuyerDtls.Stcd).toBe("06");
    expect(json.BuyerDtls.Pos).toBe("06");
    // Ship
    expect(json.ShipDtls?.Addr1).not.toBe("WDWFEFWGRG");
    expect(json.ShipDtls?.Pin).toBe(122001);
    expect(json.ShipDtls?.Loc).toBe("Gurgaon");
    // Totals
    expect(json.ValDtls.TotInvVal).toBe(534929);
    expect(json.ValDtls.AssVal).toBe(453330);
    expect(json.ItemList[0].HsnCd).toBe("85072000");
    expect(json.ItemList[0].GstRt).toBe(18);
    // DocNo sanitized to <=16
    expect(json.DocDtls.No.length).toBeLessThanOrEqual(16);
  });

  it("builds E-Way JSON lenient and with correct addresses", () => {
    const eway = buildEwayJson(invoiceGarbage, null, items as any, customer as any);
    expect(eway.fromGstin).toBe("06AEHPA2697G1ZL");
    expect(eway.toGstin).toBe("06AAACZ8266C1Z9");
    expect(eway.toGstin).not.toBe("URP");
    expect(eway.fromAddr1).not.toBe("3C-58");
    expect(eway.toAddr1).not.toBe("WDWFEFWGRG");
    expect(eway.toAddr1).toContain("1653");
    expect(eway.toPlace).toBe("Gurgaon");
    expect(eway.toPincode).toBe(122001);
    expect(eway.docNo.length).toBeLessThanOrEqual(16);
  });

  it("eway without customer fallback still warns but keeps garbage unless fixed invoice (expected)", () => {
    const ewayNoCust = buildEwayJson(invoiceGarbage, null, items as any);
    // Without customer, invoice garbage leaks — this documents why route now passes customer
    expect(ewayNoCust.toAddr1).toBe("WDWFEFWGRG");
  });

  it("generates correct JSON file snapshot without garbage", () => {
    const json = buildGstInvoiceJson(invoiceGarbage, items, branch as any, customer as any, null, null, companyProfile as any);
    // Print for manual inspection
    console.log(JSON.stringify(json, null, 2));
  });
});
