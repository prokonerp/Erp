import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Eye, Mail, MessageCircle, Plus, Printer, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type Amc, type AmcUnit, addYears, amcStatus, fmtDate, generatePMDates, statusBadgeClass, statusLabel } from "@/lib/amc";
import { AgreementDocUpload } from "@/components/AgreementDocUpload";
import { getOemLogo } from "@/lib/oemLogos";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";

export const Route = createFileRoute("/_app/amc/$id")({
  component: AmcDetail,
  head: () => ({ meta: [{ title: "AMC Agreement — Prokon" }] }),
});

function AmcDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [a, setA] = useState<Amc | null>(null);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string | null; model: string | null; category: string | null; brand: string | null }>>([]);
  const [serials, setSerials] = useState<Array<{ id: string; serial_number: string; product_id: string }>>([]);
  const [oemBrands, setOemBrands] = useState<string[]>([]);
  const [company, setCompany] = useState<{ name: string; address: string | null; phone: string | null; email: string | null; website: string | null; gstin: string | null } | null>(null);

  const load = () => supabase.from("amcs").select("*").eq("id", id).single()
    .then(({ data }) => setA(data as unknown as Amc));

  useEffect(() => {
    load();
    supabase.from("product_categories").select("name").order("name").then(({ data }) => {
      setCategories(((data || []) as { name: string }[]).map((c) => c.name));
    });
    supabase.from("products").select("id,name,model,category,brand").eq("active", true).order("name").then(({ data }) => {
      setProducts((data || []) as Array<{ id: string; name: string | null; model: string | null; category: string | null; brand: string | null }>);
    });
    supabase.from("serials").select("id,serial_number,product_id").order("serial_number").then(({ data }) => {
      setSerials((data || []) as Array<{ id: string; serial_number: string; product_id: string }>);
    });
    supabase.from("oem_brand_master").select("name").order("name").then(({ data }) => {
      setOemBrands(((data || []) as { name: string }[]).map((b) => b.name));
    });
    supabase.from("companies").select("name,address,phone,email,website,gstin").order("created_at").limit(1).maybeSingle().then(({ data }) => {
      setCompany((data as typeof company) ?? null);
    });
    /* eslint-disable-next-line */
  }, [id]);

  if (!a) return <div className="text-muted-foreground">Loading…</div>;

  const status = amcStatus(a.end_date);

  const update = (patch: Partial<Amc>) => setA({ ...a, ...patch });

  // ---- Reminder messages (WhatsApp + Email) ----
  const nextPm = (a.pm_dates || []).find((d) => new Date(d + "T00:00:00") >= new Date(new Date().toDateString()));
  const unitList = a.units.map((u, i) => `${i + 1}. ${u.model} (S/N: ${u.serial_no})`).join("\n");
  const greeting = `Dear ${a.client_name || "Customer"}${a.client_company ? ` / ${a.client_company} Team` : " Team"},`;
  const signOff =
    `\n\nRegards,\nProkon Hi-Tech Systems\nB-505, Picasso Centre, Sector-61, Gurgaon` +
    `\nPhone: +91-9810000000   |   Email: info@prokonhitech.com`;

  const renewalMsg =
    `${greeting}\n\nThis is a gentle reminder that your AMC (Agreement No: ${a.agreement_no}) with Prokon Hi-Tech Systems ` +
    `is ${status === "expired" ? `expired on ${fmtDate(a.end_date)}` : `due for renewal on ${fmtDate(a.end_date)}`}.\n\n` +
    `Equipment Covered:\n${unitList}\n\n` +
    `Kindly confirm renewal at the earliest to ensure uninterrupted service coverage.${signOff}`;

  const pmMsg =
    `${greeting}\n\nAs per your AMC (Agreement No: ${a.agreement_no}), your next scheduled Preventive Maintenance visit is on ` +
    `${nextPm ? fmtDate(nextPm) : "the upcoming PM date"}.\n\nEquipment Covered:\n${unitList}\n\n` +
    `Our engineer will reach out to confirm the slot. Please let us know if you'd like to reschedule.${signOff}`;

  const sendWhatsapp = (body: string) => {
    const raw = (a.contact_no || "").replace(/\D/g, "");
    if (!raw) return toast.error("No contact number on file");
    const phone = raw.length === 10 ? `91${raw}` : raw;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(body)}`, "_blank");
  };
  const sendEmail = (subject: string, body: string) => {
    if (!a.email) return toast.error("No email on file");
    window.location.href = `mailto:${a.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const save = async () => {
    setBusy(true);
    if (a.oem_call) {
      if (!a.oem_brand || !a.oem_brand.trim()) { setBusy(false); return toast.error("OEM Brand is required when Registered with OEM"); }
      if (!a.oem_ref_id || !a.oem_ref_id.trim()) { setBusy(false); return toast.error("OEM Agreement Number is required when Registered with OEM"); }
    }
    // recompute end_date and pm_dates if start_date or duration changed (kept editable below)
    const end_date = addYears(a.start_date, a.duration_years);
    const payload = {
      agreement_no: a.agreement_no,
      client_name: a.client_name,
      client_company: a.client_company,
      client_address: a.client_address,
      client_gst: a.client_gst,
      contact_no: a.contact_no,
      email: a.email,
      units: a.units,
      start_date: a.start_date,
      end_date,
      duration_years: a.duration_years,
      amc_value: a.amc_value,
      terms: a.terms,
      pm_dates: generatePMDates(a.start_date, end_date),
      remarks: a.remarks,
      oem_call: a.oem_call ?? false,
      oem_brand: a.oem_call ? (a.oem_brand || null) : null,
      oem_ref_id: a.oem_call ? (a.oem_ref_id || null) : null,
      oem_purchase_date: a.oem_call ? (a.oem_purchase_date || null) : null,
      agreement_doc_path: a.agreement_doc_path ?? null,
    };
    const { error } = await supabase.from("amcs").update(payload as never).eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    load();
  };

  const renew = async () => {
    if (!confirm(`Create a renewal AMC for ${a.client_name}?`)) return;
    setBusy(true);
    const startNew = a.end_date; // continues from previous end
    const next = new Date(startNew + "T00:00:00");
    next.setDate(next.getDate() + 1);
    const startStr = next.toISOString().slice(0, 10);
    const endStr = addYears(startStr, a.duration_years);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("amcs").insert({
      // agreement_no auto-generated by trigger
      client_name: a.client_name,
      client_company: a.client_company,
      client_address: a.client_address,
      client_gst: a.client_gst,
      contact_no: a.contact_no,
      email: a.email,
      units: a.units,
      start_date: startStr,
      end_date: endStr,
      duration_years: a.duration_years,
      amc_value: a.amc_value,
      terms: a.terms,
      pm_dates: generatePMDates(startStr, endStr),
      prev_amc_id: a.id,
      created_by: userData.user?.id ?? null,
    } as never).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Renewal AMC created");
    navigate({ to: "/amc/$id", params: { id: (data as { id: string }).id } });
  };

  const setUnit = (i: number, patch: Partial<AmcUnit>) =>
    update({ units: a.units.map((u, idx) => idx === i ? { ...u, ...patch } : u) });

  const openPreview = () => {
    const node = document.querySelector(".agreement-print");
    if (!node) {
      toast.error("Preview content not ready yet");
      return;
    }
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Popup blocked — please allow popups for this site");
      return;
    }
    const headHtml = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'))
      .map((el) => el.outerHTML)
      .join("\n");
    const body = (node as HTMLElement).outerHTML;
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"/>
<title>AMC Preview — ${a.agreement_no}</title>
${headHtml}
<style>
  html,body{background:#f4f4f5;margin:0;padding:24px;}
  .agreement-print{display:block !important;background:white;box-shadow:0 4px 24px rgba(0,0,0,.08);}
  @page{size:A4 portrait;margin:12mm;}
  @media print{html,body{background:white;padding:0;} .agreement-print{box-shadow:none;}}
  .preview-bar{position:sticky;top:0;background:#1e40af;color:white;padding:8px 16px;display:flex;gap:8px;justify-content:flex-end;margin:-24px -24px 16px;}
  .preview-bar button{background:white;color:#1e40af;border:0;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer;font-size:13px;}
  @media print{.preview-bar{display:none;}}
</style>
</head><body>
<div class="preview-bar"><button onclick="window.print()">Print / Save as PDF</button><button onclick="window.close()">Close</button></div>
${body}
</body></html>`);
    w.document.close();
  };

  return (
    <>
      <div className="space-y-4 print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Link to="/amc"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
          <div className="flex items-center gap-2">
            <span className={`text-xs border rounded px-2 py-0.5 ${statusBadgeClass(status)}`}>{statusLabel(status)}</span>
            <Button variant="outline" size="sm" onClick={openPreview}><Eye className="h-4 w-4 mr-1" />Review Preview</Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print Agreement</Button>
            <Button variant="outline" size="sm" onClick={renew} disabled={busy}><RefreshCw className="h-4 w-4 mr-1" />Renew AMC</Button>
            <Button size="sm" onClick={save} disabled={busy}><Save className="h-4 w-4 mr-1" />Save changes</Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>OEM Registration</span>
              <div className="flex items-center gap-2 text-sm font-normal">
                <Label htmlFor="oem-toggle-edit">Registered with OEM</Label>
                <Switch id="oem-toggle-edit" checked={!!a.oem_call} onCheckedChange={(v) => update({ oem_call: v })} />
                <span className="text-xs text-muted-foreground">{a.oem_call ? "Yes" : "No"}</span>
              </div>
            </CardTitle>
          </CardHeader>
          {a.oem_call && (
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>OEM Brand *</Label>
                <Select
                  value={a.oem_brand || ""}
                  onValueChange={async (v) => {
                    if (v === "__add__") {
                      const name = window.prompt("New OEM brand name")?.trim();
                      if (!name) return;
                      const { error } = await supabase.from("oem_brand_master").insert({ name } as never);
                      if (error) { toast.error(error.message); return; }
                      setOemBrands((arr) => Array.from(new Set([...arr, name])).sort());
                      update({ oem_brand: name });
                      toast.success("OEM brand added");
                    } else {
                      update({ oem_brand: v });
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select OEM brand" /></SelectTrigger>
                  <SelectContent>
                    {oemBrands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    <SelectItem value="__add__">+ Add New OEM Brand</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>OEM Agreement Number *</Label>
                <Input value={a.oem_ref_id || ""} onChange={(e) => update({ oem_ref_id: e.target.value.toUpperCase() })} placeholder="e.g. APC-2026-AB12345" className="font-mono" />
              </div>
              <div>
                <Label>OEM Purchase Date</Label>
                <Input type="date" value={a.oem_purchase_date || ""} onChange={(e) => update({ oem_purchase_date: e.target.value })} />
              </div>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle>Agreement Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Agreement No.</Label><Input value={a.agreement_no} onChange={(e) => update({ agreement_no: e.target.value })} /></div>
            <div>
              <Label>Duration</Label>
              <Select value={String(a.duration_years)} onValueChange={(v) => update({ duration_years: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 5].map((y) => <SelectItem key={y} value={String(y)}>{y} Year{y > 1 ? "s" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Start Date (DD-MM-YYYY)</Label><Input type="date" value={a.start_date} onChange={(e) => update({ start_date: e.target.value })} /><p className="text-xs text-muted-foreground mt-1">{fmtDate(a.start_date)}</p></div>
            <div><Label>End Date (auto on save)</Label><Input value={fmtDate(addYears(a.start_date, a.duration_years))} readOnly className="bg-muted" /></div>
            <div><Label>Client Name</Label><Input value={a.client_name} onChange={(e) => update({ client_name: e.target.value })} /></div>
            <div><Label>Company</Label><Input value={a.client_company || ""} onChange={(e) => update({ client_company: e.target.value })} /></div>
            <div className="md:col-span-2"><Label>Billing Address</Label><Textarea rows={2} value={a.client_address || ""} onChange={(e) => update({ client_address: e.target.value })} /></div>
            <div><Label>GSTIN</Label><Input value={a.client_gst || ""} onChange={(e) => update({ client_gst: e.target.value })} /></div>
            <div><Label>Contact No.</Label><Input value={a.contact_no || ""} onChange={(e) => update({ contact_no: e.target.value })} /></div>
            <div><Label>Email</Label><Input value={a.email || ""} onChange={(e) => update({ email: e.target.value })} /></div>
            <div><Label>AMC Value (₹)</Label><Input type="number" value={a.amc_value ?? 0} onChange={(e) => update({ amc_value: Number(e.target.value) })} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Product Details</CardTitle>
            <Button size="sm" variant="outline" onClick={() => update({ units: [...a.units, { model: "", serial_no: "", category: "", product_id: "" }] })}><Plus className="h-4 w-4 mr-1" />Add unit</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {a.units.map((u, i) => (
              <EditProductRow
                key={i}
                unit={u}
                categories={categories}
                products={products}
                serials={serials}
                onChange={(patch) => setUnit(i, patch)}
                onRemove={() => update({ units: a.units.filter((_, idx) => idx !== i) })}
                canRemove={a.units.length > 1}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Terms & Conditions (editable for this agreement)</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={12} value={a.terms || ""} onChange={(e) => update({ terms: e.target.value })} className="font-mono text-xs" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Agreement Attachment</CardTitle></CardHeader>
          <CardContent>
            <AgreementDocUpload
              amcId={a.id}
              path={a.agreement_doc_path ?? null}
              onChange={async (p) => {
                update({ agreement_doc_path: p });
                // persist immediately so refresh keeps the link
                await supabase.from("amcs").update({ agreement_doc_path: p } as never).eq("id", a.id);
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Scheduled PM Visits</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 text-xs">
              {(a.pm_dates || []).map((d, i) => (
                <span key={i} className="font-mono px-2 py-1 rounded border bg-muted">{fmtDate(d)}</span>
              ))}
              {(a.pm_dates || []).length === 0 && <span className="text-muted-foreground">No PM dates scheduled</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-2">PM dates are auto-regenerated quarterly when you change start date or duration and Save.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Send Reminder to Client</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="text-xs text-muted-foreground">
              WhatsApp uses contact <b>{a.contact_no || "—"}</b>. Email uses <b>{a.email || "—"}</b>. Edit them above & Save if missing.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border rounded-md p-3 space-y-2">
                <div className="font-semibold text-sm">AMC Renewal Reminder</div>
                <pre className="whitespace-pre-wrap text-[11px] font-sans bg-muted/40 rounded p-2 max-h-40 overflow-auto">{renewalMsg}</pre>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => sendWhatsapp(renewalMsg)}>
                    <MessageCircle className="h-4 w-4 mr-1" />WhatsApp
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sendEmail(`AMC Renewal Reminder — ${a.agreement_no}`, renewalMsg)}>
                    <Mail className="h-4 w-4 mr-1" />Email
                  </Button>
                </div>
              </div>
              <div className="border rounded-md p-3 space-y-2">
                <div className="font-semibold text-sm">Quarterly PM Reminder {nextPm ? `(${nextPm})` : ""}</div>
                <pre className="whitespace-pre-wrap text-[11px] font-sans bg-muted/40 rounded p-2 max-h-40 overflow-auto">{pmMsg}</pre>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => sendWhatsapp(pmMsg)}>
                    <MessageCircle className="h-4 w-4 mr-1" />WhatsApp
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => sendEmail(`PM Visit Reminder — ${a.agreement_no}`, pmMsg)}>
                    <Mail className="h-4 w-4 mr-1" />Email
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Print view */}
      <PrintAgreement a={a} company={company} />

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body { background: white !important; }
          .no-print, header, nav { display: none !important; }
        }
        .agreement-print { display: none; }
        @media print { .agreement-print { display: block !important; } }
      `}</style>
    </>
  );
}

function PrintAgreement({ a, company }: { a: Amc; company: { name: string; address: string | null; phone: string | null; email: string | null; website: string | null; gstin: string | null } | null }) {
  const co = company ?? { name: "PROKON HI-TECH SYSTEMS", address: "B-505, Picasso Centre, Sector-61, Gurgaon", phone: "+91-98100 00000", email: "info@prokonhitech.com", website: "www.prokonhitech.com", gstin: null };
  const oemLogo = getOemLogo(a.oem_brand);
  return (
    <div className="agreement-print bg-white text-black mx-auto max-w-3xl p-6 text-[12px] leading-relaxed">
      {/* Letterhead: strict 50/50 split — logos left, company info centered */}
      <div className="grid grid-cols-2 gap-0 border-b-4 border-[#1e40af] pb-3 mb-2 items-center w-full">
        <div className="flex flex-col items-start justify-center gap-2 pr-2">
          <img
            src={prokonLogo.url}
            alt="Prokon Hi-Tech Systems"
            className="h-16 max-w-[192px] object-contain"
          />
          {oemLogo && (
            <img
              src={oemLogo.url}
              alt={oemLogo.alt}
              className="h-16 max-w-[192px] object-contain"
            />
          )}
        </div>
        <div className="flex flex-col items-center justify-center text-center pl-2">
          <h1 className="text-2xl font-extrabold tracking-tight uppercase text-black leading-tight">Prokon Hi-Tech Systems</h1>
          {co.address && <div className="text-[11px] text-gray-800 whitespace-pre-wrap">{co.address}</div>}
          {co.phone && <div className="text-[11px] text-gray-800">Phone: {co.phone}</div>}
          {co.email && <div className="text-[11px] text-gray-800">Email: {co.email}</div>}
          {co.website && <div className="text-[11px] text-gray-800">Website: {co.website}</div>}
          {co.gstin && <div className="text-[11px] text-gray-800">GSTIN: <span className="font-mono">{co.gstin}</span></div>}
        </div>
      </div>
      <div className="text-center mb-3">
        <div className="inline-block px-4 py-1 border-2 border-black font-bold tracking-widest text-sm">ANNUAL MAINTENANCE CONTRACT</div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
        <div><b>Agreement No:</b> {a.agreement_no}</div>
        <div className="text-right"><b>Date:</b> {fmtDate(new Date().toISOString().slice(0, 10))}</div>
        <div><b>Start:</b> {fmtDate(a.start_date)}</div>
        <div className="text-right"><b>End:</b> {fmtDate(a.end_date)}</div>
        <div><b>Duration:</b> {a.duration_years} Year(s)</div>
        <div className="text-right"><b>AMC Value:</b> ₹ {Number(a.amc_value || 0).toLocaleString("en-IN")}</div>
      </div>

      <table className="w-full border border-black mb-3">
        <tbody>
          <tr><td className="border border-black px-2 py-1 w-32 font-bold">Client</td><td className="border border-black px-2 py-1">{a.client_company || a.client_name}</td></tr>
          <tr><td className="border border-black px-2 py-1 font-bold">Billing Address</td><td className="border border-black px-2 py-1 whitespace-pre-wrap">{a.client_address || "-"}</td></tr>
          <tr><td className="border border-black px-2 py-1 font-bold">GSTIN</td><td className="border border-black px-2 py-1">{a.client_gst || "-"}</td></tr>
          <tr><td className="border border-black px-2 py-1 font-bold">Contact</td><td className="border border-black px-2 py-1">{[a.contact_no, a.email].filter(Boolean).join("  /  ") || "-"}</td></tr>
        </tbody>
      </table>

      <div className="font-bold mb-1">Equipment Covered</div>
      <table className="w-full border border-black mb-3">
        <thead className="bg-gray-100"><tr><th className="border border-black px-2 py-1 w-10">#</th><th className="border border-black px-2 py-1">UPS Model</th><th className="border border-black px-2 py-1">Serial No.</th></tr></thead>
        <tbody>
          {a.units.map((u, i) => (
            <tr key={i}><td className="border border-black px-2 py-1 text-center">{i + 1}</td><td className="border border-black px-2 py-1">{u.model}</td><td className="border border-black px-2 py-1">{u.serial_no}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="font-bold mb-1">Scope of Work</div>
      <p className="mb-3">
        Comprehensive preventive and breakdown maintenance for the equipment listed above for the contract period
        <b> {fmtDate(a.start_date)}</b> to <b>{fmtDate(a.end_date)}</b>. Coverage includes scheduled quarterly preventive maintenance visits,
        on-call breakdown attendance within 24 hours on working days, diagnostic checks, firmware updates and minor
        adjustments. Consumable / faulty replacement parts are billed separately unless specifically included in the AMC value.
      </p>

      <div className="font-bold mb-1">Tentative Service Schedule (Preventive Maintenance Visits)</div>
      {(a.pm_dates || []).length > 0 ? (
        <table className="w-full border border-black mb-3">
          <thead className="bg-gray-100"><tr>
            <th className="border border-black px-2 py-1 w-10">#</th>
            <th className="border border-black px-2 py-1">Tentative Scheduled Visit Date</th>
          </tr></thead>
          <tbody>
            {(a.pm_dates || []).map((d, i) => (
              <tr key={i}><td className="border border-black px-2 py-1 text-center">{i + 1}</td><td className="border border-black px-2 py-1">{fmtDate(d)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mb-3 text-gray-600">No PM visits scheduled.</p>
      )}

      <div className="font-bold mb-1">Payment Terms</div>
      <p className="mb-3">
        AMC value of <b>₹ {Number(a.amc_value || 0).toLocaleString("en-IN")}</b> is payable in advance against our invoice for the full contract period.
        GST as applicable shall be charged extra. The agreement is activated only on receipt of full payment.
      </p>

      <div className="font-bold mb-1">Terms & Conditions</div>
      <pre className="whitespace-pre-wrap font-sans text-[11px] mb-6">{a.terms || ""}</pre>

      <div className="grid grid-cols-2 gap-8 mt-12">
        <div>
          <div className="border-t border-black pt-1 text-center">Authorised Signatory<br /><b>For {a.client_company || "Client"}</b></div>
        </div>
        <div>
          <div className="border-t border-black pt-1 text-center">Authorised Signatory<br /><b>For Prokon Hi-Tech Systems</b></div>
        </div>
      </div>
    </div>
  );
}

function EditProductRow({ unit, categories, products, serials, onChange, onRemove, canRemove }: {
  unit: AmcUnit;
  categories: string[];
  products: Array<{ id: string; name: string | null; model: string | null; category: string | null; brand: string | null }>;
  serials: Array<{ id: string; serial_number: string; product_id: string }>;
  onChange: (patch: Partial<AmcUnit>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const filteredProducts = products.filter((p) => !unit.category || p.category === unit.category);
  const filteredSerials = serials.filter((s) => s.product_id === unit.product_id);
  return (
    <div className="grid grid-cols-12 gap-2 items-end border-b pb-3">
      <div className="col-span-12 md:col-span-3">
        <Label>Category *</Label>
        <Select value={unit.category || ""} onValueChange={(v) => onChange({ category: v, product_id: "", model: "", serial_no: "" })}>
          <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-12 md:col-span-4">
        <Label>Model *</Label>
        <Select
          value={unit.product_id || ""}
          onValueChange={(v) => {
            const p = products.find((x) => x.id === v);
            onChange({ product_id: v, model: p?.model || p?.name || "", serial_no: "" });
          }}
          disabled={!unit.category}
        >
          <SelectTrigger><SelectValue placeholder={unit.category ? "Select model" : "Pick category first"} /></SelectTrigger>
          <SelectContent>
            {filteredProducts.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.model || p.name} {p.brand ? `· ${p.brand}` : ""}</SelectItem>
            ))}
            {filteredProducts.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No products in this category</div>}
          </SelectContent>
        </Select>
        {unit.model && !unit.product_id && (
          <p className="text-[11px] text-muted-foreground mt-1">Legacy model: <span className="font-mono">{unit.model}</span> — pick a master product to standardise.</p>
        )}
      </div>
      <div className="col-span-10 md:col-span-4">
        <Label>Serial Number</Label>
        {filteredSerials.length > 0 ? (
          <Select value={unit.serial_no || ""} onValueChange={(v) => onChange({ serial_no: v })}>
            <SelectTrigger><SelectValue placeholder="Select serial" /></SelectTrigger>
            <SelectContent>
              {filteredSerials.map((s) => <SelectItem key={s.id} value={s.serial_number}>{s.serial_number}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <Input value={unit.serial_no || ""} onChange={(e) => onChange({ serial_no: e.target.value.toUpperCase() })} placeholder="Enter serial" className="font-mono" />
        )}
      </div>
      <div className="col-span-2 md:col-span-1 flex justify-end">
        <Button size="icon" variant="ghost" onClick={onRemove} disabled={!canRemove}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}