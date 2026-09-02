import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/shared/skeletons";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Printer,
  Download,
  Zap,
  Truck,
  Ban,
  ArrowLeft,
  Wallet,
  Lock,
  FileJson,
  ClipboardPaste,
} from "lucide-react";
import {
  fetchInvoiceWithItems,
  fetchBranches,
  inr,
  statusMeta,
  SALES_TYPE_META,
  type BranchRow,
  type InvoiceItemRow,
  type InvoiceRow,
} from "@/lib/sales";
import { mockIrnPayload } from "@/lib/gst";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { downloadInvoicePdfBulk, printInvoicePdfBulk } from "@/lib/invoicePdf";
import InvoicePrintModal from "@/components/InvoicePrintModal";
import { getDocumentHeader } from "@/lib/letterhead";
import type { CompanyProfile } from "@/lib/companyProfile";
import { signSignatureUrl } from "@/lib/userSignature";
import { getCurrentUserName } from "@/lib/currentUser";
import {
  buildGstInvoiceJson,
  buildEwayJson,
  parseGstPortalIrnResponse,
  parseEwayResponse,
  getInvoiceCompletionStatus,
} from "@/lib/einvoice";
import type { TransportDetails } from "@/lib/transport";

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
  const [customer, setCustomer] = useState<any>(null);
  const [pdfTheme, setPdfTheme] = useState<{ themeColor: string; copyLabel: string }>({ themeColor: "#000000", copyLabel: "Original Copy" });
  const [pdfSettings, setPdfSettings] = useState<{ company_name: string | null; company_address: string | null; udyam_no: string | null; phone: string | null; email: string | null } | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [showSupplyFrom, setShowSupplyFrom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authorisedSignatureUrl, setAuthorisedSignatureUrl] = useState<string | null>(null);
  const [preparedBy, setPreparedBy] = useState<{ name?: string | null; phone?: string | null; email?: string | null } | null>(null);

  // e-Way form (legacy mock)
  const [ewayOpen, setEwayOpen] = useState(false);
  const [ewayForm, setEwayForm] = useState({ transporter_name: "", transporter_id: "", vehicle_no: "", distance_km: 0, transport_mode: "road" });
  const [cancelReason, setCancelReason] = useState("");

  // ── P1 compliance modals ─────────────────────────────────────
  const [irnModalOpen, setIrnModalOpen] = useState(false);
  const [irnText, setIrnText] = useState("");
  const [ewbModalOpen, setEwbModalOpen] = useState(false);
  const [ewbText, setEwbText] = useState("");
  const [gstGenerating, setGstGenerating] = useState(false);
  const [ewayGenerating, setEwayGenerating] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);

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
      setShowSupplyFrom(true);
      const { data: st } = await supabase.from("invoice_settings").select("theme_color,copy_label,company_name,company_address,udyam_no,phone,email").eq("branch_id", r.invoice.branch_id).maybeSingle();
      if (st) {
        setPdfTheme({ themeColor: (st as any).theme_color || "#000000", copyLabel: (st as any).copy_label || "Original Copy" });
        setPdfSettings({
          company_name: (st as any).company_name ?? null,
          company_address: (st as any).company_address ?? null,
          udyam_no: (st as any).udyam_no ?? null,
          phone: (st as any).phone ?? null,
          email: (st as any).email ?? null,
        });
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Authorised signature for PDF footer (current user). Mirrors quotations.$id & po.$id logic.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user || cancelled) return;
        const name = await getCurrentUserName();
        if (cancelled) return;
        const { data: au } = await supabase
          .from("app_users")
          .select("name,phone,email,signature_url")
          .eq("user_id", u.user.id)
          .maybeSingle();
        if (cancelled) return;
        const row = (au as { name?: string | null; phone?: string | null; email?: string | null; signature_url?: string | null } | null) || null;
        setPreparedBy({
          name: (row?.name || name || u.user.email || "").trim() || null,
          phone: row?.phone || null,
          email: row?.email || u.user.email || null,
        });
        const signed = await signSignatureUrl(row?.signature_url || null);
        if (!cancelled) setAuthorisedSignatureUrl(signed);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  function getTransport(): TransportDetails | null {
    const raw: any = (inv as any)?.transport_details;
    if (!raw) return null;
    if (typeof raw === "string") {
      try { return JSON.parse(raw) as TransportDetails; } catch { return null; }
    }
    if (typeof raw === "object") return raw as TransportDetails;
    return null;
  }

  const completion = useMemo(() => getInvoiceCompletionStatus(inv as any), [inv]);
  const transport = getTransport();
  const isLocked = !!(inv?.irn || transport?.einvoice_irn);

  async function issueIfDraft() {
    if (!inv || inv.status !== "draft") return;
    if (isLocked) return toast.error("Invoice is locked after IRN — cannot re-issue");
    const { error } = await (supabase.from("invoices") as any).update({ status: "issued" }).eq("id", inv.id);
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
    const { error } = await (supabase.from("invoices") as any)
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
    const ewb = `EWB${Date.now().toString().slice(-11)}`;
    const validTill = new Date(Date.now() + 24 * 3600e3).toISOString();
    const { error } = await (supabase.from("eway_bills") as any).insert({
      invoice_id: inv.id,
      ...ewayForm,
      ewb_no: ewb,
      ewb_date: new Date().toISOString(),
      valid_till: validTill,
      status: "generated",
    });
    if (error) return toast.error(error.message);
    await (supabase.from("invoices") as any)
      .update({ ewaybill_no: ewb, ewaybill_date: new Date().toISOString(), ewaybill_valid_till: validTill })
      .eq("id", inv.id);
    toast.success("e-Way Bill generated (mock)");
    setEwayOpen(false);
    load();
  }

  async function handleGenerateGstJson() {
    if (!inv || !branch || !customer) return toast.error("Invoice/branch/customer missing");
    setGstGenerating(true);
    try {
      const tr = getTransport();
      const json = buildGstInvoiceJson(
        inv as any,
        items as any,
        branch as any,
        customer as any,
        tr as any,
        (tr as any)?.dispatch_details ?? null
      );
      const base = (inv.invoice_no || inv.id).replace(/\//g, "_");
      const fname = base.startsWith("PHS_INV") ? `${base}_gst.json` : `PHS_INV_${base}_gst.json`;
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const { error } = await (supabase.from("invoices") as any)
        .update({
          compliance_json: json as any,
          einvoice_status: "json_ready",
        })
        .eq("id", inv.id);
      if (error) throw error;
      toast.success("GST JSON generated — downloaded & stored as json_ready");
      await load();
    } catch (e: any) {
      toast.error(e.message || "GST JSON generation failed");
    } finally {
      setGstGenerating(false);
    }
  }

  // S1/S2: sanitize portal_response — client trust boundary. Raw paste is untrusted;
  // we store only allowlisted parsed fields + truncated raw (no __proto__/constructor keys),
  // validate IRN/EWB shape via parse*Response, and DB trigger comment documents server guard.
  function sanitizeRawPaste(s: string, max = 4000): string {
    // strip control chars, limit size, block prototype pollution payloads from persisting verbatim
    return s.slice(0, max).replace(/\u0000/g, "").replace(/__proto__|constructor|prototype/gi, "");
  }
  function sanitizedPortalResponse(parsed: Record<string, unknown>, raw: string): Record<string, unknown> {
    // allowlist parsed fields only; never store arbitrary keys from client
    const allow = ["irn", "ack_no", "ack_date", "signed_qr", "ewbNo", "ewbDate", "validTill"] as const;
    const safeParsed: Record<string, unknown> = {};
    for (const k of allow) if (k in parsed) safeParsed[k] = (parsed as Record<string, unknown>)[k];
    // if parsed has no allowlisted keys (e.g. IrnParseResult uses signed_qr etc lower?), keep whole parsed but json-round-trip to strip prototypes
    const finalParsed = Object.keys(safeParsed).length ? safeParsed : JSON.parse(JSON.stringify(parsed));
    return { parsed: finalParsed, raw_pasted: sanitizeRawPaste(raw) };
  }

  async function handlePasteIrn() {
    if (!inv) return;
    if (!irnText.trim()) return toast.error("Paste IRN JSON first");
    try {
      const parsed = parseGstPortalIrnResponse(irnText);
      const { data: { user } } = await supabase.auth.getUser();
      const nowIso = new Date().toISOString();
      const tr = getTransport();
      const nextTransport = tr
        ? { ...tr, einvoice_irn: parsed.irn, einvoice_ack_no: parsed.ack_no, einvoice_ack_date: parsed.ack_date, einvoice_qr: parsed.signed_qr }
        : null;
      const payload: any = {
        irn: parsed.irn,
        ack_no: parsed.ack_no,
        ack_date: parsed.ack_date,
        qr_payload: parsed.signed_qr,
        signed_qr: parsed.signed_qr,
        einvoice_status: "generated",
        compliance_pasted_at: nowIso,
        compliance_pasted_by: user?.id ?? null,
        portal_response: sanitizedPortalResponse(parsed as unknown as Record<string, unknown>, irnText) as any,
      };
      if (nextTransport) payload.transport_details = nextTransport as any;
      const { error } = await (supabase.from("invoices") as any).update(payload).eq("id", inv.id);
      if (error) throw error;
      toast.success("IRN pasted — invoice is now locked");
      setIrnModalOpen(false);
      setIrnText("");
      await load();
    } catch (e: any) {
      toast.error(e.message || "IRN paste failed");
    }
  }

  async function handleGenerateEwayJson() {
    if (!inv) return toast.error("Invoice missing");
    setEwayGenerating(true);
    try {
      const tr = getTransport();
      const json = buildEwayJson(inv as any, tr as any, items as any);
      const base = (inv.invoice_no || inv.id).replace(/\//g, "_");
      const fname = `${base}_eway.json`;
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const { error } = await (supabase.from("invoices") as any)
        .update({
          eway_status: "json_ready",
          portal_response: { eway_json: json } as any,
        })
        .eq("id", inv.id);
      if (error) throw error;
      toast.success("E-Way JSON generated — downloaded & stored as json_ready");
      await load();
    } catch (e: any) {
      toast.error(e.message || "E-Way JSON failed");
    } finally {
      setEwayGenerating(false);
    }
  }

  async function handlePasteEwb() {
    if (!inv) return;
    if (!ewbText.trim()) return toast.error("Paste EWB JSON first");
    try {
      const parsed = parseEwayResponse(ewbText);
      const { data: { user } } = await supabase.auth.getUser();
      const nowIso = new Date().toISOString();
      const tr = getTransport();
      const nextTransport = tr
        ? { ...tr, eway_bill_no: parsed.ewbNo, eway_bill_date: parsed.ewbDate, eway_bill_valid_till: parsed.validTill }
        : null;
      const payload: any = {
        ewaybill_no: parsed.ewbNo,
        ewaybill_date: parsed.ewbDate,
        ewaybill_valid_till: parsed.validTill,
        eway_status: "generated",
        compliance_pasted_at: nowIso,
        compliance_pasted_by: user?.id ?? null,
        portal_response: sanitizedPortalResponse(parsed as unknown as Record<string, unknown>, ewbText) as any,
      };
      if (nextTransport) payload.transport_details = nextTransport as any;
      const { error } = await (supabase.from("invoices") as any).update(payload).eq("id", inv.id);
      if (error) throw error;
      toast.success("EWB pasted");
      setEwbModalOpen(false);
      setEwbText("");
      await load();
    } catch (e: any) {
      toast.error(e.message || "EWB paste failed");
    }
  }

  async function cancelInvoice() {
    if (!inv) return;
    if (isLocked) return toast.error("Invoice is locked after IRN — cancel IRN on portal first");
    if (!cancelReason.trim()) return toast.error("Reason required");
    const { error } = await (supabase.from("invoices") as any)
      .update({ status: "cancelled", cancel_reason: cancelReason, cancelled_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (error) return toast.error(error.message);
    toast.success("Invoice cancelled");
    load();
  }

  async function sha256HexBytesLocal(bytes: Uint8Array): Promise<string> {
    try {
      const subtle = (globalThis.crypto as unknown as { subtle?: { digest: (a: string, d: BufferSource) => Promise<ArrayBuffer> } })?.subtle;
      if (subtle?.digest) {
        const buf = await subtle.digest("SHA-256", bytes as BufferSource);
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch { /* fallback */ }
    let h = 0;
    for (let i = 0; i < bytes.length; i++) h = (Math.imul(31, h) + bytes[i]) | 0;
    return Math.abs(h).toString(16).padStart(8, "0");
  }

  async function sha256HexLocal(input: string): Promise<string> {
    return sha256HexBytesLocal(new TextEncoder().encode(input));
  }

  async function hashPdfBytesLocal(ab: ArrayBuffer): Promise<string> {
    return sha256HexBytesLocal(new Uint8Array(ab));
  }

  async function handlePrintAudit(copies: string[], isReprint: boolean) {
    if (!inv) return;
    const nowIso = new Date().toISOString();
    const { data: ud } = await supabase.auth.getUser();
    const userId = ud.user?.id ?? null;
    // H13: pdf_hash must be sha256 of actual PDF bytes, not metadata string. Try to render and hash bytes; fallback to string only if render fails.
    let pdfHash: string;
    try {
      const { renderInvoiceCopies } = await import("@/lib/invoicePdf");
      const tmpDoc = await renderInvoiceCopies({
        invoice: inv,
        items,
        branch,
        customer,
        themeColor: pdfTheme.themeColor,
        copyLabel: pdfTheme.copyLabel,
        settings: pdfSettings,
        company: company ?? undefined,
        copies,
        isReprint,
      } as never);
      const ab = tmpDoc.output("arraybuffer") as ArrayBuffer;
      pdfHash = await hashPdfBytesLocal(ab);
    } catch {
      pdfHash = await sha256HexLocal(copies.join(",") + nowIso + inv.id);
    }
    const nextCount = ((inv as unknown as { print_count?: number | null }).print_count ?? 0) + 1;
    const firstAt = (inv as unknown as { first_printed_at?: string | null }).first_printed_at ?? nowIso;
    // audit insert before opening blob
    const { error: logErr } = await (supabase as unknown as { from: (t: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> } }).from("invoice_print_log").insert({
      invoice_id: inv.id,
      copies,
      copy_labels_snapshot: copies.join("/"),
      theme_color_snapshot: pdfTheme.themeColor,
      is_reprint: isReprint,
      pdf_hash: pdfHash,
      printed_by: userId,
      is_provisional: !completion.complete,
    } as never);
    if (logErr) throw new Error(logErr.message);
    const { error: updErr } = await (supabase as unknown as { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } } }).from("invoices").update({
      print_count: nextCount,
      first_printed_at: firstAt,
      last_printed_at: nowIso,
      last_printed_by: userId,
    } as never).eq("id", inv.id);
    if (updErr) throw new Error(updErr.message);
    // keep local state in sync without full reload
    setInv((prev) => prev ? ({ ...prev, print_count: nextCount, first_printed_at: firstAt, last_printed_at: nowIso } as unknown as typeof prev) : prev);
  }

  async function handleModalPrint(opts: { copies: string[]; isReprint: boolean; showWatermark: boolean; asZip: boolean }): Promise<void> {
    if (!inv || !branch || !company) { toast.error("Invoice data missing"); return; }
    try {
      await handlePrintAudit(opts.copies, opts.isReprint);
      await printInvoicePdfBulk({
        invoice: inv,
        items,
        branch,
        customer,
        themeColor: pdfTheme.themeColor,
        copyLabel: pdfTheme.copyLabel,
        settings: pdfSettings,
        company,
        showSupplyFrom,
        meta: pdfMeta,
        authorisedSignatureUrl,
        preparedBy,
        copies: opts.copies,
        isReprint: opts.isReprint,
        showWatermark: opts.showWatermark,
      } as never);
      toast.success("Print opened — audit logged");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Print failed");
    }
  }

  async function handleModalDownload(opts: { copies: string[]; isReprint: boolean; showWatermark: boolean; asZip: boolean }): Promise<void> {
    if (!inv || !branch || !company) { toast.error("Invoice data missing"); return; }
    try {
      await handlePrintAudit(opts.copies, opts.isReprint);
      await downloadInvoicePdfBulk({
        invoice: inv,
        items,
        branch,
        customer,
        themeColor: pdfTheme.themeColor,
        copyLabel: pdfTheme.copyLabel,
        settings: pdfSettings,
        company,
        showSupplyFrom,
        meta: pdfMeta,
        authorisedSignatureUrl,
        preparedBy,
        copies: opts.copies,
        isReprint: opts.isReprint,
        showWatermark: opts.showWatermark,
        asZip: opts.asZip,
      } as never);
      toast.success(opts.asZip ? "ZIP downloaded — audit logged" : "PDF downloaded — audit logged");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  if (loading || !inv || !company) return <PageLoader />;

  const s = statusMeta(inv.status);
  const due = Math.max(0, Number(inv.total) - Number(inv.total_paid));
  const fmtDMY = (d?: string | null) => {
    if (!d) return "";
    const [y, m, day] = d.slice(0, 10).split("-");
    return y && m && day ? `${day}-${m}-${y}` : d;
  };
  const pdfMeta = { po_no: inv.po_number || "", po_date: fmtDMY(inv.po_date), payment_terms: inv.payment_terms || "" };
  console.log("HEADER DATA:", company);

  const salesTypeLabel = (inv as any).sales_type ? (SALES_TYPE_META[(inv as any).sales_type as keyof typeof SALES_TYPE_META]?.label ?? (inv as any).sales_type) : "—";
  const lutNoDisplay = (inv as any).lut_no ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => nav({ to: "/sales/invoices" })}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">{inv.invoice_no || "Invoice"} {isLocked && <Lock className="h-4 w-4 text-amber-600" />}</h1>
          <StatusBadge tone={s.badgeTone}>{s.label}</StatusBadge>
          {inv.irn && <StatusBadge tone="success">e-Invoice ✓</StatusBadge>}
          {inv.ewaybill_no && <StatusBadge tone="info">e-Way ✓</StatusBadge>}
          {isLocked && <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200"><Lock className="h-3 w-3 mr-1" />Locked after IRN</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.status === "draft" && !isLocked && (
            <Button size="sm" onClick={issueIfDraft}><Zap className="h-4 w-4 mr-1.5" />Issue</Button>
          )}
          {inv.status !== "cancelled" && !inv.irn && (
            <Button size="sm" variant="outline" onClick={generateIrn}><Zap className="h-4 w-4 mr-1.5" />Generate IRN (mock)</Button>
          )}
          {inv.status !== "cancelled" && !inv.ewaybill_no && inv.total >= 50000 /* M5: inclusive ≥50000 — 50000 exactly triggers */ && (
            <Button size="sm" variant="outline" onClick={() => setEwayOpen((v) => !v)}><Truck className="h-4 w-4 mr-1.5" />e-Way Bill (mock)</Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link to="/sales/payments/new" search={{ invoice_id: inv.id } as any}><Wallet className="h-4 w-4 mr-1.5" />Record Payment</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPrintModalOpen(true)}><Printer className="h-4 w-4 mr-1.5" />Print / Download…</Button>
        </div>
      </div>

      {ewayOpen && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Generate e-Way Bill (legacy mock)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div><Label className="text-xs">Transporter</Label><Input value={ewayForm.transporter_name} onChange={(e) => setEwayForm({ ...ewayForm, transporter_name: e.target.value })} /></div>
            <div><Label className="text-xs">Transporter ID</Label><Input value={ewayForm.transporter_id} onChange={(e) => setEwayForm({ ...ewayForm, transporter_id: e.target.value })} /></div>
            <div><Label className="text-xs">Vehicle No *</Label><Input value={ewayForm.vehicle_no} onChange={(e) => setEwayForm({ ...ewayForm, vehicle_no: e.target.value })} /></div>
            <div><Label className="text-xs">Distance (km)</Label><Input type="number" value={ewayForm.distance_km} onChange={(e) => setEwayForm({ ...ewayForm, distance_km: Number(e.target.value) })} /></div>
            <div><Button size="sm" onClick={generateEway}>Generate</Button></div>
          </CardContent>
        </Card>
      )}

      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileJson className="h-4 w-4 text-amber-700" /> Compliance Cockpit
            <Badge variant={completion.complete ? "default" : "secondary"} className={completion.complete ? "bg-emerald-600" : "bg-amber-500"}>
              {completion.badge}
            </Badge>
            {isLocked && <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300"><Lock className="h-3 w-3 mr-1" />IRN Locked</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={completion.e_invoice_required ? "default" : "outline"}>e-Invoice required: {completion.e_invoice_required ? "Y" : "N"}</Badge>
            <Badge variant={completion.e_way_required ? "default" : "outline"}>e-Way required: {completion.e_way_required ? "Y" : "N"}</Badge>
            <Badge variant={completion.complete ? "default" : "secondary"} className={completion.complete ? "bg-emerald-600" : ""}>
              {completion.complete ? "COMPLETE" : "PENDING"}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">GST e-Invoice (NIC v1.03)</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleGenerateGstJson} disabled={gstGenerating}>
                  <FileJson className="h-4 w-4 mr-1.5" />{gstGenerating ? "Generating…" : "Generate GST JSON"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIrnModalOpen(true)}>
                  <ClipboardPaste className="h-4 w-4 mr-1.5" />Paste IRN Response
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Generate downloads <span className="font-mono">PHS_INV_..._gst.json</span> + stores <span className="font-mono">compliance_json</span> &amp; sets <span className="font-mono">einvoice_status=json_ready</span>. Paste validates 64-hex IRN / 15-digit Ack / base64 QR.</p>
              {(inv as any).einvoice_status && <div className="text-xs">Status: <span className="font-mono">{(inv as any).einvoice_status}</span></div>}
              {inv.irn && <div className="text-xs font-mono break-all">IRN: {inv.irn}</div>}
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">E-Way Bill (v1.0)</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleGenerateEwayJson} disabled={ewayGenerating}>
                  <Truck className="h-4 w-4 mr-1.5" />{ewayGenerating ? "Generating…" : "Generate E-Way JSON"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEwbModalOpen(true)}>
                  <ClipboardPaste className="h-4 w-4 mr-1.5" />Paste EWB Response
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Generate downloads E-Way JSON + sets <span className="font-mono">eway_status=json_ready</span>. Paste validates 12-digit EWB.</p>
              {(inv as any).eway_status && <div className="text-xs">Status: <span className="font-mono">{(inv as any).eway_status}</span></div>}
              {inv.ewaybill_no && <div className="text-xs font-mono">EWB: {inv.ewaybill_no} · valid till {inv.ewaybill_valid_till ? fmtDMY(inv.ewaybill_valid_till) : "—"}</div>}
            </div>
          </div>

          {(inv as any).sales_type && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs border-t pt-3">
              <div><span className="text-muted-foreground">Sales Type</span><div className="font-medium">{salesTypeLabel}</div></div>
              <div><span className="text-muted-foreground">Supply Class</span><div className="font-mono">{(inv as any).supply_class ?? "—"}</div></div>
              <div><span className="text-muted-foreground">LUT No.</span><div className="font-mono">{lutNoDisplay || "—"}</div></div>
            </div>
          )}
          {lutNoDisplay && (
            <div className="text-xs bg-blue-50 border border-blue-200 rounded px-3 py-2">LUT No.: <span className="font-mono font-medium">{lutNoDisplay}</span> — referenced in GST JSON AddlDocDtls &amp; PDF (SEZ Zero Rated).</div>
          )}

          <div className="border-t pt-3">
            <div className="text-xs font-semibold text-muted-foreground mb-2">Transport &amp; Dispatch (read-only)</div>
            {transport ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div><div className="text-muted-foreground">Transport Mode</div><div className="font-medium">{transport.transport_mode ?? "—"}</div></div>
                <div><div className="text-muted-foreground">Mode of Transport</div><div className="font-medium">{transport.mode_of_transport ?? "—"}</div></div>
                <div><div className="text-muted-foreground">Vehicle No</div><div className="font-mono">{transport.vehicle_no || "—"}</div></div>
                <div><div className="text-muted-foreground">Station / To Place</div><div>{transport.station_to_place || "—"}</div></div>
                <div><div className="text-muted-foreground">Distance</div><div>{transport.distance_km != null ? `${transport.distance_km} km` : "—"}</div></div>
                <div><div className="text-muted-foreground">GR/RR No</div><div className="font-mono">{transport.gr_rr_no || "—"}</div></div>
                <div><div className="text-muted-foreground">Transporter</div><div className="truncate">{transport.transporter_name || "—"} {transport.transporter_id ? `· ${transport.transporter_id}` : ""}</div></div>
                <div><div className="text-muted-foreground">PIN</div><div className="font-mono">{transport.pin_code || "—"}</div></div>
                <div><div className="text-muted-foreground">e-Invoice Reqd</div><Badge variant={transport.e_invoice_reqd === "Y" ? "default" : "secondary"} className="text-xs">{transport.e_invoice_reqd ?? "—"}</Badge></div>
                <div><div className="text-muted-foreground">e-Way Reqd</div><Badge variant={transport.e_way_reqd === "Y" ? "default" : "secondary"} className="text-xs">{transport.e_way_reqd ?? "—"}</Badge></div>
                <div><div className="text-muted-foreground">EWB No</div><div className="font-mono">{transport.eway_bill_no || inv.ewaybill_no || "—"}</div></div>
                <div><div className="text-muted-foreground">IRN</div><div className="font-mono text-[10px] break-all">{transport.einvoice_irn || inv.irn || "—"}</div></div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No transport_details — created before P1 or Self-default. Generate GST/E-Way JSON will embed available fields.</div>
            )}
            {transport?.dispatch_details && (
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs border-t pt-3">
                <div><div className="text-muted-foreground">Dispatch Name</div><div>{transport.dispatch_details.name || "—"}</div></div>
                <div><div className="text-muted-foreground">Dispatch Place</div><div>{transport.dispatch_details.place || "—"}</div></div>
                <div><div className="text-muted-foreground">Dispatch PIN</div><div className="font-mono">{transport.dispatch_details.pin_code || "—"}</div></div>
                <div><div className="text-muted-foreground">Dispatch GSTIN</div><div className="font-mono text-[10px]">{transport.dispatch_details.gstin || "—"}</div></div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Seller</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-0.5">
            <div className="font-semibold">{company.name}</div>
            <div className="text-muted-foreground text-xs">{company.regd_address}</div>
            <div>GSTIN: <span className="font-mono text-xs">{company.gstin || "—"}</span></div>
            <div>State: {inv.seller_state} ({inv.seller_state_code})</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Buyer</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-0.5">
            <div className="font-semibold">{inv.buyer_name}</div>
            <div className="text-muted-foreground text-xs whitespace-pre-line">{inv.billing_address}</div>
            <div>GSTIN: <span className="font-mono text-xs">{inv.buyer_gstin || "—"}</span></div>
            <div>State: {inv.buyer_state} ({inv.buyer_state_code})</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Amounts</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="flex justify-between"><span>Taxable</span><span>{inr(inv.taxable_value)}</span></div>
            {inv.payment_terms && (
              <div className="flex justify-between text-xs text-muted-foreground"><span>Payment Terms</span><span>{inv.payment_terms}</span></div>
            )}
            {inv.is_interstate ? (
              <div className="flex justify-between"><span>IGST</span><span>{inr(inv.igst)}</span></div>
            ) : (
              <>
                <div className="flex justify-between"><span>CGST</span><span>{inr(inv.cgst)}</span></div>
                <div className="flex justify-between"><span>SGST</span><span>{inr(inv.sgst)}</span></div>
              </>
            )}
            {!!inv.round_off && <div className="flex justify-between"><span>Round Off</span><span>{inr(inv.round_off)}</span></div>}
            <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>{inr(inv.total)}</span></div>
            <div className="flex justify-between text-emerald-700"><span>Paid</span><span>{inr(inv.total_paid)}</span></div>
            <div className="flex justify-between text-amber-700 font-medium"><span>Due</span><span>{inr(due)}</span></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Items</CardTitle></CardHeader>
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
                {inv.is_interstate ? <th className="p-2 text-right">IGST</th> : (
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
                  <td className="p-2 text-right">{it.qty} {it.unit}</td>
                  <td className="p-2 text-right">{inr(it.rate)}</td>
                  <td className="p-2 text-right">{inr(it.taxable_value)}</td>
                  <td className="p-2 text-right">{it.gst_rate}%</td>
                  {inv.is_interstate ? <td className="p-2 text-right">{inr(it.igst)}</td> : (
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

      {inv.status !== "cancelled" && !isLocked && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive flex items-center gap-2"><Ban className="h-4 w-4" />Cancel Invoice</CardTitle></CardHeader>
          <CardContent className="flex flex-col md:flex-row gap-2 items-start md:items-end">
            <div className="flex-1 w-full">
              <Label className="text-xs">Reason</Label>
              <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Data entry error / duplicate / customer request…" />
            </div>
            <Button variant="destructive" size="sm" onClick={cancelInvoice}>Cancel Invoice</Button>
          </CardContent>
        </Card>
      )}
      {isLocked && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 text-sm flex items-center gap-2 text-amber-800">
            <Lock className="h-4 w-4" /> Invoice is locked after IRN generation — editing is disabled. Cancel IRN on the portal first (within 24h) or raise a credit note.
          </CardContent>
        </Card>
      )}

      <Dialog open={irnModalOpen} onOpenChange={setIrnModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste IRN Response (GST Portal)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Paste the JSON copied from <span className="font-mono">einvoice1.gst.gov.in</span> after upload. Must contain <span className="font-mono">Irn (64-hex)</span>, <span className="font-mono">AckNo (15-digit)</span>, <span className="font-mono">AckDt</span>, <span className="font-mono">SignedQRCode (base64)</span>. Validation via <span className="font-mono">parseGstPortalIrnResponse</span>.</p>
            <Textarea
              rows={10}
              value={irnText}
              onChange={(e) => setIrnText(e.target.value)}
              placeholder='{"Irn":"a3f...64hex","AckNo":"123456789012345","AckDt":"2025-09-01 12:00:00","SignedQRCode":"base64..."}'
              className="font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIrnModalOpen(false)}>Cancel</Button>
              <Button onClick={handlePasteIrn}>Validate &amp; Save IRN</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={ewbModalOpen} onOpenChange={setEwbModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste EWB Response (E-Way Portal)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Paste the JSON from <span className="font-mono">ewaybillgst.gov.in</span>. Must contain <span className="font-mono">EwbNo (12-digit)</span>, <span className="font-mono">EwbDt</span>, <span className="font-mono">EwbValidTill</span>. Validation via <span className="font-mono">parseEwayResponse</span>.</p>
            <Textarea
              rows={10}
              value={ewbText}
              onChange={(e) => setEwbText(e.target.value)}
              placeholder='{"EwbNo":"121234567890","EwbDt":"01/09/2025 12:00:00","EwbValidTill":"02/09/2025 23:59:00"}'
              className="font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEwbModalOpen(false)}>Cancel</Button>
              <Button onClick={handlePasteEwb}>Validate &amp; Save EWB</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <InvoicePrintModal
        open={printModalOpen}
        onOpenChange={setPrintModalOpen}
        invoice={inv as unknown as never}
        onDownload={handleModalDownload}
        onPrint={handleModalPrint}
        themeColor={pdfTheme.themeColor}
        copyLabel={pdfTheme.copyLabel}
      />
    </div>
  );
}
