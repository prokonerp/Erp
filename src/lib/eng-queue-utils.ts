/**
 * Pure helpers for the engineer queue.
 * Extracted for testability — no React, no Supabase, no side effects.
 */
import { APP_TIME_ZONE } from "@/lib/time";

/** Priority sort weight: P1 → 1 … P5 → 5, unknown → 99 (bottom). */
export function priorityWeight(p: string | null | undefined): number {
  const map: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
  return map[(p || "").toUpperCase()] ?? 99;
}

/** True when `created_at` or `assigned_at` falls on today (Asia/Kolkata calendar date). */
export function isToday(iso: string | null | undefined, assignedAt?: string | null): boolean {
  if (!iso) return false;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(new Date());
  if (fmt.format(new Date(iso)) === today) return true;
  if (assignedAt && fmt.format(new Date(assignedAt)) === today) return true;
  return false;
}

/** True when ticket is carry-forward (not today, not waiting for parts). */
export function isCarryForward(
  created_at: string,
  assigned_at: string | null | undefined,
  status: string,
): boolean {
  return !isToday(created_at, assigned_at) && status !== "Waiting for Parts";
}

/** Search predicate — returns true when any field contains the lowercase term. */
export function matchesSearch(term: string, fields: (string | null | undefined)[]): boolean {
  if (!term) return true;
  const lower = term.toLowerCase();
  return fields.some((f) => (f || "").toLowerCase().includes(lower));
}

/** Elapsed time human-readable string. */
export function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "Just now";
  const hrs = ms / 3_600_000;
  if (hrs < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  return `${Math.round(hrs / 24)}d`;
}

/**
 * wa.me deep link for a customer phone. Strips non-digits; prefixes 91 for
 * 10-digit Indian numbers (or a leading 0). Null when no usable digits.
 * Pure — unit-tested.
 */
export function whatsappUrl(phone: string | null | undefined): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `https://wa.me/${digits}`;
  // Already international (13-15 digits) — trust as-is.
  if (digits.length >= 13 && digits.length <= 15) return `https://wa.me/${digits}`;
  return digits.length >= 10 ? `https://wa.me/${digits}` : null;
}

/**
 * Mark directory entries with portal-login status.
 * `linkedIds` = employee ids with auth_user_id set (can actually sign in).
 */
export function attachLoginFlags<T extends { id: string }>(
  list: T[],
  linkedIds: Set<string>,
): (T & { hasLogin: boolean })[] {
  return list.map((e) => ({ ...e, hasLogin: linkedIds.has(e.id) }));
}

/** Portal engineers first, alphabetical within each group. Pure (no mutation). */
export function sortEngineersLoginFirst<T extends { name: string; hasLogin: boolean }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    if (a.hasLogin !== b.hasLogin) return a.hasLogin ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
