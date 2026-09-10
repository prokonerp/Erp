// @ts-nocheck
import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";
import { fetchProforma, updateProforma, isProformaEditable, emptyProformaItem, type ProformaItem } from "@/lib/proforma";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import { computeTotals, amountInWords } from "@/lib/gst";
import { fetchBranches, inr, type BranchRow } from "@/lib/sales";
import { productShortName } from "@/lib/productNames";
import type { Customer, CustomerBranch } from "@/lib/crm";
import { branchToDocumentFields } from "@/lib/crm";

export const Route = createFileRoute("/_app/sales/proforma/$id_/edit")({
  component: EditProforma,
  head: () => ({
    meta: [
      { title: "Edit Proforma Invoice — Prokon ERP" },
      { name: "description", content: "Edit a draft proforma invoice." },
      { property: "og:title", content: "Edit Proforma Invoice — Prokon ERP" },
      { property: "og:description", content: "Edit a draft proforma invoice." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function EditProforma() {
  const { id } = useParams({ from: "/_app/sales/proforma/$id_/edit" });
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [branchOverride, setBranchOverride] = useState<CustomerBranch | null>(null);
  const [proformaDate, setProformaDate] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [billing, setBilling] = useState("");
  const [shipping, setShipping] = useState("");
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [items, setItems] = useState<ProformaItem[]>([emptyProformaItem()]);
  const [status, setStatus] = useState("draft");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchBranches().then(setBranches).catch(() => {});
    fetchProforma(id).then((row) => {
      if (!isProformaEditable(row.status)) {
        toast.error("Only Draft proformas can be edited.");
        nav({ to: "/sales/proforma/$id", params: { id } });
        return;
      }
      setBranchId(row.branch_id || "");
      setProformaDate(row.proforma_date || "");
      setPoNumber(row.po_number || "");
      setPoDate(row.po_date || "");
      setBilling(row.billing_address || "");
      setShipping(row.shipping_address || row.billing_address || "");
      setSameAsBilling(!row.shipping_address || row.shipping_address === row.billing_address);
      setNotes(row.notes || "");
      setTerms(row.terms || "");
      setItems((row.items && (row.items as ProformaItem[]).length ? row.items as ProformaItem[] : [emptyProformaItem()]));
      setStatus(row.status);
      if (row.customer_id) {
        import("@/integrations/supabase/client").then(({ supabase }) => {
          supabase.from("customers").select("*").eq("id", row.customer_id).maybeSingle().then(({ data }) => {
            if (data) setCustomer(data as unknown as Customer);
          });
        });
      }
      setLoading(false);
    }).catch((e) => { toast.error(e.message); setLoading(false); });
  }, [id]);

  useEffect(() => {
    if (!customer) return;
    // don't override if user already edited addresses manually after load — only sync on customer change when still default
  }, [customer?.id]);

  useEffect(() => {
    if (sameAsBilling) setShipping(billing);
  }, [sameAsBilling, billing]);

  const totals = useMemo(() => {
    const branch = branches.find((b) => b.id === branchId);
    const sellerCode = branch?.state_code || null;
    try {
      return computeTotals({
        sellerStateCode: sellerCode,
        buyerStateCode: null,
        items: items.map((it) => ({
          qty: Number(it.qty) || 0,
          rate: Number(it.rate) || 0,
          discount_pct: Number(it.discount_pct) || 0,
          gst_rate: Number(it.gst_rate) || 0,
          cess_rate: Number(it.cess_rate) || 0,
        })),
        roundOff: true,
      });
    } catch { return null; }
  }, [items, branchId, branches]);

  function setItem(idx: number, patch: Partial<ProformaItem>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save() {
    if (!customer) return toast.error("Choose a customer");
    if (!branchId) return toast.error("Select a branch");
    if (!totals) return toast.error("Invalid totals");
    setSaving(true);
    try {
      const branch = branches.find((b) => b.id === branchId);
      const row = await updateProforma(id, {
        proforma_date: proformaDate,
        branch_id: branchId,
        customer_id: customer.id,
        buyer_name: customer.company,
        buyer_gstin: customer.gst,
        billing_address: billing || null,
        shipping_address: shipping || null,
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
        notes: notes || null,
        terms: terms || null,
      } as any);
      toast.success(`${row.proforma_no || "Proforma"} updated`);
      nav({ to: "/sales/proforma/$id", params: { id } });
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild><Link to="/sales/proforma/$id" params={{ id }}><ArrowLeft className="h-4 w-4" /></Link></Button>
          <h1 className="text-2xl font-bold">Edit Proforma</h1>
          <span className="text-sm text-muted-foreground font-mono">{status}</span>
        </div>
        <Button size="sm" disabled={saving} onClick={save}><Save className="h-4 w-4 mr-1.5" />Save Changes</Button>
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
            <CustomerPicker value={customer?.id} branchValue={branchOverride?.id} onChange={(_id, c, branch) => { setCustomer(c); setBranchOverride(branch || null); if (branch) { const bf = branchToDocumentFields(branch); setBilling(bf.billing_address || ""); setShipping(bf.shipping_address || ""); } }} branched />
          </div>
          <div>
            <Label className="text-xs">PO No</Label>
            <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
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
                        onPick={(p) => setItem(idx, { product_id: p.id, description: productShortName(p), hsn: (p as any).hsn || it.hsn, rate: (p as any).default_price != null ? Number((p as any).default_price) : it.rate })}
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
