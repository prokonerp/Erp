import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PenLine, Trash2, Upload, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { useServerFn } from "@tanstack/react-start";
import {
  listSignatureUsers,
  removeSignature,
  uploadSignature,
} from "@/lib/signature.functions";
import { cleanSignatureImage } from "@/lib/userSignature";

type AppUserRow = {
  user_id: string;
  name: string | null;
  email: string | null;
  signature_url: string | null;
};

type SigRow = AppUserRow & { signed_url: string | null };

/** Blob → raw base64 (no data-URL prefix) for the server-fn upload payload. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = reader.result as string;
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(blob);
  });
}

export function SignatureSettings({ isAdmin }: { isAdmin: boolean }) {
  const confirm = useConfirm();
  const callList = useServerFn(listSignatureUsers);
  const callUpload = useServerFn(uploadSignature);
  const callRemove = useServerFn(removeSignature);
  const [rows, setRows] = useState<SigRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = async () => {
    try {
      // Server-scoped: admins see all users, everyone else sees only self.
      // Signed URLs are minted server-side (1h expiry).
      const list = (await callList()) as unknown as SigRow[];
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const upload = async (user: AppUserRow, file: File) => {
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) return toast.error("Only PNG or JPG images are allowed");
    if (file.size > 2 * 1024 * 1024) return toast.error("Max file size is 2 MB");
    setBusyId(user.user_id);
    try {
      // Clean on-device (paper background → transparent PNG); fall back to
      // the raw file when cleaning fails.
      const cleanedBlob = await cleanSignatureImage(file);
      const storeBlob = cleanedBlob || file;
      const mime = storeBlob.type === "image/png" ? "image/png" : "image/jpeg";
      const base64 = await blobToBase64(storeBlob);
      // Server enforces admin-or-self + magic bytes; writes via service role.
      await callUpload({
        data: { userId: user.user_id, dataBase64: base64, contentType: mime },
      });
      toast.success("Signature uploaded");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusyId(null);
      if (fileRefs.current[user.user_id]) fileRefs.current[user.user_id]!.value = "";
    }
  };

  const remove = async (row: SigRow) => {
    if (!isAdmin) return;
    const ok = await confirm({
      title: `Remove signature for "${row.name || row.email || row.user_id}"?`,
      description: "The signature file is removed from storage and the user's signature is cleared.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    setBusyId(row.user_id);
    try {
      // Server enforces admin-only; removes the file + clears the column.
      await callRemove({ data: { userId: row.user_id } });
      toast.success("Signature removed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">User Signatures</CardTitle>
        <p className="text-xs text-muted-foreground">
          Upload authorised signatory images to embed in invoices and other print PDFs. PNG/JPG, max 2 MB.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-40">Signature</TableHead>
              <TableHead className="w-32">Upload</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.user_id}>
                <TableCell className="font-medium">{r.name || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.email || "—"}</TableCell>
                <TableCell>
                  <div className="h-14 flex items-center">
                    {r.signed_url
                      ? <img src={r.signed_url} alt={r.name || "signature"} style={{ maxHeight: 56, maxWidth: 150, objectFit: "contain" }} />
                      : <span className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="h-4 w-4" />No signature</span>}
                  </div>
                </TableCell>
                <TableCell>
                  <input
                    ref={(el) => { fileRefs.current[r.user_id] = el; }}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(r, f); }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === r.user_id}
                    onClick={() => fileRefs.current[r.user_id]?.click()}
                  >
                    <Upload className="h-4 w-4 mr-1" />{busyId === r.user_id ? "…" : "Upload"}
                  </Button>
                </TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" disabled={!isAdmin || busyId === r.user_id} onClick={() => remove(r)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No users found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        {!isAdmin && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
            <PenLine className="h-3.5 w-3.5" /> You can upload your own signature. Only admins can remove signatures.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
