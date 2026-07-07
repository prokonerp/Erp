import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchBranches, type BranchRow } from "@/lib/sales";

export const Route = createFileRoute("/_app/po/settings")({
  component: POSettings,
  head: () => ({ meta: [{ title: "PO Settings — Prokon" }] }),
});

type POSettingsRow = {
  id?: string;
  branch_id: string;
  prefix: string;
  fy_reset: boolean;
  next_seq: number;
  terms_default: string | null;
  notes_default: string | null;
};

function POSettings() {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [settings, setSettings] = useState<POSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBranches().then((bs) => {
      setBranches(bs);
      if (!branchId && bs.length) setBranchId(bs[0].id);
      setLoading(false);
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!branchId) return;
    (supabase as any).from("po_settings").select("*").eq("branch_id", branchId).maybeSingle().then(({ data }: any) => {
      setSettings(data ?? {
        branch_id: branchId, prefix: "PROKON/PO/", fy_reset: true, next_seq: 1, terms_default: "", notes_default: "",
      });
    });
  }, [branchId]);

  async function save() {
    if (!settings) return;
    const payload = { ...settings };
    const { error } = settings.id
      ? await (supabase as any).from("po_settings").update(payload).eq("id", settings.id)
      : await (supabase as any).from("po_settings").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4 max-w-4xl">
      <h2 className="text-lg font-semibold">Purchase Order Settings</h2>

      <div className="flex items-center gap-2">
        <Label className="text-xs">Branch:</Label>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {settings && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">PO Numbering</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label className="text-xs">Prefix</Label><Input value={settings.prefix} onChange={(e) => setSettings({ ...settings, prefix: e.target.value })} placeholder="PROKON/PO/" /></div>
            <div><Label className="text-xs">Next Sequence</Label><Input type="number" value={settings.next_seq} onChange={(e) => setSettings({ ...settings, next_seq: Number(e.target.value) })} /></div>
            <div className="flex items-end"><label className="text-xs flex items-center gap-2"><input type="checkbox" checked={settings.fy_reset} onChange={(e) => setSettings({ ...settings, fy_reset: e.target.checked })} />Reset each FY (Apr–Mar)</label></div>
            <div className="md:col-span-3"><Label className="text-xs">Default Terms & Conditions</Label><Textarea rows={3} value={settings.terms_default || ""} onChange={(e) => setSettings({ ...settings, terms_default: e.target.value })} /></div>
            <div className="md:col-span-3"><Label className="text-xs">Default Notes</Label><Textarea rows={2} value={settings.notes_default || ""} onChange={(e) => setSettings({ ...settings, notes_default: e.target.value })} /></div>
            <div className="md:col-span-3 flex justify-end"><Button size="sm" onClick={save}>Save</Button></div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Format: <span className="font-mono">{`${settings?.prefix || "PROKON/PO/"}${settings?.fy_reset ? "YY-YY/" : "YYYY/"}0001`}</span>. Numbers auto-assign per branch on save.
      </p>
    </div>
  );
}