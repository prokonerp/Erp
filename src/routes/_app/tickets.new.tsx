import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CALL_TYPES } from "@/lib/tickets";
import { toast } from "sonner";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";

export const Route = createFileRoute("/_app/tickets/new")({
  component: NewTicket,
});

type Product = { id: string; name: string };

function NewTicket() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    case_id: "",
    call_type: "OOW" as string,
    product: "",
    serial_no: "",
    customer_name: "",
    customer_address: "",
    customer_email: "",
    customer_phone: "",
    location: "",
    complaint: "",
  });

  useEffect(() => {
    supabase.from("products").select("id,name").order("name").then(({ data }) => setProducts((data || []) as Product[]));
  }, []);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (!form.customer_name.trim()) return toast.error("Customer name is required");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const payload = {
      ...form,
      customer_name: toTitleCaseSmart(form.customer_name),
      customer_address: titleCaseAddress(form.customer_address),
      customer_email: (form.customer_email || "").trim().toLowerCase(),
      location: toTitleCaseSmart(form.location),
      product: toTitleCaseSmart(form.product),
      serial_no: upperTrim(form.serial_no),
      status: "New",
      created_by: u.user?.id ?? null,
    };
    if (!payload.case_id) delete (payload as Record<string, unknown>).case_id;
    const { data, error } = await supabase.from("tickets").insert(payload as never).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Ticket created");
    navigate({ to: "/tickets/$id", params: { id: (data as { id: string }).id } });
  };

  return (
    <Card>
      <CardHeader><CardTitle>New Ticket</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Case ID <span className="text-muted-foreground text-xs">(blank = auto TKT-0001)</span></Label>
          <Input value={form.case_id} onChange={(e) => set({ case_id: e.target.value })} placeholder="TKT-0001" />
        </div>
        <div>
          <Label>Call Type *</Label>
          <Select value={form.call_type} onValueChange={(v) => set({ call_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CALL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Product</Label>
          {products.length > 0 ? (
            <Select value={form.product} onValueChange={(v) => set({ product: v })}>
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input value={form.product} onChange={(e) => set({ product: e.target.value })} placeholder="Add products in Products tab" />
          )}
        </div>
        <div>
          <Label>Serial Number</Label>
          <Input value={form.serial_no} onChange={(e) => set({ serial_no: e.target.value.toUpperCase() })} placeholder="e.g. APC2024XYZ" className="font-mono" />
        </div>

        <div className="md:col-span-2 pt-2 border-t" />
        <div><Label>Customer Name *</Label><Input value={form.customer_name} onChange={(e) => set({ customer_name: e.target.value })} /></div>
        <div><Label>Contact Number</Label><Input value={form.customer_phone} onChange={(e) => set({ customer_phone: e.target.value })} /></div>
        <div><Label>Email</Label><Input type="email" value={form.customer_email} onChange={(e) => set({ customer_email: e.target.value })} /></div>
        <div><Label>Location</Label><Input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="City / area" /></div>
        <div className="md:col-span-2"><Label>Address</Label><Textarea rows={2} value={form.customer_address} onChange={(e) => set({ customer_address: e.target.value })} /></div>
        <div className="md:col-span-2"><Label>Complaint / Issue Description</Label><Textarea rows={3} value={form.complaint} onChange={(e) => set({ complaint: e.target.value })} /></div>

        <div className="md:col-span-2 flex justify-end gap-2">
          <Button onClick={submit} disabled={busy} size="lg">Create Ticket</Button>
        </div>
      </CardContent>
    </Card>
  );
}