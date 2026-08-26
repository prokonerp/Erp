/**
 * render-invoice-preview.tsx — dev visual-QA harness (NOT part of the app).
 *
 * Server-renders <InvoicePrintView> with reference-style sample data into a
 * standalone HTML file so the invoice template can be rendered to PDF and
 * compared against the visual master reference without running the app.
 *
 * Usage:  bun scripts/render-invoice-preview.tsx [outFile]
 */
import { renderToStaticMarkup } from "react-dom/server";
import { InvoicePrintView } from "@/components/InvoicePrintView";
import { upiPaymentUri } from "@/lib/gst";
import QRCode from "qrcode";
import type { CompanyProfile } from "@/lib/companyProfile";
import type { InvoiceRow, InvoiceItemRow, BranchRow } from "@/lib/sales";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "public", "__invoice_preview.html");

async function qr(text: string) {
  try {
    return await QRCode.toDataURL(text, { width: 200, margin: 1 });
  } catch {
    return "";
  }
}

const INV_NO = "PHS/26-27/0004";
const TOTAL = 152810;

const items = [
  {
    id: "i1",
    invoice_id: "inv",
    sr_no: 1,
    product_id: "p1",
    description:
      "APC Smart-UPS On-Line\n3kVA Tower UPS\nIncludes:\n• Battery\n• Rack\n• Installation\n• Delivery",
    hsn: "8504",
    unit: "Nos",
    qty: 1,
    rate: 85000,
    discount_pct: 0,
    taxable_value: 85000,
    cgst: 7650,
    sgst: 7650,
    igst: 0,
    gst_rate: 18,
    line_total: 85000,
    serial_numbers: ["AS2348X12345"],
  },
  {
    id: "i2",
    invoice_id: "inv",
    sr_no: 2,
    product_id: "p2",
    description: "APC Battery 12V 9Ah",
    hsn: "8507",
    unit: "Nos",
    qty: 6,
    rate: 6000,
    discount_pct: 0,
    taxable_value: 36000,
    cgst: 3240,
    sgst: 3240,
    igst: 0,
    gst_rate: 18,
    line_total: 36000,
    serial_numbers: ["BATT12345"],
  },
  {
    id: "i3",
    invoice_id: "inv",
    sr_no: 3,
    product_id: "p3",
    description: "APC Metal Rack 3kVA",
    hsn: "8473",
    unit: "Nos",
    qty: 1,
    rate: 100,
    discount_pct: 0,
    taxable_value: 100,
    cgst: 9,
    sgst: 9,
    igst: 0,
    gst_rate: 18,
    line_total: 118,
    serial_numbers: ["RACK123"],
  },
  {
    id: "c1",
    invoice_id: "inv",
    sr_no: 4,
    product_id: null,
    description: "Installation Charges",
    hsn: "9987",
    unit: "Nos",
    qty: 1,
    rate: 2000,
    discount_pct: 0,
    taxable_value: 2000,
    cgst: 180,
    sgst: 180,
    igst: 0,
    gst_rate: 18,
    line_total: 2000,
    serial_numbers: null,
  },
  {
    id: "c2",
    invoice_id: "inv",
    sr_no: 5,
    product_id: null,
    description: "Delivery Charges",
    hsn: "9968",
    unit: "Nos",
    qty: 1,
    rate: 1500,
    discount_pct: 0,
    taxable_value: 1500,
    cgst: 135,
    sgst: 135,
    igst: 0,
    gst_rate: 18,
    line_total: 1500,
    serial_numbers: null,
  },
] as unknown as InvoiceItemRow[];

const company = {
  id: "co",
  name: "PROKON HI-TECH SYSTEMS",
  regd_address: "Picasso Centre, Sector-61, Gurugram, Haryana - 122011",
  factory_address: null,
  gstin: "06AADCS5048J1Z5",
  phone: "+91-9818682682 | +91-9818112270",
  email: "info@prokonhitech.com",
  website: "www.prokonhitech.com",
  logo_url: "/prokon-logo.jpeg",
  sales_office_address: null,
  registered_office_address: "Picasso Centre, Sector-61, Gurugram, Haryana - 122011",
  accent_color: null,
  bank_name: "HDFC Bank",
  bank_account_name: "Prokon Hi-Tech Systems",
  bank_account_number: "50200012345678",
  bank_ifsc: "HDFC0001234",
  bank_branch: "Sector-17, Faridabad",
} as unknown as BranchRow;

