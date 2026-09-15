/**
 * FsrPrintView — single-page A4 LANDSCAPE Field Service Report.
 *
 * Premium corporate service report + engineering document (NOT a dashboard).
 * One `.defective-tag-page` wrapper = one printed/PDF page (see
 * printMultiPageElement / saveMultiPageElementAsPdf in src/lib/docPdf.ts —
 * both are called with `{ landscape: true }` from FsrPrintButton).
 * 287mm sheet (matches the pipeline content box exactly so the PDF fit never
 * double-scales), NO inline min-height (an inline min-height overrides the
 * print-stylesheet rule and breaks one-page fit).
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

const FONT = "Arial, Helvetica, sans-serif";
const NUM = { fontVariantNumeric: "tabular-nums" } as const;

/** 6.8px bold uppercase muted label. */
const labelStyle: CSSProperties = {
  fontSize: 6.8,
  fontWeight: 700,
  color: SUBTLE,
  textTransform: "uppercase",
  letterSpacing: 0.3,
  background: GREEN_TINT,
  padding: "2.5px 6px",
  borderBottom: `0.5px solid ${HAIR}`,
  whiteSpace: "nowrap",
  verticalAlign: "top",
  lineHeight: 1.2,
};

/** 7.6px ink value. */
const valueStyle: CSSProperties = {
  fontSize: 7.6,
  color: INK,
  padding: "2.5px 6px",
  borderBottom: `0.5px solid ${HAIR}`,
  verticalAlign: "top",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.2,
};

const sheetStyle: CSSProperties = {
  width: "287mm",
  margin: "0 auto",
  background: "#ffffff",
  color: INK,
  fontFamily: FONT,
  border: `1px solid ${FRAME}`,
  borderRadius: 2,
  padding: "2mm 3mm",
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
    @page { size: A4 landscape; margin: 5mm; }
    .fsr-print { width: 287mm; margin: 0 auto !important; min-height: 0; }
  }
