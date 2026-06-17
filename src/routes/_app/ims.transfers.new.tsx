import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { createTransfer, listWarehouses, type WarehouseLite } from "@/lib/ims";
import { ImsModelPartPicker } from "@/components/ImsModelPartPicker";
import { ImsSerialPicker } from "@/components/ImsSerialPicker";

export const Route = createFileRoute("/_app/ims/transfers/new")({
  component: NewTransfer,
});

function NewTransfer() {
  const nav = useNavigate();
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [form, setForm] = useState({
    source_warehouse_id: "", destination_warehouse_id: "",
    product_id: "", product_type: "",
    oem: "", part_name: "", part_model_no: "", part_serial_no: "",
    stock_type: "good", qty: 1, reason: "", remarks: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { listWarehouses().then(setWarehouses); }, []);

  function set<K extends keyof typeof form>(k: K, v: any) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(status: "draft" | "submitted") {
    if (!form.source_warehouse_id || !form.destination_warehouse_id) {
      toast.error("Source and destination warehouses are required"); return;
    }
    if (form.source_warehouse_id === form.destination_warehouse_id) {
      toast.error("Source and destination must differ"); return;
    }
    setSaving(true);
    try {
      const t = await createTransfer({
        source_warehouse_id: form.source_warehouse_id,
        destination_warehouse_id: form.destination_warehouse_id,
        oem: form.oem || null,
        part_name: form.part_name || null,
        part_model_no: form.part_model_no || null,
        part_serial_no: form.part_serial_no || null,
        stock_type: form.stock_type as "good" | "defective",
        qty: Number(form.qty) || 1,
        reason: form.reason || null,
        remarks: form.remarks || null,
        status,
      });
      toast.success(status === "submitted" ? "Transfer submitted" : "Transfer saved as draft");
      nav({ to: "/ims/transfers/$id", params: { id: t.id } });
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">New Stock Transfer</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>Source Warehouse *</Label>
          <Select value={form.source_warehouse_id} onValueChange={(v) => set("source_warehouse_id", v)}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Destination Warehouse *</Label>
          <Select value={form.destination_warehouse_id} onValueChange={(v) => set("destination_warehouse_id", v)}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <Label>Model / Part</Label>
          <ImsModelPartPicker
            value={form.product_id || null}
            onSelect={(p) => setForm((f) => ({
              ...f,
              product_id: p.id,
              product_type: p.productType,
              part_name: p.name,
              part_model_no: p.model || "",
              oem: p.brand || "",
            }))}
          />
          {form.product_type && (
            <div className="text-xs text-muted-foreground mt-1">
              Type: <span className="font-medium">{form.product_type}</span>
              {form.oem ? <> · OEM: <span className="font-medium">{form.oem}</span></> : null}
            </div>
          )}
        </div>
        <div><Label>OEM</Label><Input value={form.oem} onChange={(e) => set("oem", e.target.value)} /></div>
        <div><Label>Model / Part Name</Label><Input value={form.part_name} onChange={(e) => set("part_name", e.target.value)} /></div>
        <div><Label>Model / Part No</Label><Input value={form.part_model_no} onChange={(e) => set("part_model_no", e.target.value)} /></div>
        <div>
          <Label>Model / Part Serial No</Label>
          <ImsSerialPicker
            value={form.part_serial_no || null}
            partModelNo={form.part_model_no || null}
            partName={form.part_name || null}
            stockType={form.stock_type as "good" | "defective"}
            warehouseId={form.source_warehouse_id || null}
            onSelect={(item, serial) => setForm((f) => ({
              ...f,
              part_serial_no: serial,
              ...(item ? { part_model_no: item.part_model_no || f.part_model_no, part_name: item.part_name || f.part_name } : {}),
            }))}
          />
        </div>
        <div>
          <Label>Stock Type</Label>
          <Select value={form.stock_type} onValueChange={(v) => set("stock_type", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="good">Good</SelectItem>
              <SelectItem value="defective">Defective</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Qty</Label><Input type="number" value={form.qty} onChange={(e) => set("qty", e.target.value)} /></div>
        <div className="md:col-span-2"><Label>Reason</Label><Input value={form.reason} onChange={(e) => set("reason", e.target.value)} /></div>
        <div className="md:col-span-2"><Label>Remarks</Label><Input value={form.remarks} onChange={(e) => set("remarks", e.target.value)} /></div>
        <div className="md:col-span-2 flex gap-2 justify-end">
          <Button variant="outline" onClick={() => submit("draft")} disabled={saving}>Save Draft</Button>
          <Button onClick={() => submit("submitted")} disabled={saving}>Submit for Approval</Button>
        </div>
      </CardContent>
    </Card>
  );
}