const branch = {
  id: "br",
  name: "Faridabad Warehouse",
  upi_id: "prokonhitech@okbizaxis",
  bank_name: "HDFC Bank",
  bank_account: "50200012345678",
  bank_ifsc: "HDFC0001234",
  bank_branch: "Sector-17, Faridabad",
  invoice_footer: null,
} as unknown as BranchRow;

const invoice = {
  id: "inv",
  invoice_no: INV_NO,
  invoice_date: "2026-07-08",
  due_date: "2026-07-30",
  branch_id: "br",
  customer_id: "cu",
  seller_name: company.name,
  seller_gstin: company.gstin,
  seller_state: "Haryana",
  seller_state_code: "06",
  seller_address: company.regd_address,
  buyer_name: "Quest Retail Private Limited (JA)",
  buyer_gstin: "08AAACQ1315K1ZL",
  buyer_state: "Delhi",
  buyer_state_code: "08",
  billing_address: "19-20, 2nd Floor, Padam Tower,\nRajendra Place, New Delhi - 110008",
  shipping_address: "C-8, Shopping Complex,\nVaishali Nagar, Jaipur,\nRajasthan - 302021",
  place_of_supply: "Delhi",
  place_of_supply_code: "08",
  po_number: "dghr674",
  po_date: "2026-07-01",
  subtotal: 129500,
  discount: 0,
  cgst: 11655,
  sgst: 11655,
  igst: 0,
  cess: 0,
  round_off: 0,
  total: TOTAL,
  total_paid: 0,
  total_in_words: "One Lakh Fifty Two Thousand Eight Hundred Ten Only",
  is_interstate: false,
  irn: "3a87f7c1e2d4b5a9f0c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6",
  ack_no: "182312312312312",
  ack_date: "2026-07-08T10:30:00",
  qr_payload: "signed-einvoice-payload",
  ewaybill_no: null,
  terms: [
    "Goods once sold will not be taken back.",
    "Warranty as per APC / OEM policy.",
    "Payment due as per agreed terms.",
    "Interest @18% p.a. applicable on delayed payments.",
    "Subject to Gurugram jurisdiction.",
  ].join("\n"),
  status: "issued",
} as unknown as BranchRow;

const customer = {
  company: "Quest Retail Private Limited (JA)",
  contact_name: "Mr. Rakesh Sharma",
  phone: "+91-9910012345",
  email: "accounts@questretail.in",
};

const products = {
  p1: {
    model: "SRVL3KRI-IN",
    warranty_applicable: true,
    warranty_duration: 36,
    warranty_unit: "Months",
    warranty_start_from: "Invoice Date",
  },
  p2: { model: "RBC17" },
  p3: { model: "APC-RACK-3K" },
} as unknown as BranchRow;

const amc = { agreement_no: "AMC/2026/001", start_date: "2026-07-07", end_date: "2027-07-07" };

const upiUri = upiPaymentUri({
  upiId: branch.upi_id,
  payeeName: company.name,
  amount: TOTAL,
  note: INV_NO,
});

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice Preview</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  @page { size: A4 portrait; margin: 10mm; }
  @media print { html, body { width: 190mm; } }
</style></head><body>
${renderToStaticMarkup(
  <InvoicePrintView
    invoice={invoice}
    items={items}
    company={company}
    customer={customer}
    branch={branch}
    products={products}
    amc={amc}
    udyamNo="UDYAM-HR-05-0012345"
    upiQrDataUrl={await qr(upiUri)}
    einvoiceQrDataUrl={await qr("signed-einvoice-payload-sample-data")}
    copyLabel="Original Copy"
    warehouseLine="NIT-3, Faridabad, Haryana - 121001"
  />,
)}
</body></html>`;

writeFileSync(out, html);
console.log(`Wrote ${out}`);
