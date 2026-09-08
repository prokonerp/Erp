// @ts-nocheck
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Save, ArrowLeft } from "lucide-react";
import { CustomerPicker } from "@/components/CustomerPicker";
import { BranchPicker } from "@/components/BranchPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import { fetchBranches, inr, type BranchRow } from "@/lib/sales";
import { computeTotals, amountInWords } from "@/lib/gst";
import { emptyProformaItem, insertProforma, type ProformaItem } from "@/lib/proforma";
import { istTodayIso } from "@/lib/dateRange";
import { productShortName } from "@/lib/productNames";
import type { Customer, CustomerBranch } from "@/lib/crm";
import { branchToDocumentFields } from "@/lib/crm";

export const Route = createFileRoute("/_app/sales/proforma/new")({
  component: NewProforma,
  head: () => ({
    meta: [
      { title: "New Proforma Invoice — Prokon ERP" },
      { name: "description", content: "Create a proforma invoice (no stock). Prefer creating from Sales Order → Convert." },
      { property: "og:title", content: "New Proforma Invoice — Prokon ERP" },
      { property: "og:description", content: "Create a proforma invoice (no stock). Prefer creating from Sales Order → Convert." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function NewProforma() {
  const nav = useNavigate();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [branchOverride, setBranchOverride] = useState<CustomerBranch | null>(null);
  const [proformaDate, setProformaDate] = useState(istTodayIso());
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [billing, setBilling] = useState("");
  const [shipping, setShipping] = useState("");
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [items, setItems] = useState<ProformaItem[]>([emptyProformaItem()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchBranches().then((bs) => {
      setBranches(bs);
      const def = bs.find((b) => b.is_default) || bs[0];
      if (def) setBranchId(def.id);
    }).catch((e) => toast.error(e.message));
  }, []);

  useEffect(() => {
    if (!customer) return;
    if (branchOverride) {
      const bf = branchToDocumentFields(branchOverride);
      setBilling(bf.billing_address || customer.billing_address || (customer as any).address || "");
      const ship = bf.shipping_address || bf.billing_address || customer.shipping_address || bf.billing_address || "";
      setShipping(ship);
      setSameAsBilling(!ship || ship === (bf.billing_address || ""));
      return;
    }
    const bill = customer.billing_address || (customer as any).address || "";
    const ship = (customer as any).shipping_address || bill;
    setBilling(bill);
    setShipping(ship);
    setSameAsBilling(!ship || ship === bill);
  }, [customer?.id, branchOverride]);

  useEffect(() => {
    if (sameAsBilling) setShipping(billing);
  }, [sameAsBilling, billing]);

  const totals = useMemo(() => {
    const branch = branches.find((b) => b.id === branchId);
    const sellerCode = branch?.state_code || null;
    const buyerCode = null;
    try {
      return computeTotals({
        sellerStateCode: sellerCode,
        buyerStateCode: buyerCode,
        items: items.map((it) => ({
          qty: Number(it.qty) || 0,
          rate: Number(it.rate) || 0,
          discount_pct: Number(it.discount_pct) || 0,
          gst_rate: Number(it.gst_rate) || 0,
          cess_rate: Number(it.cess_rate) || 0,
        })),
        roundOff: true,
      });
    } catch {
      return null;
    }
  }, [items, branchId, branches]);

  function setItem(idx: number, patch: Partial<ProformaItem>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function validate(): string | null {
    if (!branchId) return "Select a branch";
    if (!customer) return "Choose a customer";
    if (items.length === 0) return "Add at least one item";
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.description?.trim()) return `Line ${i + 1}: description required`;
      if (!(Number(it.qty) > 0)) return `Line ${i + 1}: qty must be > 0`;
      if (!(Number(it.rate) >= 0)) return `Line ${i + 1}: rate invalid`;
    }
    return null;
  }

  async function save(status: "draft" | "issued") {
    const err = validate();
    if (err) return toast.error(err);
    if (!customer || !totals) return;
    setSaving(true);
    try {
      const branch = branches.find((b) => b.id === branchId);
      const payload: Record<string, unknown> = {
        proforma_date: proformaDate,
        branch_id: branchId,
        customer_id: customer.id,
        seller_name: branch?.name || null,
        seller_gstin: branch?.gstin || null,
        seller_state: branch?.state_name || null,
        seller_state_code: branch?.state_code || null,
        buyer_name: customer.company,
        buyer_gstin: customer.gst,
        buyer_state: customer.state,
        billing_address: billing || null,
        shipping_address: shipping || null,
        is_interstate: totals.is_interstate,
        po_number: poNumber || null,
        po_date: poDate || null,
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
        items: items.map((it, i) => {
          const b = totals.items[i];
          return { ...it, taxable_value: b.taxable_value, cgst: b.cgst, sgst: b.sgst, igst: b.igst, cess: b.cess, line_total: b.line_total };
        }),
        status,
        notes: notes || null,
        terms: terms || null,
      };
      const row = await insertProforma(payload);
      toast.success(`${row.proforma_no || "Proforma"} ${status === "issued" ? "issued" : "saved"}`);
      nav({ to: "/sales/proforma/$id", params: { id: row.id } });
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild><Link to="/sales/proforma"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <h1 className="text-2xl font-bold">New Proforma Invoice</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={saving} onClick={() => save("draft")}><Save className="h-4 w-4 mr-1.5" />Save Draft</Button>
          <Button size="sm" disabled={saving} onClick={() => save("issued")}>Issue</Button>
        </div>
      </div>

      <div className="rounded-md border bg-amber-50 border-amber-200 px-3 py-2 text-xs text-amber-800">
        Tip: The preferred way to create a Proforma is from <span className="font-semibold">Sales Order detail → Convert → Proforma</span> (auto-populates header, items and prior fulfillment). Use this form only for standalone proformas.
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Header</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Branch *</Label>
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">— select —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Proforma Date</Label>
            <Input type="date" value={proformaDate} onChange={(e) => setProformaDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Customer *</Label>
            <CustomerPicker value={customer?.id} branchValue={branchOverride?.id} onChange={(_id, c, branch) => { setCustomer(c); setBranchOverride(branch || null); }} branched />
          </div>
          <div>
            <Label className="text-xs">PO No</Label>
            <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-..." />
          </div>
          <div>
            <Label className="text-xs">PO Date</Label>
            <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Billing Address</Label>
            <Textarea rows={2} value={billing} onChange={(e) => setBilling(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Shipping Address</Label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={sameAsBilling} onChange={(e) => setSameAsBilling(e.target.checked)} />
                Same as Billing
              </label>
            </div>
            <Textarea rows={2} value={shipping} disabled={sameAsBilling} onChange={(e) => setShipping(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems((a) => [...a, emptyProformaItem()])}><Plus className="h-4 w-4 mr-1" />Add row</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-2 text-left w-8">#</th>
                  <th className="p-2 text-left min-w-[220px]">Description</th>
                  <th className="p-2 text-left w-24">HSN</th>
                  <th className="p-2 text-right w-20">Qty</th>
                  <th className="p-2 text-right w-28">Rate</th>
                  <th className="p-2 text-right w-20">Disc %</th>
                  <th className="p-2 text-right w-20">GST %</th>
                  <th className="p-2 text-right w-28">Amount</th>
                  <th className="p-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t align-top">
                    <td className="p-2 text-xs">{idx + 1}</td>
                    <td className="p-2">
                      <ProductMasterPicker
                        value={it.product_id}
                        onPick={(p) => setItem(idx, {
                          product_id: p.id,
                          description: productShortName(p),
                          hsn: (p as any).hsn || it.hsn,
                          rate: (p as any).default_price != null ? Number((p as any).default_price) : it.rate,
                          gst_rate: 18,
                        })}
                      />
                      <Input className="h-7 text-xs mt-1" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} placeholder="Description" />
                    </td>
                    <td className="p-2"><Input className="h-7 text-xs font-mono" value={it.hsn || ""} onChange={(e) => setItem(idx, { hsn: e.target.value })} /></td>
                    <td className="p-2"><Input type="number" step="0.001" className="h-7 text-xs text-right" value={it.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} /></td>
                    <td className="p-2"><Input type="number" step="0.01" className="h-7 text-xs text-right" value={it.rate} onChange={(e) => setItem(idx, { rate: Number(e.target.value) })} /></td>
                    <td className="p-2"><Input type="number" className="h-7 text-xs text-right" value={it.discount_pct} onChange={(e) => setItem(idx, { discount_pct: Number(e.target.value) })} /></td>
                    <td className="p-2"><Input type="number" className="h-7 text-xs text-right" value={it.gst_rate} onChange={(e) => setItem(idx, { gst_rate: Number(e.target.value) })} /></td>
                    <td className="p-2 text-right tabular-nums text-xs font-medium">{inr((Number(it.qty) || 0) * (Number(it.rate) || 0))}</td>
                    <td className="p-2 text-right">
                      <Button size="icon" variant="ghost" onClick={() => setItems((a) => a.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totals && (
            <div className="flex justify-end gap-6 border-t p-3 text-sm">
              <span>Subtotal {inr(totals.subtotal)}</span>
              <span className="font-semibold">Total {inr(totals.total)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Notes &amp; Terms</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label className="text-xs">Notes</Label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div><Label className="text-xs">Terms</Label><Textarea rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
        </CardContent>
      </Card>
    </div>
  );
}
