import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchBranches, type BranchRow } from "@/lib/sales";
import { useIsAdmin } from "@/lib/useRole";
import {
  Settings2,
  Hash,
  CalendarRange,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Info,
  FileText,
  Save,
  Sparkles,
  ArrowRight,
  Palette,
} from "lucide-react";

export const Route = createFileRoute("/_app/sales/proforma/settings")({
  component: ProformaSettings,
  head: () => ({ meta: [{ title: "Proforma Invoice Settings — Prokon" }] }),
});

type PiSettings = {
  id?: string;
  branch_id: string;
  prefix: string;
  fy_reset: boolean;
  next_seq: number;
  current_fy?: string | null;
  terms_default: string | null;
  notes_default: string | null;
  theme_color?: string;
  copy_label?: string;
  company_name?: string | null;
  company_address?: string | null;
  udyam_no?: string | null;
  phone?: string | null;
  email?: string | null;
};

function computeFY(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  const end = start + 1;
  return `${String(start).slice(-2)}-${String(end).slice(-2)}`;
}

function fyOptions(): string[] {
  const cur = computeFY();
  const [a] = cur.split("-").map(Number);
  const startYY = a - 2;
  return Array.from({ length: 5 }, (_, i) => {
    const s = startYY + i;
    return `${String(s).padStart(2, "0")}-${String(s + 1).padStart(2, "0")}`;
  });
}

