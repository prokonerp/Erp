/**
 * Screen-guard primitives for the engineer portal.
 *
 * HONEST SCOPE: these are *deterrents* only. This is a pure web app with no
 * native wrapper, so a browser physically cannot block OS-level screenshots or
 * screen recording. Nothing here prevents a capture; it raises friction and
 * labels anything that does get captured.
 *
 * This module is deliberately PURE and deterministic — no React, no DOM, no
 * side effects — so it can be unit-tested in plain node.
 */

export type GuardedShortcut = "print" | "save" | "printscreen";

/** Fixed IST offset (UTC+5:30). India has no DST, so this never changes. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Classify a keyboard event into a guarded shortcut, or `null` when the key is
 * not guarded. Rules are evaluated in order; `key` is compared
 * case-insensitively.
 */
export function classifyGuardKey(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): GuardedShortcut | null {
  const key = input.key === undefined || input.key === null ? "" : String(input.key);
  const lower = key.toLowerCase();

  // PrintScreen fires with no meaningful modifiers and is never "typed" into a
  // field, so it is reported regardless of modifier state.
  if (lower === "printscreen") return "printscreen";

  const modifier = input.ctrlKey || input.metaKey;

  if (modifier && lower === "p") return "print";
  // Also covers Cmd/Ctrl+Shift+S.
  if (modifier && lower === "s") return "save";

  return null;
}

/** True when a focus target should keep its native clipboard/selection behaviour. */
export function isEditableTarget(tagName: string, isContentEditable: boolean): boolean {
  if (isContentEditable === true) return true;
  const tag = String(tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Zero-pad to two digits. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Deterministic single-line watermark label: identity + IST wall-clock time.
 *
 * The IST value is derived from the *shifted* instant (UTC+5:30), never from the
 * device timezone — so the same `atMs` yields the same string everywhere.
 */
export function guardWatermarkLabel(identity: string, atMs: number): string {
  const who = typeof identity === "string" && identity.trim() !== "" ? identity.trim() : "Engineer";
  const shifted = new Date((Number.isFinite(atMs) ? atMs : 0) + IST_OFFSET_MS);
  const date = `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate(),
  )}`;
  const time = `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`;
  // Single line on purpose — a multi-line label would not tile cleanly.
  return `${who} • ${date} ${time} IST`;
}

/** Escape the XML special characters that would break the injected <text> node. */
function escapeXml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build a `data:image/svg+xml,...` URI for a repeatable watermark tile
 * (~340x170 px, text rotated ~-24deg, low opacity) — suitable for a CSS
 * `background-image` with `background-repeat: repeat`.
 *
 * The whole document is passed through `encodeURIComponent`, so the returned
 * URI contains no raw `#`, spaces or quotes that would break `url("...")`.
 */
export function watermarkSvgDataUri(text: string, opacity = 0.5): string {
  const safeText = escapeXml(text ?? "");
  const safeOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.5;

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="340" height="170" viewBox="0 0 340 170">' +
    '<g transform="rotate(-24 170 85)" opacity="' +
    safeOpacity +
    '">' +
    '<text x="16" y="96" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" ' +
    'font-size="13" fill="rgb(15,23,42)">' +
    safeText +
    "</text>" +
    "</g>" +
    "</svg>";

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
