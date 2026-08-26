import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/shared/skeletons";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Printer, Download, Zap, Truck, Ban, ArrowLeft, Wallet } from "lucide-react";
import {
  fetchInvoiceWithItems,
  fetchBranches,
  inr,
  statusMeta,
  type BranchRow,
  type InvoiceItemRow,
  type InvoiceRow,
} from "@/lib/sales";
import { mockIrnPayload, upiPaymentUri } from "@/lib/gst";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { printElementToPdf, saveElementAsPdf } from "@/lib/docPdf";
import {
  InvoicePrintView,
  type InvoiceAmcInfo,
  type InvoiceProductInfo,
} from "@/components/InvoicePrintView";
import { getDocumentHeader } from "@/lib/letterhead";
import type { CompanyProfile } from "@/lib/companyProfile";
import { headerToCompanyProfile } from "@/lib/documentHeader";
import { usePrintOptions } from "@/components/PrintOptionsDialog";

export const Route = createFileRoute("/_app/sales/invoices/$id")({
  component: InvoiceView,
  head: () => ({ meta: [{ title: "Invoice — Prokon" }] }),
});

function InvoiceView() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [inv, setInv] = useState<InvoiceRow | null>(null);
  const [items, setItems] = useState<InvoiceItemRow[]>([]);
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [customer, setCustomer] = useState<{
    company: string;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    gst?: string | null;
    billing_address?: string | null;
    shipping_address?: string | null;
    state?: string | null;
  } | null>(null);
  const [pdfTheme, setPdfTheme] = useState<{ themeColor: string; copyLabel: string }>({
    themeColor: "#000000",
    copyLabel: "Original Copy",
  });
  const [pdfSettings, setPdfSettings] = useState<{
    company_name: string | null;
    company_address: string | null;
    udyam_no: string | null;
    phone: string | null;
    email: string | null;
  } | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // ---- print-document state (reference-style A4 invoice) ----
  const [products, setProducts] = useState<Record<string, InvoiceProductInfo>>({});
  const [amc, setAmc] = useState<InvoiceAmcInfo>(null);
  const [upiQr, setUpiQr] = useState<string | null>(null);
  const [einvQr, setEinvQr] = useState<string | null>(null);
  const [printCompany, setPrintCompany] = useState<CompanyProfile | null>(null);
  const [printMeta, setPrintMeta] = useState<{ copyLabel: string; warehouseLine: string | null }>({
    copyLabel: "Original Copy",
    warehouseLine: null,
  });
  const printer = usePrintOptions();

  // e-Way form
  const [ewayOpen, setEwayOpen] = useState(false);
  const [ewayForm, setEwayForm] = useState({
    transporter_name: "",
    transporter_id: "",
    vehicle_no: "",
    distance_km: 0,
    transport_mode: "road",
  });
  const [cancelReason, setCancelReason] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetchInvoiceWithItems(id);
      setInv(r.invoice);
      setItems(r.items);
      const [bs, { data: cust }] = await Promise.all([
        fetchBranches(),
        supabase.from("customers").select("*").eq("id", r.invoice.customer_id).maybeSingle(),
      ]);
      setBranch(bs.find((b) => b.id === r.invoice.branch_id) || null);
      setCustomer(cust);
      const co = await getDocumentHeader();
      setCompany(co);
      const { data: st } = await supabase
        .from("invoice_settings")
        .select("theme_color,copy_label,company_name,company_address,udyam_no,phone,email")
        .eq("branch_id", r.invoice.branch_id)
        .maybeSingle();
      const settings = st as {
        theme_color?: string | null;
        copy_label?: string | null;
        company_name?: string | null;
        company_address?: string | null;
        udyam_no?: string | null;
        phone?: string | null;
        email?: string | null;
      } | null;
      if (settings) {
        setPdfTheme({
          themeColor: settings.theme_color || "#000000",
          // Copy labels are a per-print choice (Original renders nothing on the
          // document); never persist one from settings onto every invoice.
          copyLabel: "Original Copy",
        });
        setPrintMeta((m) => ({ ...m, copyLabel: "Original Copy" }));
        setPdfSettings({
          company_name: settings.company_name ?? null,
          company_address: settings.company_address ?? null,
          udyam_no: settings.udyam_no ?? null,
          phone: settings.phone ?? null,
          email: settings.email ?? null,
        });
      }

      // ---- print-document data (all from live CRM tables) ----
      // Product model + warranty for the Model column / Warranty & AMC block.
      const productIds = Array.from(
        new Set(r.items.map((it) => it.product_id).filter((x): x is string => !!x)),
      );
      if (productIds.length) {
        const { data: prods } = await supabase
          .from("products")
          .select(
            "id, model, warranty_applicable, warranty_duration, warranty_unit, warranty_start_from",
          )
          .in("id", productIds);
        setProducts(
          Object.fromEntries(
            ((prods ?? []) as unknown as (InvoiceProductInfo & { id: string })[]).map((p) => [
              p.id,
              p,
            ]),
          ),
        );
      } else {
        setProducts({});
      }
      // Latest AMC agreement for this customer (optional — hidden when none).
      try {
        const { data: amcRows } = await supabase
          .from("amcs")
          .select("agreement_no, start_date, end_date")
          .eq("customer_id", r.invoice.customer_id)
          .order("end_date", { ascending: false })
          .limit(1);
        setAmc(((amcRows as unknown as InvoiceAmcInfo[]) ?? [])[0] ?? null);
      } catch {
        setAmc(null);
      }
      // QR codes generated from actual invoice/payment data.
      const branchRow = bs.find((b) => b.id === r.invoice.branch_id) || null;
      try {
        const QRCode = (await import("qrcode")).default;
        setUpiQr(
          branchRow?.upi_id
            ? await QRCode.toDataURL(
                upiPaymentUri({
                  upiId: branchRow.upi_id,
                  payeeName: co.name,
                  amount: r.invoice.total,
                  note: r.invoice.invoice_no || "Invoice",
                }),
                { width: 240, margin: 1 },
              )
            : null,
        );
      } catch {
        setUpiQr(null);
      }
      try {
        const QRCode = (await import("qrcode")).default;
        setEinvQr(
          r.invoice.qr_payload
            ? await QRCode.toDataURL(r.invoice.qr_payload, { width: 240, margin: 1 })
            : null,
        );
      } catch {
        setEinvQr(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not generate e-invoice");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function issueIfDraft() {
    if (!inv || inv.status !== "draft") return;
    const { error } = await supabase.from("invoices").update({ status: "issued" }).eq("id", inv.id);
    if (error) return toast.error(error.message);
    toast.success("Invoice issued");
    load();
  }

  async function generateIrn() {
    if (!inv) return;
    if (inv.irn) return toast.info("IRN already generated");
    const payload = mockIrnPayload({
      invoice_no: inv.invoice_no || "",
      invoice_date: inv.invoice_date,
      seller_gstin: inv.seller_gstin,
      buyer_gstin: inv.buyer_gstin,
      total: inv.total,
    });
    const { error } = await supabase
      .from("invoices")
      .update({
        irn: payload.irn,
        ack_no: payload.ack_no,
        ack_date: new Date().toISOString(),
        qr_payload: payload.qr_payload,
        einvoice_status: "generated",
      })
      .eq("id", inv.id);
    if (error) return toast.error(error.message);
    toast.success("IRN generated (mock — plug real GSP later)");
    load();
  }

  async function generateEway() {
    if (!inv) return;
    if (!ewayForm.vehicle_no.trim()) return toast.error("Vehicle number required");
    // Mock e-Way number
    const ewb = `EWB${Date.now().toString().slice(-11)}`;
    const validTill = new Date(Date.now() + 24 * 3600e3).toISOString();
    const { error } = await supabase.from("eway_bills").insert({
      invoice_id: inv.id,
      ...ewayForm,
      ewb_no: ewb,
      ewb_date: new Date().toISOString(),
      valid_till: validTill,
      status: "generated",
    });
    if (error) return toast.error(error.message);
    await supabase
      .from("invoices")
      .update({
        ewaybill_no: ewb,
        ewaybill_date: new Date().toISOString(),
        ewaybill_valid_till: validTill,
      })
      .eq("id", inv.id);
    toast.success("e-Way Bill generated (mock)");
    setEwayOpen(false);
    load();
  }

  async function cancelInvoice() {
    if (!inv) return;
    if (!cancelReason.trim()) return toast.error("Reason required");
    const { error } = await supabase
      .from("invoices")
      .update({
        status: "cancelled",
        cancel_reason: cancelReason,
        cancelled_at: new Date().toISOString(),
      })
      .eq("id", inv.id);
    if (error) return toast.error(error.message);
    toast.success("Invoice cancelled");
    load();
  }

  if (loading || !inv || !company) return <PageLoader />;

  const s = statusMeta(inv.status);
  const due = Math.max(0, Number(inv.total) - Number(inv.total_paid));
  const fmtDMY = (d?: string | null) => {
    if (!d) return "";
    const [y, m, day] = d.slice(0, 10).split("-");
    return y && m && day ? `${day}-${m}-${y}` : d;
  };

  /**
   * Print / Download the reference-style A4 invoice. The letterhead source is
   * chosen first, the hidden #invoice-print-doc re-renders with it, then the
   * element is handed to the shared print / PDF pipeline (docPdf.ts).
   */
  const runPdf = async (mode: "print" | "download") => {
    if (!inv) return;
    const choice = await printer.smartAsk({
      docType: "invoice",
      title: mode === "print" ? "Print Tax Invoice" : "Download Invoice PDF",
      description: "Choose which office details appear on the invoice letterhead.",
      defaultSource: branch?.id ? { kind: "branch", id: branch.id } : null,
      smartWarehouseIds: items.map(
        (it) => (it as unknown as { warehouse_id?: string | null }).warehouse_id,
      ),
      defaultCopyLabel: pdfTheme.copyLabel,
      allowCopyLabel: true,
      allowSupplyFrom: true,
      issuedGstin: inv.seller_gstin ?? null,
      company,
    });
    if (!choice) return;
    // Preserve the company-master seal/signature asset across header switches.
    const header = {
      ...headerToCompanyProfile(choice.header),
      seal_url: company.seal_url ?? null,
    };
    setPrintCompany(header);
    const whLine =
      choice.header.source.kind === "warehouse" || choice.header.source.kind === "branch"
        ? [choice.header.label, ...choice.header.addressLines].filter(Boolean).join(", ")
        : null;
    setPrintMeta({ copyLabel: choice.copyLabel || pdfTheme.copyLabel, warehouseLine: whLine });
    // Let React paint the updated document (and decode QR/logo images) first.
    await new Promise((r) => setTimeout(r, 400));
    const el = document.getElementById("invoice-print-doc");
    if (!el) return toast.error("Invoice document is not ready yet");
    const filename = `${inv.invoice_no || "invoice"}.pdf`.replace(/[^\w.-]+/g, "_");
    try {
      if (mode === "print") await printElementToPdf(el, filename);
      else await saveElementAsPdf(el, filename);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not process the invoice document");
    }
  };

  return (
    <div className="space-y-4">
      {printer.element}
      {/* Hidden A4 print document — captured by Print / Download PDF (docPdf.ts) */}
      <div
        aria-hidden="true"
        style={{ position: "fixed", left: -20000, top: 0, width: 0, height: 0, overflow: "hidden" }}
      >
        <div id="invoice-print-doc">
          <InvoicePrintView
            invoice={inv}
            items={items}
            company={printCompany || company}
            customer={customer}
            branch={branch}
            products={products}
            amc={amc}
            udyamNo={pdfSettings?.udyam_no || null}
            upiQrDataUrl={upiQr}
            einvoiceQrDataUrl={einvQr}
            copyLabel={printMeta.copyLabel}
            warehouseLine={printMeta.warehouseLine}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => nav({ to: "/sales/invoices" })}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <h1 className="text-2xl font-bold">{inv.invoice_no || "Invoice"}</h1>
          <StatusBadge tone={s.badgeTone}>{s.label}</StatusBadge>
          {inv.irn && <StatusBadge tone="success">e-Invoice ✓</StatusBadge>}
          {inv.ewaybill_no && <StatusBadge tone="info">e-Way ✓</StatusBadge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.status === "draft" && (
            <Button size="sm" onClick={issueIfDraft}>
              <Zap className="h-4 w-4 mr-1.5" />
              Issue
            </Button>
          )}
          {inv.status !== "cancelled" && !inv.irn && (
            <Button size="sm" variant="outline" onClick={generateIrn}>
              <Zap className="h-4 w-4 mr-1.5" />
              Generate IRN
            </Button>
          )}
          {inv.status !== "cancelled" && !inv.ewaybill_no && inv.total >= 50000 && (
            <Button size="sm" variant="outline" onClick={() => setEwayOpen((v) => !v)}>
              <Truck className="h-4 w-4 mr-1.5" />
              e-Way Bill
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/sales/payments/new"
              search={{ invoice_id: inv.id } as { invoice_id: string }}
            >
              <Wallet className="h-4 w-4 mr-1.5" />
              Record Payment
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void runPdf("print")}>
            <Printer className="h-4 w-4 mr-1.5" />
            Print
          </Button>
          <Button size="sm" variant="outline" onClick={() => void runPdf("download")}>
            <Download className="h-4 w-4 mr-1.5" />
            PDF
          </Button>
        </div>
      </div>

      {ewayOpen && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Generate e-Way Bill</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div>
              <Label className="text-xs">Transporter</Label>
              <Input
                value={ewayForm.transporter_name}
                onChange={(e) => setEwayForm({ ...ewayForm, transporter_name: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Transporter ID</Label>
              <Input
                value={ewayForm.transporter_id}
                onChange={(e) => setEwayForm({ ...ewayForm, transporter_id: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Vehicle No *</Label>
              <Input
                value={ewayForm.vehicle_no}
                onChange={(e) => setEwayForm({ ...ewayForm, vehicle_no: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Distance (km)</Label>
              <Input
                type="number"
                value={ewayForm.distance_km}
                onChange={(e) => setEwayForm({ ...ewayForm, distance_km: Number(e.target.value) })}
              />
            </div>
            <div>
              <Button size="sm" onClick={generateEway}>
                Generate
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Seller</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-0.5">
            <div className="font-semibold">{company.name}</div>
            <div className="text-muted-foreground text-xs">{company.regd_address}</div>
            <div>
              GSTIN: <span className="font-mono text-xs">{company.gstin || "—"}</span>
            </div>
            <div>
              State: {inv.seller_state} ({inv.seller_state_code})
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Buyer</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-0.5">
            <div className="font-semibold">{inv.buyer_name}</div>
            <div className="text-muted-foreground text-xs whitespace-pre-line">
              {inv.billing_address}
            </div>
            <div>
              GSTIN: <span className="font-mono text-xs">{inv.buyer_gstin || "—"}</span>
            </div>
            <div>
              State: {inv.buyer_state} ({inv.buyer_state_code})
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Amounts</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="flex justify-between">
              <span>Taxable</span>
              <span>{inr(inv.taxable_value)}</span>
            </div>
            {inv.payment_terms && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Payment Terms</span>
                <span>{inv.payment_terms}</span>
              </div>
            )}
            {inv.is_interstate ? (
              <div className="flex justify-between">
                <span>IGST</span>
                <span>{inr(inv.igst)}</span>
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>CGST</span>
                  <span>{inr(inv.cgst)}</span>
                </div>
                <div className="flex justify-between">
                  <span>SGST</span>
                  <span>{inr(inv.sgst)}</span>
                </div>
              </>
            )}
            {!!inv.round_off && (
              <div className="flex justify-between">
                <span>Round Off</span>
                <span>{inr(inv.round_off)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold border-t pt-1">
              <span>Total</span>
              <span>{inr(inv.total)}</span>
            </div>
            <div className="flex justify-between text-emerald-700">
              <span>Paid</span>
              <span>{inr(inv.total_paid)}</span>
            </div>
            <div className="flex justify-between text-amber-700 font-medium">
              <span>Due</span>
              <span>{inr(due)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2 text-left">#</th>
                <th className="p-2 text-left">Description</th>
                <th className="p-2 text-left">HSN</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Rate</th>
                <th className="p-2 text-right">Taxable</th>
                <th className="p-2 text-right">GST%</th>
                {inv.is_interstate ? (
                  <th className="p-2 text-right">IGST</th>
                ) : (
                  <>
                    <th className="p-2 text-right">CGST</th>
                    <th className="p-2 text-right">SGST</th>
                  </>
                )}
                <th className="p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="p-2 text-xs">{it.sr_no}</td>
                  <td className="p-2">
                    <div>{it.description}</div>
                    {it.serial_numbers && it.serial_numbers.length > 0 && (
                      <div className="text-[11px] text-muted-foreground font-mono mt-1">
                        Serial No: {it.serial_numbers.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="p-2 font-mono text-xs">{it.hsn || "—"}</td>
                  <td className="p-2 text-right">
                    {it.qty} {it.unit}
                  </td>
                  <td className="p-2 text-right">{inr(it.rate)}</td>
                  <td className="p-2 text-right">{inr(it.taxable_value)}</td>
                  <td className="p-2 text-right">{it.gst_rate}%</td>
                  {inv.is_interstate ? (
                    <td className="p-2 text-right">{inr(it.igst)}</td>
                  ) : (
                    <>
                      <td className="p-2 text-right">{inr(it.cgst)}</td>
                      <td className="p-2 text-right">{inr(it.sgst)}</td>
                    </>
                  )}
                  <td className="p-2 text-right font-medium">{inr(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {inv.status !== "cancelled" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive flex items-center gap-2">
              <Ban className="h-4 w-4" />
              Cancel Invoice
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row gap-2 items-start md:items-end">
            <div className="flex-1 w-full">
              <Label className="text-xs">Reason</Label>
              <Textarea
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Data entry error / duplicate / customer request…"
              />
            </div>
            <Button variant="destructive" size="sm" onClick={cancelInvoice}>
              Cancel Invoice
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
