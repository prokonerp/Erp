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
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import type { ProductMaster } from "@/components/ProductPicker";
import { BundleApplyDialog } from "@/components/BundleApplyDialog";
import { fetchBundleChildrenRaw } from "@/lib/productBundles";
import { SerialMultiPicker } from "@/components/SerialMultiPicker";
import type { Customer } from "@/lib/crm";
import {
  fetchBranches,
  emptyItem,
  inr,
  itemDraftFromBreakup,
  type BranchRow,
  type ItemDraft,
} from "@/lib/sales";
import {
  computeTotals,
  isValidGSTIN,
  stateCodeFromGSTIN,
  stateNameFromCode,
  amountInWords,
} from "@/lib/gst";

export const Route = createFileRoute("/_app/sales/invoices/new")({
  component: NewInvoice,
  head: () => ({ meta: [{ title: "New Invoice — Prokon" }] }),
});

function NewInvoice() {
  const nav = useNavigate();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState<string>("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [billing, setBilling] = useState("");
  const [shipping, setShipping] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<string>("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [headerDiscount, setHeaderDiscount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; code: string }[]>([]);
  const [serialPickerIdx, setSerialPickerIdx] = useState<number | null>(null);
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [termsTouched, setTermsTouched] = useState(false);
  const [bundleFor, setBundleFor] = useState<ProductMaster | null>(null);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleParentQty, setBundleParentQty] = useState(1);

  useEffect(() => {
    fetchBranches().then((bs) => {
      setBranches(bs);
      const def = bs.find((b) => b.is_default) || bs[0];
      if (def) setBranchId(def.id);
    }).catch((e) => toast.error(e.message));
    supabase.from("warehouses").select("id,name,code").eq("status", "Active").order("name")
      .then(({ data }) => setWarehouses((data ?? []) as any));
  }, []);

  const branch = useMemo(() => branches.find((b) => b.id === branchId) || null, [branches, branchId]);

  useEffect(() => {
    if (customer) {
      setBilling(customer.billing_address || (customer as any).address || "");
      const ship = (customer as any).shipping_address || customer.billing_address || (customer as any).address || "";
      setShipping(ship);
      setSameAsBilling(!ship || ship === (customer.billing_address || (customer as any).address || ""));
    }
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync shipping with billing when "same as" is on
  useEffect(() => {
    if (sameAsBilling) setShipping(billing);
  }, [sameAsBilling, billing]);

  // Auto-load default terms + place-of-supply from invoice_settings when branch is chosen
  useEffect(() => {
    if (!branchId) return;
    supabase
      .from("invoice_settings")
      .select("terms_default,notes_default")
      .eq("branch_id", branchId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        if (!termsTouched && !terms && (data as any).terms_default) {
          setTerms((data as any).terms_default);
        }
        if (!notes && (data as any).notes_default) {
          setNotes((data as any).notes_default);
        }
      });
  }, [branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sellerCode = branch?.state_code || stateCodeFromGSTIN(branch?.gstin) || null;
  const buyerCode = (customer as any)?.state_code || stateCodeFromGSTIN(customer?.gst || null);
  const sellerState = branch?.state_name || stateNameFromCode(sellerCode);
  const buyerState = customer?.state || stateNameFromCode(buyerCode);
  const gstinError = customer?.gst && !isValidGSTIN(customer.gst)
    ? "Buyer GSTIN format looks invalid"
    : null;

  const totals = useMemo(
    () =>
      computeTotals({
        sellerStateCode: sellerCode,
        buyerStateCode: buyerCode,
        items: items.map((i) => ({ qty: i.qty, rate: i.rate, discount_pct: i.discount_pct, gst_rate: i.gst_rate })),
        headerDiscount,
        roundOff: true,
      }),
    [items, sellerCode, buyerCode, headerDiscount],
  );

  function setItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save(status: "draft" | "issued") {
    if (!branchId) return toast.error("Choose a branch (seller)");
    if (!branch?.gstin) return toast.error("Selected branch has no GSTIN — set it in Sales → Settings");
    if (!customer) return toast.error("Choose a customer");
    if (items.length === 0 || items.some((it) => !it.description.trim())) return toast.error("Every line needs a description");
    if (items.some((it) => Number(it.gst_rate) > 0 && !it.hsn.trim())) return toast.error("HSN code is mandatory when GST > 0");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.warehouse_id) return toast.error(`Line ${i + 1}: select a warehouse`);
      if (it.is_serialized) {
        if (it.serial_numbers.length !== Math.floor(Number(it.qty))) {
          return toast.error(`Line ${i + 1}: select ${Math.floor(Number(it.qty))} serial number(s)`);
        }
      }
    }
    // Prevent duplicate serials across lines
    const allSerials = items.flatMap((it) => it.serial_numbers);
    if (new Set(allSerials).size !== allSerials.length) return toast.error("Duplicate serial numbers across lines");
    if (gstinError) return toast.error(gstinError);

    setSaving(true);
    try {
      const invoicePayload: any = {
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        branch_id: branchId,
        customer_id: customer.id,
        po_number: poNumber || null,
        po_date: poDate || null,
        seller_name: branch.name,
        seller_gstin: branch.gstin,
        seller_state: sellerState,
        seller_state_code: sellerCode,
        seller_address: branch.address,
        buyer_name: customer.company,
        buyer_gstin: customer.gst,
        buyer_state: buyerState,
        buyer_state_code: buyerCode,
        billing_address: billing,
        shipping_address: shipping,
        place_of_supply: buyerState,
        place_of_supply_code: buyerCode,
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
        payment_terms: paymentTerms || null,
      };
      const { data: inv, error } = await supabase.from("invoices").insert(invoicePayload).select("id, invoice_no").single();
      if (error) throw error;

      const itemRows = items.map((d, i) => {
        const b = totals.items[i];
        const row = itemDraftFromBreakup(d, b);
        return { ...row, invoice_id: inv.id, sr_no: i + 1 };
      });
      const { error: e2 } = await supabase.from("invoice_items").insert(itemRows);
      if (e2) throw e2;

      toast.success(`Invoice ${inv.invoice_no || ""} ${status === "issued" ? "issued" : "saved"}`);
      nav({ to: "/sales/invoices/$id", params: { id: inv.id } });
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">New Invoice</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => save("draft")} disabled={saving}>
            <Save className="h-4 w-4 mr-1.5" />Save Draft
          </Button>
          <Button size="sm" onClick={() => save("issued")} disabled={saving}>
            <Zap className="h-4 w-4 mr-1.5" />Issue Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Header</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Branch (Seller) *</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">— select —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.gstin ? ` · ${b.gstin}` : ""}{b.state_name ? ` · ${b.state_name}` : ""}
                  </option>
                ))}
              </select>
              {branch && !branch.gstin && (
                <p className="text-xs text-destructive mt-1">Branch missing GSTIN — set it in Sales → Settings.</p>
              )}
            </div>
            <div>
              <Label className="text-xs">Customer *</Label>
              <CustomerPicker value={customer?.id} onChange={(_id, c) => setCustomer(c)} />
              {gstinError && <p className="text-xs text-destructive mt-1">{gstinError}</p>}
            </div>
            <div>
              <Label className="text-xs">Invoice Date</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">PO Number</Label>
              <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Customer PO No." />
            </div>
            <div>
              <Label className="text-xs">PO Date</Label>
              <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Payment Terms</Label>
              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm w-40"
                  value={["Advance","7 Days","15 Days","30 Days"].includes(paymentTerms) ? paymentTerms : "Custom"}
                  onChange={(e) => setPaymentTerms(e.target.value === "Custom" ? "" : e.target.value)}
                >
                  <option value="Advance">Advance</option>
                  <option value="7 Days">7 Days</option>
                  <option value="15 Days">15 Days</option>
                  <option value="30 Days">30 Days</option>
                  <option value="Custom">Custom</option>
                </select>
                <Input
                  className="flex-1"
                  placeholder="e.g. 45 Days / Against Delivery"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Billing Address</Label>
              <Textarea rows={2} value={billing} onChange={(e) => setBilling(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Shipping Address</Label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameAsBilling}
                    onChange={(e) => setSameAsBilling(e.target.checked)}
                  />
                  Same as Billing Address
                </label>
              </div>
              <Textarea
                rows={2}
                value={shipping}
                disabled={sameAsBilling}
                onChange={(e) => setShipping(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">GST Determination</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between"><span className="text-muted-foreground">Seller State</span><span>{sellerState || "—"} {sellerCode && `(${sellerCode})`}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Buyer State</span><span>{buyerState || "—"} {buyerCode && `(${buyerCode})`}</span></div>
            <div className="pt-2 border-t">
              {totals.is_interstate ? (
                <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">Inter-state supply — IGST applies</span>
              ) : sellerCode && buyerCode ? (
                <span className="inline-block bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">Intra-state supply — CGST + SGST</span>
              ) : (
                <span className="text-xs text-muted-foreground">Pick branch and customer to determine tax type.</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems((a) => [...a, emptyItem()])}><Plus className="h-4 w-4 mr-1" />Add row</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-2 text-left w-8">#</th>
                  <th className="p-2 text-left min-w-[220px]">Product / Description</th>
                  <th className="p-2 text-left w-24">HSN *</th>
                  <th className="p-2 text-left w-40">Warehouse *</th>
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
                          onPick={(p) => {
                            setItem(idx, {
                            product_id: p.id,
                            description: p.name,
                            hsn: p.hsn || "",
                            unit: p.unit || "Nos",
                            gst_rate: (p as any).gst_rate ?? it.gst_rate,
                            is_serialized: !!(p as any).serial_tracking,
                            part_model_no: p.model,
                            part_name: p.name,
                            serial_numbers: [],
                            });
                            fetchBundleChildrenRaw(p.id).then((rowsB) => {
                              if (rowsB.length > 0) {
                                setBundleParentQty(Number(it.qty) || 1);
                                setBundleFor(p as any);
                                setBundleOpen(true);
                              }
                            }).catch(() => {});
                          }}
                        />
                        <Input className="h-8 text-xs" placeholder="Description" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
                        {it.is_serialized && (
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={it.serial_numbers.length === Math.floor(Number(it.qty)) ? "outline" : "secondary"}
                              className="h-7 text-xs"
                              onClick={() => setSerialPickerIdx(idx)}
                              disabled={!it.warehouse_id || Number(it.qty) <= 0}
                            >
                              Serials: {it.serial_numbers.length}/{Math.floor(Number(it.qty)) || 0}
                            </Button>
                            {it.serial_numbers.length > 0 && (
                              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[220px]">
                                {it.serial_numbers.join(", ")}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2"><Input className="h-8 text-xs" value={it.hsn} onChange={(e) => setItem(idx, { hsn: e.target.value })} /></td>
                      <td className="p-2">
                        <select
                          className="w-full h-8 rounded-md border bg-background px-1 text-xs"
                          value={it.warehouse_id || ""}
                          onChange={(e) => setItem(idx, { warehouse_id: e.target.value || null, serial_numbers: [] })}
                        >
                          <option value="">— select —</option>
                          {warehouses.map((w) => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2"><Input type="number" step="0.001" className="h-8 text-xs text-right" value={it.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} /></td>
                      <td className="p-2"><Input className="h-8 text-xs" value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })} /></td>
                      <td className="p-2"><Input type="number" step="0.01" className="h-8 text-xs text-right" value={it.rate} onChange={(e) => setItem(idx, { rate: Number(e.target.value) })} /></td>
                      <td className="p-2"><Input type="number" step="0.01" className="h-8 text-xs text-right" value={it.discount_pct} onChange={(e) => setItem(idx, { discount_pct: Number(e.target.value) })} /></td>
                      <td className="p-2">
                        <select className="w-full h-8 rounded-md border bg-background px-1 text-xs" value={it.gst_rate} onChange={(e) => setItem(idx, { gst_rate: Number(e.target.value) })}>
                          {[0, 0.1, 0.25, 1.5, 3, 5, 6, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </td>
                      <td className="p-2 text-right font-medium">{inr(b?.line_total || 0)}</td>
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

      {serialPickerIdx !== null && items[serialPickerIdx] && (
        <SerialMultiPicker
          open={serialPickerIdx !== null}
          onOpenChange={(v) => !v && setSerialPickerIdx(null)}
          qty={Math.floor(Number(items[serialPickerIdx].qty)) || 0}
          warehouseId={items[serialPickerIdx].warehouse_id}
          partModelNo={items[serialPickerIdx].part_model_no}
          partName={items[serialPickerIdx].part_name}
          value={items[serialPickerIdx].serial_numbers}
          excludeSerials={items.flatMap((it, i) => (i === serialPickerIdx ? [] : it.serial_numbers))}
          onConfirm={(sns) => setItem(serialPickerIdx, { serial_numbers: sns })}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Notes & Terms</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Terms & Conditions</Label>
              <Textarea
                rows={3}
                value={terms}
                onChange={(e) => { setTerms(e.target.value); setTermsTouched(true); }}
                placeholder="Auto-loaded from Sales Settings; edit to override for this invoice."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Totals</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <div className="flex justify-between"><span>Subtotal</span><span>{inr(totals.subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <span>Discount</span>
              <Input type="number" step="0.01" className="h-7 w-28 text-right text-xs" value={headerDiscount} onChange={(e) => setHeaderDiscount(Number(e.target.value))} />
            </div>
            <div className="flex justify-between"><span>Taxable Value</span><span>{inr(totals.taxable_value)}</span></div>
            {totals.is_interstate ? (
              <div className="flex justify-between"><span>IGST</span><span>{inr(totals.igst)}</span></div>
            ) : (
              <>
                <div className="flex justify-between"><span>CGST</span><span>{inr(totals.cgst)}</span></div>
                <div className="flex justify-between"><span>SGST</span><span>{inr(totals.sgst)}</span></div>
              </>
            )}
            {totals.round_off !== 0 && (
              <div className="flex justify-between"><span>Round Off</span><span>{inr(totals.round_off)}</span></div>
            )}
            <div className="flex justify-between pt-2 border-t font-bold text-base">
              <span>Total</span><span>{inr(totals.total)}</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1 italic">{amountInWords(totals.total)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}