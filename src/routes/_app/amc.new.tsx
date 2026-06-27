import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { type AmcUnit, addYears, fmtDate, generatePMDates } from "@/lib/amc";
import { DatePicker } from "@/components/DatePicker";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { CustomerPicker } from "@/components/CustomerPicker";
import { AgreementDocUpload } from "@/components/AgreementDocUpload";
import { FormShell, FormSection, FormGrid, FormField, StickyMobileActions } from "@/components/form-kit";

export const Route = createFileRoute("/_app/amc/new")({
  component: NewAmc,
  head: () => ({ meta: [{ title: "New AMC — Prokon" }] }),
});

const emptyUnit = (): AmcUnit => ({ model: "", serial_no: "", category: "", product_id: "" });

type ProductLite = { id: string; name: string | null; model: string | null; category: string | null; brand: string | null };
type SerialLite = { id: string; serial_number: string; product_id: string };

function NewAmc() {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    customer_id: "" as string,
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
    oem_call: false,
    oem_brand: "",
    oem_ref_id: "",
    oem_purchase_date: "",
  });
  const [units, setUnits] = useState<AmcUnit[]>([emptyUnit()]);
  const [categories, setCategories] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [serials, setSerials] = useState<SerialLite[]>([]);
  const [oemBrands, setOemBrands] = useState<string[]>([]);
  const [prefixPreview, setPrefixPreview] = useState<string>("PHS/AMC/");
  const [agreementDocPath, setAgreementDocPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const end_date = addYears(form.start_date, form.duration_years);

  useEffect(() => {
    (async () => {
      const [settings, cats, prods, sers, brands] = await Promise.all([
        supabase.from("amc_settings").select("terms_template,prefix").eq("id", 1).maybeSingle(),
        supabase.from("product_categories").select("name").order("name"),
        supabase.from("products").select("id,name,model,category,brand").eq("active", true).order("name"),
        supabase.from("serials").select("id,serial_number,product_id").order("serial_number"),
        supabase.from("oem_brand_master").select("name").order("name"),
      ]);
      const s = settings.data as { terms_template?: string; prefix?: string } | null;
      setForm((f) => ({ ...f, terms: s?.terms_template || "" }));
      setPrefixPreview(s?.prefix || "PHS/AMC/");
      setCategories(((cats.data || []) as { name: string }[]).map((c) => c.name));
      setProducts((prods.data || []) as ProductLite[]);
      setSerials((sers.data || []) as SerialLite[]);
      setOemBrands(((brands.data || []) as { name: string }[]).map((b) => b.name));

      // Prefill from OEM tab: ?customer=<id>&product=<id>&serial=<sn>&oem_ref=<ref>
      if (typeof window !== "undefined") {
        const sp = new URLSearchParams(window.location.search);
        const customerId = sp.get("customer");
        const productId = sp.get("product");
        const serial = sp.get("serial") || "";
        const oemRef = sp.get("oem_ref") || "";
        if (oemRef) {
          setForm((f) => ({ ...f, oem_call: true, oem_ref_id: oemRef }));
        }
        if (customerId) {
          const { data: c } = await supabase.from("customers")
            .select("id,company,contact_name,phone,email,billing_address,address,gst")
            .eq("id", customerId).maybeSingle();
          const cust = c as { company?: string; contact_name?: string; phone?: string; email?: string; billing_address?: string; address?: string; gst?: string } | null;
          if (cust) {
            setForm((f) => ({
              ...f,
              customer_id: customerId,
              client_name: cust.contact_name || cust.company || "",
              client_company: cust.company || "",
              client_address: cust.billing_address || cust.address || "",
              client_gst: cust.gst || "",
              contact_no: cust.phone || "",
              email: cust.email || "",
            }));
          }
        }
        if (productId) {
          const p = ((prods.data || []) as ProductLite[]).find((x) => x.id === productId);
          if (p) {
            setUnits([{ category: p.category || "", product_id: p.id, model: p.model || p.name || "", serial_no: serial }]);
          }
        }
      }
    })();
  }, []);

  const submit = async () => {
    if (!form.customer_id) return toast.error("Please select a customer from Customer Master");
    if (!form.client_name.trim()) return toast.error("Client name is required");
    const cleanUnits = units.filter((u) => (u.model || "").trim() || (u.product_id || "").trim());
    if (cleanUnits.length === 0) return toast.error("Add at least one UPS unit");
    for (const u of cleanUnits) {
      if (!u.category) return toast.error("Each product needs a Category");
      if (!u.product_id) return toast.error("Each product needs a Model selected from Product Master");
    }
    if (form.oem_call) {
      if (!form.oem_brand.trim()) return toast.error("OEM Brand is required when Registered with OEM");
      if (!form.oem_ref_id.trim()) return toast.error("OEM Agreement Number is required when Registered with OEM");
    }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("amcs").insert({
      // agreement_no auto-generated server-side
      customer_id: form.customer_id,
      client_name: toTitleCaseSmart(form.client_name),
      client_company: form.client_company ? toTitleCaseSmart(form.client_company) : null,
      client_address: form.client_address ? titleCaseAddress(form.client_address) : null,
      client_gst: form.client_gst ? upperTrim(form.client_gst) : null,
      contact_no: form.contact_no || null,
      email: form.email ? form.email.trim().toLowerCase() : null,
      units: cleanUnits.map((u) => ({
        category: u.category || null,
        product_id: u.product_id || null,
        model: toTitleCaseSmart(u.model || ""),
        serial_no: upperTrim(u.serial_no || ""),
      })),
      start_date: form.start_date,
      end_date,
      duration_years: form.duration_years,
      amc_value: form.amc_value ? Number(form.amc_value) : 0,
      terms: form.terms,
      pm_dates: generatePMDates(form.start_date, form.duration_years),
      remarks: form.remarks || null,
      oem_call: form.oem_call,
      oem_brand: form.oem_call ? form.oem_brand.trim() : null,
      oem_ref_id: form.oem_call ? form.oem_ref_id.trim() : null,
      oem_purchase_date: form.oem_call && form.oem_purchase_date ? form.oem_purchase_date : null,
      agreement_doc_path: agreementDocPath,
      created_by: userData.user?.id ?? null,
    } as never).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("AMC created");
    navigate({ to: "/amc/$id", params: { id: (data as { id: string }).id } });
  };

  return (
    <FormShell
      title="New AMC Agreement"
      description="Create a new Annual Maintenance Contract"
      storageKey="amc-form-density"
      actions={
        <Button size="sm" onClick={submit} disabled={busy}>
          <Save className="h-4 w-4 mr-1" />{busy ? "Saving…" : "Save AMC"}
        </Button>
      }
    >
      <FormSection
        title="OEM Registration"
        defaultOpen={form.oem_call}
        right={
          <div className="flex items-center gap-2 text-xs">
            <Label htmlFor="oem-toggle-new" className="text-xs">Registered with OEM</Label>
            <Switch id="oem-toggle-new" checked={form.oem_call} onCheckedChange={(v) => setForm({ ...form, oem_call: v })} />
            <span className="text-muted-foreground">{form.oem_call ? "Yes" : "No"}</span>
          </div>
        }
      >
        {form.oem_call ? (
          <FormGrid>
            <FormField label="OEM Brand" required name="oem_brand">
              <Select
                value={form.oem_brand}
                onValueChange={async (v) => {
                  if (v === "__add__") {
                    const name = window.prompt("New OEM brand name")?.trim();
                    if (!name) return;
                    const { error } = await supabase.from("oem_brand_master").insert({ name } as never);
                    if (error) { toast.error(error.message); return; }
                    setOemBrands((arr) => Array.from(new Set([...arr, name])).sort());
                    setForm((f) => ({ ...f, oem_brand: name }));
                    toast.success("OEM brand added");
                  } else {
                    setForm({ ...form, oem_brand: v });
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select OEM brand" /></SelectTrigger>
                <SelectContent>
                  {oemBrands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  <SelectItem value="__add__">+ Add New OEM Brand</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="OEM Agreement Number" required name="oem_ref_id">
              <Input value={form.oem_ref_id} onChange={(e) => setForm({ ...form, oem_ref_id: e.target.value.toUpperCase() })} placeholder="e.g. APC-2026-AB12345" className="font-mono" />
            </FormField>
            <FormField label="OEM Purchase Date" name="oem_purchase_date">
              <DatePicker value={form.oem_purchase_date} onChange={(v) => setForm({ ...form, oem_purchase_date: v })} />
            </FormField>
          </FormGrid>
        ) : null}
      </FormSection>

      <FormSection title="Agreement" defaultOpen>
        <FormGrid>
          <FormField label="AMC Agreement Number" size="lg" hint={<>Format: <span className="font-mono">{prefixPreview}{`{ddMMyyHHmm}{SEQ}`}</span></>}>
            <Input value="Auto-generated on save" readOnly disabled className="bg-muted font-mono" />
          </FormField>
          <FormField label="Duration" name="duration" size="xs">
            <Select value={String(form.duration_years)} onValueChange={(v) => setForm({ ...form, duration_years: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[0.5, 1, 2, 3, 4, 5].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y === 0.5 ? "6M" : `${y}Y`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Start Date" name="start_date" size="sm" hint={fmtDate(form.start_date)}>
            <DatePicker value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} />
          </FormField>
          <FormField label="End Date" name="end_date" size="sm">
            <Input value={fmtDate(end_date)} readOnly className="bg-muted" />
          </FormField>
          <FormField label="AMC Value (₹)" name="amc_value" size="md">
            <Input type="number" min="0" value={form.amc_value} onChange={(e) => setForm({ ...form, amc_value: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection title="Customer" defaultOpen>
        <FormGrid>
          <FormField label="Customer (from Master)" required size="full">
            <CustomerPicker
              value={form.customer_id}
              required
              onChange={(id, c) => setForm({
                ...form,
                customer_id: id || "",
                client_name: c?.contact_name || c?.company || "",
                client_company: c?.company || "",
                client_address: c?.billing_address || c?.address || "",
                client_gst: c?.gst || "",
                contact_no: c?.phone || "",
                email: c?.email || "",
              })}
            />
          </FormField>
          <FormField label="Client / Contact Person" name="client_name" size="md">
            <Input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} placeholder="Auto-filled — editable" />
          </FormField>
          <FormField label="Company" name="client_company" size="md">
            <Input value={form.client_company} readOnly className="bg-muted" />
          </FormField>
          <FormField label="Contact No." name="contact_no" size="sm">
            <Input value={form.contact_no} readOnly className="bg-muted" />
          </FormField>
          <FormField label="Email" name="email" size="md">
            <Input type="email" value={form.email} readOnly className="bg-muted" />
          </FormField>
          <FormField label="Billing Address" size="lg">
            <Input value={form.client_address} readOnly className="bg-muted" />
          </FormField>
          <FormField label="GSTIN" name="client_gst" size="sm">
            <Input value={form.client_gst} readOnly className="bg-muted font-mono" />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection
        title="Product Details"
        defaultOpen
        right={
          <Button size="sm" variant="outline" onClick={() => setUnits([...units, emptyUnit()])}>
            <Plus className="h-4 w-4 mr-1" />Add unit
          </Button>
        }
      >
        <div className="space-y-3">
          {units.map((u, i) => (
            <ProductRow
              key={i}
              unit={u}
              categories={categories}
              products={products}
              serials={serials}
              onChange={(patch) => setUnits(units.map((x, idx) => idx === i ? { ...x, ...patch } : x))}
              onRemove={() => setUnits(units.filter((_, idx) => idx !== i))}
              canRemove={units.length > 1}
            />
          ))}
        </div>
      </FormSection>

      <FormSection title="Terms & Conditions">
        <Textarea rows={12} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} className="font-mono text-xs" />
      </FormSection>

      <FormSection title="Agreement Attachment">
        <AgreementDocUpload path={agreementDocPath} onChange={setAgreementDocPath} />
      </FormSection>

      <FormSection title="Remarks">
        <Textarea rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
      </FormSection>

      <div className="hidden sm:flex justify-end gap-2 pt-2">
        <Button onClick={submit} disabled={busy}>
          <Save className="h-4 w-4 mr-1" />{busy ? "Saving…" : "Save AMC"}
        </Button>
      </div>

      <StickyMobileActions>
        <Button onClick={submit} disabled={busy} className="flex-1">
          <Save className="h-4 w-4 mr-1" />{busy ? "Saving…" : "Save AMC"}
        </Button>
      </StickyMobileActions>
    </FormShell>
  );
}

function ProductRow({ unit, categories, products, serials, onChange, onRemove, canRemove }: {
  unit: AmcUnit;
  categories: string[];
  products: ProductLite[];
  serials: SerialLite[];
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
        <Select value={unit.product_id || ""} onValueChange={(v) => {
          const p = products.find((x) => x.id === v);
          onChange({ product_id: v, model: p?.model || p?.name || "", serial_no: "" });
        }} disabled={!unit.category}>
          <SelectTrigger><SelectValue placeholder={unit.category ? "Select model" : "Pick category first"} /></SelectTrigger>
          <SelectContent>
            {filteredProducts.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.model || p.name} {p.brand ? `· ${p.brand}` : ""}</SelectItem>
            ))}
            {filteredProducts.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No products in this category</div>}
          </SelectContent>
        </Select>
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