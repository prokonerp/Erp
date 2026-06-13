import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_app/tickets/new")({
  component: NewTicket,
});

function NewTicket() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [callTypes, setCallTypes] = useState<string[]>([...CALL_TYPES]);
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
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
  });

  useEffect(() => {
    supabase.from("call_type_master").select("name").order("name").then(({ data }) => {
      if (data && data.length) {
        const names = (data as { name: string }[]).map((r) => r.name);
        setCallTypes(Array.from(new Set([...names, ...CALL_TYPES])));
      }
    });
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

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (!form.customer_id) return toast.error("Please select a customer from Customer Master");
    if (!form.customer_name.trim()) return toast.error("Customer name is required");
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
          <Label>Case ID <span className="text-muted-foreground text-xs">(blank = auto)</span></Label>
          <Input value={form.case_id} onChange={(e) => set({ case_id: e.target.value })} placeholder="Auto: PREFIX + yyMMddHHmmss + ###" />
        </div>
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

        {/* Customer Section (moved above Product) */}
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

        {/* Product Section (now below Customer) */}
        <div className="md:col-span-2 pt-2 border-t" />
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
      </CardContent>
    </Card>
  );
}