import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Trash2, Save, Send, ClipboardPaste, AlertTriangle, PackageCheck, PackageX } from "lucide-react";
import { toast } from "sonner";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductPicker } from "@/components/ProductPicker";
import type { ProductMaster } from "@/components/ProductPicker";
import { fetchBranches, type BranchRow } from "@/lib/sales";
import {
  type Customer, type QuoteItem,
  fmtMoney, computeQuoteTotals, lineAmount, INDIAN_STATES,
} from "@/lib/crm";
import { getCurrentUserName } from "@/lib/currentUser";

export const Route = createFileRoute("/_app/crm/quotations/new")({
  component: NewQuotation,
  head: () => ({
    meta: [
      { title: "New Quotation · Prokon ERP" },
      { name: "description", content: "Create a new GST-compliant quotation with smart auto-fill, item search and instant totals." },
    ],
  }),
});

const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const emptyRow = (): QuoteItem => ({ description: "", qty: 1, unit: "Nos", rate: 0, discount_percent: 0, tax_percent: 18, amount: 0 });

type StockRow = { product_id: string | null; quantity: number; warehouse: string | null };

function NewQuotation() {
  const nav = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [salesperson, setSalesperson] = useState("");
  const [subject, setSubject] = useState("");
  const [refNo, setRefNo] = useState("");
  const [quoteDate, setQuoteDate] = useState(todayIso());
  const [expiryDate, setExpiryDate] = useState(addDays(7));
  const [validityDays, setValidityDays] = useState(7);
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [billing, setBilling] = useState("");
  const [shipping, setShipping] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTimeline, setDeliveryTimeline] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([emptyRow()]);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [shippingCharges, setShippingCharges] = useState(0);
  const [adjustment, setAdjustment] = useState(0);
  const [tcsPercent, setTcsPercent] = useState(0);
  const [roundOff, setRoundOff] = useState(0);
  const [businessState, setBusinessState] = useState("Haryana");
  const [notes, setNotes] = useState("Thanks for your business.");
  const [terms, setTerms] = useState("");
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [stockByProduct, setStockByProduct] = useState<Record<string, StockRow[]>>({});
  const savedOnceRef = useRef(false);

  // Load once — customers/products are cached inside pickers. We load branches,
  // CRM settings (business state + default terms) and a stock aggregate here.
  useEffect(() => {
    fetchBranches().then((bs) => {
      setBranches(bs);
      const def = bs.find((b) => b.is_default) || bs[0];
      if (def) setBranchId(def.id);
    }).catch(() => {});

    supabase.from("crm_settings").select("*").eq("id", 1).maybeSingle().then(({ data }) => {
      const s = data as { business_state?: string; default_terms?: string; default_customer_notes?: string } | null;
      if (s?.business_state) setBusinessState(s.business_state);
      if (s?.default_terms) setTerms(s.default_terms);
      if (s?.default_customer_notes) setNotes(s.default_customer_notes);
    });

    supabase.from("inventory").select("product_id,quantity,warehouse").then(({ data }) => {
      const grouped: Record<string, StockRow[]> = {};
      (data as StockRow[] | null || []).forEach((r) => {
        if (!r.product_id) return;
        (grouped[r.product_id] ||= []).push(r);
      });
      setStockByProduct(grouped);
    });

    getCurrentUserName().then((n) => n && setSalesperson((s) => s || n));
  }, []);

  const totals = useMemo(() => computeQuoteTotals({
    items, discount_amount: discountAmount, shipping_charges: shippingCharges,
    adjustment, tcs_percent: tcsPercent, round_off: roundOff,
    place_of_supply: placeOfSupply, business_state: businessState,
  }), [items, discountAmount, shippingCharges, adjustment, tcsPercent, roundOff, placeOfSupply, businessState]);

  const stockFor = (productId?: string | null) => {
    if (!productId) return null;
    const rows = stockByProduct[productId] || [];
    const total = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const top = [...rows].sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))[0];
    return { total, warehouse: top?.warehouse || null };
  };

  const setItem = (i: number, patch: Partial<QuoteItem>) => {
    setItems((prev) => {
      const next = [...prev];
      const merged = { ...next[i], ...patch };
      merged.amount = lineAmount(merged);
      next[i] = merged;
      return next;
    });
  };
  const addRow = () => setItems((p) => [...p, emptyRow()]);
  const delRow = (i: number) => setItems((p) => p.length <= 1 ? [emptyRow()] : p.filter((_, x) => x !== i));
  const pickProduct = (i: number, id: string | null, p: ProductMaster | null) => {
    setItem(i, {
      product_id: id || undefined,
      product_name: p?.name || undefined,
      description: p?.name || items[i]?.description || "",
      hsn: p?.hsn || items[i]?.hsn,
      unit: p?.unit || items[i]?.unit || "Nos",
      rate: p?.default_price != null ? Number(p.default_price) : items[i]?.rate || 0,
    });
  };

  const applyQuickDiscount = (pct: number) => {
    setItems((p) => p.map((r) => ({ ...r, discount_percent: pct, amount: lineAmount({ ...r, discount_percent: pct }) })));
    toast.success(`Applied ${pct}% discount to all lines`);
  };

  const doPaste = () => {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { setPasteOpen(false); return; }
    const parsed: QuoteItem[] = lines.map((l) => {
      const parts = l.split(/\t|,\s*/);
      const [desc, qty, rate, disc, tax] = parts;
      return {
        description: (desc || "").trim(),
        qty: Number(qty) || 1,
        unit: "Nos",
        rate: Number(rate) || 0,
        discount_percent: Number(disc) || 0,
        tax_percent: Number(tax) || 18,
        amount: 0,
      };
    }).map((r) => ({ ...r, amount: lineAmount(r) }));
    // Replace initial empty row if unused
    setItems((prev) => {
      const base = prev.length === 1 && !prev[0].description && !prev[0].product_id ? [] : prev;
      return [...base, ...parsed];
    });
    setPasteText("");
    setPasteOpen(false);
    toast.success(`Added ${parsed.length} rows`);
  };

  const applyCustomer = (id: string | null, c: Customer | null) => {
    setCustomerId(id);
    setCustomer(c);
    if (!c) return;
    setBilling((v) => v || c.billing_address || c.address || "");
    setShipping((v) => v || c.shipping_address || c.billing_address || c.address || "");
    setPlaceOfSupply((v) => v || c.state || "");
    setContactName((v) => v || c.contact_name || "");
    setContactEmail((v) => v || c.email || "");
    setContactPhone((v) => v || c.phone || "");
  };

  const validate = (): string | null => {
    if (!customerId) return "Select a customer";
    const valid = items.filter((it) => (it.description || "").trim() || it.product_id);
    if (!valid.length) return "Add at least one item";
    if (valid.some((it) => Number(it.qty) <= 0)) return "Quantity must be greater than zero";
    const seen = new Set<string>();
    for (const it of valid) {
      const key = (it.product_id || it.description || "").toLowerCase();
      if (key && seen.has(key)) return `Duplicate item: ${it.description || it.product_name || key}`;
      seen.add(key);
    }
    return null;
  };

  const save = async (opts?: { andSend?: boolean }): Promise<string | null> => {
    const err = validate();
    if (err) { toast.error(err); return null; }
    if (savedOnceRef.current) return null;
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const payload: Record<string, unknown> = {
        customer_id: customerId,
        owner_id: u.user!.id,
        branch_id: branchId,
        reference_no: refNo || null,
        subject: subject || null,
        quote_date: quoteDate,
        expiry_date: expiryDate,
        validity_days: validityDays,
        salesperson: salesperson || null,
        payment_terms: paymentTerms || null,
        delivery_timeline: deliveryTimeline || null,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        contact_phone: contactPhone || null,
        billing_address: billing || null,
        shipping_address: shipping || null,
        place_of_supply: placeOfSupply || null,
        items: items.filter((it) => (it.description || "").trim() || it.product_id) as unknown,
        discount_amount: discountAmount,
        shipping_charges: shippingCharges,
        adjustment,
        tcs_percent: tcsPercent,
        round_off: roundOff,
        subtotal: totals.subtotal,
        gst_percent: 18,
        gst_amount: totals.total_tax,
        cgst_amount: totals.cgst_amount,
        sgst_amount: totals.sgst_amount,
        igst_amount: totals.igst_amount,
        tcs_amount: totals.tcs_amount,
        total: totals.total,
        status: opts?.andSend ? "sent" : "draft",
        terms: terms || null,
        customer_notes: notes || null,
      };
      const { data, error } = await supabase.from("quotations").insert(payload as never).select().single();
      if (error) { toast.error(error.message); return null; }
      savedOnceRef.current = true;
      const newId = (data as { id: string }).id;
      toast.success(opts?.andSend ? "Quotation saved & marked sent" : "Draft saved");
      return newId;
    } finally {
      setSaving(false);
    }
  };

  const onSaveDraft = async () => { const id = await save(); if (id) nav({ to: "/crm/quotations/$id", params: { id } }); };
  const onSaveSend = async () => { const id = await save({ andSend: true }); if (id) nav({ to: "/crm/quotations/$id", params: { id } }); };

  const rowKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      if (i === items.length - 1) addRow();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to="/crm/quotations"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
          <h1 className="text-lg font-semibold">New Quotation</h1>
          <Badge variant="outline" className="text-xs">Quote # auto-generated on save</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => nav({ to: "/crm/quotations" })}>Cancel</Button>
          <Button variant="outline" size="sm" onClick={onSaveDraft} disabled={saving}><Save className="h-4 w-4 mr-1" />Save Draft</Button>
          <Button size="sm" onClick={onSaveSend} disabled={saving}><Send className="h-4 w-4 mr-1" />Save & Send</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        {/* Customer Info */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Customer Info</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div>
              <Label className="text-xs">Customer *</Label>
              <CustomerPicker value={customerId} onChange={applyCustomer} required />
            </div>
            {customer && (
              <div className="text-[11px] text-muted-foreground space-y-0.5">
                {customer.gst && <div>GSTIN: <span className="font-mono">{customer.gst}</span></div>}
                {customer.state && <div>State: {customer.state}</div>}
                {customer.phone && <div>{customer.phone}</div>}
                {customer.email && <div>{customer.email}</div>}
              </div>
            )}
            <div>
              <Label className="text-xs">Contact person</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Email</Label><Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="h-8 text-sm" /></div>
              <div><Label className="text-xs">Phone</Label><Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="h-8 text-sm" /></div>
            </div>
            <div>
              <Label className="text-xs">Billing address</Label>
              <Textarea rows={2} value={billing} onChange={(e) => setBilling(e.target.value)} className="text-sm" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Shipping address</Label>
                <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setShipping(billing)}>Same as billing</button>
              </div>
              <Textarea rows={2} value={shipping} onChange={(e) => setShipping(e.target.value)} className="text-sm" />
            </div>
          </CardContent>
        </Card>

        {/* Quote Info */}
        <Card className="lg:col-span-2">
          <CardHeader className="py-3"><CardTitle className="text-sm">Quote Info</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Supply From Warehouse</Label>
              <Select value={branchId || ""} onValueChange={setBranchId}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Salesperson</Label><Input value={salesperson} onChange={(e) => setSalesperson(e.target.value)} className="h-8 text-sm" /></div>
            <div><Label className="text-xs">Reference #</Label><Input value={refNo} onChange={(e) => setRefNo(e.target.value)} className="h-8 text-sm" /></div>
            <div>
              <Label className="text-xs">Quote date</Label>
              <Input type="date" value={quoteDate} onChange={(e) => { setQuoteDate(e.target.value); }} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Validity (days)</Label>
              <Input type="number" value={validityDays} onChange={(e) => { const n = Number(e.target.value) || 0; setValidityDays(n); setExpiryDate(new Date(new Date(quoteDate).getTime() + n * 86400000).toISOString().slice(0, 10)); }} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Expiry date</Label>
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="md:col-span-2"><Label className="text-xs">Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What is this quote for?" className="h-8 text-sm" /></div>
            <div>
              <Label className="text-xs">Place of supply</Label>
              <Select value={placeOfSupply} onValueChange={setPlaceOfSupply}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="State" /></SelectTrigger>
                <SelectContent>{INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {(placeOfSupply || "").toLowerCase() === businessState.toLowerCase() ? "CGST + SGST" : "IGST"}
              </div>
            </div>
            <div><Label className="text-xs">Payment terms</Label><Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="50% advance…" className="h-8 text-sm" /></div>
            <div><Label className="text-xs">Delivery timeline</Label><Input value={deliveryTimeline} onChange={(e) => setDeliveryTimeline(e.target.value)} placeholder="2–3 weeks from PO" className="h-8 text-sm" /></div>
          </CardContent>
        </Card>
      </div>

      {/* Item Table */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Items</CardTitle>
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-muted-foreground">Quick disc:</span>
              {[5, 10, 15].map((p) => (
                <Button key={p} size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => applyQuickDiscount(p)}>{p}%</Button>
              ))}
            </div>
            <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-7"><ClipboardPaste className="h-3.5 w-3.5 mr-1" />Bulk paste</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Paste items (Excel format)</DialogTitle></DialogHeader>
                <div className="text-xs text-muted-foreground">One row per line, tabs or commas: <span className="font-mono">Description, Qty, Rate, Disc%, Tax%</span></div>
                <Textarea rows={8} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"APC Smart-UPS 1000VA\t1\t18500\t0\t18\nAPC Battery Pack\t2\t4200\t5\t18"} className="font-mono text-xs" />
                <DialogFooter><Button onClick={doPaste}>Add rows</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <Button size="sm" onClick={addRow} className="h-7"><Plus className="h-3.5 w-3.5 mr-1" />Add row</Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2 w-8">#</th>
                <th className="p-2 min-w-[260px]">Item</th>
                <th className="p-2 w-20">HSN</th>
                <th className="p-2 w-20 text-right">Qty</th>
                <th className="p-2 w-20">Unit</th>
                <th className="p-2 w-28 text-right">Rate</th>
                <th className="p-2 w-20 text-right">Disc %</th>
                <th className="p-2 w-20 text-right">Tax %</th>
                <th className="p-2 w-28 text-right">Amount</th>
                <th className="p-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const st = stockFor(it.product_id);
                const low = st && st.total > 0 && st.total < Number(it.qty || 0);
                const oos = st && st.total <= 0 && !!it.product_id;
                return (
                  <tr key={i} className="border-b align-top" onKeyDown={(e) => rowKeyDown(e, i)}>
                    <td className="p-1 text-muted-foreground">{i + 1}</td>
                    <td className="p-1">
                      <ProductPicker value={it.product_id || null} onChange={(id, p) => pickProduct(i, id, p)} />
                      <Input value={it.description || ""} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Description" className="h-7 text-xs mt-1" />
                      {st && (
                        <div className={`text-[10px] mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${oos ? "bg-red-100 text-red-700" : low ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
                          {oos ? <PackageX className="h-3 w-3" /> : low ? <AlertTriangle className="h-3 w-3" /> : <PackageCheck className="h-3 w-3" />}
                          Stock: {st.total} {st.warehouse ? `(${st.warehouse})` : ""}
                        </div>
                      )}
                    </td>
                    <td className="p-1"><Input value={it.hsn || ""} onChange={(e) => setItem(i, { hsn: e.target.value })} className="h-7 text-xs" /></td>
                    <td className="p-1"><Input type="number" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} className="h-7 text-xs text-right" /></td>
                    <td className="p-1"><Input value={it.unit || ""} onChange={(e) => setItem(i, { unit: e.target.value })} className="h-7 text-xs" /></td>
                    <td className="p-1"><Input type="number" value={it.rate} onChange={(e) => setItem(i, { rate: Number(e.target.value) })} className="h-7 text-xs text-right" /></td>
                    <td className="p-1"><Input type="number" value={it.discount_percent || 0} onChange={(e) => setItem(i, { discount_percent: Number(e.target.value) })} className="h-7 text-xs text-right" /></td>
                    <td className="p-1"><Input type="number" value={it.tax_percent ?? 18} onChange={(e) => setItem(i, { tax_percent: Number(e.target.value) })} className="h-7 text-xs text-right" /></td>
                    <td className="p-1 text-right font-medium">{fmtMoney(it.amount)}</td>
                    <td className="p-1"><Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => delRow(i)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="text-[11px] text-muted-foreground mt-2">Press <kbd className="border rounded px-1">Enter</kbd> on the last row to add a new line. Use <kbd className="border rounded px-1">Tab</kbd> to move between fields.</div>
        </CardContent>
      </Card>

      {/* Totals + Notes */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Notes & Terms</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div><Label className="text-xs">Customer notes (printed)</Label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="text-sm" /></div>
            <div><Label className="text-xs">Terms & conditions</Label><Textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} className="text-sm" /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Totals & Charges</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-2 items-center"><Label className="text-xs">Discount (₹)</Label><Input type="number" value={discountAmount} onChange={(e) => setDiscountAmount(Number(e.target.value))} className="h-8 text-sm" /></div>
              <div className="grid grid-cols-2 gap-2 items-center"><Label className="text-xs">Shipping (₹)</Label><Input type="number" value={shippingCharges} onChange={(e) => setShippingCharges(Number(e.target.value))} className="h-8 text-sm" /></div>
              <div className="grid grid-cols-2 gap-2 items-center"><Label className="text-xs">Adjustment (₹)</Label><Input type="number" value={adjustment} onChange={(e) => setAdjustment(Number(e.target.value))} className="h-8 text-sm" /></div>
              <div className="grid grid-cols-2 gap-2 items-center"><Label className="text-xs">TCS %</Label><Input type="number" value={tcsPercent} onChange={(e) => setTcsPercent(Number(e.target.value))} className="h-8 text-sm" /></div>
              <div className="grid grid-cols-2 gap-2 items-center"><Label className="text-xs">Round-off</Label><Input type="number" value={roundOff} onChange={(e) => setRoundOff(Number(e.target.value))} className="h-8 text-sm" /></div>
            </div>
            <div className="border rounded-md p-3 text-sm space-y-1 bg-muted/30">
              <div className="flex justify-between"><span>Subtotal</span><span>{fmtMoney(totals.subtotal)}</span></div>
              {discountAmount > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><span>− {fmtMoney(discountAmount)}</span></div>}
              {shippingCharges > 0 && <div className="flex justify-between"><span>Shipping</span><span>{fmtMoney(shippingCharges)}</span></div>}
              {adjustment !== 0 && <div className="flex justify-between"><span>Adjustment</span><span>{fmtMoney(adjustment)}</span></div>}
              {totals.cgst_amount > 0 && <div className="flex justify-between"><span>CGST</span><span>{fmtMoney(totals.cgst_amount)}</span></div>}
              {totals.sgst_amount > 0 && <div className="flex justify-between"><span>SGST</span><span>{fmtMoney(totals.sgst_amount)}</span></div>}
              {totals.igst_amount > 0 && <div className="flex justify-between"><span>IGST</span><span>{fmtMoney(totals.igst_amount)}</span></div>}
              {totals.tcs_amount > 0 && <div className="flex justify-between"><span>TCS ({tcsPercent}%)</span><span>{fmtMoney(totals.tcs_amount)}</span></div>}
              {roundOff !== 0 && <div className="flex justify-between"><span>Round-off</span><span>{fmtMoney(roundOff)}</span></div>}
              <div className="flex justify-between border-t pt-1 mt-1 font-bold text-base"><span>Total</span><span>{fmtMoney(totals.total)}</span></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end gap-2 sticky bottom-0 bg-background/95 backdrop-blur border-t py-2">
        <Button variant="outline" size="sm" onClick={() => nav({ to: "/crm/quotations" })}>Cancel</Button>
        <Button variant="outline" size="sm" onClick={onSaveDraft} disabled={saving}><Save className="h-4 w-4 mr-1" />Save Draft</Button>
        <Button size="sm" onClick={onSaveSend} disabled={saving}><Send className="h-4 w-4 mr-1" />Save & Send</Button>
      </div>
    </div>
  );
}