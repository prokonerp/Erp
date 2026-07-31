import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Save, Plus, Trash2, Printer, Mail, MessageCircle, FileText, ClipboardList, Share2, Download, Eye } from "lucide-react";
import { toast } from "sonner";
import { ProductPicker } from "@/components/ProductPicker";
import type { ProductMaster } from "@/components/ProductPicker";
import { CustomerPicker } from "@/components/CustomerPicker";
import { UpsSmartPanel } from "@/components/UpsSmartPanel";
import { BundleApplyDialog } from "@/components/BundleApplyDialog";
import { fetchBundleChildrenRaw } from "@/lib/productBundles";
import { waOpen } from "@/lib/tickets";
import { fetchBranches, type BranchRow } from "@/lib/sales";
import { createSalesOrderFromQuote } from "@/lib/documentFlow.writers";
import { ShareQuotationDialog } from "@/components/ShareQuotationDialog";
import { Switch } from "@/components/ui/switch";
import {
  listOemLogos, withSignedUrls, filterLogosForItems,
  type OemLogoWithUrl, SIZE_PX,
} from "@/lib/oemLogos.data";
import {
  type Quotation, type QuoteItem, type Customer, type QuoteTermsTemplate, type CrmSettings, type QuoteStatus,
  fmtMoney, fmtDate, quoteStatusClass, computeQuoteTotals, lineAmount, lineTax, amountInWords, INDIAN_STATES,
} from "@/lib/crm";
import { getDocumentHeader } from "@/lib/letterhead";
import type { CompanyProfile } from "@/lib/companyProfile";
import { DocumentPrintView, type PrintItem, type PrintPreparedBy } from "@/components/DocumentPrintView";
import { printElementSinglePage, saveElementAsPdf } from "@/lib/docPdf";
import { getCurrentUserName } from "@/lib/currentUser";

export type QuoteDocAction = "print" | "download";

export const Route = createFileRoute("/_app/crm/quotations/$id")({
  component: QuoteEditor,
  validateSearch: (s: Record<string, unknown>): { action?: QuoteDocAction } => {
    const a = s.action;
    return a === "print" || a === "download" ? { action: a } : {};
  },
});

type InvoiceSettingsRow = {
  branch_id: string;
  company_name: string | null;
  company_address: string | null;
  udyam_no: string | null;
  phone: string | null;
  email: string | null;
  theme_color: string;
  terms_default: string | null;
  notes_default: string | null;
  place_of_supply_default: string | null;
};

