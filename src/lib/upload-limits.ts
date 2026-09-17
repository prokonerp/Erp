// Single source of truth for every upload path.
//
// Today limits drift (e.g. 2MB signature vs 8MB server cap): all upload paths
// must import MAX_ACCEPTED_BYTES / assertAcceptedUploadSize from here instead
// of hard-coding their own caps. SERVER_HARD_MAX_BYTES is the absolute infra
// ceiling and stays unchanged.
//
// Pure module: no supabase / env / DOM imports, unit-tests in plain node.

/** Max accepted INPUT per file (5 MB). Client must reject anything larger. */
export const MAX_ACCEPTED_BYTES = 5 * 1024 * 1024;

/** Client compress target (1.5 MB): images above this are downscaled first. */
export const COMPRESS_TARGET_BYTES = 1572864;

/** Absolute server ceiling (8 MB): infra limit, unchanged. */
export const SERVER_HARD_MAX_BYTES = 8 * 1024 * 1024;

/** Image MIME types accepted by upload paths. */
export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/** HEIC-family MIME types (need client-side conversion before upload). */
export const HEIC_MIME = ["image/heic", "image/heif"] as const;

/** Allowed image MIME type. */
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

/** Human-readable rejection message for oversize / empty uploads. */
export function acceptedUploadMessage(): string {
  return "Images must be 5 MB or smaller";
}

/**
 * Throws Error(acceptedUploadMessage()) when `bytes` is not a usable upload
 * size (<= 0 or above MAX_ACCEPTED_BYTES). Otherwise returns void.
 */
export function assertAcceptedUploadSize(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_ACCEPTED_BYTES) {
    throw new Error(acceptedUploadMessage());
  }
}
