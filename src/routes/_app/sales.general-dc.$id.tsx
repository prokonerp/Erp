import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageLoader } from "@/components/shared/skeletons";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Ban, Download, FileText, PackageCheck, Pencil, Printer, Trash2, Zap } from "lucide-react";
import { NegativeStockDialog } from "@/components/NegativeStockDialog";
import { GeneralDcPrintView } from "@/components/GeneralDcPrintView";
import { printElementSinglePage, saveElementAsPdf } from "@/lib/docPdf";
import { ControlledActionDialog } from "@/components/ControlledActionDialog";
import { usePermissions } from "@/lib/usePermissions";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getCompany } from "@/lib/letterhead";
import { DEFAULT_COMPANY_PROFILE, type CompanyProfile } from "@/lib/companyProfile";
import { signSignatureUrl } from "@/lib/userSignature";
import { inr } from "@/lib/sales";
import { useIsAdmin } from "@/lib/useRole";
import { findShortfalls, logNegativeOverrides, blockMessage, type Shortfall } from "@/lib/negativeStock";
import {
  GDC_PREFILL_KEY,
  cancelGeneralDc,
  deleteGeneralDc,
  gdcTotal,
  getGeneralDc,
  updateGeneralDc,
  isGdcReturned,
  stageReturnGrnPrefill,
  type GeneralDcInvoicePrefill,
  type GeneralDcRow,
} from "@/lib/generalDc";

