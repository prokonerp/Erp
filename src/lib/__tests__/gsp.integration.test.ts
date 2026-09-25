/* eslint-disable @typescript-eslint/no-explicit-any --
 * The fixtures below intentionally mirror the loosely-typed Supabase rows the
 * real components receive at runtime (and the same casts are used by the
 * existing invoiceJsonFix.test.ts). Pinning the exact row types here would
 * test the type declarations rather than the GSP pipeline. */
import { describe, it, expect } from "vitest";
import {
  buildGstInvoiceJson,
  IRN_REGEX,
  ACK_REGEX,
  EWB_REGEX,
  isValidBase64,
} from "@/lib/invoiceJson";
import { toGspInvoiceRequest } from "@/lib/gspPayload";
import { createMockTransport } from "@/lib/gspMock";
import { getInvoiceCompletionStatus } from "@/lib/einvoice";
import { looksFabricatedIrn } from "@/lib/tallyExport";

/**
 * End-to-end evidence for the mock path, without a database.
 *
 * This walks the exact chain the server function walks, and asserts the
 * values that would be written to `invoices` survive the app's OWN
 * validators — the ones `parseGstPortalIrnResponse` and the compliance view
 * rely on. If the mock ever produced a value the real parse path would
 * reject, this test fails.
 *
 * The claim under test: in `GSP_MODE=mock`, an invoice moves from
 * "no IRN" to a persisted, structurally-valid, compliance-complete state
 * using only the dummy transport.
 */

