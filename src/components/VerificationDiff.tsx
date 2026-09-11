import { supabase } from "@/integrations/supabase/client";

export function diffLines(original: string | null, corrected: string | null): { changed: boolean } {
  return { changed: (original ?? "") !== (corrected ?? "") };
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
  const photoUrl = photoPath
    ? supabase.storage.from("ticket-attachments").getPublicUrl(photoPath).data.publicUrl
    : null;
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
      {photoUrl ? (
        <a className="text-xs underline" href={photoUrl} target="_blank" rel="noreferrer">
          View correction photo
        </a>
      ) : null}
    </div>
  );
}
