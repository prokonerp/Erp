#!/usr/bin/env bun
/**
 * Build PRINT_ISSUES_REPORT.docx from docs/PRINT_ISSUES_REPORT.md.
 *
 * Mirrors the styling conventions of the existing BUG_REPORT.docx:
 *   - A4 portrait, generous margins
 *   - Navy section headings with emoji
 *   - Per issue: bold "H-XX"/"P-XX" heading with optional colored severity tag,
 *     bold inline labels ("Issue you'll face:", "Solution:", "What it is:", …),
 *     small italic gray file references.
 *   - ``` fenced blocks render as monospace shaded diagrams.
 *
 * Usage: bun scripts/build-report-docx.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
} from "docx";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "docs", "PRINT_ISSUES_REPORT.md");
const OUT = path.join(ROOT, "PRINT_ISSUES_REPORT.docx");

// ---------- palette ----------
const NAVY = "1F3864";
const GRAY = "6B7280";
const BLACK = "111111";
const SEVERITY_COLORS = {
  Critical: "C00000",
  High: "E36C0A",
  Medium: "2E74B5",
  Systemic: "7030A0",
};
const sevColor = (s) => SEVERITY_COLORS[s] ?? GRAY;

// ---------- markdown parser for our known shape ----------
function parse(md) {
  const lines = md.split(/\r?\n/);
  const doc = { title: "", intro: [], blocks: [] };

  let i = 0;
  // Title = first "# " line
  while (i < lines.length && !lines[i].startsWith("# ")) i++;
  doc.title = (lines[i] || "").replace(/^#\s+/, "").trim();
  i++;
  // Intro = consecutive "> " lines after title
  while (i < lines.length) {
    const l = lines[i].trim();
    if (l.startsWith(">")) {
      const t = l.replace(/^>\s?/, "").trim();
      if (t) doc.intro.push(t);
    } else if (l !== "") break;
    i++;
  }

  let section = null;
  let cur = null; // current issue being built
  let codeOpen = false;
  let codeLines = [];
  let rootCause = null;

  const flushIssue = () => {
    if (cur) doc.blocks.push(cur);
    cur = null;
  };
  const flushRoot = () => {
    if (rootCause) {
      doc.blocks.push({ type: "rootcause", section: rootCause.section, paragraphs: rootCause.paragraphs });
      rootCause = null;
    }
  };

  for (; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim();

    // ---- fenced code ----
    if (codeOpen) {
      if (l.startsWith("```")) {
        doc.blocks.push({ type: "code", section, lines: [...codeLines] });
        codeOpen = false; codeLines = [];
      } else {
        codeLines.push(raw);
      }
      continue;
    }
    if (l.startsWith("```")) { flushIssue(); codeOpen = true; codeLines = []; continue; }

    if (!l || l === "---") continue;

    // ---- headings ----
    if (l.startsWith("## ")) {
      flushIssue(); flushRoot();
      section = l.replace(/^##\s+/, "").trim();
      doc.blocks.push({ type: "section", text: section });
      continue;
    }
    const hm = l.match(/^###\s+([A-Z]{1,3}-?\d*)\s*·\s*(.+?)(?:\s*·\s*\[(.+?)\])?\s*$/);
    if (hm) {
      flushIssue();
      cur = {
        type: "issue", id: hm[1] || "", title: hm[2].trim(),
        severity: hm[3] || "", section, stream: [],
      };
      continue;
    }
    if (l.startsWith("### ")) {
      flushIssue();
      cur = { type: "issue", id: "", title: l.replace(/^###\s+/, "").trim(), severity: "", section, stream: [] };
      continue;
    }

    // ---- mid-document note ("quote") ----
    if (l.startsWith(">")) {
      flushIssue(); flushRoot();
      doc.blocks.push({ type: "note", section, text: l.replace(/^>\s?/, "").trim() });
      continue;
    }

    // ---- table rows are not rendered ----
    if (l.startsWith("|")) continue;

    // ---- file reference line *( ... )* ----
    const rm = l.match(/^\*\(.*\)\s*\*$/) || (/^\(/.test(l) && /\)\s*$/.test(l) && l.startsWith("*(") ? null : null);
    if (/^\*\(.*\)\s*\*$/.test(l)) {
      if (cur) cur.stream.push({ kind: "ref", text: l.replace(/^\*\(/, "").replace(/\)\s*\*$/, "").replace(/^\(/, "").replace(/\)$/, "") });
      continue;
    }

    // ---- generic bold label: **Label:** text ----
    const lm = l.match(/^\*\*(.+?):\*\*\s*(.*)$/);
    if (lm) {
      const item = { kind: "item", label: lm[1].trim(), text: lm[2].trim() };
      if (cur) cur.stream.push(item);
      else doc.blocks.push({ type: "labeled", section, item });
      continue;
    }

    // ---- continuation / plain paragraph ----
    const target = cur
      ? cur.stream[cur.stream.length - 1]
      : (() => {
          const last = doc.blocks[doc.blocks.length - 1];
          return last && (last.type === "labeled" || last.type === "para") ? last : null;
        })();
    if (target && target.kind !== undefined ? target.kind === "item" || target.type === "labeled" : false) {
      target.text += " " + l;
    } else if (cur) {
      cur.stream.push({ kind: "item", label: "", text: l });
    } else {
      doc.blocks.push({ type: "para", section, text: l });
    }
  }
  flushIssue(); flushRoot();
  return doc;
}

// ---------- docx builders ----------
const baseText = (text, opts = {}) => new TextRun({ text, font: "Calibri", size: 22, color: BLACK, ...opts });

function titlePara(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 240 },
    children: [baseText(text, { bold: true, size: 40, color: NAVY })],
  });
}

function introPara(text) {
  return new Paragraph({
    spacing: { after: 120 },
    indent: { left: 360 },
    shading: { type: ShadingType.CLEAR, fill: "F3F4F6" },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: NAVY, space: 8 } },
    children: [baseText(text, { italics: true, color: GRAY, size: 20 })],
  });
}

function notePara(text) {
  return introPara(text);
}

function sectionPara(text) {
  return new Paragraph({
    spacing: { before: 320, after: 160 },
    children: [baseText(text, { bold: true, size: 30, color: NAVY })],
  });
}

function subHeadingPara(title) {
  return new Paragraph({ spacing: { before: 260, after: 100 }, children: [baseText(title, { bold: true, size: 26 })] });
}

function issueHeading(id, title, severity) {
  const runs = [];
  if (id) runs.push(baseText(`${id} · `, { bold: true, size: 26 }));
  runs.push(baseText(title, { bold: true, size: 26 }));
  if (severity) runs.push(baseText(`   [${severity}]`, { bold: true, size: 22, color: sevColor(severity) }));
  return new Paragraph({ spacing: { before: 260, after: 100 }, children: runs });
}

function labeledPara(label, text) {
  const runs = [];
  if (label) {
    const isSolution = /^solution/i.test(label);
    runs.push(baseText(`${label}: `, { bold: true, ...(isSolution ? { color: NAVY } : {}) }));
  }
  if (text) runs.push(baseText(text));
  return new Paragraph({ spacing: { after: 80 }, children: runs });
}

function refPara(text) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [baseText(`(${text})`, { italics: true, size: 17, color: GRAY })],
  });
}

function codeBlock(lines) {
  return lines.map((ln, idx) =>
    new Paragraph({
      spacing: { before: idx === 0 ? 120 : 0, after: idx === lines.length - 1 ? 160 : 0 },
      shading: { type: ShadingType.CLEAR, fill: "EEF2F7" },
      indent: { left: 240, right: 240 },
      children: [new TextRun({ text: ln.length ? ln : " ", font: "Consolas", size: 16, color: NAVY })],
    }),
  );
}

function build(parsed) {
  const children = [titlePara(parsed.title)];
  parsed.intro.forEach((t) => children.push(introPara(t)));

  for (const b of parsed.blocks) {
    switch (b.type) {
      case "section":
        children.push(sectionPara(b.text));
        break;
      case "issue": {
        children.push(b.id || b.severity ? issueHeading(b.id, b.title, b.severity) : subHeadingPara(b.title));
        for (const s of b.stream) {
          if (s.kind === "ref") children.push(refPara(s.text));
          else children.push(labeledPara(s.label, s.text));
        }
        break;
      }
      case "note":
        children.push(notePara(b.text));
        break;
      case "labeled":
        children.push(labeledPara(b.item.label, b.item.text));
        break;
      case "para":
        children.push(new Paragraph({ spacing: { after: 80 }, children: [baseText(b.text)] }));
        break;
      case "code":
        children.push(...codeBlock(b.lines));
        break;
      case "rootcause":
        b.paragraphs.forEach((t) =>
          children.push(
            new Paragraph({
              spacing: { after: 120 },
              shading: { type: ShadingType.CLEAR, fill: "EEF2F7" },
              border: {
                top: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 6 },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 6 },
                left: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 6 },
                right: { style: BorderStyle.SINGLE, size: 4, color: NAVY, space: 6 },
              },
              children: [baseText(t)],
            }),
          ),
        );
        break;
    }
  }

  return new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [
      {
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1247, right: 1247 } },
        },
        children,
      },
    ],
  });
}

// ---------- main ----------
const md = readFileSync(SRC, "utf8");
const parsed = parse(md);
const issues = parsed.blocks.filter((b) => b.type === "issue");
console.log(`Parsed "${parsed.title}"`);
console.log(`  sections : ${docSections(parsed).length}`);
console.log(`  issues   : ${issues.length}`);
for (const it of issues) console.log(`   - ${it.id || "~~"}${it.severity ? ` [${it.severity}]` : ""} ${it.title}`);

function docSections(parsed) {
  return parsed.blocks.filter((b) => b.type === "section");
}

const buf = await Packer.toBuffer(build(parsed));
writeFileSync(OUT, buf);
console.log(`\n✔ Wrote ${path.relative(ROOT, OUT)} (${(buf.length / 1024).toFixed(1)} KB)`);
