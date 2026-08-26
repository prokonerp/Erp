/**
 * InvoicePrintView — A4 portrait TAX INVOICE template.
 *
 * Visual master template: the supplied Prokon/APC reference invoice.
 * Every value is rendered from live CRM data (invoices / invoice_items /
 * customers / company_profile / branches / products / amcs) — nothing is
 * hardcoded from the reference.
 *
 * Print pipeline (see src/lib/docPdf.ts):
 *  - Print        → printElementToPdf (browser engine, native pagination,
 *                   thead repeats, rows never split)
 *  - Download PDF → saveElementAsPdf (multi-page split on table.items)
 */
import React, { Fragment } from "react";
import { Globe, Landmark, Mail, MapPin, Phone, Warehouse } from "lucide-react";
import type { CompanyProfile } from "@/lib/companyProfile";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import apcLogo from "@/assets/oem-apc.png.asset.json";
import { amountInWords } from "@/lib/gst";
import {
  productWarrantyMonths,
  type BranchRow,
  type InvoiceItemRow,
  type InvoiceRow,
} from "@/lib/sales";
import { INVOICE_TERMS_FALLBACK } from "@/lib/printDefaults";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InvoiceProductInfo = {
  model?: string | null;
  warranty_applicable?: boolean | null;
  warranty_duration?: number | null;
  warranty_unit?: string | null;
  warranty_start_from?: string | null;
};

export type InvoiceAmcInfo = {
  agreement_no: string;
  start_date: string;
  end_date: string;
} | null;

export type InvoiceCustomerInfo = {
  company: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
} | null;

export type InvoicePrintProps = {
  invoice: InvoiceRow;
  items: InvoiceItemRow[];
  company: CompanyProfile;
  customer: InvoiceCustomerInfo;
  branch: BranchRow | null;
  /** products.id → model + warranty fields (fetched by the caller). */
  products?: Record<string, InvoiceProductInfo>;
  /** Latest AMC agreement for the invoice's customer (or null). */
  amc?: InvoiceAmcInfo;
  /** UDYAM registration number (invoice_settings.udyam_no). */
  udyamNo?: string | null;
  /** Pre-generated UPI payment QR (data URL) — caller generates via `qrcode`. */
  upiQrDataUrl?: string | null;
  /** Pre-generated e-Invoice QR (data URL) from invoice.qr_payload. */
  einvoiceQrDataUrl?: string | null;
  /** "Original Copy" style label printed discreetly at the top-right. */
  copyLabel?: string;
  /** Warehouse / branch line shown next to the Warehouse row in the header. */
  warehouseLine?: string | null;
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

// ---- Design tokens (single source of truth for the document) ----
const GREEN = "#1F9D4D"; // brand green — headings, table headers, totals, footer
const GREEN_DARK = "#157A3B"; // pressed/darker green for small text accents
const GREEN_TINT = "#E7F4EC"; // pale green wash — emphasis rows & charge band
const HEADER_BG = "#e8f5e9"; // light green for section header backgrounds
const INK = "#111111"; // near-black — frames, primary text
const INNER = "#b5b5b5"; // medium grey — all internal cell borders
const FRAME = "#1a1a1a"; // dark grey — outer section frames only
const ZEBRA = "#F5F9F6"; // faint green-grey — alternating item rows
const LABEL_BG = "#F0F2F4"; // neutral label wash — meta box, totals labels
const SUBTLE = "#3D434B"; // secondary text
const RADIUS = 3; // border-radius for section boxes (px)

/** 1234567.89 → "12,34,567.89" (no symbol — headers carry the ₹). */
const num = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (iso?: string | null) => {
  if (!iso) return "";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
};

/** Local-time date formatter for timestamps (never shifts the calendar day). */
const fmtDateTimeLocal = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
};

const addMonths = (iso: string, months: number) => {
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const dd = d.getDate();
  d.setMonth(d.getMonth() + Math.round(months));
  if (d.getDate() < dd) d.setDate(0); // clamp month-end overflow (e.g. 31 Mar → 30 Jun)
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
};

const cleanAddr = (raw?: string | null) =>
  (raw || "")
    .split(/[\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const formatRate = (r: number) => `${Number.isInteger(r) ? r : r.toFixed(2)}%`;

/** Line items that represent services/charges (Installation, Freight, …). */
const CHARGE_RE =
  /(installation|delivery|freight|transport|packing|labour|shipping|commissioning|forwarding|handling)/i;
const isChargeItem = (it: InvoiceItemRow) => !it.product_id && CHARGE_RE.test(it.description || "");

// ---------------------------------------------------------------------------
// Shared cell style — internal borders use thin grey; compact padding
// ---------------------------------------------------------------------------

const tdBase: React.CSSProperties = {
  fontSize: 8.6,
  padding: "3px 5px",
  border: `0.5px solid ${INNER}`,
  color: INK,
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.3,
};

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div
      style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 8.6, lineHeight: 1.3 }}
    >
      <span
        style={{
          color: GREEN_DARK,
          display: "inline-flex",
          width: 10,
          flex: "0 0 auto",
          position: "relative",
          top: 1,
        }}
      >
        {icon}
      </span>
      {label ? (
        <span style={{ fontWeight: 700, width: 98, flex: "0 0 auto", color: INK }}>{label}</span>
      ) : null}
      {label ? <span style={{ flex: "0 0 auto", color: INK }}>:</span> : null}
      <span style={{ fontWeight: 500, color: SUBTLE }}>{value}</span>
    </div>
  );
}

