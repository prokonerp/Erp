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
import { INDIAN_STATES, GSTIN_STATE_CODES } from "@/lib/india";
import { stateCodeFromGSTIN, stateNameFromCode } from "@/lib/gst";

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

function SalesSettings() {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

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
      setSettings(data ? (data as any) : {
        branch_id: branchId, prefix: "PHS/INV/", fy_reset: true, next_seq: 1,
        terms_default: "", notes_default: "", place_of_supply_default: "",
        theme_color: "#000000", copy_label: "Original Copy",
        company_name: "", company_address: "", udyam_no: "", phone: "", email: "",
      });
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
    toast.success("Branch saved");
    load();
  }

  async function saveSettings() {
    if (!settings) return;
    const payload = { ...settings };
    const { error } = settings.id
      ? await supabase.from("invoice_settings").update(payload).eq("id", settings.id)
      : await supabase.from("invoice_settings").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
  }

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const codes = Object.entries(GSTIN_STATE_CODES).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-2xl font-bold">Sales Settings</h1>

      <div className="flex items-center gap-2">
        <Label className="text-xs">Branch:</Label>
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {branch && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Seller Identity (Branch)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label className="text-xs">GSTIN</Label><Input value={branch.gstin || ""} onChange={(e) => setBranch({ ...branch, gstin: e.target.value.toUpperCase(), state_code: stateCodeFromGSTIN(e.target.value) || branch.state_code })} /></div>
            <div>
              <Label className="text-xs">State Code</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={branch.state_code || ""} onChange={(e) => setBranch({ ...branch, state_code: e.target.value, state_name: stateNameFromCode(e.target.value) })}>
                <option value="">—</option>
                {codes.map(([c, n]) => <option key={c} value={c}>{c} — {n}</option>)}
              </select>
            </div>
            <div><Label className="text-xs">State</Label><Input value={branch.state_name || ""} onChange={(e) => setBranch({ ...branch, state_name: e.target.value })} /></div>
            <div><Label className="text-xs">PAN</Label><Input value={branch.pan || ""} onChange={(e) => setBranch({ ...branch, pan: e.target.value.toUpperCase() })} /></div>
            <div><Label className="text-xs">CIN</Label><Input value={branch.cin || ""} onChange={(e) => setBranch({ ...branch, cin: e.target.value.toUpperCase() })} /></div>
            <div><Label className="text-xs">Email</Label><Input value={branch.email || ""} onChange={(e) => setBranch({ ...branch, email: e.target.value })} /></div>
            <div><Label className="text-xs">Phone</Label><Input value={branch.phone || ""} onChange={(e) => setBranch({ ...branch, phone: e.target.value })} /></div>
            <div className="md:col-span-3"><Label className="text-xs">Address</Label><Textarea rows={2} value={branch.address || ""} onChange={(e) => setBranch({ ...branch, address: e.target.value })} /></div>
            <div><Label className="text-xs">Bank Name</Label><Input value={branch.bank_name || ""} onChange={(e) => setBranch({ ...branch, bank_name: e.target.value })} /></div>
            <div><Label className="text-xs">Bank Branch</Label><Input value={branch.bank_branch || ""} onChange={(e) => setBranch({ ...branch, bank_branch: e.target.value })} /></div>
            <div><Label className="text-xs">Account No.</Label><Input value={branch.bank_account || ""} onChange={(e) => setBranch({ ...branch, bank_account: e.target.value })} /></div>
            <div><Label className="text-xs">IFSC</Label><Input value={branch.bank_ifsc || ""} onChange={(e) => setBranch({ ...branch, bank_ifsc: e.target.value.toUpperCase() })} /></div>
            <div><Label className="text-xs">UPI ID</Label><Input value={branch.upi_id || ""} onChange={(e) => setBranch({ ...branch, upi_id: e.target.value })} /></div>
            <div className="flex items-end"><label className="text-xs flex items-center gap-2"><input type="checkbox" checked={!!branch.is_default} onChange={(e) => setBranch({ ...branch, is_default: e.target.checked })} />Default seller for new invoices</label></div>
            <div className="md:col-span-3"><Label className="text-xs">Invoice Footer / Default Terms</Label><Textarea rows={2} value={branch.invoice_footer || ""} onChange={(e) => setBranch({ ...branch, invoice_footer: e.target.value })} /></div>
            <div className="md:col-span-3 flex justify-end"><Button size="sm" onClick={saveBranch}>Save Seller</Button></div>
          </CardContent>
        </Card>
      )}

      {settings && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Company Header (shown on Invoice PDF)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2"><Label className="text-xs">Company Name</Label><Input value={settings.company_name || ""} placeholder="Prokon Hi-Tech Systems" onChange={(e) => setSettings({ ...settings, company_name: e.target.value })} /></div>
            <div><Label className="text-xs">Udyam No</Label><Input value={settings.udyam_no || ""} onChange={(e) => setSettings({ ...settings, udyam_no: e.target.value })} /></div>
            <div className="md:col-span-3"><Label className="text-xs">Company Address</Label><Textarea rows={2} value={settings.company_address || ""} placeholder="3C-58, BP, NIT-3, Faridabad-121001" onChange={(e) => setSettings({ ...settings, company_address: e.target.value })} /></div>
            <div><Label className="text-xs">Phone</Label><Input value={settings.phone || ""} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></div>
            <div className="md:col-span-2"><Label className="text-xs">Email</Label><Input value={settings.email || ""} onChange={(e) => setSettings({ ...settings, email: e.target.value })} /></div>
            <div className="md:col-span-3 text-xs text-muted-foreground">Leave blank to fall back to the Seller (Branch) details above. GSTIN always comes from the Seller/Branch.</div>
            <div className="md:col-span-3 flex justify-end"><Button size="sm" onClick={saveSettings}>Save Company Header</Button></div>
          </CardContent>
        </Card>
      )}
      {settings && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Invoice Numbering</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><Label className="text-xs">Prefix</Label><Input value={settings.prefix} onChange={(e) => setSettings({ ...settings, prefix: e.target.value })} /></div>
            <div><Label className="text-xs">Next Sequence</Label><Input type="number" value={settings.next_seq} onChange={(e) => setSettings({ ...settings, next_seq: Number(e.target.value) })} /></div>
            <div className="flex items-end"><label className="text-xs flex items-center gap-2"><input type="checkbox" checked={settings.fy_reset} onChange={(e) => setSettings({ ...settings, fy_reset: e.target.checked })} />Reset each FY (Apr–Mar)</label></div>
            <div>
              <Label className="text-xs">Default Place of Supply</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={settings.place_of_supply_default || ""} onChange={(e) => setSettings({ ...settings, place_of_supply_default: e.target.value })}>
                <option value="">—</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="md:col-span-4"><Label className="text-xs">Default Terms & Conditions</Label><Textarea rows={3} value={settings.terms_default || ""} onChange={(e) => setSettings({ ...settings, terms_default: e.target.value })} /></div>
            <div className="md:col-span-4"><Label className="text-xs">Default Notes</Label><Textarea rows={2} value={settings.notes_default || ""} onChange={(e) => setSettings({ ...settings, notes_default: e.target.value })} /></div>
            <div className="md:col-span-4 flex justify-end"><Button size="sm" onClick={saveSettings}>Save Numbering</Button></div>
          </CardContent>
        </Card>
      )}

      {settings && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Invoice Appearance</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs">Theme Color (borders + accents)</Label>
              <div className="flex items-center gap-2">
                <input type="color" className="h-9 w-14 rounded border" value={settings.theme_color || "#000000"} onChange={(e) => setSettings({ ...settings, theme_color: e.target.value })} />
                <Input value={settings.theme_color || "#000000"} onChange={(e) => setSettings({ ...settings, theme_color: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Copy Label (top-right)</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={settings.copy_label || "Original Copy"} onChange={(e) => setSettings({ ...settings, copy_label: e.target.value })}>
                <option>Original Copy</option>
                <option>Duplicate Copy</option>
                <option>Triplicate Copy</option>
                <option>Office Copy</option>
              </select>
            </div>
            <div className="md:col-span-2 flex gap-2">
              {["#000000", "#1f3864", "#7c2d12", "#065f46", "#7c3aed", "#b91c1c"].map((c) => (
                <button key={c} type="button" className="h-9 w-9 rounded border" style={{ background: c, borderColor: c === (settings.theme_color || "") ? "#000" : "#ccc", borderWidth: c === (settings.theme_color || "") ? 2 : 1 }} onClick={() => setSettings({ ...settings, theme_color: c })} aria-label={`Set color ${c}`} />
              ))}
            </div>
            <div className="md:col-span-4 flex justify-end"><Button size="sm" onClick={saveSettings}>Save Appearance</Button></div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Format: <span className="font-mono">{`${settings?.prefix || "PHS/INV/"}${settings?.fy_reset ? "YY-YY/" : "YYYY/"}0001`}</span>. New invoices auto-pick the next sequence per branch.
      </p>
    </div>
  );
}