function ProformaSettings() {
  const { isAdmin } = useIsAdmin();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [settings, setSettings] = useState<PiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const bs = await fetchBranches();
    setBranches(bs);
    if (!branchId && bs.length) setBranchId(bs[0].id);
    setLoading(false);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  useEffect(() => {
    if (!branchId) return;
    supabase
      .from("proforma_invoice_settings" as "proforma_invoice_settings")
      .select("*")
      .eq("branch_id", branchId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSettings(data as any);
        } else {
          setSettings({
            branch_id: branchId,
            prefix: "PHS/PI/",
            fy_reset: true,
            next_seq: 1,
            current_fy: computeFY(),
            terms_default: "",
            notes_default: "",
            theme_color: "#1F9D4D",
            copy_label: "Original Copy",
            company_name: "",
            company_address: "",
            udyam_no: "",
            phone: "",
            email: "",
          });
        }
      });
  }, [branchId, branches]); // eslint-disable-line

  async function saveSettings() {
    if (!settings) return;
    if (!settings.prefix || !settings.prefix.trim()) return toast.error("Prefix is required — e.g. PHS/PI/");
    if (!settings.prefix.endsWith("/")) {
      toast.message("Tip: prefix should end with '/' — auto-appending");
      setSettings({ ...settings, prefix: settings.prefix.trim() + "/" });
      return;
    }
    if (settings.next_seq < 1 || settings.next_seq > 9999) return toast.error("Start No must be 1–9999");
    setSaving(true);
    try {
      const payload: any = {
        branch_id: settings.branch_id,
        prefix: settings.prefix.trim(),
        fy_reset: settings.fy_reset,
        next_seq: Number(settings.next_seq),
        current_fy: settings.current_fy || computeFY(),
        terms_default: settings.terms_default,
        notes_default: settings.notes_default,
        theme_color: settings.theme_color,
        copy_label: settings.copy_label,
        company_name: settings.company_name,
        company_address: settings.company_address,
        udyam_no: settings.udyam_no,
        phone: settings.phone,
        email: settings.email,
      };
      const { error, data } = settings.id
        ? await supabase.from("proforma_invoice_settings" as "proforma_invoice_settings").update(payload).eq("id", settings.id).select().maybeSingle()
        : await supabase.from("proforma_invoice_settings" as "proforma_invoice_settings").insert(payload).select().maybeSingle();
      if (error) throw error;
      if (data) setSettings(data as any);
      toast.success("Proforma Invoice settings saved");
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-muted-foreground">Loading settings…</div>;

  const fy = settings?.current_fy || computeFY();
  const rawPreview = settings ? `${settings.prefix}${fy}/${String(settings.next_seq).padStart(4, "0")}` : "";
  const next3 = settings
    ? Array.from({ length: 3 }, (_, i) => `${settings.prefix}${fy}/${String(settings.next_seq + i).padStart(4, "0")}`)
    : [];

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <span className="h-8 w-8 rounded-lg bg-[#1F9D4D] text-white grid place-items-center"><Settings2 className="h-4 w-4" /></span>
        <div>
          <h2 className="text-lg font-semibold">Proforma Invoice Settings</h2>
          <p className="text-xs text-muted-foreground">Numbering, appearance and defaults for PI documents.</p>
        </div>
      </div>

      {/* Branch picker */}
      <Card className="border-slate-200">
        <CardContent className="pt-4">
          <Label className="text-xs">Branch</Label>
          <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </CardContent>
      </Card>

      {/* Numbering */}
      {settings && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px] flex items-center gap-2"><Hash className="h-4 w-4" /> PI Numbering</CardTitle>
            <CardDescription className="text-xs">Proforma invoice number format. Advisory-locked per branch to prevent duplicates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">Prefix</Label>
                <Input className="font-mono text-sm" value={settings.prefix} onChange={(e) => setSettings({ ...settings, prefix: e.target.value })} placeholder="PHS/PI/" />
                <div className="flex gap-1.5 mt-1.5">
                  {["PHS/PI/", "PHS/"].map((p) => (
                    <button key={p} type="button" onClick={() => setSettings({ ...settings, prefix: p })} className={`px-2 py-1 rounded-full text-xs border ${settings.prefix === p ? "bg-[#1F9D4D] text-white border-[#1F9D4D]" : "bg-white hover:bg-slate-50"}`}>{p}</button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" /> Financial Year</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm font-mono" value={fy} onChange={(e) => setSettings({ ...settings, current_fy: e.target.value })}>
                  {fyOptions().map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <label className="text-xs flex items-center gap-2 pt-1 cursor-pointer">
                  <input type="checkbox" checked={settings.fy_reset} onChange={(e) => setSettings({ ...settings, fy_reset: e.target.checked })} className="h-4 w-4" />
                  Reset sequence each FY (Apr–Mar)
                </label>
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1.5"><Hash className="h-3.5 w-3.5" /> PI Start No</Label>
                <Input type="number" min={1} max={9999} className="font-mono" value={settings.next_seq} onChange={(e) => setSettings({ ...settings, next_seq: Math.max(1, Math.min(9999, Number(e.target.value) || 1)) })} />
                <p className="text-[11px] text-muted-foreground">Next PI will be <span className="font-mono font-medium">{String(settings.next_seq).padStart(4, "0")}</span></p>
              </div>
            </div>

            {/* Live Preview */}
            <div className="rounded-xl border bg-slate-50 p-3 space-y-2">
              <div className="text-xs font-medium flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> Live Preview</div>
              <div className="font-mono text-sm font-semibold tracking-tight bg-white border rounded-lg px-2.5 py-2">{rawPreview || "—"}</div>
            </div>

            {/* Next 3 */}
            <div className="rounded-xl border bg-white p-3">
              <div className="text-xs font-medium flex items-center gap-1.5 mb-2"><Sparkles className="h-3.5 w-3.5 text-[#1F9D4D]" /> Next 3 numbers</div>
              <div className="flex flex-wrap gap-2">
                {next3.map((n, i) => (
                  <div key={n} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono ${i === 0 ? "bg-[#1F9D4D] text-white border-[#1F9D4D]" : "bg-slate-50"}`}>
                    <span className={i === 0 ? "text-white/70" : "text-muted-foreground"}>#{String(settings!.next_seq + i).padStart(4, "0")}</span>
                    <span className="font-semibold">{n}</span>
                    {i === 0 && <ArrowRight className="h-3 w-3 opacity-70" />}
                  </div>
                ))}
                <span className="text-[11px] text-muted-foreground self-center">FY {fy} · {settings.fy_reset ? "resets Apr 1" : "continuous"}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => setSettings({ ...settings, prefix: "PHS/PI/", current_fy: computeFY(), next_seq: 1 })}>Reset to PHS/PI/ · FY {computeFY()} · 0001</Button>
              <Button size="sm" onClick={saveSettings} disabled={saving} className="bg-[#1F9D4D] hover:bg-[#157A3B] min-w-[140px]">
                {saving ? "Saving…" : <><Save className="h-3.5 w-3.5 mr-1.5" />Save Numbering</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Appearance */}
      {settings && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px] flex items-center gap-2"><Palette className="h-4 w-4" /> PI Appearance</CardTitle>
            <CardDescription className="text-xs">Theme color applied to PI print header, table headers, and accent bars.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs">Theme Color</Label>
              <div className="flex items-center gap-2">
                <input type="color" className="h-9 w-14 rounded border" value={settings.theme_color || "#1F9D4D"} onChange={(e) => setSettings({ ...settings, theme_color: e.target.value })} />
                <Input value={settings.theme_color || "#1F9D4D"} onChange={(e) => setSettings({ ...settings, theme_color: e.target.value })} className="font-mono text-xs" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Copy Label</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={settings.copy_label || "Original Copy"} onChange={(e) => setSettings({ ...settings, copy_label: e.target.value })}>
                <option>Original Copy</option>
                <option>Duplicate Copy</option>
                <option>Triplicate Copy</option>
                <option>Office Copy</option>
              </select>
            </div>
            <div className="md:col-span-2 flex gap-2">
              {[
                { c: "#1F9D4D", label: "Green" },
                { c: "#000000", label: "Black" },
                { c: "#1f3864", label: "Navy" },
                { c: "#7c2d12", label: "Brown" },
                { c: "#7c3aed", label: "Purple" },
                { c: "#b91c1c", label: "Red" },
              ].map(({ c, label }) => (
                <button key={c} type="button" title={label} className="h-9 w-9 rounded-full border-2 shadow-sm" style={{ background: c, borderColor: c === (settings.theme_color || "") ? "#000" : "#e5e7eb" }} onClick={() => setSettings({ ...settings, theme_color: c })} />
              ))}
            </div>
            <div className="md:col-span-4 flex justify-end"><Button size="sm" onClick={saveSettings} disabled={saving} className="bg-[#1F9D4D] hover:bg-[#157A3B]">Save Appearance</Button></div>
          </CardContent>
        </Card>
      )}

      {/* Company Header */}
      {settings && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px]">Company Header (PDF)</CardTitle>
            <CardDescription className="text-xs">Shown on PI PDF header. Leave blank to fall back to branch details.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2"><Label className="text-xs">Company Name</Label><Input value={settings.company_name || ""} placeholder="Prokon Hi-Tech Systems" onChange={(e) => setSettings({ ...settings, company_name: e.target.value })} /></div>
            <div><Label className="text-xs">Udyam No</Label><Input value={settings.udyam_no || ""} onChange={(e) => setSettings({ ...settings, udyam_no: e.target.value })} /></div>
            <div className="md:col-span-3"><Label className="text-xs">Company Address</Label><Textarea rows={2} value={settings.company_address || ""} placeholder="3C-58, BP, NIT-3, Faridabad-121001" onChange={(e) => setSettings({ ...settings, company_address: e.target.value })} /></div>
            <div><Label className="text-xs">Phone</Label><Input value={settings.phone || ""} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></div>
            <div className="md:col-span-2"><Label className="text-xs">Email</Label><Input value={settings.email || ""} onChange={(e) => setSettings({ ...settings, email: e.target.value })} /></div>
            <div className="md:col-span-3 flex justify-end"><Button size="sm" onClick={saveSettings} disabled={saving} className="bg-[#1F9D4D] hover:bg-[#157A3B]">Save Company Header</Button></div>
          </CardContent>
        </Card>
      )}

      {/* Defaults */}
      {settings && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px] flex items-center gap-2"><FileText className="h-4 w-4" /> Defaults</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">Default Terms &amp; Conditions</Label><Textarea rows={3} value={settings.terms_default || ""} onChange={(e) => setSettings({ ...settings, terms_default: e.target.value })} placeholder="e.g. Goods once sold not returned..." /></div>
            <div><Label className="text-xs">Default Notes</Label><Textarea rows={2} value={settings.notes_default || ""} onChange={(e) => setSettings({ ...settings, notes_default: e.target.value })} placeholder="Internal notes shown on draft PI" /></div>
            <div className="flex justify-end"><Button size="sm" onClick={saveSettings} disabled={saving} className="bg-[#1F9D4D] hover:bg-[#157A3B]">Save Defaults</Button></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
