/**
 * FsrPrintView — single-page A4 LANDSCAPE Field Service Report.
 *
 * One `.defective-tag-page` wrapper = one printed/PDF page (see
 * printMultiPageElement / saveMultiPageElementAsPdf in src/lib/docPdf.ts —
 * both are called with `{ landscape: true }` from FsrPrintButton).
 * Narrow 4mm margins, dense 7–8px tables, Schneider/APC greens only.
 * Pure presentational — every value comes from `model` (built via
 * buildFsrPrintModel); sparse data already degrades to "—" in the model
 * layer, so this view never throws.
 */
import type { CSSProperties, ReactNode } from "react";
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
// Design tokens — Schneider / APC greens only, Arial stack, tabular numbers
// ---------------------------------------------------------------------------

const GREEN = "#0E7C3A"; // deep Schneider green — bands, titles, footer
const GREEN_BRIGHT = "#3DCD58"; // Schneider accent — rules, highlights
const GREEN_TINT = "#E9F5EE"; // pale wash — label cells, zebra
const GREEN_PALE = "#F2F9F4"; // faintest wash — alternating rows
const INK = "#14201A"; // near-black green-tinted text
const SUBTLE = "#4A5A51"; // secondary text
const INNER = "#B9C8BE"; // thin internal cell borders
const FRAME = "#0E7C3A"; // green outer frames
const RADIUS = 3;

const FONT = "Arial, Helvetica, sans-serif";

const tdBase: CSSProperties = {
  fontSize: 7.4,
  padding: "1.6px 4px",
  border: `0.5px solid ${INNER}`,
  color: INK,
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.25,
};

const labelCell: CSSProperties = {
  ...tdBase,
  fontWeight: 700,
  background: GREEN_TINT,
  whiteSpace: "nowrap",
};

const sheetStyle: CSSProperties = {
  width: "289mm",
  minHeight: "202mm",
  margin: "0 auto",
  background: "#ffffff",
  color: INK,
  fontFamily: FONT,
  border: `1px solid ${FRAME}`,
  borderRadius: RADIUS,
  padding: "2mm 3mm",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const STYLE_BLOCK = `
  .fsr-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .fsr-print table { border-collapse: collapse; width: 100%; }
  .fsr-print table th,
  .fsr-print table td { border: 0.5px solid ${INNER}; }

  .fsr-print .section-frame {
    border: 0.7px solid ${FRAME} !important;
    border-radius: ${RADIUS}px;
    overflow: hidden;
  }
  .fsr-print .section-frame th,
  .fsr-print .section-frame td { border: 0.5px solid ${INNER}; }

  /* Deep-green band section titles */
  .fsr-print .g-bg {
    background: ${GREEN} !important;
    color: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .fsr-print .g-bg th { border-color: rgba(255,255,255,0.35) !important; }

  .fsr-print tr, .fsr-print .avoid-break { page-break-inside: avoid; break-inside: avoid; }

  @media print {
    @page { size: A4 landscape; margin: 4mm; }
    .fsr-print { width: 289mm; margin: 0 auto !important; min-height: 0; }
  }
`;

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** Green band section title row inside a section-frame table. */
function SectionTitle({ children, colSpan }: { children: ReactNode; colSpan: number }) {
  return (
    <tr className="g-bg">
      <th
        colSpan={colSpan}
        style={{
          ...tdBase,
          color: "#fff",
          fontSize: 7.8,
          fontWeight: 700,
          letterSpacing: 0.8,
          textAlign: "left",
          padding: "1.6px 6px",
        }}
      >
        {children}
      </th>
    </tr>
  );
}

/** Writable blank line (feedback, signature, seal rows). */
function BlankLine({ width = "100%" }: { width?: string }) {
  return <div style={{ borderBottom: `0.5px solid ${INNER}`, height: 11, width }} />;
}

/** Checkbox with ✓ when checked. */
function Check({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 7.4, color: INK }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 9,
          height: 9,
          border: `0.8px solid ${GREEN}`,
          fontSize: 8,
          fontWeight: 700,
          lineHeight: 1,
          color: GREEN,
        }}
      >
        {checked ? "✓" : ""}
      </span>
      {label}
    </span>
  );
}

/** Bright-green hairline rule. Grows to fill flex rows when asked. */
function GreenRule({ grow = false }: { grow?: boolean }) {
  return (
    <div
      style={{
        height: 2,
        background: GREEN_BRIGHT,
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
        ...(grow ? { flex: 1 } : null),
      }}
    />
  );
}

