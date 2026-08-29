#!/usr/bin/env node
/**
 * create-users.mjs
 * ---------------------------------------------------------------------------
 * Recreates the Prokon ERP users on the NEW Supabase project, preserving the
 * original user UUIDs, profile data, role assignments and module permissions
 * from the old project's public.app_users table.
 *
 * What it does:
 *   1. Creates auth.users entries via the GoTrue Admin API (custom UUIDs,
 *      email confirmed, NO password) — users then set their own password via
 *      the recovery links this script prints (or in-app "Forgot password").
 *   2. Inserts public.user_roles (admin for the two owner accounts, user for
 *      everyone).
 *   3. Inserts public.app_users rows with the exact values from the old DB
 *      (incl. per-user custom_permissions JSONB).
 *   4. Generates password-recovery links for every user (print only).
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (or env vars).
 * Usage:    node scripts/create-users.mjs
 * ---------------------------------------------------------------------------
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  try {
    const txt = readFileSync(resolve(root, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* .env optional if env vars are set */ }
}
loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (check .env)');
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
    const msg = body?.message || body?.msg || text || res.statusText;
    throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(msg)}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Users as they existed in the old project (source: public.app_users dump).
// role: 'Admin' | 'User' -> mapped onto the seeded app_roles by name.
// ---------------------------------------------------------------------------
const USERS = [
  {
    id: '1b7221a3-eb09-4266-bbb6-549aadb899ea',
    name: 'Gaurav Arora',
    email: 'gauravarora97@gmail.com',
    phone: '9818682682',
    role: 'Admin',
    status: 'active',
    custom_permissions: null,
    created_at: '2026-06-13T15:27:35.201423+00:00',
    updated_at: '2026-08-20T13:46:12.406703+00:00',
    password_changed_at: '2026-08-07T17:30:37.948+00:00',
    must_change_password: false,
    last_login: '2026-08-15T13:17:57.492937+00:00',
    last_activity: '2026-08-20T13:46:12.406703+00:00',
    last_logout: '2026-08-11T12:14:38.085246+00:00',
    login_count: 37,
  },
  {
    id: '5f36e99e-c04f-4cb7-b4f9-b37aafe8631f',
    name: 'Gaurav Arora',
    email: 'gaurav@prokonhitech.com',
    phone: '9818682682',
    role: 'Admin',
    status: 'active',
    custom_permissions: null,
    created_at: '2026-07-01T04:04:01.919024+00:00',
    updated_at: '2026-08-21T11:17:27.424427+00:00',
    password_changed_at: '2026-08-16T14:09:57.898+00:00',
    must_change_password: false,
    last_login: '2026-08-21T11:17:27.030505+00:00',
    last_activity: '2026-08-21T11:17:27.424427+00:00',
    last_logout: '2026-08-21T09:55:56.845074+00:00',
    login_count: 3379,
  },
  {
    id: '7f9a3348-4de8-4b0b-85da-8e226b64de16',
    name: 'Jayson',
    email: 'services@prokonhitech.com',
    phone: '8800890483',
    role: 'User',
    status: 'active',
    custom_permissions: {
      amc: { can_create: false, can_delete: false, can_edit: false, can_read: false, enable_access: false },
      customers: { can_create: true, can_delete: false, can_edit: true, can_read: true, enable_access: true, can_export: false, can_import: false },
      gatepass: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      ims: { can_create: true, can_delete: false, can_edit: true, can_export: false, can_import: false, can_read: true, enable_access: true },
      indent: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      po: { can_create: false, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: false, enable_access: false },
      quotations: { can_create: false, can_delete: false, can_edit: false, can_read: false, enable_access: false },
      sales: { can_create: false, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: false, enable_access: false },
      tickets: { can_create: true, can_delete: false, can_edit: true, can_export: false, can_import: false, can_read: true, enable_access: true },
    },
    created_at: '2026-06-13T15:24:43.355032+00:00',
    updated_at: '2026-08-21T11:05:27.830282+00:00',
    password_changed_at: '2026-08-17T05:29:30.356+00:00',
    must_change_password: false,
    last_login: '2026-08-21T11:05:27.485118+00:00',
    last_activity: '2026-08-21T11:05:27.830282+00:00',
    last_logout: '2026-08-21T08:18:16.712117+00:00',
    login_count: 10305,
  },
  {
    id: '91435180-5857-4d3a-bfd2-63fc8c85368a',
    name: 'Kavita Basel',
    email: 'support@prokonhitech.com',
    phone: '9971922682',
    role: 'User',
    status: 'inactive',
    custom_permissions: {
      amc: { can_create: true, can_delete: false, can_edit: true, can_read: true, enable_access: true },
      customers: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      gatepass: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      general_dc: { can_create: true, can_delete: false, can_edit: true, can_export: false, can_import: false, can_read: true, enable_access: true },
      ims: { can_create: false, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      indent: { can_create: false, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      po: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      products: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      quotations: { can_create: true, can_delete: false, can_edit: true, can_read: true, enable_access: true },
      reports: { can_create: false, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      sales: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      tickets: { can_create: true, can_delete: false, can_edit: true, can_export: false, can_import: false, can_read: true, enable_access: true },
    },
    created_at: '2026-06-13T15:25:59.57454+00:00',
    updated_at: '2026-08-21T10:47:30.331518+00:00',
    password_changed_at: '2026-07-26T18:35:34.502+00:00',
    must_change_password: false,
    last_login: '2026-08-21T10:04:45.326095+00:00',
    last_activity: '2026-08-21T10:17:15.312776+00:00',
    last_logout: '2026-08-21T10:47:30.331518+00:00',
    login_count: 1636,
  },
  {
    id: 'b3d14175-b29a-42c1-9445-feaa3b87ef49',
    name: 'Aarti Parashar',
    email: 'account@prokonhitech.com',
    phone: '8527082682',
    role: 'User',
    status: 'active',
    custom_permissions: {
      amc: { can_create: false, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: false, enable_access: false },
      customers: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      general_dc: { can_create: true, can_delete: false, can_edit: true, can_export: false, can_import: false, can_read: true, enable_access: true },
      po: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      products: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      sales: { can_create: true, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
      tickets: { can_create: false, can_delete: false, can_edit: false, can_export: false, can_import: false, can_read: true, enable_access: true },
    },
    created_at: '2026-07-17T10:21:45.205461+00:00',
    updated_at: '2026-08-20T04:47:22.260569+00:00',
    password_changed_at: '2026-07-17T10:21:45.057+00:00',
    must_change_password: false,
    last_login: '2026-08-14T09:36:40.083701+00:00',
    last_activity: '2026-08-20T04:47:22.260569+00:00',
    last_logout: '2026-08-14T08:55:37.671294+00:00',
    login_count: 29,
  },
  {
    id: 'c02d6a89-4cb0-4932-b85f-b94a560787fb',
    name: 'Test Staff',
    email: 'test-staff-705483@prokonhitech.com',
    phone: null,
    role: 'User',
    status: 'active',
    custom_permissions: null,
    created_at: '2026-08-19T11:14:29.897323+00:00',
    updated_at: '2026-08-19T11:14:40.497749+00:00',
    password_changed_at: '2026-08-19T11:14:29.769+00:00',
    must_change_password: false,
    last_login: '2026-08-19T11:14:38.885042+00:00',
    last_activity: '2026-08-19T11:14:40.497749+00:00',
    last_logout: null,
    login_count: 3,
  },
];

async function main() {
  console.log(`Target: ${SUPABASE_URL}\n`);

  // 1. Resolve app_roles by name (Admin / User) on the new project
  const roles = await api('/rest/v1/app_roles?select=id,name', { headers: { Prefer: 'return=representation' } });
  const roleId = Object.fromEntries(roles.map((r) => [r.name, r.id]));
  console.log('app_roles resolved:', roleId);

  const results = [];
  for (const u of USERS) {
    console.log(`\n--- ${u.email} ---`);
    // a) auth.users (Admin API, custom UUID, no password yet)
    let authUser;
    try {
      authUser = await api('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          id: u.id,
          email: u.email,
          email_confirm: true,
          // no password -> account can only be used after password reset
        }),
      });
      console.log(`  auth.users created: ${authUser.id} (${authUser.email})`);
    } catch (e) {
      if (String(e.message).includes('already been registered') || String(e.message).includes('already exists')) {
        console.log(`  auth.users already exists, reusing`);
        authUser = { id: u.id, email: u.email };
      } else throw e;
    }

    // b) user_roles (admin gate + user role)
    const roleList = [u.role === 'Admin' ? 'admin' : 'user'];
    if (u.role === 'Admin') roleList.push('user'); // owners also have the plain user role
    for (const role of roleList) {
      try {
        await api('/rest/v1/user_roles', {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates' },
          body: JSON.stringify({ user_id: u.id, role }),
        });
      } catch (e) {
        console.log(`  user_roles ${role}: ${e.message}`);
      }
    }
    console.log(`  user_roles: admin=${u.role === 'Admin'}, user=true`);

    // c) app_users profile row (exact values from old DB)
    try {
      await api('/rest/v1/app_users', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          user_id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone || null,
          role_id: roleId[u.role],
          status: u.status,
          custom_permissions: u.custom_permissions,
          created_at: u.created_at,
          updated_at: u.updated_at,
          password_changed_at: u.password_changed_at,
          must_change_password: u.must_change_password,
          last_login: u.last_login,
          last_activity: u.last_activity,
          last_logout: u.last_logout,
          login_count: u.login_count,
        }),
      });
      console.log(`  app_users profile inserted (role_id=${roleId[u.role]})`);
    } catch (e) {
      console.log(`  app_users: ${e.message}`);
    }

    // d) recovery link
    try {
      const link = await api('/auth/v1/admin/generate_link', {
        method: 'POST',
        body: JSON.stringify({ type: 'recovery', email: u.email }),
      });
      results.push({ email: u.email, name: u.name, action_link: link.action_link });
      console.log(`  recovery link generated`);
    } catch (e) {
      console.log(`  recovery link: ${e.message}`);
    }
  }

  console.log('\n\n==========================================');
  console.log('PASSWORD RECOVERY LINKS (send to each user)');
  console.log('==========================================');
  for (const r of results) {
    console.log(`\n${r.name} <${r.email}>:\n  ${r.action_link}`);
  }
  console.log('\nNOTE: recovery links expire (default 1 hour). If they expire,');
  console.log('users can use the in-app "Forgot password" flow instead, or re-run');
  console.log('this script to regenerate. Ensure Auth > URL Configuration > Site');
  console.log('URL points to the Vercel app before sending these links.');
}

main().catch((e) => { console.error('\nFATAL:', e.message); process.exit(1); });