import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/shared/skeletons";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Printer, Download, ArrowLeft, Zap, Send, CheckCircle2, Ban, Pencil } from "lucide-react";
import { usePermissions } from "@/lib/usePermissions";
import {
  fetchPOWithItems,
  inrPO,
  poStatusMeta,
  PO_STATUSES,
  type PORow,
  type POItemRow,
  type POStatus,
} from "@/lib/purchaseOrder";
import { fetchBranches, type BranchRow } from "@/lib/sales";
import { downloadPurchaseOrderPdf, printPurchaseOrderPdf } from "@/lib/purchaseOrderPdf";
import { DocumentPrintView, type PrintDoc } from "@/components/DocumentPrintView";
import { fetchCompanyProfile, DEFAULT_COMPANY_PROFILE, type CompanyProfile } from "@/lib/companyProfile";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";

export const Route = createFileRoute("/_app/po/$id")({
  component: POView,
  head: () => ({ meta: [{ title: "Purchase Order — Prokon" }] }),
});

function POView() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const { isAdmin } = usePermissions();
  const [po, setPo] = useState<PORow | null>(null);
  const [items, setItems] = useState<POItemRow[]>([]);
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);
  const [pdfSettings, setPdfSettings] = useState<{
    company_name: string | null;
    company_address: string | null;
    udyam_no: string | null;
    phone: string | null;
    email: string | null;
  } | null>(null);
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchPOWithItems(id);
      setPo(r.po);
      setItems(r.items);
      const bs = await fetchBranches();
      setBranch(bs.find((b) => b.id === r.po.branch_id) || null);
      const { data: st } = await (supabase as any)
        .from("invoice_settings")
        .select("company_name,company_address,udyam_no,phone,email")
        .eq("branch_id", r.po.branch_id)
        .maybeSingle();
      setPdfSettings(st ? {
        company_name: st.company_name ?? null,
        company_address: st.company_address ?? null,
        udyam_no: st.udyam_no ?? null,
        phone: st.phone ?? null,
        email: st.email ?? null,
      } : null);
      try { setCompany(await fetchCompanyProfile()); } catch { /* keep default */ }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(next: POStatus) {
    if (!po) return;
    const { error } = await (supabase as any).from("purchase_orders").update({ status: next }).eq("id", po.id);
    if (error) return toast.error(error.message);
    toast.success(`Status → ${poStatusMeta(next).label}`);
    load();
  }

  async function del() {
    if (!po) return;
    setConfirmTarget({
      title: "Delete this Purchase Order?",
      description: "This cannot be undone. All line items and stock entries will be lost.",
      onConfirm: async () => {
        const { error } = await (supabase as any).from("purchase_orders").delete().eq("id", po.id);
        if (error) return toast.error(error.message);
        toast.success("Deleted");
        nav({ to: "/po" });
      },
    });
  }

  if (loading) return <PageLoader />;
  if (!po) return <div className="text-sm text-muted-foreground">PO not found.</div>;

  const sm = poStatusMeta(po.status);
  const canPrint = po.status !== "draft";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild><Link to="/po"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
          <h2 className="text-lg font-semibold font-mono">{po.po_no || po.id.slice(0, 8)}</h2>
          <StatusBadge tone={sm.badgeTone}>{sm.label}</StatusBadge>
        </div>
        <div className="flex flex-wrap gap-2">
          {po.status === "draft" && isAdmin && (
            <Button size="sm" variant="outline" asChild><Link to="/po/$id/edit" params={{ id: po.id } as any}><Pencil className="h-4 w-4 mr-1" />Edit</Link></Button>
          )}
          {po.status === "draft" && (
            <Button size="sm" onClick={() => setStatus("approved")}><Zap className="h-4 w-4 mr-1" />Approve</Button>
          )}
          {po.status === "approved" && (
            <Button size="sm" onClick={() => setStatus("sent")}><Send className="h-4 w-4 mr-1" />Mark Sent</Button>
          )}
          {(po.status === "sent" || po.status === "partial") && (
            <>
              <Button size="sm" variant="outline" onClick={() => setStatus("partial")}>Partial</Button>
              <Button size="sm" onClick={() => setStatus("completed")}><CheckCircle2 className="h-4 w-4 mr-1" />Complete</Button>
            </>
          )}
          {po.status !== "cancelled" && po.status !== "completed" && (
            <Button size="sm" variant="outline" onClick={() => setStatus("cancelled")}><Ban className="h-4 w-4 mr-1" />Cancel</Button>
          )}
          <Button size="sm" variant="outline" disabled={!canPrint} onClick={() => printPurchaseOrderPdf({ po, items, branch, settings: pdfSettings })}><Printer className="h-4 w-4 mr-1" />Print</Button>
          <Button size="sm" variant="outline" disabled={!canPrint} onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print (A4)</Button>
          <Button size="sm" variant="outline" disabled={!canPrint} onClick={() => downloadPurchaseOrderPdf({ po, items, branch, settings: pdfSettings }, `${po.po_no || "PO"}.pdf`)}><Download className="h-4 w-4 mr-1" />PDF</Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={del}>Delete</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Vendor</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="font-medium">{po.vendor_name}</div>
            {po.vendor_address && <div className="text-muted-foreground whitespace-pre-line">{po.vendor_address}</div>}
            {po.vendor_gstin && <div><span className="text-muted-foreground">GSTIN:</span> <span className="font-mono">{po.vendor_gstin}</span></div>}
            {po.vendor_state_name && <div className="text-xs"><span className="text-muted-foreground">State:</span> {po.vendor_state_name} ({po.vendor_state_code})</div>}
            {(po.vendor_contact_name || po.vendor_phone || po.vendor_email) && (
              <div className="pt-1 border-t text-xs">
                {po.vendor_contact_name} {po.vendor_phone && `· ${po.vendor_phone}`} {po.vendor_email && `· ${po.vendor_email}`}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Delivery</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>
              <span className="text-muted-foreground text-xs">Type:</span>{" "}
              <span className="font-medium">
                {po.delivery_address_type === "customer" ? "Customer Site" : po.delivery_address_type === "custom" ? "Custom" : "Organization"}
              </span>
            </div>
            {po.customer_name && <div className="text-xs"><span className="text-muted-foreground">Customer:</span> {po.customer_name}</div>}
            <div className="whitespace-pre-line text-xs">{po.delivery_address || "—"}</div>
            {po.delivery_date && <div className="text-xs pt-1 border-t"><span className="text-muted-foreground">Expected:</span> {po.delivery_date}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Summary</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">PO Date</span><span>{po.po_date}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Payment Terms</span><span>{po.payment_terms || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tax Type</span><span>{po.is_interstate ? "IGST (inter-state)" : "CGST + SGST"}</span></div>
            <div className="pt-1 border-t flex justify-between font-bold text-base"><span>Total</span><span>{inrPO(po.total)}</span></div>
            <p className="text-xs text-muted-foreground italic">{po.total_in_words}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Items <span className="text-xs font-normal text-muted-foreground">(Warranty highlighted)</span></CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2 text-left w-8">#</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-left w-24">HSN</th>
                <th className="p-2 text-right w-20">Qty</th>
                <th className="p-2 text-left w-16">Unit</th>
                <th className="p-2 text-right w-24">Rate</th>
                <th className="p-2 text-right w-20">GST%</th>
                <th className="p-2 text-center w-20">Warranty</th>
                <th className="p-2 text-right w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="p-2 text-xs">{it.sr_no}</td>
                  <td className="p-2">{it.description}</td>
                  <td className="p-2 font-mono text-xs">{it.hsn || "—"}</td>
                  <td className="p-2 text-right font-mono tabular-nums">{it.qty}</td>
                  <td className="p-2">{it.unit}</td>
                  <td className="p-2 text-right font-mono tabular-nums">{inrPO(it.rate)}</td>
                  <td className="p-2 text-right">{it.gst_rate}%</td>
                  <td className="p-2 text-center"><span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 text-xs font-semibold">{(it as any).warranty_months ?? 12} mo</span></td>
                  <td className="p-2 text-right font-medium font-mono tabular-nums">{inrPO(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/40 text-sm">
              <tr><td colSpan={8} className="p-2 text-right text-muted-foreground">Subtotal</td><td className="p-2 text-right font-mono tabular-nums">{inrPO(po.subtotal)}</td></tr>
              {po.discount > 0 && <tr><td colSpan={8} className="p-2 text-right text-muted-foreground">Discount</td><td className="p-2 text-right font-mono tabular-nums">{inrPO(po.discount)}</td></tr>}
              <tr><td colSpan={8} className="p-2 text-right text-muted-foreground">Taxable</td><td className="p-2 text-right font-mono tabular-nums">{inrPO(po.taxable_value)}</td></tr>
              {po.is_interstate ? (
                <tr><td colSpan={8} className="p-2 text-right text-muted-foreground">IGST</td><td className="p-2 text-right font-mono tabular-nums">{inrPO(po.igst)}</td></tr>
              ) : (
                <>
                  <tr><td colSpan={8} className="p-2 text-right text-muted-foreground">CGST</td><td className="p-2 text-right font-mono tabular-nums">{inrPO(po.cgst)}</td></tr>
                  <tr><td colSpan={8} className="p-2 text-right text-muted-foreground">SGST</td><td className="p-2 text-right font-mono tabular-nums">{inrPO(po.sgst)}</td></tr>
                </>
              )}
              {po.round_off !== 0 && <tr><td colSpan={8} className="p-2 text-right text-muted-foreground">Round Off</td><td className="p-2 text-right font-mono tabular-nums">{inrPO(po.round_off)}</td></tr>}
              <tr className="font-bold"><td colSpan={8} className="p-2 text-right">Grand Total</td><td className="p-2 text-right font-mono tabular-nums">{inrPO(po.total)}</td></tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {(po.notes || po.terms) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {po.notes && <Card><CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader><CardContent className="text-sm whitespace-pre-line">{po.notes}</CardContent></Card>}
          {po.terms && <Card><CardHeader className="pb-2"><CardTitle className="text-base">Terms & Conditions</CardTitle></CardHeader><CardContent className="text-sm whitespace-pre-line">{po.terms}</CardContent></Card>}
        </div>
      )}

      {/* A4 shared print template */}
      <div className="hidden print:block">
        <DocumentPrintView
          company={company}
          doc={{
            type: "po",
            number: po.po_no || "",
            date: po.po_date,
            expiry_or_delivery_date: po.delivery_date,
            reference_no: null,
            subject: null,
            bill_to: {
              name: po.vendor_name || "",
              address: po.vendor_address,
              gstin: po.vendor_gstin,
              state: po.vendor_state_name,
              contact_name: po.vendor_contact_name,
              contact_phone: po.vendor_phone,
              contact_email: po.vendor_email,
            },
            ship_to: {
              name: po.customer_name || (po.delivery_address_type === "org" ? company.name : "Delivery Address"),
              address: po.delivery_address,
            },
            is_interstate: !!po.is_interstate,
            place_of_supply: po.vendor_state_name,
            sales_person: null,
            payment_terms: po.payment_terms,
            delivery_terms: (po as any).delivery_terms || null,
            items: items.map((it) => ({
              description: it.description,
              warranty: `${(it as any).warranty_months ?? 12} M`,
              hsn: it.hsn,
              qty: it.qty,
              unit: it.unit,
              rate: it.rate,
              gst_percent: it.gst_rate,
              amount: it.taxable_value,
            })),
            totals: {
              subtotal: po.subtotal,
              discount: po.discount || 0,
              cgst: po.cgst || 0,
              sgst: po.sgst || 0,
              igst: po.igst || 0,
              round_off: po.round_off || 0,
              grand_total: po.total,
            },
            notes: po.notes,
            terms: po.terms,
          } as PrintDoc}
        />
      </div>
      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
        title={confirmTarget?.title ?? ""}
        description={confirmTarget?.description ?? ""}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => { await confirmTarget?.onConfirm(); setConfirmTarget(null); }}
      />
    </div>
  );
}