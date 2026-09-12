import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function diffLines(original: string | null, corrected: string | null): { changed: boolean } {
  return { changed: (original ?? "") !== (corrected ?? "") };
}

/** True when a storage error message indicates the bucket itself is missing. */
export function isBucketMissingError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const m = String(msg).toLowerCase();
  return m.includes("bucket not found") || m.includes("nosuchbucket") || m.includes("404");
}
export function VerificationDiff({
  label,
  original,
  corrected,
  engineer,
  at,
  photoPath,
}: {
  label: string;
  original: string | null;
  corrected: string | null;
  engineer?: string | null;
  at?: string | null;
  photoPath?: string | null;
}) {
  const { changed } = diffLines(original, corrected);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!photoPath) {
      setSignedUrl(null);
      setPhotoError(null);
      setPhotoLoading(false);
      return;
    }
    setPhotoLoading(true);
    setPhotoError(null);
    setSignedUrl(null);
    supabase.storage
      .from("ticket-attachments")
      .createSignedUrl(photoPath, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setPhotoError(error.message);
        } else {
          setSignedUrl(data?.signedUrl ?? null);
        }
        setPhotoLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setPhotoError(e instanceof Error ? e.message : String(e));
        setPhotoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [photoPath]);

  if (!changed)
    return <div className="text-xs text-emerald-700 dark:text-emerald-300">✓ {label} matched</div>;
  return (
    <div className="rounded border p-2 space-y-1">
      <div className="text-xs text-muted-foreground">
        {label} — corrected by {engineer ?? "engineer"}{" "}
        {at ? `· ${new Date(at).toLocaleString()}` : ""}
      </div>
      <div className="text-sm line-through decoration-red-400 text-red-600 dark:text-red-400">
        {original || "—"}
      </div>
      <div className="text-sm">
        →{" "}
        <span className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 px-1 rounded">
          {corrected || "—"}
        </span>
      </div>
      {photoPath ? (
        photoLoading ? (
          <div className="text-xs text-muted-foreground">Loading photo…</div>
        ) : signedUrl ? (
          <a className="text-xs underline" href={signedUrl} target="_blank" rel="noreferrer">
            View correction photo
          </a>
        ) : photoError ? (
          <div className="text-xs text-muted-foreground">
            {isBucketMissingError(photoError)
              ? "Photo unavailable (storage bucket missing - ask admin to run bucket SQL)"
              : `Photo unavailable (${photoError})`}
          </div>
        ) : null
      ) : null}
    </div>
  );
}
