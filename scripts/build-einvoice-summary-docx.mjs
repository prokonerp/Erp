#!/usr/bin/env bun
/**
 * Build EINVOICE_TALLY_SUMMARY_2PAGER.docx — a two-page executive brief
 * distilled from EINVOICE_TALLY_PROPOSAL.docx (v2.0, GSP-primary route).
 * Compact styling tuned to fit exactly two A4 pages.
 *
 * Usage: bun scripts/build-einvoice-summary-docx.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "EINVOICE_TALLY_SUMMARY_2PAGER.docx");

const NAVY = "1F3864";
const GRAY = "6B7280";
const BLACK = "111111";
const LIGHT = "EEF2F7";
const GREEN = "1E7B34";
const AMBER = "B45F06";

// ---- compact helpers ----
const t = (text, opts = {}) => new TextRun({ text, font: "Calibri", size: 20, color: BLACK, ...opts });

const h = (text) =>
  new Paragraph({ spacing: { before: 170, after: 70 }, children: [t(text, { bold: true, size: 24, color: NAVY })] });

const p = (runs, opts = {}) =>
  new Paragraph({
    spacing: { after: 60 },
    ...(typeof runs === "string" ? { children: [t(runs)] } : { children: runs }),
    ...opts,
  });

const bullet = (runs) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 40 },
    children: typeof runs === "string" ? [t(runs)] : runs,
  });

const callout = (runs, fill = LIGHT, barColor = NAVY) =>
  new Paragraph({
    spacing: { after: 90 },
    indent: { left: 200, right: 200 },
    shading: { type: ShadingType.CLEAR, fill },
    border: { left: { style: BorderStyle.SINGLE, size: 16, color: barColor, space: 6 } },
    children: Array.isArray(runs) ? runs : [t(runs, { italics: true, color: "333333", size: 20 })],
  });

const CELL_MARGIN = { top: 60, bottom: 60, left: 110, right: 110 };
const pageBreak = () => new Paragraph({ spacing: { after: 0 }, children: [new PageBreak()] });
const BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
};

const isRun = (x) => x instanceof TextRun;
const toRuns = (arr, run) => arr.map((x) => (typeof x === "string" ? t(x, run ?? {}) : x));

function cell(content, opts = {}) {
  let paras;
  if (content instanceof Paragraph) {
    paras = [content];
  } else if (Array.isArray(content)) {
    // Flat list of runs/strings => ONE paragraph.
    // List of paragraphs / run-arrays / strings => one paragraph per entry.
    const flatRuns = content.every((x) => typeof x === "string" || isRun(x));
    paras = flatRuns
      ? [new Paragraph({ spacing: { after: 0 }, children: toRuns(content, opts.run) })]
      : content.map((c) =>
          c instanceof Paragraph
            ? c
            : new Paragraph({
                spacing: { after: 0 },
                children: toRuns(Array.isArray(c) ? c : [c], opts.run),
              }),
        );
  } else {
    paras = [new Paragraph({ spacing: { after: 0 }, children: [t(String(content), opts.run ?? {})] })];
  }
  return new TableCell({
    children: paras,
    margins: CELL_MARGIN,
    ...(opts.fill ? { shading: { type: ShadingType.CLEAR, fill: opts.fill } } : {}),
    ...(opts.width ? { width: { size: opts.width, type: WidthType.PERCENTAGE } } : {}),
    verticalAlign: "center",
  });
}

function table(headers, rows, widths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((hd, i) => cell([[t(hd, { bold: true, color: "FFFFFF", size: 19 })]], { fill: NAVY, width: widths?.[i] })),
      }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: widths?.[i], run: { size: 19 } })) })),
    ],
  });
}

const children = [];

// ================= PAGE 1 =================
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [t("PROKON ERP · EXECUTIVE BRIEF · Companion to Full Proposal v2.0", { bold: true, color: GRAY, size: 18 })] }));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 120 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: NAVY, space: 8 } },
  children: [],
}));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [t("Government e-Invoicing + Tally Accounting Export", { bold: true, size: 32, color: NAVY })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 140 }, children: [t("Decision summary for management approval · 25 August 2026", { italics: true, color: GRAY, size: 21 })] }));

children.push(h("1 · The situation"));
children.push(bullet([t("Legal mandate now: ", { bold: true }), t("above ₹5 crore turnover, every B2B invoice must carry a government-issued IRN number and an official signed QR code. An invoice without them counts as \"never issued\" — penalties from ₹10,000 per bill, and large buyers refuse payment until they receive a compliant invoice.")]));
children.push(bullet([t("Today's gap: ", { bold: true }), t("our ERP's \"Generate IRN\" button is a placeholder — no real government registration happens.")]));
children.push(bullet([t("Double work: ", { bold: true }), t("our accountant re-types every invoice and receipt into Tally ERP 9 each month — hours lost, avoidable errors, books lag reality.")]));
children.push(bullet([t("Good news: ", { bold: true }), t("the ERP's tax engine, GSTIN handling and PDF generation are already built and GST-ready. Only the final connections are missing.")]));

children.push(h("2 · What we propose"));
children.push(table(
  ["Workstream", "What it delivers"],
  [
    [[t("A — Real e-invoices via a licensed GSP partner", { bold: true })], "One click sends the invoice through a GSTN-authorised bridge company (ClearTax / IRIS / MasterGST class) to the government. Returns the IRN, acknowledgement and signed QR — printed automatically on the PDF. e-Way Bills come later through the same partner."],
    [[t("B — One-click Tally export", { bold: true })], "Month-end: pick a date range, download two files, email to the accountant. They import into Tally in about five minutes — all sales and receipts, zero re-typing, duplicates impossible by design."],
  ],
  [34, 66],
));

children.push(h("3 · At a glance"));
children.push(table(
  ["", ""],
  [
    ["Cost", [t("≈ ₹8,000–₹20,000/year", { bold: true }), t(" one GSP subscription — nothing else. No servers, no audits, no IP registrations")]],
    ["Build time", "~2–3 weeks (partner signup runs in parallel)"],
    ["Compliance", "Mandatory for us — this removes the penalty exposure entirely"],
    ["Risk", "Lowest of all available routes — SLA-backed uptime, security certifications and government spec changes are the partner's contractual duties"],
  ],
  [18, 82],
));
children.push(pageBreak());

// ================= PAGE 2 =================
children.push(h("4 · Daily life after go-live"));
children.push(bullet("Sales raises invoices exactly as today, clicks \"Generate IRN\" — ten seconds later the PDF carries the government QR. Send."));
children.push(bullet([t("If the pipeline has a bad day: ", {}), t("the invoice waits as \"Pending\", retries happen automatically, anything printed says "), t("PROFORMA — NOT A TAX INVOICE", { italics: true }), t(", and issuing is blocked until the IRN arrives — so an invalid document can never reach a customer. A manual web-portal fallback keeps dispatch legal even during long outages.")]));
children.push(bullet("Month-end: export → email two small files → accountant imports → books match the ERP exactly."));
children.push(bullet("Wrong invoice? Cancellation is allowed by law only within 24 hours — the system enforces that window automatically."));

children.push(h("5 · The money — three routes compared honestly"));
children.push(table(
  ["Route", "Real year-1 picture", "Verdict"],
  [
    [[t("★ GSP partner", { bold: true, color: GREEN })], "₹8–20k/yr subscription; days of engineering upkeep; risks sit with the partner", [t("Recommended", { bold: true, color: GREEN })]],
    ["Direct government integration", "\"Free\" licence, but adds a server (₹6–10k/yr), weeks of engineering, permanent maintenance — plus an uncertain ₹1.5–4 lakh security certification if demanded. Only wins beyond ~40,000 invoices/year", "Declined for now — revisit only at high volume"],
    ["Manual JSON uploads (free)", "₹0 using the government's own bulk-upload tool, but a person runs batches weekly forever", "Kept as built-in emergency backup only"],
  ],
  [22, 56, 22],
));
children.push(p([
  t("Full cost workings, risk register and the two design-review rounds that shaped these conclusions are in the accompanying proposal (§11–§13)."),
], { spacing: { after: 80 } }));

children.push(h("6 · Built-in safeguards"));
children.push(bullet("Watermark + issue-block until an IRN exists — zero non-compliant invoices dispatched, enforced by software not memory."));
children.push(bullet("Automatic retries with escalation alerts at day 7 and day 21 — far inside every statutory limit."));
children.push(bullet("Master-data validation before submission (GSTINs, HSN codes, invoice-number format) and duplicate-proof Tally exports."));
children.push(bullet("Complete local audit log of every request/response; no vendor lock-in — swapping partner or route is a settings change, not a rebuild."));

children.push(h("7 · Timeline"));
children.push(table(
  ["Week 1", "Week 2", "Weeks 2–3 (parallel)", "Week 3+"],
  [
    ["Partner chosen & subscribed · portal registration + MFA · database & payload builder", "GSP connection live in sandbox · invoice screen, alerts, watermarked fallback, QR-stamped PDF", "Tally export module + pre-flight report + accountant guide", "Pilot on a handful of real invoices → full rollout → optional e-Way Bills"],
  ],
  [25, 25, 25, 25],
));

children.push(spacer2());
children.push(callout([
  t("Decision requested: ", { bold: true, color: AMBER }),
  t("(1) approve the GSP subscription, (2) director completes the 30-minute portal registrations listed in §7 of the full proposal, (3) green-light Phase 0 this week. Everything else proceeds in parallel."),
], "FFF7E6", AMBER));

function spacer2(after = 100) {
  return new Paragraph({ spacing: { after }, children: [] });
}

const doc = new Document({
  styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
  sections: [
    {
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 900, bottom: 900, left: 1100, right: 1100 } },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Prokon ERP · e-Invoicing & Tally Export — 2-page brief · Page ", font: "Calibri", size: 15, color: GRAY }),
                new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 15, color: GRAY }),
                new TextRun({ text: " of ", font: "Calibri", size: 15, color: GRAY }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Calibri", size: 15, color: GRAY }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(OUT, buf);
console.log(`✔ Wrote ${path.relative(ROOT, OUT)} (${(buf.length / 1024).toFixed(1)} KB)`);
