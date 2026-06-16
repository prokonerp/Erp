import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

  const openPreview = () => {
    if (!path) return;
    // Open the tab SYNCHRONOUSLY inside the click handler so Chrome doesn't
    // treat it as a popup, then navigate it once we have a blob URL.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      toast.error("Please allow pop-ups for this site to preview the PDF");
      return;
    }
    tab.document.write(
      `<!doctype html><title>Loading agreement…</title>
       <body style="margin:0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;color:#555">
       Loading agreement…</body>`
    );
    setBusy(true);
    (async () => {
      try {
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (error || !data) throw error || new Error("Unable to fetch file");
        const blob = data.type === "application/pdf" ? data : new Blob([data], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        tab.location.replace(url);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (e: any) {
        tab.close();
        toast.error(e?.message || "Unable to open file");
      } finally {
        setBusy(false);
      }
    })();
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
    </div>
  );
}