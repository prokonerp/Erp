import { createFileRoute } from "@tanstack/react-router";
import { InvoicePrintView } from "@/components/invoice/InvoicePrintView";
import type { BranchRow, InvoiceItemRow, InvoiceRow } from "@/lib/sales";
import { DEFAULT_COMPANY_PROFILE } from "@/lib/companyProfile";

export const Route = createFileRoute("/invoice/preview")({
  component: InvoicePreviewPage,
});

/* ── Real invoice data: PHS/INV/26-27/0008 (mapped to full InvoiceRow type) ── */

const sampleInvoice: InvoiceRow = {
  id: "00000000-0000-0000-0000-000000000008",
  invoice_no: "PHS/INV/26-27/0008",
  invoice_date: "2026-09-03",
  due_date: "2026-09-04",
  branch_id: "00000000-0000-0000-0000-000000000001",
  customer_id: "00000000-0000-0000-0000-000000000001",

  seller_name: "PROKON HI-TECH SYSTEMS",
  seller_gstin: "06AEHPA2697G1ZL",
  seller_state: "Haryana",
  seller_state_code: "06",
  seller_address: "B-505, Picasso Centre, Sector-61, Gurgaon, Haryana - 122011",

  buyer_name: "7Minion Technology Private Limited.",
  buyer_gstin: "06AAACZ8266C1Z9",
  buyer_state: "Haryana",
  buyer_state_code: "06",
  billing_address: "WDWFEFWGRG, Tower B, 9th Floor, Sector 62, Gurugram, Haryana - 122011",
  shipping_address: "WDWFEFWGRG, Tower B, 9th Floor, Sector 62, Gurugram, Haryana - 122011",
  place_of_supply: "Haryana (06)",
  place_of_supply_code: "06",

  is_interstate: false,
  sales_type: "local_itemwise",
  is_tax_inclusive: false,
  supply_class: null,
  lut_no: null,
  transport_details: null,
  reverse_charge: false,
  linked_quote_id: null,
  linked_dc_ids: null,

  po_number: null,
  po_date: null,

  subtotal: 453330,
  discount: 0,
  taxable_value: 453330,
  cgst: 40799.7,
  sgst: 40799.7,
  igst: 0,
  cess: 0,
  round_off: -0.4,
  total: 534929,
  total_paid: 0,
  total_in_words: "Five Lakh Thirty Four Thousand Nine Hundred Twenty Nine Only",

  status: "issued",
  cancel_reason: null,
  cancelled_at: null,

  irn: "3906740a3906740a3906740a3906740a3906740a3906740a3906740a3906740a",
  ack_no: "3906740a3906740a3906740a3906740a3906740a3906740a3906740a3906740a",
  ack_date: "2026-09-03T10:00:00Z",
  qr_payload: "3906740a3906740a3906740a3906740a3906740a3906740a3906740a3906740a",
  einvoice_status: "IRN_GENERATED",
  einvoice_error: null,

  ewaybill_no: "EWB88414466353",
  ewaybill_date: "2026-09-03",
  ewaybill_valid_till: "2026-09-10",

  notes: null,
  terms: `1. Goods once sold will not be taken back.
2. Warranty as per APC / OEM policy.
3. Payment due as per agreed terms.
4. Interest @18% p.a. applicable on delayed payments.
5. Subject to Gurugram jurisdiction.`,
  pdf_url: null,
  payment_terms: "Advance",

  created_by: null,
  created_at: "2026-09-03T09:00:00Z",
  updated_at: "2026-09-03T09:00:00Z",
};

const sampleItems: InvoiceItemRow[] = [
  {
    id: "00000000-0000-0000-0000-000000000801",
    invoice_id: "00000000-0000-0000-0000-000000000008",
    sr_no: 1,
    product_id: null,
    description: "APC RBC2\nincludes: Battery Replacement Kit",
    hsn: "85072000",
    qty: 1,
    unit: "Nos",
    rate: 453330,
    discount_pct: 0,
    taxable_value: 453330,
    gst_rate: 18,
    cgst: 40799.7,
    sgst: 40799.7,
    igst: 0,
    cess: 0,
    line_total: 534929.4,
    warehouse_id: null,
    serial_numbers: ["210924H95V"],
  },
];

const sampleBranch: BranchRow = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "PROKON — NIT-3 Faridabad",
  address: "3C-58, BP, NIT-3, Ggn-Fbd Road, Faridabad, 121001, Haryana",
  gstin: "06AEHPA2697G1ZL",
  state_name: "Haryana",
  state_code: "06",
  pan: null,
  cin: null,
  email: "sales@prokonhitech.com",
  phone: "0129-4059682",
  bank_name: "HDFC Bank",
  bank_account: "50200012345678",
  bank_ifsc: "HDFC001234",
  bank_branch: "Sector-17, Faridabad",
  upi_id: "prokonhitech@okbizaxis",
  logo_url: null,
  invoice_footer: null,
  is_default: true,
};

const sampleCompany = {
  ...DEFAULT_COMPANY_PROFILE,
  id: "00000000-0000-0000-0000-000000000001",
  name: "PROKON HI-TECH SYSTEMS",
  regd_address: "Regd. Office: B-505, Picasso Centre, Sector-61, Gurgaon, Haryana - 122011",
  registered_office_address: "Picasso Centre, Sector-61, Gurgaon, Haryana - 122011",
  sales_office_address: "3C-58, BP, NIT-3, Ggn-Fbd Road, Faridabad, 121001, Haryana",
  gstin: "06AEHPA2697G1ZL",
  phone: "0129-4059682 +91-9818112270",
  email: "sales@prokonhitech.com",
  website: "www.prokonhitech.com",
  bank_name: "HDFC Bank",
  bank_account_name: "PROKON HI-TECH SYSTEMS",
  bank_account_number: "50200012345678",
  bank_ifsc: "HDFC001234",
  bank_branch: "Sector-17, Faridabad",
};

/* ── Products map (model + warranty fields; nothing here → dashes) ────── */
const sampleProducts: Record<string, { model?: string | null; warranty_applicable?: boolean | null; warranty_duration?: number | null; warranty_unit?: string | null; warranty_start_from?: string | null }> = {};

const sampleAmc = {
  agreement_no: "AMC/2026/045",
  start_date: "2026-09-03",
  end_date: "2027-09-02",
};

function InvoicePreviewPage() {
  return (
    <div className="min-h-screen bg-gray-200 py-4 flex justify-center">
      <InvoicePrintView
        invoice={sampleInvoice}
        items={sampleItems}
        company={sampleCompany}
        customer={{
          company: "7Minion Technology Private Limited.",
          contact_name: "Rahul Sharma",
          phone: "+91-98765-43210",
          email: "accounts@7minion.com",
          gst: "06AAACZ8266C1Z9",
          state: "Haryana",
          billing_address:
            "WDWFEFWGRG, Tower B, 9th Floor, Sector 62, Gurugram, Haryana - 122011",
          shipping_address:
            "WDWFEFWGRG, Tower B, 9th Floor, Sector 62, Gurugram, Haryana - 122011",
          remarks: "Please raise invoice on delivery.",
        }}
        branch={sampleBranch}
        products={sampleProducts}
        amc={sampleAmc}
        udyamNo={null}
        copyLabel="Original Copy"
        warehouseLine="3C-58, BP, NIT-3, Ggn-Fbd Road, Faridabad, 121001, Haryana"
      />
    </div>
  );
}
