import { createServerFn } from "@tanstack/react-start";
import { requireActiveUser, requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PASSWORD_EXPIRY_DAYS = 30;
const HISTORY_LIMIT = 5;

function validateStrong(pw: string): string | null {
  if (!pw || pw.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter";
  if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain a number";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password must contain a special character";
  return null;
}

/**
 * Password history is hashed in Postgres (pgcrypto `crypt` + per-hash bf salt)
 * and compared against the last HISTORY_LIMIT entries by security-definer SQL
 * functions. The TS layer deliberately never computes, stores or reads a hash —
 * the old client-side SHA-256 was both weak (unsalted, fast) and readable by
 * the very user it protected.
 */
async function recordPasswordHistory(supabaseAdmin: any, userId: string, pw: string) {
  const { error } = await supabaseAdmin.rpc("record_password_history", {
    p_user: userId,
    p_pw: pw,
  });
  // History is a reuse-guard only — never block the password change on it,
  // but log loudly so silent failures can't erode the policy.
  if (error) console.error("[password] failed to record history:", error.message);
}

/**
 * Marks a password as freshly changed for a user. `mustChange` drives
 * `must_change_password`: `false` for a self-service change, `true` when an
 * admin sets/creates the password so the user is forced to rotate it on first
 * use. Uses upsert so it works even
 * if the app_users row is missing (users created outside the app), and throws
 * on failure — a silently-failed flag update is what caused the forced-change
 * dialog to reappear on every login.
 */
async function markPasswordChanged(
  supabaseAdmin: any,
  userId: string,
  patch: Record<string, any> = {},
  mustChange = false,
) {
  const payload = {
    user_id: userId,
    password_changed_at: new Date().toISOString(),
    must_change_password: mustChange,
    ...patch,
  };
  const { data: existing } = await supabaseAdmin
    .from("app_users")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    const { error } = await supabaseAdmin
      .from("app_users")
      .update({
        password_changed_at: payload.password_changed_at,
        must_change_password: mustChange,
        ...patch,
      })
      .eq("user_id", userId);
    if (error) throw new Error(`Could not save password change date: ${error.message}`);
  } else {
    const { error } = await supabaseAdmin.from("app_users").upsert(payload);
    if (error) throw new Error(`Could not create profile row: ${error.message}`);
  }
}

/** Reuse check runs in SQL (`crypt(p_pw, stored_hash)`) over the last
 *  HISTORY_LIMIT hashes; the plaintext never leaves this request. */
async function isInHistory(supabaseAdmin: any, userId: string, pw: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("check_password_reuse", {
    p_user: userId,
    p_pw: pw,
  });
  if (error) {
    // Fail open, loudly: a broken reuse check must never make it impossible to
    // rotate a password — that would lock every user out of the application.
    console.error("[password] reuse check failed:", error.message);
    return false;
  }
  return data === true;
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const listAuthUsers = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    return {
      users: data.users.map((u) => ({
        id: u.id,
        email: u.email ?? null,
        phone: u.phone ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      })),
    };
  });

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator(
    (d: {
      email: string;
      password: string;
      name?: string;
      phone?: string;
      role_id?: string | null;
      status?: string;
      is_admin?: boolean;
      /** Force the user to rotate this password on first sign-in. Default true. */
      force_change?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.email) throw new Error("Email is required");
    const v = validateStrong(data.password);
    if (v) throw new Error(v);
    // An admin-chosen initial password is a shared secret — force a rotation
    // unless the caller explicitly opts out.
    const forceChange = data.force_change ?? true;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { name: data.name ?? null, phone: data.phone ?? null },
    });
    if (error || !created.user) throw new Error(error?.message ?? "Failed to create user");
    const uid = created.user.id;
    const { error: upErr } = await supabaseAdmin.from("app_users").upsert({
      user_id: uid,
      name: data.name ?? null,
      email: data.email,
      phone: data.phone ?? null,
      role_id: data.role_id ?? null,
      status: data.status ?? "active",
      password_changed_at: new Date().toISOString(),
      must_change_password: forceChange,
    });
    if (upErr) throw new Error(upErr.message);
    await markPasswordChanged(
      supabaseAdmin,
      uid,
      {
        name: data.name ?? null,
        email: data.email,
        phone: data.phone ?? null,
        role_id: data.role_id ?? null,
        status: data.status ?? "active",
      },
      forceChange,
    );
    await recordPasswordHistory(supabaseAdmin, uid, data.password);
    if (data.is_admin) {
      await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "admin" });
    }
    return { ok: true, user_id: uid };
  });

