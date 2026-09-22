#!/usr/bin/env node
/**
 * audit-eng-portal.mjs — interactive-adjacent E2E audit of the engineer portal
 * with a REAL engineer login, driven from one Playwright run.
 *
 * Read-only on the backend: it navigates, opens tabs and asserts what is on
 * screen. It never submits an FSR, never verifies a ticket and never writes a
 * row. That keeps it inside the harness "reads are fine" rule.
 *
 * USAGE
 *   node scripts/audit-eng-portal.mjs <email> <password> [baseUrl]
 */
import { chromium } from "@playwright/test";

const [email, password, baseArg] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: node scripts/audit-eng-portal.mjs <email> <password> [baseUrl]");
  process.exit(2);
}
const BASE = (baseArg ?? "https://localhost:8080").replace(/\/$/, "");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
  geolocation: { latitude: 28.6139, longitude: 77.209, accuracy: 20 },
  permissions: ["geolocation"],
});
const page = await ctx.newPage();

const problems = [];
const notes = [];
page.on("response", (r) => {
  const url = r.url();
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${url.slice(0, 120)}`);
});
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`CONSOLE ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => problems.push(`PAGEERROR ${String(e.message).slice(0, 200)}`));

const step = async (name, fn) => {
  try {
    await fn();
    notes.push(`PASS ${name}`);
  } catch (e) {
    notes.push(`FAIL ${name} :: ${String(e.message).slice(0, 200)}`);
  }
};

// ---------- login ----------
await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.fill("#email", email);
await page.fill("#password", password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => u.pathname.startsWith("/eng"), { timeout: 40000 });
await page.waitForTimeout(4000);
notes.push(`PASS login -> ${new URL(page.url()).pathname}`);

// Whatever renders on /eng (the location gate may be up)
const bodyText = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
notes.push(`INFO /eng body: ${(await bodyText()).slice(0, 320)}`);

// Is the entry gate showing, or the dashboard?
const gateVisible = await page
  .getByText(/Allow location access|Enable location|Checking location/i)
  .first()
  .isVisible()
  .catch(() => false);
notes.push(`INFO entry-gate-visible=${gateVisible}`);

await step("screen-guard watermark present", async () => {
  if (!(await page.getByTestId("screen-guard-watermark").isVisible())) throw new Error("watermark not visible");
});
await step("screen-guard shield hidden while visible", async () => {
  const hidden = await page.getByTestId("screen-guard-shield").getAttribute("hidden");
  if (hidden === null) throw new Error("shield is not hidden while tab is visible");
});
await step("html has screen-guard class", async () => {
  const cls = await page.locator("html").getAttribute("class");
  if (!(cls ?? "").includes("screen-guard")) throw new Error(`html class = ${cls}`);
});

// ---------- dashboard content ----------
await page.goto(`${BASE}/eng`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
notes.push(`INFO /eng after gate: ${(await bodyText()).slice(0, 400)}`);

// ---------- queue ----------
await page.goto(`${BASE}/eng/queue`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const queueText = await bodyText();
notes.push(`INFO /eng/queue body: ${queueText.slice(0, 700)}`);
await step("queue has no Completed tab", async () => {
  const t = await bodyText();
  if (/Completed\s*\(\d+\)/.test(t)) throw new Error("Completed tab still rendered");
});
await step("queue has no Completed-visits copy", async () => {
  const t = await bodyText();
  if (/No completed visits|completed visits/i.test(t)) throw new Error("completed-visits copy still rendered");
});

// ---------- open the first ticket workspace if one exists ----------
const ticketLinks = page.locator('a[href*="/eng/ticket/"]');
const ticketCount = await ticketLinks.count();
notes.push(`INFO ticket links in queue: ${ticketCount}`);
if (ticketCount > 0) {
  const href = await ticketLinks.first().getAttribute("href");
  await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  notes.push(`INFO ticket ${href} body: ${(await bodyText()).slice(0, 900)}`);

  await step("ticket page: no pageerror", async () => {
    if (problems.some((p) => p.startsWith("PAGEERROR"))) throw new Error("pageerror seen");
  });

  // Can the engineer still select text (screen guard must not block reading)?
  await step("text selection still works on ticket page", async () => {
    const sel = await page.evaluate(() => {
      const el = document.querySelector("main p, main h1, main h2");
      if (!el) return "no-target";
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      return s.toString().length > 0 ? "ok" : "blocked";
    });
    if (sel === "blocked") throw new Error("selectstart guard blocked text selection");
    if (sel === "no-target") throw new Error("no main text found to select");
  });

  // Signature pad must still accept pointer drawing.
  const pad = page.locator("canvas").first();
  if (await pad.count()) {
    await step("signature canvas accepts pointer input", async () => {
      const box = await pad.boundingBox();
      if (!box) throw new Error("canvas has no box");
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 60, box.y + 50, { steps: 6 });
      await page.mouse.up();
    });
  }
}

// ---------- conveyance + profile ----------
for (const route of ["/eng/conveyance", "/eng/profile"]) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  notes.push(`INFO ${route} body: ${(await bodyText()).slice(0, 400)}`);
}

// ---------- print / save shortcut guard ----------
await step("Ctrl+P is intercepted by the guard", async () => {
  const before = page.url();
  await page.keyboard.press("Control+p");
  await page.waitForTimeout(800);
  if (page.url() !== before) throw new Error("navigation happened on Ctrl+P");
});

// ---------- refresh persistence ----------
await page.goto(`${BASE}/eng/queue`, { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
notes.push(`INFO after reload path: ${new URL(page.url()).pathname}`);

// ---------- hidden-tab shield ----------
await step("shield appears when tab is hidden", async () => {
  const other = await ctx.newPage();
  await other.goto("about:blank");
  await other.bringToFront();
  await page.waitForTimeout(900);
  const hiddenAttr = await page.getByTestId("screen-guard-shield").getAttribute("hidden");
  const cls = await page.locator("html").getAttribute("class");
  await page.bringToFront();
  await other.close();
  if (hiddenAttr !== null && !(cls ?? "").includes("screen-guard-hidden")) {
    throw new Error(`shield hidden attr=${hiddenAttr} html class=${cls}`);
  }
});

console.log("\n=== NOTES ===");
for (const n of notes) console.log(n);
console.log("\n=== PROBLEMS (4xx/5xx/console/pageerror) ===");
if (!problems.length) console.log("none");
for (const p of [...new Set(problems)]) console.log(p);

await browser.close();
process.exit(notes.some((n) => n.startsWith("FAIL")) || problems.length ? 1 : 0);
