#!/usr/bin/env node
/**
 * audit-eng-present.mjs — marks attendance through the real UI, then asserts
 * the PRESENT state copy and the one-time dialog copy, and sources any
 * failed request. Read-only apart from the attendance action itself.
 *
 * usage: node scripts/audit-eng-present.mjs <email> <password> [baseUrl]
 */
import { chromium } from "@playwright/test";
const [email, password, baseArg] = process.argv.slice(2);
const BASE = (baseArg ?? "https://localhost:8080").replace(/\/$/, "");
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 },
  permissions: ["geolocation"], geolocation: { latitude: 28.6139, longitude: 77.209, accuracy: 25 },
});
const page = await ctx.newPage();
const bad = [];
page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "").slice(0, 110)}`); });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 180)); });

await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.fill("#email", email); await page.fill("#password", password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => u.pathname.startsWith("/eng"), { timeout: 40000 });
await page.waitForTimeout(6000);

// Step 1: mark attendance — may open the one-time dialog first.
const mark = page.getByRole("button", { name: /Mark attendance/i }).first();
if (await mark.count()) {
  await mark.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const consentShown = /Mark your attendance/i.test(t);
  console.log(`one-time dialog shown: ${consentShown}`);
  if (consentShown) {
    console.log(`\n--- dialog text ---\n${(t.match(/Mark your attendance[\s\S]{0,320}/i) ?? [""])[0]}`);
    await page.getByRole("button", { name: /Agree and mark attendance/i }).first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(7000);
  }
}

await page.waitForTimeout(4000);
const afterText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
console.log(`\n--- after marking ---\n${afterText.slice(0, 480)}`);
console.log(`\nPresent pill visible : ${/\bPresent\b/.test(afterText)}`);
console.log(`End day control      : ${(await page.getByRole("button", { name: /End day/i }).count()) > 0}`);
for (const re of [/on duty/i, /off duty/i, /tracking/i, /start duty/i, /end duty/i, /visible to admins/i]) {
  if (re.test(afterText)) console.log(`LEAK: ${re}`);
}
console.log(`\nfailed requests: ${bad.length ? [...new Set(bad)].join(" | ") : "none"}`);
console.log(`console errors: ${errs.length ? [...new Set(errs)].slice(0, 4).join(" | ") : "none"}`);
await browser.close();
