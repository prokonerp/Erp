import { useEffect, useLayoutEffect } from "react";
import { useRouter, type NavigateOptions } from "@tanstack/react-router";
import { shouldSkipNavigation } from "@/lib/safe-navigation";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export type SafeNavigateProps = NavigateOptions & { replace?: boolean };

/**
 * Loop-safe replacement for render-time `<Navigate>` guards.
 *
 * WHY: `<Navigate>` fires `navigate()` from an effect whose deps hold the
 * (fresh-every-render) props object. If the guard stays rendered while the
 * router is already at its target — the stale-match case during a pending
 * transition — every re-render re-commits the SAME url, and
 * `commitLocation`'s same-url branch runs `load()` synchronously, which
 * updates router state, re-renders the guard, and re-fires navigation until
 * React throws "Maximum update depth exceeded" (TanStack Router #3110;
 * stack: Transitioner.startTransition -> RouterCore.load ->
 * commitLocation -> buildAndCommitLocation).
 *
 * SafeNavigate builds the target location and SKIPS the commit when its
 * public href already equals `router.latestLocation.href`, so a committed
 * redirect can never re-trigger itself. Any genuinely different destination
 * behaves exactly like `navigate()`.
 */
export function SafeNavigate(props: SafeNavigateProps) {
  const router = useRouter();
  // Deps intentionally include the whole props object: a re-fire with an
  // unchanged destination is harmless because the skip-check below makes
  // it a no-op. What must never happen is a commit to the current URL,
  // and that is decided by href comparison, not by effect timing.
  useIsomorphicLayoutEffect(() => {
    const target = router.buildLocation(props);
    if (shouldSkipNavigation(router.latestLocation.href, target.href)) return;
    void router.navigate(props);
  }, [router, props]);
  return null;
}
