import { supabase } from "@/integrations/supabase/client";

let cached: { userId: string; name: string } | null = null;

/**
 * Return a human-friendly display name for the currently logged-in user.
 * Prefers app_users.name, then app_users.email, then auth email/metadata.
 * Result is cached per session and reset on sign-in/out via resetCurrentUserCache.
 */
export async function getCurrentUserName(): Promise<string> {
  try {
    const { data } = await supabase.auth.getUser();
    const u = data.user;
    if (!u) return "";
    if (cached && cached.userId === u.id) return cached.name;
    let name = "";
    const { data: au } = await supabase
      .from("app_users")
      .select("name,email")
      .eq("user_id", u.id)
      .maybeSingle();
    if (au) {
      const row = au as { name?: string | null; email?: string | null };
      name = (row.name || row.email || "").trim();
    }
    if (!name) {
      const meta = (u.user_metadata || {}) as { name?: string; full_name?: string };
      name = (meta.name || meta.full_name || u.email || "").trim();
    }
    cached = { userId: u.id, name };
    return name;
  } catch {
    return "";
  }
}

export function resetCurrentUserCache() {
  cached = null;
}