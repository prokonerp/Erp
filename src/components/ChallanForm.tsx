import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Eye, Save } from "lucide-react";
import { toast } from "sonner";
import type { ChallanItem, DocType } from "@/lib/challan";
import { emptyItem } from "@/lib/challan";
import { CustomerPicker } from "@/components/CustomerPicker";
import { VendorPicker, vendorShortCode } from "@/components/VendorPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import { ContactPersonPicker } from "@/components/ContactPersonPicker";
import type { Customer } from "@/lib/crm";
import { FormShell, FormSection, FormGrid, FormField, StickyMobileActions } from "@/components/form-kit";

const custCode = (id: string) => `CUST-${id.slice(0, 6).toUpperCase()}`;

type Props = { docType?: DocType; editId?: string };

export function ChallanForm({ docType: initialDocType, editId }: Props) {
  const navigate = useNavigate();
  const [dcType, setDcType] = useState<DocType>(initialDocType ?? "customer");
  const isOem = dcType === "oem";
  const [items, setItems] = useState<ChallanItem[]>([emptyItem()]);
  const [partyId, setPartyId] = useState<string | null>(null);
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
    city: "",
    state: "",
    pin_code: "",
    internal_remarks: "",
    dispatch_remarks: "",
    prepared_by: "",
    checked_by: "",
    approved_by: "",
    oem_logo_url: "",
  });
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  // Prefill from a source document (e.g. Indent → Generate Delivery Challan).
  useEffect(() => {
    if (editId) return; // do not run session prefill in edit mode
    if (isOem) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("challan:prefill:new-customer"); } catch { /* noop */ }
    if (!raw) return;
    try { sessionStorage.removeItem("challan:prefill:new-customer"); } catch { /* noop */ }
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw); } catch { return; }
    const customerId = (payload.customer_id as string | undefined) || null;
    const prefillItems = Array.isArray(payload.items) ? (payload.items as Array<Partial<ChallanItem>>) : [];
    if (prefillItems.length > 0) {
      setItems(prefillItems.map((it) => ({ ...emptyItem(), ...it })) as ChallanItem[]);
    }
    setForm((f) => ({
      ...f,
      reference_no: (payload.reference_no as string) || f.reference_no,
      internal_remarks: (payload.internal_remarks as string) || f.internal_remarks,
    }));
    // Fetch and apply the customer so the picker + party fields are populated.
    if (customerId) {
      (async () => {
        const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
        if (data) applyCustomer(customerId, data as unknown as Customer);
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load existing record for edit mode.
  useEffect(() => {
    if (!editId) return;
    (async () => {
      const { data, error } = await supabase
        .from("delivery_challans" as never)
        .select("*").eq("id", editId).maybeSingle();
      if (error || !data) {
        toast.error(error?.message || "Delivery Challan not found");
        return;
      }
      const r = data as Record<string, unknown>;
      setDcType((r.doc_type as DocType) || "customer");
      const arr = Array.isArray(r.items) ? (r.items as ChallanItem[]) : [];
      setItems(arr.length > 0 ? arr.map((it) => ({ ...emptyItem(), ...it })) : [emptyItem()]);
      setForm((f) => ({
        ...f,
        status: (r.status as string) || f.status,
        challan_date: (r.challan_date as string) || f.challan_date,
        dispatch_date: (r.dispatch_date as string) || "",
        reference_no: (r.reference_no as string) || "",
        gate_pass_no: (r.gate_pass_no as string) || "",
        sales_order_no: (r.sales_order_no as string) || "",
        customer_po_no: (r.customer_po_no as string) || "",
        invoice_no: (r.invoice_no as string) || "",
        party_name: (r.party_name as string) || "",
        party_code: (r.party_code as string) || "",
        gstin: (r.gstin as string) || "",
        oem_plant: (r.oem_plant as string) || "",
        contact_person: (r.contact_person as string) || "",
        contact_number: (r.contact_number as string) || "",
        email: (r.email as string) || "",
        delivery_address: (r.delivery_address as string) || "",
        transporter_name: (r.transporter_name as string) || "",
        vehicle_number: (r.vehicle_number as string) || "",
        driver_name: (r.driver_name as string) || "",
        driver_mobile: (r.driver_mobile as string) || "",
        lr_number: (r.lr_number as string) || "",
        mode_of_transport: (r.mode_of_transport as string) || "Road",
        num_packages: (r.num_packages as string) || "",
        total_weight: (r.total_weight as string) || "",
        city: (r.city as string) || "",
        state: (r.state as string) || "",
        pin_code: (r.pin_code as string) || "",
        internal_remarks: (r.internal_remarks as string) || "",
        dispatch_remarks: (r.dispatch_remarks as string) || "",
        prepared_by: (r.prepared_by as string) || "",
        checked_by: (r.checked_by as string) || "",
        approved_by: (r.approved_by as string) || "",
        oem_logo_url: (r.oem_logo_url as string) || "",
      }));
    })();
  }, [editId]);

  const updateItem = (i: number, patch: Partial<ChallanItem>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const applyCustomer = (id: string | null, c: Customer | null) => {
    setPartyId(id);
    if (!c) {
      setForm((f) => ({ ...f, party_name: "", party_code: "", gstin: "", contact_person: "", contact_number: "", email: "", delivery_address: "" }));
      return;
    }
    setForm((f) => ({
      ...f,
      party_name: c.company || "",
      party_code: custCode(c.id),
      gstin: c.gst || "",
      contact_person: c.contact_name || "",
      contact_number: c.phone || "",
      email: c.email || "",
      delivery_address: c.shipping_address || c.billing_address || c.address || "",
    }));
  };

  const applyVendor = (id: string | null, v: any) => {
    setPartyId(id);
    if (!v) {
      setForm((f) => ({ ...f, party_name: "", party_code: "", gstin: "", contact_person: "", contact_number: "", email: "", delivery_address: "", oem_plant: "" }));
      return;
    }
    setForm((f) => ({
      ...f,
      party_name: v.name || "",
      party_code: vendorShortCode(v.id),
      gstin: v.gstin || "",
      contact_person: v.contact_name || "",
      contact_number: v.phone || "",
      email: v.email || "",
      delivery_address: v.address || "",
    }));
  };

  // Reset party when DC Type changes (Customer master vs Vendor/OEM master).
  const changeDcType = (t: DocType) => {
    if (t === dcType) return;
    setDcType(t);
    setPartyId(null);
    setForm((f) => ({
      ...f,
      party_name: "",
      party_code: "",
      gstin: "",
      oem_plant: "",
      contact_person: "",
      contact_number: "",
      email: "",
      delivery_address: "",
    }));
  };

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
    if (editId) {
      const updatePayload = {
        ...form,
        doc_type: dcType,
        dispatch_date: form.dispatch_date || null,
        items: cleanItems,
      };
      const { error } = await supabase
        .from("delivery_challans" as never)
        .update(updatePayload as never)
        .eq("id", editId);
      setBusy(false);
      if (error) return toast.error(error.message);
      setReviewOpen(false);
      toast.success("Delivery Challan updated");
      navigate({ to: "/challan/$id", params: { id: editId } });
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      ...form,
      doc_type: dcType,
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

  const totalQty = items.reduce((s, it) => s + (parseFloat(it.qty) || 0), 0);
  const partyLabel = isOem ? "OEM" : "Customer";

  const actions = (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openReview} disabled={busy} className="gap-1.5">
        <Eye className="h-4 w-4" />
        <span className="hidden sm:inline">Review</span>
      </Button>
      <Button type="button" size="sm" onClick={submit} disabled={busy} className="gap-1.5">
        <Save className="h-4 w-4" />
        <span className="hidden sm:inline">Save &amp; Print</span>
        <span className="sm:hidden">Save</span>
      </Button>
    </>
  );

  return (
    <FormShell
      title={editId ? "Edit Delivery Challan" : "New Delivery Challan"}
      description="Capture document, party, transport, material and authorization details."
      actions={actions}
    >
      <FormSection title="DC Type" defaultOpen>
        <div className="flex flex-wrap items-center gap-4">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="dc_type"
              className="accent-primary"
              checked={dcType === "customer"}
              onChange={() => changeDcType("customer")}
            />
            <span className="text-sm font-medium">To Customer</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="dc_type"
              className="accent-primary"
              checked={dcType === "oem"}
              onChange={() => changeDcType("oem")}
            />
            <span className="text-sm font-medium">To OEM</span>
          </label>
          <span className="text-xs text-muted-foreground">
            Switching type resets recipient details; other fields are preserved.
          </span>
        </div>
      </FormSection>

      <FormSection title="Document Information" defaultOpen>
        <FormGrid>
          <FormField size="sm" label="Challan Date" required>
            <Input type="date" value={form.challan_date} onChange={(e) => setForm({ ...form, challan_date: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Dispatch Date">
            <Input type="date" value={form.dispatch_date} onChange={(e) => setForm({ ...form, dispatch_date: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Status">
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Submitted">Submitted</SelectItem>
                <SelectItem value="Dispatched">Dispatched</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField size="sm" label="Reference No.">
            <Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Gate Pass No.">
            <Input value={form.gate_pass_no} onChange={(e) => setForm({ ...form, gate_pass_no: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Sales Order No.">
            <Input value={form.sales_order_no} onChange={(e) => setForm({ ...form, sales_order_no: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Customer PO No.">
            <Input value={form.customer_po_no} onChange={(e) => setForm({ ...form, customer_po_no: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Invoice No.">
            <Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection title={`${partyLabel} Information`} defaultOpen>
        <FormGrid>
          <FormField size="full" label={isOem ? "OEM (from Vendor Master)" : "Customer (from Master)"} required>
            {isOem ? (
              <VendorPicker value={partyId} onChange={applyVendor} required label="OEM" placeholder="Search OEM / vendor…" />
            ) : (
              <CustomerPicker value={partyId} onChange={applyCustomer} required placeholder="Search customer by name, mobile or GSTIN…" />
            )}
          </FormField>
          <FormField size="md" label={`${partyLabel} Name`} required>
            <Input value={form.party_name} readOnly className="bg-muted/40" />
          </FormField>
          <FormField size="md" label={`${partyLabel} Code`}>
            <Input value={form.party_code} readOnly className="bg-muted/40" />
          </FormField>
          {isOem ? (
            <FormField size="md" label="OEM Plant / Location">
              <Input value={form.oem_plant} onChange={(e) => setForm({ ...form, oem_plant: e.target.value })} />
            </FormField>
          ) : (
            <FormField size="md" label="GSTIN">
              <Input value={form.gstin} readOnly className="bg-muted/40" />
            </FormField>
          )}
          <FormField size="md" label="Contact Person">
            {dcType === "customer" && (
              <div className="mb-1.5">
                <ContactPersonPicker
                  customerId={partyId}
                  onPick={(c) => setForm((f) => ({
                    ...f,
                    contact_person: c.name,
                    contact_number: c.phone || f.contact_number,
                    email: c.email || f.email,
                  }))}
                />
              </div>
            )}
            <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
          </FormField>
          <FormField size="md" label={isOem ? "Contact" : "Contact Number"}>
            <Input value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} />
          </FormField>
          <FormField size="md" label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </FormField>
          {isOem && (
            <FormField size="md" label="City">
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </FormField>
          )}
          <FormField size="sm" label="State">
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Pin Code">
            <Input value={form.pin_code} onChange={(e) => setForm({ ...form, pin_code: e.target.value })} />
          </FormField>
          {isOem && (
            <FormField size="md" label="OEM Logo URL (optional)">
              <Input placeholder="https://..." value={form.oem_logo_url} onChange={(e) => setForm({ ...form, oem_logo_url: e.target.value })} />
            </FormField>
          )}
          <FormField size="xl" label="Delivery Address">
            <Textarea rows={2} value={form.delivery_address} onChange={(e) => setForm({ ...form, delivery_address: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection title="Shipment & Transport Details">
        <FormGrid>
          <FormField size="md" label="Courier / Transporter">
            <Input value={form.transporter_name} onChange={(e) => setForm({ ...form, transporter_name: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Docket #">
            <Input value={form.lr_number} onChange={(e) => setForm({ ...form, lr_number: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Expected Date">
            <Input type="date" value={form.dispatch_date} onChange={(e) => setForm({ ...form, dispatch_date: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Shipment Mode">
            <Select value={form.mode_of_transport} onValueChange={(v) => setForm({ ...form, mode_of_transport: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Road","Rail","Air","Sea","Hand Delivery","Courier"].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField size="sm" label="Vehicle Number">
            <Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} />
          </FormField>
          <FormField size="md" label={isOem ? "Driver Name" : "Engineer Name"}>
            <Input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} />
          </FormField>
          <FormField size="sm" label={isOem ? "Driver Mobile" : "Engineer Contact"}>
            <Input value={form.driver_mobile} onChange={(e) => setForm({ ...form, driver_mobile: e.target.value })} />
          </FormField>
          <FormField size="sm" label="No. of Packs">
            <Input value={form.num_packages} onChange={(e) => setForm({ ...form, num_packages: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Total Weight">
            <Input value={form.total_weight} placeholder="e.g. 25 kg" onChange={(e) => setForm({ ...form, total_weight: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection
        title="Material Details"
        description={`${items.length} row(s) • Total qty ${totalQty}`}
        defaultOpen
        right={
          <Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, emptyItem()])} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Row
          </Button>
        }
      >
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="w-full text-sm border-separate border-spacing-0 min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-muted/60">
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 w-10">#</th>
                <th className="px-2 py-1.5 min-w-[220px]">Product</th>
                <th className="px-2 py-1.5 w-32">OEM Ref ID</th>
                {isOem ? (
                  <>
                    <th className="px-2 py-1.5 w-32">Model</th>
                    <th className="px-2 py-1.5 w-40">Good/Defective Sr No</th>
                    <th className="px-2 py-1.5 w-28">Oracle #</th>
                    <th className="px-2 py-1.5 w-28">Stock Type</th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-1.5 w-32">Defective Model</th>
                    <th className="px-2 py-1.5 w-32">Defective Sr No</th>
                    <th className="px-2 py-1.5 w-28">Oracle #</th>
                    <th className="px-2 py-1.5 w-32">Good Model</th>
                    <th className="px-2 py-1.5 w-32">Good Sr No</th>
                  </>
                )}
                <th className="px-2 py-1.5 w-20">UOM</th>
                <th className="px-2 py-1.5 w-20">Qty</th>
                <th className="px-2 py-1.5 w-20">HSN</th>
                <th className="px-2 py-1.5 w-24">Unit Price</th>
                <th className="px-2 py-1.5 w-24">Weight (KG)</th>
                {isOem && <th className="px-2 py-1.5 w-40">Good Return Reason</th>}
                <th className="px-2 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-2 py-1.5 text-center text-xs text-muted-foreground border-t border-border/60">{i + 1}</td>
                  <td className="px-2 py-1.5 align-top border-t border-border/60">
                    <ProductMasterPicker
                      onPick={(p) => updateItem(i, {
                        part_no: p.sku || p.model || "",
                        part_name: p.name,
                        description: p.description || "",
                        uom: p.unit || it.uom || "Nos",
                        model_no: p.model || "",
                        hsn: (p as any).hsn || it.hsn || "",
                        unit_price: it.unit_price || (p.default_price != null ? String(p.default_price) : ""),
                        weight_kg: it.weight_kg || (p.weight_kg != null ? String(p.weight_kg) : ""),
                      })}
                    />
                    {(it.part_no || it.part_name) && (
                      <div className="mt-1 text-[11px] text-muted-foreground truncate">
                        {[it.part_no, it.part_name].filter(Boolean).join(" — ")}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 border-t border-border/60">
                    <Input value={it.oem_ref_id || ""} onChange={(e) => updateItem(i, { oem_ref_id: e.target.value })} />
                  </td>
                  {isOem ? (
                    <>
                      <td className="px-2 py-1.5 border-t border-border/60">
                        <Input value={it.model_no || ""} onChange={(e) => updateItem(i, { model_no: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 border-t border-border/60">
                        <Input value={it.good_defective_serial || ""} onChange={(e) => updateItem(i, { good_defective_serial: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 border-t border-border/60">
                        <Input value={it.oracle_no || ""} onChange={(e) => updateItem(i, { oracle_no: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 border-t border-border/60">
                        <Select value={it.stock_type || ""} onValueChange={(v) => updateItem(i, { stock_type: v })}>
                          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Good">Good</SelectItem>
                            <SelectItem value="Defective">Defective</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5 border-t border-border/60">
                        <Input value={it.defective_model || ""} onChange={(e) => updateItem(i, { defective_model: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 border-t border-border/60">
                        <Input value={it.defective_serial || ""} onChange={(e) => updateItem(i, { defective_serial: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 border-t border-border/60">
                        <Input value={it.oracle_no || ""} onChange={(e) => updateItem(i, { oracle_no: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 border-t border-border/60">
                        <Input value={it.good_model || ""} onChange={(e) => updateItem(i, { good_model: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 border-t border-border/60">
                        <Input value={it.good_serial || ""} onChange={(e) => updateItem(i, { good_serial: e.target.value })} />
                      </td>
                    </>
                  )}
                  <td className="px-2 py-1.5 border-t border-border/60">
                    <Input value={it.uom} onChange={(e) => updateItem(i, { uom: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 border-t border-border/60">
                    <Input type="number" min="0" value={it.qty} onChange={(e) => updateItem(i, { qty: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 border-t border-border/60">
                    <Input value={it.hsn || ""} onChange={(e) => updateItem(i, { hsn: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 border-t border-border/60">
                    <Input type="number" min="0" value={it.unit_price || ""} onChange={(e) => updateItem(i, { unit_price: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5 border-t border-border/60">
                    <Input type="number" min="0" value={it.weight_kg || ""} onChange={(e) => updateItem(i, { weight_kg: e.target.value })} />
                  </td>
                  {isOem && (
                    <td className="px-2 py-1.5 border-t border-border/60">
                      <Input value={it.good_return_reason || ""} onChange={(e) => updateItem(i, { good_return_reason: e.target.value })} />
                    </td>
                  )}
                  <td className="px-2 py-1.5 border-t border-border/60 text-right">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                      disabled={items.length === 1}
                      aria-label="Remove row"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FormSection>

      <FormSection title="Remarks & Authorization">
        <FormGrid>
          <FormField size="md" label="Internal Remarks">
            <Textarea rows={2} value={form.internal_remarks} onChange={(e) => setForm({ ...form, internal_remarks: e.target.value })} />
          </FormField>
          <FormField size="md" label="Dispatch Remarks">
            <Textarea rows={2} value={form.dispatch_remarks} onChange={(e) => setForm({ ...form, dispatch_remarks: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Prepared By">
            <Input value={form.prepared_by} onChange={(e) => setForm({ ...form, prepared_by: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Checked By">
            <Input value={form.checked_by} onChange={(e) => setForm({ ...form, checked_by: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Approved By">
            <Input value={form.approved_by} onChange={(e) => setForm({ ...form, approved_by: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <StickyMobileActions>
        <Button type="button" variant="outline" size="sm" onClick={openReview} disabled={busy} className="flex-1 gap-1.5">
          <Eye className="h-4 w-4" /> Review
        </Button>
        <Button type="button" size="sm" onClick={submit} disabled={busy} className="flex-1 gap-1.5">
          <Save className="h-4 w-4" /> Save
        </Button>
      </StickyMobileActions>

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
              <h3 className="font-semibold mb-2 border-b pb-1">{partyLabel} Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                <ReviewField label={`${partyLabel} Name`} value={form.party_name} />
                <ReviewField label={`${partyLabel} Code`} value={form.party_code} />
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
                Total Qty: <span className="font-medium text-foreground">{totalQty}</span>
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
    </FormShell>
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