export const updateAppUser = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator(
    (d: {
      user_id: string;
      name?: string;
      phone?: string;
      role_id?: string | null;
      status?: string;
      custom_permissions?: any;
      is_admin?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { user_id: data.user_id };
    if (data.name !== undefined) patch.name = data.name;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.role_id !== undefined) patch.role_id = data.role_id;
    if (data.status !== undefined) patch.status = data.status;
    if (data.custom_permissions !== undefined) patch.custom_permissions = data.custom_permissions;
    const { error } = await supabaseAdmin.from("app_users").upsert(patch);
    if (error) throw new Error(error.message);
    if (data.is_admin === true) {
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: data.user_id, role: "admin" }, { onConflict: "user_id,role" });
    } else if (data.is_admin === false) {
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("role", "admin");
    }
    return { ok: true };
  });

export const setUserPassword = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator(
    (d: {
      user_id: string;
      password: string;
      /** Force the user to rotate this password on next sign-in. Default true. */
      force_change?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const v = validateStrong(data.password);
    if (v) throw new Error(v);
    // An admin now knows this password — force a rotation unless the caller
    // explicitly opts out.
    const forceChange = data.force_change ?? true;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (await isInHistory(supabaseAdmin, data.user_id, data.password)) {
      throw new Error(`New password cannot match any of the last ${HISTORY_LIMIT} passwords`);
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    await recordPasswordHistory(supabaseAdmin, data.user_id, data.password);
    await markPasswordChanged(supabaseAdmin, data.user_id, {}, forceChange);
    return { ok: true };
  });

export const deleteAppUser = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((d: { user_id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId) throw new Error("Cannot delete yourself");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Self-service password change ---------------- */
export const changeOwnPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { current_password: string; new_password: string }) => d)
  .handler(async ({ data, context }) => {
    const v = validateStrong(data.new_password);
    if (v) throw new Error(v);
    if (data.current_password === data.new_password) {
      throw new Error("New password cannot be the same as current password");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: au } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const email = au.user?.email;
    if (!email) throw new Error("Account email not found");
    const { createClient } = await import("@supabase/supabase-js");
    const checker = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    // Verify the current password by signing in. Map the REAL failure reason —
    // collapsing every error into "Current password is incorrect" made users
    // retry endlessly (rate limits looked like wrong-password errors).
    const { error: signErr } = await checker.auth.signInWithPassword({
      email,
      password: data.current_password,
    });
    if (signErr) {
      const msg = (signErr as any).message ?? "";
      const status = (signErr as any).status;
      if (status === 429 || /rate|too many/i.test(msg)) {
        throw new Error("Too many attempts. Please wait a minute and try again.");
      }
      if (/invalid login credentials|invalid_credentials/i.test(msg)) {
        throw new Error("Current password is incorrect");
      }
      if (/email not confirmed/i.test(msg)) {
        throw new Error("Account email is not confirmed; contact your administrator.");
      }
      throw new Error(`Could not verify current password: ${msg || "sign-in failed"}`);
    }
    if (await isInHistory(supabaseAdmin, context.userId, data.new_password)) {
      throw new Error(`New password cannot match any of the last ${HISTORY_LIMIT} passwords`);
    }
    // NOTE: an admin password update revokes all existing sessions for this
    // user — the client signs out cleanly right after this succeeds.
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.new_password,
    });
    if (error) throw new Error(error.message);
    await recordPasswordHistory(supabaseAdmin, context.userId, data.new_password);
    // Must never fail silently — a skipped update here re-triggers the forced
    // "password expired / must be changed" dialog on every login. This is the
    // only path that clears must_change_password (force_change: false).
    await markPasswordChanged(supabaseAdmin, context.userId, {}, false);
    return { ok: true };
  });

/* ---------------- Profile / password status for header ---------------- */
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: au } = await supabaseAdmin
      .from("app_users")
      .select("name,email,phone,role_id,status,password_changed_at,must_change_password")
      .eq("user_id", context.userId)
      .maybeSingle();
    const role = au?.role_id
      ? (await supabaseAdmin.from("app_roles").select("name").eq("id", au.role_id).maybeSingle()).data
      : null;
    const { data: ur } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const isAdmin = (ur ?? []).some((r: any) => r.role === "admin");
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const changedAt = au?.password_changed_at ? new Date(au.password_changed_at) : new Date();
    const ageMs = Date.now() - changedAt.getTime();
    const ageDays = Math.floor(ageMs / 86_400_000);
    const daysRemaining = PASSWORD_EXPIRY_DAYS - ageDays;
    return {
      user_id: context.userId,
      name: au?.name ?? (authUser.user?.user_metadata as any)?.name ?? null,
      email: au?.email ?? authUser.user?.email ?? null,
      phone: au?.phone ?? null,
      role_name: isAdmin ? "Admin" : role?.name ?? null,
      is_admin: isAdmin,
      last_sign_in_at: authUser.user?.last_sign_in_at ?? null,
      password_changed_at: changedAt.toISOString(),
      days_remaining: daysRemaining,
      expired: daysRemaining <= 0 || !!au?.must_change_password,
      must_change_password: !!au?.must_change_password,
    };
  });