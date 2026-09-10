import { amountInWords } from "@/lib/crm";
import type { CompanyProfile } from "@/lib/companyProfile";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import oemApc from "@/assets/oem-apc.png.asset.json";

/* ── Types ────────────────────────────────────────────────────────────── */

export type PreviewParty = {
  name: string;
  address?: string | null;
  gstin?: string | null;
  state?: string | null;
  state_code?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
};

export type PreviewItem = {
  description: string;
  item_details?: string | null;
  warranty?: string | null;
  hsn?: string | null;
  qty: number;
  unit?: string | null;
  rate: number;
  gst_percent: number;
  amount: number;
  taxable_value?: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  model?: string | null;
  serial_numbers?: string[] | null;
};

export type PreviewInvoice = {
  invoice_no?: string | null;
  invoice_date: string;
  due_date?: string | null;
  po_number?: string | null;
  po_date?: string | null;
  place_of_supply?: string | null;
  reverse_charge?: boolean;
  vehicle_no?: string | null;
  payment_terms?: string | null;
  ewaybill_no?: string | null;
  irn?: string | null;
  ack_no?: string | null;
  ack_date?: string | null;
  is_interstate: boolean;
  terms?: string | null;
  notes?: string | null;
  round_off?: number;
  total: number;
  total_in_words?: string | null;
  taxable_value?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
};

export type PreviewBranch = {
  bank_name?: string | null;
  bank_account?: string | null;
  bank_ifsc?: string | null;
  bank_branch?: string | null;
  upi_id?: string | null;
};

export type InvoicePrintPreviewProps = {
  invoice: PreviewInvoice;
  items: PreviewItem[];
  billTo: PreviewParty;
  shipTo?: PreviewParty | null;
  company: CompanyProfile;
  branch?: PreviewBranch | null;
  authorisedSignatureUrl?: string | null;
};

/* ── Helpers ──────────────────────────────────────────────────────────── */

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
};

const cleanAddr = (raw?: string | null) => {
  if (!raw) return "";
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
};

/* ── Schneider-green palette (matched to reference) ───────────────────── */
const C = {
  green: "#22903E", // medium green (bands, headers)
  greenDark: "#155A27", // darker green (title bar, top band)
  greenLight: "#E4F2E8", // light green tint (badges)
  greenAccent: "#2FA354", // accent
  white: "#FFFFFF",
  offWhite: "#FAFBFA",
  gray50: "#F8FAFC",
  gray100: "#F1F5F9",
  gray200: "#E2E8F0",
  gray300: "#CBD5E1",
  gray500: "#64748B",
  gray700: "#334155",
  gray900: "#0F172A",
  border: "#E2E8F0",
};

/* ── Inline SVG icons (theme-matched, no emojis) ──────────────────────── */
const Icon = {
  MapPin: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
  ),
  Warehouse: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" /><path d="M6 18h12" /><path d="M6 14h12" />
    </svg>
  ),
  Phone: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  Mail: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  ),
  Globe: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />
    </svg>
  ),
  Receipt: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" /><path d="M12 17.5v-11" />
    </svg>
  ),
  Shield: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  ),
  Check: () => (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  Truck: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18H9" /><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" />
    </svg>
  ),
  Clock: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  FileText: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />
    </svg>
  ),
  Building: () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, flexShrink: 0 }}>
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" /><path d="M12 10h.01" /><path d="M12 14h.01" /><path d="M16 10h.01" /><path d="M16 14h.01" /><path d="M8 10h.01" /><path d="M8 14h.01" />
    </svg>
  ),
};

/* ── Component ────────────────────────────────────────────────────────── */

