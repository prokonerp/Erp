import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys } from "@/lib/queryKeys";
import { istDateKey } from "@/lib/time";

export type LiveEngineer = {
  employee_id: string;
  name: string | null;
  phone: string | null;
  on_duty: boolean;
  last_lat: number | null;
  last_long: number | null;
  last_accuracy_m: number | null;
  last_seen_at: string | null;
  updated_at: string | null;
};

export type RoutePing = {
  lat: number;
  long: number;
  accuracy_m: number | null;
  captured_at: string;
  source: string | null;
  ticket_id: string | null;
};

export type DayMovement = {
  distance_m: number | null;
  stop_count: number | null;
  sites: Array<{
    v?: number;
    ticket_id: string | null;
    arrived_at: string | null;
    departed_at: string | null;
    lat: number | null;
    long: number | null;
  }>;
  rolled_up_at: string | null;
};

export type MovementWarning = { section: string; message: string };

function errMessage(e: unknown): string {
  const err = e as { message?: unknown } | null;
  return typeof err?.message === "string" && err.message !== "" ? err.message : "failed";
}

/**
 * Missing-table hint (mirrors useEngineerAdmin.hintFor): the movement
 * tables only exist after migration 20260928000001 is applied.
 */
function hintFor(e: unknown): string {
  const { message, code } = (() => {
    const err = e as { message?: unknown; code?: unknown } | null;
    return {
      message: typeof err?.message === "string" ? err.message : "",
      code: typeof err?.code === "string" ? err.code : undefined,
    };
  })();
  if (code === "42703" || code === "42P01" || /does not exist|schema cache/i.test(message)) {
    return "not set up yet — ask admin to run migration 20260928000001";
  }
  return message || "failed";
}

/**
 * Dedicated realtime subscription for engineer_live_status with the same
 * 250ms debounce + channel cleanup as useRealtimeRefetch — which cannot be
 * reused here because its table param is the closed ArchivableTable union.
 */
export function useEngineerLiveRefetch(refetch: () => void) {
  const cb = useRef(refetch);
  cb.current = refetch;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`rt-engineer-live-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "engineer_live_status" },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => cb.current(), 250);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);
}

/** "last seen X ago" — never a live dot. Future timestamps clamp to "just now". */
export function formatLastSeen(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

async function fetchLiveRoster(): Promise<LiveEngineer[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- location tables pending generated types
  const { data, error } = await (supabase as any)
    .from("engineer_live_status")
    .select(
      "employee_id, on_duty, last_lat, last_long, last_accuracy_m, last_seen_at, updated_at, employees(id, name, phone)",
    )
    .order("updated_at", { ascending: false });
  if (error) throw new Error(hintFor(error));
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const emp = r.employees as { name?: string | null; phone?: string | null } | null;
    return {
      employee_id: r.employee_id as string,
      name: emp?.name ?? null,
      phone: emp?.phone ?? null,
      on_duty: !!r.on_duty,
      last_lat: (r.last_lat as number | null) ?? null,
      last_long: (r.last_long as number | null) ?? null,
      last_accuracy_m: (r.last_accuracy_m as number | null) ?? null,
      last_seen_at: (r.last_seen_at as string | null) ?? null,
      updated_at: (r.updated_at as string | null) ?? null,
    };
  });
}

/**
 * Live on-duty roster. Realtime-first with a 30s polling fallback + focus
 * refetch (socket drops must not freeze the board). Sections degrade
 * independently — a failed read warns, never blanks.
 */
export function useLiveRoster() {
  const [warnings, setWarnings] = useState<MovementWarning[]>([]);
  const pushWarning = useCallback((section: string, message: string) => {
    setWarnings((w) => (w.some((x) => x.section === section) ? w : [...w, { section, message }]));
  }, []);

  const query = useQuery({
    queryKey: adminEngKeys.movement(),
    queryFn: async () => {
      try {
        return await fetchLiveRoster();
      } catch (e) {
        pushWarning("live-roster", errMessage(e));
        return [] as LiveEngineer[];
      }
    },
    refetchInterval: 30_000,
  });

  useEngineerLiveRefetch(query.refetch);

  useEffect(() => {
    const onFocus = () => void query.refetch();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...query, warnings };
}

/** UTC bounds for one IST calendar day (IST has no DST — fixed +05:30). */
export function istDayBounds(day: string): { start: string; end: string } {
  const startMs = Date.parse(`${day}T00:00:00+05:30`);
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 86_400_000).toISOString(),
  };
}

async function fetchDayRoute(
  employeeId: string,
  day: string,
): Promise<{ pings: RoutePing[]; movement: DayMovement | null }> {
  const { start, end } = istDayBounds(day);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- location tables pending generated types
  const { data: pings, error: pingErr } = await (supabase as any)
    .from("engineer_location_pings")
    .select("lat, long, accuracy_m, captured_at, source, ticket_id")
    .eq("employee_id", employeeId)
    .gte("captured_at", start)
    .lt("captured_at", end)
    .order("captured_at", { ascending: true })
    .limit(2000);
  if (pingErr) throw new Error(hintFor(pingErr));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- location tables pending generated types
  const { data: movement, error: movErr } = await (supabase as any)
    .from("engineer_daily_movements")
    .select("distance_m, stop_count, sites, rolled_up_at")
    .eq("employee_id", employeeId)
    .eq("day", day)
    .maybeSingle();
  if (movErr) throw new Error(hintFor(movErr));
  return {
    pings: ((pings ?? []) as RoutePing[]).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.long),
    ),
    movement: (movement as DayMovement | null) ?? null,
  };
}

/** Per-engineer day route: raw pings (polyline) + rollup row (distance/stops). */
export function useEngineerDayRoute(employeeId: string | null, day: string = istDateKey()) {
  const [warnings, setWarnings] = useState<MovementWarning[]>([]);
  const pushWarning = useCallback((section: string, message: string) => {
    setWarnings((w) => (w.some((x) => x.section === section) ? w : [...w, { section, message }]));
  }, []);

  const query = useQuery({
    queryKey: adminEngKeys.dayRoute(employeeId, day),
    enabled: !!employeeId,
    queryFn: async () => {
      try {
        return await fetchDayRoute(employeeId as string, day);
      } catch (e) {
        pushWarning("day-route", errMessage(e));
        return { pings: [] as RoutePing[], movement: null as DayMovement | null };
      }
    },
  });

  return { ...query, warnings };
}
