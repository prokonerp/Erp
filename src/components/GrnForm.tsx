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
import { emptyGrnItem, CATEGORY_LABEL, type GrnCategory, type GrnItem } from "@/lib/grn";

type Props = { category: GrnCategory };

export function GrnForm({ category }: Props) {
  const navigate = useNavigate();
  const isOem = category === "oem";
  const isCust = category === "customer";
  const [items, setItems] = useState<GrnItem[]>([emptyGrnItem()]);
  const [form, setForm] = useState({
    status: "Draft",
    grn_date: new Date().toISOString().slice(0, 10),
    receipt_date: "",
    reference_no: "",
    source_doc_type: isCust ? "Return Note" : isOem ? "OEM Dispatch" : "Vendor DC",
    source_doc_no: "",
    source_doc_date: "",
    po_no: "",
    invoice_no: "",
    invoice_date: "",
    ticket_no: "",
    source_name: "",
    source_code: "",
    source_address: "",
    source_contact_person: "",
    source_contact_number: "",
    source_email: "",
    source_gstin: "",
    oem_plant: "",
    transporter_name: "",
    vehicle_number: "",
    driver_name: "",
    driver_mobile: "",
    lr_number: "",
    mode_of_transport: "Road",
    num_packages: "",
    total_weight: "",
    qc_status: "Pending",
    qc_inspector: "",
    qc_date: "",
    qc_remarks: "",
    warehouse_name: "",
    storage_location: "",
    bin_no: "",
    internal_remarks: "",
    receipt_remarks: "",
    received_by: "",
    checked_by: "",
    approved_by: "",
    oem_logo_url: "",
  });
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const sourceLabel = isCust ? "Customer" : isOem ? "OEM" : "Vendor / Source";

  const updateItem = (i: number, patch: Partial<GrnItem>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const totals = items.reduce(
    (acc, it) => {
      acc.received += parseFloat(it.qty_received) || 0;
      acc.accepted += parseFloat(it.qty_accepted) || 0;
      acc.rejected += parseFloat(it.qty_rejected) || 0;
      return acc;
    },
    { received: 0, accepted: 0, rejected: 0 }
  );

  const validate = () => {
    if (!form.source_name.trim()) { toast.error(`${sourceLabel} name is required`); return false; }
    const clean = items.filter((it) => it.part_name.trim() || it.part_no.trim());
    if (clean.length === 0) { toast.error("Add at least one material row"); return false; }
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    const clean = items.filter((it) => it.part_name.trim() || it.part_no.trim());
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      ...form,
      category,
      grn_no: "",
      receipt_date: form.receipt_date || null,
      source_doc_date: form.source_doc_date || null,
      invoice_date: form.invoice_date || null,
      qc_date: form.qc_date || null,
      accepted_qty: totals.accepted,
      rejected_qty: totals.rejected,
      items: clean,
      attachments: [],
      created_by: userData.user?.id ?? null,
    };
    const { data, error } = await supabase
      .from("grns" as never)
      .insert(payload as never).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    setReviewOpen(false);
    toast.success("GRN created");
    navigate({ to: "/grn/$id", params: { id: (data as { id: string }).id } });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New GRN — {CATEGORY_LABEL[category]}</CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle>1. GRN Information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><Label>GRN Date *</Label><Input type="date" value={form.grn_date} onChange={(e) => setForm({ ...form, grn_date: e.target.value })} /></div>
          <div><Label>Material Receipt Date</Label><Input type="date" value={form.receipt_date} onChange={(e) => setForm({ ...form, receipt_date: e.target.value })} /></div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Draft","Received","QC Pending","Approved","Rejected"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Reference No.</Label><Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></div>
          <div><Label>Source Document Type</Label><Input value={form.source_doc_type} onChange={(e) => setForm({ ...form, source_doc_type: e.target.value })} /></div>
          <div><Label>Source Document No.</Label><Input value={form.source_doc_no} onChange={(e) => setForm({ ...form, source_doc_no: e.target.value })} /></div>
          <div><Label>Source Document Date</Label><Input type="date" value={form.source_doc_date} onChange={(e) => setForm({ ...form, source_doc_date: e.target.value })} /></div>
          {!isCust && <div><Label>PO No.</Label><Input value={form.po_no} onChange={(e) => setForm({ ...form, po_no: e.target.value })} /></div>}
          {!isCust && <div><Label>Invoice No.</Label><Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} /></div>}
          {!isCust && <div><Label>Invoice Date</Label><Input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></div>}
          {isCust && <div><Label>Ticket / Complaint No.</Label><Input value={form.ticket_no} onChange={(e) => setForm({ ...form, ticket_no: e.target.value })} /></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. {sourceLabel} Information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>{sourceLabel} Name *</Label><Input value={form.source_name} onChange={(e) => setForm({ ...form, source_name: e.target.value })} /></div>
          <div><Label>{sourceLabel} Code</Label><Input value={form.source_code} onChange={(e) => setForm({ ...form, source_code: e.target.value })} /></div>
          {isOem ? (
            <div><Label>OEM Plant / Location</Label><Input value={form.oem_plant} onChange={(e) => setForm({ ...form, oem_plant: e.target.value })} /></div>
          ) : (
            <div><Label>GSTIN</Label><Input value={form.source_gstin} onChange={(e) => setForm({ ...form, source_gstin: e.target.value })} /></div>
          )}
          <div><Label>Contact Person</Label><Input value={form.source_contact_person} onChange={(e) => setForm({ ...form, source_contact_person: e.target.value })} /></div>
          <div><Label>Contact Number</Label><Input value={form.source_contact_number} onChange={(e) => setForm({ ...form, source_contact_number: e.target.value })} /></div>
          <div><Label>Email</Label><Input type="email" value={form.source_email} onChange={(e) => setForm({ ...form, source_email: e.target.value })} /></div>
          {isOem && <div><Label>OEM Logo URL (optional)</Label><Input placeholder="https://..." value={form.oem_logo_url} onChange={(e) => setForm({ ...form, oem_logo_url: e.target.value })} /></div>}
          <div className="md:col-span-2"><Label>Address</Label><Textarea rows={2} value={form.source_address} onChange={(e) => setForm({ ...form, source_address: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3. Transport Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><Label>Transporter</Label><Input value={form.transporter_name} onChange={(e) => setForm({ ...form, transporter_name: e.target.value })} /></div>
          <div><Label>Vehicle Number</Label><Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} /></div>
          <div>
            <Label>Mode</Label>
            <Select value={form.mode_of_transport} onValueChange={(v) => setForm({ ...form, mode_of_transport: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Road","Rail","Air","Sea","Hand Delivery","Courier"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
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
          <CardTitle>4. Material Receipt Details</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems([...items, emptyGrnItem()])}>
            <Plus className="h-4 w-4 mr-1" />Add Row
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end border-b pb-3">
              <div className="col-span-1 flex items-center justify-center h-9 text-sm font-medium">{i + 1}</div>
              <div className="col-span-6 md:col-span-2"><Input placeholder="Part No" value={it.part_no} onChange={(e) => updateItem(i, { part_no: e.target.value })} /></div>
              <div className="col-span-6 md:col-span-2"><Input placeholder="Part Name" value={it.part_name} onChange={(e) => updateItem(i, { part_name: e.target.value })} /></div>
              <div className="col-span-12 md:col-span-2"><Input placeholder="Description" value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} /></div>
              <div className="col-span-3 md:col-span-1"><Input placeholder="UOM" value={it.uom} onChange={(e) => updateItem(i, { uom: e.target.value })} /></div>
              <div className="col-span-3 md:col-span-1"><Input type="number" min="0" placeholder="Recv" value={it.qty_received} onChange={(e) => updateItem(i, { qty_received: e.target.value })} /></div>
              <div className="col-span-3 md:col-span-1"><Input type="number" min="0" placeholder="Acc" value={it.qty_accepted} onChange={(e) => updateItem(i, { qty_accepted: e.target.value })} /></div>
              <div className="col-span-3 md:col-span-1"><Input type="number" min="0" placeholder="Rej" value={it.qty_rejected} onChange={(e) => updateItem(i, { qty_rejected: e.target.value })} /></div>
              <div className="col-span-2 md:col-span-1">
                <Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))} disabled={items.length === 1}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="col-span-6 md:col-span-3 md:col-start-2"><Input placeholder="Batch / Lot No" value={it.batch_no} onChange={(e) => updateItem(i, { batch_no: e.target.value })} /></div>
              {!isCust ? (
                <>
                  <div className="col-span-6 md:col-span-2"><Input placeholder="Model No" value={it.model_no || ""} onChange={(e) => updateItem(i, { model_no: e.target.value })} /></div>
                  <div className="col-span-6 md:col-span-2"><Input placeholder="Serial No" value={it.serial_no || ""} onChange={(e) => updateItem(i, { serial_no: e.target.value })} /></div>
                </>
              ) : null}
              <div className="col-span-6 md:col-span-2"><Input placeholder="Condition" value={it.condition || ""} onChange={(e) => updateItem(i, { condition: e.target.value })} /></div>
              <div className="col-span-12 md:col-span-3"><Input placeholder="Item Remarks" value={it.remarks || ""} onChange={(e) => updateItem(i, { remarks: e.target.value })} /></div>
            </div>
          ))}
          <div className="text-sm text-muted-foreground">
            Received: <span className="font-medium text-foreground">{totals.received}</span> &nbsp;•&nbsp;
            Accepted: <span className="font-medium text-foreground">{totals.accepted}</span> &nbsp;•&nbsp;
            Rejected: <span className="font-medium text-foreground">{totals.rejected}</span> &nbsp;•&nbsp;
            Rows: {items.length}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>5. Quality Inspection</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>QC Status</Label>
            <Select value={form.qc_status} onValueChange={(v) => setForm({ ...form, qc_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Pending","Accepted","Partially Accepted","Rejected","Waived"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>QC Inspector</Label><Input value={form.qc_inspector} onChange={(e) => setForm({ ...form, qc_inspector: e.target.value })} /></div>
          <div><Label>QC Date</Label><Input type="date" value={form.qc_date} onChange={(e) => setForm({ ...form, qc_date: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>QC Remarks</Label><Textarea rows={2} value={form.qc_remarks} onChange={(e) => setForm({ ...form, qc_remarks: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>6. Storage Information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><Label>Warehouse</Label><Input value={form.warehouse_name} onChange={(e) => setForm({ ...form, warehouse_name: e.target.value })} /></div>
          <div><Label>Storage Location</Label><Input value={form.storage_location} onChange={(e) => setForm({ ...form, storage_location: e.target.value })} /></div>
          <div><Label>Bin / Rack No.</Label><Input value={form.bin_no} onChange={(e) => setForm({ ...form, bin_no: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>7. Remarks</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label>Receipt Remarks</Label><Textarea rows={2} value={form.receipt_remarks} onChange={(e) => setForm({ ...form, receipt_remarks: e.target.value })} /></div>
          <div><Label>Internal Remarks</Label><Textarea rows={2} value={form.internal_remarks} onChange={(e) => setForm({ ...form, internal_remarks: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>8. Authorization</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><Label>Received By</Label><Input value={form.received_by} onChange={(e) => setForm({ ...form, received_by: e.target.value })} /></div>
          <div><Label>Checked By</Label><Input value={form.checked_by} onChange={(e) => setForm({ ...form, checked_by: e.target.value })} /></div>
          <div><Label>Approved By</Label><Input value={form.approved_by} onChange={(e) => setForm({ ...form, approved_by: e.target.value })} /></div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button size="lg" variant="outline" onClick={() => validate() && setReviewOpen(true)} disabled={busy}>
          <Eye className="h-4 w-4 mr-2" />Review Before Saving
        </Button>
        <Button size="lg" onClick={submit} disabled={busy}>Save & Print GRN</Button>
      </div>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review GRN — {CATEGORY_LABEL[category]}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <Section title="GRN Information">
              <F label="GRN Date" v={form.grn_date} />
              <F label="Receipt Date" v={form.receipt_date} />
              <F label="Status" v={form.status} />
              <F label="Reference No." v={form.reference_no} />
              <F label="Source Doc" v={`${form.source_doc_type} ${form.source_doc_no}`.trim()} />
              {!isCust && <F label="PO No." v={form.po_no} />}
              {!isCust && <F label="Invoice" v={form.invoice_no} />}
              {isCust && <F label="Ticket No." v={form.ticket_no} />}
            </Section>
            <Section title={`${sourceLabel} Information`}>
              <F label="Name" v={form.source_name} />
              <F label="Code" v={form.source_code} />
              {isOem ? <F label="Plant" v={form.oem_plant} /> : <F label="GSTIN" v={form.source_gstin} />}
              <F label="Contact" v={form.source_contact_person} />
              <F label="Phone" v={form.source_contact_number} />
              <F label="Email" v={form.source_email} />
              <F label="Address" v={form.source_address} cls="col-span-2 md:col-span-3" />
            </Section>
            <Section title="Transport">
              <F label="Transporter" v={form.transporter_name} />
              <F label="Vehicle" v={form.vehicle_number} />
              <F label="Mode" v={form.mode_of_transport} />
              <F label="LR No." v={form.lr_number} />
              <F label="Driver" v={form.driver_name} />
              <F label="Pkgs / Weight" v={`${form.num_packages || "-"} / ${form.total_weight || "-"}`} />
            </Section>
            <div>
              <h3 className="font-semibold mb-2 border-b pb-1">Material</h3>
              <table className="w-full text-xs border">
                <thead className="bg-muted">
                  <tr>
                    <th className="border p-1">Sr</th>
                    <th className="border p-1">Part No</th>
                    <th className="border p-1">Part Name</th>
                    <th className="border p-1">UOM</th>
                    <th className="border p-1">Recv</th>
                    <th className="border p-1">Acc</th>
                    <th className="border p-1">Rej</th>
                    <th className="border p-1">Batch</th>
                  </tr>
                </thead>
                <tbody>
                  {items.filter((it) => it.part_name.trim() || it.part_no.trim()).map((it, i) => (
                    <tr key={i}>
                      <td className="border p-1 text-center">{i + 1}</td>
                      <td className="border p-1">{it.part_no}</td>
                      <td className="border p-1">{it.part_name}</td>
                      <td className="border p-1">{it.uom}</td>
                      <td className="border p-1 text-right">{it.qty_received}</td>
                      <td className="border p-1 text-right">{it.qty_accepted}</td>
                      <td className="border p-1 text-right">{it.qty_rejected}</td>
                      <td className="border p-1">{it.batch_no}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-xs text-muted-foreground mt-1">
                Recv {totals.received} • Acc {totals.accepted} • Rej {totals.rejected}
              </div>
            </div>
            <Section title="Quality Inspection">
              <F label="QC Status" v={form.qc_status} />
              <F label="Inspector" v={form.qc_inspector} />
              <F label="QC Date" v={form.qc_date} />
              <F label="QC Remarks" v={form.qc_remarks} cls="col-span-2 md:col-span-3" />
            </Section>
            <Section title="Storage">
              <F label="Warehouse" v={form.warehouse_name} />
              <F label="Location" v={form.storage_location} />
              <F label="Bin" v={form.bin_no} />
            </Section>
            <Section title="Authorization">
              <F label="Received By" v={form.received_by} />
              <F label="Checked By" v={form.checked_by} />
              <F label="Approved By" v={form.approved_by} />
            </Section>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={busy}>Back to Edit</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Saving..." : "Confirm, Save & Print"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-semibold mb-2 border-b pb-1">{title}</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">{children}</div>
    </section>
  );
}
function F({ label, v, cls = "" }: { label: string; v?: string; cls?: string }) {
  return (
    <div className={cls}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium break-words">{v || "—"}</div>
    </div>
  );
}