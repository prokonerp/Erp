import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Trash2, Eye, Save } from "lucide-react";
import { toast } from "sonner";
import { emptyGrnItem, CATEGORY_LABEL, type GrnCategory, type GrnItem } from "@/lib/grn";
import { CustomerPicker } from "@/components/CustomerPicker";
import { VendorPicker, vendorShortCode } from "@/components/VendorPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import type { Customer } from "@/lib/crm";
import { FormShell, FormSection, FormGrid, FormField, StickyMobileActions } from "@/components/form-kit";

const custCode = (id: string) => `CUST-${id.slice(0, 6).toUpperCase()}`;

type Props = { category: GrnCategory };

export function GrnForm({ category }: Props) {
  const navigate = useNavigate();
  const isOem = category === "oem";
  const isCust = category === "customer";
  const [items, setItems] = useState<GrnItem[]>([emptyGrnItem()]);
  const [sourceId, setSourceId] = useState<string | null>(null);
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

