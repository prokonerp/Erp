import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, Save, Zap } from "lucide-react";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductMasterPicker } from "@/components/ProductMasterPicker";
import type { ProductMaster } from "@/components/ProductPicker";
import { BundleApplyDialog } from "@/components/BundleApplyDialog";
import { fetchBundleChildrenRaw } from "@/lib/productBundles";
import { SerialMultiPicker } from "@/components/SerialMultiPicker";
import type { Customer } from "@/lib/crm";
import { istTodayIso } from "@/lib/dateRange";
import {
  fetchBranches,
  emptyItem,
  inr,
  itemDraftFromBreakup,
  coverageSuffix,
  type BranchRow,
  type ItemDraft,
} from "@/lib/sales";
import {
  computeTotals,
  isValidGSTIN,
  stateCodeFromGSTIN,
  stateNameFromCode,
  amountInWords,
} from "@/lib/gst";
import { GSTIN_STATE_CODES, validateGSTINChecksum } from "@/lib/india";
import { getCompany } from "@/lib/letterhead";
import { productDisplayName, productShortName } from "@/lib/productNames";
import { useIsAdmin } from "@/lib/useRole";
import { findShortfalls, logNegativeOverrides, blockMessage, type Shortfall } from "@/lib/negativeStock";
import { NegativeStockDialog } from "@/components/NegativeStockDialog";
import { GDC_PREFILL_KEY, updateGeneralDc, type GeneralDcInvoicePrefill } from "@/lib/generalDc";
import { useUnsavedChanges, UnsavedChangesPrompt } from "@/hooks/useUnsavedChanges";
import { SALES_TYPE_META, type SalesType, getSupplyClassForSalesType } from "@/lib/sales";
import TransportDetailsModal from "@/components/TransportDetailsModal";
import {
  DEFAULT_TRANSPORT,
  type TransportDetails,
  computeEInvoiceRequired,
  computeEWayRequired,
  computeEWayRequiredYN,
  computeTransactionType,
} from "@/lib/transport";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/sales/invoices/new")({
  component: NewInvoice,
  head: () => ({ meta: [{ title: "New Invoice — Prokon" }] }),
});

