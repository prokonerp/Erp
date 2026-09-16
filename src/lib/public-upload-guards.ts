// Path guards for the public raise-ticket staging area.
//
// Anonymous uploads never touch ticket/<id>/... directly: the server stages
// them under `public/staged/<yyyy-mm-dd>/<id>-<kind>.<ext>` and the ticket
// submit fn only accepts paths that pass isStagedPublicPath. Anything else
// (ticket paths, other buckets' prefixes smuggled into the attachments jsonb,
// traversal, absolute paths) is rejected before any DB write.
//
// Pure module: no supabase / env / DOM imports, unit-tests in plain node.

export const STAGED_PUBLIC_PREFIX = "public/staged/";

const MAX_STAGED_PATH_LEN = 500;

const SAFE_REST = /^[A-Za-z0-9._/-]+$/;

export function isStagedPublicPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > MAX_STAGED_PATH_LEN) return false;
  if (!path.startsWith(STAGED_PUBLIC_PREFIX)) return false;
  const rest = path.slice(STAGED_PUBLIC_PREFIX.length);
  if (rest.length === 0) return false;
  if (
    rest.includes("\\") ||
    rest.includes("..") ||
    rest.includes("//") ||
    rest.includes(" ") ||
    rest.startsWith("/") ||
    rest.endsWith("/")
  ) {
    return false;
  }
  return SAFE_REST.test(rest);
}

function sanitizeExt(ext: string, fallback: string): string {
  const first = ext
    .toLowerCase()
    .split(/[^a-z0-9]+/)[0]
    ?.slice(0, 5);
  return first && first.length > 0 ? first : fallback;
}

export function buildStagedPublicPath(date: Date, id: string, kind: string, ext: string): string {
  const day = date.toISOString().slice(0, 10);
  const safeId = id.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64) || "file";
  const safeKind = kind.replace(/[^A-Za-z0-9_]/g, "").slice(0, 32) || "other";
  return `${STAGED_PUBLIC_PREFIX}${day}/${safeId}-${safeKind}.${sanitizeExt(ext, "jpg")}`;
}