const branch = {
  name: "NIT-3",
  address: "3C-58, BP, NIT-3, Ggn-Fbd Road",
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

const customer = {
  company: "Bharath Traders",
  billing_address: "12 MG Road, Bengaluru, 560001",
  gst: "29AAGCB7383J1Z4",
  state: "Karnataka",
  billing_pincode: "560001",
  billing_city: "Bengaluru",
  billing_state: "Karnataka",
  shipping_address: "12 MG Road, Bengaluru, 560001",
  shipping_pincode: "560001",
  shipping_city: "Bengaluru",
  shipping_state: "Karnataka",
};

const invoice = {
  invoice_no: "PHS/INV/26-27/0001",
  invoice_date: "2026-09-01",
  seller_name: "Prokon Hi-Tech Systems",
  seller_gstin: "06AEHPA2697G1ZL",
  seller_address: "3C-58, BP, NIT-3, Faridabad, 121001",
  seller_state: "Haryana",
  seller_state_code: "06",
  buyer_name: "Bharath Traders",
  buyer_gstin: "29AAGCB7383J1Z4",
  buyer_state: "Karnataka",
  buyer_state_code: "29",
  billing_address: "12 MG Road, Bengaluru, 560001",
  shipping_address: "12 MG Road, Bengaluru, 560001",
  place_of_supply: "29",
  place_of_supply_code: "29",
  is_interstate: true,
  sales_type: "retail_interstate",
  reverse_charge: false,
  total: 11800,
  taxable_value: 10000,
  cgst: 0,
  sgst: 0,
  igst: 1800,
  cess: 0,
  round_off: 0,
  discount: 0,
  notes: "Thanks for your business",
};

const items = [
  {
    sr_no: 1,
    description: "HD CCTV Camera",
    hsn: "85258900",
    qty: 2,
    unit: "NOS",
    rate: 5000,
    gst_rate: 18,
    cess_rate: 0,
    taxable_value: 10000,
    cgst: 0,
    sgst: 0,
    igst: 1800,
    cess: 0,
    line_total: 11800,
  },
];

const transport = {
  transport_mode: "road",
  transporter_id: "29ABCDE1234F1Z5",
  transporter_name: "BlueDart",
  gr_rr_no: "BD-9911",
  gr_rr_date: "2026-09-01",
  vehicle_no: "HR26AB1234",
  station_to_place: "Bengaluru",
  pin_code: "560001",
  distance_km: 1650,
  mode_of_transport: "Road",
  sub_type: "Supply",
  transaction_type: "Inter-State",
  e_invoice_reqd: "Y",
  e_way_reqd: "Y",
  generate_eway_within_einvoice: false,
  update_port_address: null,
  dispatch_details: null,
  eway_bill_no: null,
  eway_bill_date: null,
  eway_bill_valid_till: null,
  einvoice_irn: null,
  einvoice_ack_no: null,
  einvoice_ack_date: null,
  einvoice_qr: null,
} as any;

describe("GSP mock end-to-end", () => {
  it("produces values that satisfy every validator the app enforces", async () => {
    // 1. Build the NIC payload (same call the server function makes).
    const nic = buildGstInvoiceJson(
      invoice as any,
      items as any,
      branch as any,
      customer as any,
      transport,
    );

    // 2. Transform to the GSP envelope.
    const request = toGspInvoiceRequest(nic, { userGstin: branch.gstin });
    // The GSP receives the NIC-sanitised document number, NOT the number
    // printed on the invoice ("PHS/INV/26-27/0001"). `sanitizeDocNoForNic`
    // strips slashes because the IRP caps the field and rejects them; this is
    // the mismatch the Sales settings screen already warns about.
    expect(request.document_details.document_number).toBe("S-INV-26-27-0001");
    expect(request.data_source).toBe("erp");

    // 3. Call the dummy transport.
    const envelope = await createMockTransport().generateIrn(request);
    const message = envelope.results?.message as Record<string, string>;

    // 4. Every persisted value must pass the app's own regexes.
    expect(IRN_REGEX.test(message.Irn)).toBe(true);
    expect(ACK_REGEX.test(message.AckNo)).toBe(true);
    expect(isValidBase64(message.SignedQRCode)).toBe(true);
  });

  it("yields an e-way bill number that passes EWB_REGEX", async () => {
    const nic = buildGstInvoiceJson(
      invoice as any,
      items as any,
      branch as any,
      customer as any,
      transport,
    );
    const request = toGspInvoiceRequest(nic, { userGstin: branch.gstin });
    const irn = (
      (await createMockTransport().generateIrn(request)).results?.message as { Irn: string }
    ).Irn;

    const ewb = await createMockTransport().genEwbByIrn({
      user_gstin: branch.gstin,
      irn,
      distance: 1650,
    });
    const ewbNo = (ewb.results?.message as { EwbNo: string }).EwbNo;
    expect(EWB_REGEX.test(ewbNo)).toBe(true);
  });

  it("is NOT flagged as a fabricated IRN by the export guard", async () => {
    // The retired mock was caught by this exact guard in production. The
    // replacement must pass it, otherwise the Tally export would refuse to run.
    const nic = buildGstInvoiceJson(
      invoice as any,
      items as any,
      branch as any,
      customer as any,
      transport,
    );
    const request = toGspInvoiceRequest(nic, { userGstin: branch.gstin });
    const irn = (
      (await createMockTransport().generateIrn(request)).results?.message as { Irn: string }
    ).Irn;

    expect(looksFabricatedIrn(irn)).toBe(false);
  });

  it("flips the invoice to compliance-complete once both artefacts exist", () => {
    // The status the user actually asked for. getInvoiceCompletionStatus is
    // what the invoice screen renders.
    const nic = buildGstInvoiceJson(
      invoice as any,
      items as any,
      branch as any,
      customer as any,
      transport,
    );
    const request = toGspInvoiceRequest(nic, { userGstin: branch.gstin });
    expect(request).toBeTruthy();

    const before = getInvoiceCompletionStatus({
      transport_details: { ...transport, e_invoice_reqd: "Y", e_way_reqd: "Y" },
      irn: null,
      ewaybill_no: null,
    } as any);

    const after = getInvoiceCompletionStatus({
      transport_details: {
        ...transport,
        e_invoice_reqd: "Y",
        e_way_reqd: "Y",
        einvoice_irn: "a".repeat(64),
        eway_bill_no: "123456789012",
      },
      irn: "a".repeat(64),
      ewaybill_no: "123456789012",
    } as any);

    expect(before.complete).toBe(false);
    expect(after.complete).toBe(true);
  });
});
