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
import type { ChallanItem, DocType } from "@/lib/challan";
import { emptyItem } from "@/lib/challan";
import { CustomerPicker } from "@/components/CustomerPicker";
import { VendorPicker, vendorShortCode } from "@/components/VendorPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import type { Customer } from "@/lib/crm";
import { FormShell, FormSection, FormGrid, FormField, StickyMobileActions } from "@/components/form-kit";

const custCode = (id: string) => `CUST-${id.slice(0, 6).toUpperCase()}`;

type Props = { docType: DocType };

export function ChallanForm({ docType }: Props) {
  const navigate = useNavigate();
  const isOem = docType === "oem";
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

