/**
 * Throttled, gliding map-marker position.
 *
 * Updates are accepted at most once per MIN_ACCEPT_INTERVAL_MS, except far
 * jumps (≥ SNAP_DISTANCE_M) which snap immediately. Accepted targets glide to
 * the new position over ANIMATE_DURATION_MS (ease-out) via rAF.
 *
 * PRIVACY (ADR-0001): this is a UI transition between "last seen" fixes —
 * it never implies live tracking. The label beside the marker still reads
 * "last seen X ago"; no path is drawn between fixes here.
 */
import { useEffect, useRef, useState } from "react";
import { haversineM } from "@/lib/field-location";
import { lerpLatLng } from "@/lib/routeReplay";

/** Minimum wall-clock between accepted marker updates. */
export const MIN_ACCEPT_INTERVAL_MS = 5_000;

/** Jumps beyond this snap instantly (data correction, not movement). */
export const SNAP_DISTANCE_M = 2_000;

/** Glide duration for an accepted update. */
export const ANIMATE_DURATION_MS = 600;

/** Pure throttle/snap decision — exported for tests. */
export function shouldAcceptUpdate(elapsedMs: number, distanceM: number): boolean {
  if (distanceM >= SNAP_DISTANCE_M) return true;
  return elapsedMs >= MIN_ACCEPT_INTERVAL_MS;
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/**
 * Returns a display position that trails `target` under the throttle above.
 * Latest-wins: a target rejected inside the window is applied as soon as the
 * window elapses (always to the newest target, never a stale one).
 */
export function useAnimatedLatLng(target: [number, number]): [number, number] {
  const [displayed, setDisplayed] = useState<[number, number]>(target);
  const displayedRef = useRef(displayed);
  displayedRef.current = displayed;
  const targetRef = useRef(target);
  targetRef.current = target;
  const lastAcceptRef = useRef<number>(Date.now());
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const from = displayedRef.current;
    if (from[0] === target[0] && from[1] === target[1]) return;

    const dist = haversineM(from[0], from[1], target[0], target[1]);
    const elapsed = Date.now() - lastAcceptRef.current;
    const accepted = shouldAcceptUpdate(elapsed, dist);
    const delay = accepted ? 0 : Math.max(0, MIN_ACCEPT_INTERVAL_MS - elapsed);

    const timer = setTimeout(() => {
      const dest = targetRef.current; // latest target at fire time
      const start = displayedRef.current;
      if (start[0] === dest[0] && start[1] === dest[1]) return;

      lastAcceptRef.current = Date.now();

      const jump = haversineM(start[0], start[1], dest[0], dest[1]);
      if (jump >= SNAP_DISTANCE_M || prefersReducedMotion()) {
        setDisplayed(dest); // snap — no glide
        return;
      }

      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / ANIMATE_DURATION_MS);
        const eased = 1 - Math.pow(1 - k, 3); // ease-out cubic
        if (k < 1) {
          setDisplayed(lerpLatLng(start, dest, eased));
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
          setDisplayed(dest);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }, delay);

    timerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target]);

  return displayed;
}
