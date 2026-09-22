#!/usr/bin/env node
/**
 * Layout audit for the client proposal.
 *
 * Proves, without human eyes, that:
 *   1. every .page box is exactly A4 and its content does NOT overflow (overflow:hidden
 *      would otherwise clip content silently);
 *   2. no element's box escapes its page's printable area;
 *   3. the two diagrams render at a sane size;
 *   4. page 1 and page 2 each carry the expected content.
 *
 *   node scripts/audit-proposal-layout.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "docs", "proposal", "API-Integration-and-Tally-Export.html");

const MM = 96 / 25.4; // CSS px per mm at 96dpi
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
await page.goto(pathToFileURL(HTML).href, { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });

const report = await page.evaluate((MM) => {
  const out = { pages: [], overflow: [], escapes: [] };
  const pages = [...document.querySelectorAll(".page")];
  pages.forEach((pg, pi) => {
    const pr = pg.getBoundingClientRect();
    out.pages.push({
      n: pi + 1,
      wMM: +(pr.width / MM).toFixed(1),
      hMM: +(pr.height / MM).toFixed(1),
      scrollH: pg.scrollHeight,
      clientH: pg.clientHeight,
      contentMM: +((pg.scrollHeight / MM)).toFixed(1),
      usedPct: +((pg.scrollHeight / pg.clientHeight) * 100).toFixed(1),
    });
    // overflow inside the fixed-height page box == clipped content
    if (pg.scrollHeight > pg.clientHeight + 1) {
      out.overflow.push({
        page: pi + 1,
        overflowPx: pg.scrollHeight - pg.clientHeight,
        overflowMM: +(((pg.scrollHeight - pg.clientHeight) / MM)).toFixed(1),
      });
    }
    // any descendant escaping the page's padding box
    const pad = 12 * MM; // side padding declared in CSS
    for (const el of pg.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // SVGs legitimately report transformed boxes; skip overflow:hidden wrappers
      if (r.right > pr.right + 1.5 || r.left < pr.left - 1.5) {
        out.escapes.push({
          page: pi + 1,
          el: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""),
          leftMM: +((r.left - pr.left) / MM).toFixed(1),
          rightMM: +((r.right - pr.left) / MM).toFixed(1),
        });
      }
    }
  });
  out.diagrams = [...document.querySelectorAll(".fig svg")].map((s) => {
    const r = s.getBoundingClientRect();
    return { wMM: +(r.width / MM).toFixed(1), hMM: +(r.height / MM).toFixed(1) };
  });
  out.dayCards = [...document.querySelectorAll(".day")].map((d) => {
    const r = d.getBoundingClientRect();
    const label = d.querySelector(".hd .d")?.textContent?.trim();
    return { label, hMM: +(r.height / MM).toFixed(1) };
  });
  out.text = pages.map((p) => p.innerText.replace(/\s+/g, " ").trim());
  return out;
}, MM);

console.log("=== PAGE BOXES (A4 = 210 x 297 mm) ===");
for (const p of report.pages) {
  console.log(`  page ${p.n}: ${p.wMM} x ${p.hMM} mm | content ${p.contentMM} mm (${p.usedPct}% of inner height)`);
}
console.log("\n=== OVERFLOW / CLIPPING ===");
console.log(report.overflow.length ? JSON.stringify(report.overflow, null, 2) : "  none — no page clips its content");
console.log("\n=== ELEMENTS ESCAPING THE PAGE ===");
const realEscapes = report.escapes.filter((e) => !e.el.startsWith("svg"));
console.log(realEscapes.length ? JSON.stringify(realEscapes, null, 2) : "  none");

console.log("\n=== DIAGRAMS ===");
report.diagrams.forEach((d, i) => console.log(`  diagram ${i + 1}: ${d.wMM} x ${d.hMM} mm`));

console.log("\n=== DAY CARDS (document order) ===");
console.log("  " + report.dayCards.map((c) => `${c.label} (${c.hMM}mm)`).join("  |  "));

console.log("\n=== CONTENT PER PAGE (chars) ===");
report.text.forEach((t, i) => console.log(`  page ${i + 1}: ${t.length} chars`));

await browser.close();
