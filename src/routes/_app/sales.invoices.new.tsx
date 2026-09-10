import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { Customer, CustomerBranch } from "@/lib/crm";
import { branchToDocumentFields } from "@/lib/crm";
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
import { SO_PREFILL_KEY, PROFORMA_PREFILL_KEY, type FulfillmentLine } from "@/lib/documentFlow";
import { createTaxInvoiceFromSO, createInvoiceFromProforma } from "@/lib/documentFlow.writers";
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
  const [reverseCharge, setReverseCharge] = useState(false);
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
  // SO / Proforma prefill (split-delivery V2)
  const [soPrefill, setSoPrefill] = useState<null | {
    sales_order_id: string;
    sales_order_no: string | null;
    po_number: string | null;
    po_date?: string | null;
    branch_id?: string | null;
    customer_id?: string | null;
    billing_address?: string | null;
    shipping_address?: string | null;
    notes?: string | null;
    terms?: string | null;
    lines: FulfillmentLine[] & any[];
    prior_fulfilled?: any[];
    this_fulfilled?: any[];
    header?: Record<string, any>;
    orderedTotal?: number;
    fulfilledTotal?: number;
    balanceTotal?: number;
    thisTotal?: number;
  }>(null);
  const [proformaPrefill, setProformaPrefill] = useState<null | {
    proforma_id: string;
    proforma_no: string | null;
    branch_id?: string | null;
    customer_id?: string | null;
    billing_address?: string | null;
    shipping_address?: string | null;
    notes?: string | null;
    terms?: string | null;
    items?: any[];
  }>(null);
  const [linkedProformaId, setLinkedProformaId] = useState<string | null>(null);
  // ── P1 SalesType + Transport (staged) ──────────────────────────────────
  const [salesType, setSalesType] = useState<SalesType>("local_itemwise");
  const [lutNo, setLutNo] = useState("");
  const [transportDetails, setTransportDetails] = useState<TransportDetails>(DEFAULT_TRANSPORT);
  const [transportOpen, setTransportOpen] = useState(false);

  useEffect(() => {
    // Order: SO → Proforma → GDC (existing). Each consumes and clears its key.
    let handled = false;
    // ── SO prefill ────────────────────────────────────────────────────────
    try {
      const raw = sessionStorage.getItem(SO_PREFILL_KEY);
      if (raw) {
        try { sessionStorage.removeItem(SO_PREFILL_KEY); } catch { /* noop */ }
        const p: any = JSON.parse(raw);
        const salesOrderId: string | null = p.sales_order_id || p.salesOrderId || p.so_id || p.id || null;
        if (salesOrderId) {
          handled = true;
          const header = p.header || p;
          const rawLines: any[] = Array.isArray(p.lines) ? p.lines : Array.isArray(p.items) ? p.items : Array.isArray(p.fulfillmentLines) ? p.fulfillmentLines : [];
          // Normalize lines to enriched shape: keep ordered/fulfilled/balance/this_qty when present
          const enriched = rawLines.map((l: any, idx: number) => {
            const lineIndex = l.line_index != null ? Number(l.line_index) : idx;
            const ordered = Number(l.ordered_qty ?? l.orderedQty ?? l.qty ?? l.this_qty ?? 0) || 0;
            const fulfilledBefore = Number(l.fulfilled_before ?? l.fulfilledBefore ?? l.prior_fulfilled ?? 0) || 0;
            const balance = l.balance != null ? Number(l.balance) : Math.max(0, ordered - fulfilledBefore);
            const thisQty = Number(l.this_qty ?? l.thisQty ?? l.qty ?? balance) || 0;
            return {
              line_index: lineIndex,
              product_id: l.product_id ?? l.productId ?? null,
              description: l.description ?? l.part_name ?? l.partName ?? "",
              hsn: l.hsn ?? "",
              qty: thisQty,
              unit: l.unit ?? l.uom ?? "Nos",
              rate: Number(l.rate ?? l.unit_price ?? 0) || 0,
              discount_pct: Number(l.discount_pct ?? l.discount ?? 0) || 0,
              gst_rate: Number(l.gst_rate ?? l.gstRate ?? 18) || 0,
              cess_rate: Number(l.cess_rate ?? 0) || 0,
              warehouse_id: l.warehouse_id ?? l.warehouseId ?? null,
              serial_numbers: Array.isArray(l.serial_numbers) ? l.serial_numbers : Array.isArray(l.serialNumbers) ? l.serialNumbers : [],
              is_serialized: !!(l.is_serialized ?? l.isSerialized),
              part_model_no: l.part_model_no ?? l.model_no ?? null,
              part_name: l.part_name ?? l.partName ?? null,
              ordered_qty: ordered,
              fulfilled_before: fulfilledBefore,
              balance,
              this_qty: thisQty,
            };
          });
          // Compute totals for info bar
          const orderedTotal = enriched.reduce((s: number, l: any) => s + (Number(l.ordered_qty) || 0), 0);
          const fulfilledTotal = enriched.reduce((s: number, l: any) => s + (Number(l.fulfilled_before) || 0), 0);
          const balanceTotal = enriched.reduce((s: number, l: any) => s + (Number(l.balance) || 0), 0);
          const thisTotal = enriched.reduce((s: number, l: any) => s + (Number(l.this_qty) || 0), 0);
          const priorFulfilled = Array.isArray(p.prior_fulfilled) ? p.prior_fulfilled : enriched.map((l: any) => ({ line_index: l.line_index, fulfilled_before: l.fulfilled_before }));
          // Apply to form
          setSoPrefill({
            sales_order_id: salesOrderId,
            sales_order_no: p.sales_order_no ?? p.so_no ?? header.sales_order_no ?? header.so_no ?? null,
            po_number: header.po_number ?? p.po_number ?? null,
            po_date: header.po_date ?? p.po_date ?? null,
            branch_id: header.branch_id ?? p.branch_id ?? null,
            customer_id: header.customer_id ?? p.customer_id ?? null,
            billing_address: header.billing_address ?? p.billing_address ?? null,
            shipping_address: header.shipping_address ?? p.shipping_address ?? null,
            notes: header.notes ?? p.notes ?? null,
            terms: header.terms ?? p.terms ?? null,
            lines: enriched,
            prior_fulfilled: priorFulfilled,
            this_fulfilled: p.this_fulfilled ?? enriched.filter((l: any) => Number(l.this_qty) > 0).map((l: any) => ({ line_index: l.line_index, this_qty: l.this_qty })),
            header,
            orderedTotal,
            fulfilledTotal,
            balanceTotal,
            thisTotal,
          });
          if (header.branch_id || p.branch_id) setBranchId(header.branch_id ?? p.branch_id);
          if (header.billing_address ?? p.billing_address) setBilling(header.billing_address ?? p.billing_address);
          if (header.shipping_address ?? p.shipping_address) {
            const ship = header.shipping_address ?? p.shipping_address;
            setShipping(ship);
            const bill = header.billing_address ?? p.billing_address ?? "";
            setSameAsBilling(ship === bill);
          }
          if (header.po_number ?? p.po_number) setPoNumber(header.po_number ?? p.po_number);
          if (header.po_date ?? p.po_date) setPoDate(header.po_date ?? p.po_date);
          if (header.notes ?? p.notes) setNotes(header.notes ?? p.notes);
          if (header.terms ?? p.terms) setTerms(header.terms ?? p.terms);
          if (enriched.length > 0) {
            setItems(enriched.map((l: any) => ({ ...emptyItem(), ...l, qty: l.this_qty })));
          }
          const cid = header.customer_id ?? p.customer_id ?? null;
          if (cid) {
            supabase.from("customers").select("*").eq("id", cid).maybeSingle()
              .then(({ data }) => { if (data) setCustomer(data as unknown as Customer); });
          }
          // SO handled — do not fall through to Proforma/GDC
        }
      }
    } catch { /* noop */ }
    if (handled) return;
    // ── Proforma prefill ────────────────────────────────────────────────
    try {
      const raw = sessionStorage.getItem(PROFORMA_PREFILL_KEY);
      if (raw) {
        try { sessionStorage.removeItem(PROFORMA_PREFILL_KEY); } catch { /* noop */ }
        const p: any = JSON.parse(raw);
        const proformaId: string | null = p.proforma_id || p.proformaId || p.id || null;
        if (proformaId || Array.isArray(p.items)) {
          handled = true;
          const header = p.header || p;
          setProformaPrefill({
            proforma_id: proformaId || "",
            proforma_no: p.proforma_no ?? p.proformaNo ?? header.proforma_no ?? null,
            branch_id: header.branch_id ?? p.branch_id ?? null,
            customer_id: header.customer_id ?? p.customer_id ?? null,
            billing_address: header.billing_address ?? p.billing_address ?? null,
            shipping_address: header.shipping_address ?? p.shipping_address ?? null,
            notes: header.notes ?? p.notes ?? null,
            terms: header.terms ?? p.terms ?? null,
            items: p.items || header.items || [],
          });
          if (proformaId) setLinkedProformaId(proformaId);
          if (header.branch_id ?? p.branch_id) setBranchId(header.branch_id ?? p.branch_id);
          if (header.billing_address ?? p.billing_address) setBilling(header.billing_address ?? p.billing_address);
          if (header.shipping_address ?? p.shipping_address) {
            const ship = header.shipping_address ?? p.shipping_address;
            setShipping(ship);
            const bill = header.billing_address ?? p.billing_address ?? "";
            setSameAsBilling(ship === bill);
          }
          if (header.notes ?? p.notes) setNotes(header.notes ?? p.notes);
          if (header.terms ?? p.terms) setTerms(header.terms ?? p.terms);
          if (Array.isArray(p.items) && p.items.length > 0) {
            setItems(p.items.map((it: any) => ({ ...emptyItem(), ...it })));
          } else if (Array.isArray(header.items) && header.items.length > 0) {
            setItems(header.items.map((it: any) => ({ ...emptyItem(), ...it })));
          }
          const cid = header.customer_id ?? p.customer_id ?? null;
          if (cid) {
            supabase.from("customers").select("*").eq("id", cid).maybeSingle()
              .then(({ data }) => { if (data) setCustomer(data as unknown as Customer); });
          }
        }
      }
    } catch { /* noop */ }
    if (handled) return;
    // ── GDC prefill (existing) ──────────────────────────────────────────
    try {
      const raw = sessionStorage.getItem(GDC_PREFILL_KEY);
      if (!raw) return;
      try { sessionStorage.removeItem(GDC_PREFILL_KEY); } catch { /* noop */ }
      const p = JSON.parse(raw) as GeneralDcInvoicePrefill;
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
    } catch { /* noop */ }
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

  // Selected customer branch office (transient — not persisted to the document;
  // its address fields feed the sync effect below).
  const [branchOverride, setBranchOverride] = useState<CustomerBranch | null>(null);
  // Suppresses the "same as billing" sync effect for one commit after a
  // customer/branch selection applies a (possibly distinct) shipping address.
  const skipShipSync = useRef(false);

  useEffect(() => {
    if (customer) {
      if (branchOverride) {
        // Branch wins over the customer's main address; customer fields fall back.
        const bf = branchToDocumentFields(branchOverride);
        const bill = bf.billing_address || customer.billing_address || (customer as any).address || "";
        const ship = bf.shipping_address || bf.billing_address || (customer as any).shipping_address || bill;
        setBilling(bill);
        setShipping(ship);
        setSameAsBilling(!ship || ship === bill);
        // The branch may carry a distinct shipping address — do not let the
        // "same as billing" sync effect (below) override it in the same commit.
        skipShipSync.current = true;
        return;
      }
      setBilling(customer.billing_address || (customer as any).address || "");
      const ship = (customer as any).shipping_address || customer.billing_address || (customer as any).address || "";
      setShipping(ship);
      setSameAsBilling(!ship || ship === (customer.billing_address || (customer as any).address || ""));
      skipShipSync.current = true;
    }
  }, [customer?.id, branchOverride]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync shipping with billing when "same as" is on
  useEffect(() => {
    if (sameAsBilling && !skipShipSync.current) setShipping(billing);
    skipShipSync.current = false;
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
  const sellerState = branch?.state_name || stateNameFromCode(sellerCode);
  // When a customer branch office is selected it supplies the buyer's
  // place-of-supply state (and optional branch GSTIN) in place of the
  // customer's main/registered state — this keeps GST classification
  // (CGST/SGST vs IGST) correct for inter-state branch shipments.
  const branchPos = branchOverride ? branchToDocumentFields(branchOverride).place_of_supply : null;
  const branchGstCode = branchOverride?.gstin ? stateCodeFromGSTIN(branchOverride.gstin) : null;
  const customerCode = (customer as any)?.state_code || stateCodeFromGSTIN(customer?.gst || null) || null;
  const buyerState = branchPos || customer?.state || stateNameFromCode(customerCode);
  const buyerCode = useMemo(() => {
    // Branch GSTIN / state takes precedence over the customer's registered state.
    if (branchGstCode) return branchGstCode;
    if (branchPos) {
      for (const [code, name] of Object.entries(GSTIN_STATE_CODES)) {
        if (name.toLowerCase() === branchPos.toLowerCase()) return code;
      }
    }
    return customerCode;
  }, [branchGstCode, branchPos, customerCode]);
  const gstinError = (branchOverride?.gstin || customer?.gst) && !isValidGSTIN(branchOverride?.gstin || customer?.gst)
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
        items: items.map((i) => ({ qty: i.qty, rate: i.rate, discount_pct: i.discount_pct, gst_rate: i.gst_rate, cess_rate: (i as any).cess_rate || 0 })),
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
    // SO prefill: enforce qty cap against balance
    if (soPrefill) {
      for (let i = 0; i < items.length; i++) {
        const capLine = (soPrefill.lines as any[])[i];
        const balance = capLine ? Number(capLine.balance) : Infinity;
        const qtyNum = Number(items[i].qty);
        if (Number.isFinite(balance) && qtyNum > balance) {
          return toast.error(`Line ${i + 1}: quantity ${qtyNum} exceeds balance ${balance} (Against SO ${soPrefill.sales_order_no || soPrefill.sales_order_id})`);
        }
      }
      // At least one line must have qty >0 and <= balance (already validated above) — keep existing has-positive check via writer but surface early
      const hasPositive = items.some((it) => Number(it.qty) > 0);
      if (!hasPositive) return toast.error("Select at least one line with quantity greater than 0");
    }
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
      // ── SO prefill V2: delegate to ledger-aware writer (creates ledger + post stock) ──
      if (soPrefill) {
        if (items.length !== soPrefill.lines.length) {
          toast.error(`SO-linked invoice must keep ${soPrefill.lines.length} line(s) — found ${items.length}. Remove extra rows or recreate from SO.`);
          setSaving(false);
          return;
        }
        const linesForWriter: FulfillmentLine[] = (soPrefill.lines as any[]).map((l: any, i: number) => ({
          line_index: Number(l.line_index ?? i),
          product_id: (l.product_id as string | null) ?? null,
          ordered_qty: Number(l.ordered_qty) || 0,
          fulfilled_before: Number(l.fulfilled_before) || 0,
          balance: Number(l.balance) || 0,
          this_qty: Number(items[i]?.qty) || 0,
          warehouse_id: (items[i]?.warehouse_id as string | null) ?? (l.warehouse_id as string | null) ?? null,
          serial_numbers: Array.isArray(items[i]?.serial_numbers) ? items[i].serial_numbers : Array.isArray(l.serial_numbers) ? l.serial_numbers : [],
          is_serialized: !!(items[i]?.is_serialized ?? l.is_serialized),
        }));
        // Final cap check (defensive — save() already checked)
        for (let i = 0; i < linesForWriter.length; i++) {
          if (Number(linesForWriter[i].this_qty) > Number(linesForWriter[i].balance)) {
            throw new Error(`Line ${i + 1}: quantity ${linesForWriter[i].this_qty} exceeds balance ${linesForWriter[i].balance}`);
          }
        }
        const r = await createTaxInvoiceFromSO(soPrefill.sales_order_id, linesForWriter as any, { allow_negative_stock: allowNegative });
        // Patch header fields that user may have edited in the form (writer uses SO snapshot; apply edits)
        try {
          const headerPatch: Record<string, any> = {};
          if ((poNumber || null) !== (soPrefill.po_number ?? null)) headerPatch.po_number = poNumber || null;
          if ((poDate || null) !== (soPrefill.po_date ?? null)) headerPatch.po_date = poDate || null;
          if ((notes || null) !== (soPrefill.notes ?? null)) headerPatch.notes = notes || null;
          if ((terms || null) !== (soPrefill.terms ?? null)) headerPatch.terms = terms || null;
          if ((billing || null) !== (soPrefill.billing_address ?? null)) headerPatch.billing_address = billing || null;
          if ((shipping || null) !== (soPrefill.shipping_address ?? null)) headerPatch.shipping_address = shipping || null;
          if (Object.keys(headerPatch).length > 0) {
            await supabase.from("invoices" as never).update(headerPatch as never).eq("id", r.id);
          }
          // Patch line-level edits (rate/discount/gst/hsn/description) if any differ from SO
          // Best-effort: update invoice_items rows that were just created
          for (let i = 0; i < items.length; i++) {
            const orig = (soPrefill.lines as any[])[i];
            const cur = items[i];
            const diff: Record<string, any> = {};
            if (cur.description !== orig.description) diff.description = cur.description;
            if (cur.hsn !== (orig.hsn || "")) diff.hsn = cur.hsn || null;
            if (Number(cur.rate) !== Number(orig.rate)) diff.rate = Number(cur.rate) || 0;
            if (Number(cur.discount_pct) !== Number(orig.discount_pct)) diff.discount_pct = Number(cur.discount_pct) || 0;
            if (Number(cur.gst_rate) !== Number(orig.gst_rate)) diff.gst_rate = Number(cur.gst_rate) || 0;
            if (Number(cur.cess_rate ?? 0) !== Number(orig.cess_rate ?? 0)) diff.cess = Number(cur.cess_rate) || 0; // cess column?
            if (cur.unit !== (orig.unit || "Nos")) diff.unit = cur.unit || null;
            if (Object.keys(diff).length > 0) {
              // Need sr_no = i+1
              try {
                await supabase.from("invoice_items" as never).update(diff as never).eq("invoice_id", r.id).eq("sr_no", i + 1);
              } catch (e) { console.warn("line patch failed", e); }
            }
          }
        } catch (e) { console.warn("SO invoice header/line patch failed", e); }
        // If user asked for Issued, flip status to issued (writer creates draft)
        if (status === "issued") {
          try { await supabase.from("invoices" as never).update({ status: "issued" } as never).eq("id", r.id); } catch (e) { console.warn("SO invoice status flip to issued failed", e); }
        }
        if (allowNegative && short.length > 0) {
          try {
            await logNegativeOverrides({
              documentType: "invoice",
              documentId: r.id,
              documentNo: r.invoice_no,
              shortfalls: short,
              reason,
            });
          } catch (logErr) {
            console.error("Negative-stock override logging failed:", logErr);
            toast.error(`Invoice ${r.invoice_no || ""} was saved, but recording the negative-stock approval failed (${(logErr as Error).message}).`);
          }
        }
        toast.success(`Invoice ${r.invoice_no || ""} ${status === "issued" ? "issued" : "saved"} (Against SO ${soPrefill.sales_order_no || soPrefill.sales_order_id})`);
        markClean();
        setDirty(false);
        nav({ to: "/sales/invoices/$id", params: { id: r.id } });
        return;
      }
      // ── Proforma prefill: delegate to proforma→invoice writer ──────────
      if (proformaPrefill && linkedProformaId) {
        // Derive lines from current items for the writer (if SO-linked proforma, pass lines so ledger is created)
        const proformaLines: FulfillmentLine[] | undefined = soPrefill ? undefined : undefined;
        // For standalone proforma, just call with id (writer will copy items)
        const r = await createInvoiceFromProforma(linkedProformaId, proformaLines);
        if (status === "issued") {
          try { await supabase.from("invoices" as never).update({ status: "issued" } as never).eq("id", r.id); } catch {}
        }
        toast.success(`Invoice ${r.invoice_no || ""} ${status === "issued" ? "issued" : "saved"} (From Proforma ${proformaPrefill.proforma_no || linkedProformaId})`);
        markClean();
        setDirty(false);
        nav({ to: "/sales/invoices/$id", params: { id: r.id } });
        return;
      }
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
        buyer_gstin: branchOverride?.gstin || customer.gst,
        buyer_state: buyerState,
        buyer_state_code: buyerCode,
        billing_address: billing,
        shipping_address: shipping,
        place_of_supply: buyerState,
        place_of_supply_code: buyerCode,
        is_interstate: totals.is_interstate,
        reverse_charge: reverseCharge,
        // ── P1 SalesType branching ──────────────────────────────────
        sales_type: salesType,
        is_tax_inclusive: meta.isTaxInclusive,
        supply_class: meta.supplyClass,
        lut_no: salesType === "sez_zero_rated" ? (lutNo.trim() || null) : null,
        transport_details: transportDetails as any,
        e_invoice_required: computeEInvoiceRequired(company.gstin || branch.gstin, branchOverride?.gstin || customer.gst) === "Y" || transportDetails.e_invoice_reqd === "Y",
        e_way_required: computeEWayRequired(totals.total, transportDetails.e_way_reqd),
        einvoice_status: (computeEInvoiceRequired(company.gstin || branch.gstin, branchOverride?.gstin || customer.gst) === "Y" || transportDetails.e_invoice_reqd === "Y") ? "pending" : "not_required",
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

      {soPrefill && (
        <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium">
              Against Sales Order{" "}
              <Link to="/sales/orders/$id" params={{ id: soPrefill.sales_order_id }} className="font-mono underline decoration-dotted underline-offset-2 hover:text-amber-800">
                {soPrefill.sales_order_no || soPrefill.sales_order_id.slice(0, 8)}
              </Link>
              {soPrefill.po_number && <span className="font-mono text-xs ml-2">PO {soPrefill.po_number}</span>}
            </span>
            <span className="text-muted-foreground tabular-nums text-xs">
              Ordered <span className="font-semibold text-foreground">{soPrefill.orderedTotal ?? "—"}</span>
              {" · "}Already <span className="font-semibold text-foreground">{soPrefill.fulfilledTotal ?? "—"}</span>
              {" · "}Balance <span className="font-semibold text-amber-700">{soPrefill.balanceTotal ?? "—"}</span>
              {" · "}This shipment <span className="font-semibold text-emerald-700">{items.reduce((s, it) => s + (Number(it.qty) || 0), 0)}</span>
            </span>
            <Badge variant="outline" className="bg-white text-amber-800 border-amber-200 text-[11px] ml-auto">SO-linked — qty capped at balance</Badge>
          </CardContent>
        </Card>
      )}
      {proformaPrefill && (
        <Card className="border-blue-200 bg-blue-50/60 dark:bg-blue-950/20">
          <CardContent className="py-3 text-sm flex flex-wrap items-center gap-2">
            <span className="font-medium">
              From Proforma <span className="font-mono">{proformaPrefill.proforma_no || proformaPrefill.proforma_id.slice(0, 8)}</span>
            </span>
            <Badge variant="outline" className="bg-white text-blue-800 border-blue-200 text-[11px]">Linked — stock will post on issue</Badge>
          </CardContent>
        </Card>
      )}
      {fromGeneralDc && (
        <Card className="border-slate-200 bg-slate-50">
          <CardContent className="py-2 text-xs text-muted-foreground">
            From General DC <span className="font-mono font-medium text-foreground">{fromGeneralDc.no || fromGeneralDc.id.slice(0, 8)}</span> — stock already posted; this invoice will use <span className="font-mono">skip_stock_posting</span>
          </CardContent>
        </Card>
      )}

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
              <CustomerPicker value={customer?.id} branchValue={branchOverride?.id} onChange={(_id, c, branch) => { setCustomer(c); setBranchOverride(branch || null); markDirty(); }} branched />
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
                      <td className="p-2">
                        <Input
                          type="number"
                          step="0.001"
                          className="h-8 text-xs text-right"
                          value={it.qty}
                          max={soPrefill ? ((soPrefill.lines as any[])[idx]?.balance ?? undefined) : undefined}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            if (soPrefill) {
                              const bal = (soPrefill.lines as any[])[idx]?.balance;
                              if (bal != null && Number.isFinite(bal) && raw > bal) {
                                toast.error(`Line ${idx + 1}: quantity ${raw} exceeds balance ${bal}`);
                                setItem(idx, { qty: bal });
                                return;
                              }
                            }
                            setItem(idx, { qty: raw });
                          }}
                        />
                        {soPrefill && (soPrefill.lines as any[])[idx] && (
                          <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5 leading-none">
                            Ordered {(soPrefill.lines as any[])[idx].ordered_qty} · Already {(soPrefill.lines as any[])[idx].fulfilled_before} · Balance {(soPrefill.lines as any[])[idx].balance}
                          </div>
                        )}
                      </td>
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
            {totals.cess > 0 && (
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Cess</span><span>{inr(totals.cess)}</span></div>
            )}
            <label className="flex items-center gap-2 pt-2 border-t cursor-pointer">
              <input type="checkbox" checked={reverseCharge} onChange={(e) => { setReverseCharge(e.target.checked); markDirty(); }} />
              <span className="text-xs font-medium">Reverse Charge</span>
            </label>
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