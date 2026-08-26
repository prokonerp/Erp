#!/usr/bin/env bun
/**
 * Build EINVOICE_TALLY_PROPOSAL.docx — v2.0.
 *
 * v2.0 CHANGE OF ROUTE: after a total-cost-of-ownership challenge, Workstream A
 * switched from direct-NIC integration to GSP-mediated e-invoicing (primary),
 * with direct NIC retained as a documented future option. Workstream B (Tally
 * export) unchanged. Section 13 records both design-review rounds.
 *
 * Usage: bun scripts/build-einvoice-proposal-docx.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
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
const OUT = path.join(ROOT, "EINVOICE_TALLY_PROPOSAL.docx");

// ---------- palette ----------
const NAVY = "1F3864";
const GRAY = "6B7280";
const BLACK = "111111";
const LIGHT = "EEF2F7";
const GREEN = "1E7B34";
const RED = "C00000";
const AMBER = "B45F06";

// ---------- helpers ----------
const t = (text, opts = {}) => new TextRun({ text, font: "Calibri", size: 22, color: BLACK, ...opts });

const title = (text, size = 44) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [t(text, { bold: true, size, color: NAVY })],
  });

const subtitle = (text) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 480 },
    children: [t(text, { italics: true, color: GRAY, size: 26 })],
  });

const h1 = (text) =>
  new Paragraph({
    spacing: { before: 360, after: 140 },
    children: [t(text, { bold: true, size: 30, color: NAVY })],
  });

const h2 = (text) =>
  new Paragraph({ spacing: { before: 260, after: 100 }, children: [t(text, { bold: true, size: 25 })] });

const p = (runs, opts = {}) =>
  new Paragraph({
    spacing: { after: 110 },
    ...(typeof runs === "string" ? { children: [t(runs)] } : { children: runs }),
    ...opts,
  });

const bullet = (runs, level = 0) =>
  new Paragraph({
    bullet: { level },
    spacing: { after: 70 },
    children: typeof runs === "string" ? [t(runs)] : runs,
  });

const b = (label, rest) => [t(`${label} `, { bold: true }), ...(rest ? [t(rest)] : [])];

const callout = (text, fill = LIGHT, barColor = NAVY) =>
  new Paragraph({
    spacing: { after: 130 },
    indent: { left: 240, right: 240 },
    shading: { type: ShadingType.CLEAR, fill },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: barColor, space: 8 } },
    children: [t(text, { italics: true, color: "333333", size: 21 })],
  });

const mono = (lines) =>
  lines.map((ln, idx) =>
    new Paragraph({
      spacing: {
        before: idx === 0 ? 120 : 0,
        after: idx === lines.length - 1 ? 170 : 0,
      },
      shading: { type: ShadingType.CLEAR, fill: LIGHT },
      indent: { left: 240, right: 240 },
      children: [new TextRun({ text: ln.length ? ln : " ", font: "Consolas", size: 17, color: NAVY })],
    }),
  );

const spacer = (after = 200) => new Paragraph({ spacing: { after }, children: [] });
const pageBreak = () => new Paragraph({ pageBreakBefore: false, children: [], spacing: { after: 0 }, break: 1 });

// ---------- tables ----------
const CELL_MARGIN = { top: 90, bottom: 90, left: 130, right: 130 };
const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "C9D2DE" },
};

const isRun = (x) => x instanceof TextRun;
const toRuns = (arr, run) =>
  arr.map((x) => (typeof x === "string" ? t(x, run ?? {}) : x));

function cell(content, opts = {}) {
  let paras;
  if (content instanceof Paragraph) {
    paras = [content];
  } else if (Array.isArray(content)) {
    // Distinguish: flat list of runs/strings => ONE paragraph.
    //              list of paragraphs / run-arrays / strings  => one paragraph per entry.
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
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) =>
          cell([[t(h, { bold: true, color: "FFFFFF", size: 20 })]], { fill: NAVY, width: widths?.[i] }),
        ),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c, i) => cell(c, { width: widths?.[i], run: { size: 21 } })),
          }),
      ),
    ],
  });
}

// =====================================================================
// CONTENT
// =====================================================================
const children = [];

// ---------------------------- COVER ----------------------------------
children.push(spacer(900));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [t("PROKON ERP", { bold: true, color: GRAY, size: 24 })] }));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 120 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 10 } },
  children: [],
}));
children.push(title("Government e-Invoicing Integration"));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [t("& One-Click Tally Accounting Export", { bold: true, size: 34, color: NAVY })] }));
children.push(subtitle("Project Proposal · Problem, Solution, End-to-End Design & Rollout Plan"));

children.push(spacer(500));
children.push(table(
  ["", ""],
  [
    ["Document", "Proposal for Management Approval"],
    ["Version", "2.0 — route revised to GSP-mediated e-invoicing after total-cost review"],
    ["Date", "25 August 2026"],
    ["Prepared by", "Jai — Product / Engineering"],
    ["Systems covered", "Prokon ERP (invoicing)  ·  Authorised GSP partner (e-invoice bridge)  ·  Tally ERP 9 (accountant)"],
  ],
  [22, 78],
));
children.push(spacer(400));
children.push(callout("Confidential — internal circulation only. Contains business and compliance information.", "FFF7E6", AMBER));
children.push(pageBreak());

// ------------------------- CONTENTS ----------------------------------
children.push(h1("Contents"));
[
  "1. Executive Summary",
  "2. Background — Where We Stand Today",
  "3. Problem Statement",
  "4. Proposed Solution",
  "5. How the Complete System Works — End to End",
  "6. Technology & Tools We Will Use",
  "7. Accounts, Logins & Registrations Needed",
  "8. Security & Data Safety",
  "9. Compliance Rules Built Into the System",
  "10. Implementation Plan & Timeline",
  "11. Cost Analysis — Three Routes Compared Honestly",
  "12. Risks & Mitigations",
  "13. Design Review & Decision Log",
  "14. Success Criteria",
  "15. Appendix — Plain-English Glossary",
].forEach((line) => children.push(new Paragraph({ spacing: { after: 80 }, children: [t(line)] })));
children.push(pageBreak());

// -------------------- 1 EXECUTIVE SUMMARY ----------------------------
children.push(h1("1. Executive Summary"));
children.push(p([
  t("Two gaps currently exist between "),
  t("how we bill", { bold: true }),
  t(" and "),
  t("how we stay compliant and keep our books", { bold: true }),
  t(":"),
]));
children.push(bullet([t("(A) Compliance: ", { bold: true }), t("With turnover above ₹5 crore, GST law requires every B2B tax invoice to be registered on the government e-Invoice system (an \"IRN\") before it counts as a legally issued invoice. Today our ERP can only generate a placeholder — no real IRN exists.")]));
children.push(bullet([t("(B) Accounting: ", { bold: true }), t("Our accountant maintains the books in Tally ERP 9. Every invoice we raise must be re-typed into Tally — duplicated effort, avoidable errors, and month-end delays.")]));
children.push(p([
  t("This proposal covers both gaps in one project: "),
  t("one-click IRN generation through an authorised GSP partner", { bold: true }),
  t(" — a government-licensed bridge between our ERP and the tax authority — plus a "),
  t("one-click export that imports straight into the accountant's Tally", { bold: true }),
  t(". Both workstreams run inside Prokon ERP using infrastructure we already pay for."),
]));
children.push(spacer(60));
children.push(table(
  ["At a glance", ""],
  [
    ["Recurring cost", [t("≈ ₹8,000–₹20,000 / year", { bold: true }), t(" GSP subscription (volume-based; typical SME plans sit at the lower end)")]],
    ["New infrastructure to buy or maintain", [t("None", { bold: true, color: GREEN }), t(" — no servers, no IP registrations, no security-certification projects")]],
    ["Build time", "~2–3 weeks (details in §10)"],
    ["Legal status", "Mandatory for us — non-compliance risks penalties of ₹10,000+ per invoice and blocked customer payments"],
    ["Risk posture", "Lowest of all available routes — the GSP carries uptime SLAs, security certifications, multi-portal failover, and keeps up with government spec changes on our behalf"],
  ],
  [30, 70],
));
children.push(callout("Why not the nominally “free” direct-government route? Because it is only free of licence fees — not of engineering weeks, a dedicated server, and an uncertain ₹1.5–4 lakh certification. §11 compares all three routes with full costs counted; §13 logs how we reached this decision.", "FFF7E6", AMBER));

// -------------------- 2 BACKGROUND -----------------------------------
children.push(h1("2. Background — Where We Stand Today"));
children.push(p("Prokon ERP already runs our sales workflow end to end: quotations → delivery challans → tax invoices → payment tracking. The invoicing engine was built GST-aware from day one:"));
children.push(table(
  ["Already working in Prokon ERP today", "Status"],
  [
    ["Automatic CGST / SGST / IGST computation per line item (same-state vs inter-state)", "✅ Live"],
    ["Buyer/seller GSTIN, place of supply, HSN codes, discount handling", "✅ Live"],
    ["Invoice PDF generation with QR support and amount-in-words", "✅ Live"],
    ["e-Invoice fields in database (IRN, acknowledgement no., QR payload)", "✅ Ready — unused"],
    ["\"Generate IRN\" button on invoices", "⚠️ Placeholder only — creates a dummy number, not a real government IRN"],
    ["e-Way Bill form on invoices", "⚠️ Placeholder only — records data, does not talk to any government portal"],
    ["Tally integration", "❌ None — accountant re-types everything"],
  ],
  [72, 28],
));
children.push(p([
  t("In short: the hard foundation is built. What is missing is the "),
  t("final mile", { bold: true }),
  t(" — connecting our invoices to the government registry, and to the accountant's books."),
]));

// -------------------- 3 PROBLEM STATEMENT ----------------------------
children.push(h1("3. Problem Statement"));

children.push(h2("3.1 The compliance problem — this is now a legal requirement"));
children.push(p([
  t("Businesses with aggregate turnover above "),
  t("₹5 crore", { bold: true }),
  t(" are legally required to issue "),
  t("e-Invoices", { bold: true }),
  t(": every B2B tax invoice must be reported to an Invoice Registration Portal (IRP) run under GSTN, which validates it and returns a unique 64-character "),
  t("Invoice Reference Number (IRN)", { bold: true }),
  t(" plus a cryptographically "),
  t("signed QR code", { bold: true }),
  t(" that must be printed on the invoice."),
]));
children.push(p("If we issue a B2B invoice without a valid IRN and signed QR:"));
children.push(bullet([t("It is treated in law as ", {}), t("\"failure to issue an invoice\"", { italics: true }), t(" (Rule 48(5), CGST Rules) — penalty ₹10,000 or the tax amount involved, whichever is higher, per invoice.")]));
children.push(bullet([t("Our customers cannot claim their input tax credit smoothly — large buyers simply ", {}), t("stop paying until a compliant invoice reaches them", { bold: true }), t(".")]));
children.push(bullet("Manual upload through the web portal does not scale and invites typing mistakes that the portal rejects."));

children.push(h2("3.2 The accounting problem — double work every month"));
children.push(p([
  t("Our accountant keeps the statutory books in "),
  t("Tally ERP 9", { bold: true }),
  t(". Today, every invoice, receipt and customer change made in Prokon ERP is "),
  t("re-entered manually into Tally", { bold: true }),
  t(". Consequences:"),
]));
children.push(bullet("Wasted hours every month on pure data entry."));
children.push(bullet("Typing errors create mismatches between what we billed and what the books show."));
children.push(bullet("Books lag reality by days, delaying reconciliations and filings."));
children.push(bullet("No automatic audit trail linking an ERP invoice to its Tally voucher."));

children.push(callout("Bottom line: we need our invoicing to speak directly to (a) the government e-invoice registry and (b) our accountant's Tally — automatically, accurately, and with predictable costs.", "EAF3EA", GREEN));

// -------------------- 4 PROPOSED SOLUTION ----------------------------
children.push(h1("4. Proposed Solution"));
children.push(p("Two workstreams, delivered together inside Prokon ERP:"));

children.push(h2("Workstream A — One-click IRN generation via an authorised GSP partner"));
children.push(p([
  t("A "),
  t("GSP (GST Suvidha Provider)", { bold: true }),
  t(" is a company licensed by GSTN to carry invoice traffic between businesses and the government's systems. They operate the certified connections, the encryption, the government-mandated security registrations, and absorb every specification change the tax authority issues. Well-known names include ClearTax, IRIS, Cygnet, EY and MasterGST."),
]));
children.push(p([
  t("We integrate Prokon ERP with "),
  t("one carefully chosen GSP", { bold: true }),
  t(": our server sends a standard invoice payload over a simple authenticated API; the GSP delivers it to the government and returns the IRN, acknowledgement and signed QR code. Once live, every B2B invoice gets, with one click (or automatically on issue):"),
]));
children.push(bullet([t("An ", {}), t("IRN", { bold: true }), t(" registered with the government against our GSTIN")]));
children.push(bullet([t("The official ", {}), t("signed QR code", { bold: true }), t(" printed on the PDF, verifiable by any buyer")]));
children.push(bullet([t("Acknowledgement number & date recorded for audit")]));
children.push(bullet([t("Optionally an ", {}), t("e-Way Bill", { bold: true }), t(" generated through the same partner for goods movement > ₹50,000")]));

children.push(p([t("What we deliberately do NOT build (and who carries it instead):", { bold: true })]));
children.push(table(
  ["Obligation", "Direct-route reality", "With a GSP"],
  [
    ["Government-mandated cryptography (encryption, signing, session keys)", "We implement and maintain it ourselves", "GSP's platform — we send plain JSON over TLS"],
    ["Static Indian IP registration with NIC firewalls", "Needs a dedicated always-on server (~₹500–800/month) just to hold a fixed address", "GSP's registered infrastructure"],
    ["Security certification (CERT-In audit risk, ₹1.5–4 L if demanded)", "Our bill, our project delay", "GSP's existing certification covers the pipe"],
    ["Keeping up with government spec & endpoint changes", "Our permanent maintenance duty", "GSP's contractual duty — invisible to us"],
  ],
  [30, 35, 35],
));

children.push(p([t("How we will pick the partner (selection checklist):", { bold: true })]));
children.push(bullet("GSTN-authorised GSP status (verified against the official GSTN partner list)"));
children.push(bullet("Transparent pricing — flat monthly slab vs per-IRN charges; e-Way Bill included or bundled cheaply"));
children.push(bullet("Quality of developer documentation and a usable sandbox for testing"));
children.push(bullet("Demonstrated uptime during month-end filing rush; responsive human support"));
children.push(bullet("Data-portability commitment — our invoice data remains ours, exportable, no lock-in"));

children.push(h2("Workstream B — One-click Tally export (unchanged; independent of the IRN route)"));
children.push(p([
  t("A new screen in Prokon ERP generates "),
  t("Tally-native XML files", { bold: true }),
  t(" that the accountant imports directly into Tally ERP 9 (Gateway of Tally → Import Data). No re-typing, no mapping tools, nothing extra for them to buy:"),
]));
children.push(bullet([t("Two-stage files: ", { bold: true }), t("a Masters file first (customers with GSTINs, sales ledgers split by GST rate, CGST/SGST/IGST and round-off ledgers — imported whenever new masters exist), then the Vouchers file (sales + receipts) that consumes them safely")]));
children.push(bullet([t("Deterministic unique IDs ", { bold: true }), t("(invoice UUID + financial year + document type) embedded in every voucher — re-importing a file can never create duplicates")]));
children.push(bullet([t("Canonical ledger names ", { bold: true }), t("exported verbatim from a controlled registry — casing or space differences can never spawn duplicate ledgers in Tally")]));
children.push(bullet([t("Pre-flight check ", { bold: true }), t("— flags missing GSTINs, missing HSN codes, duplicate numbers and ledger-name conflicts before the file ever reaches the accountant")]));

// -------------------- 5 END-TO-END -----------------------------------
children.push(h1("5. How the Complete System Works — End to End"));

children.push(h2("5.1 The e-invoice journey of one invoice"));
children.push(...mono([
  "SALES TEAM           PROKON SERVER           GSP PARTNER               GOVERNMENT (NIC IRP)",
  "──────────           ─────────────           ───────────               ────────────────────",
  "1. Create invoice",
  "   in Prokon ERP",
  "        │",
  "2. Click",
  "   \"Generate IRN\" ──► 3. Build standard JSON",
  "                      4. Validate master data │",
  "                      │  (GSTIN, HSN, PIN…)   │",
  "                      5. Send over simple ───► 6. Encrypt + sign ──────► 7. Validate invoice",
  "                         authenticated API        manages tokens          & register IRN",
  "                                                  & govt endpoints   ◄── 8. Return: IRN, Ack,",
  "                      ◄── plain JSON result ─────┘ (auto-retries too)      Signed QR code",
  "                      9. Save to invoice record",
  "                     10. Stamp PDF: QR + IRN + Ack ◄─ customer receives a fully",
  "                                                        compliant e-invoice",
]));
children.push(p([t("Every heavy-lifting step (6–8) belongs to the licensed partner. Our engineering stays on steps 3–5 and 9–10 — the parts that know our business.", { italics: true, color: GRAY, size: 20 })]));

children.push(h2("5.2 Step by step"));
children.push(table(
  ["Step", "What happens", "Who/what does it"],
  [
    ["1", "Invoice is created as usual — nothing changes for the sales team's daily workflow", "Sales team, Prokon ERP"],
    ["2", "\"Generate IRN\" clicked (or triggered automatically when invoice is issued)", "User / automation"],
    ["3", "Server converts the invoice into the government's standard JSON schema (≈130 fields, we fill all mandatory ones)", "Prokon Edge Function"],
    ["4", "Master-data validation: GSTIN formats, HSN length, pin codes, quantity units, invoice-number format — bad data is caught here, not rejected hours later", "Prokon validator"],
    ["5", "Server calls the GSP's authenticated API (client-ID/secret from our secret vault)", "Prokon Edge Function"],
    ["6–8", "GSP encrypts and signs per government mandate, submits to the IRP, auto-retries transient failures, and returns IRN + acknowledgement + signed QR", "Licensed GSP platform"],
    ["9–10", "ERP saves everything, stamps the PDF with the official QR, IRN and acknowledgement details", "Prokon ERP + PDF engine"],
  ],
  [8, 62, 30],
));

children.push(h2("5.3 When the pipeline is slow or down (retry queue + legal-safe fallback)"));
children.push(p([
  t("No integration is immune to bad days — ours or the partner's. And because an issued B2B invoice legally requires an IRN (Rule 48(5)), the fallback is designed to keep business moving "),
  t("without ever dispatching a non-compliant tax invoice", { bold: true }),
  t(":"),
]));
children.push(bullet([t("If no IRN comes back, the invoice is marked ", {}), t("“Pending IRN”", { bold: true }), t(" and cannot be marked issued/sent while it stays pending.")]));
children.push(bullet([t("Any printout during this window carries a bold "), t("“PROFORMA — NOT A TAX INVOICE”", { italics: true }), t(" watermark, so an invalid document can never reach a customer by accident.")]));
children.push(bullet("Automatic background retries with increasing waits (exponential backoff) continue for days; aging alerts escalate at day 7 and day 21."));
children.push(bullet([t("Manual fallback SOP: ", { bold: true }), t("the ERP exports the government’s standard portal-upload JSON, so staff can register invoices directly on the public web portal — dispatch never stops legally, even in a prolonged outage.")]));
children.push(bullet("Every attempt and response is logged permanently for audit."));

children.push(h2("5.4 Cancelling an e-invoice"));
children.push(p([
  t("Law allows cancelling an IRN only "),
  t("within 24 hours", { bold: true }),
  t(" of generation, entirely (no partial edits), and only if no e-way bill exists against it. The system enforces all three conditions and offers guided cancellation with the mandated reason codes. After 24 hours, corrections happen the standard way: a credit note against the original, which itself gets its own IRN."),
]));

children.push(h2("5.5 The month-end Tally routine (after go-live)"));
children.push(...mono([
  "ACCOUNTS PERSON (ERP)                    ACCOUNTANT (TALLY ERP 9)",
  "─────────────────────                    ────────────────────────",
  "1. Open Sales → Accounting Export",
  "2. Pick date range (e.g. August)",
  "3. Read pre-flight report — fix anything flagged",
  "4. Download:",
  "     • Tally_Masters_Aug.xml (only if new customers/ledgers exist)",
  "     • Tally_Vouchers_Aug.xml            5. Gateway of Tally → Import Data",
  "     • Excel summary for review             • Import Masters FIRST (creates any",
  "         │                                     missing ledgers, exactly once),",
  "         │                                   • then import the Vouchers file",
  "         └── email / share files ───────►  6. Done — books now match the ERP",
  "",
  "Safety 1: each voucher carries a deterministic unique ID (invoice UUID +",
  "financial year + document type), so re-importing can never duplicate.",
  "Safety 2: ledger names come verbatim from a controlled registry — casing or",
  "space differences can never spawn duplicate ledgers in Tally.",
]));

// -------------------- 6 TECHNOLOGY -----------------------------------
children.push(h1("6. Technology & Tools We Will Use"));
children.push(p("Everything below is either already part of Prokon ERP, or a licensed service chosen in Phase 0:"));
children.push(table(
  ["Component", "What we use", "Why"],
  [
    ["Frontend (screens & buttons)", "Existing Prokon ERP React app — extend invoice page, settings, new export screen", "No new product to learn; same UI"],
    ["Database", "Existing Supabase PostgreSQL — columns/tables for IRN storage, audit log, token cache", "Already hosted, backed up, access-controlled"],
    ["Secure server jobs", "Supabase Edge Functions calling the GSP's plain authenticated REST API (credentials held in server-side secrets)", "API calls and secrets cannot live in a browser. All endpoint URLs stay as configuration, so swapping provider or route later is a settings change, not surgery"],
    ["Government bridge", "Authorised GSP partner platform (chosen in Phase 0 against the §4 checklist)", "Carries the certified connection: government-grade encryption/signing, token management, IP & security registrations, spec updates, multi-portal failover — all contractual duties of theirs, not projects of ours"],
    ["Invoice PDF stamping", "Existing jsPDF + QR-code libraries", "Already renders our PDFs; just adds the official QR"],
    ["Tally integration format", "Tally ERP 9 native XML import (ENVELOPE / masters-first / voucher structure)", "Built into Tally — accountant needs zero new tools"],
    ["Testing", "Automated unit tests covering tax maths ↔ payload ↔ Tally XML correctness", "Same test framework already used by the project"],
  ],
  [24, 42, 34],
));

// -------------------- 7 LOGINS ---------------------------------------
children.push(h1("7. Accounts, Logins & Registrations Needed"));
children.push(p("This is the complete list — noticeably shorter than the direct-government alternative, because IP registrations and security-certification paperwork sit with the GSP. Nothing here requires capital expenditure beyond the subscription itself."));

children.push(h2("7.1 Registrations to complete (the homework)"));
children.push(table(
  ["#", "Account / Registration", "Where", "Who does it", "Purpose"],
  [
    ["1", "Choose and subscribe to a GSP partner", "Provider's website / sales", [t("Director — commercial decision", {})], "Sign the plan (monthly slab preferred). Use the §4 selection checklist"],
    ["2", "e-Invoice portal taxpayer registration + MFA", "einvoice1.gst.gov.in", "Director / GST owner (needs GST portal access)", "Enable our GSTIN for e-invoicing. MFA is mandatory since April 2026 — free OTP setup"],
    ["3", "Opt the chosen GSP on the portal + create API username/password", "einvoice1.gst.gov.in", "Director creates once, hands to developer privately", "Authorises the partner to submit on our behalf; machine login used by our server, never seen in day-to-day use"],
    ["4", "Sandbox testing with GSP keys", "Partner's test environment", "Developer", "Validate the full flow safely before switching on production"],
    ["5", "e-Way Bill activation (optional, Phase 5)", "Same GSP partner", "Director / logistics", "Generate real e-way bills from IRNs through the existing subscription"],
  ],
  [5, 26, 18, 21, 30],
));
children.push(callout("Deliberately absent from this list: static-IP registration with NIC firewalls, a dedicated gateway server, and CERT-In security-certification paperwork — under the GSP model those obligations belong to the partner, not to us.", "EAF3EA", GREEN));

children.push(h2("7.2 Where the sensitive logins live"));
children.push(table(
  ["Credential", "Stored in", "Who can see it"],
  [
    ["GSP client-ID / secret + portal API username/password", "Supabase Edge Function secrets (server-side environment vault)", "Nobody in day-to-day operations; only server code uses them"],
    ["Session tokens (auto-refreshed)", "Locked database table — blocked from normal app users by row-level security", "Server code only"],
    ["ERP logins", "Existing Prokon ERP authentication", "As today"],
    ["Tally", "Accountant's own existing Tally licence/login", "Accountant — unchanged"],
  ],
  [32, 38, 30],
));
children.push(callout("Practical meaning: after setup, no human ever logs into a government portal for routine invoicing. Staff click one button inside Prokon ERP; our server and the GSP handle everything behind the scenes.", "EAF3EA", GREEN));

// -------------------- 8 SECURITY -------------------------------------
children.push(h1("8. Security & Data Safety"));
children.push(bullet([t("Secrets never touch the browser or ordinary database queries. ", { bold: true }), t("All API credentials sit in an encrypted server-side vault; application users physically cannot read them.")]));
children.push(bullet([t("Honest data-flow note: ", { bold: true }), t("under the GSP model, invoice payloads transit the partner's certified platform before reaching the government — unlike a fully direct pipe. This is the standard arrangement for lakhs of Indian businesses. It is governed by the partner contract and their GSTN authorisation, and mitigated by our data-portability requirement in the §4 checklist.")]));
children.push(bullet([t("Complete audit trail. ", { bold: true }), t("Every request and response is stored locally with timestamps — instant answers during any departmental query or buyer dispute, independent of the partner.")]));
children.push(bullet([t("Tamper-proof invoices. ", { bold: true }), t("The signed QR is applied cryptographically by the government's own IRP regardless of route; any buyer can verify authenticity.")]));
children.push(bullet([t("Least-privilege database. ", { bold: true }), t("Token/log tables are locked by row-level security so only server code can access them.")]));
children.push(bullet([t("No lock-in. ", { bold: true }), t("Because the connector is abstracted, changing GSP — or moving to direct integration someday — is a configuration change plus one adapter, never a rebuild. We also hold every payload and response locally, so history survives any vendor exit.")]));

// -------------------- 9 COMPLIANCE ----------------------------------
children.push(h1("9. Compliance Rules Built Into the System"));
children.push(p("These apply identically whichever pipe carries the invoice — they are enforced by Prokon ERP itself:"));
children.push(table(
  ["Rule (law)", "How the system enforces it"],
  [
    ["Every B2B invoice needs an IRN + signed QR before use", "One-click/auto IRN generation. While pending: bold PROFORMA watermark on any printout, and the invoice cannot be marked issued/sent (§5.3). Manual portal-upload SOP guarantees a legal route even during outages"],
    ["Invoices must be unique regardless of letter case — IRP uppercases all numbers and treats inv-001 = INV-001 (since June 2025)", "ERP forces uppercase, restricted-character invoice numbering at creation, so duplicates are impossible before they reach anyone"],
    ["IRN cancellation only within 24 hours, only if no e-way bill exists", "Cancel button appears only while legal; reason codes captured as mandated"],
    ["Invoices older than 30 days may be rejected — applies at ₹10 Cr+ turnover today, threshold expected to move downward", "Configurable hard block on backdated invoicing once we cross ₹10 Cr AATO (alert-only until then); pending queue escalates at day 7 and day 21, far before any limit"],
    ["Master data quality (valid GSTIN, HSN codes, units)", "Validation before submission — bad data stops at our door with a clear message, not a cryptic rejection"],
    ["Books must reconcile with returns", "Tally export carries the exact figures filed in GSTR-1; monthly IRN register export included for the accountant"],
  ],
  [48, 52],
));

// -------------------- 10 PLAN ---------------------------------------
children.push(h1("10. Implementation Plan & Timeline"));
children.push(table(
  ["Phase", "Scope", "Duration", "Depends on"],
  [
    ["0 — Partner & portals (parallel)", "Pick GSP against the §4 checklist and subscribe; portal registration + MFA; opt the GSP and generate API credentials (§7.1)", "~2–4 working days elapsed", "Director decision"],
    ["1 — Foundation", "Database migration; e-invoice payload builder + validator; automated tests", "Week 1", "—"],
    ["2 — Partner connectivity", "Wire the GSP adapter: send payloads to their sandbox, handle success/error/retry responses; endpoint URLs as configuration", "Days (not weeks — no government crypto or firewall work exists on our side anymore)", "Phase 0 keys"],
    ["3 — User experience", "Invoice page wiring, error display, retry queue with PROFORMA watermark & issue-block, dashboard aging alerts, PDF with official QR, uppercase invoice numbering", "Week 2", "Phase 2"],
    ["4 — Tally export (parallel)", "Two-stage XML generator (masters-first + vouchers), deterministic unique IDs, canonical ledger registry, export screen with pre-flight report incl. duplicate-ledger detection, accountant's how-to guide", "Weeks 2–3", "Accountant confirms accounting-only vs inventory mode"],
    ["5 — Go live", "Switch GSP key from sandbox to production → pilot on a handful of real invoices (cancel-safe within 24h) → full rollout; optional e-Way Bill activation", "Week 3+", "Production activation on the partner account"],
  ],
  [20, 46, 18, 16],
));
children.push(p([
  t("Realistic total: "),
  t("~2–3 weeks", { bold: true }),
  t(" — roughly half the earlier direct-integration estimate, because Phase 2 collapsed from building-and-certifying government cryptography to consuming a well-documented commercial API. The longest lead item is simply choosing the partner."),
]));

// -------------------- 11 COST ---------------------------------------
children.push(h1("11. Cost Analysis — Three Routes Compared Honestly"));
children.push(p("Earlier drafts compared only licence fees, which flattered the “free” direct route. The table below counts everything: subscriptions, infrastructure, engineering time, and one-time risks."));
children.push(table(
  ["Route", "Year-1 cash cost", "Ongoing engineering burden", "One-time / hidden risks"],
  [
    [[t("★ GSP partner (recommended)", { bold: true, color: GREEN })], "₹8,000–₹20,000 subscription (plan-dependent)", "Minimal — days per year at most", "Price rises at renewal (mitigated: multi-year quote negotiated now + swappable connector); no audit exposure, no infrastructure"],
    ["Direct NIC integration", "Gateway server ₹6,000–₹9,600/yr + several engineering-weeks valued well above the subscription saved", "Permanent — crypto upkeep, spec changes, endpoint migrations, firewall renewals are ours forever", [t("CERT-In certification uncertainty: ₹1.5–4 L if demanded, plus schedule risk. Only becomes attractive at very high volumes (order of 40,000+ invoices/year) sustained over multiple years", {})]],
    ["Zero-spend manual stopgap", "₹0 — NIC's free offline tool (Excel → JSON → portal upload)", "None to build, but someone performs manual batches weekly, forever", "Human error rates, no automation, defeats the project's core purpose. Acceptable only as a temporary bridge or emergency SOP (already built into §5.3)"],
  ],
  [20, 24, 26, 30],
));
children.push(p([
  t("Reading the numbers plainly: going direct saves perhaps ₹8,000–₹14,000 of subscription a year after its own server bill — and one demanded certification would erase a decade of that saving, before counting engineering weeks. "),
  t("That is why the recommendation is GSP-first", { bold: true }),
  t(", with the direct route kept alive on paper (the connector abstraction) should volumes ever justify revisiting. Hosting for our own components remains absorbed by the existing Supabase plan."),
]));

// -------------------- 12 RISKS --------------------------------------
children.push(h1("12. Risks & Mitigations"));
children.push(table(
  ["Risk", "Reality", "Mitigation built in"],
  [
    ["Pipeline downtime / slowness (ours or partner's)", "Any integration has bad days; partners counteract with multi-IRP failover and SLAs, but no one is perfect", "Retry queue with backoff; PROFORMA watermark + issue-block keeps dispatch legally safe (§5.3); manual portal-upload SOP; aging alerts day 7/21"],
    ["GSP price increase or poor service at renewal", "Commercial reality of subscriptions", "Multi-year pricing locked at signature where possible; connector abstraction means switching partner (or route) is configuration + one adapter — days, not months; we retain all data locally regardless"],
    ["Invoice data transits a third party", "True under any GSP model — the trade-off accepted for cost and speed", "Partner must be GSTN-authorised (verified in §4 checklist); confidentiality and data-portability clauses in contract; payloads stored locally so our audit trail never depends on the vendor"],
    ["Government changes specs / endpoints", "Still happens a few times a year — but it lands on the partner now", "Contractual duty of the GSP; occasional field-level updates may ripple into our payload builder, sized in days"],
    ["Dirty master data causes rejections or duplicate Tally ledgers", "#1 cause of failed submissions industry-wide", "Pre-flight validation in ERP; canonical ledger registry with exact-name matching and duplicate detection in the Tally export report"],
    ["Onboarding delays", "Far smaller than the direct route — no IP whitelisting queue, no certification cycle", "Phase 0 is days; all build phases proceed in parallel"],
    ["Key-person risk on the new code", "—", "Fully documented (this document + technical docs + automated tests as living specification)"],
  ],
  [26, 32, 42],
));

// -------------------- 13 DECISION LOG -------------------------------
children.push(h1("13. Design Review & Decision Log"));
children.push(p([
  t("This proposal survived two independent challenge rounds. Both are recorded here so the reasoning is auditable — including the round that "),
  t("changed the recommended route", { bold: true }),
  t("."),
]));

children.push(h2("Round 1 — Feasibility review of v1.0 (direct-integration draft)"));
children.push(table(
  ["Claim raised", "Verdict after verification", "What changed"],
  [
    ["“Direct API access is blocked below ₹100 Cr turnover”", [t("Incorrect.", { bold: true, color: GREEN }), t(" Stale 2020-era policy; GSTN extended direct access above ₹5 Cr from Jan 2023")], "Proceeded (then) as planned; written GSTN confirmation added to checklist"],
    ["“Production needs up to 4 whitelisted Indian static IPs; serverless can't provide them”", [t("Correct — critical.", { bold: true, color: RED }), t(" Confirmed on NIC's official onboarding page")], "Fixed-IP gateway was added in v1.1… then made irrelevant by Round 2"],
    ["“CERT-In empanelled audit is mandatory”", [t("Half-true.", { bold: true, color: AMBER }), t(" Certain for the e-way-bill API; absent from the official e-invoice checklist")], "Treated as tail-risk — became a decisive input in Round 2"],
    ["“Dispatching 'Pending IRN' invoices violates Rule 48(5)”", [t("Correct.", { bold: true, color: RED })], "PROFORMA watermark + issue-block + portal-upload SOP (§5.3) — retained in v2.0"],
    ["“Tally aborts/duplicates on missing ledgers — masters must precede vouchers”", [t("Correct.", { bold: true, color: RED })], "Two-stage XML + canonical ledger registry (§4, §5.5) — retained in v2.0"],
    ["“Uppercase invoice numbering enforced by IRP” / “deterministic unique IDs needed”", [t("Both correct.", { bold: true, color: GREEN })], "Normalisation rule (§9) and GUID scheme (§5.5) — retained in v2.0"],
    ["“MPLS leased line / ₹5 L recurring infra required”", [t("Overstated.", { bold: true, color: AMBER })], "Never budgeted"],
  ],
  [32, 34, 34],
));

children.push(h2("Round 2 — Total-cost challenge of v1.1 (this revision)"));
children.push(table(
  ["Challenge", "Verdict", "Consequence"],
  [
    ["“Once developer weeks, the gateway server and the audit gamble are counted, the GSP route is cheaper and lower-risk in year 1 — the direct route only wins after 3–4+ years, at volume, with no audit trigger”", [t("Accepted.", { bold: true, color: RED }), t(" The v1.1 comparison counted licence fees but flattered direct integration by omitting engineering time and the certification tail-risk")], [t("Workstream A switched to GSP-primary throughout this document. ", { bold: true }), t("Timeline halved (§10), infrastructure eliminated (§6), audit risk transferred (§11–§12). Direct NIC retained as a documented future option via the connector abstraction — revisit only above roughly 40,000+ invoices/year")]],
    ["“NIC's free offline bulk-upload tool could be a zero-cost path”", [t("Partially.", { bold: true, color: AMBER }), t(" Truly ₹0, but manual batches defeat the automation purpose")], "Kept only as the emergency SOP inside §5.3, not as the strategy"],
    ["“Workstream B is independent of the IRN route”", [t("Correct.", { bold: true, color: GREEN })], "Tally export design untouched across revisions — confirming the two workstreams were correctly separated"],
  ],
  [36, 28, 36],
));

// -------------------- 14 SUCCESS ------------------------------------
children.push(h1("14. Success Criteria"));
children.push(bullet([t("100%", { bold: true }), t(" of B2B invoices carry a valid government IRN and the official signed QR on the PDF")]));
children.push(bullet([t("Zero", { bold: true }), t(" non-compliant invoices ever dispatched — watermark and issue-block enforced by the system, not by memory")]));
children.push(bullet([t("Zero", { bold: true }), t(" manual re-entry of invoices/receipts into Tally — monthly import takes the accountant under five minutes")]));
children.push(bullet([t("Zero", { bold: true }), t(" duplicate vouchers or ledgers in Tally, guaranteed by deterministic IDs and canonical names")]));
children.push(bullet([t("Full", { bold: true }), t(" audit trail: any invoice traceable from creation → IRN → Tally voucher in under a minute")]));
children.push(bullet([t("Predictable", { bold: true }), t(" spend: one annual subscription, no infrastructure, no surprise certification bills")]));
children.push(bullet([t("Swappable", { bold: true }), t(" plumbing: changing GSP — or adopting direct integration someday — achievable within about a week of work")]));

// -------------------- 15 GLOSSARY -----------------------------------
children.push(h1("15. Appendix — Plain-English Glossary"));
children.push(table(
  ["Term", "Meaning"],
  [
    ["IRN (Invoice Reference Number)", "The 64-character unique ID the government assigns to each e-invoice. Proof the invoice is officially registered."],
    ["IRP (Invoice Registration Portal)", "The government system that accepts invoices and issues IRNs. NIC operates the main ones."],
    ["GSP (GST Suvidha Provider)", "A company licensed by GSTN to carry GST/e-invoice traffic between businesses and government systems. Chosen here as our recommended route."],
    ["Multi-IRP failover", "If one government registration portal is down, the GSP automatically submits through another approved one."],
    ["Signed QR code", "QR code cryptographically sealed by the government; printed on the invoice so any buyer can verify authenticity."],
    ["e-Way Bill (EWB)", "Electronic permit required for moving goods worth over ₹50,000; can be generated from an IRN."],
    ["GSTIN", "GST Identification Number (15 characters) of a business."],
    ["HSN code", "Standardised product classification code required on invoices."],
    ["Sandbox", "A practice/test environment — identical behaviour, no real consequences."],
    ["Static IP whitelisting", "Firewall practice where the government only accepts API traffic from pre-registered server addresses. Required on the direct route; handled by the GSP otherwise."],
    ["CERT-In security audit (SAR / VAPT)", "A penetration-test report from a government-empanelled auditor. Required for some integrations; avoided entirely under the GSP route."],
    ["Proforma watermark", "A large “NOT A TAX INVOICE” stamp printed on documents that are not yet legally issued — prevents accidental dispatch of non-compliant paperwork."],
    ["Tally XML", "Tally's native import file format. Our export produces files Tally ingests natively — no plugins."],
    ["Voucher (Tally)", "A bookkeeping entry in Tally — e.g., a Sales or Receipt entry."],
    ["Ledger masters", "Tally's master lists — customers, sales accounts, tax accounts — created once, reused forever."],
    ["Exponential backoff", "Retry pattern: try again after 1 min, then 2, then 4… avoids hammering a struggling pipeline."],
    ["TCO (Total Cost of Ownership)", "Everything a choice really costs — licences, servers, people-time, risks — not just the sticker price."],
  ],
  [30, 70],
));
children.push(spacer(300));
children.push(callout("Recommendation: approve the GSP subscription (Phase 0, §4 checklist) and start this week. It is the only step awaiting a decision — everything else proceeds in parallel and lands in roughly three weeks.", "FFF7E6", AMBER));

// =====================================================================
// DOCUMENT
// =====================================================================
const doc = new Document({
  styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
  sections: [
    {
      properties: {
        page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1247, right: 1247 } },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Prokon ERP · E-Invoicing & Tally Export Proposal (v2.0) · Page ", font: "Calibri", size: 16, color: GRAY }),
                new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 16, color: GRAY }),
                new TextRun({ text: " of ", font: "Calibri", size: 16, color: GRAY }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Calibri", size: 16, color: GRAY }),
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