/** DD-MM-YYYY for the raw ISO the model carries in header.submittedAt. */
function fmtDate(iso: string): string {
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
}

/** Hard character clamp for free-text print cells (deterministic — works in
 *  html2canvas where CSS line-clamp is unreliable). Prevents page-2 spills. */
function clampPrint(value: ReactNode, max: number): ReactNode {
  if (typeof value !== "string") return value;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Tiny label-over-value stat cell (meta strip + observation strip). */
function StatCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <td style={{ ...tdBase, verticalAlign: "top" }}>
      <div style={{ fontSize: 6.4, fontWeight: 700, color: SUBTLE, letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </td>
  );
}

// ---------------------------------------------------------------------------
// Header — compact single band: logos + company + report identity
// ---------------------------------------------------------------------------

function Header({
  model,
  company,
  oem,
}: {
  model: FsrPrintModel;
  company: CompanyProfile;
  oem: FsrOemLogo;
}) {
  const logo = oem ?? { url: apcLogo.url, alt: "APC" };
  const phones = (company.phone || "")
    .split(/[/|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("  |  ");
  return (
    <div className="avoid-break">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <img
          src={prokonLogo.url}
          alt="Prokon Hi-Tech Systems"
          crossOrigin="anonymous"
          style={{ height: 30, objectFit: "contain", flex: "0 0 auto" }}
        />
        <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.3, color: INK }}>
            {company.name.toUpperCase()}
          </div>
          <div
            style={{
              fontSize: 6.6,
              color: SUBTLE,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {[company.registered_office_address || company.regd_address, phones, company.email]
              .filter(Boolean)
              .join("   •   ")}
            {company.gstin ? `   •   GSTIN: ${company.gstin}` : ""}
          </div>
        </div>
        <div style={{ flex: "0 0 auto", textAlign: "center" }}>
          <img
            src={logo.url}
            alt={logo.alt}
            crossOrigin="anonymous"
            style={{ height: 24, objectFit: "contain" }}
          />
          <div style={{ fontSize: 6.4, fontWeight: 700, color: GREEN, letterSpacing: 0.6 }}>
            AUTHORIZED SALES PARTNER
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
        <GreenRule grow />
        <div
          style={{
            background: GREEN,
            color: "#fff",
            fontSize: 8.4,
            fontWeight: 700,
            letterSpacing: 2,
            padding: "1.5px 14px",
            borderRadius: 2,
            whiteSpace: "nowrap",
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        >
          FIELD SERVICE REPORT
        </div>
        <GreenRule grow />
      </div>
      <table className="section-frame" style={{ marginTop: 3 }}>
        <tbody>
          <tr>
            <StatCell label="SERVICE REPORT NO." value={model.header.reportNo} />
            <StatCell
              label="DATE"
              value={model.header.submittedAt === "—" ? "—" : fmtDate(model.header.submittedAt)}
            />
            <StatCell label="CASE ID" value={model.header.caseId} />
            <StatCell label="CALL TYPE" value={model.product.typeOfCall || "—"} />
            <StatCell label="CALL STATUS" value={model.feedback.status} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body sections — dense two/three-column bands
// ---------------------------------------------------------------------------

function CustomerCall({ model }: { model: FsrPrintModel }) {
  const c = model.customer;
  const p = model.product;
  const t = model.timing;
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 3 }} className="avoid-break">
      <table className="section-frame" style={{ flex: 1.25 }}>
        <tbody>
          <SectionTitle colSpan={2}>CUSTOMER</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "26%" }}>Name</td>
            <td style={tdBase}>{clampPrint(c.name, 80)}</td>
          </tr>
          <tr>
            <td style={labelCell}>Address</td>
            <td style={tdBase}>
              {c.addressLines.length ? clampPrint(c.addressLines.join(", "), 180) : "—"}
            </td>
          </tr>
          <tr>
            <td style={labelCell}>Phone / Email</td>
            <td style={tdBase}>
              {[c.phones.join(" | "), c.email].filter((v) => v && v !== "—").join("  •  ") || "—"}
            </td>
          </tr>
        </tbody>
      </table>
      <table className="section-frame" style={{ flex: 1 }}>
        <tbody>
          <SectionTitle colSpan={2}>PRODUCT &amp; CALL</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "32%" }}>Model</td>
            <td style={tdBase}>{p.model}</td>
          </tr>
          <tr>
            <td style={labelCell}>UPS Sr No.</td>
            <td style={tdBase}>{p.upsSerial}</td>
          </tr>
          <tr>
            <td style={labelCell}>Battery Pack</td>
            <td style={tdBase}>{p.batteryPack}</td>
          </tr>
        </tbody>
      </table>
      <table className="section-frame" style={{ flex: 1 }}>
        <tbody>
          <SectionTitle colSpan={3}>VISIT TIMING</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "34%" }}>Arrival</td>
            <td style={tdBase}>
              {t.arrivalDate} {t.arrivalTime}
            </td>
          </tr>
          <tr>
            <td style={labelCell}>Departure</td>
            <td style={tdBase}>
              {t.departureDate} {t.departureTime}
            </td>
          </tr>
          <tr>
            <td style={labelCell}>On-site Time</td>
            <td style={tdBase}>{t.onSite}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ProblemStrip({ model }: { model: FsrPrintModel }) {
  return (
    <table className="section-frame avoid-break" style={{ marginTop: 3 }}>
      <tbody>
        <tr>
          <td style={{ ...labelCell, width: "14%" }}>Problem Reported</td>
          <td style={{ ...tdBase, width: "36%" }}>{clampPrint(model.problem.reported, 180)}</td>
          <td style={{ ...labelCell, width: "14%" }}>Reason for Visit</td>
          <td style={tdBase}>{clampPrint(model.problem.reason, 180)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function ObservationLoad({ model }: { model: FsrPrintModel }) {
  const o = model.observation;
  const l = model.load;
  const loadLines: string[] = [
    ...l.pcs.map((p) => `PC ${p.size}" × ${p.qty}`),
    ...l.printers.map((p) => `Printer ${p.rating}W × ${p.qty}`),
    ...l.scanners.map((s) => `Scanner ${s.rating}W × ${s.qty}`),
  ];
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 3 }} className="avoid-break">
      <table className="section-frame" style={{ flex: 1.2 }}>
        <tbody>
          <SectionTitle colSpan={4}>SITE OBSERVATION</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "25%" }}>Mains L-N</td>
            <td style={{ ...tdBase, width: "25%" }}>{o.mainsLn} V</td>
            <td style={{ ...labelCell, width: "25%" }}>Mains N-E</td>
            <td style={tdBase}>{o.mainsNe} V</td>
          </tr>
          <tr>
            <td style={labelCell}>AC Provided</td>
            <td style={tdBase}>{l.ac}</td>
            <td style={labelCell}>DG Provided</td>
            <td style={tdBase}>{l.dg}</td>
          </tr>
          <tr>
            <td style={labelCell}>Env. Duty</td>
            <td style={tdBase}>{l.duty}</td>
            <td style={labelCell}>UPS Location</td>
            <td style={tdBase}>{l.location}</td>
          </tr>
        </tbody>
      </table>
      <table className="section-frame" style={{ flex: 1 }}>
        <tbody>
          <SectionTitle colSpan={2}>CONNECTED LOAD</SectionTitle>
          <tr>
            <td style={tdBase} colSpan={2}>
              {loadLines.length ? clampPrint(loadLines.join("   •   "), 480) : "None"}
            </td>
          </tr>
          <tr>
            <td style={{ ...labelCell, width: "40%" }}>Power Failures</td>
            <td style={tdBase}>
              {model.power.failures} nos / {model.power.durationMin} min
            </td>
          </tr>
          <tr>
            <td style={labelCell}>Load on DG</td>
            <td style={tdBase}>{model.power.loadDgPct} %</td>
          </tr>
        </tbody>
      </table>
      <table className="section-frame" style={{ flex: 0.9 }}>
        <tbody>
          <SectionTitle colSpan={2}>POWER CONDITION</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "46%" }}>DG Set</td>
            <td style={tdBase}>{model.power.dgSet}</td>
          </tr>
          <tr>
            <td style={labelCell}>DG Cap. (kVA)</td>
            <td style={tdBase}>{model.power.dgCapacity}</td>
          </tr>
          <tr>
            <td style={labelCell}>AMF Panel</td>
            <td style={tdBase}>{model.power.amf}</td>
          </tr>
          <tr>
            <td style={labelCell}>Non-Biz / Hol.</td>
            <td style={tdBase}>
              {model.power.nonBiz} / {model.power.holidays}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Battery readings as wide 8-column strips (header Batt N + value), so a
 * full 32-cell bank fits in 4 compact rows per grid. Charging and
 * discharging sit side by side with the bank spec.
 */
