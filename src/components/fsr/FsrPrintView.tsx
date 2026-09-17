/**
 * FsrPrintView — single-page A4 PORTRAIT Field Service Report.
 *
 * Premium corporate service report + engineering document (NOT a dashboard).
 * One `.defective-tag-page` wrapper = one printed/PDF page (see
 * printMultiPageElement / saveMultiPageElementAsPdf in src/lib/docPdf.ts —
 * both are called WITHOUT the landscape opt-in from FsrPrintButton, so the
 * frame renders A4 portrait).
 * 200mm sheet (matches the portrait pipeline content box exactly so the PDF
 * fit never double-scales: a wider sheet would raster-shrink to ~70%), NO
 * inline min-height (an inline min-height overrides the print-stylesheet rule
 * and breaks one-page fit).
 * Two-column grid: portrait panels are ~99mm — wider than the old 92mm
 * landscape 3-col cells — so text runs at 8/9px labels/values and still fits
 * the 287mm one-page height budget.
 * Pure presentational — every value comes from `model` (built via
 * buildFsrPrintModel); sparse data already degrades to "—" in the model
 * layer, so this view never throws.
 */
import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";
import type { CompanyProfile } from "@/lib/companyProfile";
import type { FsrPrintModel } from "@/lib/fsrPrint";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import apcLogo from "@/assets/oem-apc.png.asset.json";

export type FsrOemLogo = { url: string; alt: string } | null;

export type FsrPrintViewProps = {
  model: FsrPrintModel;
  company: CompanyProfile;
  oem: FsrOemLogo;
  /** Customer signature as a data URL (or null → clean empty zone). */
  signatureDataUrl: string | null;
};

// ---------------------------------------------------------------------------
// Design tokens — three border levels, restrained greens, Arial, tabular nums
// ---------------------------------------------------------------------------

const GREEN = "#0E7C3A"; // PRIMARY — sheet frame, bands, sign-off frames, footer rule
const GREEN_BRIGHT = "#3DCD58"; // title side-rules accent
const GREEN_TINT = "#E9F5EE"; // label cells, battery subheaders
const GREEN_PALE = "#F2F9F4"; // subtle zebra wash
const INK = "#14201A"; // value text
const SUBTLE = "#4A5A51"; // labels, secondary text
const HAIR = "#D5DED8"; // SECONDARY — internal row separators only (0.5px)
const FRAME = "#0E7C3A";

/** Spacing scale — every margin/gap in this sheet comes from here. zone is
 *  tight (2px) by design: the 287mm one-page budget leaves no room for airy
 *  section gaps. */
const GAP = { zone: 2, panel: 2, inner: 1.5, micro: 1 } as const;

const FONT = "Arial, Helvetica, sans-serif";
const NUM = { fontVariantNumeric: "tabular-nums" } as const;

/** 8px bold uppercase muted label. */
const labelStyle: CSSProperties = {
  fontSize: 8,
  fontWeight: 700,
  color: SUBTLE,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  background: GREEN_TINT,
  padding: "3px 6px",
  borderBottom: `0.5px solid ${HAIR}`,
  whiteSpace: "nowrap",
  verticalAlign: "top",
  lineHeight: 1.25,
};

/** 9px ink value. */
const valueStyle: CSSProperties = {
  fontSize: 9,
  color: INK,
  padding: "3px 6px",
  borderBottom: `0.5px solid ${HAIR}`,
  verticalAlign: "top",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.25,
};

