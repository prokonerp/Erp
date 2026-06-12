import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Pencil, Trash2, Check, ChevronsUpDown, Upload, Save, X } from "lucide-react";
import { toast } from "sonner";
import { type Customer } from "@/lib/crm";
import { INDIAN_STATES, isValidGSTIN, stateFromGSTIN } from "@/lib/india";
import { ExportButtons } from "@/components/ExportButtons";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { parseCSV } from "@/lib/csv";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/masters/customers")({
  component: CustomerMasterPage,
  head: () => ({ meta: [{ title: "Customer Master — Prokon" }] }),
});

const GST_TREATMENTS = ["Regular", "Composition", "Unregistered", "Consumer"] as const;
type GstTreatment = typeof GST_TREATMENTS[number];

const SALUTATIONS = ["Mr.", "Ms.", "Mrs.", "Dr.", "Mx."] as const;
const COUNTRIES = ["India", "United States", "United Kingdom", "United Arab Emirates", "Singapore", "Australia", "Canada", "Germany", "France", "Nepal", "Bangladesh", "Sri Lanka", "Other"];
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CustomerType = "Business" | "Individual";

type AddressBlock = {
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
};
const emptyAddr: AddressBlock = { line1: "", line2: "", landmark: "", city: "", state: "", country: "India", pincode: "" };

type ContactRow = {
  salutation: string;
  first_name: string;
  last_name: string;
  designation: string;
  department: string;
  email: string;
  area_code: string;
  phone: string;
};
const emptyContact: ContactRow = { salutation: "Mr.", first_name: "", last_name: "", designation: "", department: "", email: "", area_code: "+91", phone: "" };

type FormState = {
  customer_type: CustomerType;
  salutation: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  area_code: string;
  phone: string;
  gst: string;
  gst_status: GstTreatment;
  pan: string;
  billing: AddressBlock;
  shipping: AddressBlock;
  same_as_billing: boolean;
  place_of_supply: string;
  contacts: ContactRow[];
  remarks: string;
};

const empty: FormState = {
  customer_type: "Business",
  salutation: "Mr.",
  first_name: "", last_name: "",
  company: "", email: "", area_code: "+91", phone: "",
  gst: "", gst_status: "Unregistered", pan: "",
  billing: { ...emptyAddr },
  shipping: { ...emptyAddr },
  same_as_billing: true,
  place_of_supply: "",
  contacts: [],
  remarks: "",
};

function panFromGstin(gst: string): string {
  const up = (gst || "").toUpperCase().trim();
  if (up.length < 12) return "";
  return up.slice(2, 12);
}

function joinAddress(a: AddressBlock): string {
  return [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country]
    .map((s) => (s || "").trim()).filter(Boolean).join(", ");
}

function isValidPhone(p: string): boolean {
  return /^\d{10}$/.test((p || "").trim());
}

