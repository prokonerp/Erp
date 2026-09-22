#!/usr/bin/env node
/**
 * audit-eng-copy.mjs — verifies the engineer portal shows ATTENDANCE language
 * and no duty/tracking/surveillance framing, while the underlying behaviour is
 * unchanged (the action still reaches the server).
 *
 * usage: node scripts/audit-eng-copy.mjs <email> <password> [baseUrl]
 */
import { chromium } from "@playwright/test";

const [email, password, baseArg] = await import("node:process").then((p) => p.argv.slice(2));
if (!email || !password) {
  console.error("usage: node scripts/audit-eng-copy.mjs <email> <password> [baseUrl]");
  process.exit(2);
}
const BASE = (baseArg ?? "https://localhost:8080").replace(/\/$/, "");

// Words the engineer must never see. Word-boundary matched so "End day" etc pass.
const FORBIDDEN = [
  /\bon duty\b/i,
  /\boff duty\b/i,
  /\bstart duty\b/i,
  /\bend duty\b/i,
  /\bduty tracking\b/i,
  /\btracking\b/i,
  /\bmonitor(ed|ing)?\b/i,
  /\bsurveil\w*/i,
  /\bvisible to admins?\b/i,
  /\bwe (record|track|watch)\b/i,
];
// Words that must be present — in the state that is actually on screen
// ("Mark attendance" when unmarked, "Present" when marked).
const REQUIRED = [/mark attendance/i, /present/i];

const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);

const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: { width: 390, height: 844 },
  permissions: ["geolocation"],
  geolocation: { latitude: 28.6139, longitude: 77.209, accuracy: 25 },
});
const page = await ctx.newPage();
const errs = [];
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text().slice(0, 160));
});
page.on("pageerror", (e) => errs.push(`pageerror: ${String(e.message).slice(0, 160)}`));

await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.fill("#email", email);
await page.fill("#password", password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => u.pathname.startsWith("/eng"), { timeout: 40000 });
await page.waitForTimeout(6000);

// Walk the portal and collect every visible string.
const seen = [];
for (const route of ["/eng", "/eng/queue", "/eng/conveyance", "/eng/profile"]) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  seen.push({ route, text });
}

const allText = seen.map((s) => `${s.route}\n${s.text}`).join("\n");
console.log("=== VISIBLE TEXT PER ROUTE ===");
for (const s of seen) console.log(`\n--- ${s.route} ---\n${s.text.slice(0, 700)}`);

const visibleDuty = await page
  .getByRole("button", { name: /Start duty|End duty/i })
  .count();
check("no Start duty / End duty buttons", visibleDuty === 0);

const hits = [];
for (const re of FORBIDDEN) {
  const m = allText.match(re);
  if (m) hits.push(`${re} -> "${m[0]}"`);
}
check("no duty/tracking/surveillance words on any /eng route", hits.length === 0, hits.join(" | "));

// "mark attendance" OR "present" — one of the two states must be on screen.
const stateful = /mark attendance/i.test(allText) || /present/i.test(allText);
check("attendance language present in the current state", stateful);

// The control has exactly two states, and they are mutually exclusive:
//   unmarked -> "Mark attendance" button
//   marked   -> "Present" pill + "End day" button
// Asserting only the unmarked state makes a healthy marked session look broken.
const markBtn = page.getByRole("button", { name: /Mark attendance/i }).first();
const hasMark = (await markBtn.count()) > 0;
const hasPresent = /\bPresent\b/.test(allText);
const hasEndDay = (await page.getByRole("button", { name: /End day/i }).count()) > 0;
check(
  "attendance control present in one of its two valid states",
  hasMark || (hasPresent && hasEndDay),
  hasMark ? "unmarked: 'Mark attendance'" : hasPresent && hasEndDay ? "marked: 'Present' + 'End day'" : "neither state found",
);

if (hasMark) {
  // Trigger the dialog by marking attendance if consent is missing; otherwise
  // the action runs. Either path must not use duty language.
  await markBtn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(3500);
  const overlayText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  const dialog = overlayText.match(/Mark your attendance[\s\S]{0,400}/i);
  if (dialog) {
    console.log(`\n--- consent / dialog text ---\n${dialog[0].slice(0, 400)}`);
    const bad = FORBIDDEN.filter((re) => re.test(dialog[0])).map(String);
    check("consent dialog has no duty/tracking language", bad.length === 0, bad.join(" | "));
  } else {
    check("marking attendance did not surface duty language", !FORBIDDEN.some((re) => re.test(overlayText)));
  }
  const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const stillDuty = FORBIDDEN.filter((re) => !/tracking/i.test(String(re))).filter((re) => re.test(after));
  check("no duty wording after attempting to mark attendance", stillDuty.length === 0, stillDuty.map(String).join(" | "));
}

check("no console/page errors across the walk", errs.length === 0, errs.slice(0, 3).join(" | "));

console.log("\n=== COPY VERIFICATION ===");
for (const r of results) console.log(r);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