export function InvoicePrintPreview({
  invoice,
  items,
  billTo,
  shipTo,
  company,
  branch,
  authorisedSignatureUrl,
}: InvoicePrintPreviewProps) {
  const showCgstSgst = !invoice.is_interstate;
  const regdAddr = cleanAddr(company.registered_office_address || company.regd_address);
  const salesAddr = cleanAddr(company.sales_office_address);
  const shipAddr = cleanAddr(shipTo?.address || billTo.address);

  // Compute from actual items (single source of truth)
  const taxableTotal = items.reduce((s, it) => s + (it.taxable_value || it.amount || 0), 0);
  const cgstTotal = items.reduce((s, it) => s + (it.cgst_amount ?? 0), 0);
  const sgstTotal = items.reduce((s, it) => s + (it.sgst_amount ?? 0), 0);
  const igstTotal = items.reduce((s, it) => s + (it.igst_amount ?? 0), 0);
  const totalTax = cgstTotal + sgstTotal + igstTotal;

  return (
    <div
      className="bg-white text-black mx-auto"
      style={{
        fontFamily: "'Inter', Arial, Helvetica, sans-serif",
        width: "210mm",
        minHeight: "297mm",
        padding: "10mm 12mm",
        fontSize: "9.5px",
        lineHeight: 1.35,
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <style>{`
        @media print {
          @page { size: A4; margin: 8mm; }
          .inv-print tr { page-break-inside: avoid; }
          .inv-print thead { display: table-header-group; }
        }
        .inv-print table { border-collapse: collapse; }
        .inv-print .mono { font-family: 'JetBrains Mono', 'Consolas', monospace; }
        .inv-print * { box-sizing: border-box; }
      `}</style>

      <div className="inv-print">
        {/* ════════════════════════════════════════════════════════════════ */}
        {/*  HEADER — full-width top band + logo / centered text / APC      */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {/* Full-width top green strip */}
        <div style={{ height: 6, background: C.greenDark, margin: "-10mm -12mm 0", width: "calc(100% + 24mm)" }} />

        <div className="flex items-start" style={{ paddingTop: 8, paddingBottom: 6, marginBottom: 0, position: "relative" }}>
          {/* LEFT — Logo + contact */}
          <div style={{ flex: 1, paddingRight: 10 }}>
            <img
              src={company.logo_url || prokonLogo.url}
              alt="Prokon"
              style={{ height: 50, marginBottom: 5, objectFit: "contain" }}
              crossOrigin="anonymous"
              onError={(e) => { (e.currentTarget as HTMLImageElement).src = prokonLogo.url; }}
            />

            <div style={{ fontSize: 7, color: C.gray700, lineHeight: 1.7 }}>
              {regdAddr && (
                <div className="flex items-start" style={{ marginBottom: 1 }}>
                  <Icon.MapPin /><span><span style={{ fontWeight: 600 }}>Registered Office</span> : {regdAddr}</span>
                </div>
              )}
              {salesAddr && (
                <div className="flex items-start" style={{ marginBottom: 1 }}>
                  <Icon.Warehouse /><span><span style={{ fontWeight: 600 }}>Warehouse</span> : {salesAddr}</span>
                </div>
              )}
              {company.phone && (
                <div className="flex items-center" style={{ marginBottom: 1 }}>
                  <Icon.Phone /><span><span style={{ fontWeight: 600 }}>Mobile</span> : {company.phone}</span>
                </div>
              )}
              {company.email && (
                <div className="flex items-center" style={{ marginBottom: 1 }}>
                  <Icon.Mail /><span><span style={{ fontWeight: 600 }}>Email</span> : {company.email}</span>
                </div>
              )}
              {company.website && (
                <div className="flex items-center" style={{ marginBottom: 1 }}>
                  <Icon.Globe /><span><span style={{ fontWeight: 600 }}>Website</span> : {company.website}</span>
                </div>
              )}
              {company.gstin && (
                <div className="flex items-center mono" style={{ fontSize: 7 }}>
                  <Icon.Receipt /><span><span style={{ fontWeight: 600 }}>GSTIN</span> : {company.gstin}</span>
                </div>
              )}
            </div>
          </div>

          {/* CENTER — Partner text (truly centered on page) */}
          <div style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            textAlign: "center",
            paddingTop: 14,
            maxWidth: "42%",
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.gray900, letterSpacing: "0.2px", whiteSpace: "nowrap" }}>
              PROKON HI-TECH SYSTEMS
            </div>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: C.green, marginTop: 3 }}>
              Authorized Sales &amp; Service Partner
            </div>
            <div style={{ fontSize: 8.5, fontWeight: 600, color: C.gray700, marginTop: 2 }}>
              APC by Schneider Electric
            </div>
          </div>

          {/* RIGHT — APC badge */}
          <div style={{ flex: 1, textAlign: "right" }}>
            <img
              src={oemApc.url}
              alt="APC"
              style={{ height: 30, objectFit: "contain", marginBottom: 3 }}
              crossOrigin="anonymous"
            />
            {/* Badge stack */}
            <div style={{ display: "inline-block", textAlign: "center", fontSize: 7, overflow: "hidden" }}>
              <div style={{ background: C.greenDark, color: "white", padding: "3px 14px", fontWeight: 700, letterSpacing: "0.05em" }}>
                <Icon.Shield /> Authorized
              </div>
              <div style={{ padding: "2px 14px", fontWeight: 600, borderBottom: `1px solid ${C.green}`, borderTop: `1px solid ${C.green}` }}>
                Sales Partner
              </div>
              <div style={{ background: C.greenLight, color: C.greenDark, padding: "3px 14px", fontWeight: 700, fontSize: 6.5 }}>
                Life Is On
              </div>
            </div>
          </div>
        </div>

        {/* Green hairline */}
        <div style={{ borderTop: `2px solid ${C.green}`, marginBottom: 6 }} />


        {/* ════════════════════════════════════════════════════════════════ */}
        {/*  TAX INVOICE BAR                                               */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 13, fontWeight: 800, color: C.greenDark, letterSpacing: "0.12em", textAlign: "center", flex: 1 }}>
            TAX INVOICE
          </div>
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            <table style={{ width: 190, fontSize: 7.5, borderCollapse: "collapse" }}>
              <tbody>
                {[
                  ["Invoice No.", invoice.invoice_no || "—"],
                  ["Invoice Date", fmtDate(invoice.invoice_date)],
                  ["PO No.", invoice.po_number || "—"],
                  ["PO Date", fmtDate(invoice.po_date)],
                  ["Due Date", fmtDate(invoice.due_date)],
                ].map(([label, value]) => (
                  <tr key={label} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "2.5px 5px", background: C.gray100, fontWeight: 600, color: C.gray500, width: "42%", fontSize: 7 }}>
                      {label}
                    </td>
                    <td className="mono" style={{ padding: "2.5px 5px", textAlign: "right", fontWeight: 600, color: C.gray900, fontSize: 7 }}>
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/*  BILL TO / SHIP TO                                            */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-2 gap-2" style={{ marginBottom: 8 }}>
          {/* BILL TO */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ background: C.greenDark, color: "white", padding: "3px 8px", fontSize: 8, fontWeight: 700, letterSpacing: "0.06em" }}>
              <Icon.FileText /> BILL TO
            </div>
            <div style={{ padding: "6px 8px", fontSize: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 8.5, marginBottom: 2, color: C.gray900 }}>{billTo.name}</div>
              {billTo.address && <div style={{ color: C.gray700, lineHeight: 1.4, fontSize: 7.5 }}>{cleanAddr(billTo.address)}</div>}
              {billTo.gstin && (
                <div style={{ marginTop: 2 }} className="mono">
                  <span style={{ fontWeight: 700, color: C.gray700 }}>GSTIN</span> : <span style={{ color: C.gray900 }}>{billTo.gstin}</span>
                </div>
              )}
              {billTo.state && <div style={{ fontSize: 7.5 }}><span style={{ fontWeight: 600, color: C.gray700 }}>State</span> : {billTo.state} ({billTo.state_code || "06"})</div>}
              {billTo.phone && <div style={{ fontSize: 7.5 }}><span style={{ fontWeight: 600, color: C.gray700 }}>Mobile</span> : {billTo.phone}</div>}
              {billTo.email && <div style={{ fontSize: 7.5 }}><span style={{ fontWeight: 600, color: C.gray700 }}>Email</span> : {billTo.email}</div>}
            </div>
          </div>

          {/* SHIP TO */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ background: C.greenDark, color: "white", padding: "3px 8px", fontSize: 8, fontWeight: 700, letterSpacing: "0.06em" }}>
              <Icon.Truck /> SHIP TO
            </div>
            <div style={{ padding: "6px 8px", fontSize: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 8.5, marginBottom: 2, color: C.gray900 }}>{shipTo?.name || billTo.name}</div>
              {shipAddr && <div style={{ color: C.gray700, lineHeight: 1.4, fontSize: 7.5 }}>{shipAddr}</div>}
              {(shipTo?.contact_name || shipTo?.contact_phone) && (
                <div style={{ marginTop: 3, paddingTop: 3, borderTop: `1px solid ${C.border}`, fontSize: 7.5, fontWeight: 600, color: C.gray700 }}>
                  Contact : {shipTo?.contact_name}{shipTo?.contact_phone ? ` | ${shipTo.contact_phone}` : ""}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/*  ITEMS TABLE                                                  */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4, border: `1px solid ${C.greenDark}` }}>
          <thead>
            <tr>
              <th style={{ ...th, width: "3%", textAlign: "center" }}>S.No.</th>
              <th style={{ ...th, textAlign: "left" }}>Product Description</th>
              <th style={{ ...th, width: "6%", textAlign: "center" }}>HSN</th>
              <th style={{ ...th, width: "4%", textAlign: "center" }}>Qty</th>
              <th style={{ ...th, width: "5%", textAlign: "center" }}>Unit</th>
              <th style={{ ...th, width: "9%", textAlign: "right" }}>Rate (₹)</th>
              {showCgstSgst ? (
                <>
                  <th colSpan={2} style={{ ...th, width: "13%", textAlign: "center" }}>CGST</th>
                  <th colSpan={2} style={{ ...th, width: "13%", textAlign: "center" }}>SGST</th>
                </>
              ) : (
                <th colSpan={2} style={{ ...th, width: "13%", textAlign: "center" }}>IGST</th>
              )}
              <th style={{ ...th, width: "10%", textAlign: "right" }}>Amount (₹)</th>
            </tr>
            <tr>
              {showCgstSgst ? (
                <>
                  <th style={thSub} /><th style={thSub} /><th style={thSub} /><th style={thSub} /><th style={thSub} /><th style={thSub} />
                  <th style={{ ...thSub, width: "4%", textAlign: "center" }}>%</th>
                  <th style={{ ...thSub, width: "9%", textAlign: "right" }}>Amt</th>
                  <th style={{ ...thSub, width: "4%", textAlign: "center" }}>%</th>
                  <th style={{ ...thSub, width: "9%", textAlign: "right" }}>Amt</th>
                  <th style={thSub} />
                </>
              ) : (
                <>
                  <th style={thSub} /><th style={thSub} /><th style={thSub} /><th style={thSub} /><th style={thSub} /><th style={thSub} />
                  <th style={{ ...thSub, width: "6%", textAlign: "center" }}>%</th>
                  <th style={{ ...thSub, width: "13%", textAlign: "right" }}>Amt</th>
                  <th style={thSub} />
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const half = it.cgst_amount != null || it.sgst_amount != null
                ? (it.cgst_amount ?? 0) || (it.sgst_amount ?? 0)
                : +((it.amount * (it.gst_percent || 0)) / 200).toFixed(2);
              const igst = it.igst_amount != null
                ? it.igst_amount
                : +((it.amount * (it.gst_percent || 0)) / 100).toFixed(2);
              const serials = it.serial_numbers?.filter(Boolean);
              const taxable = it.taxable_value || it.amount;
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ ...tdC, color: C.gray500 }}>{i + 1}</td>
                  <td style={tdL}>
                    <div style={{ fontWeight: 600, color: C.gray900 }}>{it.description}</div>
                    {it.item_details && (
                      <div style={{ fontSize: 7, color: C.gray500, marginTop: 1, whiteSpace: "pre-line" }}>
                        {it.item_details}
                      </div>
                    )}
                    {serials && serials.length > 0 && (
                      <div className="mono" style={{ fontSize: 7, color: C.gray500, marginTop: 1 }}>
                        Serial No: {serials.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="mono" style={{ ...tdC, fontSize: 7 }}>{it.hsn || "—"}</td>
                  <td style={tdC}>{it.qty}</td>
                  <td style={tdC}>{it.unit || "Nos"}</td>
                  <td className="mono" style={tdR}>{fmt(it.rate)}</td>
                  {showCgstSgst ? (
                    <>
                      <td style={{ ...tdC, fontSize: 7 }}>{(it.gst_percent / 2).toFixed(1)}%</td>
                      <td className="mono" style={tdR}>{fmt(half)}</td>
                      <td style={{ ...tdC, fontSize: 7 }}>{(it.gst_percent / 2).toFixed(1)}%</td>
                      <td className="mono" style={tdR}>{fmt(half)}</td>
                    </>
                  ) : (
                    <>
                      <td style={{ ...tdC, fontSize: 7 }}>{it.gst_percent}%</td>
                      <td className="mono" style={tdR}>{fmt(igst)}</td>
                    </>
                  )}
                  <td className="mono" style={{ ...tdR, fontWeight: 700, color: C.gray900 }}>{fmt(it.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/*  TOTALS (right-aligned)                                       */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div className="flex justify-end" style={{ marginBottom: 6 }}>
          <div style={{ width: "50%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 8.5 }}>
              <tbody>
                <tr>
                  <td style={{ padding: "3px 6px", background: C.gray100, fontWeight: 600, borderBottom: `1px solid ${C.border}`, color: C.gray700 }}>Subtotal</td>
                  <td className="mono" style={{ padding: "3px 6px", textAlign: "right", borderBottom: `1px solid ${C.border}` }}>{fmt(taxableTotal)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "3px 6px", background: C.gray100, fontWeight: 600, borderBottom: `1px solid ${C.border}`, color: C.gray700 }}>Total Tax</td>
                  <td className="mono" style={{ padding: "3px 6px", textAlign: "right", borderBottom: `1px solid ${C.border}` }}>{fmt(totalTax)}</td>
                </tr>
                {invoice.round_off !== undefined && invoice.round_off !== 0 && (
                  <tr>
                    <td style={{ padding: "3px 6px", background: C.gray100, fontWeight: 600, borderBottom: `1px solid ${C.border}`, color: C.gray700 }}>Round Off</td>
                    <td className="mono" style={{ padding: "3px 6px", textAlign: "right", borderBottom: `1px solid ${C.border}` }}>{invoice.round_off > 0 ? "+" : ""}{fmt(invoice.round_off)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ padding: "5px 6px", background: C.greenDark, color: "white", fontWeight: 800, fontSize: 9 }}>GRAND TOTAL</td>
                  <td className="mono" style={{ padding: "5px 6px", textAlign: "right", background: C.greenDark, color: "white", fontWeight: 800, fontSize: 10 }}>₹ {fmt(invoice.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/*  AMOUNT IN WORDS                                             */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div style={{ border: `1px solid ${C.border}`, padding: "4px 8px", marginBottom: 6, fontSize: 8, background: C.offWhite }}>
          <span style={{ fontWeight: 700, color: C.gray700 }}>Amount in Words : </span>
          <span style={{ fontStyle: "italic", color: C.gray900 }}>
            {invoice.total_in_words || amountInWords(invoice.total)}
          </span>
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/*  4-COLUMN GRID                                               */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-4 gap-0" style={{ border: `1px solid ${C.border}`, marginBottom: 6, fontSize: 7 }}>
          {/* Warranty */}
          <div style={{ padding: "5px 6px", borderRight: `1px solid ${C.border}` }}>
            <div style={{ background: C.greenDark, color: "white", padding: "2.5px 5px", fontWeight: 700, fontSize: 7, marginBottom: 3, letterSpacing: "0.03em" }}>
              <Icon.Shield /> WARRANTY & AMC
            </div>
            <div style={{ lineHeight: 1.6, color: C.gray700 }}>
              <div><span style={{ fontWeight: 600 }}>Warranty</span> : 36 Months</div>
              <div><span style={{ fontWeight: 600 }}>Expiry</span> : {fmtDate(invoice.due_date)}</div>
              <div><span style={{ fontWeight: 600 }}>AMC Status</span> : Active</div>
            </div>
            <div style={{ marginTop: 3, fontSize: 6.5, color: C.gray500 }}>* As per APC / OEM Policy</div>
          </div>

          {/* Payment */}
          <div style={{ padding: "5px 6px", borderRight: `1px solid ${C.border}` }}>
            <div style={{ background: C.greenDark, color: "white", padding: "2.5px 5px", fontWeight: 700, fontSize: 7, marginBottom: 3, letterSpacing: "0.03em" }}>
              <Icon.Building /> PAYMENT DETAILS
            </div>
            <div style={{ lineHeight: 1.6, color: C.gray700 }}>
              <div><span style={{ fontWeight: 600 }}>Bank</span> : {branch?.bank_name || "—"}</div>
              <div><span style={{ fontWeight: 600 }}>A/c Name</span> : {company.name}</div>
              <div className="mono"><span style={{ fontWeight: 600 }}>A/c No.</span> : {branch?.bank_account || "—"}</div>
              <div className="mono"><span style={{ fontWeight: 600 }}>IFSC</span> : {branch?.bank_ifsc || "—"}</div>
            </div>
          </div>

          {/* UPI QR */}
          <div style={{ padding: "5px 6px", borderRight: `1px solid ${C.border}`, textAlign: "center" }}>
            <div style={{ background: C.greenDark, color: "white", padding: "2.5px 5px", fontWeight: 700, fontSize: 7, marginBottom: 3, letterSpacing: "0.03em" }}>
              UPI QR CODE
            </div>
            <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 3, padding: 4, display: "inline-block" }}>
              <div style={{ width: 70, height: 70, background: C.gray100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 6.5, color: C.gray500 }}>
                QR Code
              </div>
            </div>
            {branch?.upi_id && (
              <div className="mono" style={{ marginTop: 2, fontSize: 6.5, color: C.gray500 }}>UPI: {branch.upi_id}</div>
            )}
          </div>

          {/* E-Invoice QR */}
          <div style={{ padding: "5px 6px", textAlign: "center" }}>
            <div style={{ background: C.greenDark, color: "white", padding: "2.5px 5px", fontWeight: 700, fontSize: 7, marginBottom: 3, letterSpacing: "0.03em" }}>
              E-INVOICE QR
            </div>
            <div style={{ background: "white", border: `1px solid ${C.border}`, borderRadius: 3, padding: 4, display: "inline-block" }}>
              <div style={{ width: 70, height: 70, background: C.gray100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 6.5, color: C.gray500 }}>
                QR Code
              </div>
            </div>
            {invoice.irn && (
              <div className="mono" style={{ marginTop: 2, fontSize: 6, color: C.gray500, wordBreak: "break-all" }}>
                IRN: {invoice.irn.slice(0, 20)}...
              </div>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/*  FOOTER — Terms | Service | Signatory                        */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-3 gap-2" style={{ marginBottom: 6, fontSize: 7.5 }}>
          {/* Terms */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ background: C.greenDark, color: "white", padding: "3px 6px", fontWeight: 700, fontSize: 7.5 }}>
              TERMS & CONDITIONS
            </div>
            <div style={{ padding: "5px 6px", lineHeight: 1.5, fontSize: 7, color: C.gray700 }}>
              {invoice.terms ? (
                invoice.terms.split("\n").map((line, i) => <div key={i}>{line}</div>)
              ) : (
                <>
                  <div>1. Goods once sold will not be taken back.</div>
                  <div>2. Warranty as per APC / OEM policy.</div>
                  <div>3. Payment due as per agreed terms.</div>
                  <div>4. Interest @18% p.a. on delayed payments.</div>
                  <div>5. Subject to Gurgaon jurisdiction.</div>
                </>
              )}
            </div>
          </div>

          {/* Service Support */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ background: C.greenDark, color: "white", padding: "3px 6px", fontWeight: 700, fontSize: 7.5 }}>
              SERVICE SUPPORT
            </div>
            <div style={{ padding: "5px 6px", lineHeight: 1.5, fontSize: 7, color: C.gray700 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>For any service support or complaints:</div>
              {company.phone && <div className="flex items-center"><Icon.Phone /> {company.phone}</div>}
              {company.email && <div className="flex items-center"><Icon.Mail /> {company.email}</div>}
              {company.website && <div className="flex items-center"><Icon.Globe /> {company.website}</div>}
            </div>
          </div>

          {/* Signatory */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 2, textAlign: "center", overflow: "hidden" }}>
            <div style={{ padding: "5px 6px", fontSize: 8, fontWeight: 600, color: C.gray900 }}>
              For {company.name || "Prokon Hi-Tech Systems"}
            </div>
            <div style={{ minHeight: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {authorisedSignatureUrl ? (
                <img src={authorisedSignatureUrl} alt="Signature" style={{ maxHeight: 45, maxWidth: 130, objectFit: "contain" }} crossOrigin="anonymous" />
              ) : (
                <div style={{ width: 110, borderBottom: `1px solid ${C.gray300}`, marginBottom: 3 }} />
              )}
            </div>
            <div style={{ fontSize: 7.5, fontWeight: 600, paddingBottom: 5, color: C.gray700 }}>Authorized Signatory</div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/*  APC BANNER                                                  */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div
          className="flex items-center justify-between"
          style={{ background: C.greenDark, color: "white", padding: "5px 10px", borderRadius: 2, fontSize: 7.5 }}
        >
          <div className="flex items-center gap-2">
            <img src={oemApc.url} alt="APC" style={{ height: 18, objectFit: "contain" }} crossOrigin="anonymous" />
            <span style={{ fontWeight: 600 }}>Power Backup Solutions</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>UPS</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>Batteries</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>AMC</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>Services</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 7.5 }}>Life Is On</div>
        </div>
      </div>
    </div>
  );
}

/* ── Shared styles ────────────────────────────────────────────────────── */

const th: React.CSSProperties = {
  background: C.greenDark,
  color: "white",
  padding: "4px 3px",
  fontSize: 7,
  fontWeight: 700,
  border: `1px solid ${C.greenDark}`,
  letterSpacing: "0.03em",
};

const thSub: React.CSSProperties = {
  background: C.greenDark,
  color: "white",
  padding: "1.5px 3px",
  fontSize: 6.5,
  fontWeight: 600,
  border: `1px solid ${C.greenDark}`,
};

const tdL: React.CSSProperties = {
  padding: "4px 3px",
  border: `1px solid ${C.border}`,
  fontSize: 7.5,
  verticalAlign: "top",
};

const tdC: React.CSSProperties = {
  padding: "4px 3px",
  border: `1px solid ${C.border}`,
  fontSize: 7.5,
  textAlign: "center",
  verticalAlign: "middle",
};

const tdR: React.CSSProperties = {
  padding: "4px 3px",
  border: `1px solid ${C.border}`,
  fontSize: 7.5,
  textAlign: "right",
  verticalAlign: "middle",
};

const taxTh: React.CSSProperties = {
  background: C.greenDark,
  color: "white",
  padding: "3px 5px",
  fontSize: 7,
  fontWeight: 700,
  border: `1px solid ${C.greenDark}`,
  textAlign: "center",
};

const taxTd: React.CSSProperties = {
  padding: "3px 5px",
  borderBottom: `1px solid ${C.border}`,
  fontSize: 7.5,
};

const taxTdR: React.CSSProperties = {
  padding: "3px 5px",
  borderBottom: `1px solid ${C.border}`,
  fontSize: 7.5,
  textAlign: "right",
};
