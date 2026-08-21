#!/usr/bin/env node
/**
 * set-passwords.mjs
 * ---------------------------------------------------------------------------
 * Sets passwords on existing auth.users and records them in
 * public.password_history (hash = sha256(userId:password), same format the
 * app's admin-user management uses, kept to the last 5 per user).
 *
 * Input: JSON on stdin -> { "<email>": "<password>", ... }
 *   echo '{"gaurav@prokonhitech.com":"MyP@ss123"}' | node scripts/set-passwords.mjs
 *
 * Plaintext passwords are only ever in memory / stdin — never written to disk,
 * never logged. They are stored in the DB as bcrypt (auth.users) + sha256
 * salted-by-userId (password_history).
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env (or env vars).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  try {
    const txt = readFileSync(resolve(root, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* .env optional */ }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE || !ANON) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / publishable key (check .env)');
  process.exit(1);
}

const headers = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
};

async function api(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body?.message || body?.msg || text)}`);
  }
  return body;
}

// Read input
const input = readFileSync(0, 'utf8').trim();
let assignments;
try {
  assignments = JSON.parse(input);
} catch {
  console.error('stdin must be JSON: {"email":"password", ...}');
  process.exit(1);
}

const entries = Object.entries(assignments);
if (!entries.length) { console.error('No passwords provided'); process.exit(1); }

for (const [email, password] of entries) {
  try {
    console.log(`\n--- ${email} ---`);
    if (typeof password !== 'string' || password.length < 8) {
      console.log('  SKIPPED: password must be a string of at least 8 chars');
      continue;
    }

    // 1. Find the auth user (GoTrue's ?filter= param is unreliable; list + match)
    const list = await api('/auth/v1/admin/users?per_page=200');
    const user = (list.users || []).find((u) => u.email === email);
    if (!user) { console.log('  SKIPPED: no auth user with this email'); continue; }

    // 2. Set the password (GoTrue hashes it -> auth.users.encrypted_password)
    await api(`/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
    console.log(`  password set for ${user.id}`);

    // 3. Record in password_history (same format as the app: sha256(userId:password))
    const hash = createHash('sha256').update(`${user.id}:${password}`).digest('hex');
    await api('/rest/v1/password_history', {
      method: 'POST',
      body: JSON.stringify({ user_id: user.id, password_hash: hash }),
    });
    // trim history to last 5 (same as app)
    const hist = await api(`/rest/v1/password_history?user_id=eq.${user.id}&select=id&order=created_at.desc`);
    const extras = hist.slice(5);
    if (extras.length) {
      await api(`/rest/v1/password_history?id=in.(${extras.map((r) => r.id).join(',')})`, { method: 'DELETE' });
    }
    console.log('  password_history recorded (last 5 kept)');

    // 4. Verify by actually signing in
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      console.log('  VERIFIED: login works');
    } else {
      const err = await res.json();
      console.log(`  VERIFY FAILED: ${res.status} ${err.error_description || err.msg || ''}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
}
console.log('\nDone. Passwords are stored hashed in auth.users + password_history.');