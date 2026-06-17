import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CALL_TYPES, PRIORITIES } from "@/lib/tickets";
import { toast } from "sonner";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductPicker } from "@/components/ProductPicker";
import { Label as L } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, CalendarClock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TicketPartPicker } from "@/components/TicketPartPicker";
import { Trash2 } from "lucide-react";
import type { PartLine } from "@/lib/tickets";

export const Route = createFileRoute("/_app/tickets/new")({
  component: NewTicket,
});

function NewTicket() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [callTypes, setCallTypes] = useState<string[]>([...CALL_TYPES]);
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [oemBrands, setOemBrands] = useState<string[]>(["APC","Luminous","Microtek","Eaton","Exide","Quanta"]);
  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const [sourceMeta, setSourceMeta] = useState<{ source?: "amc" | "pm"; amc_id?: string; pm_visit_id?: string; label?: string } | null>(null);
  const [form, setForm] = useState({
    case_id: "",
    call_type: "OOW" as string,
    product_id: "",
    product: "",
    serial_no: "",
    customer_id: "" as string,
    customer_name: "",
    customer_address: "",
    customer_email: "",
    customer_phone: "",
    sector: "",
    location: "",
    priority: "P3" as string,
    complaint: "",
    oem_call: false,
    oem_brand: "",
    oem_ref_id: "",
    oem_purchase_date: "",
    special_instruction: "",
    preferred_visit_datetime: "",
  });
  const [defectiveOn, setDefectiveOn] = useState(false);
  const [defectiveParts, setDefectiveParts] = useState<PartLine[]>([]);
  const [goodOn, setGoodOn] = useState(false);
  const [goodParts, setGoodParts] = useState<PartLine[]>([]);

  useEffect(() => {
    supabase.from("call_type_master").select("name").order("name").then(({ data }) => {
      if (data && data.length) {
        const names = (data as { name: string }[]).map((r) => r.name);
        setCallTypes(Array.from(new Set([...names, ...CALL_TYPES])));
      }
    });
    supabase.from("oem_brand_master" as never).select("name").order("name").then(({ data }) => {
      if (data && (data as { name: string }[]).length) {
        const names = (data as { name: string }[]).map((r) => r.name);
        setOemBrands(Array.from(new Set(names)));
      }
    });
    // Prefill from AMC/PM via URL params: ?amc=<id> or ?pm=<id>
    (async () => {
      if (typeof window === "undefined") return;
      const sp = new URLSearchParams(window.location.search);
      const amcId = sp.get("amc");
      const pmId = sp.get("pm");
      if (!amcId && !pmId) return;
      let resolvedAmcId = amcId || "";
      let pmDate = "";
      if (pmId) {
        const { data: pm } = await supabase.from("pm_visits").select("id,amc_id,scheduled_date").eq("id", pmId).maybeSingle();
        const pmRow = pm as { id: string; amc_id: string; scheduled_date: string } | null;
        if (pmRow) { resolvedAmcId = pmRow.amc_id; pmDate = pmRow.scheduled_date; }
      }
      if (!resolvedAmcId) return;
      const { data: amc } = await supabase.from("amcs")
        .select("id,agreement_no,customer_id,client_name,client_company,contact_no,email,client_address,units")
        .eq("id", resolvedAmcId).maybeSingle();
      if (!amc) return;
      const a = amc as {
        id: string; agreement_no: string; customer_id: string | null;
        client_name: string; client_company: string | null; contact_no: string | null; email: string | null;
        client_address: string | null; units: { model: string; serial_no: string }[];
      };
      type CustLite = { city?: string | null; billing_city?: string | null; sector?: string | null; phone?: string | null; email?: string | null; company?: string | null; billing_address?: string | null; address?: string | null };
      let cust: CustLite | null = null;
      if (a.customer_id) {
        const { data: c } = await supabase.from("customers")
          .select("id,company,phone,email,billing_address,address,city,billing_city,sector,state")
          .eq("id", a.customer_id).maybeSingle();
        cust = (c as CustLite | null) ?? null;
      }
      const firstUnit = (a.units || [])[0] || { model: "", serial_no: "" };
      setForm((f) => ({
        ...f,
        call_type: pmId ? "AMC" : (f.call_type || "AMC"),
        customer_id: a.customer_id || "",
        customer_name: cust?.company || a.client_company || a.client_name || "",
        customer_phone: cust?.phone || a.contact_no || "",
        customer_email: cust?.email || a.email || "",
        customer_address: cust?.billing_address || cust?.address || a.client_address || "",
        sector: cust?.sector || "",
        location: cust?.billing_city || cust?.city || "",
        product: firstUnit.model || "",
        serial_no: (firstUnit.serial_no || "").toUpperCase(),
        complaint: pmId
          ? `Preventive Maintenance visit${pmDate ? ` scheduled for ${pmDate}` : ""} — AMC ${a.agreement_no}`
          : `Service request under AMC ${a.agreement_no}`,
      }));
      setSourceMeta({
        source: pmId ? "pm" : "amc",
        amc_id: a.id,
        pm_visit_id: pmId || undefined,
        label: pmId ? `PM Visit (${pmDate}) — AMC ${a.agreement_no}` : `AMC ${a.agreement_no}`,
      });
    })();
  }, []);

  const addCallType = async () => {
    const n = newTypeName.trim();
    if (!n) return;
    const { error } = await supabase.from("call_type_master").insert({ name: n } as never);
    if (error) return toast.error(error.message);
    setCallTypes((prev) => Array.from(new Set([...prev, n])));
    setForm((f) => ({ ...f, call_type: n }));
    setNewTypeName(""); setAddingType(false);
    toast.success("Call type added");
  };

  const addOemBrand = async () => {
    const n = newBrandName.trim();
    if (!n) return;
    const { error } = await supabase.from("oem_brand_master" as never).insert({ name: n } as never);
    if (error) return toast.error(error.message);
    setOemBrands((prev) => Array.from(new Set([...prev, n])));
    setForm((f) => ({ ...f, oem_brand: n }));
    setNewBrandName(""); setAddingBrand(false);
    toast.success("OEM brand added");
  };

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  type PartSetter = Dispatch<SetStateAction<PartLine[]>>;
  const mkUpd = (setter: PartSetter) => (i: number, p: Partial<PartLine>) =>
    setter((rows) => rows.map((x, idx) => (idx === i ? { ...x, ...p } : x)));
  const mkAdd = (setter: PartSetter) => () => setter((rows) => [...rows, { name: "", qty: "1" }]);
  const mkDel = (setter: PartSetter) => (i: number) => setter((rows) => rows.filter((_, idx) => idx !== i));
  const updDef = mkUpd(setDefectiveParts);
  const addDef = mkAdd(setDefectiveParts);
  const delDef = mkDel(setDefectiveParts);
  const updGood = mkUpd(setGoodParts);
  const addGood = mkAdd(setGoodParts);
  const delGood = mkDel(setGoodParts);

  const submit = async () => {
    if (!form.customer_id) return toast.error("Please select a customer from Customer Master");
    if (!form.customer_name.trim()) return toast.error("Customer name is required");
    if (form.oem_call) {
      if (!form.oem_brand) return toast.error("OEM Brand is required for OEM calls");
      if (!form.oem_ref_id.trim()) return toast.error("OEM Ref ID is required for OEM calls");
      if (!form.oem_purchase_date) return toast.error("OEM Customer Purchase Date is required");
    }
    if (form.preferred_visit_datetime) {
      const pv = new Date(form.preferred_visit_datetime).getTime();
      if (pv < Date.now() - 60000) {
        return toast.error("Preferred visit date & time cannot be in the past");
      }
    }
    if (defectiveOn) {
      const valid = defectiveParts.some((p) => (p.name || "").trim());
      if (!valid) return toast.error("Add at least one Defective Part Received or turn the section off");
    }
    if (goodOn) {
      const valid = goodParts.some((p) => (p.name || "").trim());
      if (!valid) return toast.error("Add at least one Good Part Used or turn the section off");
    }
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    let raisedByName: string | null = null;
    if (u.user?.id) {
      const { data: au } = await supabase.from("app_users").select("name").eq("user_id", u.user.id).maybeSingle();
      raisedByName = (au as { name?: string } | null)?.name?.trim() || null;
    }
    const { product_id: _pid, ...rest } = form;
    void _pid;
    const payload = {
      ...rest,
      customer_id: form.customer_id || null,
      customer_name: toTitleCaseSmart(form.customer_name),
      customer_address: titleCaseAddress(form.customer_address),
      customer_email: (form.customer_email || "").trim().toLowerCase(),
      location: toTitleCaseSmart(form.location),
      sector: form.sector ? toTitleCaseSmart(form.sector) : null,
      priority: form.priority || "P3",
      product: toTitleCaseSmart(form.product),
      serial_no: upperTrim(form.serial_no),
      status: "New",
      raised_by_type: "internal",
      raised_by_name: raisedByName,
      created_by: u.user?.id ?? null,
      oem_call: form.oem_call,
      oem_brand: form.oem_call ? form.oem_brand : null,
      oem_ref_id: form.oem_call ? form.oem_ref_id.trim() : null,
      oem_purchase_date: form.oem_call ? form.oem_purchase_date : null,
      special_instruction: form.special_instruction.trim() || null,
      preferred_visit_datetime: form.preferred_visit_datetime || null,
      source: sourceMeta?.source ?? null,
      amc_id: sourceMeta?.amc_id ?? null,
      pm_visit_id: sourceMeta?.pm_visit_id ?? null,
      // Legacy field kept in sync for back-compat (true if either section is enabled)
      parts_used: defectiveOn || goodOn,
      parts_details: goodOn ? goodParts : (defectiveOn ? defectiveParts : []),
      defective_parts_received: defectiveOn,
      defective_parts_details: defectiveOn ? defectiveParts : [],
      good_parts_used: goodOn,
      good_parts_details: goodOn ? goodParts : [],
    };
    // CASE ID is always auto-generated server-side
    delete (payload as Record<string, unknown>).case_id;
    const { data, error } = await supabase.from("tickets").insert(payload as never).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Ticket created");
    navigate({ to: "/tickets/$id", params: { id: (data as { id: string }).id } });
  };

  return (
    <Card>
      <CardHeader>
        {form.special_instruction.trim() && (
          <div className="mb-2 inline-flex items-center gap-2 self-start rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-red-700 animate-pulse">
            <span className="h-2 w-2 rounded-full bg-red-600" />
            Special Instruction
          </div>
        )}
        {form.preferred_visit_datetime && (
          <div className="mb-2 inline-flex items-center gap-2 self-start rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-blue-700 animate-pulse">
            <CalendarClock className="h-3 w-3" />
            Preferred Visit: {new Date(form.preferred_visit_datetime).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
        <CardTitle>New Ticket</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sourceMeta?.label && (
          <div className="md:col-span-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium">Source:</span> {sourceMeta.label}
            <span className="ml-2 text-xs text-muted-foreground">— fields pre-filled, review and submit.</span>
          </div>
        )}
        <div>
          <Label>Case ID <span className="text-muted-foreground text-xs">(auto-generated)</span></Label>
          <Input value={form.case_id} readOnly disabled placeholder="Auto-generated on save" className="bg-muted" />
        </div>
        <div>
          <Label>OEM Call</Label>
          <div className="flex items-center gap-3 h-9">
            <Switch
              checked={form.oem_call}
              onCheckedChange={(v) => set({ oem_call: v, oem_brand: v ? form.oem_brand : "", oem_ref_id: v ? form.oem_ref_id : "", oem_purchase_date: v ? form.oem_purchase_date : "" })}
            />
            <span className="text-sm text-muted-foreground">{form.oem_call ? "Yes — OEM tagged" : "No"}</span>
          </div>
        </div>

        {form.oem_call && (
          <>
            <div>
              <Label>OEM Brand *</Label>
              <Select value={form.oem_brand} onValueChange={(v) => { if (v === "__add__") { setAddingBrand(true); return; } set({ oem_brand: v }); }}>
                <SelectTrigger><SelectValue placeholder="Select OEM brand" /></SelectTrigger>
                <SelectContent>
                  {oemBrands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  <SelectItem value="__add__"><span className="text-primary">+ Add New Brand</span></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>OEM Ref ID *</Label>
              <Input value={form.oem_ref_id} onChange={(e) => set({ oem_ref_id: e.target.value })} placeholder="OEM reference / ticket id" />
            </div>
            <div>
              <Label>OEM Customer Purchase Date *</Label>
              <Input type="date" value={form.oem_purchase_date} onChange={(e) => set({ oem_purchase_date: e.target.value })} />
            </div>
            <div />
          </>
        )}

        <div>
          <Label>Call Type *</Label>
          <Select value={form.call_type} onValueChange={(v) => { if (v === "__add__") { setAddingType(true); return; } set({ call_type: v }); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {callTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              <SelectItem value="__add__"><span className="text-primary">+ Add New Call Type</span></SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Customer Section (moved above Model) */}
        <div className="md:col-span-2 pt-2 border-t" />
        <div className="md:col-span-2">
          <L>Customer * <span className="text-xs text-muted-foreground font-normal">(from Customer Master)</span></L>
          <CustomerPicker
            value={form.customer_id}
            required
            onChange={(id, c) => {
              const cAny = (c || {}) as { city?: string; billing_city?: string; sector?: string };
              set({
                customer_id: id || "",
                customer_name: c?.company || "",
                customer_phone: c?.phone || "",
                customer_email: c?.email || "",
                customer_address: c?.billing_address || c?.address || "",
                sector: cAny.sector || "",
                location: cAny.billing_city || cAny.city || c?.state || "",
              });
            }}
          />
        </div>
        <div><Label>Contact Number</Label><Input value={form.customer_phone} onChange={(e) => set({ customer_phone: e.target.value })} /></div>
        <div><Label>Email</Label><Input type="email" value={form.customer_email} onChange={(e) => set({ customer_email: e.target.value })} /></div>
        <div><Label>Sector / Colony Name</Label><Input value={form.sector} onChange={(e) => set({ sector: e.target.value })} placeholder="e.g. Sector 61 / DLF Phase 3" /></div>
        <div><Label>City / Area</Label><Input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="City or area" /></div>
        <div className="md:col-span-2"><Label>Address</Label><Textarea rows={2} value={form.customer_address} onChange={(e) => set({ customer_address: e.target.value })} /></div>

        {/* Model Section (now below Customer) */}
        <div className="md:col-span-2 pt-2 border-t" />
        <div>
          <Label>Model</Label>
          <ProductPicker
            value={form.product_id}
            onChange={(id, p) => {
              const modelName = p?.model || p?.name || "";
              const brand = p?.brand || "";
              set({
                product_id: id || "",
                product: modelName,
                ...(brand ? { oem_brand: brand } : {}),
              });
            }}
          />
        </div>
        <div>
          <Label>Serial Number</Label>
          <Input value={form.serial_no} onChange={(e) => set({ serial_no: e.target.value.toUpperCase() })} placeholder="e.g. APC2024XYZ" className="font-mono" />
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={form.priority} onValueChange={(v) => set({ priority: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2"><Label>Complaint / Issue Description</Label><Textarea rows={3} value={form.complaint} onChange={(e) => set({ complaint: e.target.value })} /></div>
        <div className="md:col-span-2">
          <Label>Special Instruction <span className="text-xs text-muted-foreground">(visible as blinking ribbon)</span></Label>
          <Textarea rows={2} value={form.special_instruction} onChange={(e) => set({ special_instruction: e.target.value })} placeholder="Critical handling notes for the engineer (optional)" />
        </div>
        <div className="md:col-span-2">
          <Label>Preferred Visit Date & Time <span className="text-xs text-muted-foreground">(optional)</span></Label>
          <Input type="datetime-local" value={form.preferred_visit_datetime} onChange={(e) => set({ preferred_visit_datetime: e.target.value })} />
        </div>

        <div className="md:col-span-2 pt-2 border-t" />
        <div className="md:col-span-2 flex items-center justify-between">
          <div>
            <Label className="text-base">Defective Parts Received <span className="text-xs text-muted-foreground font-normal">(from customer)</span></Label>
            <p className="text-xs text-muted-foreground">Capture defective material received from the customer.</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={defectiveOn} onCheckedChange={(v) => { setDefectiveOn(v); if (!v) setDefectiveParts([]); else if (defectiveParts.length === 0) addDef(); }} />
            <span className="text-sm text-muted-foreground">{defectiveOn ? "ON" : "OFF"}</span>
          </div>
        </div>
        {defectiveOn && (
          <div className="md:col-span-2 space-y-2">
            {defectiveParts.length === 0 && <p className="text-sm text-muted-foreground">No defective parts added yet.</p>}
            {defectiveParts.map((p, i) => (
              <div key={i} className="rounded-md border p-2">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 md:col-span-3">
                    <Label>Part / Item</Label>
                    <TicketPartPicker
                      ticketProduct={form.product}
                      value={p.model_no || p.name}
                      onSelect={(item) => updDef(i, { name: item.name, model_no: item.model || item.name })}
                    />
                  </div>
                  <div className="col-span-12 md:col-span-3"><Label>Model / Part No</Label><Input value={p.model_no || ""} onChange={(e) => updDef(i, { model_no: e.target.value })} /></div>
                  <div className="col-span-12 md:col-span-2"><Label>Model / Part Serial No</Label><Input value={p.serial || ""} onChange={(e) => updDef(i, { serial: e.target.value.toUpperCase() })} className="font-mono" /></div>
                  <div className="col-span-4 md:col-span-1"><Label>Qty</Label><Input value={p.qty} onChange={(e) => updDef(i, { qty: e.target.value })} /></div>
                  <div className="col-span-6 md:col-span-2"><Label>Remarks</Label><Input value={p.remarks || ""} onChange={(e) => updDef(i, { remarks: e.target.value })} /></div>
                  <div className="col-span-2 md:col-span-1 flex">
                    <Button type="button" size="icon" variant="ghost" onClick={() => delDef(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addDef}>
              <Plus className="h-4 w-4 mr-1" />Add defective part
            </Button>
          </div>
        )}

        <div className="md:col-span-2 pt-2 border-t" />
        <div className="md:col-span-2 flex items-center justify-between">
          <div>
            <Label className="text-base">Good Parts Used <span className="text-xs text-muted-foreground font-normal">(issued to customer)</span></Label>
            <p className="text-xs text-muted-foreground">Capture replacement material issued to the customer.</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={goodOn} onCheckedChange={(v) => { setGoodOn(v); if (!v) setGoodParts([]); else if (goodParts.length === 0) addGood(); }} />
            <span className="text-sm text-muted-foreground">{goodOn ? "ON" : "OFF"}</span>
          </div>
        </div>
        {goodOn && (
          <div className="md:col-span-2 space-y-2">
            {goodParts.length === 0 && <p className="text-sm text-muted-foreground">No good parts added yet.</p>}
            {goodParts.map((p, i) => (
              <div key={i} className="rounded-md border p-2">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-12 md:col-span-3">
                    <Label>Part / Item</Label>
                    <TicketPartPicker
                      ticketProduct={form.product}
                      value={p.model_no || p.name}
                      onSelect={(item) => updGood(i, { name: item.name, model_no: item.model || item.name })}
                    />
                  </div>
                  <div className="col-span-12 md:col-span-3"><Label>Model / Part No</Label><Input value={p.model_no || ""} onChange={(e) => updGood(i, { model_no: e.target.value })} /></div>
                  <div className="col-span-12 md:col-span-2"><Label>Model / Part Serial No</Label><Input value={p.serial || ""} onChange={(e) => updGood(i, { serial: e.target.value.toUpperCase() })} className="font-mono" /></div>
                  <div className="col-span-4 md:col-span-1"><Label>Qty</Label><Input value={p.qty} onChange={(e) => updGood(i, { qty: e.target.value })} /></div>
                  <div className="col-span-6 md:col-span-2"><Label>Remarks</Label><Input value={p.remarks || ""} onChange={(e) => updGood(i, { remarks: e.target.value })} /></div>
                  <div className="col-span-2 md:col-span-1 flex">
                    <Button type="button" size="icon" variant="ghost" onClick={() => delGood(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addGood}>
              <Plus className="h-4 w-4 mr-1" />Add good part
            </Button>
          </div>
        )}

        <div className="md:col-span-2 flex justify-end gap-2">
          <Button onClick={submit} disabled={busy} size="lg">Create Ticket</Button>
        </div>

        <Dialog open={addingType} onOpenChange={setAddingType}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add New Call Type</DialogTitle></DialogHeader>
            <Input autoFocus value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} placeholder="Call type name" onKeyDown={(e) => e.key === "Enter" && addCallType()} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddingType(false)}>Cancel</Button>
              <Button onClick={addCallType}><Plus className="h-4 w-4 mr-1" />Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={addingBrand} onOpenChange={setAddingBrand}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add New OEM Brand</DialogTitle></DialogHeader>
            <Input autoFocus value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} placeholder="Brand name" onKeyDown={(e) => e.key === "Enter" && addOemBrand()} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddingBrand(false)}>Cancel</Button>
              <Button onClick={addOemBrand}><Plus className="h-4 w-4 mr-1" />Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}