function BatterySection({ model }: { model: FsrPrintModel }) {
  const b = model.battery;
  const renderStrip = (title: string, grid: string[][]) => {
    const flat = (grid ?? []).flatMap((r) => r);
    if (flat.length === 0) {
      return (
        <div>
          <div style={{ fontSize: 7.4, fontWeight: 700, color: INK, marginBottom: 1 }}>{title}</div>
          <div style={{ ...tdBase, borderRadius: RADIUS }}>No readings recorded</div>
        </div>
      );
    }
    const chunks: string[][] = [];
    for (let i = 0; i < flat.length; i += 8) chunks.push(flat.slice(i, i + 8));
    return (
      <div>
        <div style={{ fontSize: 7.4, fontWeight: 700, color: INK, marginBottom: 1 }}>
          {title} <span style={{ fontWeight: 400, color: SUBTLE }}>— Volts (Vdc)</span>
        </div>
        {chunks.map((cells, ci) => (
          <table key={ci} className="section-frame avoid-break" style={{ marginTop: ci ? 1.5 : 0 }}>
            <tbody>
              <tr className="g-bg">
                {cells.map((_, j) => (
                  <th
                    key={j}
                    style={{ ...tdBase, color: "#fff", textAlign: "center", fontSize: 6.6 }}
                  >
                    B{ci * 8 + j + 1}
                  </th>
                ))}
              </tr>
              <tr>
                {cells.map((v, j) => (
                  <td
                    key={j}
                    style={{
                      ...tdBase,
                      textAlign: "center",
                      fontWeight: 700,
                      background: j % 2 ? GREEN_PALE : "#fff",
                    }}
                  >
                    {v}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        ))}
      </div>
    );
  };
  // Spec strip (unbreakable) + side-by-side grids whose chunk tables break
  // BETWEEN chunks — a 32+32 bank paginates cleanly instead of spilling.
  return (
    <div style={{ marginTop: 3 }}>
      <table className="section-frame avoid-break">
        <tbody>
          <SectionTitle colSpan={3}>BATTERY RECORD</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "16%" }}>Make / Ah / Qty</td>
            <td style={tdBase}>
              {b.make} / {b.ah} / {b.qty}
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
        <div style={{ flex: 1 }}>{renderStrip("CHARGING", b.chargingGrid)}</div>
        <div style={{ flex: 1 }}>{renderStrip("DISCHARGING", b.dischargingGrid)}</div>
      </div>
    </div>
  );
}

function PartsFeedback({ model }: { model: FsrPrintModel }) {
  const s = model.feedback.status;
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 3 }} className="avoid-break">
      <table className="section-frame" style={{ flex: 1.4 }}>
        <tbody>
          <tr className="g-bg">
            {["#", "Item Replaced", "Old Sr No", "New Sr No", "Qty", "Charges ₹"].map((h, i) => (
              <th
                key={h}
                style={{
                  ...tdBase,
                  color: "#fff",
                  fontWeight: 700,
                  textAlign: i === 1 ? "left" : "center",
                  fontSize: 7,
                  width: i === 0 ? "4%" : i === 1 ? "32%" : undefined,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
          <tr>
            <th
              colSpan={6}
              style={{ ...tdBase, fontWeight: 700, letterSpacing: 0.8, textAlign: "left" }}
            >
              PART REPLACEMENT
            </th>
          </tr>
          {model.parts.length === 0 ? (
            <tr>
              <td style={{ ...tdBase, textAlign: "center" }} colSpan={6}>
                No parts replaced
              </td>
            </tr>
          ) : (
            model.parts.map((p, i) => (
              <tr key={p.n} style={i % 2 ? { background: GREEN_PALE } : undefined}>
                <td style={{ ...tdBase, textAlign: "center" }}>{p.n}</td>
                <td style={{ ...tdBase, fontWeight: 700 }}>{clampPrint(p.item, 48)}</td>
                <td style={{ ...tdBase, textAlign: "center" }}>{clampPrint(p.oldSr, 24)}</td>
                <td style={{ ...tdBase, textAlign: "center" }}>{clampPrint(p.newSr, 24)}</td>
                <td style={{ ...tdBase, textAlign: "center" }}>{p.qty}</td>
                <td style={{ ...tdBase, textAlign: "right" }}>{p.charges}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <table className="section-frame" style={{ flex: 1 }}>
        <tbody>
          <SectionTitle colSpan={2}>FEEDBACK &amp; SIGN-OFF</SectionTitle>
          <tr>
            <td style={{ ...labelCell, width: "34%" }}>FSE Feedback</td>
            <td style={tdBase}>
              <BlankLine />
            </td>
          </tr>
          <tr>
            <td style={labelCell}>Customer Fdbk</td>
            <td style={tdBase}>
              <BlankLine />
            </td>
          </tr>
          <tr>
            <td style={labelCell}>Rating (1–10)</td>
            <td style={{ ...tdBase, fontWeight: 700, fontSize: 9 }}>
              {model.feedback.rating}
              <span style={{ fontWeight: 400, fontSize: 6.6, color: SUBTLE }}>
                {"  "}1 2 3 4 5 6 7 8 9 10
              </span>
            </td>
          </tr>
          <tr>
            <td style={labelCell}>Call Status</td>
            <td style={tdBase}>
              <span style={{ display: "inline-flex", gap: 8 }}>
                <Check checked={s === "Complete"} label="Complete" />
                <Check checked={s === "Incomplete"} label="Incomplete" />
                <Check checked={s === "Under Observation"} label="Under Obs." />
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
  const box: CSSProperties = {
    flex: 1,
    border: `0.7px solid ${FRAME}`,
    borderRadius: RADIUS,
    padding: "3px 6px",
  };
  const head: CSSProperties = {
    fontSize: 7.6,
    fontWeight: 700,
    letterSpacing: 0.8,
    color: GREEN,
  };
  const cap: CSSProperties = { fontSize: 6.4, fontWeight: 700, color: SUBTLE };
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 3 }} className="avoid-break">
      <div style={box}>
        <div style={head}>CUSTOMER</div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <div style={cap}>Signature</div>
            {signatureDataUrl ? (
              <img
                src={signatureDataUrl}
                alt="Customer signature"
                crossOrigin="anonymous"
                style={{ maxHeight: 44, maxWidth: "100%", objectFit: "contain" }}
              />
            ) : (
              <BlankLine />
            )}
          </div>
          <div style={{ flex: 1, fontSize: 7.4, color: INK }}>
            <b>Name:</b> {clampPrint(sig.customerName, 60)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={cap}>Office Seal</div>
            <BlankLine />
          </div>
          <div style={{ flex: 0.7 }}>
            <div style={cap}>Date</div>
            <BlankLine />
          </div>
        </div>
      </div>
      <div style={box}>
        <div style={head}>FIELD SERVICE ENGINEER</div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <div style={{ flex: 1, fontSize: 7.4, color: INK }}>
            <b>Name:</b> {clampPrint(sig.fseName, 60)}
            <br />
            <b>No:</b> {sig.fsePhone}
          </div>
          <div style={{ flex: 1 }}>
            <div style={cap}>FSE Signature</div>
            <BlankLine />
          </div>
          <div style={{ flex: 0.7 }}>
            <div style={cap}>Date</div>
            <BlankLine />
          </div>
        </div>
      </div>
    </div>
  );
}

function FooterStrip({ oem }: { oem: FsrOemLogo }) {
  const logo = oem ?? { url: apcLogo.url, alt: "APC" };
  return (
    <div className="avoid-break" style={{ marginTop: 3 }}>
      <GreenRule />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingTop: 2,
        }}
      >
        <img
          src={logo.url}
          alt={logo.alt}
          crossOrigin="anonymous"
          style={{ height: 16, objectFit: "contain" }}
        />
        <div style={{ flex: 1, textAlign: "center", fontSize: 8, fontWeight: 700, color: INK }}>
          Power Backup Solutions
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>UPS
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>Batteries
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>AMC
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>Services
        </div>
        <div
          className="g-bg"
          style={{
            fontSize: 8.4,
            fontStyle: "italic",
            fontWeight: 700,
            padding: "2px 12px",
            borderRadius: 2,
          }}
        >
          Life Is On
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root — everything on ONE landscape sheet
// ---------------------------------------------------------------------------

export function FsrPrintView({ model, company, oem, signatureDataUrl }: FsrPrintViewProps) {
  return (
    <div className="defective-tag-page">
      <div className="fsr-print" style={sheetStyle}>
        <style>{STYLE_BLOCK}</style>
        <Header model={model} company={company} oem={oem} />
        <CustomerCall model={model} />
        <ProblemStrip model={model} />
        <ObservationLoad model={model} />
        <BatterySection model={model} />
        <PartsFeedback model={model} />
        <Signatures model={model} signatureDataUrl={signatureDataUrl} />
        <FooterStrip oem={oem} />
      </div>
    </div>
  );
}
