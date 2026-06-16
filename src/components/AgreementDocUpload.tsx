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

  const openSigned = async (download: boolean) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from(BUCKET)
      .createSignedUrl(path, 300, download ? { download: true } : undefined);
    if (error || !data?.signedUrl) return toast.error(error?.message || "Unable to open file");
    window.open(data.signedUrl, "_blank");
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
            <Button size="sm" variant="outline" onClick={() => openSigned(false)} disabled={busy}>
              <Eye className="h-4 w-4 mr-1" />Preview
            </Button>
            <Button size="sm" variant="outline" onClick={() => openSigned(true)} disabled={busy}>
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