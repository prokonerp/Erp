#!/usr/bin/env node
/**
 * audit-stale-refresh.mjs — measures what the app does when a browser holds a
 * refresh token the auth server no longer knows about (the reported console
 * error: 400 "Invalid Refresh Token: Refresh Token Not Found" from
 * /auth/v1/token?grant_type=refresh_token).
 *
 * Method: sign in, then replace ONLY the stored refresh_token with a dead one
 * and expire the access token, so the next app load MUST refresh. Then measure
 * whether the app recovers (signs out -> /auth) or keeps a zombie session.
 * Read-only otherwise.
 *
 * usage: node scripts/audit-stale-refresh.mjs <email> <password> [baseUrl]
 */
import { chromium } from "@playwright/test";

const [email, password, baseArg] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: node scripts/audit-stale-refresh.mjs <email> <password> [baseUrl]");
  process.exit(2);
}
const BASE = (baseArg ?? "https://localhost:8080").replace(/\/$/, "");
const browser = await chromium.launch();

const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.fill("#email", email);
await page.fill("#password", password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => u.pathname.startsWith("/eng"), { timeout: 40000 });
await page.waitForTimeout(4000);

const before = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
  const raw = key ? localStorage.getItem(key) : null;
  return { key, hasSession: !!raw };
});
console.log(`signed in (storage key contains auth-token: ${before.hasSession})`);

// Poison the refresh token + force the access token to look expired.
await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
  if (!key) return;
  const s = JSON.parse(localStorage.getItem(key));
  s.refresh_token = "dead-refresh-token-not-known-to-the-server";
  s.expires_at = 1; // 1970 — forces a refresh attempt on the next load
  localStorage.setItem(key, JSON.stringify(s));
});

const events = [];
page.on("console", (m) => events.push(`${m.type()}: ${m.text().slice(0, 170)}`));
page.on("pageerror", (e) => events.push(`pageerror: ${String(e.message).slice(0, 170)}`));
const tokenCalls = [];
page.on("response", (r) => {
  if (r.url().includes("/auth/v1/token")) tokenCalls.push(`${r.status()} ${r.url().split("?")[1] ?? ""}`);
});

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(15000);

const after = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
  let parsed = null;
  try {
    parsed = key ? JSON.parse(localStorage.getItem(key)) : null;
  } catch {
    /* ignore */
  }
  return {
    path: location.pathname,
    keyStillPresent: !!key,
    refreshTokenStillThere: !!(parsed && parsed.refresh_token),
    bodyStart: (document.body.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
  };
});

console.log(`\n--- after reloading with a dead refresh token ---`);
console.log(`final path                    : ${after.path}`);
console.log(`auth-token key still in storage: ${after.keyStillPresent}`);
console.log(`refresh_token still in storage : ${after.refreshTokenStillThere}`);
console.log(`/auth/v1/token calls           : ${tokenCalls.length ? tokenCalls.join(" | ") : "(none)"}`);
console.log(`on screen                      : ${after.bodyStart}`);

const recovered = after.path.startsWith("/auth") && !after.refreshTokenStillThere;
console.log(`\nverdict: ${recovered ? "RECOVERED — cleared the session and left /eng" : "NOT RECOVERED — zombie session persists"}`);

console.log(`\n--- relevant console events ---`);
for (const e of events.filter((x) => /auth|token|refresh|error|warn/i.test(x)).slice(-12)) console.log(e);

// ---------- case 2: the token dies mid-session, with NO reload ----------
// A reload makes the app re-run getSession(). This is the harder case: the
// user is sitting on a working screen when the background auto-refresh fails.
{
  console.log(`\n===== case 2: dead refresh token during a live session (no reload) =====`);
  const ctx2 = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
  });
  const page2 = await ctx2.newPage();
  await page2.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page2.fill("#email", email);
  await page2.fill("#password", password);
  await page2.click('button[type="submit"]');
  await page2.waitForURL((u) => u.pathname.startsWith("/eng"), { timeout: 40000 });
  await page2.waitForTimeout(4000);

  const events2 = [];
  page2.on("console", (m) => events2.push(`${m.type()}: ${m.text().slice(0, 150)}`));
  page2.on("pageerror", (e) => events2.push(`pageerror: ${String(e.message).slice(0, 150)}`));
  const calls2 = [];
  page2.on("response", (r) => {
    if (r.url().includes("/auth/v1/token")) calls2.push(`${r.status()} ${r.url().split("?")[1] ?? ""}`);
  });

  // Kill the refresh token but keep the session otherwise intact and in memory.
  await page2.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    if (!key) return;
    const s = JSON.parse(localStorage.getItem(key));
    s.refresh_token = "dead-refresh-token-not-known-to-the-server";
    s.expires_at = Math.floor(Date.now() / 1000) + 3; // force auto-refresh within seconds
    localStorage.setItem(key, JSON.stringify(s));
  });

  // Wait past expiry + the SDK's refresh tick, with no navigation at all.
  await page2.waitForTimeout(45000);

  const state2 = await page2.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    return { path: location.pathname, keyStillPresent: !!key };
  });
  console.log(`final path                     : ${state2.path}`);
  console.log(`auth-token key still in storage: ${state2.keyStillPresent}`);
  console.log(`/auth/v1/token calls           : ${calls2.length ? calls2.join(" | ") : "(none)"}`);
  const healed = state2.path.startsWith("/auth") && !state2.keyStillPresent;
  console.log(
    `verdict: ${healed ? "RECOVERED mid-session — signed out with no reload" : "STUCK on a dead session — no reload recovery"}`,
  );
  for (const e of events2.filter((x) => /auth|token|refresh|error|warn/i.test(x)).slice(-8)) console.log(e);
  await ctx2.close();
}

await browser.close();
process.exit(recovered ? 0 : 1);
