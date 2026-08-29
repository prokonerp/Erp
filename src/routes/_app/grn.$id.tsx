import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PageLoader } from "@/components/shared/skeletons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Printer, Download, CheckCircle2, Ban, Pencil } from "lucide-react";
import { fetchGrn, CATEGORY_LABEL, type Grn } from "@/lib/grn";
import { getOemLogo } from "@/lib/oemLogos";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { downloadElementAsPdf } from "@/lib/docPdf";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { useIsAdmin } from "@/lib/useRole";
import { AdminDeleteDialog } from "@/components/AdminDeleteDialog";
import { ControlledActionDialog } from "@/components/ControlledActionDialog";
import { DEFAULT_COMPANY_PROFILE, fetchCompanyProfile, type CompanyProfile } from "@/lib/companyProfile";
import { headerToCompanyProfile } from "@/lib/documentHeader";
import { usePrintOptions } from "@/components/PrintOptionsDialog";

export const Route = createFileRoute("/_app/grn/$id")({
  component: GrnView,
  head: () => ({ meta: [{ title: "GRN — Prokon" }] }),
});

function GrnView() {
  const confirm = useConfirm();
  const { id } = Route.useParams();
  const [g, setG] = useState<Grn | null>(null);
  const [busy, setBusy] = useState(false);
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [invoiceLinked, setInvoiceLinked] = useState(false);
  const [wasEdited, setWasEdited] = useState(false);
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const printer = usePrintOptions();
  const printPendingRef = useRef(false);

  useEffect(() => { fetchCompanyProfile().then(setCompany).catch(() => {}); }, []);

  useEffect(() => {
    fetchGrn(id).then(setG).catch((e) => toast.error(e.message));
  }, [id]);

  // Apply the dialog-chosen letterhead before printing.
  useEffect(() => {
    if (printPendingRef.current) {
      printPendingRef.current = false;
      const t = setTimeout(() => window.print(), 120);
      return () => clearTimeout(t);
    }
  }, [company]);

  // Auto-start the PDF download when opened with ?download=1 (from the
  // Indent Oracle pipeline "Download PDF" button).
  const autoDownloaded = useState(() => ({ done: false }))[0];
  useEffect(() => {
    if (!g || autoDownloaded.done) return;
    if (new URLSearchParams(window.location.search).get("download") !== "1") return;
    autoDownloaded.done = true;
    const t = setTimeout(async () => {
      const el = document.getElementById("print-area");
      if (!el) return;
      try { await downloadElementAsPdf(el, `GRN_${g.grn_no || g.id}.pdf`); } catch { /* ignore */ }
    }, 800);
    return () => clearTimeout(t);
  }, [g, autoDownloaded]);

  useEffect(() => {
    if (!g?.grn_no) return;
    (async () => {
      // "Edited" badge — any audit row of type grn_edit_reverse for this GRN.
      const { data: audit } = await supabase
        .from("document_deletion_audit")
        .select("id")
        .eq("document_id", g.id)
        .in("document_type", ["grn_edit_reverse", "grn_reopen"])
        .limit(1);
      setWasEdited((audit || []).length > 0);

      // Invoice-linkage guard: any invoice_items row whose serial_numbers
      // overlaps a serial produced by this GRN.
      const serials = (g.items || [])
        .map((it) => (it.serial_no || "").trim())
        .filter(Boolean);
      if (serials.length === 0) { setInvoiceLinked(false); return; }
      const { data: inv } = await supabase
        .from("invoice_items")
        .select("id")
        .overlaps("serial_numbers", serials)
        .limit(1);
      setInvoiceLinked((inv || []).length > 0);
    })();
  }, [g?.id, g?.grn_no]);

  if (!g) return <PageLoader />;
  const isOem = g.category === "oem";
  const oemLogo = isOem ? (g.oem_logo_url ? { url: g.oem_logo_url, alt: g.source_name || "OEM" } : getOemLogo(g.source_name)) : null;
  const backTo = `/grn/${g.category}` as "/grn/customer" | "/grn/oem" | "/grn/general";
  const status = g.status || "Draft";
  const isDraft = status === "Draft";
  const isSubmitted = status === "Submitted";
  const isCancelled = status === "Cancelled";

  const handleDownload = async () => {
    const el = document.getElementById("print-area");
    if (!el) return;
    try {
      await downloadElementAsPdf(el, `GRN_${g.grn_no || g.id}.pdf`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to generate PDF");
    }
  };

  const handleSubmit = async () => {
    if (!isDraft) return;
    const ok = await confirm({
      title: "Submit this GRN?",
      description: "The GRN is locked and the received stock is posted to the IMS Stock Ledger.",
      confirmLabel: "Submit GRN",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("grns" as never)
      .update({ status: "Submitted", submitted_by: u.user?.id ?? null, submitted_at: new Date().toISOString() } as never)
      .eq("id", g.id)
      .select("*")
      .maybeSingle();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (data) setG(data as unknown as Grn);
    toast.success("GRN submitted. Stock ledger updated.");
  };

  const handleCancel = async () => {
    if (!isSubmitted) return;
    const ok = await confirm({
      title: "Cancel this submitted GRN?",
      description: "The GRN is marked Cancelled and its related stock ledger entries are reversed.",
      confirmLabel: "Cancel GRN",
      variant: "danger",
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase
      .from("grns" as never)
      .update({ status: "Cancelled" } as never)
      .eq("id", g.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setG({ ...g, status: "Cancelled" });
    toast.success("GRN cancelled. Stock reversed.");
  };

  const handlePrint = async () => {
    if (!g.printed_at) {
      const { data: u } = await supabase.auth.getUser();
      void supabase
        .from("grns" as never)
        .update({ printed_by: u.user?.id ?? null, printed_at: new Date().toISOString() } as never)
        .eq("id", g.id);
    }
    const choice = await printer.ask({
      docType: "grn",
      title: "Print GRN",
      description: "Choose which office details appear on the GRN letterhead.",
      defaultSource: g.branch_id ? { kind: "branch", id: g.branch_id } : null,
      allowCopyLabel: false,
      allowSupplyFrom: false,
    });
    if (!choice) return;
    setCompany(headerToCompanyProfile(choice.header));
    printPendingRef.current = true;
  };

  const totals = (g.items || []).reduce((acc, it) => {
    const q = parseFloat(it.qty_received ?? it.qty_accepted ?? "") || 0;
    acc.q += q;
    const cond = String(it.condition || "").toLowerCase();
    if (cond === "bad" || cond === "defective") acc.j += q;
    else acc.a += q;
    return acc;
  }, { q: 0, a: 0, j: 0 });

  return (
    <>
      {printer.element}
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
        /* Full-width boxes sit flush with the page margins — drop their side
           borders in print so no frame line prints along the page edge. */
        @media print { .print-open-box { border-left: none !important; border-right: none !important; } }
      `}</style>

      <div className="no-print mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/grn">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back to All GRN</Button>
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isSubmitted ? "default" : isCancelled ? "destructive" : "secondary"}>{status}</Badge>
            {wasEdited && (
              <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">Edited</Badge>
            )}
            {isDraft && (
              <Link to="/grn/$id/edit" params={{ id: g.id }}>
                <Button variant="outline" size="sm">Edit</Button>
              </Link>
            )}
            {isAdmin && isSubmitted && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setEditOpen(true)}
                disabled={busy || invoiceLinked}
                title={invoiceLinked ? "Invoice exists — create correction entry instead" : "Reverse stock and open for editing"}
              >
                <Pencil className="h-4 w-4" />Edit GRN
              </Button>
            )}
            {isDraft && (
              <Button size="sm" onClick={handleSubmit} disabled={busy} className="gap-1.5">
                <CheckCircle2 className="h-4 w-4" />Submit
              </Button>
            )}
            {isSubmitted && (
              <Button size="sm" variant="outline" onClick={handleCancel} disabled={busy} className="gap-1.5">
                <Ban className="h-4 w-4" />Cancel
              </Button>
            )}
            {isAdmin && (
              <AdminDeleteDialog
                kind="grn"
                id={g.id}
                label={`GRN ${g.grn_no}`}
                onDeleted={() => navigate({ to: backTo })}
              />
            )}
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" />Download PDF
            </Button>
            <Button size="sm" onClick={handlePrint} disabled={isDraft} title={isDraft ? "Submit the document before printing" : ""}>
              <Printer className="h-4 w-4 mr-1" />Print
            </Button>
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Review &amp; Print Preview</span>.
          {isDraft && " Draft GRN — click Submit to lock it and add stock to the IMS Stock Ledger."}
          {isSubmitted && g.submitted_at && ` Submitted on ${new Date(g.submitted_at).toLocaleString()}.`}
          {g.printed_at && ` · Last printed ${new Date(g.printed_at).toLocaleString()}.`}
          {invoiceLinked && (
            <span className="ml-1 text-destructive">
              · Invoice linked — editing is blocked. Create a correction entry instead.
            </span>
          )}
        </div>
      </div>

      <ControlledActionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Edit GRN ${g.grn_no}?`}
        description="Editing will reverse all stock ledger entries created by this GRN, move it back to Draft, and record an audit trail. Serial numbers, quantities, warehouse and QC fields can be corrected before you re-submit."
        warning="Editing GRN will impact stock and audit trail. Item/Model and Indent linkage cannot be changed."
        confirmLabel="Reverse stock & open for edit"
        reasonPlaceholder="e.g., Wrong serial captured, warehouse mismatch, qty correction…"
        onConfirm={async ({ reason }) => {
          setBusy(true);
          const { error } = await supabase.rpc("admin_edit_grn_reverse" as never, { _id: g.id, _reason: reason } as never);
          setBusy(false);
          if (error) return { error: error.message };
          toast.success("Stock reversed. Opening GRN for edit.");
          navigate({ to: "/grn/$id/edit", params: { id: g.id } });
        }}
      />

      <div id="print-area" className="bg-white text-black mx-auto shadow print:shadow-none" style={{ width: "190mm", minHeight: "277mm", padding: 0 }}>
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
          {g.warehouse_name && (
            <div style={{ fontSize: 11, marginTop: 2 }}>
              <b>Received Into:</b> {g.warehouse_name}
            </div>
          )}
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
                <td style={{ textAlign: "right" }}>{it.qty_received ?? it.qty_accepted ?? ""}</td>
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
          <div className="print-open-box" style={{ fontSize: 11, marginBottom: 6, border: "1px solid #333", padding: 6 }}>
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