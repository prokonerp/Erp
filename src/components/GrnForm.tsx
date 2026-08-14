import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Eye, Save, ArrowLeft, Lock } from "lucide-react";
import { toast } from "sonner";
import { emptyGrnItem, CATEGORY_LABEL, type GrnCategory, type GrnItem } from "@/lib/grn";
import { CustomerPicker } from "@/components/CustomerPicker";
import { VendorPicker, vendorShortCode } from "@/components/VendorPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import { GrnSerialInputs } from "@/components/GrnSerialInputs";
import { ContactPersonPicker } from "@/components/ContactPersonPicker";
import type { Customer } from "@/lib/crm";
import { FormShell, FormSection, FormGrid, FormField, StickyMobileActions } from "@/components/form-kit";
import { BranchPicker } from "@/components/BranchPicker";
import { listWarehouses, type WarehouseLite } from "@/lib/ims";
import { getCurrentUserName } from "@/lib/currentUser";

const custCode = (id: string) => `CUST-${id.slice(0, 6).toUpperCase()}`;

/** Condition drives inventory classification — only these values are accepted. */
const CONDITIONS = ["Good", "Defective", "Scrap"] as const;
/** Normalize legacy / free-text values; unknown values return "" so the user must re-pick. */
const normCondition = (v?: string | null) => {
  const m = CONDITIONS.find((c) => c.toLowerCase() === (v || "").trim().toLowerCase());
  return m || "";
};

type Props = { category?: GrnCategory; editId?: string };

