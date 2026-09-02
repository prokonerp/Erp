import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { fetchBranches, type BranchRow } from "@/lib/sales";
import { INDIAN_STATES, GSTIN_STATE_CODES } from "@/lib/india";
import { stateCodeFromGSTIN, stateNameFromCode } from "@/lib/gst";
import { CompanyProfileSettings } from "@/components/CompanyProfileSettings";
import { LetterheadSettingsPanel } from "@/components/LetterheadSettingsPanel";
import { useIsAdmin } from "@/lib/useRole";
import {
  Building2,
  Settings2,
  Hash,
  CalendarRange,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Info,
  FileText,
  Warehouse,
  Save,
  Sparkles,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/_app/sales/settings")({
  component: SalesSettings,
  head: () => ({ meta: [{ title: "Sales Settings — Prokon" }] }),
});

type Settings = {
  id?: string;
  branch_id: string;
  prefix: string;
  fy_reset: boolean;
  next_seq: number;
  current_fy?: string | null;
  terms_default: string | null;
  notes_default: string | null;
  place_of_supply_default: string | null;
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
  const m = d.getMonth() + 1; // 1-12
  const start = m >= 4 ? y : y - 1;
  const end = start + 1;
  const s = String(start).slice(-2);
  const e = String(end).slice(-2);
  return `${s}-${e}`;
}

function fyOptions(): string[] {
  const cur = computeFY();
  const [a] = cur.split("-").map(Number);
  // a is 26 for 26-27 → produce 24-25 .. 27-28
  const startYY = a - 2;
  return Array.from({ length: 5 }, (_, i) => {
    const s = startYY + i;
    const e = s + 1;
    return `${String(s).padStart(2, "0")}-${String(e).padStart(2, "0")}`;
  });
}