`;

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** Green band section header (8.5px bold white). */
function Band({ children }: { children: ReactNode }) {
  return (
    <tr className="g-bg">
      <th
        colSpan={99}
        style={{
          fontSize: 8.5,
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

/** "—" renders as a clean muted dash, never an underline. */
function FeedbackValue({ value }: { value: string }) {
  return (
    <span style={{ color: value === "—" ? SUBTLE : INK, fontVariantNumeric: "tabular-nums" }}>
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// A) HEADER — logos + company + title band + borderless metadata strip
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
  const status = model.feedback.status;
  const statusText =
    status === "Complete" ? "✓ Complete" : status === "Under Observation" ? "◐ Under Obs." : "! Incomplete";
  const metas: { label: string; value: ReactNode }[] = [
    { label: "Service Report No.", value: model.header.formalReportNo },
    {
      label: "Date",
      value: model.header.submittedAt === "—" ? "—" : fmtDate(model.header.submittedAt),
    },
    { label: "Case ID", value: model.header.caseId },
    { label: "Call Type", value: model.product.typeOfCall || "—" },
    { label: "Call Status", value: statusText },
  ];
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
              fontSize: 6.8,
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
          <div style={{ fontSize: 6.5, fontWeight: 700, color: GREEN, letterSpacing: 0.6 }}>
            AUTHORIZED SALES PARTNER
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
        <GreenRule grow />
        <div
          style={{
            color: GREEN,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 2,
            whiteSpace: "nowrap",
          }}
        >
          FIELD SERVICE REPORT
        </div>
        <GreenRule grow />
      </div>
      <div style={{ display: "flex", marginTop: 2 }}>
        {metas.map((m, i) => (
          <div
            key={m.label}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "2px 10px",
              ...(i ? { borderLeft: `0.5px solid ${HAIR}` } : null),
            }}
          >
            <div
              style={{
                fontSize: 6.8,
                fontWeight: 700,
                color: SUBTLE,
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              {m.label}
            </div>
            <div style={{ fontSize: 8, fontWeight: 600, color: INK, ...NUM }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B) LIFECYCLE ROW — subtle one-liner, no bands, no borders
// ---------------------------------------------------------------------------

function LifecycleRow({ model }: { model: FsrPrintModel }) {
  const l = model.lifecycle;
  return (
    <div
      className="avoid-break"
      style={{ marginTop: 2.5, fontSize: 6.8, color: SUBTLE, ...NUM }}
    >
      {`Ticket Created ${l.createdAt}  ·  Preferred Visit ${l.preferredVisit}  ·  Ticket Closed ${l.closedAt}`}
    </div>
  );
}

// ---------------------------------------------------------------------------
// C) THREE-COLUMN BLOCK — customer / product & call / visit timing
// ---------------------------------------------------------------------------

function ThreeColumnBlock({ model }: { model: FsrPrintModel }) {
  const c = model.customer;
  const p = model.product;
  const t = model.timing;
  const panel: CSSProperties = { flex: 1, minWidth: 0 };
  return (
    <div style={{ display: "flex", gap: 2, marginTop: 2.5 }} className="avoid-break">
      <table className="panel" style={panel}>
        <tbody>
          <Band>CUSTOMER</Band>
          <Pair label="Name">{clampPrint(c.name, 80)}</Pair>
          <Pair label="Address">{c.addressLines.length ? clampPrint(c.addressLines.join(", "), 180) : "—"}</Pair>
          <Pair label="Phone • Email">
            {[c.phones.join(" | "), c.email].filter((v) => v && v !== "—").join("  •  ") || "—"}
          </Pair>
          <Pair label="GSTIN">{c.gstin}</Pair>
        </tbody>
      </table>
      <table className="panel" style={panel}>
        <tbody>
          <Band>PRODUCT &amp; CALL</Band>
          <Pair label="Model">{p.model}</Pair>
          <Pair label="UPS Sr No.">{p.upsSerial}</Pair>
          <Pair label="Call Type">{p.typeOfCall || "—"}</Pair>
          <Pair label="OEM Call">{p.oemCall}</Pair>
        </tbody>
      </table>
      <table className="panel" style={panel}>
        <tbody>
          <Band>VISIT TIMING</Band>
          <Pair label="Arrival">
            {t.arrivalDate} {t.arrivalTime}
          </Pair>
          <Pair label="Departure">
            {t.departureDate} {t.departureTime}
          </Pair>
          <Pair label="On-site Time">{t.onSite}</Pair>
          <Pair label="Preferred Visit">{t.preferredVisit}</Pair>
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
              padding: "3px 6px",
            }}
          >
            {label}
          </td>
          <td style={{ fontSize: 7.6, color: INK, padding: "3px 6px", ...NUM }}>
            {value}
          </td>
        </tr>
      </tbody>
    </table>
  );
  return (
    <div style={{ marginTop: 2.5 }} className="avoid-break">
      {row("Problem Reported", clampPrint(model.problem.reported, 180))}
      <div style={{ height: 5 }} />
      {row("Reason for Visit", clampPrint(model.problem.reason, 180))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// E) ENGINEERING ROW — site observation / connected load / power condition
// ---------------------------------------------------------------------------

function EngineeringRow({ model }: { model: FsrPrintModel }) {
  const o = model.observation;
  const l = model.load;
  const panel: CSSProperties = { flex: 1, minWidth: 0 };
  return (
    <div style={{ display: "flex", gap: 2, marginTop: 2.5 }} className="avoid-break">
      <table className="panel" style={panel}>
        <tbody>
          <Band>SITE OBSERVATION</Band>
          <Pair label="Mains L-N" labelWidth={70}>
            <span style={{ textAlign: "center" }}>{o.mainsLn} V</span>
          </Pair>
          <Pair label="Mains N-E" labelWidth={70}>
            <span style={{ textAlign: "center" }}>{o.mainsNe} V</span>
          </Pair>
          <Pair label="AC Provided" labelWidth={70}>{l.ac}</Pair>
          <Pair label="DG Provided" labelWidth={70}>{l.dg}</Pair>
          <Pair label="Env. Duty" labelWidth={70}>{l.duty}</Pair>
          <Pair label="UPS Location" labelWidth={70}>{l.location}</Pair>
        </tbody>
      </table>
      <table className="panel" style={panel}>
        <tbody>
          <Band>CONNECTED LOAD</Band>
          {l.pcs.length ? (
            <Pair label="PC">
              {clampPrint(l.pcs.map((p) => `${p.size}" × ${p.qty}`).join("   |   "), 480)}
            </Pair>
          ) : null}
          {l.printers.map((p, i) => (
            <Pair key={`pr-${i}`} label={i === 0 ? "Printer" : ""}>
              {p.rating}W × {p.qty}
            </Pair>
          ))}
          {l.scanners.map((s, i) => (
            <Pair key={`sc-${i}`} label={i === 0 ? "Scanner" : ""}>
              {s.rating}W × {s.qty}
            </Pair>
          ))}
          {!l.pcs.length && !l.printers.length && !l.scanners.length ? (
            <Pair label="Load">None</Pair>
          ) : null}
          <Pair label="Power Failures">
            {model.power.failures} nos / {model.power.durationMin} min
          </Pair>
          <Pair label="Load on DG">{model.power.loadDgPct} %</Pair>
        </tbody>
      </table>
      <table className="panel" style={panel}>
        <tbody>
          <Band>POWER CONDITION</Band>
          <Pair label="DG Set" labelWidth={70}>{model.power.dgSet}</Pair>
          <Pair label="DG Cap. (kVA)" labelWidth={70}>{model.power.dgCapacity}</Pair>
          <Pair label="AMF Panel" labelWidth={70}>{model.power.amf}</Pair>
          <Pair label="Non-Biz / Hol." labelWidth={70}>
            {model.power.nonBiz} / {model.power.holidays}
          </Pair>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// F) BATTERY PANEL — spec row + twin 8-column measurement grids, no boxes
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
              fontSize: 7,
              fontWeight: 600,
              color: INK,
              background: GREEN_TINT,
              padding: "1.5px 8px",
              borderBottom: `0.7px solid ${GREEN}`,
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 7.6, color: SUBTLE, padding: "4px 8px" }}>
            No readings recorded
          </div>
        </div>
      );
    }
    const chunks: string[][] = [];
    for (let i = 0; i < flat.length; i += 8) chunks.push(flat.slice(i, i + 8));
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 7,
            fontWeight: 600,
            color: INK,
            background: GREEN_TINT,
            padding: "1.5px 8px",
            borderBottom: `0.7px solid ${GREEN}`,
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          }}
        >
          {title}
        </div>
        {chunks.map((cells, ci) => (
          <table
            key={ci}
            className="avoid-break"
            style={{
              width: "auto",
              marginTop: ci ? 1 : 0,
              ...(ci % 2 ? { background: GREEN_PALE } : null),
            }}
          >
            <tbody>
              <tr>
                {cells.map((_, j) => (
                  <th
                    key={j}
                    style={{
                      fontSize: 6.6,
                      fontWeight: 400,
                      color: SUBTLE,
                      textAlign: "center",
                      width: 36,
                      padding: "0.5px 2px",
                    }}
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
                      fontSize: 7.2,
                      fontWeight: 700,
                      color: INK,
                      textAlign: "center",
                      width: 36,
                      padding: "0.5px 2px",
                      lineHeight: 1.15,
                      fontVariantNumeric: "tabular-nums",
                      ...(j ? { borderLeft: `0.5px solid ${HAIR}` } : null),
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
  return (
    <div style={{ marginTop: 2.5 }}>
      <table className="panel avoid-break" style={{ width: "100%" }}>
        <tbody>
          <Band>BATTERY RECORD</Band>
          <tr>
            <td
              style={{
                padding: "2.5px 8px",
                fontSize: 7.6,
                color: INK,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ fontSize: 6.8, fontWeight: 700, color: SUBTLE }}>MAKE </span>
              <b>{b.make}</b>
              <span style={{ color: SUBTLE }}>{"   ·   "}</span>
              <span style={{ fontSize: 6.8, fontWeight: 700, color: SUBTLE }}>VOLTAGE </span>
              <b>{b.voltage}</b>
              <span style={{ color: SUBTLE }}>{"   ·   "}</span>
              <span style={{ fontSize: 6.8, fontWeight: 700, color: SUBTLE }}>AH </span>
              <b>{b.ah}</b>
              <span style={{ color: SUBTLE }}>{"   ·   "}</span>
              <span style={{ fontSize: 6.8, fontWeight: 700, color: SUBTLE }}>QTY </span>
              <b>{b.qty}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 2, alignItems: "flex-start", marginTop: 1.5 }}>
        {renderStrip("CHARGING VOLTAGE", b.chargingGrid)}
        {renderStrip("DISCHARGING VOLTAGE", b.dischargingGrid)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// G) PARTS + FEEDBACK ROW
// ---------------------------------------------------------------------------

function PartsFeedback({ model }: { model: FsrPrintModel }) {
  const s = model.feedback.status;
  const statusItems: { mark: string; label: string; on: boolean }[] = [
    { mark: "✓", label: "Complete", on: s === "Complete" },
    { mark: "◐", label: "Under Obs.", on: s === "Under Observation" },
    { mark: "!", label: "Incomplete", on: s === "Incomplete" },
  ];
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "flex-start", marginTop: 2.5 }} className="avoid-break">
      <table className="panel" style={{ flex: 1.35, minWidth: 0 }}>
        <tbody>
          <Band>PART REPLACEMENT</Band>
          <tr>
            {["#", "Item Replaced", "Old Sr No", "New Sr No", "Qty", "Charges ₹"].map((h, i) => (
              <th
                key={h}
                style={{
                  fontSize: 7,
                  fontWeight: 600,
                  color: SUBTLE,
                  textAlign: i === 1 ? "left" : i === 4 || i === 5 ? "right" : "center",
                  padding: "1.5px 4px",
                  borderBottom: `0.5px solid ${HAIR}`,
                  width:
                    i === 0
                      ? 18
                      : i === 1
                        ? "40%"
                        : i === 2 || i === 3
                          ? 70
                          : i === 4
                            ? 30
                            : 56,
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
                style={{ fontSize: 7.4, color: SUBTLE, textAlign: "center", padding: "3px 4px" }}
              >
                No parts replaced
              </td>
            </tr>
          ) : (
            model.parts.map((p, i) => (
              <tr key={p.n} style={i % 2 ? { background: GREEN_PALE } : undefined}>
                <td
                  style={{
                    fontSize: 7.4,
                    color: INK,
                    textAlign: "center",
                    width: 18,
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p.n}
                </td>
                <td
                  style={{
                    fontSize: 7.4,
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
                    fontSize: 7.4,
                    color: INK,
                    textAlign: "center",
                    width: 70,
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                  }}
                >
                  {clampPrint(p.oldSr, 24)}
                </td>
                <td
                  style={{
                    fontSize: 7.4,
                    color: INK,
                    textAlign: "center",
                    width: 70,
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                  }}
                >
                  {clampPrint(p.newSr, 24)}
                </td>
                <td
                  style={{
                    fontSize: 7.4,
                    color: INK,
                    textAlign: "right",
                    width: 30,
                    padding: "2px 4px",
                    borderBottom: `0.5px solid ${HAIR}`,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p.qty}
                </td>
                <td
                  style={{
                    fontSize: 7.4,
                    color: INK,
                    textAlign: "right",
                    width: 56,
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
      <table className="panel" style={{ flex: 1, minWidth: 0 }}>
        <tbody>
          <Band>FEEDBACK &amp; SIGN-OFF</Band>
          <Pair label="FSE Feedback">
            <FeedbackValue value={model.feedback.fseFeedback} />
          </Pair>
          <Pair label="Customer Fdbk">
            <FeedbackValue value={model.feedback.customerFeedback} />
          </Pair>
          <Pair label="Rating">
            <span style={{ fontWeight: 700, fontSize: 8 }}>{model.feedback.rating} / 10</span>
          </Pair>
          <Pair label="FSR Status">
            <span style={{ display: "inline-flex", gap: 8, fontSize: 7, ...NUM }}>
              {statusItems.map((it) => (
                <span key={it.label}>
                  {it.on ? "☑" : "☐"} {it.mark} {it.label}
                </span>
              ))}
            </span>
          </Pair>
          <Pair label="FSR Verdict">
            <FeedbackValue value={model.feedback.verdict} />
          </Pair>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// H) SIGN-OFF — two identical primary-framed panels
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
    padding: 4,
  };
  const head: CSSProperties = {
    fontSize: 7.6,
    fontWeight: 700,
    letterSpacing: 0.8,
    color: GREEN,
  };
  const cap: CSSProperties = { fontSize: 6.5, fontWeight: 700, color: SUBTLE };
  return (
    <div style={{ display: "flex", gap: 2, marginTop: 2.5 }} className="avoid-break">
      <div style={box}>
        <div style={head}>CUSTOMER</div>
        <div style={{ display: "flex", gap: 6, marginTop: 1.5 }}>
          <div style={{ flex: 1.4, minWidth: 0, textAlign: "center", alignSelf: "center" }}>
            <div style={{ ...cap, textAlign: "left" }}>Signature</div>
            {signatureDataUrl ? (
              <img
                src={signatureDataUrl}
                alt="Customer signature"
                crossOrigin="anonymous"
                style={{ maxHeight: 34, maxWidth: "100%", objectFit: "contain" }}
              />
            ) : (
              <div style={{ height: 40 }} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 7.6, color: INK, ...NUM }}>
            <b>Name:</b> {clampPrint(sig.customerName, 60)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 1.5 }}>
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
        <div style={{ display: "flex", gap: 6, marginTop: 1.5 }}>
          <div style={{ flex: 1.4, minWidth: 0 }}>
            <div style={cap}>FSE Signature</div>
            <BlankLine />
            <div style={{ ...cap, marginTop: 4 }}>Date</div>
            <BlankLine />
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 7.6, color: INK, ...NUM }}>
            <b>Name:</b> {clampPrint(sig.fseName, 60)}
            <br />
            <b>No:</b> {sig.fsePhone}
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
    <div className="avoid-break" style={{ marginTop: 2.5 }}>
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
        <div style={{ flex: 1, textAlign: "center", fontSize: 6.8, fontWeight: 700, color: INK }}>
          Power Backup Solutions
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>UPS
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>Batteries
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>AMC
          <span style={{ color: GREEN, padding: "0 6px" }}>|</span>Services
        </div>
        <div
          className="g-bg"
          style={{
            fontSize: 7,
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
// Root — everything on ONE landscape sheet
// ---------------------------------------------------------------------------

export function FsrPrintView({ model, company, oem, signatureDataUrl }: FsrPrintViewProps) {
  return (
    <div className="defective-tag-page">
      <div className="fsr-print" style={sheetStyle}>
        <style>{STYLE_BLOCK}</style>
        <Header model={model} company={company} oem={oem} />
        <LifecycleRow model={model} />
        <ThreeColumnBlock model={model} />
        <ProblemReason model={model} />
        <EngineeringRow model={model} />
        <BatterySection model={model} />
        <PartsFeedback model={model} />
        <Signatures model={model} signatureDataUrl={signatureDataUrl} />
        <FooterStrip oem={oem} />
      </div>
    </div>
  );
}