export function GrnForm({ category: initialCategory = "customer", editId }: Props) {
  const navigate = useNavigate();
  const [category, setCategory] = useState<GrnCategory>(initialCategory);
  const isOem = category === "oem";
  const isCust = category === "customer";
  const [items, setItems] = useState<GrnItem[]>([emptyGrnItem()]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [form, setForm] = useState({
    status: "Draft",
    grn_date: new Date().toISOString().slice(0, 10),
    receipt_date: "",
    reference_no: "",
    source_doc_type:
      initialCategory === "customer" ? "Return Note" : initialCategory === "oem" ? "OEM Dispatch" : "Vendor DC",
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
    stock_category: "good",
    indent_id: "",
  });
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // When GRN is auto-populated from a source document (Indent Section C/D),
  // material identification fields become read-only to preserve traceability.
  const [sourceLocked, setSourceLocked] = useState(false);
  const [sourceKind, setSourceKind] = useState<"oem-section-c" | "customer-section-d" | "customer-gdc" | null>(null);

  // Auto-populate Received By with the current logged-in user's name (new records only).
  useEffect(() => {
    if (editId) return;
    (async () => {
      const name = await getCurrentUserName();
      if (!name) return;
      setForm((f) => (f.received_by ? f : { ...f, received_by: name }));
    })();
  }, [editId]);

  // Load active warehouses for the dropdown.
  useEffect(() => {
    (async () => {
      try {
        const rows = await listWarehouses();
        const active = (rows as unknown as Array<WarehouseLite & { status?: string | null }>)
          .filter((w) => !w.status || String(w.status).toLowerCase() === "active");
        setWarehouses(active);
      } catch { /* noop */ }
    })();
  }, []);

  const sourceLabel = isCust ? "Customer" : isOem ? "OEM" : "Vendor / Source";

  const handleCategoryChange = (next: GrnCategory) => {
    if (next === category) return;
    setCategory(next);
    setSourceId(null);
    setForm((f) => ({
      ...f,
      source_doc_type:
        next === "customer" ? "Return Note" : next === "oem" ? "OEM Dispatch" : "Vendor DC",
      source_name: "",
      source_code: "",
      source_gstin: "",
      source_contact_person: "",
      source_contact_number: "",
      source_email: "",
      source_address: "",
      oem_plant: "",
      po_no: next === "customer" ? "" : f.po_no,
      invoice_no: next === "customer" ? "" : f.invoice_no,
      invoice_date: next === "customer" ? "" : f.invoice_date,
      ticket_no: next === "customer" ? f.ticket_no : "",
    }));
  };

  // Prefill from a source document (e.g. Indent → Generate GRN).
  useEffect(() => {
    if (editId) return; // do not run session prefill in edit mode
    // Two prefill flavours:
    //  - "grn:prefill:new-oem"       → Section C (Material Received from OEM)
    //  - "grn:prefill:new-customer"  → Section D (Material Received from Customer)
    let raw: string | null = null;
    let kind: "oem" | "customer" | null = null;
    try {
      raw = sessionStorage.getItem("grn:prefill:new-oem");
      if (raw) kind = "oem";
    } catch { /* noop */ }
    if (!raw) {
      try {
        raw = sessionStorage.getItem("grn:prefill:new-customer");
        if (raw) kind = "customer";
      } catch { /* noop */ }
    }
    if (!raw || !kind) return;
    try {
      sessionStorage.removeItem(kind === "oem" ? "grn:prefill:new-oem" : "grn:prefill:new-customer");
    } catch { /* noop */ }
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw); } catch { return; }
    setCategory(kind === "oem" ? "oem" : "customer");
    const customerId = (payload.customer_id as string | undefined) || null;
    const oemName = (payload.oem_name as string | undefined) || "";
    const prefillItems = Array.isArray(payload.items) ? (payload.items as Array<Partial<GrnItem>>) : [];
    if (prefillItems.length > 0) {
      setItems(prefillItems.map((it) => ({ ...emptyGrnItem(), ...it })) as GrnItem[]);
      setSourceLocked(true);
      setSourceKind(
        kind === "oem"
          ? "oem-section-c"
          : payload.source === "general_dc"
            ? "customer-gdc"
            : "customer-section-d",
      );
    }
    setForm((f) => ({
      ...f,
      reference_no: (payload.reference_no as string) || f.reference_no,
      source_doc_type: (payload.source_doc_type as string) || f.source_doc_type,
      source_doc_no: (payload.source_doc_no as string) || f.source_doc_no,
      source_doc_date: (payload.source_doc_date as string) || f.source_doc_date,
      ticket_no: (payload.ticket_no as string) || f.ticket_no,
      internal_remarks: (payload.internal_remarks as string) || f.internal_remarks,
      storage_location: (payload.storage_location as string) || f.storage_location,
      source_name: kind === "oem" ? (oemName || f.source_name) : f.source_name,
      indent_id: (payload.indent_id as string) || f.indent_id,
    }));
    const preWh = (payload.warehouse_id as string | null | undefined) || null;
    if (preWh) setWarehouseId(preWh);
    if (kind === "customer" && customerId) {
      (async () => {
        const { data } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
        if (data) applyCustomer(customerId, data as unknown as Customer);
      })();
    } else if (kind === "oem" && oemName) {
      // Best-effort vendor auto-match by OEM name so the vendor picker binds.
      (async () => {
        const { data } = await supabase.from("vendors").select("*").ilike("name", oemName).limit(1).maybeSingle();
        if (data) applyVendor((data as { id: string }).id, data);
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load existing GRN for edit mode.
  useEffect(() => {
    if (!editId) return;
    (async () => {
      const { data, error } = await supabase
        .from("grns" as never)
        .select("*").eq("id", editId).maybeSingle();
      if (error || !data) {
        toast.error(error?.message || "GRN not found");
        return;
      }
      const r = data as Record<string, unknown>;
      setCategory((r.category as GrnCategory) || "customer");
      const arr = Array.isArray(r.items) ? (r.items as GrnItem[]) : [];
      setItems(arr.length > 0 ? arr.map((it) => ({ ...emptyGrnItem(), ...it })) : [emptyGrnItem()]);
      // Lock material identification when GRN is linked to an Indent.
      const linkedIndent = (r.indent_id as string | null | undefined) || null;
      if (linkedIndent) {
        setSourceLocked(true);
        const cat = (r.category as GrnCategory) || "customer";
        setSourceKind(cat === "oem" ? "oem-section-c" : "customer-section-d");
      }
      setForm((f) => {
        const next: typeof f = { ...f };
        for (const k of Object.keys(f) as (keyof typeof f)[]) {
          const v = r[k as string];
          if (v !== undefined && v !== null) (next as any)[k] = String(v);
        }
        return next;
      });
      setBranchId(((r as { branch_id?: string | null }).branch_id) ?? null);
      const wid = (r as { warehouse_id?: string | null }).warehouse_id ?? null;
      setWarehouseId(wid);
    })();
  }, [editId]);

  const updateItem = (i: number, patch: Partial<GrnItem>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const applyCustomer = (id: string | null, c: Customer | null) => {
    setSourceId(id);
    if (!c) {
      setForm((f) => ({ ...f, source_name: "", source_code: "", source_gstin: "", source_contact_person: "", source_contact_number: "", source_email: "", source_address: "" }));
      return;
    }
    setForm((f) => ({
      ...f,
      source_name: c.company || "",
      source_code: custCode(c.id),
      source_gstin: c.gst || "",
      source_contact_person: c.contact_name || "",
      source_contact_number: c.phone || "",
      source_email: c.email || "",
      source_address: c.shipping_address || c.billing_address || c.address || "",
    }));
  };

  const applyVendor = (id: string | null, v: any) => {
    setSourceId(id);
    if (!v) {
      setForm((f) => ({ ...f, source_name: "", source_code: "", source_gstin: "", source_contact_person: "", source_contact_number: "", source_email: "", source_address: "", oem_plant: "" }));
      return;
    }
    setForm((f) => ({
      ...f,
      source_name: v.name || "",
      source_code: vendorShortCode(v.id),
      source_gstin: v.gstin || "",
      source_contact_person: v.contact_name || "",
      source_contact_number: v.phone || "",
      source_email: v.email || "",
      source_address: v.address || "",
    }));
  };

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
    if (!editId && !branchId) { toast.error("Please select a Prokon Branch"); return false; }
    if (!warehouseId) { toast.error("Please select a Warehouse"); return false; }
    if (!form.source_name.trim()) { toast.error(`${sourceLabel} name is required`); return false; }
    const clean = items.filter((it) => it.part_name.trim() || it.part_no.trim());
    if (clean.length === 0) { toast.error("Add at least one material row"); return false; }
    for (let i = 0; i < clean.length; i++) {
      const it = clean[i];
      const qty = Math.max(1, Math.floor(parseFloat(it.qty_received) || 1));
      const list = (it.serials && it.serials.length
        ? it.serials
        : (it.serial_no || "").split(",")).map((s) => s.trim()).filter(Boolean);
      if (list.length === 0) continue; // non-serialized row
      if (list.length !== qty) {
        toast.error(`Row ${i + 1}: enter one serial number per unit (${qty} required)`);
        return false;
      }
      if (new Set(list.map((s) => s.toLowerCase())).size !== list.length) {
        toast.error(`Row ${i + 1}: duplicate serial numbers`);
        return false;
      }
    }
    for (let i = 0; i < clean.length; i++) {
      if (!normCondition(clean[i].condition)) {
        toast.error(`Row ${i + 1}: select a Condition (Good, Defective or Scrap)`);
        return false;
      }
    }
    return true;
  };

  const qcReady =
    (form.qc_status || "").toLowerCase() === "accepted" && !!form.checked_by.trim();

  const submit = async (opts?: { approve?: boolean }) => {
    const approve = !!opts?.approve;
    if (!validate()) return;
    if (approve && !qcReady) {
      toast.error("Complete QC (Status = Accepted, Checked By filled) before approving");
      return;
    }
    // Derive accepted/rejected qty from Condition so downstream views keep working.
    const clean = items
      .filter((it) => it.part_name.trim() || it.part_no.trim())
      .map((it) => {
        const qty = parseFloat(it.qty_received) || 0;
        return {
          ...it,
          condition: normCondition(it.condition),
          // Every received unit is posted to inventory; its Condition alone
          // decides whether it lands as good, defective or scrapped stock.
          qty_accepted: String(qty),
          qty_rejected: "0",
        };
      });
    const selectedWarehouse = warehouses.find((w) => w.id === warehouseId) || null;
    const warehouseName = selectedWarehouse?.name || form.warehouse_name || "";
    setBusy(true);
    const approverName = approve ? await getCurrentUserName() : "";
    if (editId) {
      const updatePayload = {
        ...form,
        warehouse_name: warehouseName,
        category,
        receipt_date: form.receipt_date || null,
        source_doc_date: form.source_doc_date || null,
        invoice_date: form.invoice_date || null,
        qc_date: form.qc_date || null,
        accepted_qty: clean.reduce((s, it) => s + (parseFloat(it.qty_accepted) || 0), 0),
        rejected_qty: clean.reduce((s, it) => s + (parseFloat(it.qty_rejected) || 0), 0),
        items: clean,
        branch_id: branchId,
        warehouse_id: warehouseId,
        indent_id: form.indent_id || null,
        stock_category: category === "general" ? (form.stock_category || "good") : null,
        ...(approve
          ? {
              status: "Submitted",
              approved_by: form.approved_by || approverName,
              submitted_at: new Date().toISOString(),
            }
          : {}),
      };
      const { error } = await supabase
        .from("grns" as never)
        .update(updatePayload as never)
        .eq("id", editId);
      setBusy(false);
      if (error) return toast.error(error.message);
      setReviewOpen(false);
      toast.success(approve ? "GRN Approved & Stock Updated Successfully" : "GRN updated");
      navigate({ to: "/grn/$id", params: { id: editId } });
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      ...form,
      warehouse_name: warehouseName,
      category,
      grn_no: "",
      receipt_date: form.receipt_date || null,
      source_doc_date: form.source_doc_date || null,
      invoice_date: form.invoice_date || null,
      qc_date: form.qc_date || null,
      accepted_qty: clean.reduce((s, it) => s + (parseFloat(it.qty_accepted) || 0), 0),
      rejected_qty: clean.reduce((s, it) => s + (parseFloat(it.qty_rejected) || 0), 0),
      items: clean,
      attachments: [],
      branch_id: branchId,
      warehouse_id: warehouseId,
      indent_id: form.indent_id || null,
      stock_category: category === "general" ? (form.stock_category || "good") : null,
      created_by: userData.user?.id ?? null,
      ...(approve
        ? {
            status: "Submitted",
            approved_by: form.approved_by || approverName,
            submitted_by: userData.user?.id ?? null,
            submitted_at: new Date().toISOString(),
          }
        : {}),
    };
    const { data, error } = await supabase
      .from("grns" as never)
      .insert(payload as never).select("id").single();
    if (error) { setBusy(false); return toast.error(error.message); }
    setBusy(false);
    setReviewOpen(false);
    toast.success(approve ? "GRN Approved & Stock Updated Successfully" : "GRN created");
    navigate({ to: "/grn/$id", params: { id: (data as { id: string }).id } });
  };

  const actions = (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => validate() && setReviewOpen(true)} disabled={busy} className="gap-1.5">
        <Eye className="h-4 w-4" />
        <span className="hidden sm:inline">Review</span>
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => navigate({ to: "/grn" })} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Back to All GRN</span>
        <span className="sm:hidden">Back</span>
      </Button>
    </>
  );

  return (
    <FormShell
      title={`${editId ? "Edit" : "New"} GRN — ${CATEGORY_LABEL[category]}`}
      description="Capture receipt details, source, transport, items, QC and storage."
      actions={actions}
    >
      <FormSection title="GRN Type" defaultOpen>
        {sourceLocked && (
          <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs flex items-start gap-2">
            <Lock className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
            <div className="space-y-0.5">
              <div className="font-medium text-foreground">
                Auto-populated from{" "}
                {sourceKind === "oem-section-c"
                  ? "Indent Section C — Material Received (from OEM)"
                  : sourceKind === "customer-gdc"
                    ? "General Delivery Challan — Return Receipt (from Customer)"
                    : "Indent Section D — Material Received (from Customer)"}
              </div>
              <div className="text-muted-foreground">
                Material identification fields are read-only to preserve source traceability.
                {form.indent_id ? <> Indent Ref: <span className="font-mono">{form.indent_id}</span></> : null}
                {" "}Edit at the source Indent if corrections are needed.
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {(["customer", "oem", "general"] as GrnCategory[]).map((c) => (
            <Button
              key={c}
              type="button"
              size="sm"
              variant={category === c ? "default" : "outline"}
              onClick={() => handleCategoryChange(c)}
              disabled={sourceLocked}
            >
              {CATEGORY_LABEL[c]}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Choose the GRN type — the form fields and item columns update automatically.
        </p>
        <div className="mt-3 max-w-md">
          <BranchPicker value={branchId} onChange={(id) => setBranchId(id)} required />
        </div>
      </FormSection>

      <FormSection title="GRN Information" defaultOpen>
        <FormGrid>
          <FormField size="sm" label="GRN Date" required>
            <Input type="date" value={form.grn_date} onChange={(e) => setForm({ ...form, grn_date: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Material Receipt Date">
            <Input type="date" value={form.receipt_date} onChange={(e) => setForm({ ...form, receipt_date: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Status">
            <Input value={form.status} readOnly className="bg-muted/40" />
            <p className="text-[10px] text-muted-foreground mt-1">
              GRNs are saved as Draft. Submit from the Review page to post stock to inventory.
            </p>
          </FormField>
          <FormField size="sm" label="Reference No.">
            <Input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} />
          </FormField>
          <FormField size="md" label="Source Document Type">
            <Input value={form.source_doc_type} onChange={(e) => setForm({ ...form, source_doc_type: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Source Document No.">
            <Input value={form.source_doc_no} onChange={(e) => setForm({ ...form, source_doc_no: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Source Document Date">
            <Input type="date" value={form.source_doc_date} onChange={(e) => setForm({ ...form, source_doc_date: e.target.value })} />
          </FormField>
          {!isCust && (
            <FormField size="sm" label="PO No.">
              <Input value={form.po_no} onChange={(e) => setForm({ ...form, po_no: e.target.value })} />
            </FormField>
          )}
          {!isCust && (
            <FormField size="sm" label="Invoice No.">
              <Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} />
            </FormField>
          )}
          {!isCust && (
            <FormField size="sm" label="Invoice Date">
              <Input type="date" value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} />
            </FormField>
          )}
          {isCust && (
            <FormField size="sm" label="Ticket / Complaint No.">
              <Input value={form.ticket_no} onChange={(e) => setForm({ ...form, ticket_no: e.target.value })} />
            </FormField>
          )}
          {category === "general" && (
            <FormField size="sm" label="Stock Category" required>
              <Select
                value={form.stock_category || "good"}
                onValueChange={(v) => setForm({ ...form, stock_category: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="defective">Defective</SelectItem>
                  <SelectItem value="quarantine">Quarantine</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          )}
          {category !== "general" && (
            <FormField size="md" label="Linked Indent (optional)">
              <Input
                placeholder="Paste Indent ID to link to an RMA workflow"
                value={form.indent_id}
                onChange={(e) => setForm({ ...form, indent_id: e.target.value })}
              />
            </FormField>
          )}
        </FormGrid>
      </FormSection>

      <FormSection title={`${sourceLabel} Information`} defaultOpen>
        <FormGrid>
          <FormField
            size="full"
            label={isCust ? "Customer (from Master)" : isOem ? "OEM (from Vendor Master)" : "Vendor (from Master)"}
            required
          >
            {isCust ? (
              <CustomerPicker value={sourceId} onChange={applyCustomer} required placeholder="Search customer…" />
            ) : (
              <VendorPicker value={sourceId} onChange={applyVendor} required label={isOem ? "OEM" : "Vendor"} placeholder={`Search ${isOem ? "OEM" : "vendor"}…`} />
            )}
          </FormField>
          <FormField size="md" label={`${sourceLabel} Name`} required>
            <Input value={form.source_name} readOnly className="bg-muted/40" />
          </FormField>
          <FormField size="md" label={`${sourceLabel} Code`}>
            <Input value={form.source_code} readOnly className="bg-muted/40" />
          </FormField>
          {isOem ? (
            <FormField size="md" label="OEM Plant / Location">
              <Input value={form.oem_plant} onChange={(e) => setForm({ ...form, oem_plant: e.target.value })} />
            </FormField>
          ) : (
            <FormField size="md" label="GSTIN">
              <Input value={form.source_gstin} readOnly className="bg-muted/40" />
            </FormField>
          )}
          <FormField size="md" label="Contact Person">
            {isCust && (
              <div className="mb-1.5">
                <ContactPersonPicker
                  customerId={sourceId}
                  onPick={(c) => setForm((f) => ({
                    ...f,
                    source_contact_person: c.name,
                    source_contact_number: c.phone || f.source_contact_number,
                    source_email: c.email || f.source_email,
                  }))}
                />
              </div>
            )}
            <Input value={form.source_contact_person} onChange={(e) => setForm({ ...form, source_contact_person: e.target.value })} />
          </FormField>
          <FormField size="md" label="Contact Number">
            <Input value={form.source_contact_number} onChange={(e) => setForm({ ...form, source_contact_number: e.target.value })} />
          </FormField>
          <FormField size="md" label="Email">
            <Input type="email" value={form.source_email} onChange={(e) => setForm({ ...form, source_email: e.target.value })} />
          </FormField>
          {isOem && (
            <FormField size="md" label="OEM Logo URL (optional)">
              <Input placeholder="https://..." value={form.oem_logo_url} onChange={(e) => setForm({ ...form, oem_logo_url: e.target.value })} />
            </FormField>
          )}
          <FormField size="full" label="Address">
            <Textarea rows={2} value={form.source_address} onChange={(e) => setForm({ ...form, source_address: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection title="Transport Details">
        <FormGrid>
          <FormField size="md" label="Transporter">
            <Input value={form.transporter_name} onChange={(e) => setForm({ ...form, transporter_name: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Vehicle Number">
            <Input value={form.vehicle_number} onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Mode">
            <Select value={form.mode_of_transport} onValueChange={(v) => setForm({ ...form, mode_of_transport: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Road","Rail","Air","Sea","Hand Delivery","Courier"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField size="md" label="Driver Name">
            <Input value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Driver Mobile">
            <Input value={form.driver_mobile} onChange={(e) => setForm({ ...form, driver_mobile: e.target.value })} />
          </FormField>
          <FormField size="sm" label="LR / Consignment No.">
            <Input value={form.lr_number} onChange={(e) => setForm({ ...form, lr_number: e.target.value })} />
          </FormField>
          <FormField size="sm" label="No. of Packages">
            <Input value={form.num_packages} onChange={(e) => setForm({ ...form, num_packages: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Total Weight">
            <Input value={form.total_weight} placeholder="e.g. 25 kg" onChange={(e) => setForm({ ...form, total_weight: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection
        title="Material Receipt Details"
        description={`Total Qty ${totals.received} • ${items.length} row(s)`}
        defaultOpen
        right={
          <Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, emptyGrnItem()])} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Row
          </Button>
        }
      >
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="w-full text-sm border-separate border-spacing-0 min-w-[900px]">
            {sourceLocked ? (
              <>
                <thead className="sticky top-0 z-10 bg-muted/60">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th rowSpan={2} className="px-2 py-1.5 w-10">#</th>
                    <th className="px-2 py-1.5 w-24">Oracle #</th>
                    <th className="px-2 py-1.5 min-w-[160px]">Warehouse</th>
                    <th className="px-2 py-1.5 min-w-[200px]">Model</th>
                    <th className="px-2 py-1.5 w-28">Serial</th>
                    <th rowSpan={2} className="px-2 py-1.5 w-10"></th>
                  </tr>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1.5 w-20">Qty</th>
                    <th className="px-2 py-1.5 w-32">Material Rec Date</th>
                    <th className="px-2 py-1.5 w-28">Condition</th>
                    <th className="px-2 py-1.5 min-w-[140px]">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <>
                      <tr key={`${i}-id`} className="align-top">
                        <td rowSpan={2} className="px-2 py-1.5 text-center text-xs text-muted-foreground border-t border-border/60">{i + 1}</td>
                        <td className="px-2 py-1.5 border-t border-border/60 text-xs font-mono">{it.oracle_no || "—"}</td>
                        <td className="px-2 py-1.5 border-t border-border/60 text-xs">{it.warehouse_name || "—"}</td>
                        <td className="px-2 py-1.5 border-t border-border/60"><Input value={it.model_no || ""} readOnly className="bg-muted/40" /></td>
                        <td className="px-2 py-1.5 border-t border-border/60">
                          <GrnSerialInputs
                            qty={parseFloat(it.qty_received) || 1}
                            serials={it.serials}
                            serialNo={it.serial_no}
                            readOnly={sourceKind !== "oem-section-c"}
                            onChange={(patch) => updateItem(i, patch)}
                          />
                        </td>
                        <td rowSpan={2} className="px-2 py-1.5 border-t border-border/60 text-right align-middle">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                            disabled={items.length === 1}
                            aria-label="Remove row"
                            title="Remove this row — remaining rows stay pending under the source Indent for a future GRN"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                      <tr key={`${i}-ops`} className="align-top">
                        <td className="px-2 py-1.5 border-t-0 border-border/60"><Input type="number" min="0" value={it.qty_received} readOnly className="bg-muted/40" onChange={(e) => updateItem(i, { qty_received: e.target.value })} /></td>
                        <td className="px-2 py-1.5 border-t-0 border-border/60"><Input type="date" value={it.received_date || ""} readOnly className="bg-muted/40" /></td>
                        <td className="px-2 py-1.5 border-t-0 border-border/60">
                          <Select value={normCondition(it.condition)} onValueChange={(v) => updateItem(i, { condition: v })} disabled={sourceKind === "customer-section-d"}>
                            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Good">Good</SelectItem>
                              <SelectItem value="Defective">Defective</SelectItem>
                              <SelectItem value="Scrap">Scrap</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5 border-t-0 border-border/60"><Input value={it.remarks || ""} onChange={(e) => updateItem(i, { remarks: e.target.value })} /></td>
                      </tr>
                    </>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead className="sticky top-0 z-10 bg-muted/60">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th rowSpan={2} className="px-2 py-1.5 w-10">#</th>
                    <th className="px-2 py-1.5 min-w-[200px]">Model</th>
                    <th className="px-2 py-1.5">Description</th>
                    <th className="px-2 py-1.5 w-20">UOM</th>
                    {!isCust && <th className="px-2 py-1.5 w-28">Serial</th>}
                    <th rowSpan={2} className="px-2 py-1.5 w-10"></th>
                  </tr>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1.5 w-20">Qty</th>
                    <th className="px-2 py-1.5 w-28">Condition</th>
                    {!isCust ? (
                      <th colSpan={2} className="px-2 py-1.5 min-w-[140px]">Remarks</th>
                    ) : (
                      <th className="px-2 py-1.5 min-w-[140px]">Remarks</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <>
                      <tr key={`${i}-id`} className="align-top">
                        <td rowSpan={2} className="px-2 py-1.5 text-center text-xs text-muted-foreground border-t border-border/60">{i + 1}</td>
                        <td className="px-2 py-1.5 border-t border-border/60">
                          <ProductMasterPicker excludeServices
                            value={it.product_id}
                            onPick={(p) => updateItem(i, {
                              product_id: p.id,
                              part_no: p.sku || p.model || "",
                              part_name: p.model || p.name,
                              description: p.description || "",
                              uom: p.unit || it.uom || "Nos",
                              model_no: p.model || "",
                            })}
                          />
                        </td>
                        <td className="px-2 py-1.5 border-t border-border/60"><Input value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} /></td>
                        <td className="px-2 py-1.5 border-t border-border/60"><Input value={it.uom} onChange={(e) => updateItem(i, { uom: e.target.value })} /></td>
                        {!isCust && (
                          <td className="px-2 py-1.5 border-t border-border/60">
                            <GrnSerialInputs
                              qty={parseFloat(it.qty_received) || 1}
                              serials={it.serials}
                              serialNo={it.serial_no}
                              onChange={(patch) => updateItem(i, patch)}
                            />
                          </td>
                        )}
                        <td rowSpan={2} className="px-2 py-1.5 border-t border-border/60 text-right align-middle">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                            disabled={items.length === 1}
                            aria-label="Remove row"
                            title="Remove row"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                      <tr key={`${i}-ops`} className="align-top">
                        <td className="px-2 py-1.5 border-t-0 border-border/60"><Input type="number" min="0" value={it.qty_received} onChange={(e) => updateItem(i, { qty_received: e.target.value })} /></td>
                        <td className="px-2 py-1.5 border-t-0 border-border/60">
                          <Select value={normCondition(it.condition)} onValueChange={(v) => updateItem(i, { condition: v })}>
                            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Good">Good</SelectItem>
                              <SelectItem value="Defective">Defective</SelectItem>
                              <SelectItem value="Scrap">Scrap</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        {!isCust ? (
                          <td colSpan={2} className="px-2 py-1.5 border-t-0 border-border/60"><Input value={it.remarks || ""} onChange={(e) => updateItem(i, { remarks: e.target.value })} /></td>
                        ) : (
                          <td className="px-2 py-1.5 border-t-0 border-border/60"><Input value={it.remarks || ""} onChange={(e) => updateItem(i, { remarks: e.target.value })} /></td>
                        )}
                      </tr>
                    </>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      </FormSection>

      <FormSection title="Quality Inspection">
        <FormGrid>
          <FormField size="sm" label="QC Status">
            <Select value={form.qc_status} onValueChange={(v) => setForm({ ...form, qc_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Pending","Accepted","Partially Accepted","Rejected","Waived"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField size="md" label="QC Inspector">
            <Input value={form.qc_inspector} onChange={(e) => setForm({ ...form, qc_inspector: e.target.value })} />
          </FormField>
          <FormField size="sm" label="QC Date">
            <Input type="date" value={form.qc_date} onChange={(e) => setForm({ ...form, qc_date: e.target.value })} />
          </FormField>
          <FormField size="full" label="QC Remarks">
            <Textarea rows={2} value={form.qc_remarks} onChange={(e) => setForm({ ...form, qc_remarks: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection title="Storage & Remarks">
        <FormGrid>
          <FormField size="md" label="Warehouse" required>
            <Select value={warehouseId ?? ""} onValueChange={(v) => {
              setWarehouseId(v);
              const wh = warehouses.find((w) => w.id === v);
              setForm((f) => ({ ...f, warehouse_name: wh?.name || "" }));
            }}>
              <SelectTrigger><SelectValue placeholder={warehouses.length ? "Select warehouse…" : "No active warehouses"} /></SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}{w.type ? ` (${w.type})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField size="sm" label="Storage Location">
            <Input value={form.storage_location} onChange={(e) => setForm({ ...form, storage_location: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Bin / Rack No.">
            <Input value={form.bin_no} onChange={(e) => setForm({ ...form, bin_no: e.target.value })} />
          </FormField>
          <FormField size="md" label="Receipt Remarks">
            <Textarea rows={2} value={form.receipt_remarks} onChange={(e) => setForm({ ...form, receipt_remarks: e.target.value })} />
          </FormField>
          <FormField size="md" label="Internal Remarks">
            <Textarea rows={2} value={form.internal_remarks} onChange={(e) => setForm({ ...form, internal_remarks: e.target.value })} />
          </FormField>
          <FormField size="sm" label="Received By">
            <Input value={form.received_by} onChange={(e) => setForm({ ...form, received_by: e.target.value })} />
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
        <Button type="button" variant="outline" size="sm" onClick={() => validate() && setReviewOpen(true)} disabled={busy} className="flex-1 gap-1.5">
          <Eye className="h-4 w-4" /> Review
        </Button>
        <Button type="button" size="sm" onClick={() => submit()} disabled={busy} className="flex-1 gap-1.5">
          <Save className="h-4 w-4" /> Save
        </Button>
      </StickyMobileActions>

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
                    <th className="border p-1">Model</th>
                    <th className="border p-1">UOM</th>
                    <th className="border p-1">Qty</th>
                    <th className="border p-1">Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {items.filter((it) => it.part_name.trim() || it.part_no.trim()).map((it, i) => (
                    <tr key={i}>
                      <td className="border p-1 text-center">{i + 1}</td>
                      <td className="border p-1">{it.model_no || it.part_name}</td>
                      <td className="border p-1">{it.uom}</td>
                      <td className="border p-1 text-right">{it.qty_received}</td>
                      <td className="border p-1">{normCondition(it.condition) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-xs text-muted-foreground mt-1">Total Qty {totals.received}</div>
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
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={() => setReviewOpen(false)} disabled={busy}>Back to Edit</Button>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button
                onClick={() => submit({ approve: true })}
                disabled={busy || !qcReady}
                title={qcReady ? "Approve and post stock to inventory" : "Set QC Status = Accepted and fill Checked By to enable"}
              >
                {busy ? "Posting..." : "Approve & Post GRN"}
              </Button>
            </div>
          </DialogFooter>
          {!qcReady && (
            <p className="text-xs text-muted-foreground -mt-2 sm:text-right">
              Complete QC (Status = Accepted, Checked By filled) to enable Approve & Post.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </FormShell>
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
