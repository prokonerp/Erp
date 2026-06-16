import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

async function hashPassword(userId: string, pw: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(`${userId}:${pw}`));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function recordPasswordHistory(supabaseAdmin: any, userId: string, pw: string) {
  const hash = await hashPassword(userId, pw);
  await supabaseAdmin.from("password_history").insert({ user_id: userId, password_hash: hash });
  const { data: extras } = await supabaseAdmin
    .from("password_history")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(HISTORY_LIMIT, HISTORY_LIMIT + 100);
  if (extras && extras.length) {
    await supabaseAdmin
      .from("password_history")
      .delete()
      .in("id", extras.map((r: any) => r.id));
  }
}

async function isInHistory(supabaseAdmin: any, userId: string, pw: string): Promise<boolean> {
  const hash = await hashPassword(userId, pw);
  const { data } = await supabaseAdmin
    .from("password_history")
    .select("password_hash")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  return (data ?? []).some((r: any) => r.password_hash === hash);
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      email: string;
      password: string;
      name?: string;
      phone?: string;
      role_id?: string | null;
      status?: string;
      is_admin?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!data.email) throw new Error("Email is required");
    const v = validateStrong(data.password);
    if (v) throw new Error(v);
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
      must_change_password: false,
    });
    if (upErr) throw new Error(upErr.message);
    await recordPasswordHistory(supabaseAdmin, uid, data.password);
    if (data.is_admin) {
      await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: "admin" });
    }
    return { ok: true, user_id: uid };
  });

export const updateAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { user_id: string; password: string }) => d)
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const v = validateStrong(data.password);
    if (v) throw new Error(v);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (await isInHistory(supabaseAdmin, data.user_id, data.password)) {
      throw new Error("New password cannot match any of the last 5 passwords");
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    await recordPasswordHistory(supabaseAdmin, data.user_id, data.password);
    await supabaseAdmin
      .from("app_users")
      .update({ password_changed_at: new Date().toISOString(), must_change_password: false })
      .eq("user_id", data.user_id);
    return { ok: true };
  });

export const deleteAppUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { error: signErr } = await checker.auth.signInWithPassword({
      email,
      password: data.current_password,
    });
    if (signErr) throw new Error("Current password is incorrect");
    if (await isInHistory(supabaseAdmin, context.userId, data.new_password)) {
      throw new Error("New password cannot match any of the last 5 passwords");
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.new_password,
    });
    if (error) throw new Error(error.message);
    await recordPasswordHistory(supabaseAdmin, context.userId, data.new_password);
    await supabaseAdmin
      .from("app_users")
      .update({
        password_changed_at: new Date().toISOString(),
        must_change_password: false,
      })
      .eq("user_id", context.userId);
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