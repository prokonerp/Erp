import { Fragment, useEffect, useRef, useState } from "react";
import { BranchPicker } from "@/components/BranchPicker";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Eye, CheckCircle2, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import type { ChallanItem, DocType } from "@/lib/challan";
import { emptyItem } from "@/lib/challan";
import { CustomerPicker } from "@/components/CustomerPicker";
import { VendorPicker, vendorShortCode } from "@/components/VendorPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import { ContactPersonPicker } from "@/components/ContactPersonPicker";
import type { Customer } from "@/lib/crm";
import { FormShell, FormSection, FormGrid, FormField, StickyMobileActions } from "@/components/form-kit";
import { getCurrentUserName } from "@/lib/currentUser";
import { productDisplayName } from "@/lib/productNames";
import { useIsAdmin } from "@/lib/useRole";
import { findShortfalls, logNegativeOverrides, blockMessage, type Shortfall } from "@/lib/negativeStock";
import { NegativeStockDialog } from "@/components/NegativeStockDialog";

const custCode = (id: string) => `CUST-${id.slice(0, 6).toUpperCase()}`;

type Props = { docType?: DocType; editId?: string };

export function ChallanForm({ docType: initialDocType, editId }: Props) {
  const navigate = useNavigate();
  const [dcType, setDcType] = useState<DocType>(initialDocType ?? "customer");
  const isOem = dcType === "oem";
  const [items, setItems] = useState<ChallanItem[]>([emptyItem()]);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  // Persistent id for auto-save. Starts from editId; upgraded after first insert.
  const [recordId, setRecordId] = useState<string | null>(editId ?? null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const savingRef = useRef(false);
  const lastPayloadRef = useRef<string>("");
  const [form, setForm] = useState({
    status: "Challan Generated",
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
    indent_id: "",
  });
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { isAdmin } = useIsAdmin();
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);
  const [negOpen, setNegOpen] = useState(false);
  // Set to true only after an admin explicitly approves an oversell.
  const allowNegativeRef = useRef(false);
  const overrideReasonRef = useRef<string | null>(null);
  const negBlockedRef = useRef(false);
  const itemsSectionRef = useRef<HTMLDivElement | null>(null);

  // Auto-populate Prepared By with the current logged-in user's name (new records only).
  useEffect(() => {
    if (editId) return;
    (async () => {
      const name = await getCurrentUserName();
      if (!name) return;
      setForm((f) => (f.prepared_by ? f : { ...f, prepared_by: name }));
    })();
  }, [editId]);

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

  // Prefill for DC to OEM (e.g. Defective Tags → Generate DC to OEM).
  useEffect(() => {
    if (editId) return;
    if (!isOem) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("challan:prefill:new-oem"); } catch { /* noop */ }
    if (!raw) return;
    try { sessionStorage.removeItem("challan:prefill:new-oem"); } catch { /* noop */ }
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw); } catch { return; }
    const prefillItems = Array.isArray(payload.items) ? (payload.items as Array<Partial<ChallanItem>>) : [];
    if (prefillItems.length > 0) {
      const mapped = prefillItems.map((it) => ({ ...emptyItem(), ...it })) as ChallanItem[];
      setItems(mapped);
      void hydrateItemsFromModels(mapped).then((hydrated) => setItems(hydrated));
    }
    setForm((f) => ({
      ...f,
      reference_no: (payload.reference_no as string) || f.reference_no,
      internal_remarks: (payload.internal_remarks as string) || f.internal_remarks,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load existing record for edit mode.
  useEffect(() => {
    if (!editId) return;
    setRecordId(editId);
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
        indent_id: (r.indent_id as string) || "",
      }));
      setBranchId(((r as { branch_id?: string | null }).branch_id) ?? null);
    })();
  }, [editId]);

  // ---------------------- Auto-save engine ----------------------
  // Debounced writer: creates on first meaningful save, updates thereafter.
  const canAutosave = () => {
    if (!branchId) return false;
    if (!form.party_name.trim()) return false;
    const cleanItems = items.filter((it) => it.part_name.trim() || it.part_no.trim());
    if (cleanItems.length === 0) return false;
    return true;
  };

  const buildPayload = () => {
    const cleanItems = items.filter((it) => it.part_name.trim() || it.part_no.trim());
    return {
      ...form,
      doc_type: dcType,
      dispatch_date: form.dispatch_date || null,
      items: cleanItems,
      branch_id: branchId,
      indent_id: form.indent_id || null,
      allow_negative_stock: dcType === "customer" ? allowNegativeRef.current : false,
    };
  };

  /**
   * Pre-flight availability check for non-serialized products on a
   * DC to Customer. Returns true when it is safe to post.
   * Hard blocks regular staff; admins get a warn-and-confirm dialog.
   */
  const preflightStock = async (): Promise<boolean> => {
    if (dcType !== "customer") return true;
    if (allowNegativeRef.current) return true;
    const lines = items
      .filter((it) => !(it.serial_no || "").trim() && (it.model_no || it.part_no || "").trim())
      .map((it) => ({
        model: (it.model_no || it.part_no || "").trim(),
        label: it.part_name || it.model_no || it.part_no,
        warehouseId: null,
        warehouseName: null,
        qty: parseFloat(it.qty) || 0,
      }));
    let short: Shortfall[] = [];
    try { short = await findShortfalls(lines); } catch { return true; }
    if (short.length === 0) { setShortfalls([]); return true; }
    if (!isAdmin) {
      negBlockedRef.current = true;
      toast.error(blockMessage(short[0]));
      return false;
    }
    setShortfalls(short);
    setNegOpen(true);
    return false;
  };

  const persist = async () => {
    if (!canAutosave() || savingRef.current) return;
    // Only the first write posts inventory — gate that write on availability.
    if (!recordId && !(await preflightStock())) return;
    const payload = buildPayload();
    const signature = JSON.stringify({ ...payload, recordId });
    if (signature === lastPayloadRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      if (recordId) {
        const { error } = await supabase
          .from("delivery_challans" as never)
          .update(payload as never)
          .eq("id", recordId);
        if (error) throw error;
      } else {
        const { data: userData } = await supabase.auth.getUser();
        const insertPayload = { ...payload, challan_no: "", created_by: userData.user?.id ?? null };
        const { data, error } = await supabase
          .from("delivery_challans" as never)
          .insert(insertPayload as never)
          .select("id")
          .single();
        if (error) throw error;
        const newId = (data as { id: string }).id;
        setRecordId(newId);
        if (allowNegativeRef.current && shortfalls.length > 0) {
          await logNegativeOverrides({
            documentType: "dc",
            documentId: newId,
            documentNo: null,
            shortfalls,
            reason: overrideReasonRef.current,
          });
        }
        // Swap URL so refresh/back keeps the same record — no new insert on next save.
        navigate({ to: "/challan/$id/edit", params: { id: newId }, replace: true });
      }
      lastPayloadRef.current = signature;
      setLastSavedAt(new Date());
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      const msg = e instanceof Error ? e.message : "Auto-save failed";
      toast.error(msg);
    } finally {
      savingRef.current = false;
    }
  };

  // Debounced trigger — waits 2.5s of inactivity before flushing.
  // NEVER performs the first save: the initial INSERT (and its stock
  // pre-flight) must come from an explicit "Save & Continue".
  useEffect(() => {
    if (!recordId) return;
    if (!canAutosave()) return;
    if (negOpen) return; // an override decision is pending
    const t = setTimeout(() => { void persist(); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, items, dcType, branchId, negOpen, recordId]);

  // Flush on tab close if there are pending changes.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (!recordId) return; // never create the record implicitly
      if (saveState === "saving" || (canAutosave() && lastPayloadRef.current !== JSON.stringify({ ...buildPayload(), recordId }))) {
        void persist();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, items, dcType, branchId, recordId, saveState]);

  const updateItem = (i: number, patch: Partial<ChallanItem>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  // Look up a Product Master row by model (case-insensitive), falling back to sku.
  const lookupProductByModel = async (model: string) => {
    const m = (model || "").trim();
    if (!m) return null;
    const { data } = await supabase
      .from("products")
      .select("id,model,sku,default_price,hsn,weight_kg")
      .or(`model.ilike.${m},sku.ilike.${m}`)
      .limit(1)
      .maybeSingle();
    return (data as { default_price?: number | null; hsn?: string | null; weight_kg?: number | null } | null) || null;
  };

  // Fetch Unit Price from Goods Master based on the entered Good Model.
  const applyPriceFromModel = async (i: number, model: string) => {
    const m = (model || "").trim();
    if (!m) return;
    const row = await lookupProductByModel(m);
    if (row && row.default_price != null) {
      updateItem(i, { unit_price: String(row.default_price) });
    } else {
      updateItem(i, { unit_price: "" });
      toast.message(`No Unit Price set in Goods Master for model "${m}"`);
    }
  };

  // OEM branch: entering a Model directly fills Unit Price and also back-fills
  // HSN / Weight from Product Master when those cells are still blank.
  const applyModelDetails = async (i: number, model: string) => {
    const m = (model || "").trim();
    if (!m) return;
    const row = await lookupProductByModel(m);
    if (row && row.default_price != null) {
      updateItem(i, { unit_price: String(row.default_price) });
    } else {
      updateItem(i, { unit_price: "" });
      toast.message(`No Unit Price set in Goods Master for model "${m}"`);
    }
    if (!row) return;
    setItems((arr) =>
      arr.map((it, idx) =>
        idx !== i
          ? it
          : {
              ...it,
              hsn: it.hsn || row.hsn || "",
              weight_kg: it.weight_kg || (row.weight_kg != null ? String(row.weight_kg) : ""),
            },
      ),
    );
  };

  // Prefilled rows (Defective Tags → DC to OEM, Stock Ledger → Return to OEM)
  // arrive with only a Model; hydrate HSN / Weight / Unit Price from masters.
  const hydrateItemsFromModels = async (rows: ChallanItem[]) =>
    Promise.all(
      rows.map(async (it) => {
        const m = (it.model_no || "").trim();
        if (!m) return it;
        const row = await lookupProductByModel(m);
        if (!row) return it;
        return {
          ...it,
          unit_price: it.unit_price || (row.default_price != null ? String(row.default_price) : ""),
          hsn: it.hsn || row.hsn || "",
          weight_kg: it.weight_kg || (row.weight_kg != null ? String(row.weight_kg) : ""),
        };
      }),
    );

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
    if (!editId && !branchId) {
      toast.error("Please select a Prokon Branch");
      return false;
    }
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
    if (!validate()) return;
    setReviewOpen(true);
    void checkWarehouseMatch();
  };

  // "Done" button: flush any pending auto-save, then jump to the view page.
  const submit = async () => {
    if (!validate()) return;
    if (!recordId && !(await preflightStock())) return;
    setBusy(true);
    await persist();
    setBusy(false);
    setReviewOpen(false);
    const idToOpen = recordId;
    if (idToOpen) {
      toast.success("Delivery Challan saved");
      navigate({ to: "/challan/$id", params: { id: idToOpen } });
    }
  };

  const totalQty = items.reduce((s, it) => s + (parseFloat(it.qty) || 0), 0);
  const totalValue = items.reduce(
    (s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price || "") || 0),
    0,
  );
  const totalWeight = items.reduce((s, it) => s + (parseFloat(it.weight_kg || "") || 0), 0);
  const partyLabel = isOem ? "OEM" : "Customer";

  // Rows that caused the last shortfall — highlighted so the user knows what to fix.
  const shortModelKeys = new Set(
    shortfalls.map((s) => (s.model || "").trim().toLowerCase()).filter(Boolean),
  );
  const isShortRow = (it: ChallanItem) =>
    shortModelKeys.size > 0 &&
    shortModelKeys.has((it.model_no || it.part_no || "").trim().toLowerCase());

  const actions = (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openReview} disabled={busy} className="gap-1.5">
        <Eye className="h-4 w-4" />
        <span className="hidden sm:inline">Review</span>
      </Button>
      <SaveIndicator state={saveState} at={lastSavedAt} />
      <Button type="button" variant="ghost" size="sm" onClick={() => navigate({ to: "/challan" })} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">Back to All Delivery Challan</span>
        <span className="sm:hidden">Back</span>
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
        <div className="mt-3 max-w-md">
          <BranchPicker
            value={branchId}
            onChange={(id) => setBranchId(id)}
            required
            label="Supply From Warehouse (internal — not printed)"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Company (Auto from Letterhead) is used as the document header. Warehouse is stored for
            stock movement and shown only if "Show Supply From" is enabled in Sales Settings.
          </p>
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
            <Input value={form.status} readOnly className="bg-muted/40" />
            <p className="text-[10px] text-muted-foreground mt-1">
              Auto-saved as {form.status}. Every change is persisted to the same record — no duplicates.
            </p>
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
          <FormField size="md" label="Linked Indent (optional)">
            <Input
              placeholder="Paste Indent ID to link to an RMA workflow"
              value={form.indent_id}
              onChange={(e) => setForm({ ...form, indent_id: e.target.value })}
            />
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

      <div ref={itemsSectionRef} />
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
        {isOem && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Quick add from Product Master</span>
            <div className="w-[320px]">
              <ProductMasterPicker
                excludeServices
                placeholder="Pick product to add a row…"
                onPick={(p) =>
                  setItems((arr) => {
                    const row: ChallanItem = {
                      ...emptyItem(),
                      product_id: p.id,
                      part_no: p.sku || p.model || "",
                      part_name: productDisplayName(p as any),
                      description: p.description || "",
                      uom: p.unit || "Nos",
                      model_no: p.model || "",
                      hsn: (p as any).hsn || "",
                      unit_price: p.default_price != null ? String(p.default_price) : "",
                      weight_kg: p.weight_kg != null ? String(p.weight_kg) : "",
                    };
                    const last = arr[arr.length - 1];
                    const lastEmpty = last && !last.part_no && !last.part_name && !last.model_no;
                    return lastEmpty ? [...arr.slice(0, -1), row] : [...arr, row];
                  })
                }
              />
            </div>
          </div>
        )}
        {isOem ? (
          <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
            <table className="w-full text-sm border-separate border-spacing-0 min-w-[1500px]">
              <thead className="bg-muted/70">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                  <th className="px-3 py-2 w-10 text-center">S.No</th>
                  <th className="px-3 py-2 min-w-[140px]">OEM Ref ID</th>
                  <th className="px-3 py-2 min-w-[170px]">Model</th>
                  <th className="px-3 py-2 min-w-[170px]">Serial No</th>
                  <th className="px-3 py-2 min-w-[140px]">Oracle</th>
                  <th className="px-3 py-2 w-32">Stock Type</th>
                  <th className="px-3 py-2 w-24">Qty</th>
                  <th className="px-3 py-2 w-28">HSN</th>
                  <th className="px-3 py-2 w-32">Unit Price</th>
                  <th className="px-3 py-2 w-28">Weight</th>
                  <th className="px-3 py-2 min-w-[180px]">Good Return Reason</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr
                    key={i}
                    data-short={isShortRow(it) ? "1" : undefined}
                    className={`border-t border-border/60 transition-colors hover:bg-muted/25 ${isShortRow(it) ? "bg-destructive/10 ring-1 ring-destructive/40" : ""}`}
                  >
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground border-t border-border/60 align-middle">{i + 1}</td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Input value={it.oem_ref_id || ""} onChange={(e) => updateItem(i, { oem_ref_id: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Input
                        value={it.model_no || ""}
                        onChange={(e) => updateItem(i, { model_no: e.target.value })}
                        onBlur={(e) => applyModelDetails(i, e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Input value={it.good_defective_serial || ""} onChange={(e) => updateItem(i, { good_defective_serial: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Input value={it.oracle_no || ""} onChange={(e) => updateItem(i, { oracle_no: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Select value={it.stock_type || ""} onValueChange={(v) => updateItem(i, { stock_type: v })}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Good">Good</SelectItem>
                          <SelectItem value="Defective">Defective</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Input type="number" min="0" value={it.qty} onChange={(e) => updateItem(i, { qty: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Input value={it.hsn || ""} onChange={(e) => updateItem(i, { hsn: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Input
                        type="number"
                        min="0"
                        value={it.unit_price || ""}
                        placeholder={(it.model_no || "").trim() ? "No price in Master" : "Enter Model first"}
                        onChange={(e) => updateItem(i, { unit_price: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Input type="number" min="0" value={it.weight_kg || ""} onChange={(e) => updateItem(i, { weight_kg: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top">
                      <Input value={it.good_return_reason || ""} onChange={(e) => updateItem(i, { good_return_reason: e.target.value })} />
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-middle text-right">
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
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/50 text-xs font-semibold">
                  <td colSpan={6} className="px-3 py-2 text-right">Totals</td>
                  <td className="px-3 py-2">{totalQty}</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2" title="Total Value = Σ (Qty × Unit Price)">
                    <span className="block text-[10px] font-normal text-muted-foreground">Total Value</span>
                    {totalValue.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">{totalWeight.toFixed(2)}</td>
                  <td colSpan={2} className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
        <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
          <table className="w-full text-sm border-separate border-spacing-0 min-w-[1400px]">
            <thead className="bg-muted/70">
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                <th rowSpan={2} className="px-3 py-2 w-10 text-center align-middle">#</th>
                <th rowSpan={2} className="px-3 py-2 min-w-[260px] align-middle">Product</th>
                <th rowSpan={2} className="px-3 py-2 min-w-[140px] align-middle">OEM Ref ID</th>
                {isOem ? (
                  <>
                    <th className="px-3 py-2 min-w-[160px]">Model</th>
                    <th className="px-3 py-2 min-w-[180px]">Good/Defective Sr No</th>
                    <th className="px-3 py-2 min-w-[140px]">Oracle #</th>
                    <th className="px-3 py-2 w-28">Stock Type</th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-2 min-w-[160px]">Defective Model</th>
                    <th className="px-3 py-2 min-w-[160px]">Defective Sr No</th>
                    <th className="px-3 py-2 min-w-[140px]">Oracle #</th>
                    <th className="px-3 py-2 min-w-[160px]">Good Model</th>
                    <th className="px-3 py-2 min-w-[160px]">Good Sr No</th>
                  </>
                )}
                <th rowSpan={2} className="px-3 py-2 w-10 align-middle"></th>
              </tr>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th colSpan={isOem ? 4 : 5} className="px-3 py-1.5 bg-muted/50 text-center text-[10px] text-muted-foreground/70">
                  Line details
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <Fragment key={i}>
                  <tr key={`${i}-top`} data-short={isShortRow(it) ? "1" : undefined} className={`border-t border-border/60 transition-colors hover:bg-muted/25 ${isShortRow(it) ? "bg-destructive/10 ring-1 ring-destructive/40" : ""}`}>
                    <td rowSpan={2} className="px-3 py-2 text-center text-xs text-muted-foreground border-t border-border/60 align-middle w-10">{i + 1}</td>
                    <td className="px-3 py-2 align-top border-t border-border/60 min-w-[260px]">
                      <ProductMasterPicker excludeServices
                        value={it.product_id}
                        onPick={(p) => updateItem(i, {
                          product_id: p.id,
                          part_no: p.sku || p.model || "",
                          part_name: productDisplayName(p as any),
                          description: p.description || "",
                          uom: p.unit || it.uom || "Nos",
                          model_no: p.model || "",
                          hsn: (p as any).hsn || it.hsn || "",
                          // Note: Unit Price is derived from the "Good Model" field below,
                          // not from the Product picker.
                          weight_kg: it.weight_kg || (p.weight_kg != null ? String(p.weight_kg) : ""),
                        })}
                      />
                      {!it.product_id && (it.part_no || it.part_name) && (
                        <div className="mt-1 text-[11px] text-muted-foreground truncate">
                          {[it.part_no, it.part_name].filter(Boolean).join(" — ")}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 border-t border-border/60 align-top min-w-[140px]">
                      <Input value={it.oem_ref_id || ""} onChange={(e) => updateItem(i, { oem_ref_id: e.target.value })} />
                    </td>
                    {isOem ? (
                      <>
                        <td className="px-3 py-2 border-t border-border/60 align-top min-w-[160px]">
                          <Input
                            value={it.model_no || ""}
                            onChange={(e) => updateItem(i, { model_no: e.target.value })}
                            onBlur={(e) => applyPriceFromModel(i, e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 border-t border-border/60 align-top min-w-[180px]">
                          <Input value={it.good_defective_serial || ""} onChange={(e) => updateItem(i, { good_defective_serial: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 border-t border-border/60 align-top min-w-[140px]">
                          <Input value={it.oracle_no || ""} onChange={(e) => updateItem(i, { oracle_no: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 border-t border-border/60 align-top w-28">
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
                        <td className="px-3 py-2 border-t border-border/60 align-top min-w-[160px]">
                          <Input value={it.defective_model || ""} onChange={(e) => updateItem(i, { defective_model: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 border-t border-border/60 align-top min-w-[160px]">
                          <Input value={it.defective_serial || ""} onChange={(e) => updateItem(i, { defective_serial: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 border-t border-border/60 align-top min-w-[140px]">
                          <Input value={it.oracle_no || ""} onChange={(e) => updateItem(i, { oracle_no: e.target.value })} />
                        </td>
                        <td className="px-3 py-2 border-t border-border/60 align-top min-w-[160px]">
                          <Input
                            value={it.good_model || ""}
                            onChange={(e) => updateItem(i, { good_model: e.target.value })}
                            onBlur={(e) => applyPriceFromModel(i, e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 border-t border-border/60 align-top min-w-[160px]">
                          <Input value={it.good_serial || ""} onChange={(e) => updateItem(i, { good_serial: e.target.value })} />
                        </td>
                      </>
                    )}
                    <td rowSpan={2} className="px-3 py-2 border-t border-border/60 align-middle text-right w-10">
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
                  <tr key={`${i}-bottom`} className={`transition-colors hover:bg-muted/25 ${isShortRow(it) ? "bg-destructive/10" : ""}`}>
                    {isOem ? (
                      <td colSpan={4} className="px-3 py-2 border-t border-dashed border-border/40 align-top bg-muted/15">
                        <div className="grid grid-cols-6 gap-3">
                          <div className="min-w-[120px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">UOM</label>
                            <Input value={it.uom} onChange={(e) => updateItem(i, { uom: e.target.value })} />
                          </div>
                          <div className="min-w-[120px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Qty</label>
                            <Input type="number" min="0" value={it.qty} onChange={(e) => updateItem(i, { qty: e.target.value })} />
                          </div>
                          <div className="min-w-[140px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">HSN</label>
                            <Input value={it.hsn || ""} onChange={(e) => updateItem(i, { hsn: e.target.value })} />
                          </div>
                          <div className="min-w-[160px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Unit Price</label>
                            <Input
                              type="number"
                              min="0"
                              value={it.unit_price || ""}
                              placeholder={(it.model_no || "").trim() ? "No price set in Goods Master" : "Enter Model No first"}
                              onChange={(e) => updateItem(i, { unit_price: e.target.value })}
                            />
                          </div>
                          <div className="min-w-[120px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Weight (KG)</label>
                            <Input type="number" min="0" value={it.weight_kg || ""} onChange={(e) => updateItem(i, { weight_kg: e.target.value })} />
                          </div>
                          <div className="min-w-[180px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Good Return Reason</label>
                            <Input value={it.good_return_reason || ""} onChange={(e) => updateItem(i, { good_return_reason: e.target.value })} />
                          </div>
                        </div>
                      </td>
                    ) : (
                      <td colSpan={5} className="px-3 py-2 border-t border-dashed border-border/40 align-top bg-muted/15">
                        <div className="grid grid-cols-5 gap-3">
                          <div className="min-w-[120px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">UOM</label>
                            <Input value={it.uom} onChange={(e) => updateItem(i, { uom: e.target.value })} />
                          </div>
                          <div className="min-w-[120px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Qty</label>
                            <Input type="number" min="0" value={it.qty} onChange={(e) => updateItem(i, { qty: e.target.value })} />
                          </div>
                          <div className="min-w-[140px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">HSN</label>
                            <Input value={it.hsn || ""} onChange={(e) => updateItem(i, { hsn: e.target.value })} />
                          </div>
                          <div className="min-w-[160px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Unit Price</label>
                            <Input
                              type="number"
                              min="0"
                              value={it.unit_price || ""}
                              placeholder={(it.good_model || "").trim() ? "No price set in Goods Master" : "Enter Good Model first"}
                              onChange={(e) => updateItem(i, { unit_price: e.target.value })}
                            />
                          </div>
                          <div className="min-w-[120px]">
                            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Weight (KG)</label>
                            <Input type="number" min="0" value={it.weight_kg || ""} onChange={(e) => updateItem(i, { weight_kg: e.target.value })} />
                          </div>
                        </div>
                      </td>
                    )}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}
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
        <div className="flex-1 flex justify-end">
          <SaveIndicator state={saveState} at={lastSavedAt} />
        </div>
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
              {busy ? "Saving..." : "Save & Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NegativeStockDialog
        open={negOpen}
        onOpenChange={(o) => {
          setNegOpen(o);
          if (!o) {
            // Cancelled — drop the user straight back onto the editable rows.
            setReviewOpen(false);
            setBusy(false);
            setTimeout(() => {
              itemsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
          }
        }}
        shortfalls={shortfalls}
        onProceed={async (reason) => {
          allowNegativeRef.current = true;
          overrideReasonRef.current = reason || null;
          setNegOpen(false);
          await persist();
          setReviewOpen(false);
        }}
      />
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

function SaveIndicator({ state, at }: { state: "idle" | "saving" | "saved" | "error"; at: Date | null }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Saved{at ? ` · ${at.toLocaleTimeString()}` : ""}
      </span>
    );
  }
  if (state === "error") {
    return <span className="text-xs text-destructive">Auto-save failed — retrying on next change.</span>;
  }
  return <span className="text-xs text-muted-foreground">Auto-save enabled</span>;
}
