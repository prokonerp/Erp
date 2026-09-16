/**
 * PostgREST / Storage / server-fn errors arrive with the DB envelope split
 * across fields ({ message, code, details, hint, statusCode }). A bare
 * `toast.error(error.message)` drops everything except the message — which
 * is exactly how a P0001 lost its raiser identity on the engineer upload
 * path. These helpers preserve the envelope: the toast carries
 * `message (code X)`; the console carries the full envelope for diagnosis.
 */

export type DbErrorLike = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  statusCode?: unknown;
  status?: unknown;
};

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function errorCodeOf(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as DbErrorLike;
  return asText(e.code) ?? asText(e.statusCode) ?? asText(e.status);
}

/** Toast-safe one-liner: message + ` (code X)` when a code exists. Never throws, never empty. */
export function formatDbError(err: unknown, fallback = "Something went wrong"): string {
  const message =
    !err || typeof err !== "object"
      ? typeof err === "string" && err.trim()
        ? err
        : fallback
      : (asText((err as DbErrorLike).message) ?? fallback);
  const code = errorCodeOf(err);
  return code ? `${message} (code ${code})` : message;
}

/**
 * Server-side storage-upload throw message. Only `Error.message` crosses the
 * server-fn boundary, so bucket + status + path are embedded here — otherwise
 * a 500 from the storage API arrives client-side as a bare message with no
 * indication of which upload failed.
 */
export function storageUploadMessage(bucket: string, error: unknown, path?: string): string {
  const e = (error ?? {}) as DbErrorLike;
  const message = asText(e.message) ?? "unknown storage error";
  const code = errorCodeOf(error);
  const where = path ? ` path=${path}` : "";
  return `${bucket} upload failed${code ? ` [${code}]` : ""}:${where} ${message}`;
}

/**
 * Logs the full envelope (code/message/details/hint) to the console for
 * diagnosis and returns the toast-safe string. Logging never throws, so
 * this is safe to call inline inside every error toast.
 */
export function reportDbError(
  scope: string,
  err: unknown,
  fallback = "Something went wrong",
): string {
  try {
    if (err && typeof err === "object") {
      const e = err as DbErrorLike;
      console.error(`[${scope}]`, {
        code: errorCodeOf(err),
        message: asText(e.message),
        details: e.details ?? null,
        hint: e.hint ?? null,
      });
    } else {
      console.error(`[${scope}]`, err);
    }
  } catch {
    // Logging must never break the user flow.
  }
  return formatDbError(err, fallback);
}
