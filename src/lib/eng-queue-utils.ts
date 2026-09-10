/**
 * Pure helpers for the engineer queue.
 * Extracted for testability — no React, no Supabase, no side effects.
 */

/** Priority sort weight: P1 → 1 … P5 → 5, unknown → 99 (bottom). */
export function priorityWeight(p: string | null | undefined): number {
  const map: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
  return map[(p || "").toUpperCase()] ?? 99;
}

/** True when `created_at` or `assigned_at` falls on today (IST-insensitive string comparison). */
export function isToday(iso: string | null | undefined, assignedAt?: string | null): boolean {
  if (!iso) return false;
  const today = new Date().toDateString();
  if (new Date(iso).toDateString() === today) return true;
  if (assignedAt && new Date(assignedAt).toDateString() === today) return true;
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
  const hrs = ms / 3_600_000;
  if (hrs < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  return `${Math.round(hrs / 24)}d`;
}
