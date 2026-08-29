import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PenLine, Trash2, Upload, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { supabase } from "@/integrations/supabase/client";
import { SIGNATURE_BUCKET, signSignatureUrl } from "@/lib/userSignature";

type AppUserRow = {
  user_id: string;
  name: string | null;
  email: string | null;
  signature_url: string | null;
};

type SigRow = AppUserRow & { signed_url: string | null };

export function SignatureSettings({ isAdmin }: { isAdmin: boolean }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<SigRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const load = async () => {
    try {
      const { data, error } = await supabase
        .from("app_users")
        .select("user_id, name, email, signature_url")
        .order("name", { ascending: true, nullsFirst: false });
      if (error) throw error;
      const list = (data || []) as unknown as AppUserRow[];
      const signed = await Promise.all(
        list.map(async (r) => ({ ...r, signed_url: await signSignatureUrl(r.signature_url) })),
      );
      setRows(signed);
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
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `signatures/${user.user_id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(SIGNATURE_BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("app_users")
        .update({ signature_url: path } as never)
        .eq("user_id", user.user_id);
      if (dbErr) throw dbErr;
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
      if (row.signature_url) {
        const { error: rmErr } = await supabase.storage
          .from(SIGNATURE_BUCKET)
          .remove([row.signature_url]);
        if (rmErr) throw rmErr;
      }
      const { error: dbErr } = await supabase
        .from("app_users")
        .update({ signature_url: null } as never)
        .eq("user_id", row.user_id);
      if (dbErr) throw dbErr;
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
            <PenLine className="h-3.5 w-3.5" /> Only admins can remove signatures.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