function QuoteEditor() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const isClone = id === "new";
  const [q, setQ] = useState<Quotation | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [templates, setTemplates] = useState<QuoteTermsTemplate[]>([]);
  const [settings, setSettings] = useState<CrmSettings | null>(null);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [invSettings, setInvSettings] = useState<InvoiceSettingsRow | null>(null);
  const [termsTouched, setTermsTouched] = useState(false);
  const [bundleFor, setBundleFor] = useState<ProductMaster | null>(null);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleParentQty, setBundleParentQty] = useState(1);
  const [shareOpen, setShareOpen] = useState(false);
  const [oemLogos, setOemLogos] = useState<OemLogoWithUrl[]>([]);
  const [logosProductOnly, setLogosProductOnly] = useState(false);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [warrantyMap, setWarrantyMap] = useState<Record<string, string>>({});
  const [preparedBy, setPreparedBy] = useState<PrintPreparedBy | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const { action } = Route.useSearch();
  const autoRan = useRef(false);

  const load = async () => {
    let sourceId = id;
    if (isClone) {
      const src = (typeof sessionStorage !== "undefined" && sessionStorage.getItem("quote_clone_source")) || "";
      if (!src) {
        toast.error("No quotation to clone.");
        nav({ to: "/crm/quotations" });
        return;
      }
      sourceId = src;
    }
    const { data } = await supabase.from("quotations").select("*").eq("id", sourceId).single();
    if (!data) return;
    const quote = data as unknown as Quotation;
    quote.items = Array.isArray(quote.items) ? quote.items : [];
    if (isClone) {
      // Prepare an unsaved working copy — do not persist until user clicks Save.
      (quote as any).id = "";
      quote.quote_no = "";
      quote.reference_no = null;
      quote.status = "draft";
      quote.quote_date = new Date().toISOString().slice(0, 10);
      quote.expiry_date = new Date(Date.now() + (quote.validity_days || 15) * 86400000).toISOString().slice(0, 10);
    }
    setQ(quote);
    if (quote.customer_id) {
      const { data: c } = await supabase.from("customers").select("*").eq("id", quote.customer_id).single();
      setCustomer((c as unknown as Customer) || null);
    }
  };
  useEffect(() => {
    load();
    supabase.from("quote_terms_templates").select("*").order("sort_order").then(({ data }) => setTemplates((data || []) as any));
    supabase.from("crm_settings").select("*").eq("id", 1).single().then(({ data }) => setSettings((data as any) || { id: 1, business_state: "Haryana", business_gstin: null, default_terms: "", default_customer_notes: "Thanks for your business." }));
    fetchBranches().then((bs) => setBranches(bs)).catch(() => {});
    listOemLogos(true).then(withSignedUrls).then(setOemLogos).catch(() => {});
    getDocumentHeader().then(setCompany).catch(() => {});
  }, [id]);

  // Prepared By: current logged-in user's name/phone/email from app_users.
  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) return;
        const name = await getCurrentUserName();
        const { data: au } = await supabase
          .from("app_users")
          .select("name,phone,email")
          .eq("user_id", u.user.id)
          .maybeSingle();
        const row = (au as { name?: string | null; phone?: string | null; email?: string | null } | null) || null;
        setPreparedBy({
          name: (row?.name || name || u.user.email || "").trim() || null,
          phone: row?.phone || null,
          email: row?.email || u.user.email || null,
        });
      } catch { /* ignore */ }
    })();
  }, []);

  // Auto-fill Sales Person on first load if empty (do not overwrite a saved value).
  useEffect(() => {
    if (!q || q.salesperson) return;
    getCurrentUserName().then((n) => {
      if (n) setQ((prev) => (prev && !prev.salesperson ? { ...prev, salesperson: n } : prev));
    });
  }, [q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch warranty per product for print (Item Master → warranty_duration + warranty_unit)
  useEffect(() => {
    const ids = Array.from(new Set((q?.items || []).map((it) => (it as any).product_id).filter(Boolean))) as string[];
    if (ids.length === 0) { setWarrantyMap({}); return; }
    const missing = ids.filter((pid) => !(pid in warrantyMap));
    if (missing.length === 0) return;
    supabase.from("products").select("id,warranty_applicable,warranty_duration,warranty_unit")
      .in("id", missing)
      .then(({ data }) => {
        const next = { ...warrantyMap };
        (data || []).forEach((p: any) => {
          if (!p.warranty_applicable || !p.warranty_duration) { next[p.id] = ""; return; }
          const unit = String(p.warranty_unit || "").toLowerCase();
          const months = unit.startsWith("y") ? Number(p.warranty_duration) * 12 : Number(p.warranty_duration);
          next[p.id] = months > 0 ? `${months} M` : "";
        });
        setWarrantyMap(next);
      });
  }, [q?.items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default branch on first load
  useEffect(() => {
    if (!q || q.branch_id || branches.length === 0) return;
    const def = branches.find((b) => b.is_default) || branches[0];
    if (def) setQ({ ...q, branch_id: def.id });
  }, [branches, q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const branch = useMemo(() => branches.find((b) => b.id === q?.branch_id) || null, [branches, q?.branch_id]);

  // Load invoice_settings for the chosen branch → company header + defaults
  useEffect(() => {
    if (!q?.branch_id) { setInvSettings(null); return; }
    supabase
      .from("invoice_settings")
      .select("branch_id,company_name,company_address,udyam_no,phone,email,theme_color,terms_default,notes_default,place_of_supply_default")
      .eq("branch_id", q.branch_id)
      .maybeSingle()
      .then(({ data }) => {
        const s = (data as InvoiceSettingsRow | null) || null;
        setInvSettings(s);
        if (!q) return;
        const patch: Partial<Quotation> = {};
        if (!termsTouched && !q.terms && s?.terms_default) patch.terms = s.terms_default;
        if (!q.customer_notes && s?.notes_default) patch.customer_notes = s.notes_default;
        if (!q.place_of_supply && s?.place_of_supply_default) patch.place_of_supply = s.place_of_supply_default;
        if (Object.keys(patch).length) setQ({ ...q, ...patch });
      });
  }, [q?.branch_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    if (!q || !settings) return { subtotal: 0, total_tax: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tcs_amount: 0, total: 0 };
    return computeQuoteTotals({
      items: q.items,
      discount_amount: q.discount_amount || 0,
      shipping_charges: q.shipping_charges || 0,
      adjustment: q.adjustment || 0,
      tcs_percent: q.tcs_percent || 0,
      round_off: q.round_off || 0,
      place_of_supply: q.place_of_supply,
      business_state: settings.business_state,
    });
  }, [q, settings]);

  const setItem = (idx: number, patch: Partial<QuoteItem>) => {
    if (!q) return;
    const items = [...q.items];
    const cur = { ...items[idx], ...patch };
    cur.amount = lineAmount(cur);
    items[idx] = cur;
    setQ({ ...q, items });
  };
  const addItem = () => q && setQ({ ...q, items: [...q.items, { description: "", qty: 1, unit: "Nos", rate: 0, discount_percent: 0, tax_percent: 18, amount: 0 }] });
  const addItems = (rows: QuoteItem[]) => {
    if (!q) return;
    const next = rows.map((r) => ({ ...r, amount: lineAmount(r) }));
    setQ({ ...q, items: [...q.items, ...next] });
  };
  const delItem = (i: number) => q && setQ({ ...q, items: q.items.filter((_, x) => x !== i) });

  const applyTemplate = (tplId: string) => {
    const t = templates.find((x) => x.id === tplId);
    if (t && q) setQ({ ...q, terms: t.body });
  };

  const applyCustomer = (id: string | null, c: Customer | null) => {
    if (!q) return;
    setCustomer(c);
    setQ({
      ...q,
      customer_id: id || (q as any).customer_id,
      // Snapshot party fields — user can still edit before saving
      billing_address: c?.billing_address || q.billing_address || "",
      shipping_address: c?.shipping_address || c?.billing_address || q.shipping_address || "",
      place_of_supply: c?.state || q.place_of_supply,
      contact_name: c?.contact_name || q.contact_name || null,
      contact_email: c?.email || q.contact_email || null,
      contact_phone: c?.phone || q.contact_phone || null,
      payment_terms: q.payment_terms || (c as any)?.payment_terms || null,
    } as Quotation);
  };

  const save = async () => {
    if (!q) return;
    const payload: any = {
      customer_id: (q as any).customer_id,
      branch_id: q.branch_id,
      reference_no: q.reference_no, subject: q.subject,
      quote_date: q.quote_date, expiry_date: q.expiry_date, validity_days: q.validity_days,
      salesperson: q.salesperson, project_name: q.project_name,
      payment_terms: q.payment_terms,
      delivery_timeline: q.delivery_timeline,
      contact_name: q.contact_name,
      contact_email: q.contact_email,
      contact_phone: q.contact_phone,
      billing_address: q.billing_address, shipping_address: q.shipping_address,
      place_of_supply: q.place_of_supply,
      items: q.items as any,
      discount_amount: q.discount_amount || 0,
      shipping_charges: q.shipping_charges || 0,
      adjustment: q.adjustment || 0,
      tcs_percent: q.tcs_percent || 0,
      round_off: q.round_off || 0,
      subtotal: totals.subtotal,
      gst_percent: q.gst_percent,
      gst_amount: totals.total_tax,
      cgst_amount: totals.cgst_amount,
      sgst_amount: totals.sgst_amount,
      igst_amount: totals.igst_amount,
      tcs_amount: totals.tcs_amount,
      total: totals.total,
      status: q.status,
      terms: q.terms,
      customer_notes: q.customer_notes,
      remarks: q.remarks,
      include_oem_logos: (q as any).include_oem_logos !== false,
    };
    if (isClone) {
      const { data: u } = await supabase.auth.getUser();
      payload.owner_id = u.user!.id;
      const { data, error } = await supabase.from("quotations").insert(payload).select().single();
      if (error) return toast.error(error.message);
      try { sessionStorage.removeItem("quote_clone_source"); } catch {}
      toast.success("Saved");
      nav({ to: "/crm/quotations/$id", params: { id: (data as any).id } });
      return;
    }
    const { error } = await supabase.from("quotations").update(payload).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    load();
  };

  const setStatus = async (s: QuoteStatus) => {
    if (!q) return;
    setQ({ ...q, status: s });
    if (isClone) return; // clone is unsaved; just update local state
    await supabase.from("quotations").update({ status: s } as any).eq("id", id);
    toast.success("Status: " + s);
  };

  const sendEmail = () => {
    if (!customer?.email) return toast.error("No customer email");
    const sub = encodeURIComponent(`Quotation ${q!.quote_no} - ${q!.subject || "Prokon Hi-Tech Systems"}`);
    const body = encodeURIComponent(
      `Dear ${customer.contact_name || customer.company} Team,\n\nPlease find our quotation ${q!.quote_no} dated ${fmtDate(q!.quote_date)} for your kind consideration. Total value: ${fmtMoney(totals.total)} (valid till ${fmtDate(q!.expiry_date)}).\n\nLooking forward to your confirmation.\n\nRegards,\nProkon Hi-Tech Systems\nAuthorized APC Channel Partner`
    );
    window.open(`mailto:${customer.email}?subject=${sub}&body=${body}`);
  };
  const sendWA = async () => {
    if (!customer?.phone) return toast.error("No customer phone");
    const text = `Hi ${customer.contact_name || customer.company}, sharing our quotation ${q!.quote_no} (${fmtMoney(totals.total)}, valid till ${fmtDate(q!.expiry_date)}). Please confirm. — Prokon Hi-Tech Systems`;
    const ok = await waOpen(customer.phone, text);
    if (!ok) return toast.error("Valid mobile number is required before sending WhatsApp message.");
    toast.success("Opening WhatsApp…");
  };

  const convertToSo = async () => {
    if (!q) return;
    try {
      await save();
      const r = await createSalesOrderFromQuote(q);
      toast.success(`Sales Order ${r.so_no || ""} created`);
      nav({ to: "/sales/orders/$id", params: { id: r.id } });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to convert");
    }
  };

  const docName = () => `${q?.quote_no || "Quotation"}.pdf`;

  const doPrint = async () => {
    if (!printRef.current) return;
    try {
      await printElementSinglePage(printRef.current, docName());
    } catch (e: any) {
      toast.error(e?.message || "Print failed");
    }
  };

  const doDownload = async () => {
    if (!printRef.current) return;
    try {
      toast.info("Preparing PDF…");
      await saveElementAsPdf(printRef.current, docName());
    } catch (e: any) {
      toast.error(e?.message || "PDF failed");
    }
  };

  // Deep-linked action from the quotation list (?action=print|download)
  useEffect(() => {
    if (!action || autoRan.current || isClone) return;
    if (!q || !settings || !company || !printRef.current) return;
    autoRan.current = true;
    const t = setTimeout(() => {
      if (action === "print") void doPrint();
      else void doDownload();
      nav({ to: "/crm/quotations/$id", params: { id }, search: {}, replace: true });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, q, settings, company]);

  if (!q || !settings || !company) return <div className="text-muted-foreground">Loading…</div>;

  const STATUSES: QuoteStatus[] = ["draft", "sent", "accepted", "declined", "expired", "invoiced"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden flex-wrap gap-2">
        <Link to="/crm/quotations"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
        <div className="flex gap-2 flex-wrap">
          <Badge variant="outline" className={quoteStatusClass[q.status]}>{isClone ? "unsaved copy" : q.status}</Badge>
          <Select value={q.status} onValueChange={(v: any) => setStatus(v)}>
            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={sendEmail} disabled={isClone}><Mail className="h-4 w-4 mr-1" />Email</Button>
          <Button size="sm" variant="outline" onClick={sendWA} disabled={isClone}><MessageCircle className="h-4 w-4 mr-1" />WhatsApp</Button>
          <Button size="sm" variant="outline" disabled={isClone} onClick={doPrint}><Printer className="h-4 w-4 mr-1" />Print</Button>
          <Button size="sm" variant="outline" disabled={isClone} onClick={doDownload}><Download className="h-4 w-4 mr-1" />Download PDF</Button>
          <Button size="sm" onClick={() => setShareOpen(true)} disabled={isClone}><Share2 className="h-4 w-4 mr-1" />Share</Button>
          <Button size="sm" variant="outline" onClick={convertToSo} disabled={isClone}><ClipboardList className="h-4 w-4 mr-1" />Convert to Sales Order</Button>
          <Button size="sm" onClick={save}><Save className="h-4 w-4 mr-1" />Save</Button>
        </div>
      </div>

      <ShareQuotationDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        customerName={customer?.contact_name || customer?.company || "Customer"}
        customerPhone={customer?.phone || null}
        customerEmail={customer?.email || null}
        companyName={company.name}
        quoteNo={q.quote_no}
        subject={q.subject}
        onGeneratePdf={() => { if (printRef.current) void saveElementAsPdf(printRef.current, `${q.quote_no || "Quotation"}.pdf`); }}
      />

      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-base">{q.quote_no || (isClone ? "New quotation (unsaved copy)" : "Quotation")}</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          <div className="md:col-span-3">
            <Label>Supply From Warehouse <span className="text-muted-foreground font-normal">(internal only)</span></Label>
            <Select value={q.branch_id || ""} onValueChange={(v) => setQ({ ...q, branch_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
              <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
            {branch && (
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>Supply From: {branch.name}</span>
              </div>
            )}
          </div>
          <div className="md:col-span-3">
            <Label>Customer <span className="text-muted-foreground font-normal">(from Customer Master)</span></Label>
            <CustomerPicker value={(q as any).customer_id || null} onChange={applyCustomer} />
            {customer && (
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {customer.gst && <span>GSTIN: <span className="font-mono">{customer.gst}</span></span>}
                {customer.phone && <span>· {customer.phone}</span>}
                {customer.email && <span>· {customer.email}</span>}
                {customer.state && <span>· {customer.state}</span>}
              </div>
            )}
          </div>
          <div><Label>Reference #</Label><Input value={q.reference_no || ""} onChange={(e) => setQ({ ...q, reference_no: e.target.value })} /></div>
          <div><Label>Quote date</Label><Input type="date" value={q.quote_date} onChange={(e) => setQ({ ...q, quote_date: e.target.value })} /></div>
          <div><Label>Expiry date</Label><Input type="date" value={q.expiry_date || ""} onChange={(e) => setQ({ ...q, expiry_date: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>Subject</Label><Input value={q.subject || ""} onChange={(e) => setQ({ ...q, subject: e.target.value })} placeholder="Let your customer know what this quote is for" /></div>
          <div><Label>Salesperson</Label><Input value={q.salesperson || ""} onChange={(e) => setQ({ ...q, salesperson: e.target.value })} /></div>
          <div><Label>Project name</Label><Input value={q.project_name || ""} onChange={(e) => setQ({ ...q, project_name: e.target.value })} /></div>
          <div>
            <Label>Place of supply</Label>
            <Select value={q.place_of_supply || ""} onValueChange={(v) => setQ({ ...q, place_of_supply: v })}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>{INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground mt-1">Business state: {settings.business_state} → {(q.place_of_supply || "").toLowerCase() === settings.business_state.toLowerCase() ? "CGST + SGST" : "IGST"}</div>
          </div>
          <div><Label>Payment terms</Label><Input value={q.payment_terms || ""} onChange={(e) => setQ({ ...q, payment_terms: e.target.value })} placeholder="e.g. 50% advance, balance before dispatch" /></div>
          <div><Label>Delivery timeline</Label><Input value={q.delivery_timeline || ""} onChange={(e) => setQ({ ...q, delivery_timeline: e.target.value })} placeholder="e.g. 2–3 weeks from PO" /></div>
          <div><Label>Validity (days)</Label><Input type="number" value={q.validity_days || 0} onChange={(e) => setQ({ ...q, validity_days: Number(e.target.value) })} /></div>
          <div><Label>Contact person</Label><Input value={q.contact_name || ""} onChange={(e) => setQ({ ...q, contact_name: e.target.value })} /></div>
          <div><Label>Contact email</Label><Input value={q.contact_email || ""} onChange={(e) => setQ({ ...q, contact_email: e.target.value })} /></div>
          <div><Label>Contact mobile</Label><Input value={q.contact_phone || ""} onChange={(e) => setQ({ ...q, contact_phone: e.target.value })} /></div>
          <div className="md:col-span-3 grid md:grid-cols-2 gap-3">
            <div><Label>Billing address</Label><Textarea rows={3} value={q.billing_address || ""} onChange={(e) => setQ({ ...q, billing_address: e.target.value })} /></div>
            <div>
              <div className="flex items-center justify-between"><Label>Shipping address</Label>
                <Button type="button" size="sm" variant="ghost" onClick={() => setQ({ ...q, shipping_address: q.billing_address || "" })}>Same as billing</Button>
              </div>
              <Textarea rows={3} value={q.shipping_address || ""} onChange={(e) => setQ({ ...q, shipping_address: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <UpsSmartPanel items={q.items} onAddItems={addItems} />

      <Card className="print:hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Item table</CardTitle>
          <Button size="sm" variant="outline" onClick={addItem}><Plus className="h-4 w-4 mr-1" />Add row</Button>
        </CardHeader>
        <CardContent>
          {q.items.length === 0 && <div className="text-sm text-muted-foreground">No items. Click "Add row".</div>}
          {q.items.map((it, i) => (
            <div key={i} className="border rounded-md p-3 mb-2 space-y-2">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-12 md:col-span-5">
                  <Label className="text-xs">Item / Description <span className="text-muted-foreground font-normal">(from Product Master)</span></Label>
                  <ProductPicker
                    value={(it as any).product_id || ""}
                    onChange={(id, p) => {
                      setItem(i, {
                      product_id: id || "",
                      product_name: p?.name || undefined,
                      description: p?.name || it.description,
                      hsn: p?.hsn || it.hsn,
                      unit: p?.unit || it.unit,
                      rate: p?.default_price != null ? Number(p.default_price) : it.rate,
                      } as Partial<QuoteItem>);
                      // Fire-and-forget bundle check: if this product has bundle children,
                      // open the dialog to let the user accept/adjust suggestions.
                      if (id && p) {
                        fetchBundleChildrenRaw(id).then((rows) => {
                          if (rows.length > 0) {
                            setBundleParentQty(Number(it.qty) || 1);
                            setBundleFor(p);
                            setBundleOpen(true);
                          }
                        }).catch(() => {});
                      }
                    }}
                  />
                </div>
                <div className="col-span-3 md:col-span-1"><Label className="text-xs">HSN</Label><Input value={it.hsn || ""} onChange={(e) => setItem(i, { hsn: e.target.value })} /></div>
                <div className="col-span-3 md:col-span-1"><Label className="text-xs">Qty</Label><Input type="number" value={it.qty} onChange={(e) => setItem(i, { qty: Number(e.target.value) })} /></div>
                <div className="col-span-3 md:col-span-1"><Label className="text-xs">Unit</Label><Input value={it.unit || ""} onChange={(e) => setItem(i, { unit: e.target.value })} /></div>
                <div className="col-span-3 md:col-span-2"><Label className="text-xs">Rate</Label><Input type="number" value={it.rate} onChange={(e) => setItem(i, { rate: Number(e.target.value) })} /></div>
                <div className="col-span-12 md:col-span-2 text-right text-sm pb-2">
                  <div className="text-xs text-muted-foreground">Amount</div>
                  <div className="font-semibold">{fmtMoney(it.amount)}</div>
                </div>
              </div>
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-6 md:col-span-3"><Label className="text-xs">Discount %</Label><Input type="number" value={it.discount_percent || 0} onChange={(e) => setItem(i, { discount_percent: Number(e.target.value) })} /></div>
                <div className="col-span-6 md:col-span-3"><Label className="text-xs">Tax (GST) %</Label><Input type="number" value={it.tax_percent ?? 18} onChange={(e) => setItem(i, { tax_percent: Number(e.target.value) })} /></div>
                <div className="col-span-12 md:col-span-5"><Label className="text-xs">Item details / notes</Label><Input value={it.item_details || ""} onChange={(e) => setItem(i, { item_details: e.target.value })} placeholder="Extra details printed under the line" /></div>
                <div className="col-span-12 md:col-span-1 text-right"><Button size="sm" variant="ghost" onClick={() => delItem(i)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader><CardTitle className="text-base">Totals & charges</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">Discount (₹)</Label><Input type="number" value={q.discount_amount || 0} onChange={(e) => setQ({ ...q, discount_amount: Number(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">Shipping charges (₹)</Label><Input type="number" value={q.shipping_charges || 0} onChange={(e) => setQ({ ...q, shipping_charges: Number(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">Adjustment (₹)</Label><Input type="number" value={q.adjustment || 0} onChange={(e) => setQ({ ...q, adjustment: Number(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">TCS %</Label><Input type="number" value={q.tcs_percent || 0} onChange={(e) => setQ({ ...q, tcs_percent: Number(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2"><Label className="self-center">Round-off (₹)</Label><Input type="number" value={q.round_off || 0} onChange={(e) => setQ({ ...q, round_off: Number(e.target.value) })} /></div>
          </div>
          <div className="text-sm border rounded-md p-3 space-y-1">
            <div className="flex justify-between"><span>Sub Total</span><span>{fmtMoney(totals.subtotal)}</span></div>
            {(q.discount_amount || 0) > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><span>− {fmtMoney(q.discount_amount)}</span></div>}
            {(q.shipping_charges || 0) > 0 && <div className="flex justify-between"><span>Shipping</span><span>{fmtMoney(q.shipping_charges)}</span></div>}
            {(q.adjustment || 0) !== 0 && <div className="flex justify-between"><span>Adjustment</span><span>{fmtMoney(q.adjustment)}</span></div>}
            {totals.cgst_amount > 0 && <div className="flex justify-between"><span>CGST</span><span>{fmtMoney(totals.cgst_amount)}</span></div>}
            {totals.sgst_amount > 0 && <div className="flex justify-between"><span>SGST</span><span>{fmtMoney(totals.sgst_amount)}</span></div>}
            {totals.igst_amount > 0 && <div className="flex justify-between"><span>IGST</span><span>{fmtMoney(totals.igst_amount)}</span></div>}
            {totals.tcs_amount > 0 && <div className="flex justify-between"><span>TCS ({q.tcs_percent}%)</span><span>{fmtMoney(totals.tcs_amount)}</span></div>}
            {(q.round_off || 0) !== 0 && <div className="flex justify-between"><span>Round-off</span><span>{fmtMoney(q.round_off)}</span></div>}
            <div className="flex justify-between border-t pt-1 mt-1 font-bold text-base"><span>Total (₹)</span><span>{fmtMoney(totals.total)}</span></div>
          </div>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Customer notes & terms</CardTitle>
          {templates.length > 0 && (
            <Select onValueChange={applyTemplate}>
              <SelectTrigger className="w-56 h-8"><SelectValue placeholder="Apply terms template" /></SelectTrigger>
              <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}><FileText className="inline h-3 w-3 mr-1" />{t.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div><Label>Customer notes (printed)</Label><Textarea rows={5} value={q.customer_notes || ""} onChange={(e) => setQ({ ...q, customer_notes: e.target.value })} placeholder="Thanks for your business." /></div>
          <div><Label>Terms & conditions</Label><Textarea rows={5} value={q.terms || ""} onChange={(e) => { setTermsTouched(true); setQ({ ...q, terms: e.target.value }); }} placeholder="Payment, delivery, warranty…" /></div>
          <div className="md:col-span-2"><Label>Internal remarks (not printed)</Label><Textarea rows={2} value={q.remarks || ""} onChange={(e) => setQ({ ...q, remarks: e.target.value })} /></div>
          <div className="md:col-span-2 flex flex-wrap items-center gap-6 pt-2 border-t">
            <div className="flex items-center gap-2">
              <Switch
                id="include-oem-logos"
                checked={(q as any).include_oem_logos !== false}
                onCheckedChange={(v) => setQ({ ...q, ...( { include_oem_logos: v } as any) })}
              />
              <Label htmlFor="include-oem-logos" className="cursor-pointer">Include OEM logos in PDF footer</Label>
              <span className="text-xs text-muted-foreground">({oemLogos.length} active)</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="logos-product-only"
                checked={logosProductOnly}
                onCheckedChange={setLogosProductOnly}
                disabled={(q as any).include_oem_logos === false}
              />
              <Label htmlFor="logos-product-only" className="cursor-pointer">Show only logos for products in this quote</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ============ SHARED A4 PRINT VIEW ============ */}
      <div ref={printRef} className="hidden print:block text-black">
        <DocumentPrintView
          company={company}
          doc={{
            type: "quotation",
            number: q.quote_no || "",
            date: q.quote_date,
            expiry_or_delivery_date: q.expiry_date,
            reference_no: q.reference_no,
            subject: q.subject,
            bill_to: {
              name: customer?.company || "",
              address: q.billing_address || customer?.billing_address || customer?.address || "",
              gstin: customer?.gst || null,
              state: q.place_of_supply || customer?.state || null,
              contact_name: q.contact_name,
              contact_phone: q.contact_phone,
              contact_email: q.contact_email,
            },
            ship_to: {
              name: customer?.company || "",
              address: q.shipping_address || q.billing_address || customer?.shipping_address || customer?.address || "",
            },
            is_interstate: totals.igst_amount > 0,
            place_of_supply: q.place_of_supply,
            sales_person: q.salesperson,
            payment_terms: q.payment_terms,
            delivery_terms: q.delivery_timeline,
            items: q.items.map((it) => {
              const disc = (Number(it.qty) * Number(it.rate)) * (Number(it.discount_percent || 0) / 100);
              const amount = +(Number(it.qty) * Number(it.rate) - disc).toFixed(2);
              return {
                description: it.description || (it as any).product_name || "—",
                item_details: it.item_details || null,
                warranty: (it as any).product_id ? warrantyMap[(it as any).product_id] || null : null,
                hsn: it.hsn,
                qty: Number(it.qty || 0),
                unit: it.unit,
                rate: Number(it.rate || 0),
                gst_percent: Number(it.tax_percent || 0),
                amount,
              } as PrintItem;
            }),
            totals: {
              subtotal: totals.subtotal,
              discount: q.discount_amount || 0,
              shipping: q.shipping_charges || 0,
              adjustment: q.adjustment || 0,
              cgst: totals.cgst_amount,
              sgst: totals.sgst_amount,
              igst: totals.igst_amount,
              round_off: q.round_off || 0,
              grand_total: totals.total,
            },
            notes: q.customer_notes,
            terms: q.terms,
            prepared_by: preparedBy,
          }}
        />
        {(() => {
          if ((q as any).include_oem_logos === false) return null;
          const pool = logosProductOnly ? filterLogosForItems(oemLogos, q.items) : oemLogos;
          if (pool.length === 0) return null;
          // Uniform logo strip: fixed height, equal spacing, white plate on
          // every logo so no single OEM asset stands out with a background.
          const ordered = [
            ...pool.filter((l) => l.position === "left"),
            ...pool.filter((l) => l.position === "center"),
            ...pool.filter((l) => l.position === "right"),
          ];
          return (
            <div
              style={{
                marginTop: 16,
                display: "flex",
                flexDirection: "row",
                flexWrap: "nowrap",
                alignItems: "center",
                width: "100%",
                borderTop: "0.5px solid #9ca3af",
                background: "#ffffff",
                padding: "10px 16px",
                justifyContent: "space-evenly",
                gap: 16,
              }}
            >
              {ordered.map((l) => (
                <div
                  key={l.id}
                  style={{
                    height: 40,
                    flex: "0 1 auto",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#ffffff",
                    padding: "2px 6px",
                  }}
                >
                  <img
                    src={l.url}
                    alt={l.oem_name}
                    style={{ height: 30, maxWidth: 130, objectFit: "contain", display: "block" }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Legacy print block (disabled; retained for reference) */}
      <div className="hidden text-black">
        <style>{`@media print { @page { size: A4; margin: 12mm; } body { font-family: Arial, Helvetica, sans-serif; color:#000; } .zh-th{background:#374151;color:#fff;padding:6px;font-size:11px;text-align:left} .zh-td{border-bottom:1px solid #e5e7eb;padding:6px;font-size:11px;vertical-align:top} }`}</style>

        {/* Header */}
        <div
          className="flex items-start justify-between border-b-2 pb-3 mb-4"
          style={{ borderColor: invSettings?.theme_color || "#374151" }}
        >
          <div>
            <div className="text-2xl font-bold tracking-tight">
              {company.name}
            </div>
            <div className="text-[11px] mt-0.5 whitespace-pre-line">
              {company.regd_address}
            </div>
            <div className="text-[11px]">
              {[company.email ? `Email: ${company.email}` : null, company.phone ? `Phone: ${company.phone}` : null].filter(Boolean).join(" · ")}
            </div>
            <div className="text-[11px]">
              {[
                company.gstin ? `GSTIN: ${company.gstin}` : null,
              ].filter(Boolean).join(" · ") || "—"}
            </div>
            {branch?.name && <div className="text-[11px] italic mt-1">Supply From: {branch.name}</div>}
            <div className="text-[11px] italic mt-1">Authorized APC by Schneider Electric Channel Partner</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold" style={{ color: invSettings?.theme_color || "#374151" }}>QUOTE</div>
            <div className="text-[11px] mt-1"># <b>{q.quote_no}</b></div>
            {q.reference_no && <div className="text-[11px]">Ref: {q.reference_no}</div>}
          </div>
        </div>

        {/* Bill / Ship + meta */}
        <div className="grid grid-cols-3 gap-4 mb-3 text-[11px]">
          <div>
            <div className="font-semibold text-gray-600 uppercase text-[10px] mb-1">Bill To</div>
            <div className="font-semibold text-sm">{customer?.company}</div>
            <div className="whitespace-pre-line">{q.billing_address || customer?.address || ""}</div>
            {customer?.gst && <div className="mt-1">GSTIN: {customer.gst}</div>}
            {(q.contact_name || q.contact_email || q.contact_phone) && (
              <div className="mt-1">
                {q.contact_name && <div>Attn: {q.contact_name}</div>}
                {q.contact_phone && <div>{q.contact_phone}</div>}
                {q.contact_email && <div>{q.contact_email}</div>}
              </div>
            )}
          </div>
          <div>
            <div className="font-semibold text-gray-600 uppercase text-[10px] mb-1">Ship To</div>
            <div className="font-semibold text-sm">{customer?.company}</div>
            <div className="whitespace-pre-line">{q.shipping_address || q.billing_address || customer?.address || ""}</div>
          </div>
          <div className="text-right">
            <table className="ml-auto text-[11px]">
              <tbody>
                <tr><td className="pr-2 text-gray-600">Quote Date</td><td className="font-semibold">{fmtDate(q.quote_date)}</td></tr>
                <tr><td className="pr-2 text-gray-600">Expiry Date</td><td className="font-semibold">{fmtDate(q.expiry_date)}</td></tr>
                {q.place_of_supply && <tr><td className="pr-2 text-gray-600">Place of Supply</td><td className="font-semibold">{q.place_of_supply}</td></tr>}
                {q.salesperson && <tr><td className="pr-2 text-gray-600">Salesperson</td><td className="font-semibold">{q.salesperson}</td></tr>}
                {q.project_name && <tr><td className="pr-2 text-gray-600">Project</td><td className="font-semibold">{q.project_name}</td></tr>}
                {q.payment_terms && <tr><td className="pr-2 text-gray-600">Payment Terms</td><td className="font-semibold">{q.payment_terms}</td></tr>}
                {q.delivery_timeline && <tr><td className="pr-2 text-gray-600">Delivery</td><td className="font-semibold">{q.delivery_timeline}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {q.subject && <div className="text-[12px] mb-2"><b>Subject:</b> {q.subject}</div>}

        {/* Items */}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="zh-th" style={{ width: "4%" }}>#</th>
              <th className="zh-th">Item & Description</th>
              <th className="zh-th text-center" style={{ width: "8%" }}>HSN</th>
              <th className="zh-th text-right" style={{ width: "8%" }}>Qty</th>
              <th className="zh-th text-right" style={{ width: "12%" }}>Rate</th>
              <th className="zh-th text-right" style={{ width: "9%" }}>Disc%</th>
              <th className="zh-th text-right" style={{ width: "9%" }}>Tax%</th>
              <th className="zh-th text-right" style={{ width: "14%" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((it, i) => (
              <tr key={i}>
                <td className="zh-td text-center">{i + 1}</td>
                <td className="zh-td">
                  <div className="font-semibold">{it.description}</div>
                  {it.item_details && <div className="text-[10px] text-gray-600 whitespace-pre-line">{it.item_details}</div>}
                </td>
                <td className="zh-td text-center">{it.hsn || ""}</td>
                <td className="zh-td text-right">{it.qty} {it.unit || ""}</td>
                <td className="zh-td text-right">{fmtMoney(it.rate)}</td>
                <td className="zh-td text-right">{it.discount_percent || 0}%</td>
                <td className="zh-td text-right">{it.tax_percent ?? 0}%</td>
                <td className="zh-td text-right font-semibold">{fmtMoney(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals box on right */}
        <div className="grid grid-cols-2 mt-3">
          <div className="text-[11px]">
            <div className="font-semibold">Total in words:</div>
            <div className="italic">{amountInWords(totals.total)}</div>
          </div>
          <div className="text-[12px]">
            <table className="w-full">
              <tbody>
                <tr><td className="py-0.5">Sub Total</td><td className="py-0.5 text-right">{fmtMoney(totals.subtotal)}</td></tr>
                {(q.discount_amount || 0) > 0 && <tr><td className="py-0.5">Discount</td><td className="py-0.5 text-right">− {fmtMoney(q.discount_amount)}</td></tr>}
                {(q.shipping_charges || 0) > 0 && <tr><td className="py-0.5">Shipping</td><td className="py-0.5 text-right">{fmtMoney(q.shipping_charges)}</td></tr>}
                {(q.adjustment || 0) !== 0 && <tr><td className="py-0.5">Adjustment</td><td className="py-0.5 text-right">{fmtMoney(q.adjustment)}</td></tr>}
                {totals.cgst_amount > 0 && <tr><td className="py-0.5">CGST</td><td className="py-0.5 text-right">{fmtMoney(totals.cgst_amount)}</td></tr>}
                {totals.sgst_amount > 0 && <tr><td className="py-0.5">SGST</td><td className="py-0.5 text-right">{fmtMoney(totals.sgst_amount)}</td></tr>}
                {totals.igst_amount > 0 && <tr><td className="py-0.5">IGST</td><td className="py-0.5 text-right">{fmtMoney(totals.igst_amount)}</td></tr>}
                {totals.tcs_amount > 0 && <tr><td className="py-0.5">TCS ({q.tcs_percent}%)</td><td className="py-0.5 text-right">{fmtMoney(totals.tcs_amount)}</td></tr>}
                {(q.round_off || 0) !== 0 && <tr><td className="py-0.5">Round-off</td><td className="py-0.5 text-right">{fmtMoney(q.round_off)}</td></tr>}
                <tr className="border-t-2 border-gray-700"><td className="py-1 font-bold">Total</td><td className="py-1 text-right font-bold">{fmtMoney(totals.total)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {q.customer_notes && <div className="mt-5 text-[11px]"><div className="font-semibold">Notes</div><div className="whitespace-pre-line">{q.customer_notes}</div></div>}
        {q.terms && <div className="mt-3 text-[11px]"><div className="font-semibold">Terms & Conditions</div><div className="whitespace-pre-line">{q.terms}</div></div>}

        <div className="grid grid-cols-2 gap-8 mt-12 text-[11px]">
          <div className="border-t border-gray-700 pt-1 text-center">Customer Signature</div>
          <div className="border-t border-gray-700 pt-1 text-center">
            For {company.name}
            <div className="mt-6 text-gray-600">Authorised Signatory</div>
          </div>
        </div>

        {(() => {
          if ((q as any).include_oem_logos === false) return null;
          const pool = logosProductOnly ? filterLogosForItems(oemLogos, q.items) : oemLogos;
          if (pool.length === 0) return null;
          const groups = {
            left: pool.filter((l) => l.position === "left"),
            center: pool.filter((l) => l.position === "center"),
            right: pool.filter((l) => l.position === "right"),
          };
          const renderGroup = (items: OemLogoWithUrl[], align: "start" | "center" | "end") => (
            <div className="flex flex-wrap items-center gap-4" style={{ justifyContent: align === "start" ? "flex-start" : align === "end" ? "flex-end" : "center" }}>
              {items.map((l) => (
                <img
                  key={l.id}
                  src={l.url}
                  alt={l.oem_name}
                  style={{ height: SIZE_PX[l.size], maxWidth: 220, objectFit: "contain" }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              ))}
            </div>
          );
          return (
            <div
              className="mt-10 pt-3 grid grid-cols-3 gap-4 items-center"
              style={{ borderTop: "0.5px solid #9ca3af", background: "#fafafa", padding: "12px 16px" }}
            >
              <div>{renderGroup(groups.left, "start")}</div>
              <div>{renderGroup(groups.center, "center")}</div>
              <div>{renderGroup(groups.right, "end")}</div>
            </div>
          );
        })()}
      </div>

      <BundleApplyDialog
        parent={bundleFor}
        parentQty={bundleParentQty}
        open={bundleOpen}
        onOpenChange={setBundleOpen}
        onConfirm={(picks) => {
          addItems(picks.map((pk) => ({
            product_id: pk.product.id,
            product_name: pk.product.name,
            description: pk.product.name + (pk.note ? ` — ${pk.note}` : ""),
            hsn: pk.product.hsn || undefined,
            unit: pk.product.unit || "Nos",
            qty: pk.qty,
            rate: pk.product.default_price != null ? Number(pk.product.default_price) : 0,
            discount_percent: 0,
            tax_percent: 18,
            amount: 0,
          } as QuoteItem)));
        }}
      />
    </div>
  );
}
