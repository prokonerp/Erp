import { useState, type ReactNode } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lazy signed-URL file link. Signs on click (never on mount) and opens the
 * file in a new tab. Covers engineer-uploads photos and profile documents —
 * the storage SELECT policy grants admins. Fail-soft: toasts, never throws.
 */
export function SignedFileLink({
  bucket = "engineer-uploads",
  path,
  label,
  title,
  className = "",
}: {
  bucket?: string;
  path: string | null | undefined;
  label: ReactNode;
  title?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const clean = typeof path === "string" ? path.trim() : "";
  if (clean === "") return <span className="text-muted-foreground">—</span>;

  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(clean, 3600);
      if (error || !data?.signedUrl) throw new Error(error?.message ?? "sign failed");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not open the file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      title={title ?? "Open uploaded file"}
      aria-label={title ?? "Open uploaded file"}
      className={`inline-flex min-h-[32px] items-center gap-1 rounded px-1 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50 ${className}`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}
