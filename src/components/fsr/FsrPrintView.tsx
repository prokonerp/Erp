/**
 * FsrPrintView — A4 portrait FIELD SERVICE REPORT template (2 fixed pages).
 *
 * Faithful clone of InvoicePrintView tokens/structure (see
 * src/components/invoice/InvoicePrintView.tsx): same greens, greys, Arial
 * stack, tabular-nums 8.6px cells, g-bg header bands, section-frame boxes,
 * avoid-break blocks, 1.2px FRAME sheet. Pure presentational — every value
 * comes from `model` (built via buildFsrPrintModel); sparse data already
 * degrades to "—" in the model layer, so this view never throws.
 *
 * Print pipeline (see src/lib/docPdf.ts): each page is wrapped in
 * `.defective-tag-page` (the exact class the multi-page pipeline paginates
 * on) containing a `.fsr-print` sheet. Print → printMultiPageElement,
 * Download → saveMultiPageElementAsPdf.
 */
import type { CSSProperties, ReactNode } from "react";
import { Globe, Landmark, Mail, MapPin, Phone } from "lucide-react";
import type { CompanyProfile } from "@/lib/companyProfile";
import type { FsrPrintModel } from "@/lib/fsrPrint";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import apcLogo from "@/assets/oem-apc.png.asset.json";

export type FsrOemLogo = { url: string; alt: string } | null;

export type FsrPrintViewProps = {
  model: FsrPrintModel;
  company: CompanyProfile;
  oem: FsrOemLogo;
  /** Customer signature as a data URL (or null → blank line). */
  signatureDataUrl: string | null;
};

// ---------------------------------------------------------------------------
// Design tokens — single source of truth, mirrored from InvoicePrintView
// ---------------------------------------------------------------------------

const GREEN = "#1F9D4D"; // brand green — headings, table headers, footer
const GREEN_DARK = "#157A3B"; // pressed/darker green for small text accents
const GREEN_TINT = "#E7F4EC"; // pale green wash — emphasis rows
const HEADER_BG = "#e8f5e9"; // light green for section header backgrounds
const INK = "#111111"; // near-black — frames, primary text
const INNER = "#b5b5b5"; // medium grey — all internal cell borders
const FRAME = "#1a1a1a"; // dark grey — outer section frames only
const ZEBRA = "#F5F9F6"; // faint green-grey — alternating item rows
const LABEL_BG = "#F0F2F4"; // neutral label wash — label cells
const SUBTLE = "#3D434B"; // secondary text
const RADIUS = 3; // border-radius for section boxes (px)

// ---------------------------------------------------------------------------
// Shared cell style — internal borders use thin grey; compact padding
// ---------------------------------------------------------------------------

const tdBase: CSSProperties = {
  fontSize: 8.6,
  padding: "3px 5px",
  border: `0.5px solid ${INNER}`,
  color: INK,
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.3,
};

const labelCell: CSSProperties = {
  ...tdBase,
  fontWeight: 700,
  background: LABEL_BG,
  whiteSpace: "nowrap",
};

