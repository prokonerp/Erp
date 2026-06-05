import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type AmcUnit, addYears, fmtDate, generatePMDates, nextAgreementNo } from "@/lib/amc";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { CustomerPicker } from "@/components/CustomerPicker";

export const Route = createFileRoute("/_app/amc/new")({
  component: NewAmc,
  head: () => ({ meta: [{ title: "New AMC — Prokon" }] }),
});

const emptyUnit = (): AmcUnit => ({ model: "", serial_no: "" });

function NewAmc() {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    agreement_no: "",
    client_name: "",
    client_company: "",
    client_address: "",
    client_gst: "",
    contact_no: "",
    email: "",
    start_date: today,
    duration_years: 1,
    amc_value: "",
    remarks: "",
    terms: "",
  });
  const [units, setUnits] = useState<AmcUnit[]>([emptyUnit()]);
  const [busy, setBusy] = useState(false);
  const [productNames, setProductNames] = useState<string[]>([]);

  const end_date = addYears(form.start_date, form.duration_years);

  useEffect(() => {
    (async () => {
      const [agree, settings, prods] = await Promise.all([
        supabase.from("amcs").select("agreement_no"),
        supabase.from("amc_settings").select("terms_template").eq("id", 1).maybeSingle(),
        supabase.from("products").select("name").order("name"),
      ]);
      const existing = (agree.data || []).map((x: { agreement_no: string }) => x.agreement_no);
      setProductNames((prods.data || []).map((p: { name: string }) => p.name));
      setForm((f) => ({
        ...f,
        agreement_no: nextAgreementNo(existing),
        terms: (settings.data?.terms_template as string) || "",
      }));
    })();
  }, []);

  const submit = async () => {
    if (!form.client_name.trim()) return toast.error("Client name is required");
    const cleanUnits = units.filter((u) => u.model.trim() || u.serial_no.trim());
    if (cleanUnits.length === 0) return toast.error("Add at least one UPS unit");
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("amcs").insert({
      agreement_no: form.agreement_no,
      client_name: toTitleCaseSmart(form.client_name),
      client_company: form.client_company ? toTitleCaseSmart(form.client_company) : null,
      client_address: form.client_address ? titleCaseAddress(form.client_address) : null,
      client_gst: form.client_gst ? upperTrim(form.client_gst) : null,
      contact_no: form.contact_no || null,
      email: form.email ? form.email.trim().toLowerCase() : null,
      units: cleanUnits.map((u) => ({
        ...u,
        model: toTitleCaseSmart(u.model),
        serial_no: upperTrim(u.serial_no),
      })),
      start_date: form.start_date,
      end_date,
      duration_years: form.duration_years,
      amc_value: form.amc_value ? Number(form.amc_value) : 0,
      terms: form.terms,
      pm_dates: generatePMDates(form.start_date, end_date),
      remarks: form.remarks || null,
      created_by: userData.user?.id ?? null,
    } as never).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("AMC created");
    navigate({ to: "/amc/$id", params: { id: (data as { id: string }).id } });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>New AMC Agreement</CardTitle>
          <CustomerPicker onPick={(c) => setForm((f) => ({
            ...f,
            client_name: c.contact_name || c.company || "",
            client_company: c.company || "",
            client_address: [c.street, c.billing_address || c.address, c.city, c.state, c.country].filter(Boolean).join(", "),
            client_gst: c.gst || "",
            contact_no: c.phone || "",
            email: c.email || "",
          }))} />
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Agreement No.</Label><Input value={form.agreement_no} onChange={(e) => setForm({ ...form, agreement_no: e.target.value })} /></div>
          <div>
            <Label>Duration</Label>
            <Select value={String(form.duration_years)} onValueChange={(v) => setForm({ ...form, duration_years: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 5].map((y) => <SelectItem key={y} value={String(y)}>{y} Year{y > 1 ? "s" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Start Date (DD-MM-YYYY)</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /><p className="text-xs text-muted-foreground mt-1">{fmtDate(form.start_date)}</p></div>
          <div><Label>End Date (auto)</Label><Input value={fmtDate(end_date)} readOnly className="bg-muted" /></div>
          <div><Label>Client / Contact Person *</Label><Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></div>
          <div><Label>Company</Label><Input value={form.client_company} onChange={(e) => setForm({ ...form, client_company: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Billing Address</Label><Textarea rows={2} value={form.client_address} onChange={(e) => setForm({ ...form, client_address: e.target.value })} /></div>
          <div><Label>GSTIN</Label><Input value={form.client_gst} onChange={(e) => setForm({ ...form, client_gst: e.target.value })} /></div>
          <div><Label>Contact No.</Label><Input value={form.contact_no} onChange={(e) => setForm({ ...form, contact_no: e.target.value })} /></div>
          <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>AMC Value (₹)</Label><Input type="number" min="0" value={form.amc_value} onChange={(e) => setForm({ ...form, amc_value: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>UPS Units under contract</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setUnits([...units, emptyUnit()])}><Plus className="h-4 w-4 mr-1" />Add unit</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <datalist id="ups-models-new">
            {productNames.map((n) => <option key={n} value={n} />)}
          </datalist>
          {units.map((u, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end border-b pb-3">
              <div className="col-span-12 md:col-span-6"><Label>UPS Model</Label><Input list="ups-models-new" value={u.model} onChange={(e) => setUnits(units.map((x, idx) => idx === i ? { ...x, model: e.target.value } : x))} placeholder="Select from catalog or type" /></div>
              <div className="col-span-10 md:col-span-5"><Label>Serial No.</Label><Input value={u.serial_no} onChange={(e) => setUnits(units.map((x, idx) => idx === i ? { ...x, serial_no: e.target.value } : x))} /></div>
              <div className="col-span-2 md:col-span-1">
                <Button size="icon" variant="ghost" onClick={() => setUnits(units.filter((_, idx) => idx !== i))} disabled={units.length === 1}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Terms & Conditions (editable)</CardTitle></CardHeader>
        <CardContent>
          <Textarea rows={12} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} className="font-mono text-xs" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Remarks</CardTitle></CardHeader>
        <CardContent>
          <Textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button size="lg" onClick={submit} disabled={busy}>Save AMC</Button>
      </div>
    </div>
  );
}