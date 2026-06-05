import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type Customer, type CustomerContact, type GstStatus, GST_STATUSES, INDIAN_STATES } from "@/lib/crm";
import { ExportButtons } from "@/components/ExportButtons";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";

export const Route = createFileRoute("/_app/crm/customers")({ component: CustomersPage });

const empty: Partial<Customer> = {
  company: "", contact_name: "", phone: "", email: "",
  address: "", billing_address: "", shipping_address: "",
  street: "", city: "", state: "Haryana", country: "India",
  gst: "", gst_status: "Unregistered", remarks: "",
  contacts: [],
};

function CustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Customer>>(empty);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("customers").select("*").order("company");
    setRows((data || []) as unknown as Customer[]);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.company?.trim()) { toast.error("Company is required"); return; }
    const gstStatus = (form.gst_status || "Unregistered") as GstStatus;
    if (gstStatus === "Registered" && (!form.gst || form.gst.trim().length < 10)) {
      toast.error("GST number is required when GST status is Registered");
      return;
    }
    const contacts = (form.contacts || []).filter((c) => c.name && c.name.trim()).map((c) => ({
      name: toTitleCaseSmart(c.name),
      designation: toTitleCaseSmart(c.designation || ""),
      phone: (c.phone || "").trim(),
      email: (c.email || "").trim().toLowerCase(),
    }));
    const payload = {
      ...form,
      company: toTitleCaseSmart(form.company),
      contact_name: toTitleCaseSmart(form.contact_name || ""),
      email: (form.email || "").trim().toLowerCase(),
      gst: gstStatus === "Registered" ? upperTrim(form.gst) : (form.gst ? upperTrim(form.gst) : null),
      gst_status: gstStatus,
      street: toTitleCaseSmart(form.street || ""),
      city: toTitleCaseSmart(form.city || ""),
      country: toTitleCaseSmart(form.country || "India"),
      billing_address: titleCaseAddress(form.billing_address || form.address || ""),
      shipping_address: titleCaseAddress(form.shipping_address || ""),
      contacts,
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
    setOpen(false); setForm(empty); setEditingId(null); load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this customer?")) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  };

  const edit = (c: Customer) => {
    setForm({ ...c, contacts: Array.isArray(c.contacts) ? c.contacts : [] });
    setEditingId(c.id);
    setOpen(true);
  };

  const copyBillToShip = () => setForm((f) => ({ ...f, shipping_address: f.billing_address || f.address || "" }));

  const setContact = (i: number, patch: Partial<CustomerContact>) =>
    setForm((f) => ({ ...f, contacts: (f.contacts || []).map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
  const addContact = () =>
    setForm((f) => ({ ...f, contacts: [...(f.contacts || []), { name: "", designation: "", phone: "", email: "" }] }));
  const removeContact = (i: number) =>
    setForm((f) => ({ ...f, contacts: (f.contacts || []).filter((_, idx) => idx !== i) }));

  const filtered = rows.filter((c) => {
    const s = q.toLowerCase();
    return !s || [c.company, c.contact_name, c.phone, c.email, c.gst, c.city, c.state, c.country].some((v) => (v || "").toLowerCase().includes(s));
  });

  const gstStatus = (form.gst_status || "Unregistered") as GstStatus;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Customer master</CardTitle>
        <div className="flex gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <ExportButtons
            name="Prokon_Customers"
            title="Customer Master"
            rows={filtered}
            columns={[
              { header: "Company", get: (c) => c.company },
              { header: "Primary Contact", get: (c) => c.contact_name || "" },
              { header: "Phone", get: (c) => c.phone || "" },
              { header: "Email", get: (c) => c.email || "" },
              { header: "GST Status", get: (c) => c.gst_status || "" },
              { header: "GSTIN", get: (c) => c.gst || "" },
              { header: "Street", get: (c) => c.street || "" },
              { header: "City", get: (c) => c.city || "" },
              { header: "State", get: (c) => c.state || "" },
              { header: "Country", get: (c) => c.country || "" },
              { header: "Billing Address", get: (c) => c.billing_address || c.address || "" },
              { header: "Shipping Address", get: (c) => c.shipping_address || "" },
              { header: "Additional Contacts", get: (c) => (c.contacts || []).map((x) => `${x.name}${x.designation ? " ("+x.designation+")" : ""}${x.phone ? " "+x.phone : ""}`).join("; ") },
              { header: "Remarks", get: (c) => c.remarks || "" },
            ]}
          />
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setForm(empty); setEditingId(null); } }}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New</Button></DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editingId ? "Edit" : "New"} customer</DialogTitle></DialogHeader>
              <div className="grid md:grid-cols-2 gap-3">
                <div><Label>Company *</Label><Input value={form.company || ""} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
                <div><Label>Primary contact name</Label><Input value={form.contact_name || ""} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
                <div><Label>Primary phone</Label><Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Primary email</Label><Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div>
                  <Label>GST status *</Label>
                  <Select value={gstStatus} onValueChange={(v) => setForm({ ...form, gst_status: v as GstStatus })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{GST_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>GSTIN {gstStatus === "Registered" && <span className="text-red-600">*</span>}</Label>
                  <Input value={form.gst || ""} onChange={(e) => setForm({ ...form, gst: e.target.value })} disabled={gstStatus !== "Registered" && !form.gst} placeholder={gstStatus === "Registered" ? "06ABCDE1234F1Z5" : "—"} />
                </div>

                <div className="md:col-span-2 pt-2 border-t" />
                <div className="md:col-span-2"><Label>Street</Label><Input value={form.street || ""} onChange={(e) => setForm({ ...form, street: e.target.value })} /></div>
                <div><Label>City</Label><Input value={form.city || ""} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                <div>
                  <Label>State (place of supply)</Label>
                  <Select value={form.state || ""} onValueChange={(v) => setForm({ ...form, state: v })}>
                    <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                    <SelectContent>{INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Country</Label><Input value={form.country || "India"} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between"><Label>Billing address</Label></div>
                  <Textarea rows={3} value={form.billing_address || form.address || ""} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label>Shipping address</Label>
                    <Button type="button" size="sm" variant="ghost" onClick={copyBillToShip}>Same as billing</Button>
                  </div>
                  <Textarea rows={3} value={form.shipping_address || ""} onChange={(e) => setForm({ ...form, shipping_address: e.target.value })} />
                </div>

                <div className="md:col-span-2 pt-2 border-t">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-semibold">Additional contact persons</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addContact}><Plus className="h-4 w-4 mr-1" />Add contact</Button>
                  </div>
                  {(form.contacts || []).length === 0 && (
                    <p className="text-xs text-muted-foreground">No additional contacts. Click "Add contact" to add one.</p>
                  )}
                  {(form.contacts || []).map((c, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-end border-b pb-2 mb-2">
                      <div className="col-span-12 md:col-span-3"><Label className="text-xs">Name</Label><Input value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} /></div>
                      <div className="col-span-12 md:col-span-3"><Label className="text-xs">Designation</Label><Input value={c.designation || ""} onChange={(e) => setContact(i, { designation: e.target.value })} /></div>
                      <div className="col-span-6 md:col-span-2"><Label className="text-xs">Phone</Label><Input value={c.phone || ""} onChange={(e) => setContact(i, { phone: e.target.value })} /></div>
                      <div className="col-span-6 md:col-span-3"><Label className="text-xs">Email</Label><Input type="email" value={c.email || ""} onChange={(e) => setContact(i, { email: e.target.value })} /></div>
                      <div className="col-span-12 md:col-span-1">
                        <Button type="button" size="icon" variant="ghost" onClick={() => removeContact(i)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="md:col-span-2"><Label>Remarks</Label><Input value={form.remarks || ""} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={save}>{editingId ? "Update" : "Add"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Company</TableHead><TableHead>Contact</TableHead><TableHead>City / State</TableHead>
            <TableHead>Phone</TableHead><TableHead>GST</TableHead><TableHead>GSTIN</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.company}</TableCell>
                <TableCell>{c.contact_name || "—"}</TableCell>
                <TableCell>{[c.city, c.state].filter(Boolean).join(", ") || "—"}</TableCell>
                <TableCell>{c.phone || "—"}</TableCell>
                <TableCell><span className="text-xs">{c.gst_status || "Unregistered"}</span></TableCell>
                <TableCell className="text-xs">{c.gst || "—"}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => edit(c)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => del(c.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No customers yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
