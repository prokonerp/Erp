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
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";

export const Route = createFileRoute("/_app/new")({
  component: NewGatepass,
  head: () => ({ meta: [{ title: "New Gatepass — Prokon" }] }),
});

type Product = { id: string; name: string; unit: string };
type Item = { product: string; serial_no: string; quantity: string; unit: string; remarks: string };

const empty = (): Item => ({ product: "", serial_no: "", quantity: "1", unit: "Nos", remarks: "" });

function NewGatepass() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<Item[]>([empty()]);
  const [form, setForm] = useState({
    person_name: "", person_company: "", contact_no: "", vehicle_no: "",
    destination: "", purpose: "", return_type: "Non-Returnable",
    prepared_by: "", authorised_by: "", remarks: "",
    gatepass_date: new Date().toISOString().slice(0, 10),
    gatepass_time: new Date().toTimeString().slice(0, 5),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("products").select("*").order("name").then(({ data }) => setProducts((data || []) as Product[]));
  }, []);

  const updateItem = (i: number, patch: Partial<Item>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const onProductPick = (i: number, name: string) => {
    const p = products.find((x) => x.name === name);
    updateItem(i, { product: name, unit: p?.unit || "Nos" });
  };

  const submit = async () => {
    if (!form.person_name.trim()) return toast.error("Person name is required");
    const cleanItems = items.filter((it) => it.product.trim());
    if (cleanItems.length === 0) return toast.error("Add at least one item");
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const cased = {
      ...form,
      person_name: toTitleCaseSmart(form.person_name),
      person_company: toTitleCaseSmart(form.person_company),
      destination: toTitleCaseSmart(form.destination),
      purpose: toTitleCaseSmart(form.purpose),
      prepared_by: toTitleCaseSmart(form.prepared_by),
      authorised_by: toTitleCaseSmart(form.authorised_by),
      vehicle_no: upperTrim(form.vehicle_no),
      remarks: titleCaseAddress(form.remarks),
    };
    const { data, error } = await supabase.from("gatepasses").insert({
      ...cased,
      challan_no: "", // trigger fills it
      items: cleanItems.map((it) => ({
        ...it,
        product: toTitleCaseSmart(it.product),
        serial_no: upperTrim(it.serial_no),
        remarks: toTitleCaseSmart(it.remarks),
      })),
      created_by: userData.user?.id ?? null,
    } as never).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Gatepass created");
    navigate({ to: "/gatepass/$id", params: { id: (data as { id: string }).id } });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>New Gatepass</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Date</Label><Input type="date" value={form.gatepass_date} onChange={(e) => setForm({ ...form, gatepass_date: e.target.value })} /></div>
          <div><Label>Time</Label><Input type="time" value={form.gatepass_time} onChange={(e) => setForm({ ...form, gatepass_time: e.target.value })} /></div>
          <div><Label>Person Taking Material *</Label><Input value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} /></div>
          <div><Label>Company / Department</Label><Input value={form.person_company} onChange={(e) => setForm({ ...form, person_company: e.target.value })} /></div>
          <div><Label>Contact No.</Label><Input value={form.contact_no} onChange={(e) => setForm({ ...form, contact_no: e.target.value })} /></div>
          <div><Label>Vehicle No.</Label><Input value={form.vehicle_no} onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })} /></div>
          <div><Label>Destination</Label><Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} /></div>
          <div>
            <Label>Type</Label>
            <Select value={form.return_type} onValueChange={(v) => setForm({ ...form, return_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Returnable">Returnable</SelectItem>
                <SelectItem value="Non-Returnable">Non-Returnable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2"><Label>Purpose</Label><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Items</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems([...items, empty()])}><Plus className="h-4 w-4 mr-1" />Add row</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end border-b pb-3">
              <div className="col-span-12 md:col-span-4">
                <Label>Product</Label>
                {products.length > 0 ? (
                  <Select value={it.product} onValueChange={(v) => onProductPick(i, v)}>
                    <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={it.product} onChange={(e) => updateItem(i, { product: e.target.value })} placeholder="Add products in Products tab" />
                )}
              </div>
              <div className="col-span-6 md:col-span-3"><Label>Serial No.</Label><Input value={it.serial_no} onChange={(e) => updateItem(i, { serial_no: e.target.value })} /></div>
              <div className="col-span-3 md:col-span-1"><Label>Qty</Label><Input type="number" min="1" value={it.quantity} onChange={(e) => updateItem(i, { quantity: e.target.value })} /></div>
              <div className="col-span-3 md:col-span-1"><Label>Unit</Label><Input value={it.unit} onChange={(e) => updateItem(i, { unit: e.target.value })} /></div>
              <div className="col-span-10 md:col-span-2"><Label>Remarks</Label><Input value={it.remarks} onChange={(e) => updateItem(i, { remarks: e.target.value })} /></div>
              <div className="col-span-2 md:col-span-1">
                <Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))} disabled={items.length === 1}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Approvals & Notes</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Prepared By</Label><Input value={form.prepared_by} onChange={(e) => setForm({ ...form, prepared_by: e.target.value })} /></div>
          <div><Label>Authorised By</Label><Input value={form.authorised_by} onChange={(e) => setForm({ ...form, authorised_by: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Remarks</Label><Textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2} /></div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button size="lg" onClick={submit} disabled={busy}>Save & Print Challan</Button>
      </div>
    </div>
  );
}