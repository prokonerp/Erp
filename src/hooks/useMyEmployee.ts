import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";

/**
 * Read-only hook: engineer identity card for the Profile surface.
 *
 * Design anchor (doc comment only — no styling here):
 * design-system/prokon-erp/pages/engineer-portal.md §11 "Profile" —
 * single-column surface, identity card (name, role, contact) on the live
 * Navy `#1E3A5F` / glacier canvas tokens, skeleton on load.
 *
 * Resolution strategy (no writes), mirroring useMyCarriedPartsCount:
 *  1. Resolve auth user → employee record by email (active only, limit 1).
 *  2. Miss / error / no session → employee null (fail-soft, never throws).
 *     Callers render skeleton while loading, identity card when found,
 *     and a neutral fallback (initials avatar + email) when null.
 *
 * No realtime subscription. staleTime 30s, no polling (identity rarely changes).
 */

export type MyEmployee = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

/**
 * Pure helper — extracted for testability.
 * Multi-word name → first + last initials ("Aarav Sharma" → "AS").
 * Single-word name → its first letter. No usable name → first letter of
 * the auth email, uppercased. Nothing at all → "".
 */
export function resolveInitials(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  if (parts.length === 1 && parts[0].length > 0) {
    return parts[0][0].toUpperCase();
  }
  const ch = (email ?? "").trim()[0];
  return ch ? ch.toUpperCase() : "";
}

/**
 * Pure helper — extracted for testability.
 * Fail-soft row picker: any misshapen / empty input → null, never throws.
 */
export function pickEmployeeRow(rows: unknown): MyEmployee | null {
  try {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0] as Partial<MyEmployee> | null | undefined;
    if (!row || typeof row.id !== "string" || !row.id) return null;
    return {
      id: row.id,
      name: typeof row.name === "string" ? row.name : "",
      phone: typeof row.phone === "string" ? row.phone : null,
      email: typeof row.email === "string" ? row.email : null,
    };
  } catch {
    return null;
  }
}

export function useMyEmployee() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;

  const query = useQuery({
    queryKey: ["eng", "employee", uid] as const,
    enabled: !!uid && !!email,
    staleTime: 30_000,
    refetchInterval: false,
    queryFn: async (): Promise<MyEmployee | null> => {
      try {
        if (!email) return null;
        const { data: emps, error: empErr } = await supabase
          .from("employees")
          .select("id,name,phone,email")
          .eq("email", email)
          .eq("active", true)
          .limit(1);
        if (empErr) {
          console.error("[useMyEmployee]", empErr.message);
          return null;
        }
        return pickEmployeeRow(emps);
      } catch (err) {
        console.error("[useMyEmployee]", err instanceof Error ? err.message : err);
        return null;
      }
    },
  });

  const employee = query.data ?? null;

  return {
    employee,
    initials: resolveInitials(employee?.name, email),
    isLoading: query.isLoading,
    error: query.error,
  };
}