export const Route = createFileRoute("/_app/sales/general-dc/$id")({
  component: GeneralDcDetail,
  head: () => ({
    meta: [
      { title: "General Delivery Challan — Prokon ERP" },
      { name: "description", content: "View, issue, print and convert a general delivery challan to an invoice." },
      { property: "og:title", content: "General Delivery Challan — Prokon ERP" },
      { property: "og:description", content: "View, issue, print and convert a general delivery challan to an invoice." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const tone: Record<string, string> = {
  Draft: "bg-slate-200 text-slate-800",
  Issued: "bg-blue-100 text-blue-800",
  Converted: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-rose-100 text-rose-800",
};

function GeneralDcDetail() {
  const { id } = useParams({ from: "/_app/sales/general-dc/$id" });
  const nav = useNavigate();
  const { isAdmin } = useIsAdmin();
  const { can } = usePermissions();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dc, setDc] = useState<GeneralDcRow | null>(null);
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const [warehouseNames, setWarehouseNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);
  const [negOpen, setNegOpen] = useState(false);
  const [returned, setReturned] = useState(false);
  const [authorisedSignatureUrl, setAuthorisedSignatureUrl] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getGeneralDc(id).then(setDc).catch((e) => toast.error(e.message));
    getCompany().then(setCompany).catch(() => {});
    supabase.from("warehouses").select("id,name").then(({ data }) => {
      const map: Record<string, string> = {};
      for (const w of (data ?? []) as { id: string; name: string }[]) map[w.id] = w.name;
      setWarehouseNames(map);
    });
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user || cancelled) return;
        const { data: au } = await supabase
          .from("app_users")
          .select("signature_url")
          .eq("user_id", u.user.id)
          .maybeSingle();
        if (cancelled) return;
        const row = au as { signature_url?: string | null } | null;
        const signed = await signSignatureUrl(row?.signature_url || null);
        if (!cancelled) setAuthorisedSignatureUrl(signed);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!dc?.returnable || !dc?.dc_no) return;
    isGdcReturned(dc.dc_no).then(setReturned).catch(() => {});
  }, [dc?.dc_no, dc?.returnable, dc?.status]);

  async function issue() {
    if (!dc) return;
    let short: Shortfall[] = [];
    try {
      short = await findShortfalls(
        (dc.items || [])
          .filter((it) => !it.is_serialized && it.model_no)
          .map((it) => ({
            model: it.model_no as string,
            label: it.part_name || it.model_no,
            warehouseId: it.warehouse_id,
            warehouseName: it.warehouse_id ? warehouseNames[it.warehouse_id] ?? null : null,
            qty: Number(it.qty) || 0,
          })),
      );
    } catch { /* DB still enforces */ }
    if (short.length > 0) {
      if (!isAdmin) return toast.error(blockMessage(short[0]));
      setShortfalls(short);
      setNegOpen(true);
      return;
    }
    await doIssue(false, [], null);
  }

  async function doIssue(allowNegative: boolean, short: Shortfall[], reason: string | null) {
    if (!dc) return;
    setBusy(true);
    try {
      const row = await updateGeneralDc(dc.id, { status: "Issued", allow_negative_stock: allowNegative });
      if (allowNegative && short.length > 0) {
        await logNegativeOverrides({
          documentType: "dc",
          documentId: row.id,
          documentNo: row.dc_no,
          shortfalls: short,
          reason,
        }).catch(() => {});
      }
      setDc(row);
      toast.success(`${row.dc_no} issued — stock updated`);
    } catch (e) {
      toast.error((e as Error).message || "Could not issue challan");
    } finally {
      setBusy(false);
    }
  }

  async function printDoc() {
    if (!printRef.current || !dc) return;
    await printElementSinglePage(printRef.current, `${dc.dc_no || "general-dc"}.pdf`);
  }

  async function downloadPdf() {
    if (!printRef.current || !dc) return;
    await saveElementAsPdf(printRef.current, `${dc.dc_no || "general-dc"}.pdf`);
  }

  async function doCancel(reason: string) {
    if (!dc) return;
    try {
      const row = await cancelGeneralDc(dc.id, reason);
      setDc(row);
      toast.success(`${row.dc_no} cancelled — stock restored`);
    } catch (e) {
      return { error: (e as Error).message || "Could not cancel challan" };
    }
  }

  async function doDelete() {
    if (!dc) return;
    try {
      await deleteGeneralDc(dc.id);
      toast.success(`${dc.dc_no} deleted`);
      nav({ to: "/sales/general-dc" });
    } catch (e) {
      toast.error((e as Error).message || "Could not delete challan");
    }
  }

  function convertToInvoice() {
    if (!dc) return;
    const payload: GeneralDcInvoicePrefill = {
      general_dc_id: dc.id,
      general_dc_no: dc.dc_no,
      skip_stock_posting: true,
      customer_id: dc.customer_id,
      billing_address: dc.billing_address,
      shipping_address: dc.shipping_address,
      branch_id: dc.branch_id,
      notes: dc.notes,
      terms: dc.terms,
      items: (dc.items || []).map((it) => ({
        product_id: it.product_id,
        description: it.part_name || it.model_no || "",
        hsn: it.hsn || "",
        qty: Number(it.qty) || 0,
        unit: it.uom || "Nos",
        rate: Number(it.unit_price) || 0,
        warehouse_id: it.warehouse_id,
        serial_numbers: it.serial_numbers || [],
        is_serialized: !!it.is_serialized,
        part_model_no: it.model_no,
        part_name: it.part_name,
      })),
    };
    try { sessionStorage.setItem(GDC_PREFILL_KEY, JSON.stringify(payload)); } catch { /* noop */ }
    nav({ to: "/sales/invoices/new" });
  }

  if (!dc) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/sales/general-dc"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <h1 className="text-2xl font-bold">{dc.dc_no}</h1>
          <Badge variant="secondary" className={tone[dc.status] || ""}>{dc.status}</Badge>
          <Badge variant="outline">{dc.returnable ? "Returnable" : "Non-Returnable"}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {dc.status === "Draft" && (
            <Button size="sm" onClick={issue} disabled={busy}>
              <Zap className="h-4 w-4 mr-1.5" />Issue
            </Button>
          )}
          {dc.status === "Draft" && can("general_dc", "edit") && (
            <Button size="sm" variant="outline" asChild>
              <Link to="/sales/general-dc/$id/edit" params={{ id: dc.id }}><Pencil className="h-4 w-4 mr-1.5" />Edit</Link>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={printDoc}><Printer className="h-4 w-4 mr-1.5" />Print</Button>
          <Button size="sm" variant="outline" onClick={downloadPdf}><Download className="h-4 w-4 mr-1.5" />Download PDF</Button>
          {dc.status === "Issued" && (
            <Button size="sm" onClick={convertToInvoice}><FileText className="h-4 w-4 mr-1.5" />Convert to Invoice</Button>
          )}
          {dc.returnable && dc.status === "Issued" && !returned && (
            <Button size="sm" variant="outline" onClick={() => { stageReturnGrnPrefill(dc, warehouseNames); nav({ to: "/grn/customer/new" }); }}>
              <PackageCheck className="h-4 w-4 mr-1.5" />Generate Return GRN
            </Button>
          )}
          {dc.status === "Issued" && can("general_dc", "delete") && (
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
              <Ban className="h-4 w-4 mr-1.5" />Cancel DC
            </Button>
          )}
          {dc.status === "Draft" && can("general_dc", "delete") && (
            <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1.5" />Delete
            </Button>
          )}
          {dc.status === "Converted" && dc.converted_invoice_id && (
            <Button size="sm" variant="outline" asChild>
              <Link to="/sales/invoices/$id" params={{ id: dc.converted_invoice_id }}>View Invoice</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Customer</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="font-medium">{dc.customer_name || "—"}</div>
            <div className="text-muted-foreground whitespace-pre-line">{dc.billing_address || "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Ship To</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground whitespace-pre-line">
            {dc.shipping_address || dc.billing_address || "—"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div><span className="text-muted-foreground">Date: </span>{dc.dc_date}</div>
            <div><span className="text-muted-foreground">Purpose: </span>{dc.purpose || "—"}</div>
            {dc.returnable && (
              <>
                <div><span className="text-muted-foreground">Expected Return: </span>{dc.expected_return_date || "—"}</div>
                <div><span className="text-muted-foreground">Return Status: </span>{returned ? "Returned (GRN settled)" : "Pending"}</div>
              </>
            )}
            <div><span className="text-muted-foreground">Total: </span>{inr(gdcTotal(dc.items || []))}</div>
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
                <th className="p-2 text-left">Product</th>
                <th className="p-2 text-left">Serial No.</th>
                <th className="p-2 text-left">Warehouse</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Unit Price</th>
                <th className="p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(dc.items || []).map((it, i) => (
                <tr key={i} className="border-t align-top">
                  <td className="p-2 text-xs">{i + 1}</td>
                  <td className="p-2">
                    <div className="font-medium">{it.part_name || it.model_no}</div>
                    <div className="text-xs text-muted-foreground">{it.model_no}</div>
                  </td>
                  <td className="p-2 text-xs font-mono">{(it.serial_numbers || []).join(", ") || "—"}</td>
                  <td className="p-2 text-xs">{(it.warehouse_id && warehouseNames[it.warehouse_id]) || "—"}</td>
                  <td className="p-2 text-right">{it.qty} {it.uom}</td>
                  <td className="p-2 text-right">{inr(it.unit_price)}</td>
                  <td className="p-2 text-right font-medium">{inr((Number(it.qty) || 0) * (Number(it.unit_price) || 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <NegativeStockDialog
        open={negOpen}
        onOpenChange={setNegOpen}
        shortfalls={shortfalls}
        onProceed={async (reason) => {
          setNegOpen(false);
          await doIssue(true, shortfalls, reason || null);
        }}
      />

      <ControlledActionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${dc.dc_no}?`}
        description="Cancelling returns every unit issued on this challan back to available stock in its original warehouse and writes a reversal entry in the stock ledger."
        warning="A cancelled General DC is final — it cannot be issued again or converted to an invoice."
        confirmLabel="Cancel challan"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        reasonPlaceholder="e.g. Dispatch aborted, wrong customer, material returned…"
        onConfirm={async ({ reason }) => doCancel(reason)}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft challan?</AlertDialogTitle>
            <AlertDialogDescription>
              No stock has been posted for a draft, so this simply removes the record. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border text-sm divide-y">
            <div className="flex justify-between p-2"><span className="text-muted-foreground">DC Number</span><span className="font-medium">{dc.dc_no || "—"}</span></div>
            <div className="flex justify-between p-2"><span className="text-muted-foreground">Customer</span><span className="font-medium">{dc.customer_name || "—"}</span></div>
            <div className="flex justify-between p-2"><span className="text-muted-foreground">Date</span><span className="font-medium">{dc.dc_date}</span></div>
            <div className="flex justify-between p-2"><span className="text-muted-foreground">Status</span><span className="font-medium">{dc.status}</span></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void doDelete(); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Print source (hidden on screen) */}
      <div className="hidden">
        <div ref={printRef}>
          <GeneralDcPrintView dc={dc} company={company} warehouseNames={warehouseNames} authorised_signature_url={authorisedSignatureUrl} />
        </div>
      </div>
    </div>
  );
}