#!/usr/bin/env node
/**
 * diagnose-portal-logins.mjs — READ-ONLY health check for Supabase Auth (GoTrue)
 * and the employee ↔ portal-login wiring behind the Prokon Erp portal.
 *
 * WHY THIS EXISTS
 *   2026-09-18: five engineer logins returned HTTP 500 on sign-in. Cause was a
 *   hand-written INSERT into auth.users (see scripts/provision-engineers.sql and
 *   supabase/repair_20260918_auth_users_null_columns.sql). The browser only says
 *   "Failed to load resource: 500", and the app shows a generic failure — this
 *   script names the exact failing layer and the exact GoTrue error message.
 *
 * USAGE
 *   node scripts/diagnose-portal-logins.mjs                      # wiring + row reads
 *   node scripts/diagnose-portal-logins.mjs desraj@eng.prokonhitech.com:Prokon@1234
 *   node scripts/diagnose-portal-logins.mjs --json
 *
 * READS ONLY. The only non-GET request is the password grant you ask for
 * explicitly on the command line (the same call the browser makes). No writes,
 * no schema changes, no admin mutations. Exit code 1 = at least one failure.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  try {
    const txt = readFileSync(resolve(root, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      if (line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (k && !(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* .env optional when env vars are set */
  }
}
loadEnv();

const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_ || !SERVICE) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (check .env)");
  process.exit(2);
}

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const credArg = argv.find((a) => !a.startsWith("--") && a.includes("@"));
const [credEmail, credPassword] = credArg ? credArg.split(/:(.+)/) : [];

const SR = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
const results = [];
const record = (check, target, ok, detail) => {
  results.push({ check, target, ok, detail });
  if (!asJson) console.log(`${ok ? "PASS" : "FAIL"}  ${check.padEnd(22)} ${target.padEnd(38)} ${detail ?? ""}`);
};

async function json(path, headers = SR) {
  const res = await fetch(`${URL_}${path}`, { headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

// 1) GoTrue list endpoint — this is what Admin → Users calls; it scans every row.
// per_page=200 forces a full scan of auth.users: a single undecodable row makes
// this return 500 (that was the 2026-09-18 signature), so keep it a full scan.
{
  const { status, body } = await json("/auth/v1/admin/users?per_page=200");
  record(
    "auth: list users",
    "/auth/v1/admin/users",
    status === 200,
    status === 200
      ? `${body?.users?.length ?? 0} row(s) returned`
      : `${status} ${body?.msg ?? JSON.stringify(body).slice(0, 120)}`,
  );
}

// 2) Per-employee: portal login linked? auth row readable?
const { status: empStatus, body: employees } = await json(
  "/rest/v1/employees?select=id,name,email,active,auth_user_id,role&order=name&limit=200",
);
if (empStatus !== 200) {
  record("db: employees", "/rest/v1/employees", false, `${empStatus}`);
} else {
  for (const e of employees) {
    if (!e.email) {
      if (e.auth_user_id) record("portal login", `${e.name} (no email)`, false, "linked but employee has no email");
      continue;
    }
    if (!e.auth_user_id) {
      record("portal login", `${e.name} <${e.email}>`, true, "no login yet (not linked)");
      continue;
    }
    const { status, body } = await json(`/auth/v1/admin/users/${e.auth_user_id}`);
    record(
      "auth: read user",
      `${e.name} <${e.email}>`,
      status === 200,
      status === 200
        ? "row decodes"
        : `${status} ${body?.msg ?? ""} — run supabase/repair_20260918_auth_users_null_columns.sql`,
    );
  }
}

// 3) Optional: the real password grant for one account (what the browser does).
if (credEmail) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: credEmail.trim(), password: credPassword }),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  record(
    "auth: sign-in",
    credEmail,
    res.status === 200,
    res.status === 200
      ? `session issued for ${body?.user?.id}`
      : `${res.status} ${body?.msg ?? body?.error_description ?? String(body).slice(0, 120)}`,
  );
}

const failed = results.filter((r) => !r.ok);
if (asJson) console.log(JSON.stringify({ failures: failed.length, results }, null, 2));
else console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILING` : ""}`);
process.exit(failed.length ? 1 : 0);
