import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import type { ChallanItem, DocType } from "@/lib/challan";
import { emptyItem } from "@/lib/challan";

type Props = { docType: DocType };

export function ChallanForm({ docType }: Props) {
  const navigate = useNavigate();
  const isOem = docType === "oem";
  const [items, setItems] = useState<ChallanItem[]>([emptyItem()]);
  const [form, setForm] = useState({
    status: "Draft",
    challan_date: new Date().toISOString().slice(0, 10),
    dispatch_date: "",
    reference_no: "",
    gate_pass_no: "",
    sales_order_no: "",
    customer_po_no: "",
    invoice_no: "",
    party_name: "",
    party_code: "",
    gstin: "",
    oem_plant: "",
    contact_person: "",
    contact_number: "",
    email: "",
    delivery_address: "",
    transporter_name: "",
    vehicle_number: "",
    driver_name: "",
    driver_mobile: "",
    lr_number: "",
    mode_of_transport: "Road",
    num_packages: "",
    total_weight: "",
    internal_remarks: "",
    dispatch_remarks: "",
    prepared_by: "",
    checked_by: "",
    approved_by: "",
    oem_logo_url: "",
  });
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const updateItem = (i: number, patch: Partial<ChallanItem>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const validate = () => {
    if (!form.party_name.trim()) {
      toast.error(`${isOem ? "OEM" : "Customer"} name is required`);
      return false;
    }
    const cleanItems = items.filter((it) => it.part_name.trim() || it.part_no.trim());
    if (cleanItems.length === 0) {
      toast.error("Add at least one material row");
      return false;
    }
    return true;
  };

  const openReview = () => {
    if (validate()) setReviewOpen(true);
  };

  const submit = async () => {
    if (!validate()) return;
    const cleanItems = items.filter((it) => it.part_name.trim() || it.part_no.trim());
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      ...form,
      doc_type: docType,
      challan_no: "",
      dispatch_date: form.dispatch_date || null,
      items: cleanItems,
      created_by: userData.user?.id ?? null,
    };
    const { data, error } = await supabase
      .from("delivery_challans" as never)
      .insert(payload as never).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    setReviewOpen(false);
    toast.success("Delivery Challan created");
    navigate({ to: "/challan/$id", params: { id: (data as { id: string }).id } });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New Delivery Challan — {isOem ? "To OEM" : "To Customer"}</CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle>1. Document Information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><Label>Challan Date *</Label><Input type="date" value={form.challan_date} onChange={(e) => setForm({ ...form, challan_date: e.target.value })} /></div>
          <div><Label>Dispatch Date</Label><Input type="date" value={form.dispatch_date} onChange={(e) => setForm({ ...form, dispatch_date: e.target.value })} /></div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Submitted">Submitted</SelectItem>
                <SelectItem value="Dispatched">Dispatched</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Reference No.</Label><Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
          <div><Label>Gate Pass No.</Label><Input value={form.gate_pass_no} onChange={(e) => setForm({ ...form, gate_pass_no: e.target.value })} /></div>
          <div><Label>Sales Order No.</Label><Input value={form.sales_order_no} onChange={(e) => setForm({ ...form, sales_order_no: e.target.value })} /></div>
          <div><Label>Customer PO No.</Label><Input value={form.customer_po_no} onChange={(e) => setForm({ ...form, customer_po_no: e.target.value })} /></div>
          <div><Label>Invoice No.</Label><Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. {isOem ? "OEM" : "Customer"} Information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>{isOem ? "OEM Name" : "Customer Name"} *</Label><Input value={form.party_name} onChange={(e) => setForm({ ...form, party_name: e.target.value })} /></div>
          <div><Label>{isOem ? "OEM Code" : "Customer Code"}</Label><Input value={form.party_code} onChange={(e) => setForm({ ...form, party_code: e.target.value })} /></div>
          {isOem ? (
            <div><Label>OEM Plant / Location</Label><Input value={form.oem_plant} onChange={(e) => setForm({ ...form, oem_plant: e.target.value })} /></div>
          ) : (
            <div><Label>GSTIN</Label><Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></div>
          )}
          <div><Label>Contact Person</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
          <div><Label>Contact Number</Label><Input value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} /></div>
          {!isOem && (
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          )}
          {isOem && (
            <div><Label>OEM Logo URL (optional)</Label><Input placeholder="https://..." value={form.oem_logo_url} onChange={(e) => setForm({ ...form, oem_logo_url: e.target.value })} /></div>
          )}
          <div className="md:col-span-2"><Label>Delivery Address</Label><Textarea rows={2} value={form.delivery_address} onChange={(e) => setForm({ ...form, delivery_address: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3. Transport Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><Label>Transporter Name</Label><Input value={form.transporter_name} onChange={(e) => setForm({ ...form, transporter_name: e.target.value })} /></div>
          <div><Label>Vehicle Number</Label><Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} /></div>
          <div>
            <Label>Mode of Transport</Label>
            <Select value={form.mode_of_transport} onValueChange={(v) => setForm({ ...form, mode_of_transport: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Road">Road</SelectItem>
                <SelectItem value="Rail">Rail</SelectItem>
                <SelectItem value="Air">Air</SelectItem>
                <SelectItem value="Sea">Sea</SelectItem>
                <SelectItem value="Hand Delivery">Hand Delivery</SelectItem>
                <SelectItem value="Courier">Courier</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Driver Name</Label><Input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} /></div>
          <div><Label>Driver Mobile</Label><Input value={form.driver_mobile} onChange={(e) => setForm({ ...form, driver_mobile: e.target.value })} /></div>
          <div><Label>LR / Consignment No.</Label><Input value={form.lr_number} onChange={(e) => setForm({ ...form, lr_number: e.target.value })} /></div>
          <div><Label>No. of Packages</Label><Input value={form.num_packages} onChange={(e) => setForm({ ...form, num_packages: e.target.value })} /></div>
          <div><Label>Total Weight</Label><Input value={form.total_weight} placeholder="e.g. 25 kg" onChange={(e) => setForm({ ...form, total_weight: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>4. Material Details</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems([...items, emptyItem()])}>
            <Plus className="h-4 w-4 mr-1" />Add Row
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden md:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
            <div className="col-span-1">Sr</div>
            <div className="col-span-2">Part No</div>
            <div className="col-span-2">Part Name</div>
            <div className="col-span-3">Description</div>
            <div className="col-span-1">UOM</div>
            <div className="col-span-1">Qty</div>
            <div className="col-span-1">Batch</div>
            <div className="col-span-1"></div>
          </div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end border-b pb-3">
              <div className="col-span-1 flex items-center justify-center h-9 text-sm font-medium">{i + 1}</div>
              <div className="col-span-6 md:col-span-2"><Input placeholder="Part No" value={it.part_no} onChange={(e) => updateItem(i, { part_no: e.target.value })} /></div>
              <div className="col-span-6 md:col-span-2"><Input placeholder="Part Name" value={it.part_name} onChange={(e) => updateItem(i, { part_name: e.target.value })} /></div>
              <div className="col-span-12 md:col-span-3"><Input placeholder="Description" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} /></div>
              <div className="col-span-3 md:col-span-1"><Input placeholder="UOM" value={it.uom} onChange={(e) => updateItem(i, { uom: e.target.value })} /></div>
              <div className="col-span-3 md:col-span-1"><Input type="number" min="0" placeholder="Qty" value={it.qty} onChange={(e) => updateItem(i, { qty: e.target.value })} /></div>
              <div className="col-span-4 md:col-span-1"><Input placeholder="Batch" value={it.batch_no} onChange={(e) => updateItem(i, { batch_no: e.target.value })} /></div>
              <div className="col-span-2 md:col-span-1">
                <Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))} disabled={items.length === 1}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              {isOem && (
                <>
                  <div className="col-span-6 md:col-span-3 md:col-start-2"><Input placeholder="Model No" value={it.model_no || ""} onChange={(e) => updateItem(i, { model_no: e.target.value })} /></div>
                  <div className="col-span-6 md:col-span-3"><Input placeholder="Serial No" value={it.serial_no || ""} onChange={(e) => updateItem(i, { serial_no: e.target.value })} /></div>
                </>
              )}
            </div>
          ))}
          <div className="text-sm text-muted-foreground">
            Total Qty: <span className="font-medium text-foreground">
              {items.reduce((s, it) => s + (parseFloat(it.qty) || 0), 0)}
            </span> &nbsp;•&nbsp; Rows: {items.length}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>5. Remarks</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Internal Remarks</Label><Textarea rows={2} value={form.internal_remarks} onChange={(e) => setForm({ ...form, internal_remarks: e.target.value })} /></div>
          <div><Label>Dispatch Remarks</Label><Textarea rows={2} value={form.dispatch_remarks} onChange={(e) => setForm({ ...form, dispatch_remarks: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>6. Authorization</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><Label>Prepared By</Label><Input value={form.prepared_by} onChange={(e) => setForm({ ...form, prepared_by: e.target.value })} /></div>
          <div><Label>Checked By</Label><Input value={form.checked_by} onChange={(e) => setForm({ ...form, checked_by: e.target.value })} /></div>
          <div><Label>Approved By</Label><Input value={form.approved_by} onChange={(e) => setForm({ ...form, approved_by: e.target.value })} /></div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button size="lg" variant="outline" onClick={openReview} disabled={busy}>
          <Eye className="h-4 w-4 mr-2" />Review Before Saving
        </Button>
        <Button size="lg" onClick={submit} disabled={busy}>Save & Print Challan</Button>
      </div>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Delivery Challan — {isOem ? "To OEM" : "To Customer"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 text-sm">
            <section>
              <h3 className="font-semibold mb-2 border-b pb-1">Document Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                <ReviewField label="Challan Date" value={form.challan_date} />
                <ReviewField label="Dispatch Date" value={form.dispatch_date} />
                <ReviewField label="Status" value={form.status} />
                <ReviewField label="Reference No." value={form.reference_no} />
                <ReviewField label="Gate Pass No." value={form.gate_pass_no} />
                <ReviewField label="Sales Order No." value={form.sales_order_no} />
                <ReviewField label="Customer PO No." value={form.customer_po_no} />
                <ReviewField label="Invoice No." value={form.invoice_no} />
              </div>
            </section>

            <section>
              <h3 className="font-semibold mb-2 border-b pb-1">{isOem ? "OEM" : "Customer"} Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                <ReviewField label={isOem ? "OEM Name" : "Customer Name"} value={form.party_name} />
                <ReviewField label={isOem ? "OEM Code" : "Customer Code"} value={form.party_code} />
                {isOem ? (
                  <ReviewField label="OEM Plant" value={form.oem_plant} />
                ) : (
                  <ReviewField label="GSTIN" value={form.gstin} />
                )}
                <ReviewField label="Contact Person" value={form.contact_person} />
                <ReviewField label="Contact Number" value={form.contact_number} />
                {!isOem && <ReviewField label="Email" value={form.email} />}
                <ReviewField label="Delivery Address" value={form.delivery_address} className="col-span-2 md:col-span-3" />
              </div>
            </section>

            <section>
              <h3 className="font-semibold mb-2 border-b pb-1">Transport Details</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                <ReviewField label="Transporter" value={form.transporter_name} />
                <ReviewField label="Vehicle No." value={form.vehicle_number} />
                <ReviewField label="Mode" value={form.mode_of_transport} />
                <ReviewField label="Driver Name" value={form.driver_name} />
                <ReviewField label="Driver Mobile" value={form.driver_mobile} />
                <ReviewField label="LR No." value={form.lr_number} />
                <ReviewField label="Packages" value={form.num_packages} />
                <ReviewField label="Total Weight" value={form.total_weight} />
              </div>
            </section>

            <section>
              <h3 className="font-semibold mb-2 border-b pb-1">Material Details</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border">
                  <thead className="bg-muted">
                    <tr>
                      <th className="border p-1">Sr</th>
                      <th className="border p-1">Part No</th>
                      <th className="border p-1">Part Name</th>
                      <th className="border p-1">Description</th>
                      {isOem && <th className="border p-1">Model</th>}
                      {isOem && <th className="border p-1">Serial</th>}
                      <th className="border p-1">UOM</th>
                      <th className="border p-1">Qty</th>
                      <th className="border p-1">Batch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.filter((it) => it.part_name.trim() || it.part_no.trim()).map((it, i) => (
                      <tr key={i}>
                        <td className="border p-1 text-center">{i + 1}</td>
                        <td className="border p-1">{it.part_no}</td>
                        <td className="border p-1">{it.part_name}</td>
                        <td className="border p-1">{it.description}</td>
                        {isOem && <td className="border p-1">{it.model_no}</td>}
                        {isOem && <td className="border p-1">{it.serial_no}</td>}
                        <td className="border p-1">{it.uom}</td>
                        <td className="border p-1 text-right">{it.qty}</td>
                        <td className="border p-1">{it.batch_no}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Total Qty: <span className="font-medium text-foreground">
                  {items.reduce((s, it) => s + (parseFloat(it.qty) || 0), 0)}
                </span>
              </div>
            </section>

            {(form.internal_remarks || form.dispatch_remarks) && (
              <section>
                <h3 className="font-semibold mb-2 border-b pb-1">Remarks</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                  <ReviewField label="Internal" value={form.internal_remarks} />
                  <ReviewField label="Dispatch" value={form.dispatch_remarks} />
                </div>
              </section>
            )}

            <section>
              <h3 className="font-semibold mb-2 border-b pb-1">Authorization</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                <ReviewField label="Prepared By" value={form.prepared_by} />
                <ReviewField label="Checked By" value={form.checked_by} />
                <ReviewField label="Approved By" value={form.approved_by} />
              </div>
            </section>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={busy}>
              Back to Edit
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Saving..." : "Confirm, Save & Print"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewField({ label, value, className = "" }: { label: string; value?: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{value || "—"}</div>
    </div>
  );
}