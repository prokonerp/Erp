#!/usr/bin/env node
/**
 * Render the client proposal to PDF and export its diagrams to PNG.
 *
 *   node scripts/build-proposal.mjs
 *
 * Inputs : docs/proposal/API-Integration-and-Tally-Export.html
 * Outputs: docs/proposal/API-Integration-and-Tally-Export.pdf
 *          docs/proposal/assets/diagram-flow.png
 *          docs/proposal/assets/diagram-timeline.png
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "docs", "proposal");
const HTML = path.join(DIR, "API-Integration-and-Tally-Export.html");
const PDF = path.join(DIR, "API-Integration-and-Tally-Export.pdf");
const ASSETS = path.join(DIR, "assets");

mkdirSync(ASSETS, { recursive: true });

const browser = await chromium.launch();
// deviceScaleFactor 3 => element screenshots land at 3x for crisp print in Word.
const page = await browser.newPage({
  viewport: { width: 1240, height: 1754 },
  deviceScaleFactor: 3,
});
await page.goto(pathToFileURL(HTML).href, { waitUntil: "networkidle" });
await page.emulateMedia({ media: "print" });

// Puppeteer/Playwright render CSS mm pages accurately only when the CSS page
// size is honoured; @page { size: A4 } is declared in the document.
await page.pdf({
  path: PDF,
  printBackground: true,
  preferCSSPageSize: true,
});

// Diagrams for the .docx build — 3x for crisp print.
const svgs = await page.$$(".fig svg");
const names = ["diagram-flow.png", "diagram-timeline.png"];
for (let i = 0; i < svgs.length; i++) {
  const name = names[i] ?? `diagram-${i}.png`;
  const out = path.join(ASSETS, name);
  await svgs[i].screenshot({ path: out, scale: "device" });
  console.log(`  ${name}`);
}

// Report the page count of the produced PDF.
const { readFileSync } = await import("node:fs");
const buf = readFileSync(PDF);
const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log(`\nPDF : ${path.relative(ROOT, PDF)}  (${pages} page(s), ${(buf.length / 1024).toFixed(0)} KB)`);

await browser.close();