function SalesSettings() {
  const { isAdmin } = useIsAdmin();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
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
    const b = branches.find((x) => x.id === branchId) || null;
    setBranch(b);
    supabase.from("invoice_settings").select("*").eq("branch_id", branchId).maybeSingle().then(({ data }) => {
      if (data) {
        setSettings(data as any);
      } else {
        setSettings({
          branch_id: branchId,
          prefix: "PHS/",
          fy_reset: true,
          next_seq: 1,
          current_fy: computeFY(),
          terms_default: "",
          notes_default: "",
          place_of_supply_default: "",
          theme_color: "#000000",
          copy_label: "Original Copy",
          company_name: "",
          company_address: "",
          udyam_no: "",
          phone: "",
          email: "",
        });
      }
    });
  }, [branchId, branches]);

  async function saveBranch() {
    if (!branch) return;
    const s = branch.state_code ? stateNameFromCode(branch.state_code) : branch.state_name;
    const { error } = await supabase.from("branches").update({
      gstin: branch.gstin,
      state_name: s,
      state_code: branch.state_code,
      pan: branch.pan,
      cin: branch.cin,
      email: branch.email,
      phone: branch.phone,
      address: branch.address,
      bank_name: branch.bank_name,
      bank_account: branch.bank_account,
      bank_ifsc: branch.bank_ifsc,
      bank_branch: branch.bank_branch,
      upi_id: branch.upi_id,
      logo_url: branch.logo_url,
      invoice_footer: branch.invoice_footer,
      is_default: branch.is_default,
    } as any).eq("id", branch.id);
    if (error) return toast.error(error.message);
    toast.success("Seller saved — GSTIN & bank updated");
    load();
  }

  async function saveSettings() {
    if (!settings) return;
    // validation
    if (!settings.prefix || !settings.prefix.trim()) return toast.error("Prefix is required — e.g. PHS/ or PHS/INV/");
    if (!settings.prefix.endsWith("/")) {
      toast.message("Tip: prefix should end with '/' — auto-appending");
      setSettings({ ...settings, prefix: settings.prefix.trim() + "/" });
      return;
    }
    if (settings.next_seq < 1 || settings.next_seq > 9999) return toast.error("Start No must be 1–9999");
    if (settings.prefix.includes("26-27") || settings.prefix.includes("25-26") || /\d{2}-\d{2}/.test(settings.prefix)) {
      toast.message("Prefix already contains FY (e.g. 26-27) — this will duplicate FY in preview");
    }
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
        place_of_supply_default: settings.place_of_supply_default,
        theme_color: settings.theme_color,
        copy_label: settings.copy_label,
        company_name: settings.company_name,
        company_address: settings.company_address,
        udyam_no: settings.udyam_no,
        phone: settings.phone,
        email: settings.email,
      };
      const { error, data } = settings.id
        ? await supabase.from("invoice_settings").update(payload).eq("id", settings.id).select().maybeSingle()
        : await supabase.from("invoice_settings").insert(payload).select().maybeSingle();
      if (error) throw error;
      if (data) setSettings(data as any);
      toast.success("Invoice settings saved");
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-muted-foreground">Loading settings…</div>;

  const codes = Object.entries(GSTIN_STATE_CODES).sort((a, b) => a[1].localeCompare(b[1]));

  // live preview for current branch
  const fy = settings?.current_fy || computeFY();
  const rawPreview = settings ? `${settings.prefix}${fy}/${String(settings.next_seq).padStart(4, "0")}` : "";
  const sanitized = rawPreview.replace(/\//g, "-");
  const sanitizedNic = sanitized.length > 16 ? sanitized.slice(-16) : sanitized;
  const isNicTruncated = sanitized.length > 16;
  const isFyDuplicated = settings ? /\d{2}-\d{2}/.test(settings.prefix) : false;
  const isLongForNic = sanitized.length > 16;
  const next3 = settings ? [0, 1, 2].map((i) => `${settings.prefix}${fy}/${String(Number(settings.next_seq) + i).padStart(4, "0")}`) : [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg bg-[#1f3864] text-white grid place-items-center"><Settings2 className="h-4 w-4" /></span>
            Sales Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Branch-wise seller identity, invoice numbering &amp; print appearance — single source of truth for Tally, PDF &amp; NIC.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-sm">
          <Warehouse className="h-4 w-4 text-muted-foreground" />
          <Label className="text-xs whitespace-nowrap">Supply From</Label>
          <select className="h-8 rounded-md border bg-background px-2 text-sm min-w-[180px]" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name} {(b as any).code ? `· ${(b as any).code}` : ""}</option>
            ))}
          </select>
        </div>
      </div>

      <CompanyProfileSettings canEdit={isAdmin} />
      <LetterheadSettingsPanel />

      {branch && (
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px] flex items-center gap-2"><Building2 className="h-4 w-4 text-[#1f3864]" /> Seller Identity — {branch.name}</CardTitle>
            <CardDescription className="text-xs">GSTIN &amp; state drive e-Invoice `SellerDtls` + e-Way `fromGstin`. Bank prints on PDF footer.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label className="text-xs">GSTIN</Label><Input className="font-mono text-xs" value={branch.gstin || ""} onChange={(e) => setBranch({ ...branch, gstin: e.target.value.toUpperCase(), state_code: stateCodeFromGSTIN(e.target.value) || branch.state_code })} placeholder="06AEHPA2697G1ZL" /></div>
            <div>
              <Label className="text-xs">State Code</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={branch.state_code || ""} onChange={(e) => setBranch({ ...branch, state_code: e.target.value, state_name: stateNameFromCode(e.target.value) })}>
                <option value="">—</option>
                {codes.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
              </select>
            </div>
            <div><Label className="text-xs">State</Label><Input value={branch.state_name || ""} onChange={(e) => setBranch({ ...branch, state_name: e.target.value })} /></div>
            <div><Label className="text-xs">PAN</Label><Input className="font-mono text-xs" value={branch.pan || ""} onChange={(e) => setBranch({ ...branch, pan: e.target.value.toUpperCase() })} placeholder="AEHPA2697G" /></div>
            <div><Label className="text-xs">CIN</Label><Input className="font-mono text-xs" value={branch.cin || ""} onChange={(e) => setBranch({ ...branch, cin: e.target.value.toUpperCase() })} /></div>
            <div><Label className="text-xs">Email</Label><Input value={branch.email || ""} onChange={(e) => setBranch({ ...branch, email: e.target.value })} /></div>
            <div><Label className="text-xs">Phone</Label><Input value={branch.phone || ""} onChange={(e) => setBranch({ ...branch, phone: e.target.value })} /></div>
            <div className="md:col-span-3"><Label className="text-xs">Address</Label><Textarea rows={2} value={branch.address || ""} onChange={(e) => setBranch({ ...branch, address: e.target.value })} placeholder="3C-58, BP, NIT-3, Faridabad, 121001, Haryana" /></div>
            <div><Label className="text-xs">Bank Name</Label><Input value={branch.bank_name || ""} onChange={(e) => setBranch({ ...branch, bank_name: e.target.value })} /></div>
            <div><Label className="text-xs">Bank Branch</Label><Input value={branch.bank_branch || ""} onChange={(e) => setBranch({ ...branch, bank_branch: e.target.value })} /></div>
            <div><Label className="text-xs">Account No.</Label><Input className="font-mono text-xs" value={branch.bank_account || ""} onChange={(e) => setBranch({ ...branch, bank_account: e.target.value })} /></div>
            <div><Label className="text-xs">IFSC</Label><Input className="font-mono text-xs" value={branch.bank_ifsc || ""} onChange={(e) => setBranch({ ...branch, bank_ifsc: e.target.value.toUpperCase() })} /></div>
            <div><Label className="text-xs">UPI ID</Label><Input value={branch.upi_id || ""} onChange={(e) => setBranch({ ...branch, upi_id: e.target.value })} /></div>
            <div className="flex items-end"><label className="text-xs flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!branch.is_default} onChange={(e) => setBranch({ ...branch, is_default: e.target.checked })} className="h-4 w-4" />Default seller for new invoices</label></div>
            <div className="md:col-span-3"><Label className="text-xs">Invoice Footer / Default Terms</Label><Textarea rows={2} value={branch.invoice_footer || ""} onChange={(e) => setBranch({ ...branch, invoice_footer: e.target.value })} /></div>
            <div className="md:col-span-3 flex justify-end"><Button size="sm" onClick={saveBranch} className="bg-[#1f3864] hover:bg-[#162a4a]"><Save className="h-3.5 w-3.5 mr-1.5" />Save Seller</Button></div>
          </CardContent>
        </Card>
      )}

      {settings && (
        <Card className="border-slate-200 overflow-hidden">
          <CardHeader className="pb-3 bg-gradient-to-r from-slate-50 to-white border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-[15px] flex items-center gap-2"><Hash className="h-4 w-4 text-[#1f3864]" /> Invoice Numbering — {branches.find((b)=>b.id===branchId)?.name}</CardTitle>
                <CardDescription className="text-xs mt-1">Prefix + FY + sequence → `invoice_no`. Trigger `set_invoice_no()` builds it on insert. Tally/PDF show original, NIC `DocDtls.No` is sanitized to ≤16.</CardDescription>
              </div>
              <Badge variant={isLongForNic ? "destructive" : "secondary"} className={isLongForNic ? "bg-amber-500 text-white" : "bg-emerald-600 text-white"}>{isLongForNic ? "NIC will truncate" : "NIC OK ≤16"}</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-5">
            {/* Main controls */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-4 space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Prefix</Label>
                <Input className="font-mono text-sm" value={settings.prefix} onChange={(e) => setSettings({ ...settings, prefix: e.target.value })} placeholder="PHS/" />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {["PHS/", "PHS/INV/", "PHS/EXP/"].map((p) => (
                    <button key={p} type="button" onClick={() => setSettings({ ...settings, prefix: p })} className={`px-2 py-1 rounded-full text-xs border ${settings.prefix===p ? "bg-[#1f3864] text-white border-[#1f3864]" : "bg-white hover:bg-slate-50"}`}>{p}</button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">Must end with `/`. Short `PHS/` → `PHS/26-27/0008` (14) fits NIC. `PHS/INV/` → `18` → truncated to `S-INV…`</p>
                {isFyDuplicated && <p className="text-[11px] text-amber-700 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Prefix already contains `YY-YY` — FY will duplicate (`PHS/26-27/`+`26-27`)</p>}
              </div>

              <div className="md:col-span-3 space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" /> Financial Year</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm font-mono" value={fy} onChange={(e) => setSettings({ ...settings, current_fy: e.target.value })}>
                  {fyOptions().map((f) => <option key={f} value={f}>{f} {f===computeFY() ? "· current" : ""}</option>)}
                </select>
                <label className="text-xs flex items-center gap-2 pt-1 cursor-pointer">
                  <input type="checkbox" checked={settings.fy_reset} onChange={(e) => setSettings({ ...settings, fy_reset: e.target.checked })} className="h-4 w-4" />
                  Reset sequence each FY (Apr–Mar)
                </label>
                <p className="text-[11px] text-muted-foreground">Current FY {computeFY()} — Apr 1 resets `next_seq→1` when `fy_reset` is on.</p>
              </div>

              <div className="md:col-span-2 space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5"><Hash className="h-3.5 w-3.5" /> Inv Start No</Label>
                <Input type="number" min={1} max={9999} className="font-mono" value={settings.next_seq} onChange={(e) => setSettings({ ...settings, next_seq: Math.max(1, Math.min(9999, Number(e.target.value) || 1)) })} />
                <p className="text-[11px] text-muted-foreground">Next invoice will be <span className="font-mono font-medium">{String(settings.next_seq).padStart(4,"0")}</span>. 4-digit padded.</p>
              </div>

              <div className="md:col-span-3">
                <div className="rounded-xl border bg-slate-50 p-3 space-y-2">
                  <div className="text-xs font-medium flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> Live Preview</div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">Tally / PDF / DB</div>
                    <div className="font-mono text-sm font-semibold tracking-tight bg-white border rounded-lg px-2.5 py-2 flex items-center justify-between">
                      <span>{rawPreview || "—"}</span>
                      <Badge variant="outline" className="font-mono text-[11px]">{rawPreview.length} chars</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-2">NIC `DocDtls.No` (portal)</div>
                    <div className={`font-mono text-sm font-semibold tracking-tight border rounded-lg px-2.5 py-2 flex items-center justify-between ${isNicTruncated ? "bg-amber-50 border-amber-200 text-amber-900" : "bg-emerald-50 border-emerald-200 text-emerald-900"}`}>
                      <span>{sanitizedNic || "—"}</span>
                      <span className="flex items-center gap-1.5">
                        {isNicTruncated ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        <span className="text-xs">{sanitizedNic.length}/16</span>
                      </span>
                    </div>
                    {isNicTruncated && <p className="text-[11px] text-amber-700">Will truncate suffix `…{sanitized.slice(-16)}` — printed `PHS/INV…` ≠ IRN `S-INV…`. Prefer `PHS/`.</p>}
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Info className="h-3 w-3" /> `"/"→"-"` for NIC, DB keeps `/`</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sequence preview strip */}
            <div className="rounded-xl border bg-white p-3">
              <div className="text-xs font-medium flex items-center gap-1.5 mb-2"><Sparkles className="h-3.5 w-3.5 text-[#1f3864]" /> Next 3 numbers</div>
              <div className="flex flex-wrap gap-2">
                {next3.map((n,i)=>(
                  <div key={n} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono ${i===0 ? "bg-[#1f3864] text-white border-[#1f3864]" : "bg-slate-50"}`}>
                    <span className={i===0 ? "text-white/70" : "text-muted-foreground"}>#{String(Number(settings.next_seq)+i).padStart(4,"0")}</span>
                    <span className="font-semibold">{n}</span>
                    {i===0 && <ArrowRight className="h-3 w-3 opacity-70" />}
                  </div>
                ))}
                <span className="text-[11px] text-muted-foreground self-center">FY {fy} · {settings.fy_reset ? "resets Apr 1" : "continuous"}</span>
              </div>
            </div>

            {/* Defaults */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label className="text-xs">Default Place of Supply</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={settings.place_of_supply_default || ""} onChange={(e) => setSettings({ ...settings, place_of_supply_default: e.target.value })}>
                  <option value="">—</option>
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="text-xs text-muted-foreground flex items-end pb-1">Used as fallback for `place_of_supply_code` when buyer GSTIN/state missing.</div>
              <div className="md:col-span-2"><Label className="text-xs">Default Terms &amp; Conditions</Label><Textarea rows={3} value={settings.terms_default || ""} onChange={(e) => setSettings({ ...settings, terms_default: e.target.value })} placeholder="e.g. Goods once sold not returned..." /></div>
              <div className="md:col-span-2"><Label className="text-xs">Default Notes</Label><Textarea rows={2} value={settings.notes_default || ""} onChange={(e) => setSettings({ ...settings, notes_default: e.target.value })} placeholder="Internal notes shown on draft" /></div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => setSettings({ ...settings, prefix: "PHS/", current_fy: computeFY(), next_seq: 1 })}>Reset to PHS/ · FY {computeFY()} · 0001</Button>
              <Button size="sm" onClick={saveSettings} disabled={saving} className="bg-[#1f3864] hover:bg-[#162a4a] min-w-[140px]">
                {saving ? "Saving…" : <><Save className="h-3.5 w-3.5 mr-1.5" />Save Numbering</>}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Format: <span className="font-mono font-medium">{`${settings.prefix}${fy}/0001`}</span> → next <span className="font-mono">{rawPreview}</span>. Existing invoices keep their stored `invoice_no`.</p>
          </CardContent>
        </Card>
      )}

      {settings && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-[15px]">Company Header (PDF)</CardTitle>
            <CardDescription className="text-xs">Shown on Invoice PDF header. Leave blank to fall back to branch. GSTIN always from branch.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2"><Label className="text-xs">Company Name</Label><Input value={settings.company_name || ""} placeholder="Prokon Hi-Tech Systems" onChange={(e) => setSettings({ ...settings, company_name: e.target.value })} /></div>
            <div><Label className="text-xs">Udyam No</Label><Input value={settings.udyam_no || ""} onChange={(e) => setSettings({ ...settings, udyam_no: e.target.value })} /></div>
            <div className="md:col-span-3"><Label className="text-xs">Company Address</Label><Textarea rows={2} value={settings.company_address || ""} placeholder="3C-58, BP, NIT-3, Faridabad-121001" onChange={(e) => setSettings({ ...settings, company_address: e.target.value })} /></div>
            <div><Label className="text-xs">Phone</Label><Input value={settings.phone || ""} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></div>
            <div className="md:col-span-2"><Label className="text-xs">Email</Label><Input value={settings.email || ""} onChange={(e) => setSettings({ ...settings, email: e.target.value })} /></div>
            <div className="md:col-span-3 text-xs text-muted-foreground">Leave blank to fall back to seller branch details above. GSTIN always comes from branch.</div>
            <div className="md:col-span-3 flex justify-end"><Button size="sm" onClick={saveSettings} disabled={saving} className="bg-[#1f3864] hover:bg-[#162a4a]">Save Company Header</Button></div>
          </CardContent>
        </Card>
      )}
      {settings && (
        <Card className="border-slate-200">
          <CardHeader className="pb-2"><CardTitle className="text-[15px]">Invoice Appearance</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs">Theme Color</Label>
              <div className="flex items-center gap-2">
                <input type="color" className="h-9 w-14 rounded border" value={settings.theme_color || "#000000"} onChange={(e) => setSettings({ ...settings, theme_color: e.target.value })} />
                <Input value={settings.theme_color || "#000000"} onChange={(e) => setSettings({ ...settings, theme_color: e.target.value })} className="font-mono text-xs" />
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
              <p className="text-[11px] text-muted-foreground mt-1">Default for new invoices</p>
            </div>
            <div className="md:col-span-2 flex gap-2">
              {["#000000", "#1f3864", "#7c2d12", "#065f46", "#7c3aed", "#b91c1c"].map((c) => (
                <button key={c} type="button" className="h-9 w-9 rounded-full border-2 shadow-sm" style={{ background: c, borderColor: c === (settings.theme_color || "") ? "#000" : "#e5e7eb" }} onClick={() => setSettings({ ...settings, theme_color: c })} aria-label={`Set ${c}`} />
              ))}
            </div>
            <div className="md:col-span-4 flex justify-end"><Button size="sm" onClick={saveSettings} disabled={saving} className="bg-[#1f3864] hover:bg-[#162a4a]">Save Appearance</Button></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
