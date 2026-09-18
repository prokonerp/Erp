import { useEffect, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * SignedImage — inline thumbnail for a private-storage photo with a
 * click-to-enlarge lightbox. Signs lazily on mount (1 h URL); any
 * authenticated role with bucket read access can view. Used for the
 * engineer-uploaded serial/correction photos a reviewer must SEE to
 * confirm. Fail-soft: loading skeleton, then an unavailable note.
 */
export function SignedImage({
  bucket = "ticket-attachments",
  path,
  alt,
  thumbClassName = "h-16 w-16",
}: {
  bucket?: string;
  path: string | null | undefined;
  alt: string;
  thumbClassName?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const clean = typeof path === "string" ? path.trim() : "";
    if (clean === "") {
      setUrl(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    setUrl(null);
    supabase.storage
      .from(bucket)
      .createSignedUrl(clean, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bucket, path]);

  if (!path || (typeof path === "string" && path.trim() === "")) return null;
  if (loading) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded border border-border bg-muted/40 ${thumbClassName}`}
        role="status"
        aria-label="Loading photo"
      >
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      </span>
    );
  }
  if (failed || !url) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5" aria-hidden />
        Photo unavailable
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Enlarge: ${alt}`}
        aria-label={`Enlarge photo: ${alt}`}
        className="inline-flex rounded border border-border p-0.5 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className={`rounded object-cover ${thumbClassName}`}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl p-2">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img
            src={url}
            alt={alt}
            className="max-h-[80vh] w-full rounded object-contain bg-muted/20"
          />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block px-2 pb-1 text-xs text-primary underline underline-offset-4"
          >
            Open original in a new tab
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
