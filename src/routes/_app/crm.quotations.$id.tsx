import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Save, Plus, Trash2, Printer } from "lucide-react";
import { toast } from "sonner";
import { type Quotation, type QuoteItem, type Customer, fmtMoney, fmtDate } from "@/lib/crm";

export const Route = createFileRoute("/_app/crm/quotations/$id")({ component: QuoteEditor });

function QuoteEditor() {
  const { id } = Route.useParams();
  const [q, setQ] = useState<Quotation | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [productNames, setProductNames] = useState<string[]>([]);

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
  useEffect(() => { load();
    supabase.from("products").select("name").then(({ data }) => setProductNames((data || []).map((p: any) => p.name)));
  }, [id]);

  const totals = useMemo(() => {
    if (!q) return { subtotal: 0, gst_amount: 0, total: 0 };
    const subtotal = q.items.reduce((s, it) => s + Number(it.amount || 0), 0);
    const gst_amount = (subtotal * Number(q.gst_percent || 0)) / 100;
    return { subtotal, gst_amount, total: subtotal + gst_amount };
  }, [q]);

  const setItem = (idx: number, patch: Partial<QuoteItem>) => {
    if (!q) return;
    const items = [...q.items];
    const cur = { ...items[idx], ...patch };
    cur.amount = Number(cur.qty || 0) * Number(cur.rate || 0);
    items[idx] = cur;
    setQ({ ...q, items });
  };
  const addItem = () => q && setQ({ ...q, items: [...q.items, { description: "", qty: 1, unit: "Nos", rate: 0, amount: 0 }] });
  const delItem = (i: number) => q && setQ({ ...q, items: q.items.filter((_, x) => x !== i) });

  const save = async () => {
    if (!q) return;
    const { error } = await supabase.from("quotations").update({
      quote_date: q.quote_date,
      validity_days: q.validity_days,
      items: q.items as any,
      gst_percent: q.gst_percent,
      subtotal: totals.subtotal,
      gst_amount: totals.gst_amount,
      total: totals.total,
      status: q.status,
      terms: q.terms,
      remarks: q.remarks,
    } as any).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    load();
  };

  if (!q) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link to="/crm/quotations"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
        <div className="flex gap-2">
          <Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" />Save</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print</Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-base">{q.quote_no}</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-4 gap-3">
          <div><Label>Date</Label><Input type="date" value={q.quote_date} onChange={(e) => setQ({ ...q, quote_date: e.target.value })} /></div>
          <div><Label>Validity (days)</Label><Input type="number" value={q.validity_days} onChange={(e) => setQ({ ...q, validity_days: Number(e.target.value) })} /></div>
          <div><Label>GST %</Label><Input type="number" value={q.gst_percent} onChange={(e) => setQ({ ...q, gst_percent: Number(e.target.value) })} /></div>
          <div>
            <Label>Status</Label>
            <Select value={q.status} onValueChange={(v: any) => setQ({ ...q, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" variant="outline" onClick={addItem}><Plus className="h-4 w-4 mr-1" />Add line</Button>
        </CardHeader>
        <CardContent>
          <datalist id="qprods">{productNames.map((n) => <option key={n} value={n} />)}</datalist>
          {q.items.length === 0 && <div className="text-sm text-muted-foreground">No items. Click "Add line".</div>}
          {q.items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-end">
              <div className="col-span-5"><Label className="text-xs">Description</Label><Input list="qprods" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} /></div>
              <div className="col-span-1"><Label className="text-xs">HSN</Label><Input value={it.hsn || ""} onChange={(e) => setItem(i, { hsn: e.target.value })} /></div>
              <div className="col-span-1"><Label className="text-xs">Qty</Label><Input type="number" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} /></div>
              <div className="col-span-1"><Label className="text-xs">Unit</Label><Input value={it.unit || ""} onChange={(e) => setItem(i, { unit: e.target.value })} /></div>
              <div className="col-span-2"><Label className="text-xs">Rate</Label><Input type="number" value={it.rate} onChange={(e) => setItem(i, { rate: Number(e.target.value) })} /></div>
              <div className="col-span-1 text-right text-sm pb-2">{fmtMoney(it.amount)}</div>
              <div className="col-span-1 text-right"><Button size="sm" variant="ghost" onClick={() => delItem(i)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>
            </div>
          ))}
          <div className="border-t mt-3 pt-3 text-right space-y-1 text-sm">
            <div>Subtotal: <span className="font-semibold">{fmtMoney(totals.subtotal)}</span></div>
            <div>GST ({q.gst_percent}%): <span className="font-semibold">{fmtMoney(totals.gst_amount)}</span></div>
            <div className="text-base">Total: <span className="font-bold">{fmtMoney(totals.total)}</span></div>
          </div>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-base">Terms & remarks</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div><Label>Terms</Label><Textarea rows={5} value={q.terms || ""} onChange={(e) => setQ({ ...q, terms: e.target.value })} placeholder="Payment, delivery, warranty…" /></div>
          <div><Label>Remarks</Label><Textarea rows={5} value={q.remarks || ""} onChange={(e) => setQ({ ...q, remarks: e.target.value })} /></div>
        </CardContent>
      </Card>

      {/* PRINT VIEW */}
      <div className="hidden print:block text-black">
        <style>{`@media print { @page { size: A4; margin: 14mm; } body { font-family: Arial, sans-serif; } }`}</style>
        <div className="border-b-2 border-black pb-3 mb-4 flex items-center justify-between">
          <div>
            <div className="text-xl font-bold">Prokon Hi-Tech Systems</div>
            <div className="text-xs">Picasso Centre, Sector-61, Gurgaon · info@prokonhitech.com · +91-9810000000</div>
            <div className="text-xs italic">Authorized APC by Schneider Electric Channel Partner</div>
          </div>
          <div className="text-right text-xs">
            <div className="font-semibold text-base">QUOTATION</div>
            <div>No: <b>{q.quote_no}</b></div>
            <div>Date: {fmtDate(q.quote_date)}</div>
            <div>Valid: {q.validity_days} days</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase mb-1">Bill To</div>
            <div className="font-semibold">{customer?.company}</div>
            <div>{customer?.contact_name}</div>
            <div className="text-xs whitespace-pre-line">{customer?.address}</div>
            <div className="text-xs">Phone: {customer?.phone || "—"}</div>
            <div className="text-xs">Email: {customer?.email || "—"}</div>
            <div className="text-xs">GST: {customer?.gst || "—"}</div>
          </div>
        </div>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-200">
              <th className="border border-black p-1 text-left">#</th>
              <th className="border border-black p-1 text-left">Description</th>
              <th className="border border-black p-1">HSN</th>
              <th className="border border-black p-1">Qty</th>
              <th className="border border-black p-1">Unit</th>
              <th className="border border-black p-1 text-right">Rate</th>
              <th className="border border-black p-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((it, i) => (
              <tr key={i}>
                <td className="border border-black p-1">{i + 1}</td>
                <td className="border border-black p-1">{it.description}</td>
                <td className="border border-black p-1 text-center">{it.hsn || ""}</td>
                <td className="border border-black p-1 text-center">{it.qty}</td>
                <td className="border border-black p-1 text-center">{it.unit || ""}</td>
                <td className="border border-black p-1 text-right">{fmtMoney(it.rate)}</td>
                <td className="border border-black p-1 text-right">{fmtMoney(it.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={6} className="border border-black p-1 text-right">Subtotal</td><td className="border border-black p-1 text-right">{fmtMoney(totals.subtotal)}</td></tr>
            <tr><td colSpan={6} className="border border-black p-1 text-right">GST ({q.gst_percent}%)</td><td className="border border-black p-1 text-right">{fmtMoney(totals.gst_amount)}</td></tr>
            <tr className="font-bold"><td colSpan={6} className="border border-black p-1 text-right">Total</td><td className="border border-black p-1 text-right">{fmtMoney(totals.total)}</td></tr>
          </tfoot>
        </table>

        {q.terms && <div className="mt-4 text-sm"><div className="font-semibold">Terms & Conditions</div><div className="whitespace-pre-line text-xs">{q.terms}</div></div>}
        {q.remarks && <div className="mt-3 text-sm"><div className="font-semibold">Remarks</div><div className="whitespace-pre-line text-xs">{q.remarks}</div></div>}

        <div className="grid grid-cols-2 gap-4 mt-10 text-xs">
          <div className="border-t border-black pt-1 text-center">Customer Signature</div>
          <div className="border-t border-black pt-1 text-center">For Prokon Hi-Tech Systems</div>
        </div>
      </div>
    </div>
  );
}