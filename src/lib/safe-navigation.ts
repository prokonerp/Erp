/**
 * Local port of `trimPathRight` from `@tanstack/router-core` (v1.168.x).
 * Deliberately inlined instead of deep-imported: router-core is a transitive
 * dep here (package.json declares only router/router-plugin/react-start),
 * and the skip-check below must use byte-identical comparison semantics to
 * `commitLocation`'s own `isSameUrl` check. Trims trailing slashes except
 * preserves root "/".
 */
function trimPathRight(path: string): string {
  const len = path.length;
  return len > 1 && path[len - 1] === "/" ? path.replace(/\/{1,}$/, "") : path;
}

/**
 * Decides whether a redirect commit must be skipped because the router is
 * already at the target. Mirrors the `isSameUrl` comparison inside
 * `commitLocation`: re-committing the current URL takes the same-url
 * `load()` branch, which synchronously updates router state and re-renders
 * the still-mounted guard — re-firing navigation until React throws
 * "Maximum update depth exceeded" (TanStack Router #3110).
 */
export function shouldSkipNavigation(currentHref: string, targetHref: string): boolean {
  return trimPathRight(currentHref) === trimPathRight(targetHref);
}
