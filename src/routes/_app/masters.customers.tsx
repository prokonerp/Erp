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
import { Plus, Pencil, Trash2, Check, ChevronsUpDown, Upload, Save, X, ArrowLeft } from "lucide-react";
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

type FormState = {
  company: string;
  contact_name: string;
  phone: string;
  email: string;
  gst: string;
  gst_status: GstTreatment;
  state: string;
  // address
  billing_address: string;
  shipping_address: string;
  city: string;
  street: string;       // landmark / street 2
  country: string;
  same_as_billing: boolean;
  remarks: string;
};

const empty: FormState = {
  company: "", contact_name: "", phone: "", email: "",
  gst: "", gst_status: "Unregistered", state: "",
  billing_address: "", shipping_address: "", city: "", street: "",
  country: "India", same_as_billing: true, remarks: "",
};

function CustomerMasterPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [tab, setTab] = useState("basic");
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

  function resetForm() { setForm(empty); setEditingId(null); setTab("basic"); }
  function startNew() { resetForm(); setOpen(true); }
  function startEdit(c: Customer) {
    setForm({
      company: c.company || "",
      contact_name: c.contact_name || "",
      phone: c.phone || "",
      email: c.email || "",
      gst: c.gst || "",
      gst_status: ((c as any).gst_status as GstTreatment) || (c.gst ? "Regular" : "Unregistered"),
      state: c.state || "",
      billing_address: c.billing_address || c.address || "",
      shipping_address: c.shipping_address || "",
      city: (c as any).city || "",
      street: (c as any).street || "",
      country: (c as any).country || "India",
      same_as_billing: !c.shipping_address || c.shipping_address === (c.billing_address || c.address || ""),
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
      state: auto || f.state,
      gst_status: up.length >= 2 && auto ? "Regular" : f.gst_status,
    }));
  }

  async function save(addAnother = false) {
    if (!form.company.trim()) { toast.error("Customer name is required"); setTab("basic"); return; }
    if (!form.phone.trim()) { toast.error("Mobile number is required"); setTab("basic"); return; }
    if (!form.gst_status) { toast.error("GST Treatment is required"); setTab("other"); return; }
    if (!form.state) { toast.error("Place of Supply is required"); setTab("other"); return; }
    if (form.gst_status === "Regular" && !isValidGSTIN(form.gst)) {
      toast.error("Enter a valid 15-character GSTIN"); setTab("other"); return;
    }
    const billing = titleCaseAddress(form.billing_address);
    const shipping = form.same_as_billing ? billing : titleCaseAddress(form.shipping_address);
    const payload = {
      company: toTitleCaseSmart(form.company),
      contact_name: toTitleCaseSmart(form.contact_name),
      phone: form.phone.trim(),
      email: form.email.trim().toLowerCase() || null,
      gst: upperTrim(form.gst) || null,
      gst_status: form.gst_status,
      state: form.state,
      country: form.country || "India",
      city: toTitleCaseSmart(form.city) || null,
      street: form.street || null,
      billing_address: billing || null,
      shipping_address: shipping || null,
      address: billing || null,
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
              <TableHead>Customer</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead>
              <TableHead>GSTIN</TableHead><TableHead>State</TableHead><TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.company}</TableCell>
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
              {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No customers. Click <b>New Customer</b> or <b>Import CSV</b>.</TableCell></TableRow>}
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
              <TabsTrigger value="other">GST / Other</TabsTrigger>
              <TabsTrigger value="address">Address</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="mt-4 space-y-4">
              <FieldRow label="Customer Name" required>
                <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Display name on invoices / tickets" />
              </FieldRow>
              <FieldRow label="Mobile Number" required>
                <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile" />
              </FieldRow>
              <FieldRow label="Email ID">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" />
              </FieldRow>
              <FieldRow label="Primary Contact">
                <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} placeholder="Person of contact" />
              </FieldRow>
              <FieldRow label="Company Name">
                <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Legal / billing entity" />
              </FieldRow>
              <FieldRow label="GST Number">
                <Input value={form.gst} onChange={(e) => onGstChange(e.target.value)} placeholder="15-char GSTIN — auto-fills state" maxLength={15} className="font-mono uppercase" />
              </FieldRow>
            </TabsContent>

            <TabsContent value="other" className="mt-4 space-y-4">
              <FieldRow label="GST Treatment" required>
                <Select value={form.gst_status} onValueChange={(v) => setForm({ ...form, gst_status: v as GstTreatment })}>
                  <SelectTrigger><SelectValue placeholder="Select a GST treatment" /></SelectTrigger>
                  <SelectContent>{GST_TREATMENTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Place of Supply" required>
                <StateCombobox value={form.state} onChange={(v) => setForm({ ...form, state: v })} />
              </FieldRow>
              <FieldRow label="Remarks">
                <Textarea rows={3} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </FieldRow>
            </TabsContent>

            <TabsContent value="address" className="mt-4 space-y-4">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="font-medium text-sm">Billing Address</h3>
                  <Textarea rows={3} placeholder="Street / Building" value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} />
                  <Input placeholder="Landmark / Street 2" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
                  <Input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  <StateCombobox value={form.state} onChange={(v) => setForm({ ...form, state: v })} />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-sm">Shipping Address</h3>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={form.same_as_billing} onCheckedChange={(v) => setForm({ ...form, same_as_billing: !!v, shipping_address: v ? form.billing_address : form.shipping_address })} />
                      Same as Billing
                    </label>
                  </div>
                  <Textarea rows={3} placeholder="Street / Building" disabled={form.same_as_billing} value={form.same_as_billing ? form.billing_address : form.shipping_address} onChange={(e) => setForm({ ...form, shipping_address: e.target.value })} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="contacts" className="mt-4">
              <p className="text-sm text-muted-foreground">Add additional contact persons after saving the customer.</p>
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

function FieldRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid md:grid-cols-[180px_1fr] items-start gap-2 md:gap-4">
      <Label className={cn("text-sm pt-2", required && "text-destructive")}>{label}{required && " *"}</Label>
      <div>{children}</div>
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
