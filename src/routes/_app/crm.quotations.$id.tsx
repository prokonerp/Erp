import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Save, Plus, Trash2, Printer, Mail, MessageCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import { ProductPicker } from "@/components/ProductPicker";
import { UpsSmartPanel } from "@/components/UpsSmartPanel";
import { waOpen } from "@/lib/tickets";
import {
  type Quotation, type QuoteItem, type Customer, type QuoteTermsTemplate, type CrmSettings, type QuoteStatus,
  fmtMoney, fmtDate, quoteStatusClass, computeQuoteTotals, lineAmount, lineTax, amountInWords, INDIAN_STATES,
} from "@/lib/crm";

export const Route = createFileRoute("/_app/crm/quotations/$id")({ component: QuoteEditor });

function QuoteEditor() {
  const { id } = Route.useParams();
  const [q, setQ] = useState<Quotation | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [templates, setTemplates] = useState<QuoteTermsTemplate[]>([]);
  const [settings, setSettings] = useState<CrmSettings | null>(null);

  const load = async () => {
    const { data } = await supabase.from("quotations").select("*").eq("id", id).single();
    if (!data) return;
    const quote = data as unknown as Quotation;
    quote.items = Array.isArray(quote.items) ? quote.items : [];
    setQ(quote);
    if (quote.customer_id) {
      const { data: c } = await supabase.from("customers").select("*").eq("id", quote.customer_id).single();
      setCustomer((c as unknown as Customer) || null);
    }
  };
  useEffect(() => {
    load();
    supabase.from("quote_terms_templates").select("*").order("sort_order").then(({ data }) => setTemplates((data || []) as any));
    supabase.from("crm_settings").select("*").eq("id", 1).single().then(({ data }) => setSettings((data as any) || { id: 1, business_state: "Haryana", business_gstin: null, default_terms: "", default_customer_notes: "Thanks for your business." }));
  }, [id]);

  const totals = useMemo(() => {
    if (!q || !settings) return { subtotal: 0, total_tax: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tcs_amount: 0, total: 0 };
    return computeQuoteTotals({
      items: q.items,
      discount_amount: q.discount_amount || 0,
      shipping_charges: q.shipping_charges || 0,
      adjustment: q.adjustment || 0,
      tcs_percent: q.tcs_percent || 0,
      round_off: q.round_off || 0,
      place_of_supply: q.place_of_supply,
      business_state: settings.business_state,
    });
  }, [q, settings]);

  const setItem = (idx: number, patch: Partial<QuoteItem>) => {
    if (!q) return;
    const items = [...q.items];
    const cur = { ...items[idx], ...patch };
    cur.amount = lineAmount(cur);
    items[idx] = cur;
    setQ({ ...q, items });
  };
  const addItem = () => q && setQ({ ...q, items: [...q.items, { description: "", qty: 1, unit: "Nos", rate: 0, discount_percent: 0, tax_percent: 18, amount: 0 }] });
  const addItems = (rows: QuoteItem[]) => {
    if (!q) return;
    const next = rows.map((r) => ({ ...r, amount: lineAmount(r) }));
    setQ({ ...q, items: [...q.items, ...next] });
  };
  const delItem = (i: number) => q && setQ({ ...q, items: q.items.filter((_, x) => x !== i) });

  const applyTemplate = (tplId: string) => {
    const t = templates.find((x) => x.id === tplId);
    if (t && q) setQ({ ...q, terms: t.body });
  };

  const save = async () => {
    if (!q) return;
    const { error } = await supabase.from("quotations").update({
      reference_no: q.reference_no, subject: q.subject,
      quote_date: q.quote_date, expiry_date: q.expiry_date, validity_days: q.validity_days,
      salesperson: q.salesperson, project_name: q.project_name,
      billing_address: q.billing_address, shipping_address: q.shipping_address,
      place_of_supply: q.place_of_supply,
      items: q.items as any,
      discount_amount: q.discount_amount || 0,
      shipping_charges: q.shipping_charges || 0,
      adjustment: q.adjustment || 0,
      tcs_percent: q.tcs_percent || 0,
      round_off: q.round_off || 0,
      subtotal: totals.subtotal,
      gst_percent: q.gst_percent,
      gst_amount: totals.total_tax,
      cgst_amount: totals.cgst_amount,
      sgst_amount: totals.sgst_amount,
      igst_amount: totals.igst_amount,
      tcs_amount: totals.tcs_amount,
      total: totals.total,
      status: q.status,
      terms: q.terms,
      customer_notes: q.customer_notes,
      remarks: q.remarks,
    } as any).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    load();
  };

  const setStatus = async (s: QuoteStatus) => {
    if (!q) return;
    setQ({ ...q, status: s });
    await supabase.from("quotations").update({ status: s } as any).eq("id", id);
    toast.success("Status: " + s);
  };

  const sendEmail = () => {
    if (!customer?.email) return toast.error("No customer email");
    const sub = encodeURIComponent(`Quotation ${q!.quote_no} - ${q!.subject || "Prokon Hi-Tech Systems"}`);
    const body = encodeURIComponent(
      `Dear ${customer.contact_name || customer.company} Team,\n\nPlease find our quotation ${q!.quote_no} dated ${fmtDate(q!.quote_date)} for your kind consideration. Total value: ${fmtMoney(totals.total)} (valid till ${fmtDate(q!.expiry_date)}).\n\nLooking forward to your confirmation.\n\nRegards,\nProkon Hi-Tech Systems\nAuthorized APC Channel Partner`
    );
    window.open(`mailto:${customer.email}?subject=${sub}&body=${body}`);
  };
  const sendWA = async () => {
    if (!customer?.phone) return toast.error("No customer phone");
    const text = `Hi ${customer.contact_name || customer.company}, sharing our quotation ${q!.quote_no} (${fmtMoney(totals.total)}, valid till ${fmtDate(q!.expiry_date)}). Please confirm. — Prokon Hi-Tech Systems`;
    const ok = await waOpen(customer.phone, text);
    if (!ok) return toast.error("Valid mobile number is required before sending WhatsApp message.");
    toast.success("Opening WhatsApp…");
  };

  if (!q || !settings) return <div className="text-muted-foreground">Loading…</div>;

  const STATUSES: QuoteStatus[] = ["draft", "sent", "accepted", "declined", "expired", "invoiced"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden flex-wrap gap-2">
        <Link to="/crm/quotations"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className={quoteStatusClass[q.status]}>{q.status}</Badge>
          <Select value={q.status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={sendEmail}><Mail className="h-4 w-4 mr-1" />Email</Button>
          <Button size="sm" variant="outline" onClick={sendWA}><MessageCircle className="h-4 w-4 mr-1" />WhatsApp</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print / PDF</Button>
          <Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" />Save</Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-base">{q.quote_no}</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          <div><Label>Reference #</Label><Input value={q.reference_no || ""} onChange={(e) => setQ({ ...q, reference_no: e.target.value })} /></div>
          <div><Label>Quote date</Label><Input type="date" value={q.quote_date} onChange={(e) => setQ({ ...q, quote_date: e.target.value })} /></div>
          <div><Label>Expiry date</Label><Input type="date" value={q.expiry_date || ""} onChange={(e) => setQ({ ...q, expiry_date: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>Subject</Label><Input value={q.subject || ""} onChange={(e) => setQ({ ...q, subject: e.target.value })} placeholder="Let your customer know what this quote is for" /></div>
          <div><Label>Salesperson</Label><Input value={q.salesperson || ""} onChange={(e) => setQ({ ...q, salesperson: e.target.value })} /></div>
          <div><Label>Project name</Label><Input value={q.project_name || ""} onChange={(e) => setQ({ ...q, project_name: e.target.value })} /></div>
          <div>
            <Label>Place of supply</Label>
            <Select value={q.place_of_supply || ""} onValueChange={(v) => setQ({ ...q, place_of_supply: v })}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>{INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground mt-1">Business state: {settings.business_state} → {(q.place_of_supply || "").toLowerCase() === settings.business_state.toLowerCase() ? "CGST + SGST" : "IGST"}</div>
          </div>
          <div className="md:col-span-3 grid md:grid-cols-2 gap-3">
            <div><Label>Billing address</Label><Textarea rows={3} value={q.billing_address || ""} onChange={(e) => setQ({ ...q, billing_address: e.target.value })} /></div>
            <div>
              <div className="flex items-center justify-between"><Label>Shipping address</Label>
                <Button type="button" size="sm" variant="ghost" onClick={() => setQ({ ...q, shipping_address: q.billing_address || "" })}>Same as billing</Button>
              </div>
              <Textarea rows={3} value={q.shipping_address || ""} onChange={(e) => setQ({ ...q, shipping_address: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Item table</CardTitle>
          <Button size="sm" variant="outline" onClick={addItem}><Plus className="h-4 w-4 mr-1" />Add row</Button>
        </CardHeader>
        <CardContent>
          {q.items.length === 0 && <div className="text-sm text-muted-foreground">No items. Click "Add row".</div>}
          {q.items.map((it, i) => (
            <div key={i} className="border rounded-md p-3 mb-2 space-y-2">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 md:col-span-5">
                  <Label className="text-xs">Item / Description <span className="text-muted-foreground font-normal">(from Product Master)</span></Label>
                  <ProductPicker
                    value={(it as any).product_id || ""}
                    onChange={(id, p) => setItem(i, {
                      product_id: id || "",
                      description: p?.name || it.description,
                      hsn: p?.hsn || it.hsn,
                      unit: p?.unit || it.unit,
                      rate: p?.default_price != null ? Number(p.default_price) : it.rate,
                    } as Partial<QuoteItem>)}
                  />
                </div>
                <div className="col-span-3 md:col-span-1"><Label className="text-xs">HSN</Label><Input value={it.hsn || ""} onChange={(e) => setItem(i, { hsn: e.target.value })} /></div>
                <div className="col-span-3 md:col-span-1"><Label className="text-xs">Qty</Label><Input type="number" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} /></div>
                <div className="col-span-3 md:col-span-1"><Label className="text-xs">Unit</Label><Input value={it.unit || ""} onChange={(e) => setItem(i, { unit: e.target.value })} /></div>
                <div className="col-span-3 md:col-span-2"><Label className="text-xs">Rate</Label><Input type="number" value={it.rate} onChange={(e) => setItem(i, { rate: Number(e.target.value) })} /></div>
                <div className="col-span-12 md:col-span-2 text-right text-sm pb-2">
                  <div className="text-xs text-muted-foreground">Amount</div>
                  <div className="font-semibold">{fmtMoney(it.amount)}</div>
                </div>
              </div>
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-6 md:col-span-3"><Label className="text-xs">Discount %</Label><Input type="number" value={it.discount_percent || 0} onChange={(e) => setItem(i, { discount_percent: Number(e.target.value) })} /></div>
                <div className="col-span-6 md:col-span-3"><Label className="text-xs">Tax (GST) %</Label><Input type="number" value={it.tax_percent ?? 18} onChange={(e) => setItem(i, { tax_percent: Number(e.target.value) })} /></div>
                <div className="col-span-12 md:col-span-5"><Label className="text-xs">Item details / notes</Label><Input value={it.item_details || ""} onChange={(e) => setItem(i, { item_details: e.target.value })} placeholder="Extra details printed under the line" /></div>
                <div className="col-span-12 md:col-span-1 text-right"><Button size="sm" variant="ghost" onClick={() => delItem(i)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-base">Totals & charges</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">Discount (₹)</Label><Input type="number" value={q.discount_amount || 0} onChange={(e) => setQ({ ...q, discount_amount: Number(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">Shipping charges (₹)</Label><Input type="number" value={q.shipping_charges || 0} onChange={(e) => setQ({ ...q, shipping_charges: Number(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">Adjustment (₹)</Label><Input type="number" value={q.adjustment || 0} onChange={(e) => setQ({ ...q, adjustment: Number(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">TCS %</Label><Input type="number" value={q.tcs_percent || 0} onChange={(e) => setQ({ ...q, tcs_percent: Number(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">Round-off (₹)</Label><Input type="number" value={q.round_off || 0} onChange={(e) => setQ({ ...q, round_off: Number(e.target.value) })} /></div>
          </div>
          <div className="text-sm border rounded-md p-3 space-y-1">
            <div className="flex justify-between"><span>Sub Total</span><span>{fmtMoney(totals.subtotal)}</span></div>
            {(q.discount_amount || 0) > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><span>− {fmtMoney(q.discount_amount)}</span></div>}
            {(q.shipping_charges || 0) > 0 && <div className="flex justify-between"><span>Shipping</span><span>{fmtMoney(q.shipping_charges)}</span></div>}
            {(q.adjustment || 0) !== 0 && <div className="flex justify-between"><span>Adjustment</span><span>{fmtMoney(q.adjustment)}</span></div>}
            {totals.cgst_amount > 0 && <div className="flex justify-between"><span>CGST</span><span>{fmtMoney(totals.cgst_amount)}</span></div>}
            {totals.sgst_amount > 0 && <div className="flex justify-between"><span>SGST</span><span>{fmtMoney(totals.sgst_amount)}</span></div>}
            {totals.igst_amount > 0 && <div className="flex justify-between"><span>IGST</span><span>{fmtMoney(totals.igst_amount)}</span></div>}
            {totals.tcs_amount > 0 && <div className="flex justify-between"><span>TCS ({q.tcs_percent}%)</span><span>{fmtMoney(totals.tcs_amount)}</span></div>}
            {(q.round_off || 0) !== 0 && <div className="flex justify-between"><span>Round-off</span><span>{fmtMoney(q.round_off)}</span></div>}
            <div className="flex justify-between border-t pt-1 mt-1 font-bold text-base"><span>Total (₹)</span><span>{fmtMoney(totals.total)}</span></div>
          </div>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Customer notes & terms</CardTitle>
          {templates.length > 0 && (
            <Select onValueChange={applyTemplate}>
              <SelectTrigger className="w-56 h-8"><SelectValue placeholder="Apply terms template" /></SelectTrigger>
              <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}><FileText className="inline h-3 w-3 mr-1" />{t.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div><Label>Customer notes (printed)</Label><Textarea rows={5} value={q.customer_notes || ""} onChange={(e) => setQ({ ...q, customer_notes: e.target.value })} placeholder="Thanks for your business." /></div>
          <div><Label>Terms & conditions</Label><Textarea rows={5} value={q.terms || ""} onChange={(e) => setQ({ ...q, terms: e.target.value })} placeholder="Payment, delivery, warranty…" /></div>
          <div className="md:col-span-2"><Label>Internal remarks (not printed)</Label><Textarea rows={2} value={q.remarks || ""} onChange={(e) => setQ({ ...q, remarks: e.target.value })} /></div>
        </CardContent>
      </Card>

      {/* ============ ZOHO-STYLE PRINT VIEW ============ */}
      <div className="hidden print:block text-black">
        <style>{`@media print { @page { size: A4; margin: 12mm; } body { font-family: Arial, Helvetica, sans-serif; color:#000; } .zh-th{background:#374151;color:#fff;padding:6px;font-size:11px;text-align:left} .zh-td{border-bottom:1px solid #e5e7eb;padding:6px;font-size:11px;vertical-align:top} }`}</style>

        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-gray-700 pb-3 mb-4">
          <div>
            <div className="text-2xl font-bold tracking-tight">Prokon Hi-Tech Systems</div>
            <div className="text-[11px] mt-0.5">Picasso Centre, Sector-61, Gurgaon, Haryana</div>
            <div className="text-[11px]">info@prokonhitech.com · +91-9810000000</div>
            <div className="text-[11px]">GSTIN: {settings.business_gstin || "—"}</div>
            <div className="text-[11px] italic mt-1">Authorized APC by Schneider Electric Channel Partner</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-700">QUOTE</div>
            <div className="text-[11px] mt-1"># <b>{q.quote_no}</b></div>
            {q.reference_no && <div className="text-[11px]">Ref: {q.reference_no}</div>}
          </div>
        </div>

        {/* Bill / Ship + meta */}
        <div className="grid grid-cols-3 gap-4 mb-3 text-[11px]">
          <div>
            <div className="font-semibold text-gray-600 uppercase text-[10px] mb-1">Bill To</div>
            <div className="font-semibold text-sm">{customer?.company}</div>
            <div className="whitespace-pre-line">{q.billing_address || customer?.address || ""}</div>
            {customer?.gst && <div className="mt-1">GSTIN: {customer.gst}</div>}
          </div>
          <div>
            <div className="font-semibold text-gray-600 uppercase text-[10px] mb-1">Ship To</div>
            <div className="font-semibold text-sm">{customer?.company}</div>
            <div className="whitespace-pre-line">{q.shipping_address || q.billing_address || customer?.address || ""}</div>
          </div>
          <div className="text-right">
            <table className="ml-auto text-[11px]">
              <tbody>
                <tr><td className="pr-2 text-gray-600">Quote Date</td><td className="font-semibold">{fmtDate(q.quote_date)}</td></tr>
                <tr><td className="pr-2 text-gray-600">Expiry Date</td><td className="font-semibold">{fmtDate(q.expiry_date)}</td></tr>
                {q.place_of_supply && <tr><td className="pr-2 text-gray-600">Place of Supply</td><td className="font-semibold">{q.place_of_supply}</td></tr>}
                {q.salesperson && <tr><td className="pr-2 text-gray-600">Salesperson</td><td className="font-semibold">{q.salesperson}</td></tr>}
                {q.project_name && <tr><td className="pr-2 text-gray-600">Project</td><td className="font-semibold">{q.project_name}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {q.subject && <div className="text-[12px] mb-2"><b>Subject:</b> {q.subject}</div>}

        {/* Items */}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="zh-th" style={{ width: "4%" }}>#</th>
              <th className="zh-th">Item & Description</th>
              <th className="zh-th text-center" style={{ width: "8%" }}>HSN</th>
              <th className="zh-th text-right" style={{ width: "8%" }}>Qty</th>
              <th className="zh-th text-right" style={{ width: "12%" }}>Rate</th>
              <th className="zh-th text-right" style={{ width: "9%" }}>Disc%</th>
              <th className="zh-th text-right" style={{ width: "9%" }}>Tax%</th>
              <th className="zh-th text-right" style={{ width: "14%" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((it, i) => (
              <tr key={i}>
                <td className="zh-td text-center">{i + 1}</td>
                <td className="zh-td">
                  <div className="font-semibold">{it.description}</div>
                  {it.item_details && <div className="text-[10px] text-gray-600 whitespace-pre-line">{it.item_details}</div>}
                </td>
                <td className="zh-td text-center">{it.hsn || ""}</td>
                <td className="zh-td text-right">{it.qty} {it.unit || ""}</td>
                <td className="zh-td text-right">{fmtMoney(it.rate)}</td>
                <td className="zh-td text-right">{it.discount_percent || 0}%</td>
                <td className="zh-td text-right">{it.tax_percent ?? 0}%</td>
                <td className="zh-td text-right font-semibold">{fmtMoney(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals box on right */}
        <div className="grid grid-cols-2 mt-3">
          <div className="text-[11px]">
            <div className="font-semibold">Total in words:</div>
            <div className="italic">{amountInWords(totals.total)}</div>
          </div>
          <div className="text-[12px]">
            <table className="w-full">
              <tbody>
                <tr><td className="py-0.5">Sub Total</td><td className="py-0.5 text-right">{fmtMoney(totals.subtotal)}</td></tr>
                {(q.discount_amount || 0) > 0 && <tr><td className="py-0.5">Discount</td><td className="py-0.5 text-right">− {fmtMoney(q.discount_amount)}</td></tr>}
                {(q.shipping_charges || 0) > 0 && <tr><td className="py-0.5">Shipping</td><td className="py-0.5 text-right">{fmtMoney(q.shipping_charges)}</td></tr>}
                {(q.adjustment || 0) !== 0 && <tr><td className="py-0.5">Adjustment</td><td className="py-0.5 text-right">{fmtMoney(q.adjustment)}</td></tr>}
                {totals.cgst_amount > 0 && <tr><td className="py-0.5">CGST</td><td className="py-0.5 text-right">{fmtMoney(totals.cgst_amount)}</td></tr>}
                {totals.sgst_amount > 0 && <tr><td className="py-0.5">SGST</td><td className="py-0.5 text-right">{fmtMoney(totals.sgst_amount)}</td></tr>}
                {totals.igst_amount > 0 && <tr><td className="py-0.5">IGST</td><td className="py-0.5 text-right">{fmtMoney(totals.igst_amount)}</td></tr>}
                {totals.tcs_amount > 0 && <tr><td className="py-0.5">TCS ({q.tcs_percent}%)</td><td className="py-0.5 text-right">{fmtMoney(totals.tcs_amount)}</td></tr>}
                {(q.round_off || 0) !== 0 && <tr><td className="py-0.5">Round-off</td><td className="py-0.5 text-right">{fmtMoney(q.round_off)}</td></tr>}
                <tr className="border-t-2 border-gray-700"><td className="py-1 font-bold">Total</td><td className="py-1 text-right font-bold">{fmtMoney(totals.total)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {q.customer_notes && <div className="mt-5 text-[11px]"><div className="font-semibold">Notes</div><div className="whitespace-pre-line">{q.customer_notes}</div></div>}
        {q.terms && <div className="mt-3 text-[11px]"><div className="font-semibold">Terms & Conditions</div><div className="whitespace-pre-line">{q.terms}</div></div>}

        <div className="grid grid-cols-2 gap-8 mt-12 text-[11px]">
          <div className="border-t border-gray-700 pt-1 text-center">Customer Signature</div>
          <div className="border-t border-gray-700 pt-1 text-center">For Prokon Hi-Tech Systems</div>
        </div>
      </div>
    </div>
  );
}
