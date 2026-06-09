import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductPicker } from "@/components/ProductPicker";
import { Label as L } from "@/components/ui/label";

export const Route = createFileRoute("/_app/tickets/new")({
  component: NewTicket,
});

function NewTicket() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
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
    location: "",
    complaint: "",
  });

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (!form.customer_id) return toast.error("Please select a customer from Customer Master");
    if (!form.customer_name.trim()) return toast.error("Customer name is required");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { product_id: _pid, ...rest } = form;
    void _pid;
    const payload = {
      ...rest,
      customer_id: form.customer_id || null,
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
          <ProductPicker
            value={form.product_id}
            onChange={(id, p) => set({ product_id: id || "", product: p?.name || "" })}
          />
        </div>
        <div>
          <Label>Serial Number</Label>
          <Input value={form.serial_no} onChange={(e) => set({ serial_no: e.target.value.toUpperCase() })} placeholder="e.g. APC2024XYZ" className="font-mono" />
        </div>

        <div className="md:col-span-2 pt-2 border-t" />
        <div className="md:col-span-2">
          <L>Customer * <span className="text-xs text-muted-foreground font-normal">(from Customer Master)</span></L>
          <CustomerPicker
            value={form.customer_id}
            required
            onChange={(id, c) => set({
              customer_id: id || "",
              customer_name: c?.company || "",
              customer_phone: c?.phone || "",
              customer_email: c?.email || "",
              customer_address: c?.billing_address || c?.address || "",
              location: (c as { city?: string } | null)?.city || c?.state || "",
            })}
          />
        </div>
        <div><Label>Contact Number</Label><Input value={form.customer_phone} readOnly className="bg-muted" /></div>
        <div><Label>Email</Label><Input type="email" value={form.customer_email} readOnly className="bg-muted" /></div>
        <div><Label>Location</Label><Input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder="City / area" /></div>
        <div className="md:col-span-2"><Label>Address</Label><Textarea rows={2} value={form.customer_address} readOnly className="bg-muted" /></div>
        <div className="md:col-span-2"><Label>Complaint / Issue Description</Label><Textarea rows={3} value={form.complaint} onChange={(e) => set({ complaint: e.target.value })} /></div>

        <div className="md:col-span-2 flex justify-end gap-2">
          <Button onClick={submit} disabled={busy} size="lg">Create Ticket</Button>
        </div>
      </CardContent>
    </Card>
  );
}