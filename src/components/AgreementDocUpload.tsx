import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Eye, FileText, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";

const BUCKET = "amc-agreements";
const MAX_BYTES = 2 * 1024 * 1024;

export function AgreementDocUpload({
  amcId,
  path,
  onChange,
  disabled,
}: {
  amcId?: string | null;
  path: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [previewData, setPreviewData] = useState<ArrayBuffer | null>(null);

  const upload = async (file: File) => {
    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are allowed");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("File must be 2 MB or smaller");
      return;
    }
    setBusy(true);
    const stamp = Date.now();
    const folder = amcId || "draft";
    const newPath = `${folder}/${stamp}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
    const { error } = await supabase.storage.from(BUCKET).upload(newPath, file, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    // remove old file (best effort)
    if (path && path !== newPath) {
      await supabase.storage.from(BUCKET).remove([path]);
    }
    setBusy(false);
    onChange(newPath);
    toast.success("Agreement uploaded");
  };

  const openPreview = async () => {
    if (!path) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) throw error || new Error("Unable to fetch file");
      // Buffer in memory; we render with pdf.js (no Chrome PDF viewer dependency).
      const buf = await data.arrayBuffer();
      setPreviewData(buf);
    } catch (e: any) {
      toast.error(e?.message || "Unable to open file");
    } finally {
      setBusy(false);
    }
  };

  const closePreview = () => {
    setPreviewData(null);
  };

  const downloadFile = async () => {
    if (!path) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) throw error || new Error("Unable to fetch file");
      const blob = data.type === "application/pdf" ? data : new Blob([data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const filename = path.split("/").pop()?.replace(/^\d+-/, "") || "agreement.pdf";
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      toast.error(e?.message || "Unable to download file");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!path) return;
    if (!confirm("Remove uploaded agreement?")) return;
    setBusy(true);
    await supabase.storage.from(BUCKET).remove([path]);
    setBusy(false);
    onChange(null);
    toast.success("Agreement removed");
  };

  const filename = path ? path.split("/").pop()?.replace(/^\d+-/, "") : null;

  return (
    <div className="space-y-2">
      <Label>Agreement Document (PDF, max 2 MB)</Label>
      <input
        ref={ref}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          if (ref.current) ref.current.value = "";
        }}
      />
      {path ? (
        <div className="flex items-center justify-between gap-2 border rounded-md p-2 bg-muted/30">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate font-mono text-xs">{filename}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={openPreview} disabled={busy}>
              <Eye className="h-4 w-4 mr-1" />Preview
            </Button>
            <Button size="sm" variant="outline" onClick={downloadFile} disabled={busy}>
              <Download className="h-4 w-4 mr-1" />Download
            </Button>
            <Button size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={busy || disabled}>
              <Upload className="h-4 w-4 mr-1" />Replace
            </Button>
            <Button size="icon" variant="ghost" onClick={remove} disabled={busy || disabled}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => ref.current?.click()} disabled={busy || disabled}>
          <Upload className="h-4 w-4 mr-1" />{busy ? "Uploading…" : "Upload PDF Agreement"}
        </Button>
      )}
      <Dialog open={!!previewData} onOpenChange={(o) => { if (!o) closePreview(); }}>
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 flex flex-col">
          <DialogHeader className="px-4 py-2 border-b">
            <DialogTitle className="text-sm font-medium truncate">{filename || "Agreement"}</DialogTitle>
          </DialogHeader>
          {previewData && <PdfCanvasViewer data={previewData} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PdfCanvasViewer({ data }: { data: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pdfDoc: any = null;
    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist");
        // Use the bundled worker (Vite ?url import) — no CDN, no network blocks.
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        // Clone the buffer — pdf.js transfers ownership of the underlying ArrayBuffer.
        const copy = data.slice(0);
        const loadingTask = pdfjs.getDocument({ data: copy });
        pdfDoc = await loadingTask.promise;
        const container = containerRef.current;
        if (!container || cancelled) return;
        container.innerHTML = "";
        const containerWidth = Math.max(320, container.clientWidth - 32); // padding, fallback if not laid out
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2, Math.max(1, containerWidth / viewport.width));
          const scaled = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          const dpr = window.devicePixelRatio || 1;
          canvas.width = scaled.width * dpr;
          canvas.height = scaled.height * dpr;
          canvas.style.width = `${scaled.width}px`;
          canvas.style.height = `${scaled.height}px`;
          canvas.style.display = "block";
          canvas.style.margin = "0 auto 12px";
          canvas.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
          container.appendChild(canvas);
          await page.render({ canvas, viewport: scaled, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
          if (cancelled) return;
        }
      } catch (e: any) {
        if (!cancelled) {
          console.error("PDF render error:", e);
          setError(e?.message || "Failed to render PDF");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (pdfDoc) { try { pdfDoc.destroy(); } catch { /* noop */ } }
    };
  }, [data]);

  return (
    <div ref={containerRef} className="flex-1 w-full overflow-auto bg-muted p-4">
      {error && <div className="text-sm text-destructive">{error}</div>}
    </div>
  );
}