export function CustomerMasterPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [tab, setTab] = useState("basic");
  const [emailError, setEmailError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase.from("customers").select("*").order("company");
    setRows((data || []) as unknown as Customer[]);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((c) => {
    const s = q.toLowerCase();
    return !s || [c.company, c.contact_name, c.phone, c.email, c.gst, c.state].some((v) => (v || "").toLowerCase().includes(s));
  }), [rows, q]);

  function resetForm() { setForm(empty); setEditingId(null); setTab("basic"); setEmailError(""); }
  function startNew() { resetForm(); setOpen(true); }
  function startEdit(c: Customer) {
    const any = c as any;
    const billing: AddressBlock = {
      line1: any.billing_line1 || c.billing_address || c.address || "",
      line2: any.billing_line2 || "",
      landmark: any.billing_landmark || any.street || "",
      city: any.billing_city || any.city || "",
      state: any.billing_state || c.state || "",
      country: any.billing_country || any.country || "India",
      pincode: any.billing_pincode || "",
    };
    const shipping: AddressBlock = {
      line1: any.shipping_line1 || c.shipping_address || "",
      line2: any.shipping_line2 || "",
      landmark: any.shipping_landmark || "",
      city: any.shipping_city || "",
      state: any.shipping_state || "",
      country: any.shipping_country || "India",
      pincode: any.shipping_pincode || "",
    };
    const sameAsBilling = !any.shipping_line1 && (!c.shipping_address || c.shipping_address === (c.billing_address || c.address || ""));
    setForm({
      customer_type: (any.customer_type as CustomerType) || "Business",
      salutation: any.salutation || "Mr.",
      first_name: any.first_name || "",
      last_name: any.last_name || "",
      company: c.company || "",
      email: c.email || "",
      area_code: any.phone_area_code || "+91",
      phone: c.phone || "",
      gst: c.gst || "",
      gst_status: (any.gst_status as GstTreatment) || (c.gst ? "Regular" : "Unregistered"),
      pan: any.pan || panFromGstin(c.gst || ""),
      billing,
      shipping: sameAsBilling ? billing : shipping,
      same_as_billing: sameAsBilling,
      place_of_supply: any.place_of_supply || "",
      contacts: Array.isArray(any.contacts) ? (any.contacts as ContactRow[]).map((x) => ({ ...emptyContact, ...x })) : [],
      remarks: c.remarks || "",
    });
    setEditingId(c.id);
    setTab("basic");
    setOpen(true);
  }

  function onGstChange(v: string) {
    const up = v.toUpperCase();
    const auto = stateFromGSTIN(up);
    setForm((f) => ({
      ...f,
      gst: up,
      pan: f.customer_type === "Business" && up.length >= 12 ? panFromGstin(up) : f.pan,
      billing: { ...f.billing, state: auto || f.billing.state },
      place_of_supply: auto || f.place_of_supply,
      gst_status: up.length >= 2 && auto ? "Regular" : f.gst_status,
    }));
  }

  function addContact() { setForm((f) => ({ ...f, contacts: [...f.contacts, { ...emptyContact }] })); }
  function updateContact(i: number, patch: Partial<ContactRow>) {
    setForm((f) => ({ ...f, contacts: f.contacts.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) }));
  }
  function removeContact(i: number) { setForm((f) => ({ ...f, contacts: f.contacts.filter((_, idx) => idx !== i) })); }

  async function save(addAnother = false) {
    // Validation
    if (form.customer_type === "Business" && !form.company.trim()) { toast.error("Company Name is required for Business"); setTab("basic"); return; }
    if (!form.first_name.trim()) { toast.error("First name is required"); setTab("basic"); return; }
    if (!isValidPhone(form.phone)) { toast.error("Enter a valid 10-digit mobile number"); setTab("basic"); return; }
    if (!form.email.trim()) { toast.error("Email is required"); setTab("basic"); return; }
    if (!EMAIL_REGEX.test(form.email.trim())) { toast.error("Enter a valid email address"); setTab("basic"); return; }
    if (form.customer_type === "Business" && !form.gst.trim()) { toast.error("GST Number is required for Business"); setTab("gst"); return; }
    if (form.gst_status === "Regular" && !isValidGSTIN(form.gst)) { toast.error("Enter a valid 15-character GSTIN"); setTab("gst"); return; }
    if (form.pan && !PAN_REGEX.test(form.pan.toUpperCase().trim())) { toast.error("PAN must be 10 chars (AAAAA9999A)"); setTab("gst"); return; }
    for (let i = 0; i < form.contacts.length; i++) {
      const c = form.contacts[i];
      if (!c.first_name.trim()) { toast.error(`Contact #${i + 1}: first name required`); setTab("contacts"); return; }
      if (c.email && !EMAIL_REGEX.test(c.email.trim())) { toast.error(`Contact #${i + 1}: invalid email`); setTab("contacts"); return; }
      if (c.phone && !isValidPhone(c.phone)) { toast.error(`Contact #${i + 1}: phone must be 10 digits`); setTab("contacts"); return; }
    }

    const billing = { ...form.billing };
    const shipping = form.same_as_billing ? { ...billing } : { ...form.shipping };
    const companyName = form.customer_type === "Business" ? toTitleCaseSmart(form.company) : toTitleCaseSmart([form.salutation, form.first_name, form.last_name].filter(Boolean).join(" "));
    const contactDisplay = toTitleCaseSmart([form.salutation, form.first_name, form.last_name].filter(Boolean).join(" "));

    const payload = {
      customer_type: form.customer_type,
      salutation: form.salutation || null,
      first_name: toTitleCaseSmart(form.first_name) || null,
      last_name: toTitleCaseSmart(form.last_name) || null,
      company: companyName,
      contact_name: contactDisplay,
      phone: form.phone.trim(),
      phone_area_code: form.area_code || "+91",
      email: form.email.trim().toLowerCase() || null,
      gst: form.customer_type === "Business" ? (upperTrim(form.gst) || null) : null,
      gst_status: form.gst_status,
      pan: form.pan ? upperTrim(form.pan) : null,
      place_of_supply: form.place_of_supply || null,
      state: billing.state || null,
      country: billing.country || "India",
      city: toTitleCaseSmart(billing.city) || null,
      street: billing.landmark || null,
      // structured
      billing_line1: titleCaseAddress(billing.line1) || null,
      billing_line2: titleCaseAddress(billing.line2) || null,
      billing_landmark: toTitleCaseSmart(billing.landmark) || null,
      billing_city: toTitleCaseSmart(billing.city) || null,
      billing_state: billing.state || null,
      billing_country: billing.country || "India",
      billing_pincode: billing.pincode || null,
      shipping_line1: titleCaseAddress(shipping.line1) || null,
      shipping_line2: titleCaseAddress(shipping.line2) || null,
      shipping_landmark: toTitleCaseSmart(shipping.landmark) || null,
      shipping_city: toTitleCaseSmart(shipping.city) || null,
      shipping_state: shipping.state || null,
      shipping_country: shipping.country || "India",
      shipping_pincode: shipping.pincode || null,
      // legacy combined
      billing_address: joinAddress(billing) || null,
      shipping_address: joinAddress(shipping) || null,
      address: joinAddress(billing) || null,
      contacts: form.contacts.map((c) => ({
        first_name: toTitleCaseSmart(c.first_name),
        last_name: toTitleCaseSmart(c.last_name),
        designation: toTitleCaseSmart(c.designation),
        department: toTitleCaseSmart(c.department),
        email: c.email.trim().toLowerCase(),
        area_code: c.area_code || "+91",
        phone: c.phone.trim(),
      })),
      remarks: form.remarks || null,
    };
    if (editingId) {
      const { error } = await supabase.from("customers").update(payload as any).eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success("Customer updated");
    } else {
      const { error } = await supabase.from("customers").insert(payload as any);
      if (error) return toast.error(error.message);
      toast.success("Customer added");
    }
    await load();
    if (addAnother) { resetForm(); } else { setOpen(false); resetForm(); }
  }

  async function del(id: string) {
    if (!confirm("Delete this customer?")) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  }

  async function onImport(file: File) {
    try {
      const text = await file.text();
      const rowsCsv = parseCSV(text);
      if (!rowsCsv.length) return toast.error("Empty CSV");
      const payload = rowsCsv.map((r) => {
        const gst = upperTrim(r["GSTIN"] || r["GST"] || "");
        const stateAuto = stateFromGSTIN(gst);
        return {
          company: toTitleCaseSmart(r["Company"] || r["Customer Name"] || r["Name"] || ""),
          contact_name: toTitleCaseSmart(r["Contact"] || r["Contact Name"] || ""),
          phone: (r["Phone"] || r["Mobile"] || "").trim(),
          email: (r["Email"] || "").trim().toLowerCase() || null,
          gst: gst || null,
          gst_status: r["GST Treatment"] || (gst ? "Regular" : "Unregistered"),
          state: r["State"] || r["Place of Supply"] || stateAuto || "Haryana",
          city: toTitleCaseSmart(r["City"] || "") || null,
          billing_address: titleCaseAddress(r["Billing Address"] || r["Address"] || "") || null,
          shipping_address: titleCaseAddress(r["Shipping Address"] || r["Billing Address"] || r["Address"] || "") || null,
          address: titleCaseAddress(r["Billing Address"] || r["Address"] || "") || null,
          remarks: r["Remarks"] || null,
        };
      }).filter((p) => p.company);
      if (!payload.length) return toast.error("No valid rows. Required column: Company / Customer Name");
      const { error } = await supabase.from("customers").insert(payload as any);
      if (error) return toast.error(error.message);
      toast.success(`Imported ${payload.length} customer(s)`);
      load();
    } catch (e: any) { toast.error(e?.message || "Import failed"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Customer Master</h1>
          <p className="text-sm text-muted-foreground">Single source of truth for customers used across CRM, Tickets, Gatepass and AMC.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1" />Import CSV</Button>
          <ExportButtons
            name="Prokon_Customers"
            title="Customer Master"
            rows={filtered}
            columns={[
              { header: "Company", get: (c) => c.company },
              { header: "Contact", get: (c) => c.contact_name || "" },
              { header: "Phone", get: (c) => c.phone || "" },
              { header: "Email", get: (c) => c.email || "" },
              { header: "GSTIN", get: (c) => c.gst || "" },
              { header: "PAN", get: (c) => (c as any).pan || "" },
              { header: "GST Treatment", get: (c) => (c as any).gst_status || "" },
              { header: "State", get: (c) => c.state || "" },
              { header: "City", get: (c) => (c as any).city || "" },
              { header: "Billing Address", get: (c) => c.billing_address || c.address || "" },
              { header: "Shipping Address", get: (c) => c.shipping_address || "" },
              { header: "Remarks", get: (c) => c.remarks || "" },
            ]}
          />
          <Button size="sm" onClick={startNew}><Plus className="h-4 w-4 mr-1" />New Customer</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">All Customers ({rows.length})</CardTitle>
          <Input placeholder="Search by name, phone, GST, city…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Customer</TableHead><TableHead>Type</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead>
              <TableHead>GSTIN</TableHead><TableHead>State</TableHead><TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.company}</TableCell>
                  <TableCell className="text-xs">{(c as any).customer_type || "—"}</TableCell>
                  <TableCell>{c.contact_name || "—"}</TableCell>
                  <TableCell>{c.phone || "—"}</TableCell>
                  <TableCell className="text-xs">{c.gst || "—"}</TableCell>
                  <TableCell>{c.state || "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No customers. Click <b>New Customer</b> or <b>Import CSV</b>.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b">
            <DialogTitle className="text-xl">{editingId ? "Edit Customer" : "New Customer"}</DialogTitle>
          </DialogHeader>

          <Tabs value={tab} onValueChange={setTab} className="px-6 pt-3">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="basic">Basic Details</TabsTrigger>
              <TabsTrigger value="gst">GST / PAN</TabsTrigger>
              <TabsTrigger value="address">Address</TabsTrigger>
              <TabsTrigger value="contacts">Contacts ({form.contacts.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="mt-4 space-y-4">
              <FieldRow label="Customer Type" required>
                <RadioGroup
                  value={form.customer_type}
                  onValueChange={(v) => setForm({ ...form, customer_type: v as CustomerType })}
                  className="flex gap-6"
                >
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <RadioGroupItem value="Business" /> Business
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <RadioGroupItem value="Individual" /> Individual
                  </label>
                </RadioGroup>
              </FieldRow>

              <FieldRow label="Primary Contact" required>
                <div className="grid grid-cols-12 gap-2">
                  <Select value={form.salutation} onValueChange={(v) => setForm({ ...form, salutation: v })}>
                    <SelectTrigger className="col-span-3"><SelectValue placeholder="Salutation" /></SelectTrigger>
                    <SelectContent>{SALUTATIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input className="col-span-4" placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
                  <Input className="col-span-5" placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
                </div>
              </FieldRow>

              {form.customer_type === "Business" && (
                <FieldRow label="Company Name" required>
                  <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Legal / billing entity" />
                </FieldRow>
              )}

              <FieldRow label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
              </FieldRow>

              <FieldRow label="Phone" required>
                <div className="grid grid-cols-12 gap-2">
                  <Input className="col-span-3 font-mono" value={form.area_code} onChange={(e) => setForm({ ...form, area_code: e.target.value })} placeholder="+91" />
                  <Input
                    className="col-span-9"
                    inputMode="numeric"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                    placeholder="10-digit mobile"
                  />
                </div>
              </FieldRow>
            </TabsContent>

            <TabsContent value="gst" className="mt-4 space-y-4">
              <FieldRow label="GST Treatment" required>
                <Select value={form.gst_status} onValueChange={(v) => setForm({ ...form, gst_status: v as GstTreatment })}>
                  <SelectTrigger><SelectValue placeholder="Select a GST treatment" /></SelectTrigger>
                  <SelectContent>{GST_TREATMENTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </FieldRow>
              {form.customer_type === "Business" && (
                <FieldRow label="GST Number">
                  <Input value={form.gst} onChange={(e) => onGstChange(e.target.value)} placeholder="15-char GSTIN — auto-fills state & PAN" maxLength={15} className="font-mono uppercase" />
                </FieldRow>
              )}
              <FieldRow label="PAN">
                <Input
                  value={form.pan}
                  onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase().slice(0, 10) })}
                  placeholder="AAAAA9999A"
                  maxLength={10}
                  className="font-mono uppercase"
                />
              </FieldRow>
              <FieldRow label="Remarks">
                <Textarea rows={3} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </FieldRow>
            </TabsContent>

            <TabsContent value="address" className="mt-4 space-y-4">
              <div className="grid md:grid-cols-2 gap-6">
                <AddressEditor
                  title="Billing Address"
                  value={form.billing}
                  onChange={(b) => setForm({ ...form, billing: b, shipping: form.same_as_billing ? b : form.shipping })}
                />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-sm">Shipping Address</h3>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={form.same_as_billing}
                        onCheckedChange={(v) => setForm({ ...form, same_as_billing: !!v, shipping: v ? form.billing : form.shipping })}
                      />
                      Same as Billing
                    </label>
                  </div>
                  {!form.same_as_billing && (
                    <AddressEditor
                      title=""
                      value={form.shipping}
                      onChange={(s) => setForm({ ...form, shipping: s })}
                    />
                  )}
                  {form.same_as_billing && (
                    <div className="text-xs text-muted-foreground p-3 rounded border bg-muted/30">
                      Shipping address will be copied from billing on save.
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="contacts" className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Add multiple persons of contact. Each must include a first name.</p>
                <Button variant="outline" size="sm" onClick={addContact}><Plus className="h-4 w-4 mr-1" />Add Contact</Button>
              </div>
              {form.contacts.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8 border rounded bg-muted/20">
                  No additional contacts yet. The Primary Contact (Basic Details) acts as the default.
                </div>
              )}
              {form.contacts.map((c, i) => (
                <div key={i} className="border rounded p-3 space-y-2 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-muted-foreground">Contact #{i + 1}</div>
                    <Button size="icon" variant="ghost" onClick={() => removeContact(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                  <div className="grid md:grid-cols-2 gap-2">
                    <Input placeholder="First name *" value={c.first_name} onChange={(e) => updateContact(i, { first_name: e.target.value })} />
                    <Input placeholder="Last name" value={c.last_name} onChange={(e) => updateContact(i, { last_name: e.target.value })} />
                    <Input placeholder="Designation" value={c.designation} onChange={(e) => updateContact(i, { designation: e.target.value })} />
                    <Input placeholder="Department" value={c.department} onChange={(e) => updateContact(i, { department: e.target.value })} />
                    <Input type="email" placeholder="Email" value={c.email} onChange={(e) => updateContact(i, { email: e.target.value })} />
                    <div className="grid grid-cols-12 gap-2">
                      <Input className="col-span-4 font-mono" placeholder="+91" value={c.area_code} onChange={(e) => updateContact(i, { area_code: e.target.value })} />
                      <Input
                        className="col-span-8"
                        inputMode="numeric"
                        placeholder="10-digit phone"
                        value={c.phone}
                        onChange={(e) => updateContact(i, { phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between gap-2 px-6 py-4 border-t bg-muted/30 sticky bottom-0">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
            <div className="flex gap-2">
              {!editingId && <Button variant="outline" onClick={() => save(true)}><Plus className="h-4 w-4 mr-1" />Save & New</Button>}
              <Button onClick={() => save(false)}><Save className="h-4 w-4 mr-1" />{editingId ? "Update" : "Save"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldRow({ label, required, labelClassName, children }: { label: string; required?: boolean; labelClassName?: string; children: React.ReactNode }) {
  return (
    <div className="grid md:grid-cols-[180px_1fr] items-start gap-2 md:gap-4">
      <Label className={cn("text-sm pt-2", required && "text-destructive", labelClassName)}>{label}{required && " *"}</Label>
      <div>{children}</div>
    </div>
  );
}

function AddressEditor({ title, value, onChange }: { title: string; value: AddressBlock; onChange: (v: AddressBlock) => void }) {
  return (
    <div className="space-y-3">
      {title && <h3 className="font-medium text-sm">{title}</h3>}
      <Input placeholder="Address Line 1" value={value.line1} onChange={(e) => onChange({ ...value, line1: e.target.value })} />
      <Input placeholder="Address Line 2" value={value.line2} onChange={(e) => onChange({ ...value, line2: e.target.value })} />
      <Input placeholder="Landmark" value={value.landmark} onChange={(e) => onChange({ ...value, landmark: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="City" value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} />
        <Input placeholder="Pincode" inputMode="numeric" value={value.pincode} onChange={(e) => onChange({ ...value, pincode: e.target.value.replace(/\D/g, "").slice(0, 10) })} />
      </div>
      <StateCombobox value={value.state} onChange={(s) => onChange({ ...value, state: s })} />
      <Select value={value.country} onValueChange={(c) => onChange({ ...value, country: c })}>
        <SelectTrigger><SelectValue placeholder="Country" /></SelectTrigger>
        <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function StateCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value || "Select state / UT"}
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command>
          <CommandInput placeholder="Search state…" />
          <CommandList>
            <CommandEmpty>No state found.</CommandEmpty>
            <CommandGroup>
              {INDIAN_STATES.map((s) => (
                <CommandItem key={s} value={s} onSelect={() => { onChange(s); setOpen(false); }}>
                  <Check className={cn("h-4 w-4 mr-2", value === s ? "opacity-100" : "opacity-0")} />
                  {s}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}