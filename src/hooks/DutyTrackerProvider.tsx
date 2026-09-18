import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DutyTrackerCtx,
  type DutyFailure,
  type DutyPerm,
  type DutyTrackerValue,
} from "@/hooks/dutyTrackerContext";
import { useServerFn } from "@tanstack/react-start";
import {
  CONSENT_REQUIRED,
  endDutySession,
  getMyLiveStatus,
  recordPings,
  startDutySession,
} from "@/lib/field-location.functions";
import {
  dedupeQueuedPings,
  shouldSendPing,
  type PingPoint,
  type QueuedPing,
} from "@/lib/field-location";
import { enqueuePing, newClientId, queueCount, readQueue, removeQueued } from "@/lib/duty-queue";

const LEADER_KEY = "eng-duty-leader";
const LEADER_TTL_MS = 12_000;
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_BATCH = 50;

/**
 * Single owner of the duty watch for the whole /eng shell. Mount once in
 * eng.tsx — header toggle, gate, and breadcrumbs all consume this context,
 * so two components never open two watches (per-tab leadership below
 * additionally ensures two TABS don't double-track).
 */
export function DutyTrackerProvider({ children }: { children: ReactNode }) {
  const startFn = useServerFn(startDutySession);
  const recordFn = useServerFn(recordPings);
  const endFn = useServerFn(endDutySession);
  const statusFn = useServerFn(getMyLiveStatus);

  const [onDuty, setOnDuty] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(true);
  const [queued, setQueued] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [overrideActive, setOverrideActive] = useState(false);
  const [permission, setPermission] = useState<DutyPerm>("checking");
  const [failure, setFailure] = useState<DutyFailure>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<PingPoint | null>(null);
  const flushingRef = useRef(false);
  const tabIdRef = useRef(newClientId());
  // Mirror async-safe snapshots for callbacks.
  const snapRef = useRef({ sessionId: null as string | null, onDuty: false });
  snapRef.current = { sessionId, onDuty };

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    flushingRef.current = true;
    try {
      const batch = dedupeQueuedPings(await readQueue()).slice(0, FLUSH_BATCH);
      if (batch.length === 0) {
        setQueued(await queueCount());
        return;
      }
      await recordFn({
        data: { session_id: snapRef.current.sessionId, pings: batch },
      });
      // Exactly-once: the server upsert is atomic per call (any failure
      // throws and drops nothing), so a success means the whole batch is
      // stored — duplicates collapse on client_ping_id server-side.
      await removeQueued(batch.map((p) => p.client_ping_id));
      setQueued(await queueCount());
      const newest = batch[batch.length - 1];
      // Monotonic: a delayed batch must never drag a fresher fix backwards.
      if (newest) {
        setLastSeenAt((prev) => {
          if (!prev) return newest.captured_at;
          const a = Date.parse(prev);
          const b = Date.parse(newest.captured_at);
          if (!Number.isFinite(b)) return prev;
          return !Number.isFinite(a) || b >= a ? newest.captured_at : prev;
        });
      }
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Sync failed — fixes stay queued");
    } finally {
      flushingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  type LiveStatusShape =
    | { linked: false; isAdmin: boolean }
    | {
        linked: true;
        employee_id: string;
        live: {
          on_duty: boolean;
          last_lat: number | null;
          last_long: number | null;
          last_accuracy_m: number | null;
          last_seen_at: string | null;
          session_id: string | null;
          updated_at: string;
        } | null;
        open_session: { id: string; started_at: string } | null;
        consented: boolean;
        override_active: boolean;
        tracking_enabled: boolean;
      };

  const stoppedRef = useRef(false);

  const applyStatus = useCallback((s: LiveStatusShape) => {
    if (!s.linked) {
      setOnDuty(false);
      setSessionId(null);
      return { consented: false, onDuty: false };
    }
    const duty = !!s.live?.on_duty && !!s.open_session;
    // Reaped elsewhere (another device, auto-close, reaper cron): stop the
    // local watch and say so — don't just flip the pill silently.
    if (snapRef.current.onDuty && !duty && !stoppedRef.current) {
      stopWatch();
      setLastError("Duty session ended (auto-closed or another device).");
    }
    setOnDuty(duty);
    setSessionId(s.open_session?.id ?? null);
    setConsented(s.consented);
    setLastSeenAt(s.live?.last_seen_at ?? null);
    setLastAccuracy(s.live?.last_accuracy_m ?? null);
    setTrackingEnabled(s.tracking_enabled !== false);
    setOverrideActive(s.override_active);
    if (duty) setLastError(null);
    return { consented: s.consented, onDuty: duty };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = (await statusFn()) as LiveStatusShape;
      applyStatus(s);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Status check failed");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial status + queue count.
  useEffect(() => {
    void refresh();
    void queueCount()
      .then(setQueued)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Permission tracking (A1/A12): prompt → checking, denied after granted → revoked.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setPermission("unsupported");
      return;
    }
    const perms = (navigator as Navigator & { permissions?: unknown }).permissions as
      | {
          query: (o: { name: string }) => Promise<{ state: string; onchange: (() => void) | null }>;
        }
      | undefined;
    if (!perms?.query) {
      setPermission("prompt");
      return;
    }
    let alive = true;
    let hadGrant = false;
    let statusObj: { state: string; onchange: (() => void) | null } | null = null;
    const apply = (state: string) => {
      if (!alive) return;
      if (state === "granted") {
        hadGrant = true;
        setPermission("granted");
      } else if (state === "denied") {
        setPermission(hadGrant ? "revoked" : "denied");
      } else {
        setPermission("prompt");
      }
    };
    perms
      .query({ name: "geolocation" })
      .then((st) => {
        statusObj = st;
        apply(st.state);
        st.onchange = () => apply(statusObj?.state ?? "prompt");
      })
      .catch(() => {
        if (alive) setPermission("prompt");
      });
    return () => {
      alive = false;
      if (statusObj) statusObj.onchange = null;
    };
  }, []);

  // Capture → throttle → queue.
  const onPosition = useCallback((pos: GeolocationPosition) => {
    setFailure(null);
    const next: PingPoint = {
      lat: pos.coords.latitude,
      long: pos.coords.longitude,
      at: Date.now(),
    };
    if (!shouldSendPing(lastSentRef.current, next)) return;
    lastSentRef.current = next;
    const ping: QueuedPing = {
      client_ping_id: newClientId(),
      lat: next.lat,
      long: next.long,
      accuracy: pos.coords.accuracy ?? null,
      captured_at: new Date(next.at).toISOString(),
      source: "heartbeat",
    };
    void enqueuePing(ping)
      .then(() =>
        queueCount()
          .then(setQueued)
          .catch(() => undefined),
      )
      .catch(() => undefined);
  }, []);

  const onPositionError = useCallback((err: GeolocationPositionError) => {
    if (err.code === 1) setPermission((p) => (p === "granted" ? "revoked" : "denied"));
    else if (err.code === 2) setFailure("unavailable");
    else setFailure("timeout");
  }, []);

  // Leadership heartbeat: only the freshest tab watches (two-tab backstop).
  const isLeader = useCallback(() => {
    try {
      const raw = localStorage.getItem(LEADER_KEY);
      const now = Date.now();
      if (!raw) return true;
      const { tab, t } = JSON.parse(raw) as { tab: string; t: number };
      return tab === tabIdRef.current || now - t > LEADER_TTL_MS;
    } catch {
      return true;
    }
  }, []);

  const claimLeadership = useCallback(() => {
    try {
      localStorage.setItem(LEADER_KEY, JSON.stringify({ tab: tabIdRef.current, t: Date.now() }));
    } catch {
      // Storage blocked — every tab watches; server dedupes by client_ping_id.
    }
  }, []);

  const ensureWatch = useCallback(() => {
    if (watchIdRef.current != null) return;
    if (!("geolocation" in navigator)) {
      setPermission("unsupported");
      return;
    }
    if (!isLeader()) return;
    claimLeadership();
    watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      timeout: 30_000,
      maximumAge: 10_000,
    });
  }, [claimLeadership, isLeader, onPosition, onPositionError]);

  // Watch lifecycle: on-duty + visible tab only (A8 — paused in background).
  useEffect(() => {
    if (!onDuty) {
      stopWatch();
      return;
    }
    ensureWatch();
    claimLeadership();
    const beat = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        stopWatch();
        return;
      }
      ensureWatch();
      claimLeadership();
    }, 5_000);
    const onVis = () => {
      if (document.visibilityState === "visible" && snapRef.current.onDuty) {
        ensureWatch();
        void flush();
      } else {
        stopWatch();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", onVis);
      stopWatch();
    };
  }, [onDuty, claimLeadership, ensureWatch, flush, stopWatch]);

  // Flush cadence: interval + reconnect + threshold is handled by queue
  // growth (flush attempts are cheap no-ops when empty).
  useEffect(() => {
    if (!onDuty) return;
    const id = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", onOnline);
    };
  }, [onDuty, flush]);

  // Refetch-on-focus keeps last-seen honest after backgrounding (B4).
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const start = useCallback(
    async (deviceLabel?: string) => {
      // Consent may have been recorded moments ago (dialog) with no refresh
      // landed yet — re-read before refusing, or first use loops forever.
      // The server re-checks anyway; this is only the client fast path.
      let ok = consented;
      if (!ok) {
        try {
          const s = (await statusFn()) as LiveStatusShape;
          ok = applyStatus(s).consented;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        const err = new Error("Location consent is required before starting duty.");
        (err as Error & { code: string }).code = CONSENT_REQUIRED;
        throw err;
      }
      setLastError(null);
      stoppedRef.current = false;
      const res = await startFn({ data: { device_label: deviceLabel } });
      setSessionId(res.session_id);
      setOnDuty(true);
      lastSentRef.current = null;
      await refresh();
    },
    [applyStatus, consented, refresh, startFn, statusFn],
  );

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    setLastError(null);
    try {
      await flush();
    } catch {
      // Best effort — the queue survives; session close must not fail on sync.
    }
    const id = snapRef.current.sessionId;
    if (id) {
      try {
        await endFn({ data: { session_id: id } });
      } catch (e) {
        setLastError(e instanceof Error ? e.message : "End-duty failed");
        throw e;
      }
    }
    stopWatch();
    setOnDuty(false);
    setSessionId(null);
    await refresh();
  }, [endFn, flush, refresh, stopWatch]);

  const retry = useCallback(async () => {
    setLastError(null);
    setFailure(null);
    // Nudge the OS prompt when permission is still undecided (F4).
    if (permission === "prompt" && "geolocation" in navigator) {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            onPosition(pos);
            resolve();
          },
          (err) => {
            onPositionError(err);
            resolve();
          },
          { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
        );
      });
    }
    await refresh();
    if (snapRef.current.onDuty) {
      ensureWatch();
      await flush();
    }
  }, [permission, onPosition, onPositionError, refresh, ensureWatch, flush]);

  const value = useMemo<DutyTrackerValue>(
    () => ({
      onDuty,
      sessionId,
      consented,
      loading,
      queued,
      lastError,
      lastSeenAt,
      lastAccuracy,
      trackingEnabled,
      overrideActive,
      permission,
      failure,
      start,
      stop,
      refresh,
      retry,
    }),
    [
      onDuty,
      sessionId,
      consented,
      loading,
      queued,
      lastError,
      lastSeenAt,
      lastAccuracy,
      trackingEnabled,
      overrideActive,
      permission,
      failure,
      start,
      stop,
      refresh,
      retry,
    ],
  );

  return <DutyTrackerCtx.Provider value={value}>{children}</DutyTrackerCtx.Provider>;
}