const sheetStyle: CSSProperties = {
  width: "200mm",
  minHeight: "287mm",
  margin: "0 auto",
  background: "#ffffff",
  color: INK,
  fontFamily: "Arial, Helvetica, sans-serif",
  border: `1.2px solid ${FRAME}`,
  borderRadius: RADIUS,
  padding: "3mm 3mm 2mm",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const STYLE_BLOCK = `
  .fsr-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .fsr-print table { border-collapse: collapse; width: 100%; }

  /* Shared table borders — thin grey internally */
  .fsr-print table th,
  .fsr-print table td { border: 0.5px solid ${INNER}; }

  /* Items table: clean full grid borders on every cell (aligned, no gaps) */
  .fsr-print table.items { border-collapse: collapse; }
  .fsr-print table.items th,
  .fsr-print table.items td {
    border: 0.5px solid ${INNER};
    border-top: none;
  }
  .fsr-print table.items tbody tr:first-child td { border-top: 0.5px solid ${INNER}; }

  /* Outer frame on major section tables: thin grey border + rounded corners */
  .fsr-print .section-frame {
    border: 0.5px solid ${INNER} !important;
    border-radius: ${RADIUS}px;
    overflow: hidden;
  }
  .fsr-print .section-frame th,
  .fsr-print .section-frame td { border: 0.5px solid ${INNER}; }

  /* Green header row — section titles in tables */
  .fsr-print .g-bg {
    background: ${GREEN} !important;
    color: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .fsr-print .g-bg th {
    border-color: rgba(255,255,255,0.3) !important;
  }

  /* Light green section-header background for standalone section titles */
  .fsr-print .section-header {
    background: ${HEADER_BG} !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Tint row */
  .fsr-print .g-tint {
    background: ${GREEN_TINT} !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Alternating zebra rows on item table */
  .fsr-print table.items tbody tr:nth-child(even) td {
    background: ${ZEBRA};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Page-break control */
  .fsr-print tr, .fsr-print .avoid-break { page-break-inside: avoid; break-inside: avoid; }

  @media print {
    @page { size: A4 portrait; margin: 5mm; }
    .fsr-print { width: 200mm; margin: 0 auto !important; min-height: 287mm; }
    .fsr-print table.items thead { display: table-header-group; }
    .fsr-print table.items tr { page-break-inside: avoid; break-inside: avoid; }
  }
`;

// ---------------------------------------------------------------------------
// Small building blocks (mirrored from InvoicePrintView)
// ---------------------------------------------------------------------------

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
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

/** Green band section title row inside a section-frame table. */
function SectionTitle({ children, colSpan }: { children: ReactNode; colSpan: number }) {
  return (
    <tr className="g-bg">
      <th
        colSpan={colSpan}
        style={{
          ...tdBase,
          color: "#fff",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.6,
          textAlign: "left",
          padding: "3px 6px",
        }}
      >
        {children}
      </th>
    </tr>
  );
}

/** Writable blank line (Centre Code, feedback ruled lines, signature lines). */
function BlankLine({ width = "100%" }: { width?: string }) {
  return <div style={{ borderBottom: `0.5px solid ${INNER}`, height: 13, width }} />;
}

/** Checkbox with ✓ when checked. */
function Check({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 8.6, color: INK }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 11,
          height: 11,
          border: `0.8px solid ${INK}`,
          fontSize: 9,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {checked ? "✓" : ""}
      </span>
      {label}
    </span>
  );
}