function NewInvoice() {
  const nav = useNavigate();
  const [dirty, setDirty] = useState(false);
  const markDirty = () => { if (!dirty) setDirty(true); };
  const { blocker, markClean } = useUnsavedChanges(dirty);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(istTodayIso());
  const [dueDate, setDueDate] = useState<string>("");
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState("");
  const [billing, setBilling] = useState("");
  const [shipping, setShipping] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<string>("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [headerDiscount, setHeaderDiscount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; code: string }[]>([]);
  const [serialPickerIdx, setSerialPickerIdx] = useState<number | null>(null);
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [termsTouched, setTermsTouched] = useState(false);
  const [bundleFor, setBundleFor] = useState<ProductMaster | null>(null);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleParentQty, setBundleParentQty] = useState(1);
  const { isAdmin } = useIsAdmin();
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);
  const [negOpen, setNegOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<"draft" | "issued">("issued");
  // Prefill coming from an issued General Delivery Challan — stock was already
  // reduced on Issue, so the invoice must NOT deduct it a second time.
  const [fromGeneralDc, setFromGeneralDc] = useState<{ id: string; no: string | null } | null>(null);
  // ── P1 SalesType + Transport (staged) ──────────────────────────────────
  const [salesType, setSalesType] = useState<SalesType>("local_itemwise");
  const [lutNo, setLutNo] = useState("");
  const [transportDetails, setTransportDetails] = useState<TransportDetails>(DEFAULT_TRANSPORT);
  const [transportOpen, setTransportOpen] = useState(false);

  useEffect(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(GDC_PREFILL_KEY); } catch { /* noop */ }
    if (!raw) return;
    try { sessionStorage.removeItem(GDC_PREFILL_KEY); } catch { /* noop */ }
    let p: GeneralDcInvoicePrefill;
    try { p = JSON.parse(raw) as GeneralDcInvoicePrefill; } catch { return; }
    setFromGeneralDc({ id: p.general_dc_id, no: p.general_dc_no });
    if (p.branch_id) setBranchId(p.branch_id);
    if (p.billing_address) setBilling(p.billing_address);
    if (p.shipping_address) {
      setShipping(p.shipping_address);
      setSameAsBilling(p.shipping_address === p.billing_address);
    }
    if (p.notes) setNotes(p.notes);
    if (p.terms) setTerms(p.terms);
    if (Array.isArray(p.items) && p.items.length > 0) {
      setItems(p.items.map((it) => ({ ...emptyItem(), ...it })));
    }
    if (p.customer_id) {
      supabase.from("customers").select("*").eq("id", p.customer_id).maybeSingle()
        .then(({ data }) => { if (data) setCustomer(data as unknown as Customer); });
    }
  }, []);

  useEffect(() => {
    fetchBranches().then((bs) => {
      setBranches(bs);
      const def = bs.find((b) => b.is_default) || bs[0];
      if (def) setBranchId(def.id);
    }).catch((e) => toast.error(e.message));
    supabase.from("warehouses").select("id,name,code").eq("status", "Active").order("name")
      .then(({ data }) => setWarehouses((data ?? []) as any));
  }, []);

  const branch = useMemo(() => branches.find((b) => b.id === branchId) || null, [branches, branchId]);

  useEffect(() => {
    if (customer) {
      setBilling(customer.billing_address || (customer as any).address || "");
      const ship = (customer as any).shipping_address || customer.billing_address || (customer as any).address || "";
      setShipping(ship);
      setSameAsBilling(!ship || ship === (customer.billing_address || (customer as any).address || ""));
    }
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync shipping with billing when "same as" is on
  useEffect(() => {
    if (sameAsBilling) setShipping(billing);
  }, [sameAsBilling, billing]);

  // Auto-load default terms + place-of-supply from invoice_settings when branch is chosen
  useEffect(() => {
    if (!branchId) return;
    supabase
      .from("invoice_settings")
      .select("terms_default,notes_default")
      .eq("branch_id", branchId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        if (!termsTouched && !terms && (data as any).terms_default) {
          setTerms((data as any).terms_default);
        }
        if (!notes && (data as any).notes_default) {
          setNotes((data as any).notes_default);
        }
      });
  }, [branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sellerCode = branch?.state_code || stateCodeFromGSTIN(branch?.gstin) || null;
  const buyerCode = (customer as any)?.state_code || stateCodeFromGSTIN(customer?.gst || null) || null;
  const sellerState = branch?.state_name || stateNameFromCode(sellerCode);
  const buyerState = customer?.state || stateNameFromCode(buyerCode);
  const gstinError = customer?.gst && !isValidGSTIN(customer.gst)
    ? "Buyer GSTIN format looks invalid"
    : null;

  // H3: supply-class lock — nil / zero_rated / exempt must force GST 0%
  const supplyClass = getSupplyClassForSalesType(salesType);
  const isNilOrExempt = supplyClass === "nil" || supplyClass === "zero_rated" || supplyClass === "exempt";
  const isTaxIncl = !!SALES_TYPE_META[salesType]?.isTaxInclusive;

  // H4: place_of_supply fallback — buyerCode wins, else derive code from place_of_supply (buyerState)
  // place_of_supply here is the user-visible state name (defaults to buyerState, editable in future)
  const placeOfSupply = buyerState || "";
  const placeOfSupplyCode = useMemo(() => {
    if (!placeOfSupply) return null;
    for (const [code, name] of Object.entries(GSTIN_STATE_CODES)) {
      if (name.toLowerCase() === placeOfSupply.toLowerCase()) return code;
    }
    return null;
  }, [placeOfSupply]);

  const totals = useMemo(
    () =>
      computeTotals({
        sellerStateCode: sellerCode,
        buyerStateCode: buyerCode,
        placeOfSupplyStateCode: buyerCode || placeOfSupplyCode,
        items: items.map((i) => ({ qty: i.qty, rate: i.rate, discount_pct: i.discount_pct, gst_rate: i.gst_rate })),
        headerDiscount,
        roundOff: true,
        salesType,
      }),
    [items, sellerCode, buyerCode, placeOfSupplyCode, headerDiscount, salesType],
  );

  // H3: force gst_rate 0 in state when supply class is nil/zero/exempt
  useEffect(() => {
    if (!isNilOrExempt) return;
    setItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        if (Number(it.gst_rate) !== 0) {
          changed = true;
          return { ...it, gst_rate: 0 };
        }
        return it;
      });
      return changed ? next : prev;
    });
  }, [isNilOrExempt]);

  // Keep transport_details transaction_type / e_invoice_reqd / e_way_reqd in sync with branch+customer+salesType+total
  // e_way_reqd null = AUTO (threshold ≥50000); explicit Y/N overrides threshold (H2) but default null lets threshold win
  // Deps are stable primitives (not object refs) to avoid hook size churn and infinite loops
  const customerGstKey = (customer as any)?.gst ?? "";
  const branchGstinKey = branch?.gstin ?? "";
  const branchIdKey = branchId ?? "";
  const isInterstateKey = totals.is_interstate;
  const totalKey = totals.total;
  useEffect(() => {
    const buyerGst = customerGstKey || null;
    const sellerGst = branchGstinKey || null;
    const nextTx = computeTransactionType(salesType, isInterstateKey, buyerGst);
    const nextEInv = computeEInvoiceRequired(sellerGst, buyerGst);
    const nextEWayAuto = computeEWayRequiredYN(totalKey, null);
    setTransportDetails((prev) => {
      const derivedEWay = prev.e_way_reqd == null ? nextEWayAuto : prev.e_way_reqd;
      if (prev.transaction_type === nextTx && prev.e_invoice_reqd === nextEInv && prev.e_way_reqd === derivedEWay) return prev;
      return { ...prev, transaction_type: nextTx, e_invoice_reqd: nextEInv, e_way_reqd: derivedEWay };
    });
  }, [salesType, customerGstKey, branchGstinKey, branchIdKey, isInterstateKey, totalKey]);

  function setItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  async function save(status: "draft" | "issued") {
    if (!branchId) return toast.error("Choose a branch (seller)");
    if (!branch?.gstin) return toast.error("Selected branch has no GSTIN — set it in Sales → Settings");
    if (!customer) return toast.error("Choose a customer");
    if (salesType === "sez_zero_rated" && !lutNo.trim()) return toast.error("LUT No. is required for SEZ Zero Rated (SEZWOP)");
    if (items.length === 0 || items.some((it) => !it.description.trim())) return toast.error("Every line needs a description");
    if (items.some((it) => Number(it.gst_rate) > 0 && !it.hsn.trim())) return toast.error("HSN code is mandatory when GST > 0");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.warehouse_id) return toast.error(`Line ${i + 1}: select a warehouse`);
      // B-10: serialized lines must bill whole units and match serials exactly.
      const qtyNum = Number(it.qty);
      if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        return toast.error(`Line ${i + 1}: quantity must be a number greater than zero`);
      }
      if (it.is_serialized) {
        if (!Number.isInteger(qtyNum)) {
          return toast.error(`Line ${i + 1}: serialized products need a whole-number quantity (got ${qtyNum})`);
        }
        if (it.serial_numbers.length !== qtyNum) {
          return toast.error(`Line ${i + 1}: select ${qtyNum} serial number(s)`);
        }
      }
    }
    // Prevent duplicate serials across lines
    const allSerials = items.flatMap((it) => it.serial_numbers);
    if (new Set(allSerials).size !== allSerials.length) return toast.error("Duplicate serial numbers across lines");
    if (gstinError) {
      if (status === "issued") return toast.error(gstinError);
      toast.error(`${gstinError} — saving as Draft anyway, fix before Issue`);
    }
    const buyerGstRawForChecksum = String((customer as any)?.gst ?? "").trim();
    if (buyerGstRawForChecksum && buyerGstRawForChecksum.toUpperCase() !== "URP" && !validateGSTINChecksum(buyerGstRawForChecksum)) {
      if (status === "issued") return toast.error("Buyer GSTIN checksum invalid — correct customer GSTIN before Issue (or save as Draft)");
      toast.error("Buyer GSTIN checksum invalid — saving as Draft (fix GSTIN before Issue)");
    }

    // Non-serialized products: verify pooled availability before posting.
    // Converted General DCs already consumed the stock — skip the check.
    const wname = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? null;
    let short: Shortfall[] = [];
    if (!fromGeneralDc) {
      try {
        short = await findShortfalls(
          items
            .filter((it) => !it.is_serialized && it.product_id && it.part_model_no)
            .map((it) => ({
              model: it.part_model_no as string,
              label: it.description || it.part_model_no,
              warehouseId: it.warehouse_id,
              warehouseName: wname(it.warehouse_id),
              qty: Number(it.qty) || 0,
            })),
        );
      } catch (e) {
        // B-16: never skip the stock check silently — warn loudly and stop.
        console.error("Stock availability check failed:", e);
        return toast.error(
          "Could not verify stock availability. Please retry — continuing without this check could oversell inventory.",
        );
      }
    }

    if (short.length > 0) {
      if (!isAdmin) return toast.error(blockMessage(short[0]));
      setShortfalls(short);
      setPendingStatus(status);
      setNegOpen(true);
      return;
    }

    await doSave(status, false, [], null);
  }

  async function doSave(
    status: "draft" | "issued",
    allowNegative: boolean,
    short: Shortfall[],
    reason: string | null,
  ) {
    if (!customer || !branch) return;
    setSaving(true);
    try {
      // B-01: retry-safety — if a previous attempt already invoiced this
      // General DC (e.g. the DC status flip failed), go to that invoice
      // instead of creating a duplicate.
      if (fromGeneralDc?.id) {
        const { data: existingInv, error: dupErr } = await supabase
          .from("invoices")
          .select("id, invoice_no")
          .eq("source_general_dc_id", fromGeneralDc.id)
          .limit(1)
          .maybeSingle();
        if (dupErr) throw dupErr;
        if (existingInv) {
          toast.info(`This General DC was already invoiced (${existingInv.invoice_no || existingInv.id}).`);
          markClean();
          setDirty(false);
          nav({ to: "/sales/invoices/$id", params: { id: (existingInv as { id: string }).id } });
          return;
        }
      }
      const company = await getCompany();
      const meta = SALES_TYPE_META[salesType];
      const invoicePayload: any = {
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        branch_id: branchId,
        customer_id: customer.id,
        po_number: poNumber || null,
        po_date: poDate || null,
        seller_name: company.name,
        seller_gstin: company.gstin || branch.gstin,
        seller_state: sellerState,
        seller_state_code: sellerCode,
        seller_address: company.regd_address,
        buyer_name: customer.company,
        buyer_gstin: customer.gst,
        buyer_state: buyerState,
        buyer_state_code: buyerCode,
        billing_address: billing,
        shipping_address: shipping,
        place_of_supply: buyerState,
        place_of_supply_code: buyerCode,
        is_interstate: totals.is_interstate,
        // ── P1 SalesType branching ──────────────────────────────────
        sales_type: salesType,
        is_tax_inclusive: meta.isTaxInclusive,
        supply_class: meta.supplyClass,
        lut_no: salesType === "sez_zero_rated" ? (lutNo.trim() || null) : null,
        transport_details: transportDetails as any,
        e_invoice_required: computeEInvoiceRequired(company.gstin || branch.gstin, customer.gst) === "Y" || transportDetails.e_invoice_reqd === "Y",
        e_way_required: computeEWayRequired(totals.total, transportDetails.e_way_reqd),
        einvoice_status: (computeEInvoiceRequired(company.gstin || branch.gstin, customer.gst) === "Y" || transportDetails.e_invoice_reqd === "Y") ? "pending" : "not_required",
        eway_status: computeEWayRequired(totals.total, transportDetails.e_way_reqd) ? "pending" : "not_required",
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxable_value: totals.taxable_value,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        cess: totals.cess,
        round_off: totals.round_off,
        total: totals.total,
        total_in_words: amountInWords(totals.total),
        status,
        notes,
        terms,
        payment_terms: paymentTerms || null,
        allow_negative_stock: allowNegative,
        // Stock already left the warehouse when the General DC was issued.
        skip_stock_posting: !!fromGeneralDc,
        source_general_dc_id: fromGeneralDc?.id ?? null,
      };
      const { data: inv, error } = await supabase.from("invoices").insert(invoicePayload).select("id, invoice_no").single();
      if (error) throw error;

      const itemRows = items.map((d, i) => {
        const b = totals.items[i];
        const row = itemDraftFromBreakup(d, b);
        return { ...row, invoice_id: inv.id, sr_no: i + 1 };
      });
      const { error: e2 } = await supabase.from("invoice_items").insert(itemRows);
      if (e2) {
        // TODO(RPC): replace compensating delete with atomic DB transaction/RPC (insert header+items atomically) to avoid orphan window.
        // Compensating cleanup: never leave an orphan invoice header without
        // its line items — a retry would treat the broken invoice as done.
        try {
          const { error: delErr } = await supabase.from("invoices").delete().eq("id", inv.id);
          if (delErr) {
            console.error("[invoices.new] compensating delete failed — orphan header may remain", delErr, { invoiceId: inv.id });
            toast.error(`Invoice items failed and cleanup also failed (orphan ${inv.invoice_no || inv.id}): ${delErr.message}. Contact admin.`);
          }
        } catch (cleanupErr) {
          console.error("[invoices.new] compensating delete threw", cleanupErr, { invoiceId: inv.id });
          toast.error(`Invoice items failed and rollback threw: ${(cleanupErr as Error).message}`);
        }
        throw new Error(`Invoice items could not be saved (header rolled back): ${e2.message}`);
      }

      if (allowNegative && short.length > 0) {
        try {
          await logNegativeOverrides({
            documentType: "invoice",
            documentId: inv.id,
            documentNo: inv.invoice_no,
            shortfalls: short,
            reason,
          });
        } catch (logErr) {
          // B-16: the invoice exists — do NOT fail the whole flow, but the
          // missing audit trail must be surfaced.
          console.error("Negative-stock override logging failed:", logErr);
          toast.error(
            `Invoice ${inv.invoice_no || ""} was saved, but recording the negative-stock approval failed (${(logErr as Error).message}). Ask an admin to review this invoice.`,
          );
        }
      }

      if (fromGeneralDc) {
        // B-01: this flip is what prevents double-billing a DC — a failure
        // must never be swallowed. Retry is safe (the dup-check above
        // redirects to the already-created invoice).
        try {
          await updateGeneralDc(fromGeneralDc.id, {
            status: "Converted",
            converted_invoice_id: inv.id,
          });
        } catch (gdcErr) {
          throw new Error(
            `Invoice ${inv.invoice_no || ""} was created, but marking the General DC as Converted failed: ${(gdcErr as Error).message}. Open the DC and convert it manually — do NOT invoice it again.`,
          );
        }
      }

      toast.success(`Invoice ${inv.invoice_no || ""} ${status === "issued" ? "issued" : "saved"}`);
      // Clear the guard synchronously BEFORE navigating (see useUnsavedChanges).
      markClean();
      setDirty(false);
      nav({ to: "/sales/invoices/$id", params: { id: inv.id } });
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" onInput={markDirty}>
      <UnsavedChangesPrompt blocker={blocker} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">New Invoice</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => save("draft")} disabled={saving}>
            <Save className="h-4 w-4 mr-1.5" />Save Draft
          </Button>
          <Button size="sm" onClick={() => save("issued")} disabled={saving}>
            <Zap className="h-4 w-4 mr-1.5" />Issue Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Header</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Branch (Seller) *</Label>
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">— select —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.gstin ? ` · ${b.gstin}` : ""}{b.state_name ? ` · ${b.state_name}` : ""}
                  </option>
                ))}
              </select>
              {branch && !branch.gstin && (
                <p className="text-xs text-destructive mt-1">Branch missing GSTIN — set it in Sales → Settings.</p>
              )}
            </div>
            <div>
              <Label className="text-xs">Customer *</Label>
              <CustomerPicker value={customer?.id} onChange={(_id, c) => { setCustomer(c); markDirty(); }} />
              {gstinError && <p className="text-xs text-destructive mt-1">{gstinError}</p>}
            </div>
            <div>
              <Label className="text-xs">Invoice Date</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">PO Number</Label>
              <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="Customer PO No." />
            </div>
            <div>
              <Label className="text-xs">PO Date</Label>
              <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Payment Terms</Label>
              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm w-40"
                  value={["Advance","7 Days","15 Days","30 Days"].includes(paymentTerms) ? paymentTerms : "Custom"}
                  onChange={(e) => setPaymentTerms(e.target.value === "Custom" ? "" : e.target.value)}
                >
                  <option value="Advance">Advance</option>
                  <option value="7 Days">7 Days</option>
                  <option value="15 Days">15 Days</option>
                  <option value="30 Days">30 Days</option>
                  <option value="Custom">Custom</option>
                </select>
                <Input
                  className="flex-1"
                  placeholder="e.g. 45 Days / Against Delivery"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Billing Address</Label>
              <Textarea rows={2} value={billing} onChange={(e) => setBilling(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Shipping Address</Label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameAsBilling}
                    onChange={(e) => setSameAsBilling(e.target.checked)}
                  />
                  Same as Billing Address
                </label>
              </div>
              <Textarea
                rows={2}
                value={shipping}
                disabled={sameAsBilling}
                onChange={(e) => setShipping(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Sales Type</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={salesType}
                onChange={(e) => {
                  const v = e.target.value as SalesType;
                  setSalesType(v);
                  markDirty();
                }}
              >
                {Object.entries(SALES_TYPE_META).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label} — {meta.gstrBucket}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {SALES_TYPE_META[salesType].gstrBucket}
                {SALES_TYPE_META[salesType].isTaxInclusive ? " · Tax Inclusive" : ""}
                {SALES_TYPE_META[salesType].supplyClass ? ` · ${SALES_TYPE_META[salesType].supplyClass}` : ""}
              </p>
              {salesType === "sez_zero_rated" && (
                <div className="space-y-1">
                  <Label className="text-xs">LUT No. *</Label>
                  <Input
                    value={lutNo}
                    onChange={(e) => setLutNo(e.target.value)}
                    placeholder="LUT/2025-26/001 — required for SEZ Zero Rated"
                    className="h-8 text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">Required for SEZWOP — shown on GST JSON & PDF.</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">GST Determination</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex justify-between"><span className="text-muted-foreground">Seller State</span><span>{sellerState || "—"} {sellerCode && `(${sellerCode})`}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Buyer State</span><span>{buyerState || "—"} {buyerCode && `(${buyerCode})`}</span></div>
              <div className="pt-2 border-t">
                {totals.is_interstate ? (
                  <span className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">Inter-state supply — IGST applies</span>
                ) : sellerCode && buyerCode ? (
                  <span className="inline-block bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">Intra-state supply — CGST + SGST</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Pick branch and customer to determine tax type.</span>
                )}
              </div>
              {SALES_TYPE_META[salesType].supplyClass && (
                <div className="text-xs text-muted-foreground">Supply Class: <span className="font-medium text-foreground">{SALES_TYPE_META[salesType].supplyClass}</span> · {SALES_TYPE_META[salesType].gstrBucket}</div>
              )}
              {SALES_TYPE_META[salesType].isTaxInclusive && (
                <div className="text-xs text-amber-700">Tax Inclusive — MRP back-calc active.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Transport &amp; Dispatch</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setTransportOpen(true)}>Edit</Button>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Transport Mode</div>
              <div className="font-medium">{transportDetails.transport_mode} / {transportDetails.mode_of_transport}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Vehicle No</div>
              <div className="font-mono text-xs">{transportDetails.vehicle_no || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Station / To Place</div>
              <div className="truncate">{transportDetails.station_to_place || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Distance</div>
              <div>{transportDetails.distance_km != null ? `${transportDetails.distance_km} km` : "—"}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant={transportDetails.e_invoice_reqd === "Y" ? "default" : "secondary"}>e-Invoice {transportDetails.e_invoice_reqd}</Badge>
            <Badge variant={transportDetails.e_way_reqd === "Y" ? "default" : "secondary"}>e-Way {transportDetails.e_way_reqd}</Badge>
            {transportDetails.gr_rr_no && <span className="text-xs text-muted-foreground">GR/RR: <span className="font-mono text-foreground">{transportDetails.gr_rr_no}</span></span>}
            {transportDetails.transporter_name && <span className="text-xs text-muted-foreground truncate">Transporter: <span className="font-medium text-foreground">{transportDetails.transporter_name}</span></span>}
          </div>
          <p className="text-[11px] text-muted-foreground">Stored as <span className="font-mono">transport_details</span> JSONB — edit via TransportDetailsModal (F2-Done, F4-Pick from DB).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" variant="outline" onClick={() => { setItems((a) => [...a, emptyItem()]); markDirty(); }}><Plus className="h-4 w-4 mr-1" />Add row</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-2 text-left w-8">#</th>
                  <th className="p-2 text-left min-w-[220px]">Product / Description</th>
                  <th className="p-2 text-left w-24">HSN *</th>
                  <th className="p-2 text-left w-40">Warehouse *</th>
                  <th className="p-2 text-right w-20">Qty</th>
                  <th className="p-2 text-left w-20">Unit</th>
                  <th className="p-2 text-right w-24">Rate</th>
                  <th className="p-2 text-right w-16">Disc%</th>
                  <th className="p-2 text-right w-20">GST%</th>
                  <th className="p-2 text-right w-24">Amount</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const b = totals.items[idx];
                  return (
                    <tr key={idx} className="border-t align-top">
                      <td className="p-2 text-xs">{idx + 1}</td>
                      <td className="p-2 space-y-1">
                        <ProductMasterPicker
                          value={it.product_id}
                          onPick={(p) => {
                            setItem(idx, {
                            product_id: p.id,
                            description: `${(p as any).description || productDisplayName(p as any)}${coverageSuffix(p as any)}`,
                            hsn: p.hsn || "",
                            unit: p.unit || "Nos",
                            gst_rate: (p as any).gst_rate ?? it.gst_rate,
                            is_serialized: !!(p as any).serial_tracking,
                            part_model_no: p.model,
                            part_name: productShortName(p as any),
                            serial_numbers: [],
                            });
                            fetchBundleChildrenRaw(p.id).then((rowsB) => {
                              if (rowsB.length > 0) {
                                setBundleParentQty(Number(it.qty) || 1);
                                setBundleFor(p as any);
                                setBundleOpen(true);
                              }
                            }).catch(() => {});
                          }}
                        />
                        <Input className="h-8 text-xs" placeholder="Description" value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} />
                        {it.is_serialized && (
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={it.serial_numbers.length === Math.floor(Number(it.qty)) ? "outline" : "secondary"}
                              className="h-7 text-xs"
                              onClick={() => setSerialPickerIdx(idx)}
                              disabled={!it.warehouse_id || Number(it.qty) <= 0}
                            >
                              Serials: {it.serial_numbers.length}/{Math.floor(Number(it.qty)) || 0}
                            </Button>
                            {it.serial_numbers.length > 0 && (
                              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[220px]">
                                {it.serial_numbers.join(", ")}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-2"><Input className="h-8 text-xs" value={it.hsn} onChange={(e) => setItem(idx, { hsn: e.target.value })} /></td>
                      <td className="p-2">
                        <select
                          className="w-full h-8 rounded-md border bg-background px-1 text-xs"
                          value={it.warehouse_id || ""}
                          onChange={(e) => setItem(idx, { warehouse_id: e.target.value || null, serial_numbers: [] })}
                        >
                          <option value="">— select —</option>
                          {warehouses.map((w) => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2"><Input type="number" step="0.001" className="h-8 text-xs text-right" value={it.qty} onChange={(e) => setItem(idx, { qty: Number(e.target.value) })} /></td>
                      <td className="p-2"><Input className="h-8 text-xs" value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })} /></td>
                      <td className="p-2"><Input type="number" step="0.01" className="h-8 text-xs text-right" value={it.rate} onChange={(e) => setItem(idx, { rate: Number(e.target.value) })} /></td>
                      <td className="p-2"><Input type="number" step="0.01" className="h-8 text-xs text-right" value={it.discount_pct} onChange={(e) => setItem(idx, { discount_pct: Number(e.target.value) })} /></td>
                      <td className="p-2">
                        {isNilOrExempt ? (
                          <div className="flex flex-col items-start gap-1">
                            <select
                              className="w-full h-8 rounded-md border bg-muted px-1 text-xs"
                              value={0}
                              disabled
                              title="Nil — GST 0%"
                            >
                              <option value={0}>0%</option>
                            </select>
                            <Badge variant="secondary" className="text-[10px]">Nil — GST 0%</Badge>
                          </div>
                        ) : (
                          <>
                            <select className="w-full h-8 rounded-md border bg-background px-1 text-xs" value={it.gst_rate} onChange={(e) => setItem(idx, { gst_rate: Number(e.target.value) })}>
                              {[0, 0.1, 0.25, 1.5, 3, 5, 6, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
                            </select>
                            {isTaxIncl && (
                              <p className="text-[10px] text-amber-600 mt-1">Tax incl. — MRP back-calc active</p>
                            )}
                          </>
                        )}
                      </td>
                      <td className="p-2 text-right font-medium">{inr(b?.line_total || 0)}</td>
                      <td className="p-2 text-right">
                        <Button size="icon" variant="ghost" onClick={() => { setItems((a) => a.filter((_, i) => i !== idx)); markDirty(); }}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {serialPickerIdx !== null && items[serialPickerIdx] && (
        <SerialMultiPicker
          open={serialPickerIdx !== null}
          onOpenChange={(v) => !v && setSerialPickerIdx(null)}
          qty={Math.floor(Number(items[serialPickerIdx].qty)) || 0}
          warehouseId={items[serialPickerIdx].warehouse_id}
          partModelNo={items[serialPickerIdx].part_model_no}
          partName={items[serialPickerIdx].part_name}
          value={items[serialPickerIdx].serial_numbers}
          excludeSerials={items.flatMap((it, i) => (i === serialPickerIdx ? [] : it.serial_numbers))}
          onConfirm={(sns) => setItem(serialPickerIdx, { serial_numbers: sns })}
        />
      )}

      <NegativeStockDialog
        open={negOpen}
        onOpenChange={setNegOpen}
        shortfalls={shortfalls}
        onProceed={async (reason) => {
          setNegOpen(false);
          await doSave(pendingStatus, true, shortfalls, reason || null);
        }}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Notes & Terms</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Terms & Conditions</Label>
              <Textarea
                rows={3}
                value={terms}
                onChange={(e) => { setTerms(e.target.value); setTermsTouched(true); }}
                placeholder="Auto-loaded from Sales Settings; edit to override for this invoice."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Totals</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <div className="flex justify-between"><span>Subtotal</span><span>{inr(totals.subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <span>Discount</span>
              <Input type="number" step="0.01" className="h-7 w-28 text-right text-xs" value={headerDiscount} onChange={(e) => setHeaderDiscount(Number(e.target.value))} />
            </div>
            <div className="flex justify-between"><span>Taxable Value</span><span>{inr(totals.taxable_value)}</span></div>
            {totals.is_interstate ? (
              <div className="flex justify-between"><span>IGST</span><span>{inr(totals.igst)}</span></div>
            ) : (
              <>
                <div className="flex justify-between"><span>CGST</span><span>{inr(totals.cgst)}</span></div>
                <div className="flex justify-between"><span>SGST</span><span>{inr(totals.sgst)}</span></div>
              </>
            )}
            {totals.round_off !== 0 && (
              <div className="flex justify-between"><span>Round Off</span><span>{inr(totals.round_off)}</span></div>
            )}
            <div className="flex justify-between pt-2 border-t font-bold text-base">
              <span>Total</span><span>{inr(totals.total)}</span>
            </div>
            <p className="text-xs text-muted-foreground pt-1 italic">{amountInWords(totals.total)}</p>
          </CardContent>
        </Card>
      </div>

      <BundleApplyDialog
        parent={bundleFor}
        parentQty={bundleParentQty}
        open={bundleOpen}
        onOpenChange={setBundleOpen}
        onConfirm={(picks) => {
          setItems((arr) => [
            ...arr,
            ...picks.map((pk) => ({
              product_id: pk.product.id,
              description: productDisplayName(pk.product as any) + (pk.note ? ` — ${pk.note}` : ""),
              hsn: pk.product.hsn || "",
              qty: pk.qty,
              unit: pk.product.unit || "Nos",
              rate: pk.product.default_price != null ? Number(pk.product.default_price) : 0,
              discount_pct: 0,
              gst_rate: (pk.product as any).gst_rate ?? 18,
              warehouse_id: null,
              serial_numbers: [],
              is_serialized: !!(pk.product as any).serial_tracking,
              part_model_no: pk.product.model ?? null,
              part_name: productShortName(pk.product as any),
            })),
          ]);
        }}
      />

      <TransportDetailsModal
        open={transportOpen}
        onOpenChange={setTransportOpen}
        value={transportDetails}
        onSave={(v) => { setTransportDetails(v); markDirty(); }}
        billAmt={totals.total}
        taxableAmt={totals.taxable_value}
        taxAmt={totals.cgst + totals.sgst + totals.igst}
      />
    </div>
  );
}