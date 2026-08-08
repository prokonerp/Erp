import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, Save, Zap } from "lucide-react";
import { VendorPicker, type Vendor } from "@/components/VendorPicker";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import type { Customer } from "@/lib/crm";
import { fetchBranches, type BranchRow } from "@/lib/sales";
import { computeTotals, stateCodeFromGSTIN, stateNameFromCode, amountInWords } from "@/lib/gst";
import {
import { productDisplayName } from "@/lib/productNames";
  emptyPOItem,
  inrPO,
  poItemFromBreakup,
  type DeliveryAddressType,
  type POItemDraft,
} from "@/lib/purchaseOrder";

export const Route = createFileRoute("/_app/po/new")({
  component: NewPO,
  head: () => ({ meta: [{ title: "New Purchase Order — Prokon" }] }),
});

function NewPO() {
  const nav = useNavigate();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState<string>("");

  const [payTerms, setPayTerms] = useState<string>("30 Days");

  // Delivery
  const [deliveryType, setDeliveryType] = useState<DeliveryAddressType>("org");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customAddress, setCustomAddress] = useState<string>("");

  const [items, setItems] = useState<POItemDraft[]>([emptyPOItem()]);
  const [headerDiscount, setHeaderDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchBranches().then((bs) => {
      setBranches(bs);
      const def = bs.find((b) => b.is_default) || bs[0];
      if (def) setBranchId(def.id);
    }).catch((e) => toast.error(e.message));
  }, []);

  const branch = useMemo(() => branches.find((b) => b.id === branchId) || null, [branches, branchId]);

  const sellerCode = branch?.state_code || stateCodeFromGSTIN(branch?.gstin) || null;
  const vendorCode = stateCodeFromGSTIN(vendor?.gstin || null);
  const vendorState = stateNameFromCode(vendorCode);

  const totals = useMemo(
    () => computeTotals({
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
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
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
        customer_name: deliveryType === "customer" ? customer?.company ?? null : null,
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
        created_by: u.user?.id ?? null,
      };
      const { data: po, error } = await (supabase as any).from("purchase_orders").insert(payload).select("id, po_no").single();
      if (error) throw error;

      const itemRows = items.map((d, i) => {
        const b = totals.items[i];
        return { ...poItemFromBreakup(d, b), po_id: po.id, sr_no: i + 1 };
      });
      const { error: e2 } = await (supabase as any).from("purchase_order_items").insert(itemRows);
      if (e2) throw e2;

      toast.success(`PO ${po.po_no || ""} ${status === "approved" ? "approved" : "saved"}`);
      nav({ to: "/po/$id", params: { id: po.id } });
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const PAY_OPTS = ["Advance", "7 Days", "15 Days", "30 Days"];
  const isCustomPay = !PAY_OPTS.includes(payTerms);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">New Purchase Order</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => save("draft")} disabled={saving}>
            <Save className="h-4 w-4 mr-1.5" />Save Draft
          </Button>
          <Button size="sm" onClick={() => save("approved")} disabled={saving}>
            <Zap className="h-4 w-4 mr-1.5" />Approve PO
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Header</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Branch (Buyer) *</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">— select —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.gstin ? ` · ${b.gstin}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Vendor *</Label>
              <VendorPicker value={vendor?.id} onChange={(_id, v) => setVendor(v)} />
            </div>
            <div>
              <Label className="text-xs">PO Date</Label>
              <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Delivery Date</Label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Payment Terms</Label>
              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm w-40"
                  value={isCustomPay ? "Custom" : payTerms}
                  onChange={(e) => setPayTerms(e.target.value === "Custom" ? "" : e.target.value)}
                >
                  {PAY_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                  <option value="Custom">Custom</option>
                </select>
                <Input className="flex-1" placeholder="e.g. 45 Days / Against Delivery" value={payTerms} onChange={(e) => setPayTerms(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Vendor Details</CardTitle></CardHeader>
          <CardContent className="text-xs space-y-1.5">
            {vendor ? (
              <>
                <div className="font-medium text-sm">{vendor.name}</div>
                {vendor.address && <div className="text-muted-foreground whitespace-pre-line">{vendor.address}</div>}
                {vendor.gstin && <div><span className="text-muted-foreground">GSTIN:</span> <span className="font-mono">{vendor.gstin}</span></div>}
                {vendorState && <div><span className="text-muted-foreground">State:</span> {vendorState} ({vendorCode})</div>}
                <div className="pt-1 border-t">
                  {vendor.contact_name && <div>{vendor.contact_name}</div>}
                  {(vendor.phone || vendor.email) && <div className="text-muted-foreground">{[vendor.phone, vendor.email].filter(Boolean).join(" · ")}</div>}
                </div>
                <div className="pt-2">
                  {totals.is_interstate ? (
                    <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">Inter-state — IGST</span>
                  ) : sellerCode && vendorCode ? (
                    <span className="inline-block bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">Intra-state — CGST + SGST</span>
                  ) : (
                    <span className="text-muted-foreground">Choose branch and vendor to determine tax type.</span>
                  )}
                </div>
              </>
            ) : <div className="text-muted-foreground">Select a vendor to auto-fetch details.</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Delivery Destination</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 text-sm">
            {(["org","customer","custom"] as DeliveryAddressType[]).map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="dtype" checked={deliveryType === t} onChange={() => setDeliveryType(t)} />
                <span>
                  {t === "org" ? "Organization Address" : t === "customer" ? "Customer Address" : "Custom Address"}
                </span>
              </label>
            ))}
          </div>
          {deliveryType === "customer" && (
            <div>
              <Label className="text-xs">Customer (for direct delivery / project reference)</Label>
              <CustomerPicker value={customer?.id} onChange={(_id, c) => setCustomer(c)} />
            </div>
          )}
          <div>
            <Label className="text-xs">Delivery Address *</Label>
            <Textarea
              rows={3}
              value={deliveryType === "custom" ? customAddress : deliveryAddress}
              onChange={(e) => {
                if (deliveryType === "custom") setCustomAddress(e.target.value);
                else setCustomAddress(e.target.value);
              }}
              readOnly={deliveryType !== "custom"}
              className={deliveryType !== "custom" ? "bg-muted/50" : ""}
              placeholder={deliveryType === "custom" ? "Enter delivery address…" : ""}
            />
            {deliveryType !== "custom" && (
              <p className="text-xs text-muted-foreground mt-1">
                Auto-populated from {deliveryType === "org" ? "branch" : "customer"} master. Switch to Custom to override.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems((a) => [...a, emptyPOItem()])}><Plus className="h-4 w-4 mr-1" />Add row</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-2 text-left w-8">#</th>
                  <th className="p-2 text-left min-w-[220px]">Product / Description</th>
                  <th className="p-2 text-left w-24">HSN</th>
                  <th className="p-2 text-right w-20">Qty</th>
                  <th className="p-2 text-left w-20">Unit</th>
                  <th className="p-2 text-right w-24">Rate</th>
                  <th className="p-2 text-right w-16">Disc%</th>
                  <th className="p-2 text-right w-20">GST%</th>
                  <th className="p-2 text-right w-24">Amount</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const b = totals.items[idx];
                  return (
                    <tr key={idx} className="border-t align-top">
                      <td className="p-2 text-xs">{idx + 1}</td>
                      <td className="p-2 space-y-1">
                        <ProductMasterPicker
                          value={it.product_id}
                          onPick={(p) => setItem(idx, {
                            product_id: p.id,
                            description: p.name,
                            hsn: p.hsn || "",
                            unit: p.unit || "Nos",
                            gst_rate: (p as any).gst_rate ?? it.gst_rate,
                          })}
                        />
                        <Input className="h-8 text-xs" placeholder="Description" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
                      </td>
                      <td className="p-2"><Input className="h-8 text-xs" value={it.hsn} onChange={(e) => setItem(idx, { hsn: e.target.value })} /></td>
                      <td className="p-2"><Input type="number" step="0.001" className="h-8 text-xs text-right" value={it.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} /></td>
                      <td className="p-2"><Input className="h-8 text-xs" value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })} /></td>
                      <td className="p-2"><Input type="number" step="0.01" className="h-8 text-xs text-right" value={it.rate} onChange={(e) => setItem(idx, { rate: Number(e.target.value) })} /></td>
                      <td className="p-2"><Input type="number" step="0.01" className="h-8 text-xs text-right" value={it.discount_pct} onChange={(e) => setItem(idx, { discount_pct: Number(e.target.value) })} /></td>
                      <td className="p-2">
                        <select className="w-full h-8 rounded-md border bg-background px-1 text-xs" value={it.gst_rate} onChange={(e) => setItem(idx, { gst_rate: Number(e.target.value) })}>
                          {[0, 0.1, 0.25, 1.5, 3, 5, 6, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </td>
                      <td className="p-2 text-right font-medium">{inrPO(b?.line_total || 0)}</td>
                      <td className="p-2 text-right">
                        <Button size="icon" variant="ghost" onClick={() => setItems((a) => a.filter((_, i) => i !== idx))}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Notes & Terms</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div><Label className="text-xs">Notes (internal)</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div><Label className="text-xs">Terms & Conditions (printable)</Label><Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Totals</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <div className="flex justify-between"><span>Subtotal</span><span>{inrPO(totals.subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <span>Discount</span>
              <Input type="number" step="0.01" className="h-7 w-28 text-right text-xs" value={headerDiscount} onChange={(e) => setHeaderDiscount(Number(e.target.value))} />
            </div>
            <div className="flex justify-between"><span>Taxable Value</span><span>{inrPO(totals.taxable_value)}</span></div>
            {totals.is_interstate ? (
              <div className="flex justify-between"><span>IGST</span><span>{inrPO(totals.igst)}</span></div>
            ) : (
              <>
                <div className="flex justify-between"><span>CGST</span><span>{inrPO(totals.cgst)}</span></div>
                <div className="flex justify-between"><span>SGST</span><span>{inrPO(totals.sgst)}</span></div>
              </>
            )}
            {totals.round_off !== 0 && (
              <div className="flex justify-between"><span>Round Off</span><span>{inrPO(totals.round_off)}</span></div>
            )}
            <div className="flex justify-between pt-2 border-t font-bold text-base">
              <span>Total</span><span>{inrPO(totals.total)}</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1 italic">{amountInWords(totals.total)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}