import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Mail, MessageCircle, Plus, Printer, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type Amc, type AmcUnit, addYears, amcStatus, generatePMDates, nextAgreementNo, statusBadgeClass, statusLabel } from "@/lib/amc";

export const Route = createFileRoute("/_app/amc/$id")({
  component: AmcDetail,
  head: () => ({ meta: [{ title: "AMC Agreement — Prokon" }] }),
});

function AmcDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [a, setA] = useState<Amc | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => supabase.from("amcs").select("*").eq("id", id).single()
    .then(({ data }) => setA(data as unknown as Amc));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!a) return <div className="text-muted-foreground">Loading…</div>;

  const status = amcStatus(a.end_date);

  const update = (patch: Partial<Amc>) => setA({ ...a, ...patch });

  // ---- Reminder messages (WhatsApp + Email) ----
  const nextPm = (a.pm_dates || []).find((d) => new Date(d + "T00:00:00") >= new Date(new Date().toDateString()));
  const unitList = a.units.map((u, i) => `${i + 1}. ${u.model} (S/N: ${u.serial_no})`).join("\n");
  const greeting = `Dear ${a.client_name}${a.client_company ? ` / ${a.client_company}` : ""},`;
  const signOff = `\n\nRegards,\nProkon Hi-Tech Systems\nB-505, Picasso Centre, Sector-61, Gurgaon`;

  const renewalMsg =
    `${greeting}\n\nThis is a gentle reminder that your AMC (Agreement No: ${a.agreement_no}) with Prokon Hi-Tech Systems ` +
    `is ${status === "expired" ? `expired on ${a.end_date}` : `due for renewal on ${a.end_date}`}.\n\n` +
    `Equipment Covered:\n${unitList}\n\n` +
    `Kindly confirm renewal at the earliest to ensure uninterrupted service coverage.${signOff}`;

  const pmMsg =
    `${greeting}\n\nAs per your AMC (Agreement No: ${a.agreement_no}), your next scheduled Preventive Maintenance visit is on ` +
    `${nextPm || "the upcoming PM date"}.\n\nEquipment Covered:\n${unitList}\n\n` +
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
    const { data: agree } = await supabase.from("amcs").select("agreement_no");
    const existing = (agree || []).map((x: { agreement_no: string }) => x.agreement_no);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("amcs").insert({
      agreement_no: nextAgreementNo(existing),
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

  return (
    <>
      <div className="space-y-4 print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Link to="/amc"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
          <div className="flex items-center gap-2">
            <span className={`text-xs border rounded px-2 py-0.5 ${statusBadgeClass(status)}`}>{statusLabel(status)}</span>
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print Agreement</Button>
            <Button variant="outline" size="sm" onClick={renew} disabled={busy}><RefreshCw className="h-4 w-4 mr-1" />Renew AMC</Button>
            <Button size="sm" onClick={save} disabled={busy}><Save className="h-4 w-4 mr-1" />Save changes</Button>
          </div>
        </div>

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
            <div><Label>Start Date</Label><Input type="date" value={a.start_date} onChange={(e) => update({ start_date: e.target.value })} /></div>
            <div><Label>End Date (auto on save)</Label><Input value={addYears(a.start_date, a.duration_years)} readOnly className="bg-muted" /></div>
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
            <CardTitle>UPS Units (model & serial editable)</CardTitle>
            <Button size="sm" variant="outline" onClick={() => update({ units: [...a.units, { model: "", serial_no: "" }] })}><Plus className="h-4 w-4 mr-1" />Add unit</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {a.units.map((u, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end border-b pb-3">
                <div className="col-span-12 md:col-span-6"><Label>UPS Model</Label><Input value={u.model} onChange={(e) => setUnit(i, { model: e.target.value })} /></div>
                <div className="col-span-10 md:col-span-5"><Label>Serial No.</Label><Input value={u.serial_no} onChange={(e) => setUnit(i, { serial_no: e.target.value })} /></div>
                <div className="col-span-2 md:col-span-1">
                  <Button size="icon" variant="ghost" onClick={() => update({ units: a.units.filter((_, idx) => idx !== i) })} disabled={a.units.length === 1}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
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
          <CardHeader><CardTitle>Scheduled PM Visits</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 text-xs">
              {(a.pm_dates || []).map((d, i) => (
                <span key={i} className="font-mono px-2 py-1 rounded border bg-muted">{d}</span>
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
      <PrintAgreement a={a} />

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

function PrintAgreement({ a }: { a: Amc }) {
  return (
    <div className="agreement-print bg-white text-black mx-auto max-w-3xl p-6 text-[12px] leading-relaxed">
      <div className="text-center border-b-2 border-[#1e40af] pb-3 mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-[#1e3a8a] via-[#2563eb] to-[#dc2626] bg-clip-text text-transparent">PROKON HI-TECH SYSTEMS</h1>
        <div className="text-sm">B-505, Picasso Centre, Sector-61, Gurgaon</div>
        <div className="mt-2 inline-block px-3 py-0.5 border-2 border-black font-bold tracking-widest text-sm">ANNUAL MAINTENANCE CONTRACT</div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
        <div><b>Agreement No:</b> {a.agreement_no}</div>
        <div className="text-right"><b>Date:</b> {new Date().toISOString().slice(0, 10)}</div>
        <div><b>Start:</b> {a.start_date}</div>
        <div className="text-right"><b>End:</b> {a.end_date}</div>
        <div><b>Duration:</b> {a.duration_years} Year(s)</div>
        <div className="text-right"><b>AMC Value:</b> ₹ {Number(a.amc_value || 0).toLocaleString("en-IN")}</div>
      </div>

      <table className="w-full border border-black mb-3">
        <tbody>
          <tr><td className="border border-black px-2 py-1 w-32 font-bold">Client</td><td className="border border-black px-2 py-1">{a.client_name} {a.client_company ? `— ${a.client_company}` : ""}</td></tr>
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

      <div className="font-bold mb-1">Scheduled Preventive Maintenance Visits</div>
      <table className="w-full border border-black mb-3">
        <thead className="bg-gray-100"><tr><th className="border border-black px-2 py-1 w-10">PM #</th><th className="border border-black px-2 py-1">Scheduled Date</th><th className="border border-black px-2 py-1">Engineer / Remarks</th></tr></thead>
        <tbody>
          {(a.pm_dates || []).map((d, i) => (
            <tr key={i}><td className="border border-black px-2 py-1 text-center">{i + 1}</td><td className="border border-black px-2 py-1 font-mono">{d}</td><td className="border border-black px-2 py-1">&nbsp;</td></tr>
          ))}
        </tbody>
      </table>

      <div className="font-bold mb-1">Terms & Conditions</div>
      <pre className="whitespace-pre-wrap font-sans text-[11px] mb-6">{a.terms || ""}</pre>

      <div className="grid grid-cols-2 gap-8 mt-12">
        <div>
          <div className="border-t border-black pt-1 text-center">Authorised Signatory<br /><b>For Client {a.client_company ? `(${a.client_company})` : ""}</b></div>
        </div>
        <div>
          <div className="border-t border-black pt-1 text-center">Authorised Signatory<br /><b>For Prokon Hi-Tech Systems</b></div>
        </div>
      </div>
    </div>
  );
}