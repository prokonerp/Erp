import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Printer, Download, Ban, Pencil } from "lucide-react";
import { fetchChallan, type DeliveryChallan } from "@/lib/challan";
import { getOemLogo } from "@/lib/oemLogos";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { downloadElementAsPdf } from "@/lib/docPdf";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/useRole";
import { AdminDeleteDialog } from "@/components/AdminDeleteDialog";
import { DEFAULT_COMPANY_PROFILE, fetchCompanyProfile, type CompanyProfile } from "@/lib/companyProfile";

export const Route = createFileRoute("/_app/challan/$id")({
  component: ChallanView,
  head: () => ({ meta: [{ title: "Delivery Challan — Prokon" }] }),
});

function ChallanView() {
  const { id } = Route.useParams();
  const [c, setC] = useState<DeliveryChallan | null>(null);
  const [busy, setBusy] = useState(false);
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);

  useEffect(() => { fetchCompanyProfile().then(setCompany).catch(() => {}); }, []);

  useEffect(() => {
    fetchChallan(id).then(setC).catch((e) => toast.error(e.message));
  }, [id]);

  if (!c) return <div className="text-muted-foreground">Loading…</div>;
  const isOem = c.doc_type === "oem";
  const oemLogo = isOem ? (c.oem_logo_url ? { url: c.oem_logo_url, alt: c.party_name || "OEM" } : getOemLogo(c.party_name)) : null;
  const status = c.status || "Challan Generated";
  // Legacy 'Draft' rows shouldn't exist after migration, but stay defensive.
  const isCancelled = status === "Cancelled";
  const isActive = !isCancelled;

  const handleDownload = async () => {
    const el = document.getElementById("print-area");
    if (!el) return;
    try {
      await downloadElementAsPdf(el, `DC_${c.challan_no || c.id}.pdf`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to generate PDF");
    }
  };

  const handleCancel = async () => {
    if (!isActive) return;
    if (!confirm("Cancel this submitted Delivery Challan?\n\nRelated stock ledger entries will be reversed.")) return;
    setBusy(true);
    const { error } = await supabase
      .from("delivery_challans" as never)
      .update({ status: "Cancelled" } as never)
      .eq("id", c.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setC({ ...c, status: "Cancelled" });
    toast.success("Delivery Challan cancelled. Stock reversed.");
  };

  const handlePrint = async () => {
    if (!c.printed_at) {
      // fire-and-forget audit stamp — we don't block the print dialog
      const { data: u } = await supabase.auth.getUser();
      void supabase
        .from("delivery_challans" as never)
        .update({ printed_by: u.user?.id ?? null, printed_at: new Date().toISOString() } as never)
        .eq("id", c.id);
    }
    window.print();
  };

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
        #print-area { font-family: Arial, Helvetica, sans-serif; color: #111; }
        #print-area table { border-collapse: collapse; width: 100%; }
        #print-area th, #print-area td { border: 1px solid #333; padding: 3px 5px; font-size: 10px; vertical-align: top; }
        #print-area thead { display: table-header-group; }
      `}</style>

      <div className="no-print mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/challan">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back to All Delivery Challan</Button>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={isCancelled ? "destructive" : "default"}
              className={isCancelled ? "" : "bg-emerald-600 hover:bg-emerald-600"}
            >
              {status}
            </Badge>
            {isActive && (
              <Link to="/challan/$id_/edit" params={{ id: c.id }}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Pencil className="h-4 w-4" />Edit
                </Button>
              </Link>
            )}
            {isActive && (
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={busy} className="gap-1.5">
                <Ban className="h-4 w-4" />Cancel
              </Button>
            )}
            {isAdmin && (
              <AdminDeleteDialog
                kind="challan"
                id={c.id}
                label={`Delivery Challan ${c.challan_no}`}
                onDeleted={() => navigate({ to: isOem ? "/challan/oem" : "/challan/customer" })}
              />
            )}
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" />Download PDF
            </Button>
            <Button size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" />Print
            </Button>
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Review &amp; Print Preview</span> — A4 landscape.
          {isActive && " Delivery Challan is live in the IMS Stock Ledger."}
          {c.printed_at && ` · Last printed ${new Date(c.printed_at).toLocaleString()}.`}
        </div>
      </div>

      <div id="print-area" className="bg-white text-black mx-auto shadow print:shadow-none" style={{ width: "281mm", minHeight: "194mm", padding: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", borderBottom: "2px solid #000", paddingBottom: 8 }}>
          <div style={{ width: isOem ? "35%" : "30%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingRight: 8 }}>
            <img src={company.logo_url || prokonLogo.url} alt={company.name} style={{ maxHeight: isOem ? 45 : 60, objectFit: "contain" }} />
            {isOem && oemLogo && (
              <img src={oemLogo.url} alt={oemLogo.alt} style={{ maxHeight: 45, objectFit: "contain" }} />
            )}
          </div>
          <div style={{ width: isOem ? "65%" : "70%", textAlign: "right", fontSize: 11, lineHeight: 1.4 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e3a8a" }}>{company.name}</div>
            <div>{company.regd_address}</div>
            {company.factory_address && <div>{company.factory_address}</div>}
            <div>
              {company.gstin && <>GSTIN: {company.gstin}</>}
              {company.gstin && company.phone && <>&nbsp;|&nbsp;</>}
              {company.phone && <>Phone: {company.phone}</>}
            </div>
            <div>
              {company.email && <>Email: {company.email}</>}
              {company.email && company.website && <>&nbsp;|&nbsp;</>}
              {company.website && <>Web: {company.website}</>}
            </div>
            {isOem && c.party_name && (
              <div style={{ marginTop: 4, fontSize: 10, borderTop: "1px dashed #999", paddingTop: 4 }}>
                <div><b>OEM:</b> {c.party_name}</div>
                {c.oem_plant && <div><b>Plant:</b> {c.oem_plant}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <div style={{ textAlign: "center", margin: "8px 0" }}>
          <div style={{ display: "inline-block", border: "2px solid #000", padding: "4px 16px", fontWeight: 700, letterSpacing: 2, fontSize: 14 }}>
            DELIVERY CHALLAN
          </div>
          <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600 }}>
            DOCUMENT TYPE: {isOem ? "TO OEM" : "TO CUSTOMER"}
          </div>
          <div style={{ fontSize: 11, marginTop: 2 }}>
            <b>Challan No:</b> <span style={{ fontFamily: "monospace" }}>{c.challan_no}</span> &nbsp;&nbsp;
            <b>Date:</b> {c.challan_date}
          </div>
        </div>

        {/* Consignee & Dispatch */}
        <table style={{ marginBottom: 6 }}>
          <tbody>
            <tr>
              <td style={{ width: "50%" }}>
                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2 }}>CONSIGNEE DETAILS</div>
                <div style={{ fontSize: 11 }}>
                  <div><b>{isOem ? "OEM" : "Customer"}:</b> {c.party_name}</div>
                  {c.party_code && <div><b>Code:</b> {c.party_code}</div>}
                  {c.gstin && <div><b>GSTIN:</b> {c.gstin}</div>}
                  {c.delivery_address && <div><b>Address:</b> {c.delivery_address}</div>}
                  {c.contact_person && <div><b>Contact:</b> {c.contact_person}</div>}
                  {c.contact_number && <div><b>Phone:</b> {c.contact_number}</div>}
                  {c.email && <div><b>Email:</b> {c.email}</div>}
                </div>
              </td>
              <td style={{ width: "50%" }}>
                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2 }}>DISPATCH DETAILS</div>
                <div style={{ fontSize: 11 }}>
                  <div><b>Challan No:</b> {c.challan_no}</div>
                  <div><b>Challan Date:</b> {c.challan_date}</div>
                  {c.dispatch_date && <div><b>Dispatch Date:</b> {c.dispatch_date}</div>}
                  {c.vehicle_number && <div><b>Vehicle No:</b> {c.vehicle_number}</div>}
                  {c.transporter_name && <div><b>Transporter:</b> {c.transporter_name}</div>}
                  {c.lr_number && <div><b>LR No:</b> {c.lr_number}</div>}
                  {c.gate_pass_no && <div><b>Gate Pass No:</b> {c.gate_pass_no}</div>}
                  {c.mode_of_transport && <div><b>Mode:</b> {c.mode_of_transport}</div>}
                  {(c.driver_name || c.driver_mobile) && <div><b>Driver:</b> {c.driver_name} {c.driver_mobile ? `(${c.driver_mobile})` : ""}</div>}
                  {(c.num_packages || c.total_weight) && <div><b>Pkgs/Weight:</b> {c.num_packages || "-"} / {c.total_weight || "-"}</div>}
                  {(c.sales_order_no || c.customer_po_no || c.invoice_no || c.reference_no) && (
                    <div style={{ marginTop: 2, fontSize: 10 }}>
                      {c.reference_no && <span><b>Ref:</b> {c.reference_no} &nbsp;</span>}
                      {c.sales_order_no && <span><b>SO:</b> {c.sales_order_no} &nbsp;</span>}
                      {c.customer_po_no && <span><b>PO:</b> {c.customer_po_no} &nbsp;</span>}
                      {c.invoice_no && <span><b>Invoice:</b> {c.invoice_no}</span>}
                    </div>
                  )}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Material table */}
        <table style={{ marginBottom: 6, fontSize: 10 }}>
          <thead style={{ background: "#eef2ff" }}>
            <tr>
              <th style={{ width: 24 }}>Sr</th>
              <th>Product</th>
              <th>OEM Ref ID</th>
              {isOem ? (
                <>
                  <th>Model No</th>
                  <th>Serial No</th>
                  <th>Oracle #</th>
                  <th>Stock Type</th>
                </>
              ) : (
                <>
                  <th>Defective Model</th>
                  <th>Defective Sr No</th>
                  <th>Oracle #</th>
                  <th>Good Model</th>
                  <th>Good Sr No</th>
                </>
              )}
              <th style={{ width: 40 }}>UOM</th>
              <th style={{ width: 40 }}>Qty</th>
              <th style={{ width: 60 }}>HSN</th>
              <th style={{ width: 60 }}>Unit Price</th>
              <th style={{ width: 60 }}>Weight (Kg)</th>
            </tr>
          </thead>
          <tbody>
            {(c.items || []).map((it, i) => {
              const productLabel = [it.part_name, it.part_no].filter(Boolean).join(" — ");
              const desc = it.description;
              return (
                <tr key={i}>
                  <td style={{ textAlign: "center" }}>{i + 1}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{productLabel}</div>
                    {desc && <div style={{ fontSize: 9, color: "#555" }}>{desc}</div>}
                  </td>
                  <td>{it.oem_ref_id || ""}</td>
                  {isOem ? (
                    <>
                      <td>{it.model_no || ""}</td>
                      <td>{it.good_defective_serial || it.serial_no || ""}</td>
                      <td>{it.oracle_no || ""}</td>
                      <td>{it.stock_type || ""}</td>
                    </>
                  ) : (
                    <>
                      <td>{it.defective_model || ""}</td>
                      <td>{it.defective_serial || ""}</td>
                      <td>{it.oracle_no || ""}</td>
                      <td>{it.good_model || ""}</td>
                      <td>{it.good_serial || ""}</td>
                    </>
                  )}
                  <td style={{ textAlign: "center" }}>{it.uom}</td>
                  <td style={{ textAlign: "center" }}>{it.qty}</td>
                  <td>{it.hsn || ""}</td>
                  <td style={{ textAlign: "right" }}>{it.unit_price || ""}</td>
                  <td style={{ textAlign: "right" }}>{it.weight_kg || ""}</td>
                </tr>
              );
            })}
            {(() => {
              const totalCols = isOem ? 12 : 13;
              const qtyColIndex = isOem ? 8 : 9; // 0-based index of Qty column
              return (
                <tr style={{ fontWeight: 700, background: "#f8fafc" }}>
                  <td colSpan={qtyColIndex} style={{ textAlign: "right" }}>Total Qty</td>
                  <td style={{ textAlign: "center" }}>
                    {(c.items || []).reduce((s, it) => s + (parseFloat(it.qty) || 0), 0)}
                  </td>
                  <td colSpan={totalCols - qtyColIndex - 1}></td>
                </tr>
              );
            })()}
          </tbody>
        </table>

        {/* Remarks */}
        {(c.dispatch_remarks || c.internal_remarks) && (
          <div style={{ fontSize: 11, marginBottom: 6, border: "1px solid #333", padding: 6 }}>
            {c.dispatch_remarks && <div><b>Dispatch Remarks:</b> {c.dispatch_remarks}</div>}
            {c.internal_remarks && <div><b>Internal Remarks:</b> {c.internal_remarks}</div>}
          </div>
        )}

        {/* Terms */}
        <div style={{ fontSize: 10, marginBottom: 10, border: "1px solid #333", padding: 6 }}>
          <b>Terms &amp; Conditions:</b>
          <ol style={{ margin: "4px 0 0 18px", padding: 0 }}>
            <li>Goods once dispatched will not be taken back without prior written consent.</li>
            <li>Goods received in good condition by the consignee.</li>
            <li>Subject to company dispatch policies and applicable jurisdiction.</li>
          </ol>
        </div>

        {/* Signatures */}
        <table>
          <tbody>
            <tr>
              {[
                { label: "Prepared By", val: c.prepared_by },
                { label: "Checked By", val: c.checked_by },
                { label: "Authorized Signatory", val: c.approved_by },
              ].map((s) => (
                <td key={s.label} style={{ height: 70, verticalAlign: "bottom", textAlign: "center", width: "33%" }}>
                  <div style={{ borderTop: "1px solid #000", paddingTop: 4, marginTop: 40, fontSize: 11, fontWeight: 600 }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 10 }}>{s.val || ""}</div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {!isOem && (
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <td style={{ height: 70, verticalAlign: "bottom" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>RECEIVED BY CUSTOMER</div>
                  <div style={{ display: "flex", gap: 16, fontSize: 10 }}>
                    <div style={{ flex: 1 }}>Name: ____________________</div>
                    <div style={{ flex: 1 }}>Signature: ________________</div>
                    <div style={{ flex: 1 }}>Date: _____________________</div>
                    <div style={{ flex: 1 }}>Stamp: ____________________</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}