import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Upload, ArrowUp, ArrowDown, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listOemLogos, withSignedUrls, uploadLogoFile, deleteLogoFile,
  type OemLogo, type OemLogoWithUrl, SIZE_PX,
} from "@/lib/oemLogos.data";
import { useIsAdmin } from "@/lib/useRole";

export function OemLogoSettings() {
  const { isAdmin } = useIsAdmin();
  const [rows, setRows] = useState<OemLogoWithUrl[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [position, setPosition] = useState<OemLogo["position"]>("center");
  const [size, setSize] = useState<OemLogo["size"]>("medium");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    try {
      const list = await listOemLogos(false);
      setRows(await withSignedUrls(list));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load logos");
    }
  };
  useEffect(() => { load(); }, []);

  const upload = async (file: File) => {
    if (!name.trim()) return toast.error("Enter an OEM name first");
    setBusy(true);
    try {
      const path = await uploadLogoFile(file);
      const nextOrder = (rows[rows.length - 1]?.sort_order ?? 0) + 10;
      const { error } = await supabase.from("oem_logos").insert({
        oem_name: name.trim(), logo_path: path, position, size, is_active: true, sort_order: nextOrder,
      } as never);
      if (error) throw error;
      toast.success("Logo uploaded");
      setName("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally { setBusy(false); }
  };

  const patch = async (id: string, changes: Partial<OemLogo>) => {
    const { error } = await supabase.from("oem_logos").update(changes as never).eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  };

  const remove = async (row: OemLogoWithUrl) => {
    if (!confirm(`Delete logo "${row.oem_name}"?`)) return;
    const { error } = await supabase.from("oem_logos").delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    await deleteLogoFile(row.logo_path);
    toast.success("Deleted");
    await load();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const a = rows[idx]; const b = rows[j];
    await supabase.from("oem_logos").update({ sort_order: b.sort_order } as never).eq("id", a.id);
    await supabase.from("oem_logos").update({ sort_order: a.sort_order } as never).eq("id", b.id);
    await load();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">OEM Logo Management</CardTitle>
        <p className="text-xs text-muted-foreground">
          Upload OEM logos to include in the quotation PDF footer. PNG/JPG, max 2 MB. Recommended 300 DPI transparent PNG.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end p-3 rounded-md border bg-muted/30">
            <div className="md:col-span-2">
              <Label>OEM name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="APC" />
            </div>
            <div>
              <Label>Position</Label>
              <Select value={position} onValueChange={(v) => setPosition(v as OemLogo["position"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Footer Left</SelectItem>
                  <SelectItem value="center">Footer Center</SelectItem>
                  <SelectItem value="right">Footer Right</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Size</Label>
              <Select value={size} onValueChange={(v) => setSize(v as OemLogo["size"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="invisible">Upload</Label>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
              />
              <Button onClick={() => fileRef.current?.click()} disabled={busy || !name.trim()} className="w-full">
                <Upload className="h-4 w-4 mr-1" />{busy ? "Uploading…" : "Upload"}
              </Button>
            </div>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Order</TableHead>
              <TableHead className="w-24">Preview</TableHead>
              <TableHead>OEM Name</TableHead>
              <TableHead className="w-36">Position</TableHead>
              <TableHead className="w-32">Size</TableHead>
              <TableHead className="w-24">Active</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => move(i, -1)} disabled={!isAdmin || i === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => move(i, 1)} disabled={!isAdmin || i === rows.length - 1}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="h-12 flex items-center">
                    {r.url
                      ? <img src={r.url} alt={r.oem_name} style={{ height: SIZE_PX[r.size] }} className="object-contain" />
                      : <ImageIcon className="h-6 w-6 text-muted-foreground" />}
                  </div>
                </TableCell>
                <TableCell>
                  <Input value={r.oem_name} disabled={!isAdmin}
                    onChange={(e) => setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, oem_name: e.target.value } : x))}
                    onBlur={(e) => e.target.value !== r.oem_name && patch(r.id, { oem_name: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Select value={r.position} disabled={!isAdmin} onValueChange={(v) => patch(r.id, { position: v as OemLogo["position"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select value={r.size} disabled={!isAdmin} onValueChange={(v) => patch(r.id, { size: v as OemLogo["size"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Small</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="large">Large</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Switch checked={r.is_active} disabled={!isAdmin} onCheckedChange={(v) => patch(r.id, { is_active: v })} />
                </TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" disabled={!isAdmin} onClick={() => remove(r)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No OEM logos uploaded yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}