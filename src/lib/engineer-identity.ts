// Single engineer-identity resolution policy for the whole app.
//
// Every engineer flow must answer "which employee row is this login?" the same
// way: exact auth_user_id link first, unique-email fallback for legacy rows,
// fail LOUD on ambiguity (never silently pick row[0]), fail CLOSED when
// unlinked. Before this module the policy was copy-pasted into 8 places that
// already disagreed (throw vs null vs row[0]), so the next auth change would
// fix some paths and miss others.
//
// Shape: the pure core (resolveEngineerIdentity, fully unit-tested) decides on
// already-fetched rows; two thin adapters fetch those rows — one for the
// browser Supabase client (hooks, routes, components), one for the
// service-role admin client (server functions, with the GoTrue email
// fallback). Call sites keep their own error mapping (queue throws,
// profile nulls) — only the lookup sequence is shared.
//
// Pure except for the injected clients: no env, no DOM. Safe to import from
// both client bundles and server functions.

import type { SupabaseClient } from "@supabase/supabase-js";

export type IdentityRow = { id: string; name: string | null } & Record<string, unknown>;

export type IdentityResult =
  | { status: "ok"; employee: IdentityRow }
  | { status: "not_linked" }
  | { status: "ambiguous"; count: number };

/** Pure policy: exact link wins, unique email falls back, dupes fail loud. */
export function resolveEngineerIdentity(
  byAuthId: IdentityRow | null,
  byEmail: IdentityRow[],
): IdentityResult {
  if (byAuthId) return { status: "ok", employee: byAuthId };
  if (byEmail.length === 1) return { status: "ok", employee: byEmail[0] };
  if (byEmail.length > 1) return { status: "ambiguous", count: byEmail.length };
  return { status: "not_linked" };
}

export class IdentityQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityQueryError";
  }
}

export type TicketAssignee = {
  assigned_employee_id: string | null;
  assigned_engineer_name: string | null;
};

/**
 * Server-side assignment gate shared by every engineer write path
 * (finalize, parts-sync, uploads, deletes, acknowledges).
 *
 * Returns null for admins (no employee identity needed). Otherwise resolves
 * the caller via the central identity policy and requires an FK match, or a
 * name match that is UNIQUE across active employees (same-name engineers
 * must never see each other's tickets). Throws fail-loud Forbidden errors;
 * the `action` noun ("finalize", "sync", …) is interpolated into them.
 */
export async function assertTicketAssignee(
  admin: SupabaseClient,
  opts: {
    userId: string;
    emailHint?: string | null;
    ticket: TicketAssignee;
    action: string;
  },
): Promise<{ id: string; name: string | null } | null> {
  const db = admin as unknown as {
    from: (table: string) => any;
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data: isAdmin, error: roleErr } = await db.rpc("has_role", {
    _user_id: opts.userId,
    _role: "admin",
  });
  if (roleErr) throw new Error(roleErr.message);
  if (isAdmin) return null;

  const deny = () =>
    new Error(`Forbidden: only an admin or the assigned engineer may ${opts.action}`);
  const identity = await fetchMyIdentityAdmin(admin, {
    userId: opts.userId,
    emailHint: opts.emailHint ?? null,
  });
  if (identity.status === "ambiguous") {
    throw new Error("Forbidden: multiple employee rows match your login. Contact admin.");
  }
  if (identity.status !== "ok") throw deny();
  const caller = identity.employee as { id: string; name: string | null };

  const row = opts.ticket;
  const fkMatch = !!row.assigned_employee_id && row.assigned_employee_id === caller.id;
  let nameMatch = false;
  if (!fkMatch) {
    const callerName = (caller.name ?? "").trim();
    if (
      callerName !== "" &&
      !!row.assigned_engineer_name &&
      row.assigned_engineer_name.trim().toLowerCase() === callerName.toLowerCase()
    ) {
      // Name equality alone is not enough: with duplicate names either
      // engineer would pass. Count matches — exactly one wins.
      const { data: sameNamed } = await db
        .from("employees")
        .select("id, name")
        .eq("active", true);
      const dupes = ((sameNamed ?? []) as { name?: string | null }[]).filter(
        (r) => (r.name ?? "").trim().toLowerCase() === callerName.toLowerCase(),
      );
      nameMatch = dupes.length === 1;
    }
  }
  if (!fkMatch && !nameMatch) throw deny();
  return caller;
}

/**
 * Browser-client adapter. A byAuthId query failure falls through to the
 * email path (transient-error resilience); a byEmail query failure throws
 * IdentityQueryError for the caller to map (throw vs null vs ignore).
 */
export async function fetchMyIdentity(
  client: SupabaseClient,
  opts: { authUid: string; email: string | null; columns?: string },
): Promise<IdentityResult> {
  const db = client as unknown as {
    from: (table: string) => any;
  };
  const columns = opts.columns ?? "id,name,phone";
  let byAuth: IdentityRow | null = null;
  try {
    const { data, error } = await db
      .from("employees")
      .select(columns)
      .eq("auth_user_id", opts.authUid)
      .eq("active", true)
      .maybeSingle();
    if (!error && data) byAuth = data as IdentityRow;
  } catch {
    // Fall through to the email path below.
  }
  let byEmail: IdentityRow[] = [];
  if (!byAuth && opts.email) {
    const { data, error } = await db
      .from("employees")
      .select(columns)
      .eq("email", opts.email)
      .eq("active", true)
      .limit(2);
    if (error) throw new IdentityQueryError(error.message);
    byEmail = (data ?? []) as IdentityRow[];
  }
  return resolveEngineerIdentity(byAuth, byEmail);
}

/**
 * Service-role adapter for server functions. Same policy; resolves the email
 * via the caller's hint first (skips the slow GoTrue admin lookup), then
 * falls back to supabaseAdmin.auth.admin.getUserById like before.
 */
export async function fetchMyIdentityAdmin(
  admin: SupabaseClient,
  opts: { userId: string; emailHint?: string | null; columns?: string },
): Promise<IdentityResult> {
  const db = admin as unknown as {
    from: (table: string) => any;
    auth: { admin: { getUserById: (id: string) => Promise<{ data: { user?: { email?: string | null } | null } }> } };
  };
  const columns = opts.columns ?? "id,name";
  try {
    const { data, error } = await db
      .from("employees")
      .select(columns)
      .eq("auth_user_id", opts.userId)
      .eq("active", true)
      .maybeSingle();
    if (!error && data) return { status: "ok", employee: data as IdentityRow };
  } catch {
    // Fall through to the email path below.
  }
  let email = opts.emailHint ?? null;
  if (!email) {
    const { data: authData } = await db.auth.admin.getUserById(opts.userId);
    email = authData?.user?.email ?? null;
  }
  if (!email) return { status: "not_linked" };
  const { data, error } = await db
    .from("employees")
    .select(columns)
    .eq("email", email)
    .eq("active", true)
    .limit(2);
  if (error) throw new IdentityQueryError(error.message);
  return resolveEngineerIdentity(null, (data ?? []) as IdentityRow[]);
}
