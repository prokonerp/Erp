import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FileText, Receipt, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchSalesOrder, SO_STATUSES, soStatusMeta, type SalesOrder, type SoStatus } from "@/lib/salesOrders";
import { inr } from "@/lib/sales";
import { createChallanFromSalesOrder, createInvoiceFromSalesOrder } from "@/lib/documentFlow.writers";
import { getDocumentHeader } from "@/lib/letterhead";
import type { CompanyProfile } from "@/lib/companyProfile";

export const Route = createFileRoute("/_app/sales/orders/$id")({ component: SalesOrderDetail });

function SalesOrderDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [so, setSo] = useState<SalesOrder | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => fetchSalesOrder(id).then(setSo).catch((e) => toast.error(e.message));
  useEffect(() => { load(); getDocumentHeader().then(setCompany).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!so || !company) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const st = soStatusMeta(so.status);
  console.log("HEADER DATA:", company);

  const setStatus = async (s: SoStatus) => {
    const { error } = await supabase.from("sales_orders" as never).update({ status: s } as never).eq("id", id);
    if (error) return toast.error(error.message);
    setSo({ ...so, status: s });
    toast.success("Status updated");
  };

  const toDc = async () => {
    setBusy(true);
    try {
      const r = await createChallanFromSalesOrder(so);
      toast.success(`Delivery Challan ${r.challan_no || ""} created`);
      nav({ to: "/challan/$id", params: { id: r.id } });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const toInvoice = async () => {
    setBusy(true);
    try {
      const r = await createInvoiceFromSalesOrder(so);
      toast.success(`Invoice ${r.invoice_no || ""} created`);
      nav({ to: "/sales/invoices/$id", params: { id: r.id } });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link to="/sales/orders"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
        <div className="flex gap-2 flex-wrap items-center">
          <Badge variant="outline" className={st.tone}>{st.label}</Badge>
          <Select value={so.status} onValueChange={(v) => setStatus(v as SoStatus)}>
            <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{SO_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          {so.linked_quote_id && (
            <Link to="/crm/quotations/$id" params={{ id: so.linked_quote_id }}>
              <Button variant="outline" size="sm"><FileText className="h-4 w-4 mr-1" />Source Quote</Button>
            </Link>
          )}
          <Button size="sm" variant="outline" onClick={toDc} disabled={busy}><Truck className="h-4 w-4 mr-1" />Create Delivery Challan</Button>
          <Button size="sm" onClick={toInvoice} disabled={busy}><Receipt className="h-4 w-4 mr-1" />Convert to Invoice</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-mono">{so.so_no || "(unsaved)"}</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Seller</div>
            <div className="font-medium">{company.name}</div>
            <div className="text-muted-foreground whitespace-pre-line">{company.regd_address}</div>
            {company.gstin && <div className="font-mono text-xs mt-1">GSTIN: {company.gstin}</div>}
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Buyer</div>
            <div className="font-medium">{so.buyer_name || "—"}</div>
            <div className="text-muted-foreground whitespace-pre-line">{so.billing_address}</div>
            {so.buyer_gstin && <div className="font-mono text-xs mt-1">GSTIN: {so.buyer_gstin}</div>}
          </div>
          <div className="space-y-1">
            <div><span className="text-muted-foreground">SO Date:</span> {so.so_date}</div>
            {so.expected_delivery && <div><span className="text-muted-foreground">Delivery:</span> {so.expected_delivery}</div>}
            {so.po_number && <div><span className="text-muted-foreground">PO:</span> {so.po_number} {so.po_date && `(${so.po_date})`}</div>}
            {so.salesperson && <div><span className="text-muted-foreground">Salesperson:</span> {so.salesperson}</div>}
            {so.payment_terms && <div><span className="text-muted-foreground">Payment:</span> {so.payment_terms}</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="text-left p-2 w-8">#</th>
                <th className="text-left p-2">Description</th>
                <th className="text-left p-2">HSN</th>
                <th className="text-right p-2">Qty</th>
                <th className="text-right p-2">Rate</th>
                <th className="text-right p-2">Disc %</th>
                <th className="text-right p-2">GST %</th>
                <th className="text-right p-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {so.items.map((it, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{i + 1}</td>
                  <td className="p-2">{it.description}</td>
                  <td className="p-2 font-mono">{it.hsn || "—"}</td>
                  <td className="p-2 text-right">{it.qty} {it.unit}</td>
                  <td className="p-2 text-right">{inr(it.rate)}</td>
                  <td className="p-2 text-right">{it.discount_pct}%</td>
                  <td className="p-2 text-right">{it.gst_rate}%</td>
                  <td className="p-2 text-right font-medium">{inr(it.line_total ?? 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30">
              <tr><td colSpan={7} className="p-2 text-right text-muted-foreground">Subtotal</td><td className="p-2 text-right">{inr(so.subtotal)}</td></tr>
              {so.cgst > 0 && <tr><td colSpan={7} className="p-2 text-right text-muted-foreground">CGST</td><td className="p-2 text-right">{inr(so.cgst)}</td></tr>}
              {so.sgst > 0 && <tr><td colSpan={7} className="p-2 text-right text-muted-foreground">SGST</td><td className="p-2 text-right">{inr(so.sgst)}</td></tr>}
              {so.igst > 0 && <tr><td colSpan={7} className="p-2 text-right text-muted-foreground">IGST</td><td className="p-2 text-right">{inr(so.igst)}</td></tr>}
              {so.round_off !== 0 && <tr><td colSpan={7} className="p-2 text-right text-muted-foreground">Round Off</td><td className="p-2 text-right">{inr(so.round_off)}</td></tr>}
              <tr className="font-semibold"><td colSpan={7} className="p-2 text-right">Total</td><td className="p-2 text-right">{inr(so.total)}</td></tr>
            </tfoot>
          </table>
          {so.total_in_words && <div className="text-xs italic text-muted-foreground mt-2">Rupees {so.total_in_words}</div>}
        </CardContent>
      </Card>

      {(so.terms || so.notes) && (
        <Card>
          <CardContent className="pt-4 grid md:grid-cols-2 gap-4 text-sm">
            {so.terms && <div><div className="font-medium mb-1">Terms</div><div className="whitespace-pre-line text-muted-foreground">{so.terms}</div></div>}
            {so.notes && <div><div className="font-medium mb-1">Notes</div><div className="whitespace-pre-line text-muted-foreground">{so.notes}</div></div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}