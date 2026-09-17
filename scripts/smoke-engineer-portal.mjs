#!/usr/bin/env node
/**
 * smoke-engineer-portal.mjs — prove an engineer login actually reaches the
 * engineer portal in a real browser, with no 4xx/5xx and no console errors.
 *
 * WHY: a passing password grant is not "on the portal". The 2026-09-18 outage
 * was found with scripts/diagnose-portal-logins.mjs (that one is read-only and
 * hits GoTrue directly); this one is the UI-level companion used when
 * onboarding engineers, because the app gates engineers through a redirect.
 *
 * HOW THE REDIRECT WORKS (do not "fix" the wait):
 *   /auth -> /dashboard -> /eng. The dashboard loads first and the engineer
 *   gate then bounces to /eng. Observed cold-cache hops take 2.5-7s, and a
 *   short wait makes a healthy engineer look like they landed on /dashboard.
 *   The default 20s wait is deliberate.
 *
 * USAGE
 *   node scripts/smoke-engineer-portal.mjs                       # all linked engineers, prompts nothing
 *   node scripts/smoke-engineer-portal.mjs https://localhost:8080 desraj@eng.prokonhitech.com:Prokon@1234 pv@eng.prokonhitech.com:...
 *
 * Requires a running app (default target https://localhost:8080 — the Vite dev
 * server is HTTPS because vite.config.ts loads @vitejs/plugin-basic-ssl) and an
 * installed Playwright browser (`npx playwright install chromium`).
 * Exit code 1 = at least one engineer failed to reach /eng.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith("http")) ?? "https://localhost:8080").replace(/\/$/, "");
const creds = args.filter((a) => a.includes("@")).map((a) => {
  const i = a.indexOf(":");
  return { email: a.slice(0, i), password: a.slice(i + 1) };
});

let targets = creds;
if (!targets.length) {
  // No creds given: smoke every employee that has a portal login linked.
  const env = Object.fromEntries(
    readFileSync(resolve(root, ".env"), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
  );
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/employees?select=name,email,auth_user_id&auth_user_id=not.is.null&email=not.is.null`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  const linked = await res.json();
  console.log(`${linked.length} employee(s) have a portal login linked — pass EMAIL:PASSWORD pairs to actually sign in:\n  ${linked.map((e) => e.email).join("\n  ")}\n`);
  process.exit(0);
}

const browser = await chromium.launch();
let failures = 0;

for (const { email, password } of targets) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const bad = [];
  const errs = [];
  page.on("response", (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "").slice(0, 90)}`);
  });
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); });
  page.on("pageerror", (e) => errs.push(`pageerror: ${String(e.message).slice(0, 140)}`));

  let verdict = "FAIL";
  let detail = "";
  try {
    await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname.startsWith("/eng"), { timeout: 30000 });
    await page.waitForTimeout(3000);          // let the portal's own queries settle
    const path = new URL(page.url()).pathname;
    const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const reachedPortal = path.startsWith("/eng") && /ENGINEER PORTAL/i.test(text);
    verdict = reachedPortal && !bad.length && !errs.length ? "PASS" : "FAIL";
    detail = `-> ${path} | portal rendered=${reachedPortal} | failed=${bad.length ? bad.join(", ") : "none"} | console=${errs.length ? errs.join(" | ") : "none"}`;
  } catch (e) {
    detail = `-> ${page.url()} | ${String(e.message).split("\n")[0].slice(0, 120)} | failed=${bad.join(", ") || "none"}`;
  }
  if (verdict === "FAIL") failures++;
  console.log(`${verdict}  ${email.padEnd(32)} ${detail}`);
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures}/${targets.length} engineer(s) did NOT reach the portal` : `\nall ${targets.length} engineer(s) reached the portal cleanly`);
process.exit(failures ? 1 : 0);
