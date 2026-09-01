import { supabase } from "@/integrations/supabase/client";
import { cleanSignatureToTransparentPng } from "@/lib/signatureClean";

export const SIGNATURE_BUCKET = "signatures";

/** Resolve a stored signature storage path to a time-limited signed URL. */
export async function signSignatureUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl || null;
}

/**
 * Clean a signature image: remove paper background → transparent PNG Blob.
 * Returns null if cleaning fails (caller should fallback to raw file).
 */
export async function cleanSignatureImage(src: File | string): Promise<Blob | null> {
  try {
    let srcUrl: string;
    let objectUrl: string | null = null;

    if (typeof File !== "undefined" && src instanceof File) {
      objectUrl = URL.createObjectURL(src);
      srcUrl = objectUrl;
    } else if (typeof src === "string") {
      if (!src) return null;
      srcUrl = src;
    } else {
      return null;
    }

    let cleaned: string | null;
    try {
      cleaned = await cleanSignatureToTransparentPng(srcUrl);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }

    if (!cleaned) return null;

    // Convert data URL → Blob
    const res = await fetch(cleaned);
    return await res.blob();
  } catch {
    return null;
  }
}

/** File extension for stored signatures. */
export function signatureExt(): string {
  return "png";
}
