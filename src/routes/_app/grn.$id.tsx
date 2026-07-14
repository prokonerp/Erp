import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import { fetchGrn, CATEGORY_LABEL, type Grn } from "@/lib/grn";
import { getOemLogo } from "@/lib/oemLogos";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/grn/$id")({
  component: GrnView,
  head: () => ({ meta: [{ title: "GRN — Prokon" }] }),
});

function GrnView() {
  const { id } = Route.useParams();
  const [g, setG] = useState<Grn | null>(null);

  useEffect(() => {
    fetchGrn(id).then(setG).catch((e) => toast.error(e.message));
  }, [id]);

  if (!g) return <div className="text-muted-foreground">Loading…</div>;
  const isOem = g.category === "oem";
  const oemLogo = isOem ? (g.oem_logo_url ? { url: g.oem_logo_url, alt: g.source_name || "OEM" } : getOemLogo(g.source_name)) : null;
  const backTo = `/grn/${g.category}` as "/grn/customer" | "/grn/oem" | "/grn/general";

  const totals = (g.items || []).reduce((acc, it) => {
    const q = parseFloat(it.qty_received ?? it.qty_accepted ?? it.qty) || 0;
    acc.q += q;
    const cond = String(it.condition || "").toLowerCase();
    if (cond === "bad" || cond === "defective") acc.j += q;
    else acc.a += q;
    return acc;
  }, { q: 0, a: 0, j: 0 });

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body * { visibility: hidden; }
          #print-area, #print-area * { visibility: visible; }
          #print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
        #print-area { font-family: Arial, Helvetica, sans-serif; color: #111; }
        #print-area table { border-collapse: collapse; width: 100%; }
        #print-area th, #print-area td { border: 1px solid #333; padding: 4px 6px; font-size: 11px; vertical-align: top; }
        #print-area thead { display: table-header-group; }
      `}</style>

      <div className="no-print flex items-center justify-between mb-4">
        <Link to={backTo}>
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        </Link>
        <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print / PDF</Button>
      </div>

      <div id="print-area" className="bg-white text-black mx-auto shadow print:shadow-none" style={{ width: "190mm", minHeight: "277mm", padding: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", borderBottom: "2px solid #000", paddingBottom: 8 }}>
          <div style={{ width: isOem ? "35%" : "30%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingRight: 8 }}>
            <img src={prokonLogo.url} alt="Prokon" style={{ maxHeight: isOem ? 45 : 60, objectFit: "contain" }} />
            {isOem && oemLogo && (
              <img src={oemLogo.url} alt={oemLogo.alt} style={{ maxHeight: 45, objectFit: "contain" }} />
            )}
          </div>
          <div style={{ width: isOem ? "65%" : "70%", textAlign: "right", fontSize: 11, lineHeight: 1.4 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e3a8a" }}>PROKON HI-TECH SYSTEMS PVT. LTD.</div>
            <div>Regd. Office: B-505, Picasso Centre, Sector-61, Gurgaon, Haryana</div>
            <div>Factory: Plot 12, Industrial Area, Gurgaon</div>
            <div>GSTIN: 06AAACP1234A1Z5 &nbsp;|&nbsp; Phone: +91-124-0000000</div>
            <div>Email: info@prokon.in &nbsp;|&nbsp; Web: www.prokon.in</div>
          </div>
        </div>

        {/* Title */}
        <div style={{ textAlign: "center", margin: "8px 0" }}>
          <div style={{ display: "inline-block", border: "2px solid #000", padding: "4px 16px", fontWeight: 700, letterSpacing: 2, fontSize: 14 }}>
            GOODS RECEIPT NOTE (GRN)
          </div>
          <div style={{ fontSize: 12, marginTop: 4, fontWeight: 700, letterSpacing: 1 }}>
            {CATEGORY_LABEL[g.category].toUpperCase()}
          </div>
          <div style={{ fontSize: 11, marginTop: 2 }}>
            <b>GRN No:</b> <span style={{ fontFamily: "monospace" }}>{g.grn_no}</span> &nbsp;&nbsp;
            <b>Date:</b> {g.grn_date}
            {g.receipt_date && <> &nbsp;&nbsp;<b>Received:</b> {g.receipt_date}</>}
          </div>
        </div>

        {/* Source & GRN info */}
        <table style={{ marginBottom: 6 }}>
          <tbody>
            <tr>
              <td style={{ width: "50%" }}>
                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2 }}>SOURCE DETAILS</div>
                <div style={{ fontSize: 11 }}>
                  <div><b>{isOem ? "OEM" : g.category === "customer" ? "Customer" : "Vendor / Source"}:</b> {g.source_name}</div>
                  {g.source_code && <div><b>Code:</b> {g.source_code}</div>}
                  {g.source_gstin && <div><b>GSTIN:</b> {g.source_gstin}</div>}
                  {g.oem_plant && <div><b>Plant:</b> {g.oem_plant}</div>}
                  {g.source_address && <div><b>Address:</b> {g.source_address}</div>}
                  {g.source_contact_person && <div><b>Contact:</b> {g.source_contact_person}</div>}
                  {g.source_contact_number && <div><b>Phone:</b> {g.source_contact_number}</div>}
                  {g.source_email && <div><b>Email:</b> {g.source_email}</div>}
                </div>
              </td>
              <td style={{ width: "50%" }}>
                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2 }}>GRN INFORMATION</div>
                <div style={{ fontSize: 11 }}>
                  <div><b>GRN No:</b> {g.grn_no}</div>
                  <div><b>GRN Date:</b> {g.grn_date}</div>
                  {g.source_doc_type && <div><b>Source Doc:</b> {g.source_doc_type} {g.source_doc_no} {g.source_doc_date ? `(${g.source_doc_date})` : ""}</div>}
                  {g.reference_no && <div><b>Reference:</b> {g.reference_no}</div>}
                  {g.po_no && <div><b>PO No:</b> {g.po_no}</div>}
                  {g.invoice_no && <div><b>Invoice:</b> {g.invoice_no} {g.invoice_date ? `(${g.invoice_date})` : ""}</div>}
                  {g.ticket_no && <div><b>Ticket:</b> {g.ticket_no}</div>}
                  {g.vehicle_number && <div><b>Vehicle:</b> {g.vehicle_number}</div>}
                  {g.transporter_name && <div><b>Transporter:</b> {g.transporter_name}</div>}
                  {g.lr_number && <div><b>LR No:</b> {g.lr_number}</div>}
                  {(g.driver_name || g.driver_mobile) && <div><b>Driver:</b> {g.driver_name} {g.driver_mobile ? `(${g.driver_mobile})` : ""}</div>}
                  {(g.num_packages || g.total_weight) && <div><b>Pkgs/Weight:</b> {g.num_packages || "-"} / {g.total_weight || "-"}</div>}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Material */}
        <table style={{ marginBottom: 6 }}>
          <thead style={{ background: "#eef2ff" }}>
            <tr>
              <th style={{ width: 28 }}>Sr</th>
              <th>Part No</th>
              <th>Part Name / Description</th>
              {!isCustomerCat(g.category) && <th>Model</th>}
              {!isCustomerCat(g.category) && <th>Serial</th>}
              <th style={{ width: 50 }}>UOM</th>
              <th style={{ width: 60 }}>Qty</th>
              <th style={{ width: 70 }}>Condition</th>
            </tr>
          </thead>
          <tbody>
            {(g.items || []).map((it, i) => (
              <tr key={i}>
                <td style={{ textAlign: "center" }}>{i + 1}</td>
                <td>{it.part_no}</td>
                <td>{it.part_name}{it.description ? ` — ${it.description}` : ""}</td>
                {!isCustomerCat(g.category) && <td>{it.model_no || ""}</td>}
                {!isCustomerCat(g.category) && <td>{it.serial_no || ""}</td>}
                <td style={{ textAlign: "center" }}>{it.uom}</td>
                <td style={{ textAlign: "right" }}>{it.qty_received ?? it.qty_accepted ?? it.qty ?? ""}</td>
                <td style={{ textAlign: "center", textTransform: "capitalize" }}>
                  {(() => {
                    const c = String(it.condition || "").toLowerCase();
                    if (!c) return "-";
                    if (c === "defective" || c === "bad") return "Bad";
                    if (c === "good") return "Good";
                    return it.condition;
                  })()}
                </td>
              </tr>
            ))}
            {Array.from({ length: Math.max(0, 3 - (g.items?.length || 0)) }).map((_, i) => (
              <tr key={`e${i}`}><td>&nbsp;</td><td></td><td></td>{!isCustomerCat(g.category) && <td></td>}{!isCustomerCat(g.category) && <td></td>}<td></td><td></td><td></td></tr>
            ))}
            <tr style={{ fontWeight: 700, background: "#f8fafc" }}>
              <td colSpan={isCustomerCat(g.category) ? 5 : 7} style={{ textAlign: "right" }}>Total Qty</td>
              <td style={{ textAlign: "right" }}>{totals.q}</td>
              <td></td>
            </tr>
          </tbody>
        </table>

        {/* QC + Storage summary */}
        <table style={{ marginBottom: 6 }}>
          <tbody>
            <tr>
              <td style={{ width: "50%" }}>
                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2 }}>QUALITY INSPECTION</div>
                <div style={{ fontSize: 11 }}>
                  <div><b>QC Status:</b> {g.qc_status || "-"}</div>
                  <div><b>Inspector:</b> {g.qc_inspector || "-"}</div>
                  <div><b>QC Date:</b> {g.qc_date || "-"}</div>
                  <div><b>Accepted:</b> {g.accepted_qty ?? totals.a} &nbsp; <b>Rejected:</b> {g.rejected_qty ?? totals.j}</div>
                  {g.qc_remarks && <div><b>Remarks:</b> {g.qc_remarks}</div>}
                </div>
              </td>
              <td style={{ width: "50%" }}>
                <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 2 }}>STORAGE</div>
                <div style={{ fontSize: 11 }}>
                  <div><b>Warehouse:</b> {g.warehouse_name || "-"}</div>
                  <div><b>Location:</b> {g.storage_location || "-"}</div>
                  <div><b>Bin / Rack:</b> {g.bin_no || "-"}</div>
                  <div><b>Status:</b> {g.status}</div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {(g.receipt_remarks || g.internal_remarks) && (
          <div style={{ fontSize: 11, marginBottom: 6, border: "1px solid #333", padding: 6 }}>
            {g.receipt_remarks && <div><b>Receipt Remarks:</b> {g.receipt_remarks}</div>}
            {g.internal_remarks && <div><b>Internal Remarks:</b> {g.internal_remarks}</div>}
          </div>
        )}

        {/* Signatures */}
        <table>
          <tbody>
            <tr>
              {[
                { label: "Received By", val: g.received_by },
                { label: "Checked By / QC", val: g.checked_by },
                { label: "Approved By", val: g.approved_by },
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
      </div>
    </>
  );
}

function isCustomerCat(c: string) { return c === "customer"; }