const sheetStyle: CSSProperties = {
  width: "200mm",
  margin: "0 auto",
  background: "#ffffff",
  color: INK,
  fontFamily: FONT,
  border: `1px solid ${FRAME}`,
  borderRadius: 2,
  padding: "3mm 4mm",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const STYLE_BLOCK = `
  .fsr-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .fsr-print table { border-collapse: collapse; }

  .fsr-print .panel {
    border: 0.7px solid ${FRAME} !important;
    border-radius: 2px;
    overflow: hidden;
  }

  /* Green section bands */
  .fsr-print .g-bg {
    background: ${GREEN} !important;
    color: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .fsr-print tr, .fsr-print .avoid-break { page-break-inside: avoid; break-inside: avoid; }

  @media print {
    @page { size: A4 portrait; margin: 5mm; }
    .fsr-print { width: 200mm; margin: 0 auto !important; min-height: 0; }
  }
`;

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** Green band section header (9.5px bold white). */
function Band({ children }: { children: ReactNode }) {
  return (
    <tr className="g-bg">
      <th
        colSpan={99}
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          color: "#fff",
          textAlign: "left",
          letterSpacing: 0.8,
          padding: "2.5px 8px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {children}
      </th>
    </tr>
  );
}

/** Label/value pair row — bottom hairline only, no border between the cells. */
function Pair({
  label,
  children,
  labelWidth = 92,
}: {
  label: string;
  children: ReactNode;
  labelWidth?: number;
}) {
  return (
    <tr>
      <td style={{ ...labelStyle, width: labelWidth }}>{label}</td>
      <td style={valueStyle}>{children}</td>
    </tr>
  );
}

/**
 * Slack absorber for stretched equal-height panels: the flex row stretches
 * every panel (align-items: stretch, cross-size auto), and this row — the
 * only one with height 100% — soaks up the surplus so all panel bottoms
 * land on the same y as the tallest sibling. Inert (~0px) when unneeded.
 */
function Filler() {
  return (
    <tr style={{ height: "100%" }}>
      <td colSpan={99} style={{ padding: 0, borderBottom: "none" }} />
    </tr>
  );
}

/** Writable hairline (seal / date / FSE-signature rows). */
function BlankLine({ width = "100%" }: { width?: string }) {
  return <div style={{ borderBottom: `0.5px solid ${HAIR}`, height: 11, width }} />;
}

/** Bright-green hairline rule. Grows to fill flex rows when asked. */
function GreenRule({ grow = false }: { grow?: boolean }) {
  return (
    <div
      style={{
        height: 1.5,
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

/** String-only clamp (keeps the string type for FeedbackValue and friends).
 *  Print is a summary surface: engineer/customer remarks can run to 1000
 *  chars, which alone would blow the one-page budget — the full text lives
 *  in the app. */
function clampText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** "—" renders as a clean muted dash, never an underline. */
function FeedbackValue({ value }: { value: string }) {
  return (
    <span style={{ color: value === "—" ? SUBTLE : INK, fontVariantNumeric: "tabular-nums" }}>
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// A) HEADER — logos + company + title band + metadata strip
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
  // The partner caption belongs to real OEM branding — never show it under
  // the APC fallback logo (which is just the default, not a partnership).
  const showPartnerCaption = oem != null && oem.alt.toUpperCase() !== "APC";
  const phones = (company.phone || "")
    .split(/[/|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("  |  ");
  const status = model.feedback.status;
  const statusText =
    status === "Complete"
      ? "✓ Complete"
      : status === "Under Observation"
        ? "◐ Under Obs."
        : "! Incomplete";
  const metas: { label: string; value: ReactNode }[] = [
    { label: "Service Report No.", value: model.header.formalReportNo },
    {
      label: "Date",
      value: model.header.submittedAt === "—" ? "—" : fmtDate(model.header.submittedAt),
    },
    { label: "Case ID", value: model.header.caseId },
    // Raw ticket.call_type ("Warranty"/"AMC"/"PM Call") — NOT the PM/Installation
    // derivation, which is blank for Warranty/AMC and used to print "—" here.
    { label: "Call Type", value: model.product.callType },
    { label: "Call Status", value: statusText },
  ];
  return (
    <div className="avoid-break">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <img
          src={prokonLogo.url}
          alt="Prokon Hi-Tech Systems"
          crossOrigin="anonymous"
          style={{ height: 28, objectFit: "contain", flex: "0 0 auto" }}
        />
        <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.3, color: INK }}>
            {company.name.toUpperCase()}
          </div>
          <div
            style={{
              fontSize: 7.5,
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
            style={{ height: 26, objectFit: "contain" }}
          />
          {showPartnerCaption ? (
            <div style={{ fontSize: 7, fontWeight: 700, color: GREEN, letterSpacing: 0.6 }}>
              AUTHORIZED SALES PARTNER
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: GAP.inner }}>
        <GreenRule grow />
        <div
          style={{
            color: GREEN,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 2,
            whiteSpace: "nowrap",
          }}
        >
          FIELD SERVICE REPORT
        </div>
        <GreenRule grow />
      </div>
      <div
        style={{
          display: "flex",
          marginTop: GAP.inner,
          borderTop: `0.5px solid ${HAIR}`,
          borderBottom: `0.5px solid ${HAIR}`,
        }}
      >
        {metas.map((m, i) => (
          <div
            key={m.label}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "3px 8px",
              ...(i ? { borderLeft: `0.5px solid ${HAIR}` } : null),
            }}
          >
            <div
              style={{
                fontSize: 7.5,
                fontWeight: 700,
                color: SUBTLE,
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              {m.label}
            </div>
            <div style={{ fontSize: 8.5, fontWeight: 600, color: INK, ...NUM }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C) CUSTOMER + PRODUCT ROW — two panels; the old lifecycle one-liner is gone
// (Preferred Visit already lives in VISIT TIMING; created/closed stay in the
// model for the app, not the paper).
// ---------------------------------------------------------------------------

function CustomerProductRow({ model }: { model: FsrPrintModel }) {
  const c = model.customer;
  const p = model.product;
  const panel: CSSProperties = { flex: 1, minWidth: 0 };
  return (
    <div
      style={{ display: "flex", gap: GAP.panel, alignItems: "stretch", marginTop: GAP.zone }}
      className="avoid-break"
    >
      <table className="panel" style={panel}>
        <tbody>
          <Band>CUSTOMER</Band>
          <Pair label="Name" labelWidth={88}>
            {clampPrint(c.name, 80)}
          </Pair>
          <Pair label="Address" labelWidth={88}>
            {c.addressLines.length ? clampPrint(c.addressLines.join(", "), 320) : "—"}
          </Pair>
          <Pair label="Phone • Email" labelWidth={88}>
            {[c.phones.join(" | "), c.email].filter((v) => v && v !== "—").join("  •  ") || "—"}
          </Pair>
          <Pair label="GSTIN" labelWidth={88}>
            {c.gstin}
          </Pair>
          <Filler />
        </tbody>
      </table>
      <table className="panel" style={panel}>
        <tbody>
          <Band>PRODUCT &amp; CALL</Band>
          <Pair label="Model" labelWidth={80}>
            {p.model}
          </Pair>
          <Pair label="UPS Sr No." labelWidth={80}>
            {p.upsSerial}
          </Pair>
          <Pair label="Call Type" labelWidth={80}>
            {p.callType}
          </Pair>
          <Pair label="OEM Call" labelWidth={80}>
            {p.oemCall}
          </Pair>
          <Filler />
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// D) PROBLEM / REASON — two full-width rows with a breathing gap
// ---------------------------------------------------------------------------

function ProblemReason({ model }: { model: FsrPrintModel }) {
  const row = (label: string, value: ReactNode) => (
    <table className="panel avoid-break" style={{ width: "100%" }}>
      <tbody>
        <tr>
          <td
            style={{
              ...labelStyle,
              width: "14%",
              borderBottom: "none",
              padding: "4px 6px",
            }}
          >
            {label}
          </td>
          <td style={{ fontSize: 9, color: INK, padding: "4px 6px", ...NUM }}>{value}</td>
        </tr>
      </tbody>
    </table>
  );
  return (
    <div style={{ marginTop: GAP.zone }} className="avoid-break">
      {row("Problem Reported", clampPrint(model.problem.reported, 400))}
      <div style={{ height: GAP.panel }} />
      {row("Reason for Visit", clampPrint(model.problem.reason, 400))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// E) VISIT + SITE ROW — visit timing / site observation
// ---------------------------------------------------------------------------

function VisitSiteRow({ model }: { model: FsrPrintModel }) {
  const o = model.observation;
  const t = model.timing;
  const l = model.load;
  const panel: CSSProperties = { flex: 1, minWidth: 0 };
  return (
    <div
      style={{ display: "flex", gap: GAP.panel, alignItems: "stretch", marginTop: GAP.zone }}
      className="avoid-break"
    >
      <table className="panel" style={panel}>
        <tbody>
          <Band>VISIT TIMING</Band>
          <Pair label="Arrival" labelWidth={88}>
            {t.arrivalDate} {t.arrivalTime}
          </Pair>
          <Pair label="Departure" labelWidth={88}>
            {t.departureDate} {t.departureTime}
          </Pair>
          <Pair label="On-site Time" labelWidth={88}>
            {t.onSite}
          </Pair>
          <Pair label="Preferred Visit" labelWidth={88}>
            {t.preferredVisit}
          </Pair>
          <Filler />
        </tbody>
      </table>
      <table className="panel" style={panel}>
        <tbody>
          <Band>SITE OBSERVATION</Band>
          <Pair label="Mains L-N" labelWidth={80}>
            <span style={{ textAlign: "center" }}>{o.mainsLn} V</span>
          </Pair>
          <Pair label="Mains N-E" labelWidth={80}>
            <span style={{ textAlign: "center" }}>{o.mainsNe} V</span>
          </Pair>
          <Pair label="AC Provided" labelWidth={80}>
            {l.ac}
          </Pair>
          <Pair label="DG Provided" labelWidth={80}>
            {l.dg}
          </Pair>
          <Pair label="Env. Duty" labelWidth={80}>
            {l.duty}
          </Pair>
          <Pair label="UPS Location" labelWidth={80}>
            {l.location}
          </Pair>
          <Filler />
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// F) LOAD + POWER ROW — connected load / power condition
// ---------------------------------------------------------------------------

function LoadPowerRow({ model }: { model: FsrPrintModel }) {
  const l = model.load;
  const panel: CSSProperties = { flex: 1, minWidth: 0 };
  return (
    <div
      style={{ display: "flex", gap: GAP.panel, alignItems: "stretch", marginTop: GAP.zone }}
      className="avoid-break"
    >
      <table className="panel" style={panel}>
        <tbody>
          <Band>CONNECTED LOAD</Band>
          {l.pcs.length ? (
            <Pair label="PC" labelWidth={88}>
              {clampPrint(l.pcs.map((p) => `${p.size}" × ${p.qty}`).join("   |   "), 480)}
            </Pair>
          ) : null}
          {l.printers.map((p, i) => (
            <Pair key={`pr-${i}`} label={i === 0 ? "Printer" : ""} labelWidth={88}>
              {p.rating}W × {p.qty}
            </Pair>
          ))}
          {l.scanners.map((s, i) => (
            <Pair key={`sc-${i}`} label={i === 0 ? "Scanner" : ""} labelWidth={88}>
              {s.rating}W × {s.qty}
            </Pair>
          ))}
          {!l.pcs.length && !l.printers.length && !l.scanners.length ? (
            <Pair label="Load" labelWidth={88}>
              None
            </Pair>
          ) : null}
          <Pair label="Power Failures" labelWidth={88}>
            {model.power.failures} nos / {model.power.durationMin} min
          </Pair>
          <Pair label="Load on DG" labelWidth={88}>
            {model.power.loadDgPct} %
          </Pair>
          <Filler />
        </tbody>
      </table>
      <table className="panel" style={panel}>
        <tbody>
          <Band>POWER CONDITION</Band>
          <Pair label="DG Set" labelWidth={88}>
            {model.power.dgSet}
          </Pair>
          <Pair label="DG Cap. (kVA)" labelWidth={88}>
            {model.power.dgCapacity}
          </Pair>
          <Pair label="AMF Panel" labelWidth={88}>
            {model.power.amf}
          </Pair>
          <Pair label="Non-Biz / Hol." labelWidth={88}>
            {model.power.nonBiz} / {model.power.holidays}
          </Pair>
          <Filler />
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// F) BATTERY PANEL — spec row + twin full-width 8-per-row measurement grids
// ---------------------------------------------------------------------------

function BatterySection({ model }: { model: FsrPrintModel }) {
  const b = model.battery;
  const renderStrip = (title: string, grid: string[][]) => {
    const flat = (grid ?? []).flatMap((r) => r);
    if (flat.length === 0) {
      return (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 8,
              fontWeight: 600,
              color: INK,
              background: GREEN_TINT,
              padding: "2.5px 8px",
              borderBottom: `0.7px solid ${GREEN}`,
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 8.5, color: SUBTLE, padding: "4px 8px" }}>
            No readings recorded
          </div>
        </div>
      );
    }
    // Rows of 8; 16 cells (the form cap) = label/value/label/value. Zebra on
    // alternate VALUE rows; numbering runs continuously (B1..B16).
    const rows: string[][] = [];
    for (let i = 0; i < flat.length; i += 8) rows.push(flat.slice(i, i + 8));
    const cellBase: CSSProperties = {
      width: "12.5%",
      textAlign: "center",
      padding: "0.5px 2px",
      fontVariantNumeric: "tabular-nums",
    };
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 8,
            fontWeight: 600,
            color: INK,
            background: GREEN_TINT,
            padding: "2.5px 8px",
            borderBottom: `0.7px solid ${GREEN}`,
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        >
          {title}
        </div>
        <table className="avoid-break" style={{ width: "100%", tableLayout: "fixed" }}>
          <tbody>
            {rows.map((cells, ri) => (
              <Fragment key={ri}>
                <tr>
                  {cells.map((_, j) => (
                    <th
                      key={j}
                      style={{
                        ...cellBase,
                        fontSize: 7.5,
                        fontWeight: 400,
                        color: SUBTLE,
                        borderBottom: `0.5px solid ${HAIR}`,
                        ...(j ? { borderLeft: `0.5px solid ${HAIR}` } : null),
                      }}
                    >
                      B{ri * 8 + j + 1}
                    </th>
                  ))}
                </tr>
                <tr style={ri % 2 ? { background: GREEN_PALE } : undefined}>
                  {cells.map((v, j) => (
                    <td
                      key={j}
                      style={{
                        ...cellBase,
                        fontSize: 8.5,
                        fontWeight: 700,
                        color: INK,
                        lineHeight: 1.15,
                        borderBottom: `0.5px solid ${HAIR}`,
                        ...(j ? { borderLeft: `0.5px solid ${HAIR}` } : null),
                      }}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  };
  const specs = [
    { label: "Make", value: b.make },
    { label: "Voltage", value: b.voltage },
    { label: "Ah", value: b.ah },
    { label: "Qty", value: b.qty },
  ];
  return (
    <div style={{ marginTop: GAP.zone }}>
      <table className="panel avoid-break" style={{ width: "100%" }}>
        <tbody>
          <Band>BATTERY RECORD</Band>
          <tr>
            {specs.map((s, i) => (
              <td
                key={s.label}
                style={{
                  width: "25%",
                  textAlign: "center",
                  padding: "2px 4px",
                  ...(i ? { borderLeft: `0.5px solid ${HAIR}` } : null),
                }}
              >
                <div
                  style={{
                    fontSize: 7.5,
                    fontWeight: 700,
                    color: SUBTLE,
                    textTransform: "uppercase",
                    letterSpacing: 0.3,
                  }}
                >
                  {s.label}
                </div>
                <div style={{ fontSize: 8.5, fontWeight: 700, color: INK, ...NUM }}>{s.value}</div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {/* Portrait: the two voltage strips stack full-width (≈24mm cells)
          instead of squeezing side-by-side (≈12mm cells). */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: GAP.inner,
          marginTop: GAP.inner,
        }}
      >
        {renderStrip("CHARGING VOLTAGE", b.chargingGrid)}
        {renderStrip("DISCHARGING VOLTAGE", b.dischargingGrid)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// G) PARTS TABLE — full-width: six columns need the room in portrait
// ---------------------------------------------------------------------------

function PartsTable({ model }: { model: FsrPrintModel }) {
  return (
    <div style={{ marginTop: GAP.zone }} className="avoid-break">
      <table className="panel" style={{ width: "100%", tableLayout: "fixed" }}>
        {/* Column widths MUST live here: with table-layout:fixed the first row
            (the colspan-99 Band) defines the columns, so per-cell widths on the
            header row are ignored and every column collapses to ~1%. */}
        <colgroup>
          <col style={{ width: "4%" }} />
          <col style={{ width: "34%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "14%" }} />
        </colgroup>
        <tbody>
          <Band>PART REPLACEMENT</Band>
          <tr>
            {[
              ["#", "4%"],
              ["Item Replaced", "34%"],
              ["Old Sr No", "20%"],
              ["New Sr No", "20%"],
              ["Qty", "8%"],
              ["Charges ₹", "14%"],
            ].map(([h, w], i) => (
              <th
                key={h}
                style={{
                  fontSize: 8,
                  fontWeight: 600,
                  color: SUBTLE,
                  textAlign: i === 1 ? "left" : i === 4 || i === 5 ? "right" : "center",
                  padding: "2px 4px",
                  borderBottom: `0.5px solid ${HAIR}`,
                  width: w,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
          {model.parts.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                style={{ fontSize: 8.5, color: SUBTLE, textAlign: "center", padding: "3px 4px" }}
              >
                No parts replaced
              </td>
            </tr>
          ) : (
            model.parts.map((p, i) => (
              <tr key={p.n} style={i % 2 ? { background: GREEN_PALE } : undefined}>
                <td
                  style={{
                    fontSize: 8.5,
                    color: INK,
                    textAlign: "center",
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p.n}
                </td>
                <td
                  style={{
                    fontSize: 8.5,
                    fontWeight: 700,
                    color: INK,
                    textAlign: "left",
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                  }}
                >
                  {clampPrint(p.item, 48)}
                </td>
                <td
                  style={{
                    fontSize: 8.5,
                    color: INK,
                    textAlign: "center",
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                  }}
                >
                  {clampPrint(p.oldSr, 24)}
                </td>
                <td
                  style={{
                    fontSize: 8.5,
                    color: INK,
                    textAlign: "center",
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                  }}
                >
                  {clampPrint(p.newSr, 24)}
                </td>
                <td
                  style={{
                    fontSize: 8.5,
                    color: INK,
                    textAlign: "right",
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p.qty}
                </td>
                <td
                  style={{
                    fontSize: 8.5,
                    color: INK,
                    textAlign: "right",
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p.charges}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// H) FEEDBACK STRIP — full-width; remarks clamp at 280 chars (print is a
// summary surface — the full 1000-char text lives in the app)
// ---------------------------------------------------------------------------

function FeedbackStrip({ model }: { model: FsrPrintModel }) {
  const s = model.feedback.status;
  const statusItems: { label: string; on: boolean }[] = [
    { label: "Complete", on: s === "Complete" },
    { label: "Under Obs.", on: s === "Under Observation" },
    { label: "Incomplete", on: s === "Incomplete" },
  ];
  return (
    <div style={{ marginTop: GAP.zone }} className="avoid-break">
      <table className="panel" style={{ width: "100%" }}>
        <tbody>
          <Band>FEEDBACK &amp; SIGN-OFF</Band>
          <Pair label="FSE Feedback" labelWidth={88}>
            <FeedbackValue value={clampText(model.feedback.fseFeedback, 280)} />
          </Pair>
          <Pair label="Customer Fdbk" labelWidth={88}>
            <FeedbackValue value={clampText(model.feedback.customerFeedback, 280)} />
          </Pair>
          <Pair label="Rating" labelWidth={88}>
            <span style={{ fontWeight: 700, fontSize: 9 }}>{model.feedback.rating} / 10</span>
          </Pair>
          <Pair label="FSR Status" labelWidth={88}>
            <span style={{ display: "inline-flex", gap: 10, fontSize: 8, ...NUM }}>
              {statusItems.map((it) => (
                <span key={it.label}>
                  {it.on ? "☑" : "☐"} {it.label}
                </span>
              ))}
            </span>
          </Pair>
          <Pair label="FSR Verdict" labelWidth={88}>
            <FeedbackValue value={model.feedback.verdict} />
          </Pair>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// H) SIGN-OFF — two identical primary-framed panels, stretched equal
// ---------------------------------------------------------------------------

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
    minWidth: 0,
    border: `1px solid ${FRAME}`,
    borderRadius: 2,
    padding: 5,
  };
  const head: CSSProperties = {
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: 0.8,
    color: GREEN,
  };
  const cap: CSSProperties = { fontSize: 7, fontWeight: 700, color: SUBTLE };
  return (
    <div
      style={{ display: "flex", gap: GAP.panel, alignItems: "stretch", marginTop: GAP.zone }}
      className="avoid-break"
    >
      <div style={box}>
        <div style={head}>CUSTOMER</div>
        <div style={{ display: "flex", gap: 6, marginTop: GAP.inner }}>
          <div style={{ flex: 1.4, minWidth: 0 }}>
            <div
              style={{
                minHeight: 34,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ ...cap, alignSelf: "stretch", textAlign: "left" }}>Signature</div>
              {signatureDataUrl ? (
                <img
                  src={signatureDataUrl}
                  alt="Customer signature"
                  crossOrigin="anonymous"
                  style={{ maxHeight: 28, maxWidth: "100%", objectFit: "contain" }}
                />
              ) : null}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 9, color: INK, ...NUM }}>
            <b>Name:</b> {clampPrint(sig.customerName, 60)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: GAP.inner }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={cap}>Office Seal</div>
            <BlankLine />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={cap}>Date</div>
            <BlankLine />
          </div>
        </div>
      </div>
      <div style={box}>
        <div style={head}>FIELD SERVICE ENGINEER</div>
        <div style={{ display: "flex", gap: 6, marginTop: GAP.inner }}>
          <div style={{ flex: 1.4, minWidth: 0 }}>
            <div
              style={{
                minHeight: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Blank area by design — the FSE signature path has no source yet. */}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 9, color: INK, ...NUM }}>
            <b>Name:</b> {clampPrint(sig.fseName, 60)}
            <br />
            <b>No:</b> {sig.fsePhone}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: GAP.inner }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={cap}>FSE Signature</div>
            <BlankLine />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={cap}>Date</div>
            <BlankLine />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// I) FOOTER — one restrained line
// ---------------------------------------------------------------------------

function FooterStrip({ oem }: { oem: FsrOemLogo }) {
  const logo = oem ?? { url: apcLogo.url, alt: "APC" };
  return (
    <div className="avoid-break" style={{ marginTop: GAP.zone }}>
      {/* Page x of y — reserved slot for future page numbering (do NOT render). */}
      <div style={{ height: 1.5, background: GREEN }} />
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
          style={{ height: 14, objectFit: "contain" }}
        />
        <div style={{ flex: 1, textAlign: "center", fontSize: 7.5, fontWeight: 700, color: INK }}>
          Power Backup Solutions
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>UPS
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>Batteries
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>AMC
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>Services
        </div>
        <div
          className="g-bg"
          style={{
            fontSize: 7.5,
            fontStyle: "italic",
            fontWeight: 700,
            padding: "1px 10px",
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
// Root — everything on ONE portrait sheet, in reading order
// ---------------------------------------------------------------------------

export function FsrPrintView({ model, company, oem, signatureDataUrl }: FsrPrintViewProps) {
  return (
    <div className="defective-tag-page">
      <div className="fsr-print" style={sheetStyle}>
        <style>{STYLE_BLOCK}</style>
        <Header model={model} company={company} oem={oem} />
        <CustomerProductRow model={model} />
        <ProblemReason model={model} />
        <VisitSiteRow model={model} />
        <LoadPowerRow model={model} />
        <BatterySection model={model} />
        <PartsTable model={model} />
        <FeedbackStrip model={model} />
        <Signatures model={model} signatureDataUrl={signatureDataUrl} />
        <FooterStrip oem={oem} />
      </div>
    </div>
  );
}
