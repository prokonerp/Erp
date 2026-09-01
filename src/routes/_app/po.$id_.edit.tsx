import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Save, Zap, ArrowLeft, ArrowRight, Package, Truck, FileText, Calculator } from "lucide-react";
import { VendorPicker, type Vendor } from "@/components/VendorPicker";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import type { Customer } from "@/lib/crm";
import { fetchBranches, type BranchRow } from "@/lib/sales";
import { productWarrantyMonths } from "@/lib/sales";
import { computeTotals, stateCodeFromGSTIN, stateNameFromCode, amountInWords } from "@/lib/gst";
import { PageLoader } from "@/components/shared/skeletons";
import {
  emptyPOItem,
  inrPO,
  poItemFromBreakup,
  fetchPOWithItems,
  type DeliveryAddressType,
  type POItemDraft,
} from "@/lib/purchaseOrder";
import { productDisplayName } from "@/lib/productNames";
import { usePermissions } from "@/lib/usePermissions";
import { useUnsavedChanges, UnsavedChangesPrompt } from "@/hooks/useUnsavedChanges";

export const Route = createFileRoute("/_app/po/$id_/edit")({
  component: EditPO,
  head: () => ({ meta: [{ title: "Edit Purchase Order — Prokon" }] }),
});

function EditPO() {
  const { id } = Route.useParams() as { id: string };
  const nav = useNavigate();
  const { loading: permLoading, isAdmin } = usePermissions();
  const [pageLoading, setPageLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const markDirty = () => { if (!dirty) setDirty(true); };
  const { blocker, markClean } = useUnsavedChanges(dirty);

  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [poDate, setPoDate] = useState<string>("");
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [payTerms, setPayTerms] = useState<string>("30 Days");
  const [deliveryType, setDeliveryType] = useState<DeliveryAddressType>("org");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customAddress, setCustomAddress] = useState<string>("");
  const [items, setItems] = useState<POItemDraft[]>([emptyPOItem()]);
  const [headerDiscount, setHeaderDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [saving, setSaving] = useState(false);
  const [poNo, setPoNo] = useState<string | null>(null);
  const [poStatus, setPoStatus] = useState<string>("draft");
  const [activeTab, setActiveTab] = useState("details");

  useEffect(() => {
    let active = true;
    async function load() {
      setPageLoading(true);
      try {
        const [bs, poData] = await Promise.all([
          fetchBranches(),
          fetchPOWithItems(id),
        ]);
        if (!active) return;
        setBranches(bs);
        const { po, items: poItems } = poData;
        setPoNo(po.po_no);
        setPoStatus(po.status);
        if (po.status !== "draft") {
          toast.error("Only Draft POs can be edited before approval.");
          nav({ to: "/po/$id", params: { id } });
          return;
        }
        setBranchId(po.branch_id);
        setPoDate(po.po_date);
        setDeliveryDate(po.delivery_date || "");
        setPayTerms(po.payment_terms || "30 Days");
        setDeliveryType(po.delivery_address_type as DeliveryAddressType);
        if (po.delivery_address_type === "custom") {
          setCustomAddress(po.delivery_address || "");
        }
        setVendor({
          id: po.vendor_id,
          name: po.vendor_name || "Vendor",
          contact_name: po.vendor_contact_name,
          phone: po.vendor_phone,
          email: po.vendor_email,
          address: po.vendor_address,
          gstin: po.vendor_gstin,
        } as Vendor);
        if (po.customer_id) {
          try {
            const { data: c } = await (supabase as any).from("customers").select("*").eq("id", po.customer_id).maybeSingle();
            if (c) setCustomer(c as Customer);
            else if (po.customer_name) {
              setCustomer({ id: po.customer_id, company: po.customer_name } as unknown as Customer);
            }
          } catch {
            if (po.customer_name) setCustomer({ id: po.customer_id, company: po.customer_name } as unknown as Customer);
          }
        }
        if (poItems.length > 0) {
          setItems(poItems.map((it) => ({
            product_id: it.product_id,
            description: it.description,
            hsn: it.hsn || "",
            qty: Number(it.qty) || 1,
            unit: it.unit || "Nos",
            rate: Number(it.rate) || 0,
            discount_pct: Number(it.discount_pct) || 0,
            gst_rate: Number(it.gst_rate) || 0,
            warranty_months: Number((it as any).warranty_months ?? 12) || 12,
          })));
        }
        setHeaderDiscount(Number(po.discount) || 0);
        setNotes(po.notes || "");
        setTerms(po.terms || "");
      } catch (e: any) {
        toast.error(e.message || "Failed to load PO");
        nav({ to: "/po" });
      } finally {
        if (active) setPageLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const branch = useMemo(() => branches.find((b) => b.id === branchId) || null, [branches, branchId]);
  const sellerCode = branch?.state_code || stateCodeFromGSTIN(branch?.gstin) || null;
  const vendorCode = stateCodeFromGSTIN(vendor?.gstin || null);
  const vendorState = stateNameFromCode(vendorCode);

  const totals = useMemo(
    () =>
      computeTotals({
        sellerStateCode: sellerCode,
        buyerStateCode: vendorCode,
        items: items.map((i) => ({ qty: i.qty, rate: i.rate, discount_pct: i.discount_pct, gst_rate: i.gst_rate })),
        headerDiscount,
        roundOff: true,
      }),
    [items, sellerCode, vendorCode, headerDiscount],
  );

  function setItem(idx: number, patch: Partial<POItemDraft>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    markDirty();
  }

  const deliveryAddress = useMemo(() => {
    if (deliveryType === "org") return branch?.address || "";
    if (deliveryType === "customer") {
      return customer?.shipping_address || customer?.billing_address || (customer as any)?.address || "";
    }
    return customAddress;
  }, [deliveryType, branch, customer, customAddress]);

  async function save(status: "draft" | "approved") {
    if (!branchId) return toast.error("Select branch");
    if (!vendor) return toast.error("Select vendor");
    if (items.length === 0 || items.some((it) => !it.description.trim())) return toast.error("Every line needs a description");
    if (!deliveryAddress.trim()) return toast.error("Delivery address is required");
    if (deliveryType === "customer" && !customer) return toast.error("Select a customer for delivery");
    if (poStatus !== "draft") {
      toast.error("Only Draft POs can be edited.");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        po_date: poDate,
        delivery_date: deliveryDate || null,
        branch_id: branchId,
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        vendor_gstin: vendor.gstin,
        vendor_address: vendor.address,
        vendor_contact_name: vendor.contact_name,
        vendor_phone: vendor.phone,
        vendor_email: vendor.email,
        vendor_state_code: vendorCode,
        vendor_state_name: vendorState,
        buyer_name: branch?.name,
        buyer_gstin: branch?.gstin,
        buyer_state_code: sellerCode,
        buyer_state_name: branch?.state_name,
        buyer_address: branch?.address,
        delivery_address_type: deliveryType,
        delivery_address: deliveryAddress,
        customer_id: deliveryType === "customer" ? customer?.id ?? null : null,
        customer_name: deliveryType === "customer" ? (customer as any)?.company ?? null : null,
        payment_terms: payTerms || null,
        is_interstate: totals.is_interstate,
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxable_value: totals.taxable_value,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        cess: totals.cess,
        round_off: totals.round_off,
        total: totals.total,
        total_in_words: amountInWords(totals.total),
        status,
        notes,
        terms,
      };
      const { error: e1 } = await (supabase as any).from("purchase_orders").update(payload).eq("id", id);
      if (e1) throw e1;

      const { error: eDel } = await (supabase as any).from("purchase_order_items").delete().eq("po_id", id);
      if (eDel) throw eDel;

      const itemRows = items.map((d, i) => {
        const b = totals.items[i];
        return { ...poItemFromBreakup(d, b), po_id: id, sr_no: i + 1 };
      });
      const { error: eIns } = await (supabase as any).from("purchase_order_items").insert(itemRows);
      if (eIns) throw eIns;

      toast.success(status === "approved" ? "PO updated & approved" : "PO updated");
      markClean();
      setDirty(false);
      nav({ to: "/po/$id", params: { id } });
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (permLoading || pageLoading) return <PageLoader />;
  if (!isAdmin) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">Only administrators can edit purchase orders before approval.</p>
        <Button variant="outline" size="sm" onClick={() => nav({ to: "/po/$id", params: { id } })}><ArrowLeft className="h-4 w-4 mr-1" />Back to PO</Button>
      </div>
    );
  }
  if (poStatus !== "draft") {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">This PO is <b>{poStatus}</b> — only Draft POs can be edited.</p>
        <Button variant="outline" size="sm" onClick={() => nav({ to: "/po/$id", params: { id } })}><ArrowLeft className="h-4 w-4 mr-1" />Back to PO</Button>
      </div>
    );
  }

  const PAY_OPTS = ["Advance", "7 Days", "15 Days", "30 Days"];
  const isCustomPay = !PAY_OPTS.includes(payTerms);

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto" onInput={markDirty}>
      <UnsavedChangesPrompt blocker={blocker} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => nav({ to: "/po/$id", params: { id } })} className="h-9"><ArrowLeft className="h-4 w-4 mr-1"/>Back</Button>
          <div>
            <h1 className="text-[18px] font-semibold tracking-tight flex items-center gap-2">
              Edit PO <span className="font-mono text-muted-foreground font-normal">{poNo || id.slice(0,8)}</span>
              <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold">Draft — Admin Edit</span>
            </h1>
            <p className="text-xs text-muted-foreground">Warranty defaults to 12 months — editable per line.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => save("draft")} disabled={saving} className="h-9 bg-white"><Save className="h-4 w-4 mr-1.5"/>Save Changes</Button>
          <Button size="sm" onClick={() => save("approved")} disabled={saving} className="h-9 px-5"><Zap className="h-4 w-4 mr-1.5"/>Save & Approve <ArrowRight className="h-3.5 w-3.5 ml-1 opacity-70"/></Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="h-10 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl w-fit">
          <TabsTrigger value="details" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 gap-1.5"><FileText className="h-3.5 w-3.5"/> Details</TabsTrigger>
          <TabsTrigger value="items" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 gap-1.5"><Package className="h-3.5 w-3.5"/> Items <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{items.length}</Badge></TabsTrigger>
          <TabsTrigger value="delivery" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 gap-1.5"><Truck className="h-3.5 w-3.5"/> Delivery</TabsTrigger>
          <TabsTrigger value="review" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm px-4 gap-1.5"><Calculator className="h-3.5 w-3.5"/> Totals</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 border-zinc-200 dark:border-zinc-800 shadow-sm rounded-xl">
              <CardHeader className="pb-3 border-b bg-zinc-50/50 dark:bg-zinc-900/30 rounded-t-xl">
                <CardTitle className="text-[13px] font-semibold tracking-wide uppercase text-muted-foreground">Order Header</CardTitle>
                <CardDescription className="text-xs">Buyer, vendor and schedule</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Branch (Buyer) *</Label>
                  <select className="w-full h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium focus:ring-2 focus:ring-primary/20 outline-none" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">— select branch —</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}{b.gstin ? ` · ${b.gstin}` : ""}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Vendor *</Label>
                  <VendorPicker value={vendor?.id} onChange={(_id, v) => setVendor(v)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold tracking-wide uppercase text-zinc-600">PO Date</Label>
                  <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="h-10 bg-white border-zinc-200 font-medium tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Delivery Date</Label>
                  <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="h-10 bg-white border-zinc-200 font-medium tabular-nums" />
                </div>
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Payment Terms</Label>
                  <div className="flex gap-2">
                    <select className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium w-44" value={isCustomPay ? "Custom" : payTerms} onChange={(e) => setPayTerms(e.target.value === "Custom" ? "" : e.target.value)}>
                      {PAY_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                      <option value="Custom">Custom</option>
                    </select>
                    <Input className="flex-1 h-10 bg-white border-zinc-200 font-medium" placeholder="e.g. 45 Days" value={payTerms} onChange={(e) => setPayTerms(e.target.value)} />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-zinc-200 shadow-sm rounded-xl">
              <CardHeader className="pb-3 border-b bg-zinc-50/50 rounded-t-xl"><CardTitle className="text-[13px] font-semibold tracking-wide uppercase text-muted-foreground">Vendor Snapshot</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-2 pt-4">
                {vendor ? (
                  <>
                    <div className="font-semibold text-[14px]">{vendor.name}</div>
                    {vendor.address && <div className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line bg-zinc-50 p-2.5 rounded-lg border">{vendor.address}</div>}
                    {vendor.gstin && <div className="flex justify-between text-xs"><span className="text-muted-foreground font-medium">GSTIN</span> <span className="font-mono font-semibold">{vendor.gstin}</span></div>}
                    {vendorState && <div className="flex justify-between text-xs"><span className="text-muted-foreground">State</span> <span className="font-medium">{vendorState} ({vendorCode})</span></div>}
                    <div className="pt-2 border-t text-xs space-y-1">
                      {vendor.contact_name && <div className="font-medium">{vendor.contact_name}</div>}
                      {(vendor.phone || vendor.email) && <div className="text-muted-foreground">{[vendor.phone, vendor.email].filter(Boolean).join(" · ")}</div>}
                    </div>
                    <div className="pt-2">
                      {totals.is_interstate ? (
                        <span className="inline-flex rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 text-xs font-semibold">Inter-state — IGST</span>
                      ) : sellerCode && vendorCode ? (
                        <span className="inline-flex rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 text-xs font-semibold">Intra-state — CGST + SGST</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Choose branch and vendor.</span>
                      )}
                    </div>
                  </>
                ) : <div className="text-sm text-muted-foreground py-6 text-center border border-dashed rounded-xl">Select vendor.</div>}
              </CardContent>
            </Card>
          </div>
          <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => setActiveTab("delivery")} className="h-9">Next: Delivery <ArrowRight className="h-3.5 w-3.5 ml-1"/></Button></div>
        </TabsContent>

        <TabsContent value="delivery" className="space-y-4 mt-4">
          <Card className="border-zinc-200 shadow-sm rounded-xl">
            <CardHeader className="pb-3 border-b"><CardTitle className="text-sm flex items-center gap-2"><Truck className="h-4 w-4 text-muted-foreground"/>Delivery Destination</CardTitle></CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="flex flex-wrap gap-2">
                {(["org","customer","custom"] as DeliveryAddressType[]).map((t) => (
                  <label key={t} className={`flex items-center gap-2 cursor-pointer rounded-full border px-3.5 py-2 text-sm font-medium transition ${deliveryType===t ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-white border-zinc-200 hover:bg-zinc-50"}`}>
                    <input type="radio" name="dtype" checked={deliveryType === t} onChange={() => setDeliveryType(t)} className="sr-only" />
                    <span className={`h-2 w-2 rounded-full ${deliveryType===t ? "bg-white" : "bg-zinc-300"}`}/>
                    {t === "org" ? "Organization Address" : t === "customer" ? "Customer Address" : "Custom Address"}
                  </label>
                ))}
              </div>
              {deliveryType === "customer" && (
                <div className="space-y-1.5"><Label className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Customer</Label><CustomerPicker value={customer?.id} onChange={(_id, c) => setCustomer(c)} /></div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Delivery Address *</Label>
                <Textarea rows={3} value={deliveryType === "custom" ? customAddress : deliveryAddress} onChange={(e) => { if (deliveryType === "custom") setCustomAddress(e.target.value); }} readOnly={deliveryType !== "custom"} className={`${deliveryType !== "custom" ? "bg-zinc-50 text-muted-foreground" : "bg-white font-medium"} border-zinc-200 rounded-xl`} placeholder={deliveryType === "custom" ? "Enter full delivery address…" : ""} />
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-between"><Button variant="ghost" size="sm" onClick={() => setActiveTab("details")}>Back</Button><Button size="sm" onClick={() => setActiveTab("items")} className="h-9">Next: Items <ArrowRight className="h-3.5 w-3.5 ml-1"/></Button></div>
        </TabsContent>

        <TabsContent value="items" className="space-y-4 mt-4">
          <Card className="border-zinc-200 shadow-sm rounded-xl overflow-hidden">
            <CardHeader className="py-3 px-4 bg-zinc-50/70 border-b flex flex-row items-center justify-between space-y-0">
              <div><CardTitle className="text-sm">Line Items</CardTitle><CardDescription className="text-xs">Warranty editable per line — defaults to 12 months from product master.</CardDescription></div>
              <Button size="sm" variant="outline" onClick={() => { setItems((a) => [...a, emptyPOItem()]); markDirty(); }} className="h-8 bg-white"><Plus className="h-3.5 w-3.5 mr-1"/>Add row</Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-900 text-zinc-50 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="p-2.5 text-left w-10 font-semibold">#</th>
                      <th className="p-2.5 text-left min-w-[280px] font-semibold">Product / Description</th>
                      <th className="p-2.5 text-left w-20 font-semibold">HSN</th>
                      <th className="p-2.5 text-right w-20 font-semibold">Qty</th>
                      <th className="p-2.5 text-left w-20 font-semibold">Unit</th>
                      <th className="p-2.5 text-right w-24 font-semibold">Rate</th>
                      <th className="p-2.5 text-right w-18 font-semibold">Disc%</th>
                      <th className="p-2.5 text-center w-20 font-semibold">GST%</th>
                      <th className="p-2.5 text-center w-24 font-semibold">Warranty</th>
                      <th className="p-2.5 text-right w-28 font-semibold">Amount</th>
                      <th className="p-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {items.map((it, idx) => {
                      const b = totals.items[idx];
                      return (
                        <tr key={idx} className="align-top hover:bg-zinc-50/70">
                          <td className="p-2 text-xs font-mono text-muted-foreground pt-3">{idx + 1}</td>
                          <td className="p-2 space-y-1.5">
                            <ProductMasterPicker value={it.product_id} onPick={(p) => {
                              const w = productWarrantyMonths(p as any);
                              setItem(idx, {
                                product_id: p.id,
                                description: productDisplayName(p as any),
                                hsn: p.hsn || "",
                                unit: p.unit || "Nos",
                                gst_rate: (p as any).gst_rate ?? it.gst_rate,
                                warranty_months: w > 0 ? w : 12,
                              });
                            }} />
                            <Input className="h-9 text-sm font-medium bg-white border-zinc-200 rounded-lg" placeholder="Description" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
                          </td>
                          <td className="p-2"><Input className="h-9 text-sm font-mono bg-white border-zinc-200 rounded-lg" value={it.hsn} onChange={(e) => setItem(idx, { hsn: e.target.value })} /></td>
                          <td className="p-2"><Input type="number" step="0.001" className="h-9 text-sm font-mono font-semibold tabular-nums bg-white border-zinc-200 rounded-lg text-right" value={it.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} /></td>
                          <td className="p-2"><Input className="h-9 text-sm font-medium bg-white border-zinc-200 rounded-lg" value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })} /></td>
                          <td className="p-2"><Input type="number" step="0.01" className="h-9 text-sm font-mono font-semibold tabular-nums bg-white border-zinc-200 rounded-lg text-right" value={it.rate} onChange={(e) => setItem(idx, { rate: Number(e.target.value) })} /></td>
                          <td className="p-2"><Input type="number" step="0.01" className="h-9 text-sm font-mono tabular-nums bg-white border-zinc-200 rounded-lg text-right" value={it.discount_pct} onChange={(e) => setItem(idx, { discount_pct: Number(e.target.value) })} /></td>
                          <td className="p-2">
                            <select className="w-full h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm font-semibold text-center" value={it.gst_rate} onChange={(e) => setItem(idx, { gst_rate: Number(e.target.value) })}>
                              {[0, 0.1, 0.25, 1.5, 3, 5, 6, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                            </select>
                          </td>
                          <td className="p-2">
                            <div className="flex items-center gap-1">
                              <Input type="number" min={0} max={120} className="h-9 w-16 text-sm font-mono font-semibold tabular-nums bg-amber-50 border-amber-200 rounded-lg text-center" value={it.warranty_months} onChange={(e) => setItem(idx, { warranty_months: Number(e.target.value) })} />
                              <span className="text-xs text-muted-foreground whitespace-nowrap">mo</span>
                            </div>
                          </td>
                          <td className="p-2 text-right font-mono font-bold tabular-nums pt-3">{inrPO(b?.line_total || 0)}</td>
                          <td className="p-2 text-right pt-2">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-zinc-400 hover:text-destructive" onClick={() => setItems((a) => a.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-between"><Button variant="ghost" size="sm" onClick={() => setActiveTab("delivery")}>Back</Button><Button size="sm" onClick={() => setActiveTab("review")} className="h-9">Next: Review <ArrowRight className="h-3.5 w-3.5 ml-1"/></Button></div>
        </TabsContent>

        <TabsContent value="review" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2 border-zinc-200 shadow-sm rounded-xl">
              <CardHeader className="pb-3 border-b"><CardTitle className="text-sm">Notes & Terms</CardTitle></CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="space-y-1.5"><Label className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Notes (internal)</Label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" className="bg-white border-zinc-200 rounded-xl" /></div>
                <div className="space-y-1.5"><Label className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Terms & Conditions (printable)</Label><Textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Warranty, delivery, payment terms for print" className="bg-white border-zinc-200 rounded-xl" /></div>
              </CardContent>
            </Card>
            <Card className="border-zinc-200 shadow-sm rounded-xl">
              <CardHeader className="pb-3 border-b bg-zinc-900 text-white rounded-t-xl"><CardTitle className="text-sm text-white">Pricing Summary</CardTitle></CardHeader>
              <CardContent className="space-y-2.5 pt-4">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span className="font-mono font-semibold tabular-nums">{inrPO(totals.subtotal)}</span></div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <Input type="number" step="0.01" className="h-8 w-28 text-right font-mono font-semibold tabular-nums bg-white border-zinc-200 rounded-lg" value={headerDiscount} onChange={(e) => setHeaderDiscount(Number(e.target.value))} />
                </div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Taxable</span><span className="font-mono font-semibold tabular-nums">{inrPO(totals.taxable_value)}</span></div>
                {totals.is_interstate ? (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">IGST</span><span className="font-mono tabular-nums">{inrPO(totals.igst)}</span></div>
                ) : (
                  <>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">CGST</span><span className="font-mono tabular-nums">{inrPO(totals.cgst)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">SGST</span><span className="font-mono tabular-nums">{inrPO(totals.sgst)}</span></div>
                  </>
                )}
                {totals.round_off !== 0 && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Round Off</span><span className="font-mono tabular-nums">{inrPO(totals.round_off)}</span></div>}
                <div className="flex justify-between pt-3 border-t font-bold text-[16px]"><span>Total</span><span className="font-mono tabular-nums">{inrPO(totals.total)}</span></div>
                <p className="text-xs leading-relaxed text-muted-foreground pt-2 italic bg-zinc-50 p-2.5 rounded-lg border">{amountInWords(totals.total)}</p>
                <div className="pt-3 flex gap-2">
                  <Button variant="outline" className="flex-1 h-9 bg-white" onClick={() => save("draft")} disabled={saving}><Save className="h-3.5 w-3.5 mr-1"/> Save</Button>
                  <Button className="flex-1 h-9" onClick={() => save("approved")} disabled={saving}><Zap className="h-3.5 w-3.5 mr-1"/> Save & Approve</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