/** Green rule under the header / above the footer. */
function GreenRule({ marginTop = 4 }: { marginTop?: number }) {
  return (
    <div
      style={{
        height: 3,
        background: GREEN,
        marginTop,
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Letterhead — two-column header + APC block (mirrors InvoicePrintView)
// ---------------------------------------------------------------------------

function Letterhead({ company, oem }: { company: CompanyProfile; oem: FsrOemLogo }) {
  const logo = oem ?? { url: apcLogo.url, alt: "APC" };
  const regdOffice = company.registered_office_address || company.regd_address || "";
  const companyPhones = (company.phone || "")
    .split(/[/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="avoid-break">
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        {/* Left: logo row + company info */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div
              style={{
                width: "34%",
                flex: "0 0 auto",
                display: "flex",
                alignItems: "flex-start",
              }}
            >
              <img
                src={prokonLogo.url}
                alt="Prokon Hi-Tech Systems"
                crossOrigin="anonymous"
                style={{ maxHeight: 55, maxWidth: "100%", objectFit: "contain" }}
              />
            </div>
            <div style={{ flex: 1, textAlign: "center", display: "flex", alignItems: "center" }}>
              <div
                style={{
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  color: INK,
                  width: "100%",
                }}
              >
                {company.name.toUpperCase()}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 0.5 }}>
            <InfoRow icon={<MapPin size={9} />} label="Registered Office" value={regdOffice} />
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
                company.gstin ? (
                  <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{company.gstin}</span>
                ) : (
                  ""
                )
              }
            />
          </div>
        </div>

        {/* OEM branding block — right column, full height */}
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
              src={logo.url}
              alt={logo.alt}
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
      <GreenRule />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Green footer band (mirrors the invoice footer)
// ---------------------------------------------------------------------------

function FooterBand({ oem }: { oem: FsrOemLogo }) {
  const logo = oem ?? { url: apcLogo.url, alt: "APC" };
  return (
    <div style={{ marginTop: "auto", paddingTop: 5 }}>
      <div
        style={{
          textAlign: "center",
          fontSize: 9,
          fontWeight: 700,
          color: INK,
          marginBottom: 3,
        }}
      >
        Prokon Hi-Tech Systems, Faridabad
      </div>
      <GreenRule marginTop={0} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 3 }}>
        <img
          src={logo.url}
          alt={logo.alt}
          crossOrigin="anonymous"
          style={{ maxHeight: 26, objectFit: "contain" }}
        />
        <div style={{ flex: 1, textAlign: "center", fontSize: 10.5, fontWeight: 700, color: INK }}>
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
  );
}

// ---------------------------------------------------------------------------
// Page-1 sections
// ---------------------------------------------------------------------------

/** DD-MM-YYYY for the raw ISO the model carries in header.submittedAt. */
function fmtDate(iso: string): string {
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
}

function MetaRow({ model }: { model: FsrPrintModel }) {
  const cells: Array<{ label: string; value: ReactNode }> = [
    { label: "Service Report No.", value: model.header.reportNo },
    {
      label: "Date",
      value: model.header.submittedAt === "—" ? "—" : fmtDate(model.header.submittedAt),
    },
    { label: "Case ID", value: model.header.caseId },
    { label: "Centre Code", value: <BlankLine /> },
  ];
  return (
    <table className="section-frame avoid-break" style={{ marginTop: 4 }}>
      <tbody>
        <tr>
          {cells.map((c) => (
            <td key={c.label} style={{ ...tdBase, width: "25%", verticalAlign: "top" }}>
              <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE, marginBottom: 1 }}>
                {c.label}
              </div>
              <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function CustomerProduct({ model }: { model: FsrPrintModel }) {
  const c = model.customer;
  const p = model.product;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 4 }} className="avoid-break">
      <table className="section-frame" style={{ flex: 1 }}>
        <tbody>
          <SectionTitle colSpan={2}>CUSTOMER</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "30%" }}>Name</td>
            <td style={tdBase}>{c.name}</td>
          </tr>
          <tr>
            <td style={{ ...labelCell, width: "30%" }}>Address</td>
            <td style={tdBase}>
              {c.addressLines.length ? c.addressLines.map((l, i) => <div key={i}>{l}</div>) : "—"}
            </td>
          </tr>
          <tr>
            <td style={{ ...labelCell, width: "30%" }}>Phone</td>
            <td style={tdBase}>{c.phones.length ? c.phones.join("  |  ") : "—"}</td>
          </tr>
          <tr>
            <td style={{ ...labelCell, width: "30%" }}>Email</td>
            <td style={tdBase}>{c.email}</td>
          </tr>
        </tbody>
      </table>
      <table className="section-frame" style={{ flex: 1 }}>
        <tbody>
          <SectionTitle colSpan={2}>PRODUCT</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "34%" }}>Model</td>
            <td style={tdBase}>{p.model}</td>
          </tr>
          <tr>
            <td style={{ ...labelCell, width: "34%" }}>UPS Sr No.</td>
            <td style={tdBase}>{p.upsSerial}</td>
          </tr>
          <tr>
            <td style={{ ...labelCell, width: "34%" }}>Battery Pack</td>
            <td style={tdBase}>{p.batteryPack}</td>
          </tr>
          <tr>
            <td style={{ ...labelCell, width: "34%" }}>Status</td>
            <td style={tdBase}>{p.statusLabel}</td>
          </tr>
          <tr>
            <td style={{ ...labelCell, width: "34%" }}>Type of Call</td>
            <td style={tdBase}>{p.typeOfCall || "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ProblemRows({ model }: { model: FsrPrintModel }) {
  return (
    <table className="section-frame avoid-break" style={{ marginTop: 4 }}>
      <tbody>
        <tr>
          <td style={{ ...labelCell, width: "22%" }}>Problem Reported</td>
          <td style={tdBase}>{model.problem.reported}</td>
        </tr>
        <tr>
          <td style={{ ...labelCell, width: "22%" }}>Reason for Visit</td>
          <td style={tdBase}>{model.problem.reason}</td>
        </tr>
      </tbody>
    </table>
  );
}

function TimingGrid({ model }: { model: FsrPrintModel }) {
  const t = model.timing;
  const rows: Array<[string, string, string]> = [
    ["Problems Occurred", "", ""],
    ["FSE Despatched", "", ""],
    ["FSE Arrival", t.arrivalDate, t.arrivalTime],
    ["Call Start", "", ""],
    ["Call End", "", ""],
    ["Travel Time", "", ""],
    ["Hands-on Time", "", ""],
    ["Machine Down Time", "", ""],
    ["On-site Time", t.onSite, ""],
  ];
  return (
    <table className="section-frame avoid-break" style={{ marginTop: 4 }}>
      <tbody>
        <SectionTitle colSpan={3}>CALL TIMING</SectionTitle>
        <tr className="section-header">
          <th style={{ ...tdBase, fontWeight: 700, width: "40%" }}>Event</th>
          <th style={{ ...tdBase, fontWeight: 700, width: "30%" }}>Date</th>
          <th style={{ ...tdBase, fontWeight: 700 }}>Time</th>
        </tr>
        {rows.map(([label, date, time]) => (
          <tr key={label}>
            <td style={labelCell}>{label}</td>
            <td style={tdBase}>{date || <BlankLine />}</td>
            <td style={tdBase}>{time || (date ? "" : <BlankLine />)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SiteObservation({ model }: { model: FsrPrintModel }) {
  const o = model.observation;
  const chargingFirst = model.battery.chargingGrid.flat().find((v) => v && v !== "—") ?? "—";
  const dischargingFirst = model.battery.dischargingGrid.flat().find((v) => v && v !== "—") ?? "—";
  const cells: Array<[string, string]> = [
    ["Mains L-N (V)", o.mainsLn],
    ["Mains N-E (V)", o.mainsNe],
    ["Charging (Vdc)", chargingFirst],
    ["Discharging (Vdc)", dischargingFirst],
  ];
  return (
    <table className="section-frame avoid-break" style={{ marginTop: 4 }}>
      <tbody>
        <SectionTitle colSpan={4}>SITE OBSERVATION</SectionTitle>
        <tr>
          {cells.map(([label, value]) => (
            <td key={label} style={{ ...tdBase, width: "25%", verticalAlign: "top" }}>
              <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE, marginBottom: 1 }}>
                {label}
              </div>
              <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function LoadRecord({ model }: { model: FsrPrintModel }) {
  const l = model.load;
  const lines: string[] = [
    ...l.pcs.map((p) => `PC — Monitor ${p.size}" × ${p.qty}`),
    ...l.printers.map((p) => `Printer — ${p.rating}W × ${p.qty}`),
    ...l.scanners.map((s) => `Scanner — ${s.rating}W × ${s.qty}`),
  ];
  return (
    <table className="section-frame avoid-break" style={{ marginTop: 4 }}>
      <tbody>
        <SectionTitle colSpan={4}>LOAD RECORD</SectionTitle>
        <tr>
          <td style={{ ...labelCell, width: "18%" }}>AC Provided</td>
          <td style={{ ...tdBase, width: "14%" }}>{l.ac}</td>
          <td style={{ ...labelCell, width: "18%" }}>DG Provided</td>
          <td style={tdBase}>{l.dg}</td>
        </tr>
        <tr>
          <td style={labelCell}>Environment Duty</td>
          <td style={tdBase}>{l.duty}</td>
          <td style={labelCell}>UPS Location</td>
          <td style={tdBase}>{l.location}</td>
        </tr>
        <tr>
          <td style={labelCell}>Connected Load</td>
          <td style={tdBase} colSpan={3}>
            {lines.length ? lines.map((s, i) => <div key={i}>{s}</div>) : "None"}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function PowerCondition({ model }: { model: FsrPrintModel }) {
  const p = model.power;
  const pairs: Array<[[string, string], [string, string]]> = [
    [
      ["Power Failures (nos)", p.failures],
      ["Duration (min)", p.durationMin],
    ],
    [
      ["Load on DG (%)", p.loadDgPct],
      ["DG Set", p.dgSet],
    ],
    [
      ["DG Capacity (kVA)", p.dgCapacity],
      ["AMF Panel", p.amf],
    ],
    [
      ["Non-Business Hrs", p.nonBiz],
      ["Holidays", p.holidays],
    ],
  ];
  return (
    <table className="section-frame avoid-break" style={{ marginTop: 4 }}>
      <tbody>
        <SectionTitle colSpan={4}>POWER CONDITION</SectionTitle>
        {pairs.map(([a, b], i) => (
          <tr key={i}>
            <td style={{ ...labelCell, width: "28%" }}>{a[0]}</td>
            <td style={{ ...tdBase, width: "22%" }}>{a[1]}</td>
            <td style={{ ...labelCell, width: "28%" }}>{b[0]}</td>
            <td style={tdBase}>{b[1]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Page-2 sections
// ---------------------------------------------------------------------------

function BatteryBank({ model }: { model: FsrPrintModel }) {
  const b = model.battery;
  return (
    <table className="section-frame avoid-break" style={{ marginTop: 4 }}>
      <tbody>
        <SectionTitle colSpan={3}>BATTERY RECORD — BANK</SectionTitle>
        <tr>
          <td style={{ ...tdBase, width: "34%", verticalAlign: "top" }}>
            <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE, marginBottom: 1 }}>
              Make
            </div>
            <div style={{ fontWeight: 700 }}>{b.make}</div>
          </td>
          <td style={{ ...tdBase, width: "33%", verticalAlign: "top" }}>
            <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE, marginBottom: 1 }}>Ah</div>
            <div style={{ fontWeight: 700 }}>{b.ah}</div>
          </td>
          <td style={{ ...tdBase, verticalAlign: "top" }}>
            <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE, marginBottom: 1 }}>
              Qty
            </div>
            <div style={{ fontWeight: 700 }}>{b.qty}</div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * One battery grid (charging / discharging) as 4-column tables, one table per
 * chunk of 4 readings with continuous Batt numbering. Chunking (not one wide
 * N-column table) keeps columns readable for large banks (up to 20 readings).
 */
function GridGroup({ title, grid }: { title: string; grid: string[][] }) {
  const flat = (grid ?? []).flatMap((r) => r);
  const chunks: string[][] = [];
  for (let i = 0; i < flat.length; i += 4) chunks.push(flat.slice(i, i + 4));
  return (
    <div className="avoid-break" style={{ marginTop: 4 }}>
      <div style={{ fontSize: 8.6, fontWeight: 700, color: INK, marginBottom: 2 }}>{title}</div>
      {flat.length === 0 ? (
        <div style={{ ...tdBase, border: `0.5px solid ${INNER}`, borderRadius: RADIUS }}>
          No readings recorded
        </div>
      ) : (
        chunks.map((cells, ci) => (
          <table key={ci} className="section-frame" style={{ marginTop: ci ? 2 : 0 }}>
            <tbody>
              <tr className="g-bg">
                {cells.map((_, j) => (
                  <th
                    key={j}
                    style={{
                      ...tdBase,
                      color: "#fff",
                      fontWeight: 700,
                      textAlign: "center",
                      width: "25%",
                    }}
                  >
                    Batt {ci * 4 + j + 1}
                  </th>
                ))}
                {cells.length < 4
                  ? Array.from({ length: 4 - cells.length }).map((_, j) => (
                      <th
                        key={`pad-h-${j}`}
                        style={{
                          ...tdBase,
                          color: "#fff",
                          fontWeight: 700,
                          textAlign: "center",
                          width: "25%",
                        }}
                      >
                        —
                      </th>
                    ))
                  : null}
              </tr>
              <tr>
                {cells.map((v, j) => (
                  <td key={j} style={{ ...tdBase, textAlign: "center", fontWeight: 700 }}>
                    {v}
                  </td>
                ))}
                {cells.length < 4
                  ? Array.from({ length: 4 - cells.length }).map((_, j) => (
                      <td key={`pad-${j}`} style={{ ...tdBase, textAlign: "center" }}>
                        —
                      </td>
                    ))
                  : null}
              </tr>
            </tbody>
          </table>
        ))
      )}
      {flat.length > 0 ? (
        <div style={{ fontSize: 7.5, color: SUBTLE, marginTop: 1 }}>Volts (Vdc)</div>
      ) : null}
    </div>
  );
}

function PartReplacement({ model }: { model: FsrPrintModel }) {
  return (
    <div className="avoid-break" style={{ marginTop: 4 }}>
      <table className="items">
        <thead>
          <tr className="g-bg">
            {["#", "Item Replaced", "Old Sr No", "New Sr No", "Qty", "Charges ₹"].map((h, i) => (
              <th
                key={h}
                style={{
                  ...tdBase,
                  color: "#fff",
                  fontWeight: 700,
                  textAlign: i === 1 ? "left" : "center",
                  width: i === 0 ? "5%" : i === 1 ? "35%" : i === 5 ? "14%" : undefined,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
          <tr>
            <th
              colSpan={6}
              style={{ ...tdBase, fontWeight: 700, letterSpacing: 0.6, textAlign: "left" }}
            >
              PART REPLACEMENT
            </th>
          </tr>
        </thead>
        <tbody>
          {model.parts.length === 0 ? (
            <tr>
              <td style={{ ...tdBase, textAlign: "center" }} colSpan={6}>
                No parts replaced
              </td>
            </tr>
          ) : (
            model.parts.map((p) => (
              <tr key={p.n}>
                <td style={{ ...tdBase, textAlign: "center" }}>{p.n}</td>
                <td style={tdBase}>
                  <div style={{ fontWeight: 700 }}>{p.item}</div>
                </td>
                <td style={{ ...tdBase, textAlign: "center" }}>{p.oldSr}</td>
                <td style={{ ...tdBase, textAlign: "center" }}>{p.newSr}</td>
                <td style={{ ...tdBase, textAlign: "center" }}>{p.qty}</td>
                <td style={{ ...tdBase, textAlign: "right" }}>{p.charges}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Feedback({ model }: { model: FsrPrintModel }) {
  const s = model.feedback.status;
  return (
    <div className="avoid-break" style={{ marginTop: 4 }}>
      <table className="section-frame">
        <tbody>
          <SectionTitle colSpan={2}>FEEDBACK</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "22%" }}>FSE Feedback</td>
            <td style={tdBase}>
              <BlankLine />
              <BlankLine />
            </td>
          </tr>
          <tr>
            <td style={{ ...labelCell, width: "22%" }}>Customer Feedback</td>
            <td style={tdBase}>
              <BlankLine />
              <BlankLine />
            </td>
          </tr>
          <tr>
            <td style={labelCell}>Overall Rating (1–10)</td>
            <td style={{ ...tdBase, fontWeight: 700, fontSize: 10 }}>{model.feedback.rating}</td>
          </tr>
          <tr>
            <td style={{ ...tdBase, fontSize: 7.5, color: SUBTLE }} colSpan={2}>
              Rating Scale:
              0&nbsp;&nbsp;1&nbsp;&nbsp;2&nbsp;&nbsp;3&nbsp;&nbsp;4&nbsp;&nbsp;5&nbsp;&nbsp;6&nbsp;&nbsp;7&nbsp;&nbsp;8&nbsp;&nbsp;9&nbsp;&nbsp;10
            </td>
          </tr>
          <tr>
            <td style={labelCell}>Call Status</td>
            <td style={tdBase}>
              <span style={{ display: "inline-flex", gap: 12 }}>
                <Check checked={s === "Complete"} label="Complete" />
                <Check checked={s === "Incomplete"} label="Incomplete" />
                <Check checked={s === "Under Observation"} label="Under Observation" />
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Signatures({
  model,
  signatureDataUrl,
}: {
  model: FsrPrintModel;
  signatureDataUrl: string | null;
}) {
  const sig = model.signatures;
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 4 }} className="avoid-break">
      <div
        style={{
          flex: 1,
          border: `0.5px solid ${INNER}`,
          borderRadius: RADIUS,
          padding: "5px 7px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: GREEN_DARK }}>
          CUSTOMER
        </div>
        <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE }}>Signature</div>
        {signatureDataUrl ? (
          <img
            src={signatureDataUrl}
            alt="Customer signature"
            crossOrigin="anonymous"
            style={{ maxHeight: "30mm", maxWidth: "100%", objectFit: "contain" }}
          />
        ) : (
          <BlankLine />
        )}
        <div style={{ fontSize: 8.6, color: INK }}>
          <b>Name:</b> {sig.customerName}
        </div>
        <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE, marginTop: 4 }}>
          Office Seal
        </div>
        <BlankLine />
        <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE, marginTop: 2 }}>Date</div>
        <BlankLine />
      </div>
      <div
        style={{
          flex: 1,
          border: `0.5px solid ${INNER}`,
          borderRadius: RADIUS,
          padding: "5px 7px",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: GREEN_DARK }}>
          FIELD SERVICE ENGINEER
        </div>
        <div style={{ fontSize: 8.6, color: INK }}>
          <b>Name:</b> {sig.fseName}
        </div>
        <div style={{ fontSize: 8.6, color: INK }}>
          <b>No:</b> {sig.fsePhone}
        </div>
        <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE, marginTop: 4 }}>
          FSE Signature
        </div>
        <BlankLine />
        <div style={{ fontSize: 7.5, fontWeight: 700, color: SUBTLE, marginTop: 2 }}>Date</div>
        <BlankLine />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root — page 1 fixed; battery section flows onto a dedicated page for large
// banks so the PDF-download path never has to shrink a page to fit
// ---------------------------------------------------------------------------

/**
 * Chunked grid tables on page 2 beyond this spill the battery section onto a
 * dedicated page. ~6 tables + parts + feedback + signatures
 * ≈ 269mm worst case on one sheet; beyond that the download path would shrink
 * the whole page instead of paginating cleanly.
 */
const MAX_GRID_TABLES_CLASSIC = 6;

function countGridTables(grid: string[][]): number {
  const n = (grid ?? []).flatMap((r) => r).length;
  return Math.ceil(n / 4);
}

function PageNo({ page, total }: { page: number; total: number }) {
  return (
    <span style={{ float: "right", fontSize: 7, color: SUBTLE, letterSpacing: 1 }}>
      Page {page} of {total}
    </span>
  );
}

function ContdTitle({ page, total }: { page: number; total: number }) {
  return (
    <div
      style={{
        textAlign: "center",
        fontSize: 8,
        fontWeight: 700,
        color: GREEN,
        letterSpacing: 3,
        marginBottom: 0,
      }}
    >
      FIELD SERVICE REPORT (Contd.)
      <PageNo page={page} total={total} />
    </div>
  );
}

export function FsrPrintView({ model, company, oem, signatureDataUrl }: FsrPrintViewProps) {
  const nTables =
    countGridTables(model.battery.chargingGrid) + countGridTables(model.battery.dischargingGrid);
  const classic = nTables <= MAX_GRID_TABLES_CLASSIC;
  const total = classic ? 2 : 3;
  return (
    <>
      {/* ============================ PAGE 1 ============================ */}
      <div className="defective-tag-page">
        <div className="fsr-print" style={sheetStyle}>
          <style>{STYLE_BLOCK}</style>
          <Letterhead company={company} oem={oem} />
          <div
            style={{
              textAlign: "center",
              fontSize: 8,
              fontWeight: 700,
              color: GREEN,
              letterSpacing: 3,
              marginTop: 4,
            }}
          >
            FIELD SERVICE REPORT
            <PageNo page={1} total={total} />
          </div>
          <MetaRow model={model} />
          <CustomerProduct model={model} />
          <ProblemRows model={model} />
          <TimingGrid model={model} />
          <SiteObservation model={model} />
          <LoadRecord model={model} />
          <PowerCondition model={model} />
        </div>
      </div>

      {classic ? (
        /* ============================ PAGE 2 (classic) ============================ */
        <div className="defective-tag-page">
          <div className="fsr-print" style={sheetStyle}>
            <style>{STYLE_BLOCK}</style>
            <ContdTitle page={2} total={2} />
            <BatteryBank model={model} />
            <GridGroup title="Charging — Battery Volts (Vdc)" grid={model.battery.chargingGrid} />
            <GridGroup
              title="Discharging — Battery Volts (Vdc)"
              grid={model.battery.dischargingGrid}
            />
            <PartReplacement model={model} />
            <Feedback model={model} />
            <Signatures model={model} signatureDataUrl={signatureDataUrl} />
            <FooterBand oem={oem} />
          </div>
        </div>
      ) : (
        <>
          {/* ============================ PAGE 2 (battery, large banks) ============================ */}
          <div className="defective-tag-page">
            <div className="fsr-print" style={sheetStyle}>
              <style>{STYLE_BLOCK}</style>
              <ContdTitle page={2} total={3} />
              <BatteryBank model={model} />
              <GridGroup title="Charging — Battery Volts (Vdc)" grid={model.battery.chargingGrid} />
              <GridGroup
                title="Discharging — Battery Volts (Vdc)"
                grid={model.battery.dischargingGrid}
              />
            </div>
          </div>
          {/* ============================ PAGE 3 (parts + sign-off) ============================ */}
          <div className="defective-tag-page">
            <div className="fsr-print" style={sheetStyle}>
              <style>{STYLE_BLOCK}</style>
              <ContdTitle page={3} total={3} />
              <PartReplacement model={model} />
              <Feedback model={model} />
              <Signatures model={model} signatureDataUrl={signatureDataUrl} />
              <FooterBand oem={oem} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
