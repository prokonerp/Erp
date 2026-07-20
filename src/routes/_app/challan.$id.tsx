import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Download } from "lucide-react";
import { fetchChallan, type DeliveryChallan } from "@/lib/challan";
import { getOemLogo } from "@/lib/oemLogos";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { downloadElementAsPdf } from "@/lib/docPdf";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/challan/$id")({
  component: ChallanView,
  head: () => ({ meta: [{ title: "Delivery Challan — Prokon" }] }),
});

function ChallanView() {
  const { id } = Route.useParams();
  const [c, setC] = useState<DeliveryChallan | null>(null);

  useEffect(() => {
    fetchChallan(id).then(setC).catch((e) => toast.error(e.message));
  }, [id]);

  if (!c) return <div className="text-muted-foreground">Loading…</div>;
  const isOem = c.doc_type === "oem";
  const oemLogo = isOem ? (c.oem_logo_url ? { url: c.oem_logo_url, alt: c.party_name || "OEM" } : getOemLogo(c.party_name)) : null;

  const handleDownload = async () => {
    const el = document.getElementById("print-area");
    if (!el) return;
    try {
      await downloadElementAsPdf(el, `DC_${c.challan_no || c.id}.pdf`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to generate PDF");
    }
  };

  const items = c.items || [];
  const rowCount = items.length;
  const fitSingle = rowCount <= 12;
  const fmt = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalQty = items.reduce((s, it) => s + (parseFloat(it.qty) || 0), 0);
  const totalAmt = items.reduce((s, it) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.unit_price || "0") || 0), 0);

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm 8mm; }
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
        #print-area { font-family: 'Roboto', 'Helvetica Neue', Helvetica, 'Open Sans', Arial, sans-serif; color: #111; }
        #print-area table { border-collapse: collapse; width: 100%; }
        #print-area th, #print-area td { border: 0.5px solid #444; padding: 4px 6px; font-size: 9px; line-height: 1.2; vertical-align: middle; }
        #print-area .desc-cell { vertical-align: top; }
        #print-area .desc-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; }
        #print-area thead { display: table-header-group; }
        #print-area tfoot { display: table-footer-group; }
      `}</style>

      <div className="no-print flex items-center justify-between mb-4">
        <Link to={isOem ? "/challan/oem" : "/challan/customer"}>
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />Download PDF
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" />Print
          </Button>
        </div>
      </div>

      <div
        id="print-area"
        className="bg-white text-black mx-auto shadow print:shadow-none"
        style={{
          width: "194mm",
          minHeight: "277mm",
          padding: 0,
          transform: fitSingle && rowCount > 8 ? "scale(0.97)" : undefined,
          transformOrigin: "top left",
        }}
      >
        {/* Header — stacked logos top-left, company details right */}
        <div style={{ display: "flex", borderBottom: "1.5px solid #000", paddingBottom: 6, minHeight: 90, maxHeight: 90 }}>
          <div style={{ width: 130, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-start", gap: 6, paddingRight: 8 }}>
            <img src={prokonLogo.url} alt="Prokon" style={{ width: 115, maxHeight: 40, objectFit: "contain" }} />
            {oemLogo && (
              <img src={oemLogo.url} alt={oemLogo.alt} style={{ width: 115, maxHeight: 40, objectFit: "contain" }} />
            )}
          </div>
          <div style={{ flex: 1, textAlign: "right", fontSize: 10, lineHeight: 1.35 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e3a8a" }}>PROKON HI-TECH SYSTEMS PVT. LTD.</div>
            <div>Regd. Office: B-505, Picasso Centre, Sector-61, Gurgaon, Haryana</div>
            <div><b>Mobile:</b> 8800890483 &nbsp;|&nbsp; <b>Email:</b> Services@prokonhitech.com</div>
            <div><b>GST No:</b> 06AEHPA2697G1ZL</div>
            {isOem && c.party_name && (
              <div style={{ marginTop: 3, fontSize: 9, borderTop: "1px dashed #999", paddingTop: 3 }}>
                <b>OEM:</b> {c.party_name}{c.oem_plant ? ` — ${c.oem_plant}` : ""}
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <div style={{ textAlign: "center", margin: "6px 0" }}>
          <div style={{ display: "inline-block", border: "1.5px solid #000", padding: "2px 14px", fontWeight: 700, letterSpacing: 2, fontSize: 12 }}>
            DELIVERY CHALLAN
          </div>
          <div style={{ fontSize: 10, marginTop: 2 }}>
            <b>Type:</b> {isOem ? "TO OEM" : "TO CUSTOMER"} &nbsp;|&nbsp;
            <b>Challan No:</b> <span style={{ fontFamily: "monospace" }}>{c.challan_no}</span> &nbsp;|&nbsp;
            <b>Date:</b> {c.challan_date}
          </div>
        </div>

        {/* Consignee & Dispatch */}
        <table style={{ marginBottom: 4 }}>
          <tbody>
            <tr>
              <td style={{ width: "50%", verticalAlign: "top" }}>
                <div style={{ fontWeight: 700, fontSize: 10, marginBottom: 2 }}>CONSIGNEE DETAILS</div>
                <div style={{ fontSize: 9.5, lineHeight: 1.35 }}>
                  <div><b>{isOem ? "OEM" : "Customer"}:</b> {c.party_name}</div>
                  {c.party_code && <div><b>Code:</b> {c.party_code}</div>}
                  {c.gstin && <div><b>GSTIN:</b> {c.gstin}</div>}
                  {c.delivery_address && <div><b>Address:</b> {c.delivery_address}</div>}
                  {c.contact_person && <div><b>Contact:</b> {c.contact_person}</div>}
                  {c.contact_number && <div><b>Phone:</b> {c.contact_number}</div>}
                  {c.email && <div><b>Email:</b> {c.email}</div>}
                </div>
              </td>
              <td style={{ width: "50%", verticalAlign: "top" }}>
                <div style={{ fontWeight: 700, fontSize: 10, marginBottom: 2 }}>DISPATCH DETAILS</div>
                <div style={{ fontSize: 9.5, lineHeight: 1.35 }}>
                  {c.dispatch_date && <div><b>Dispatch Date:</b> {c.dispatch_date}</div>}
                  {c.vehicle_number && <div><b>Vehicle No:</b> {c.vehicle_number}</div>}
                  {c.transporter_name && <div><b>Transporter:</b> {c.transporter_name}</div>}
                  {c.lr_number && <div><b>LR No:</b> {c.lr_number}</div>}
                  {c.gate_pass_no && <div><b>Gate Pass No:</b> {c.gate_pass_no}</div>}
                  {c.mode_of_transport && <div><b>Mode:</b> {c.mode_of_transport}</div>}
                  {(c.driver_name || c.driver_mobile) && <div><b>Driver:</b> {c.driver_name} {c.driver_mobile ? `(${c.driver_mobile})` : ""}</div>}
                  {(c.num_packages || c.total_weight) && <div><b>Pkgs/Weight:</b> {c.num_packages || "-"} / {c.total_weight || "-"}</div>}
                  {(c.sales_order_no || c.customer_po_no || c.invoice_no || c.reference_no) && (
                    <div style={{ marginTop: 2, fontSize: 9 }}>
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

        {/* Material table — GST format */}
        <table style={{ marginBottom: 4 }}>
          <colgroup>
            <col style={{ width: "5%" }} />
            <col style={{ width: "45%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "20%" }} />
          </colgroup>
          <thead style={{ background: "#eef2ff" }}>
            <tr>
              <th style={{ textAlign: "center" }}>Sr</th>
              <th style={{ textAlign: "left" }}>Description of Goods</th>
              <th style={{ textAlign: "center" }}>HSN</th>
              <th style={{ textAlign: "center" }}>Qty</th>
              <th style={{ textAlign: "right" }}>Rate</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const productLabel = [it.part_name, it.part_no].filter(Boolean).join(" — ");
              const rate = parseFloat(it.unit_price || "0") || 0;
              const qty = parseFloat(it.qty) || 0;
              const amount = rate * qty;
              const meta: string[] = [];
              if (isOem) {
                if (it.model_no) meta.push(`Model: ${it.model_no}`);
                const sn = it.good_defective_serial || it.serial_no;
                if (sn) meta.push(`S/N: ${sn}`);
                if (it.oracle_no) meta.push(`Oracle#: ${it.oracle_no}`);
                if (it.stock_type) meta.push(it.stock_type);
              } else {
                if (it.defective_model) meta.push(`Def Model: ${it.defective_model}`);
                if (it.defective_serial) meta.push(`Def S/N: ${it.defective_serial}`);
                if (it.good_model) meta.push(`Good Model: ${it.good_model}`);
                if (it.good_serial) meta.push(`Good S/N: ${it.good_serial}`);
                if (it.oracle_no) meta.push(`Oracle#: ${it.oracle_no}`);
              }
              if (it.oem_ref_id) meta.push(`OEM Ref: ${it.oem_ref_id}`);
              return (
                <tr key={i}>
                  <td style={{ textAlign: "center" }}>{i + 1}</td>
                  <td className="desc-cell">
                    <div className="desc-clamp" style={{ fontWeight: 600 }}>{productLabel}</div>
                    {(it.description || meta.length > 0) && (
                      <div className="desc-clamp" style={{ fontSize: 8.5, color: "#555" }}>
                        {[it.description, meta.join(" • ")].filter(Boolean).join(" — ")}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>{it.hsn || ""}</td>
                  <td style={{ textAlign: "center" }}>{qty} {it.uom ? <span style={{ color: "#666" }}>{it.uom}</span> : null}</td>
                  <td style={{ textAlign: "right" }}>{rate ? fmt(rate) : ""}</td>
                  <td style={{ textAlign: "right" }}>{amount ? fmt(amount) : ""}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, background: "#f8fafc" }}>
              <td colSpan={3} style={{ textAlign: "right" }}>Total</td>
              <td style={{ textAlign: "center" }}>{totalQty}</td>
              <td></td>
              <td style={{ textAlign: "right" }}>{totalAmt ? fmt(totalAmt) : ""}</td>
            </tr>
          </tfoot>
        </table>

        {/* Remarks */}
        {(c.dispatch_remarks || c.internal_remarks) && (
          <div style={{ fontSize: 9, marginBottom: 4, border: "0.5px solid #444", padding: 4 }}>
            {c.dispatch_remarks && <div><b>Dispatch Remarks:</b> {c.dispatch_remarks}</div>}
            {c.internal_remarks && <div><b>Internal Remarks:</b> {c.internal_remarks}</div>}
          </div>
        )}

        {/* Compact footer — Terms | Bank | Signatory */}
        <table style={{ marginTop: 4, maxHeight: 80 }}>
          <colgroup>
            <col style={{ width: "40%" }} />
            <col style={{ width: "35%" }} />
            <col style={{ width: "25%" }} />
          </colgroup>
          <tbody>
            <tr>
              <td style={{ fontSize: 8, verticalAlign: "top", lineHeight: 1.3 }}>
                <b>Terms &amp; Conditions:</b>
                <div>1. Goods once dispatched will not be taken back without prior written consent.</div>
                <div>2. Goods received in good condition by the consignee; subject to jurisdiction.</div>
              </td>
              <td style={{ fontSize: 8, verticalAlign: "top", lineHeight: 1.4 }}>
                <b>Bank Details:</b>
                <div>HDFC Bank • A/C 50200012345678 • IFSC HDFC0000123 • Gurgaon</div>
                {!isOem && (
                  <div style={{ marginTop: 4 }}>
                    <b>Received By Customer:</b>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{ flex: 1 }}>Name: ______</span>
                      <span style={{ flex: 1 }}>Sign: ______</span>
                    </div>
                  </div>
                )}
              </td>
              <td style={{ fontSize: 8, textAlign: "center", verticalAlign: "top" }}>
                <div style={{ fontWeight: 700 }}>For PROKON HI-TECH SYSTEMS PVT. LTD.</div>
                <div style={{ height: 32 }}></div>
                <div style={{ borderTop: "0.5px solid #000", paddingTop: 2, fontWeight: 600 }}>Authorized Signatory</div>
                <div>{c.approved_by || c.prepared_by || ""}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}