function SectionTitle({
  children,
  center,
  rule,
  headerBg,
}: {
  children: React.ReactNode;
  center?: boolean;
  rule?: boolean;
  headerBg?: boolean;
}) {
  return (
    <div
      className={headerBg ? "section-header" : undefined}
      style={{
        color: GREEN_DARK,
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: 0.4,
        textAlign: center ? "center" : "left",
        marginBottom: 3,
        ...(headerBg
          ? {
              padding: "2px 5px",
              borderRadius: `${RADIUS - 1}px ${RADIUS - 1}px 0 0`,
              WebkitPrintColorAdjust: "exact",
              printColorAdjust: "exact",
            }
          : null),
        ...(rule ? { borderBottom: `1px solid ${INNER}`, paddingBottom: 3 } : null),
      }}
    >
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  valueMono,
  labelWidth = 82,
}: {
  label: string;
  value?: React.ReactNode;
  valueMono?: boolean;
  labelWidth?: number;
}) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div
      style={{
        display: "flex",
        fontSize: 8.6,
        lineHeight: 1.4,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span style={{ fontWeight: 700, width: labelWidth, flex: "0 0 auto", color: INK }}>
        {label}
      </span>
      <span style={{ flex: "0 0 auto", width: 10, color: INK }}>:</span>
      <span
        style={{
          fontWeight: 500,
          color: SUBTLE,
          minWidth: 0,
          overflowWrap: "break-word",
          ...(valueMono ? { fontFamily: "monospace", fontSize: 8 } : null),
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** E-invoice QR — generated on mount from the stored signed payload. */
function EinvQr({ src }: { src: string }) {
  if (!src) return null;
  return (
    <img src={src} alt="E-Invoice QR" style={{ width: 66, height: 66, objectFit: "contain" }} />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoicePrintView({
  invoice,
  items,
  company,
  customer,
  branch,
  products = {},
  amc = null,
  udyamNo = null,
  upiQrDataUrl = null,
  einvoiceQrDataUrl = null,
  copyLabel,
  warehouseLine,
}: InvoicePrintProps) {
  const isInter = !!invoice.is_interstate;

  // ---- line items → product rows + additional-charge rows -----------------
  const productItems = items.filter((it) => !isChargeItem(it));
  const chargeItems = items.filter(isChargeItem);

  // ---- tax groups (reuses stored per-line values — no new calculation) ----
  const rateGroups = new Map<
    number,
    { taxable: number; cgst: number; sgst: number; igst: number }
  >();
  items.forEach((it) => {
    const rate = Number(it.gst_rate) || 0;
    const g = rateGroups.get(rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable += Number(it.taxable_value) || 0;
    g.cgst += Number(it.cgst) || 0;
    g.sgst += Number(it.sgst) || 0;
    g.igst += Number(it.igst) || 0;
    rateGroups.set(rate, g);
  });
  const groups = Array.from(rateGroups.entries()).sort((a, b) => a[0] - b[0]);
  const totalTax =
    (Number(invoice.cgst) || 0) +
    (Number(invoice.sgst) || 0) +
    (Number(invoice.igst) || 0) +
    (Number(invoice.cess) || 0);

  // ---- warranty (longest warranty across the products on this invoice) ----
  let warrantyLine = "";
  let warrantyExpiry = "";
  let maxMonths = 0;
  items.forEach((it) => {
    const p = it.product_id ? products[it.product_id] : undefined;
    const m = productWarrantyMonths(p);
    if (p && m > maxMonths) {
      maxMonths = m;
      warrantyLine = `${p.warranty_duration} ${p.warranty_unit || "Months"} from ${
        p.warranty_start_from || "Invoice Date"
      }`;
    }
  });
  if (maxMonths > 0) warrantyExpiry = addMonths(invoice.invoice_date, maxMonths) || "";

  // ---- AMC (latest agreement for this customer) ----------------------------
  const amcActive = amc
    ? new Date(amc.end_date + "T00:00:00") >= new Date(new Date().toDateString())
    : false;
  const amcStatus = amc ? (amcActive ? "Active" : "Expired") : "";

  // ---- payment details (company master first, branch fallback) -------------
  const bankName = company.bank_name || branch?.bank_name || "";
  const bankAcName = company.bank_account_name || "";
  const bankAcNo = company.bank_account_number || branch?.bank_account || "";
  const bankIfsc = company.bank_ifsc || branch?.bank_ifsc || "";
  const bankBranch = company.bank_branch || branch?.bank_branch || "";
  const upiId = branch?.upi_id || "";

  // ---- e-invoice ------------------------------------------------------------
  const ackDate = invoice.ack_date ? fmtDateTimeLocal(invoice.ack_date) : "";
  const hasEinvoice = !!(invoice.irn || invoice.qr_payload);

  // ---- bill / ship ----------------------------------------------------------
  const billName = invoice.buyer_name || customer?.company || "";
  const billAddrLines = cleanAddr(invoice.billing_address);
  const shipAddrLines = cleanAddr(invoice.shipping_address || invoice.billing_address);
  const buyerGst = invoice.buyer_gstin || "";
  const buyerPhone = customer?.phone || "";
  const buyerEmail = customer?.email || "";
  const contactPerson = customer?.contact_name || "";

  // ---- terms ------------------------------------------------------------------
  const termsText = invoice.terms || branch?.invoice_footer || INVOICE_TERMS_FALLBACK.join("\n");
  const termsLines = termsText
    .split(/[\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => (/^\d+\./.test(s) ? s : `${i + 1}. ${s}`));

  // ---- meta box ---------------------------------------------------------------
  const metaRows: Array<[string, string]> = [
    ["Invoice No.", invoice.invoice_no || "—"],
    ["Invoice Date", fmtDate(invoice.invoice_date)],
    ["PO No.", invoice.po_number || "—"],
    ["PO Date", invoice.po_date ? fmtDate(invoice.po_date) : "—"],
    ["Due Date", invoice.due_date ? fmtDate(invoice.due_date) : "—"],
  ];

  const regdOffice = company.registered_office_address || company.regd_address || "";
  // Warehouse line: explicit print choice → issuing branch → company sales office.
  const warehouseFallback =
    warehouseLine ||
    [branch?.name, branch?.address].filter(Boolean).join(", ") ||
    company.sales_office_address ||
    "";
  const companyPhones = (company.phone || "")
    .split(/[/|]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div
      className="inv-print"
      style={{
        width: "190mm",
        minHeight: "272mm",
        margin: "0 auto",
        background: "#ffffff",
        color: INK,
        fontFamily: "Arial, Helvetica, sans-serif",
        border: `1.5px solid ${FRAME}`,
        borderRadius: RADIUS,
        padding: "4mm 4mm 3mm",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <style>{`
        .inv-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .inv-print table { border-collapse: collapse; width: 100%; }

        /* Shared table borders — thin grey internally */
        .inv-print table th,
        .inv-print table td { border: 0.5px solid ${INNER}; }

        /* Items table: vertical column lines only, no horizontal row lines */
        .inv-print table.items tbody td {
          border-top: none !important;
          border-bottom: none !important;
        }
        /* Keep bottom border on last row to close the table */
        .inv-print table.items tbody tr:last-child td {
          border-bottom: 0.5px solid ${INNER} !important;
        }

        /* Description column border extensions — draw vertical lines full height
           of the items-wrapper so they reach the section-frame bottom border */
        .inv-print .items-wrap {
          position: relative;
        }
        .inv-print .items-wrap::before,
        .inv-print .items-wrap::after {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          width: 0;
          border-left: 0.5px solid ${INNER};
          pointer-events: none;
          z-index: 1;
        }
        /* Left border of description col = end of S.No (7%) */
        .inv-print .items-wrap::before { left: 7%; }
        /* Right border of description col = 7% + 28% = 35% */
        .inv-print .items-wrap::after  { left: 35%; }

        /* Outer frame on major section tables: thin grey border + rounded corners */
        .inv-print .section-frame {
          border: 0.5px solid ${INNER} !important;
          border-radius: ${RADIUS}px;
          overflow: hidden;
        }
        .inv-print .section-frame th,
        .inv-print .section-frame td { border: 0.5px solid ${INNER}; }

        /* Green header row — section titles in tables */
        .inv-print .g-bg {
          background: ${GREEN} !important;
          color: #fff !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .inv-print .g-bg th {
          border-color: rgba(255,255,255,0.3) !important;
        }

        /* Light green section-header background for standalone section titles */
        .inv-print .section-header {
          background: ${HEADER_BG} !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /* Tint row */
        .inv-print .g-tint {
          background: ${GREEN_TINT} !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /* Alternating zebra rows on item table */
        .inv-print table.items tbody tr:nth-child(even) td {
          background: ${ZEBRA};
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /* Page-break control */
        .inv-print tr, .inv-print .avoid-break { page-break-inside: avoid; break-inside: avoid; }

        @media print {
          @page { size: A4 portrait; margin: 0; }
          .inv-print { width: 190mm; margin: 10mm auto !important; }
          .inv-print table.items thead { display: table-header-group; }
          .inv-print table.items tr { page-break-inside: avoid; break-inside: avoid; }
        }
      `}</style>

      {copyLabel && !/^original\s*copy$/i.test(copyLabel.trim()) ? (
        <div
          style={{
            position: "absolute",
            top: 3,
            right: 6,
            fontSize: 6.5,
            color: "#777",
            letterSpacing: 0.5,
          }}
        >
          {copyLabel.toUpperCase()}
        </div>
      ) : null}

      {/* ============================ HEADER ============================ */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {/* Prokon brand logo (original logo for clean print) */}
        <div style={{ width: "26%", flex: "0 0 auto", display: "flex", alignItems: "flex-start" }}>
          <img
            src={prokonLogo.url}
            alt="Prokon Hi-Tech Systems"
            crossOrigin="anonymous"
            style={{ maxHeight: 55, maxWidth: "100%", objectFit: "contain" }}
          />
        </div>

        {/* Company name + partner line */}
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 0.4, color: INK }}>
            {company.name.toUpperCase()}
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: GREEN, marginTop: 3 }}>
            Authorized Sales &amp; Service Partner
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#222", marginTop: 2.5 }}>
            APC by Schneider Electric
          </div>
        </div>

        {/* APC branding block (reference layout) */}
        <div
          style={{
            width: "23%",
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <img
              src={apcLogo.url}
              alt="APC by Schneider Electric"
              crossOrigin="anonymous"
              style={{ maxHeight: 42, maxWidth: "100%", objectFit: "contain" }}
            />
          </div>
          <div style={{ width: "88%", border: `0.5px solid ${INNER}`, borderRadius: RADIUS }}>
            <div
              className="g-bg"
              style={{ textAlign: "center", fontWeight: 700, fontSize: 9.2, padding: "2.5px 0" }}
            >
              Authorized
            </div>
            <div
              style={{
                textAlign: "center",
                fontSize: 8.8,
                padding: "2.5px 0",
                color: INK,
                borderTop: `0.5px solid ${INNER}`,
              }}
            >
              Sales Partner
            </div>
          </div>
          <div
            style={{
              width: "88%",
              background: "#3d3d3d",
              color: "#fff",
              textAlign: "center",
              fontSize: 9.8,
              fontStyle: "italic",
              fontWeight: 600,
              padding: "3.5px 0",
              WebkitPrintColorAdjust: "exact",
              printColorAdjust: "exact",
            }}
          >
            Life Is On
          </div>
        </div>
      </div>

      {/* Company info rows */}
      <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 0.5 }}>
        <InfoRow icon={<MapPin size={9} />} label="Registered Office" value={regdOffice} />
        <InfoRow icon={<Warehouse size={9} />} label="Warehouse" value={warehouseFallback} />
        <InfoRow
          icon={<Phone size={9} />}
          label="Mobile"
          value={companyPhones.length ? companyPhones.join("  |  ") : ""}
        />
        <InfoRow icon={<Mail size={9} />} label="Email" value={company.email || ""} />
        <InfoRow icon={<Globe size={9} />} label="Website" value={company.website || ""} />
        <InfoRow
          icon={<Landmark size={9} />}
          label="GSTIN"
          value={
            company.gstin || udyamNo ? (
              <>
                <span style={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {company.gstin || ""}
                </span>
                {udyamNo ? (
                  <>
                    &nbsp;&nbsp;|&nbsp;&nbsp;<b>UDYAM</b> :{" "}
                    <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{udyamNo}</span>
                  </>
                ) : null}
              </>
            ) : (
              ""
            )
          }
        />
      </div>

      {/* Green rule under the header */}
      <div
        style={{
          height: 3,
          background: GREEN,
          marginTop: 4,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        }}
      />

      {/* ====================== TITLE + INVOICE META ====================== */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          marginTop: 10,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            textAlign: "left",
            fontSize: 21,
            fontWeight: 700,
            color: GREEN,
            letterSpacing: 0.8,
          }}
        >
          TAX INVOICE
        </div>
        <table
          className="section-frame"
          style={{
            width: "32%",
            flex: "0 0 auto",
            position: "relative",
          }}
        >
          <tbody>
            {metaRows.map(([k, v]) => (
              <tr key={k}>
                <td
                  className="section-header"
                  style={{
                    width: "40%",
                    fontSize: 8.8,
                    fontWeight: 700,
                    padding: "2.5px 7px",
                    border: `0.5px solid ${INNER}`,
                  }}
                >
                  {k}
                </td>
                <td
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "2.5px 7px",
                    border: `0.5px solid ${INNER}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ========================= BILL TO / SHIP TO ========================= */}
      <div style={{ display: "flex", gap: 8, marginTop: 5, alignItems: "stretch" }}>
        <div
          className="avoid-break"
          style={{
            flex: 1,
            border: `0.5px solid ${INNER}`,
            borderRadius: RADIUS,
            padding: "5px 9px 6px",
          }}
        >
          <SectionTitle rule headerBg>
            BILL TO
          </SectionTitle>
          <div style={{ fontSize: 10, fontWeight: 700 }}>{billName || "—"}</div>
          {billAddrLines.map((ln, i) => (
            <div key={i} style={{ fontSize: 9, lineHeight: 1.4 }}>
              {ln}
            </div>
          ))}
          <div style={{ marginTop: 3 }}>
            <KV label="GSTIN" value={buyerGst} valueMono />
            <KV label="Mobile" value={buyerPhone} />
            <KV label="Email" value={buyerEmail} />
          </div>
        </div>
        <div
          className="avoid-break"
          style={{
            flex: 1,
            border: `0.5px solid ${INNER}`,
            borderRadius: RADIUS,
            padding: "5px 9px 6px",
          }}
        >
          <SectionTitle rule headerBg>
            SHIP TO
          </SectionTitle>
          <div style={{ fontSize: 10, fontWeight: 700 }}>{billName || "—"}</div>
          {shipAddrLines.map((ln, i) => (
            <div key={i} style={{ fontSize: 9, lineHeight: 1.4 }}>
              {ln}
            </div>
          ))}
          {(contactPerson || buyerPhone) && (
            <div style={{ fontSize: 9, marginTop: 4 }}>
              <b>Contact</b> : {[contactPerson, buyerPhone].filter(Boolean).join("  |  ")}
            </div>
          )}
        </div>
      </div>

      {/* ============================ ITEMS TABLE ============================ */}
      <div className="section-frame items-wrap" style={{ marginTop: 5, minHeight: 160 }}>
        <table className="items" style={{ width: "100%" }}>
          <thead>
            <tr className="g-bg">
              {(
                [
                  { label: "S.No.", w: "7%", align: "center" as const },
                  { label: "Product Description", w: "28%", align: "left" as const },
                  { label: "Model", w: "13%", align: "left" as const },
                  { label: "Serial No.", w: "15%", align: "left" as const },
                  { label: "Qty", w: "7%", align: "right" as const },
                  { label: "Rate (₹)", w: "12%", align: "right" as const },
                  { label: "Amount (₹)", w: "13%", align: "right" as const },
                ] as const
              ).map((col) => (
                <th
                  key={col.label}
                  style={{
                    fontSize: 8.8,
                    fontWeight: 700,
                    padding: "3.5px 5px",
                    border: `0.5px solid ${INNER}`,
                    textAlign: col.align,
                    width: col.w,
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productItems.map((it) => {
              const p = it.product_id ? products[it.product_id] : undefined;
              const dLines = (it.description || "")
                .split(/[\n]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              const head = dLines[0] || "";
              const rest = dLines.slice(1);
              const serials = (it.serial_numbers || []).filter(Boolean);
              return (
                <tr key={it.id}>
                  <td
                    style={{ ...tdBase, textAlign: "center", verticalAlign: "top", paddingTop: 6 }}
                  >
                    {it.sr_no}
                  </td>
                  <td
                    style={{
                      ...tdBase,
                      verticalAlign: "top",
                      paddingTop: 6,
                      paddingBottom: 10,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 9, lineHeight: 1.35 }}>{head}</div>
                    {rest.map((ln, i) =>
                      /^includes:?$/i.test(ln) ? (
                        <div
                          key={i}
                          style={{ fontSize: 8.6, fontWeight: 700, marginTop: 2, lineHeight: 1.35 }}
                        >
                          {ln}
                        </div>
                      ) : /^[•-]/.test(ln) ? (
                        <div key={i} style={{ fontSize: 8.6, paddingLeft: 8, lineHeight: 1.35 }}>
                          {ln}
                        </div>
                      ) : (
                        <div key={i} style={{ fontSize: 8.6, lineHeight: 1.35 }}>
                          {ln}
                        </div>
                      ),
                    )}
                  </td>
                  <td
                    style={{
                      ...tdBase,
                      textAlign: "left",
                      verticalAlign: "top",
                      paddingTop: 7,
                      fontSize: 8.4,
                    }}
                  >
                    {p?.model || "—"}
                  </td>
                  <td
                    style={{
                      ...tdBase,
                      textAlign: "left",
                      verticalAlign: "top",
                      paddingTop: 7,
                      fontSize: 8.4,
                      overflowWrap: "break-word",
                    }}
                  >
                    {serials.length ? serials.join(", ") : "—"}
                  </td>
                  <td
                    style={{ ...tdBase, textAlign: "right", verticalAlign: "top", paddingTop: 6 }}
                  >
                    {it.qty}
                  </td>
                  <td
                    style={{ ...tdBase, textAlign: "right", verticalAlign: "top", paddingTop: 6 }}
                  >
                    {num(it.rate)}
                  </td>
                  <td
                    style={{ ...tdBase, textAlign: "right", verticalAlign: "top", paddingTop: 6 }}
                  >
                    {num(it.taxable_value)}
                  </td>
                </tr>
              );
            })}

            {/* Additional charges (dynamic — only when the invoice has them) */}
            {chargeItems.length > 0 && (
              <>
                <tr>
                  <td
                    style={{
                      borderBottom: `0.5px solid ${INNER}`,
                      borderLeft: `0.5px solid ${INNER}`,
                    }}
                  />
                  <td
                    colSpan={6}
                    className="g-tint"
                    style={{
                      fontWeight: 700,
                      fontSize: 9.2,
                      color: GREEN_DARK,
                      padding: "4px 7px",
                      borderTop: `0.5px solid ${INNER}`,
                      borderRight: `0.5px solid ${INNER}`,
                      borderBottom: `0.5px solid ${INNER}`,
                      letterSpacing: 0.4,
                    }}
                  >
                    ADDITIONAL CHARGES
                  </td>
                </tr>
                {chargeItems.map((it) => (
                  <tr key={it.id}>
                    <td
                      style={{
                        borderBottom: `0.5px solid ${INNER}`,
                        borderLeft: `0.5px solid ${INNER}`,
                      }}
                    />
                    <td
                      colSpan={5}
                      style={{
                        ...tdBase,
                        fontSize: 9,
                        borderTop: "none",
                        borderLeft: "none",
                      }}
                    >
                      {it.description}
                    </td>
                    <td style={{ ...tdBase, textAlign: "right" }}>{num(it.taxable_value)}</td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ====================== TAX TABLE + TOTALS ====================== */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 5,
          alignItems: "stretch",
        }}
      >
        {/* Tax table */}
        <table className="section-frame" style={{ width: "38%", flex: "0 0 auto" }}>
          <thead>
            <tr className="g-bg">
              {(
                [
                  { label: "Tax Type", align: "left" as const },
                  { label: "Rate", align: "center" as const },
                  { label: "Taxable Amt (₹)", align: "right" as const },
                  { label: "Tax Amt (₹)", align: "right" as const },
                ] as const
              ).map((col) => (
                <th
                  key={col.label}
                  style={{
                    fontSize: 8.6,
                    fontWeight: 700,
                    padding: "3.5px 5px",
                    border: `0.5px solid ${INNER}`,
                    textAlign: col.align,
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([rate, g]) =>
              isInter ? (
                <tr key={rate}>
                  <td style={tdBase}>IGST</td>
                  <td style={{ ...tdBase, textAlign: "center" }}>{formatRate(rate)}</td>
                  <td style={{ ...tdBase, textAlign: "right" }}>{num(g.taxable)}</td>
                  <td style={{ ...tdBase, textAlign: "right" }}>{num(g.igst)}</td>
                </tr>
              ) : (
                <Fragment key={rate}>
                  <tr>
                    <td style={tdBase}>CGST</td>
                    <td style={{ ...tdBase, textAlign: "center" }}>{formatRate(rate / 2)}</td>
                    <td style={{ ...tdBase, textAlign: "right" }}>{num(g.taxable)}</td>
                    <td style={{ ...tdBase, textAlign: "right" }}>{num(g.cgst)}</td>
                  </tr>
                  <tr>
                    <td style={tdBase}>SGST</td>
                    <td style={{ ...tdBase, textAlign: "center" }}>{formatRate(rate / 2)}</td>
                    <td style={{ ...tdBase, textAlign: "right" }}>{num(g.taxable)}</td>
                    <td style={{ ...tdBase, textAlign: "right" }}>{num(g.sgst)}</td>
                  </tr>
                </Fragment>
              ),
            )}
            {!isInter && (
              <tr>
                <td style={tdBase}>IGST</td>
                <td style={{ ...tdBase, textAlign: "center" }}>–</td>
                <td style={{ ...tdBase, textAlign: "right" }}>–</td>
                <td style={{ ...tdBase, textAlign: "right" }}>–</td>
              </tr>
            )}
            <tr className="g-tint">
              <td
                colSpan={2}
                style={{
                  ...tdBase,
                  textAlign: "center",
                  fontWeight: 700,
                  color: GREEN_DARK,
                  fontSize: 9.4,
                }}
              >
                Total Tax
              </td>
              <td style={tdBase} />
              <td
                style={{
                  ...tdBase,
                  textAlign: "right",
                  fontWeight: 700,
                  color: GREEN_DARK,
                  fontSize: 9.4,
                }}
              >
                {num(totalTax)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Totals — compact, pushed to right edge */}
        <div style={{ width: "38%", flex: "0 0 auto", display: "flex", marginLeft: "auto" }}>
          <table className="section-frame" style={{ width: "100%", height: "100%" }}>
            <tbody>
              <tr>
                <td
                  style={{
                    ...tdBase,
                    fontWeight: 700,
                    fontSize: 10,
                    padding: "5px 9px",
                    background: LABEL_BG,
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact",
                  }}
                >
                  Subtotal
                </td>
                <td
                  style={{
                    ...tdBase,
                    textAlign: "right",
                    fontWeight: 700,
                    fontSize: 10,
                    padding: "5px 9px",
                  }}
                >
                  {num(invoice.subtotal)}
                </td>
              </tr>
              {Number(invoice.discount) > 0 && (
                <tr>
                  <td
                    style={{
                      ...tdBase,
                      fontWeight: 700,
                      fontSize: 10,
                      padding: "5px 9px",
                      background: LABEL_BG,
                      WebkitPrintColorAdjust: "exact",
                      printColorAdjust: "exact",
                    }}
                  >
                    Discount
                  </td>
                  <td
                    style={{
                      ...tdBase,
                      textAlign: "right",
                      fontWeight: 700,
                      fontSize: 10,
                      padding: "5px 9px",
                    }}
                  >
                    − {num(invoice.discount)}
                  </td>
                </tr>
              )}
              <tr>
                <td
                  style={{
                    ...tdBase,
                    fontWeight: 700,
                    fontSize: 10,
                    padding: "5px 9px",
                    background: LABEL_BG,
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact",
                  }}
                >
                  Total Tax
                </td>
                <td
                  style={{
                    ...tdBase,
                    textAlign: "right",
                    fontWeight: 700,
                    fontSize: 10,
                    padding: "5px 9px",
                  }}
                >
                  {num(totalTax)}
                </td>
              </tr>
              {!!Number(invoice.round_off) && (
                <tr>
                  <td style={{ ...tdBase, fontSize: 8.8, padding: "4px 9px" }}>
                    Round Off ({(Number(invoice.round_off) || 0) >= 0 ? "+" : "−"})
                  </td>
                  <td style={{ ...tdBase, textAlign: "right", fontSize: 8.8, padding: "4px 9px" }}>
                    {num(Math.abs(Number(invoice.round_off) || 0))}
                  </td>
                </tr>
              )}
              <tr className="g-bg">
                <td
                  style={{
                    fontWeight: 700,
                    fontSize: 12.5,
                    padding: "7px 9px",
                    border: `0.5px solid ${GREEN_DARK}`,
                    letterSpacing: 0.5,
                  }}
                >
                  GRAND TOTAL
                </td>
                <td
                  style={{
                    fontWeight: 700,
                    fontSize: 12.5,
                    padding: "7px 9px",
                    textAlign: "right",
                    border: `0.5px solid ${GREEN_DARK}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  ₹ {num(invoice.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================= AMOUNT IN WORDS ========================= */}
      <div
        style={{
          marginTop: 4,
          fontSize: 9.4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ fontWeight: 700, color: GREEN_DARK }}>
          Amount in Words&nbsp;&nbsp;:&nbsp;&nbsp;
        </span>
        <span style={{ fontWeight: 700 }}>
          {invoice.total_in_words || amountInWords(Number(invoice.total))}
        </span>
      </div>

      {/* ============ WARRANTY & AMC | PAYMENT | UPI QR | E-INVOICE QR ============ */}
      {/* Single block with internal grey partition lines */}
      <div
        className="avoid-break section-frame"
        style={{ display: "flex", marginTop: 5, alignItems: "stretch" }}
      >
        {/* Warranty & AMC */}
        <div style={{ flex: 1, padding: "5px 9px 6px" }}>
          <SectionTitle rule headerBg>
            WARRANTY &amp; AMC
          </SectionTitle>
          <KV label="Warranty" value={warrantyLine} labelWidth={74} />
          <KV label="Warranty Expiry" value={warrantyExpiry} labelWidth={74} />
          <KV label="AMC Status" value={amcStatus} labelWidth={74} />
          <KV label="AMC Expiry" value={amc ? fmtDate(amc.end_date) : ""} labelWidth={74} />
          {warrantyLine && (
            <div style={{ fontSize: 7.6, color: "#444", marginTop: 6 }}>
              * Warranty as per OEM policy
            </div>
          )}
        </div>

        {/* Grey partition */}
        <div style={{ width: 1, background: INNER, alignSelf: "stretch", margin: "4px 0" }} />

        {/* Payment details */}
        <div style={{ flex: 1, padding: "5px 9px 6px" }}>
          <SectionTitle rule headerBg>
            PAYMENT DETAILS
          </SectionTitle>
          <KV label="Bank Name" value={bankName} labelWidth={62} />
          <KV label="A/c Name" value={bankAcName} labelWidth={62} />
          <KV label="A/c No." value={bankAcNo} valueMono labelWidth={62} />
          <KV label="IFSC Code" value={bankIfsc} valueMono labelWidth={62} />
          <KV label="Branch" value={bankBranch} labelWidth={62} />
        </div>

        {/* Grey partition */}
        <div style={{ width: 1, background: INNER, alignSelf: "stretch", margin: "4px 0" }} />

        {/* UPI QR */}
        {upiQrDataUrl ? (
          <div
            style={{
              flex: 1,
              padding: "5px 7px 6px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <SectionTitle center headerBg>
              UPI QR CODE
            </SectionTitle>
            <img
              src={upiQrDataUrl}
              alt="UPI QR"
              style={{ width: 66, height: 66, objectFit: "contain" }}
            />
            {upiId ? (
              <div
                style={{
                  fontSize: 7,
                  marginTop: 3,
                  textAlign: "center",
                  wordBreak: "break-all",
                  lineHeight: 1.25,
                  letterSpacing: 0,
                }}
              >
                <b>UPI ID:</b> {upiId}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* E-Invoice QR */}
        {hasEinvoice ? (
          <>
            <div style={{ width: 1, background: INNER, alignSelf: "stretch", margin: "4px 0" }} />
            <div
              style={{
                flex: 1,
                padding: "5px 7px 6px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <SectionTitle center headerBg>
                E-INVOICE QR
              </SectionTitle>
              {invoice.qr_payload ? <EinvQr src={einvoiceQrDataUrl || ""} /> : null}
              <div
                style={{
                  fontSize: 7.2,
                  marginTop: 3,
                  textAlign: "left",
                  width: "100%",
                  lineHeight: 1.45,
                }}
              >
                {invoice.irn ? (
                  <div>
                    <b>IRN:</b>{" "}
                    <span
                      style={{ fontFamily: "monospace", fontSize: 6.6, wordBreak: "break-all" }}
                    >
                      {invoice.irn}
                    </span>
                  </div>
                ) : null}
                {invoice.ack_no ? (
                  <div>
                    <b>Ack No:</b> <span style={{ fontFamily: "monospace" }}>{invoice.ack_no}</span>
                  </div>
                ) : null}
                {ackDate ? (
                  <div>
                    <b>Ack Date:</b> {ackDate}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* ============== TERMS | SERVICE SUPPORT | SIGNATORY ============== */}
      <div
        className="avoid-break"
        style={{
          display: "flex",
          gap: 8,
          marginTop: 10,
          alignItems: "stretch",
          flex: 1,
          minHeight: 70,
        }}
      >
        <div style={{ width: "38%", flex: "0 0 auto" }}>
          <SectionTitle headerBg>TERMS &amp; CONDITIONS</SectionTitle>
          {termsLines.map((ln, i) => (
            <div key={i} style={{ fontSize: 8.4, lineHeight: 1.5 }}>
              {ln}
            </div>
          ))}
        </div>
        <div style={{ width: "27%", flex: "0 0 auto" }}>
          <SectionTitle headerBg>SERVICE SUPPORT</SectionTitle>
          <div style={{ fontSize: 8.6, fontWeight: 700, marginBottom: 4 }}>
            For any service support or complaints:
          </div>
          <InfoRow icon={<Phone size={9} />} label="" value={company.phone || ""} />
          <InfoRow icon={<Mail size={9} />} label="" value={company.email || ""} />
          <InfoRow icon={<Globe size={9} />} label="" value={company.website || ""} />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 9.4, fontWeight: 700, textAlign: "center" }}>
            For {company.name}
          </div>
          {/* Company seal + signature — configurable asset. Upload once in the
              company master (seal_url); nothing renders until it is set. */}
          {company.seal_url ? (
            <div
              style={{
                flex: 1,
                minHeight: 40,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src={company.seal_url}
                alt="Company seal and signature"
                crossOrigin="anonymous"
                style={{ maxHeight: 64, maxWidth: "82%", objectFit: "contain" }}
              />
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 40 }} />
          )}
          <div style={{ fontSize: 8.8, textAlign: "center", marginTop: "auto" }}>
            Authorized Signatory
          </div>
        </div>
      </div>

      {/* ============================== FOOTER ============================== */}
      <div style={{ marginTop: 5 }}>
        <div
          style={{
            height: 3,
            background: GREEN,
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 3 }}>
          <img
            src={apcLogo.url}
            alt="APC"
            crossOrigin="anonymous"
            style={{ maxHeight: 26, objectFit: "contain" }}
          />
          <div
            style={{ flex: 1, textAlign: "center", fontSize: 10.5, fontWeight: 700, color: INK }}
          >
            Power Backup Solutions
            <span style={{ color: GREEN, padding: "0 8px" }}>|</span>UPS
            <span style={{ color: GREEN, padding: "0 8px" }}>|</span>Batteries
            <span style={{ color: GREEN, padding: "0 8px" }}>|</span>AMC
            <span style={{ color: GREEN, padding: "0 8px" }}>|</span>Services
          </div>
          <div
            className="g-bg"
            style={{
              fontSize: 11,
              fontStyle: "italic",
              fontWeight: 700,
              padding: "4px 15px",
              borderRadius: 2,
              letterSpacing: 0.3,
            }}
          >
            Life Is On
          </div>
        </div>
      </div>
    </div>
  );
}
