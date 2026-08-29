import { supabase } from "@/integrations/supabase/client";

export const SIGNATURE_BUCKET = "signatures";

/** Resolve a stored signature storage path to a time-limited signed URL. */
export async function signSignatureUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl || null;
}
