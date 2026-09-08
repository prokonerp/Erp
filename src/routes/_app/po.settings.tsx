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
import { Building2, Upload, RotateCcw } from "lucide-react";
import {
  fetchCompanyProfile,
  DEFAULT_COMPANY_PROFILE,
  type CompanyProfile,
} from "@/lib/companyProfile";
import {
  PO_ADDRESS_OPTIONS,
  DEFAULT_PO_LOGO,
  resolvePoLetterhead,
  signPoLogoUrl,
  type PoAddressSource,
} from "@/lib/poPrint";

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
  logo_url: string | null;
  letterhead_address_source: string | null;
};

function POSettings() {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [settings, setSettings] = useState<POSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const [previewLogo, setPreviewLogo] = useState<string | null>(null);

  useEffect(() => {
    fetchBranches().then((bs) => {
      setBranches(bs);
      if (!branchId && bs.length) setBranchId(bs[0].id);
      setLoading(false);
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!branchId) return;
    (supabase as any)
      .from("po_settings")
      .select("*")
      .eq("branch_id", branchId)
      .maybeSingle()
      .then(({ data }: any) => {
        setSettings(
          data ?? {
            branch_id: branchId,
            prefix: "PROKON/PO/",
            fy_reset: true,
            next_seq: 1,
            terms_default: "",
            notes_default: "",
            logo_url: null,
            letterhead_address_source: "branch",
          },
        );
      });
  }, [branchId]);

  useEffect(() => {
    fetchCompanyProfile()
      .then(setCompany)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!settings?.logo_url) {
      setPreviewLogo(null);
      return;
    }
    signPoLogoUrl(settings.logo_url)
      .then(setPreviewLogo)
      .catch(() => setPreviewLogo(null));
  }, [settings?.logo_url]);

  async function save() {
    if (!settings) return;
    const payload = { ...settings };
    const { error } = settings.id
      ? await (supabase as any).from("po_settings").update(payload).eq("id", settings.id)
      : await (supabase as any).from("po_settings").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/i.test(file.type))
      return toast.error("Only PNG or JPG images are allowed");
    if (file.size > 2 * 1024 * 1024) return toast.error("Max file size is 2 MB");
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `po-logos/${branchId}.${ext}`;
    try {
      const { error: upErr } = await supabase.storage
        .from("po-logos")
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: true });
      if (upErr) throw upErr;
      setSettings((s) => (s ? { ...s, logo_url: path } : s));
      const signed = await signPoLogoUrl(path);
      setPreviewLogo(signed);
      toast.success("Logo uploaded — will appear on printed POs for this branch");
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
    }
    e.target.value = "";
  }

  async function handleLogoReset() {
    if (!settings) return;
    setSettings((s) => (s ? { ...s, logo_url: null } : s));
    setPreviewLogo(null);
    toast.info("Logo reset to default (preloaded Prokon logo)");
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4 max-w-4xl">
      <h2 className="text-lg font-semibold">Purchase Order Settings</h2>

      <div className="flex items-center gap-2">
        <Label className="text-xs">Branch:</Label>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {settings && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">PO Numbering</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Prefix</Label>
              <Input
                value={settings.prefix}
                onChange={(e) => setSettings({ ...settings, prefix: e.target.value })}
                placeholder="PROKON/PO/"
              />
            </div>
            <div>
              <Label className="text-xs">Next Sequence</Label>
              <Input
                type="number"
                value={settings.next_seq}
                onChange={(e) => setSettings({ ...settings, next_seq: Number(e.target.value) })}
              />
            </div>
            <div className="flex items-end">
              <label className="text-xs flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.fy_reset}
                  onChange={(e) => setSettings({ ...settings, fy_reset: e.target.checked })}
                />
                Reset each FY (Apr–Mar)
              </label>
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">Default Terms & Conditions</Label>
              <Textarea
                rows={3}
                value={settings.terms_default || ""}
                onChange={(e) => setSettings({ ...settings, terms_default: e.target.value })}
              />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs">Default Notes</Label>
              <Textarea
                rows={2}
                value={settings.notes_default || ""}
                onChange={(e) => setSettings({ ...settings, notes_default: e.target.value })}
              />
            </div>
            <div className="md:col-span-3 flex justify-end">
              <Button size="sm" onClick={save}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {settings && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" /> Print Settings (Letterhead)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Logo and office address used on printed Purchase Order PDFs for this branch.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ── Logo ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Letterhead Logo</Label>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-16 border rounded bg-white flex items-center justify-center overflow-hidden shrink-0">
                    {previewLogo || DEFAULT_PO_LOGO ? (
                      <img
                        src={previewLogo || DEFAULT_PO_LOGO}
                        alt="PO letterhead logo"
                        className="max-w-full max-h-full object-contain"
                        onError={() => setPreviewLogo(null)}
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">No logo</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer bg-secondary hover:bg-secondary/80 text-secondary-foreground px-3 py-1.5 rounded text-xs font-medium">
                      <Upload className="h-3 w-3" /> Upload Logo
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        className="sr-only"
                        onChange={handleLogoUpload}
                      />
                    </label>
                    {settings?.logo_url && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={handleLogoReset}
                      >
                        <RotateCcw className="h-3 w-3" /> Reset to default
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {settings?.logo_url
                    ? "Using uploaded logo"
                    : "Using preloaded Prokon logo (default)"}{" "}
                  · PNG/JPG, max 2 MB
                </p>
              </div>

              {/* ── Office Address ── */}
              <div className="space-y-2">
                <Label className="text-xs font-medium">Letterhead Office Address</Label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                  value={settings?.letterhead_address_source ?? "branch"}
                  onChange={(e) => {
                    const src = e.target.value as PoAddressSource;
                    setSettings((s) => (s ? { ...s, letterhead_address_source: src } : s));
                  }}
                >
                  {PO_ADDRESS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div className="text-xs bg-muted/50 p-2 rounded whitespace-pre-line min-h-[3rem]">
                  {(() => {
                    const lh = resolvePoLetterhead({
                      source: (settings?.letterhead_address_source as PoAddressSource) ?? "branch",
                      branch: branches.find((b) => b.id === branchId) ?? null,
                      company,
                    });
                    return (
                      lh.address || (
                        <span className="text-muted-foreground italic">
                          No address configured for {lh.officialLabel}
                        </span>
                      )
                    );
                  })()}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  From{" "}
                  {(() => {
                    const lh = resolvePoLetterhead({
                      source: (settings?.letterhead_address_source as PoAddressSource) ?? "branch",
                      branch: branches.find((b) => b.id === branchId) ?? null,
                      company,
                    });
                    return lh.officialLabel;
                  })()}{" "}
                  · shown on printed POs for this branch
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={save}>
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Format:{" "}
        <span className="font-mono">{`${settings?.prefix || "PROKON/PO/"}${settings?.fy_reset ? "YY-YY/" : "YYYY/"}0001`}</span>
        . Numbers auto-assign per branch on save.
      </p>
    </div>
  );
}
