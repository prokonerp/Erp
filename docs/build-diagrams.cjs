// Builds docs/architecture-diagrams.html from docs/ARCHITECTURE.md
// Extracts every ```mermaid block into a printable, browser-renderable page.
const fs = require("fs");
const path = require("path");

const mdPath = path.join(__dirname, "..", "docs", "ARCHITECTURE.md");
const outPath = path.join(__dirname, "..", "docs", "architecture-diagrams.html");

const md = fs.readFileSync(mdPath, "utf8");
const lines = md.split("\n");

const blocks = [];
let current = null;
let lastHeading = "";

for (const line of lines) {
  const heading = line.match(/^(#{1,3})\s+(.*)$/);
  if (heading) lastHeading = heading[2].trim();
  if (/^```mermaid\s*$/.test(line)) {
    current = { title: lastHeading, lines: [] };
    continue;
  }
  if (current && /^```\s*$/.test(line)) {
    blocks.push({ title: current.title, code: current.lines.join("\n") });
    current = null;
    continue;
  }
  if (current) current.lines.push(line);
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const sections = blocks
  .map(
    (b, i) => `
  <section class="card">
    <h2>${b.title || `Diagram ${i + 1}`}</h2>
    <pre class="mermaid">${esc(b.code)}</pre>
  </section>`
  )
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Prokon ERP — Architecture Diagrams</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         margin: 0 auto; padding: 24px; max-width: 1200px; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.05rem; margin: 0 0 12px; color: #555; }
  .card { border: 1px solid #e2e2e2; border-radius: 12px; padding: 18px 22px;
          margin: 18px 0; background: #fff; overflow-x: auto; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  @media (prefers-color-scheme: dark) {
    .card { background: #161618; border-color: #333; } h2 { color: #bbb; }
  }
  .meta { color: #888; font-size: .85rem; margin-bottom: 8px; }
  button { padding: 8px 14px; border-radius: 8px; border: 1px solid #ccc;
           background: transparent; cursor: pointer; font-size: .85rem; }
</style>
</head>
<body>
  <h1>Prokon ERP — Architecture Diagrams</h1>
  <p class="meta">Generated from docs/ARCHITECTURE.md · ${blocks.length} diagrams ·
     rendered live via Mermaid CDN (internet required once per view)</p>
  <button onclick="window.print()">Print / Save as PDF</button>
${sections}
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({
    startOnLoad: true,
    securityLevel: "loose",
    theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
    flowchart: { htmlLabels: true, curve: "basis" },
    sequence: { mirrorActors: false },
  });
</script>
</body>
</html>
`;

fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath} with ${blocks.length} diagrams`);
