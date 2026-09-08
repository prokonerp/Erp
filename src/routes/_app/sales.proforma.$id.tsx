// @ts-nocheck
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageLoader } from "@/components/shared/skeletons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Ban, Download, Pencil, Printer, Trash2, FileText } from "lucide-react";
import { ProformaPrintView } from "@/components/ProformaPrintView";
import { printElementSinglePage, saveElementAsPdf } from "@/lib/docPdf";
import { ControlledActionDialog } from "@/components/ControlledActionDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fetchProforma, deleteProforma, updateProforma, isProformaEditable } from "@/lib/proforma";
import type { ProformaRow } from "@/lib/proforma";
import { fetchSalesOrder } from "@/lib/salesOrders";
import type { SalesOrder, SoFulfillmentSummary } from "@/lib/salesOrders";
import { fetchSoFulfillmentSummary } from "@/lib/salesOrders";
import { createInvoiceFromProforma } from "@/lib/documentFlow.writers";
import { inr } from "@/lib/sales";
import { getCompany } from "@/lib/letterhead";
import { DEFAULT_COMPANY_PROFILE, type CompanyProfile } from "@/lib/companyProfile";
import { signSignatureUrl } from "@/lib/userSignature";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/sales/proforma/$id")({
  component: ProformaDetail,
  head: () => ({
    meta: [
      { title: "Proforma Invoice — Prokon ERP" },
      { name: "description", content: "View, print and convert proforma to tax invoice." },
      { property: "og:title", content: "Proforma Invoice — Prokon ERP" },
      { property: "og:description", content: "View, print and convert proforma to tax invoice." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const tone: Record<string, string> = {
  draft: "bg-slate-200 text-slate-800",
  issued: "bg-blue-100 text-blue-800",
  cancelled: "bg-rose-100 text-rose-800",
};

function ProformaDetail() {
  const { id } = useParams({ from: "/_app/sales/proforma/$id" });
  const nav = useNavigate();
  const [proforma, setProforma] = useState<ProformaRow | null>(null);
  const [so, setSo] = useState<SalesOrder | null>(null);
  const [fulfillments, setFulfillments] = useState<SoFulfillmentSummary[]>([]);
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const [branch, setBranch] = useState<{ name?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [authorisedSignatureUrl, setAuthorisedSignatureUrl] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchProforma(id).then((row) => {
      setProforma(row);
      if (row.sales_order_id) {
        fetchSalesOrder(row.sales_order_id).then(setSo).catch(() => {});
        fetchSoFulfillmentSummary(row.sales_order_id).then(setFulfillments).catch(() => {});
      }
      if (row.branch_id) {
        supabase.from("branches").select("name").eq("id", row.branch_id).maybeSingle().then(({ data }) => setBranch(data as any));
      }
    }).catch((e) => toast.error(e.message));
    getCompany().then(setCompany).catch(() => {});
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user || cancelled) return;
        const { data: au } = await supabase.from("app_users").select("signature_url").eq("user_id", u.user.id).maybeSingle();
        if (cancelled) return;
        const signed = await signSignatureUrl((au as any)?.signature_url || null);
        if (!cancelled) setAuthorisedSignatureUrl(signed);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleIssue() {
    if (!proforma) return;
    setBusy(true);
    try {
      const row = await updateProforma(proforma.id, { status: "issued" });
      setProforma(row);
      toast.success(`${row.proforma_no || "Proforma"} issued`);
    } catch (e: any) {
      toast.error(e.message || "Could not issue");
    } finally { setBusy(false); }
  }

  async function handleCancel(reason: string) {
    if (!proforma) return;
    try {
      const row = await updateProforma(proforma.id, { status: "cancelled", cancelled_reason: reason, cancelled_at: new Date().toISOString() } as any);
      setProforma(row);
      toast.success(`${row.proforma_no || "Proforma"} cancelled`);
    } catch (e: any) {
      return { error: e.message || "Could not cancel" };
    }
  }

  async function handleDelete() {
    if (!proforma) return;
    try {
      await deleteProforma(proforma.id);
      toast.success(`${proforma.proforma_no || "Proforma"} deleted`);
      nav({ to: "/sales/proforma" });
    } catch (e: any) {
      toast.error(e.message || "Could not delete");
    }
  }

  async function handleConvertToInvoice() {
    if (!proforma) return;
    setBusy(true);
    try {
      const r = await createInvoiceFromProforma(proforma.id);
      toast.success(`Invoice ${r.invoice_no || ""} created from proforma`);
      nav({ to: "/sales/invoices/$id", params: { id: r.id } });
    } catch (e: any) {
      toast.error(e.message || "Conversion failed");
    } finally { setBusy(false); }
  }

  async function printDoc() {
    if (!printRef.current || !proforma) return;
    await printElementSinglePage(printRef.current, `${proforma.proforma_no || "proforma"}.pdf`);
  }
  async function downloadPdf() {
    if (!printRef.current || !proforma) return;
    await saveElementAsPdf(printRef.current, `${proforma.proforma_no || "proforma"}.pdf`);
  }

  if (!proforma) return <PageLoader />;

  const editable = isProformaEditable(proforma.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/sales/proforma"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <h1 className="text-2xl font-bold font-mono">{proforma.proforma_no || "—"}</h1>
          <Badge variant="secondary" className={tone[proforma.status] || ""}>{proforma.status}</Badge>
          <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-800">No Stock</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {proforma.status === "draft" && (
            <Button size="sm" onClick={handleIssue} disabled={busy}>Issue</Button>
          )}
          {editable && (
            <Button size="sm" variant="outline" asChild>
              <Link to="/sales/proforma/$id/edit" params={{ id: proforma.id }}><Pencil className="h-4 w-4 mr-1.5" />Edit</Link>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={printDoc}><Printer className="h-4 w-4 mr-1.5" />Print</Button>
          <Button size="sm" variant="outline" onClick={downloadPdf}><Download className="h-4 w-4 mr-1.5" />PDF</Button>
          {proforma.status !== "cancelled" && (
            <Button size="sm" onClick={handleConvertToInvoice} disabled={busy}><FileText className="h-4 w-4 mr-1.5" />Convert to Invoice</Button>
          )}
          {proforma.status === "issued" && (
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}><Ban className="h-4 w-4 mr-1.5" />Cancel</Button>
          )}
          {proforma.status === "draft" && (
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="h-4 w-4 mr-1.5" />Delete</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Customer</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="font-medium">{proforma.buyer_name || "—"}</div>
            <div className="text-muted-foreground whitespace-pre-line">{proforma.billing_address || "—"}</div>
            {proforma.buyer_gstin && <div className="font-mono text-xs">GSTIN: {proforma.buyer_gstin}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Ship To</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground whitespace-pre-line">
            {proforma.shipping_address || proforma.billing_address || "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="text-muted-foreground">Date: </span>{proforma.proforma_date}</div>
            {proforma.po_number && <div><span className="text-muted-foreground">PO: </span>{proforma.po_number} {proforma.po_date ? `(${proforma.po_date})` : ""}</div>}
            {so && <div><span className="text-muted-foreground">Against SO: </span><Link to="/sales/orders/$id" params={{ id: so.id }} className="font-mono text-primary hover:underline">{so.so_no}</Link></div>}
            <div><span className="text-muted-foreground">Total: </span><span className="font-semibold tabular-nums">{inr(proforma.total)}</span></div>
            <div className="text-[11px] text-amber-700">Proforma — not a tax invoice. No stock movement.</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2 text-left w-8">#</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-left">HSN</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Rate</th>
                <th className="p-2 text-right">GST%</th>
                <th className="p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(proforma.items || []).map((it: any, i: number) => (
                <tr key={i} className="border-t align-top">
                  <td className="p-2 text-xs">{i + 1}</td>
                  <td className="p-2"><div className="font-medium">{it.description || "—"}</div><div className="text-xs font-mono text-muted-foreground">{it.part_model_no || ""}</div></td>
                  <td className="p-2 font-mono text-xs">{it.hsn || "—"}</td>
                  <td className="p-2 text-right tabular-nums">{it.qty} {it.unit || ""}</td>
                  <td className="p-2 text-right tabular-nums">{inr(it.rate)}</td>
                  <td className="p-2 text-right">{it.gst_rate ?? 0}%</td>
                  <td className="p-2 text-right font-medium tabular-nums">{inr(it.line_total ?? (Number(it.qty) || 0) * (Number(it.rate) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {(proforma.notes || proforma.terms) && (
        <Card>
          <CardContent className="pt-4 grid md:grid-cols-2 gap-4 text-sm">
            {proforma.terms && <div><div className="font-medium mb-1">Terms</div><div className="whitespace-pre-line text-muted-foreground">{proforma.terms}</div></div>}
            {proforma.notes && <div><div className="font-medium mb-1">Notes</div><div className="whitespace-pre-line text-muted-foreground">{proforma.notes}</div></div>}
          </CardContent>
        </Card>
      )}

      <ControlledActionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${proforma.proforma_no || "Proforma"}?`}
        description="Proforma is not a delivery document — cancelling has no stock effect."
        warning="A cancelled proforma cannot be issued again."
        confirmLabel="Cancel proforma"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        reasonPlaceholder="e.g. Superseded…"
        onConfirm={async ({ reason }) => handleCancel(reason)}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft proforma?</AlertDialogTitle>
            <AlertDialogDescription>No stock is affected. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); void handleDelete(); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="hidden">
        <div ref={printRef}>
          <ProformaPrintView proforma={proforma} company={company} branch={branch} so={so} fulfillments={fulfillments} authorised_signature_url={authorisedSignatureUrl} />
        </div>
      </div>
    </div>
  );
}
