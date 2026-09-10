import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchSoFulfillmentSummary, type SalesOrder } from "@/lib/salesOrders";
import {
  buildFulfillmentPreview,
  validateThisQty,
  orderedVsFulfilled,
  type ConversionType,
  type FulfillmentLine,
} from "@/lib/documentFlow";
import {
  createTaxInvoiceFromSO,
  createGeneralDcFromSO,
  createProformaFromSO,
} from "@/lib/documentFlow.writers";
import { computeTotals, amountInWords } from "@/lib/gst";
import { inr } from "@/lib/sales";
import { r3 } from "@/lib/money";
import { useIsAdmin } from "@/lib/useRole";
import { findShortfalls, blockMessage, type Shortfall } from "@/lib/negativeStock";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { SerialMultiPicker } from "@/components/SerialMultiPicker";
import { NegativeStockDialog } from "@/components/NegativeStockDialog";
import { AlertTriangle, Loader2, FileText, Truck, Receipt, X } from "lucide-react";
import {
  toUiConversionType,
  UI_CONVERSION_TYPES,
  type UiConversionType,
} from "@/lib/soConversionUi";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  salesOrder: SalesOrder;
  defaultType?: ConversionType;
  onSuccess?: (target: { type: string; id: string }) => void;
};

/** UI-visible conversion options — Delivery Challan (legacy `delivery_challan`)
 *  is intentionally excluded. Old ledger rows still render in the timeline
 *  (see convTypeMeta legacy branch), but new conversions offer only:
 *  Tax Invoice / General Challan / Proforma.
 *  Canonical type + normalizer live in `@/lib/soConversionUi` (unit-tested). */
export type { UiConversionType } from "@/lib/soConversionUi";

const VALID_UI_TYPES: readonly string[] = UI_CONVERSION_TYPES;

function toUiType(t: ConversionType | string | undefined | null): UiConversionType {
  return toUiConversionType(t);
}

const TYPE_META: Record<UiConversionType, { label: string; short: string; icon: React.ReactNode }> = {
  tax_invoice: { label: "Tax Invoice", short: "Tax Invoice", icon: <Receipt className="h-3.5 w-3.5" /> },
  general_dc: { label: "General Challan", short: "General Challan", icon: <Truck className="h-3.5 w-3.5" /> },
  proforma_invoice: { label: "Proforma", short: "Proforma", icon: <FileText className="h-3.5 w-3.5" /> },
};

type FormProps = {
  salesOrder: SalesOrder;
  defaultType?: ConversionType | UiConversionType;
  onSuccess?: (target: { type: string; id: string }) => void;
  onCancel?: () => void;
  /** when rendered inside Dialog, parent controls close; when full-page, onCancel navigates back */
  mode?: "dialog" | "page";
};

export function SoConversionForm({ salesOrder, defaultType, onSuccess, onCancel, mode = "page" }: FormProps) {
  const { isAdmin } = useIsAdmin();
  const [conversionType, setConversionType] = useState<UiConversionType>(toUiType(defaultType));
  const [lines, setLines] = useState<FulfillmentLine[]>([]);
  const [poNumber, setPoNumber] = useState(salesOrder.po_number || "");
  const [poDate, setPoDate] = useState(salesOrder.po_date || "");
  const [notes, setNotes] = useState(salesOrder.notes || "");
  const [terms, setTerms] = useState(salesOrder.terms || "");
  const [purpose, setPurpose] = useState("");
  const [returnable, setReturnable] = useState(false);
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [whError, setWhError] = useState<string | null>(null);

  const loadWarehouses = async () => {
    setWhError(null);
    try {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id,name")
        .eq("status", "Active")
        .order("name");
      if (error) {
        // Persistent banner (not just a toast) so the form never looks
        // silently dead when the warehouse list can't load.
        setWhError(error.message || "Could not load warehouses");
        return;
      }
      setWarehouses((data ?? []) as { id: string; name: string }[]);
    } catch (e: unknown) {
      // Transport failures (e.g. connection closed) throw here with no
      // response — same persistent treatment.
      setWhError((e as Error)?.message || "Could not load warehouses — check your connection");
    }
  };
  const [busy, setBusy] = useState(false);
  const [allowNegative, setAllowNegative] = useState(false);
  const [serialIdx, setSerialIdx] = useState<number | null>(null);
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);
  const [negOpen, setNegOpen] = useState(false);
  const [pendingIssue, setPendingIssue] = useState(false);

  useEffect(() => {
    if (defaultType) setConversionType(toUiType(defaultType));
  }, [defaultType]);

  useEffect(() => {
    setPoNumber(salesOrder.po_number || "");
    setPoDate(salesOrder.po_date || "");
    setNotes(salesOrder.notes || "");
    setTerms(salesOrder.terms || "");
  }, [salesOrder]);

  // Reset transient GDC state when switching SO or conversion type so re-use is clean
  // (replaces the old open==false reset — form is now full-page, always "open").
  const soId = salesOrder.id;
  useEffect(() => {
    setAllowNegative(false);
    setShortfalls([]);
    setNegOpen(false);
    setPendingIssue(false);
    setPurpose("");
    setReturnable(false);
    setExpectedReturnDate("");
    setSerialIdx(null);
  }, [soId]);

  useEffect(() => {
    void loadWarehouses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryFailed,
    error: summaryErr,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["so-fulfillment", salesOrder.id],
    queryFn: () => fetchSoFulfillmentSummary(salesOrder.id),
    enabled: !!salesOrder?.id,
    retry: 2,
  });
  const noSummaryData = !summary;

  const preview = useMemo(() => {
    if (!summary) {
      return buildFulfillmentPreview(salesOrder, []);
    }
    return buildFulfillmentPreview(salesOrder, summary as any);
  }, [salesOrder, summary]);

  // FE-C2: Initialize lines once per SO — don't reset on every preview change
  // (which fires when salesOrder reference changes, clobbering user edits).
  // Also re-initialize once when summary transitions from undefined → loaded
  // (so we go from fallback empty preview to real fulfilled_before/balance data).
  const initializedForIdRef = useRef<string | null>(null);
  const gotRealSummaryRef = useRef(false);
  useEffect(() => {
    const hasRealSummary = !!summary;
    if (hasRealSummary && !gotRealSummaryRef.current) {
      // First time summary loaded — initialize with real data
      gotRealSummaryRef.current = true;
      initializedForIdRef.current = salesOrder.id;
      setLines(preview.map((l) => ({ ...l })));
    } else if (preview.length > 0 && initializedForIdRef.current !== salesOrder.id) {
      // Different SO opened — initialize
      initializedForIdRef.current = salesOrder.id;
      setLines(preview.map((l) => ({ ...l })));
    }
  }, [preview, salesOrder.id, summary]);
  // Reset init refs when SO changes so a fresh preview is built
  useEffect(() => {
    initializedForIdRef.current = null;
    gotRealSummaryRef.current = false;
  }, [salesOrder.id]);

  const stats = useMemo(() => orderedVsFulfilled(salesOrder, (summary as any) || []), [salesOrder, summary]);
  const needsStockForValidation = conversionType !== "proforma_invoice";
  const progressRaw = stats.ordered > 0 ? (stats.fulfilled / stats.ordered) * 100 : 0;
  const progressPct = Number.isFinite(progressRaw) ? Math.min(100, Math.round(progressRaw)) : 0;

  const validationError = useMemo(() => validateThisQty(lines, { requireWarehouse: needsStockForValidation }), [lines, needsStockForValidation]);

  const totals = useMemo(() => {
    const active = lines.filter((l) => Number(l.this_qty) > 0);
    if (active.length === 0) return null;
    const items = active.map((fl) => {
      const orig: any = salesOrder.items[fl.line_index] || {};
      return {
        qty: r3(Number(fl.this_qty) || 0),
        rate: Number(orig.rate) || 0,
        discount_pct: Number(orig.discount_pct) || 0,
        gst_rate: Number(orig.gst_rate) || 0,
        cess_rate: Number(orig.cess_rate) || 0,
      };
    });
    try {
      const sellerCode = (salesOrder as any).seller_state_code || null;
      const buyerCode = (salesOrder as any).buyer_state_code || null;
      return computeTotals({
        sellerStateCode: sellerCode,
        buyerStateCode: buyerCode,
        items,
        headerDiscount: Number((salesOrder as any).discount_amount) || 0,
        roundOff: true,
      });
    } catch {
      return null;
    }
  }, [lines, salesOrder]);

  const updateLine = (idx: number, patch: Partial<FulfillmentLine>) => {
    setLines((arr) => arr.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleQtyChange = (idx: number, raw: string) => {
    const n = raw === "" ? 0 : Math.round(Number(raw));
    if (Number.isNaN(n)) return;
    const line = lines[idx];
    const capped = Math.max(0, Math.min(n, Math.floor(Number(line.balance) || 0)));
    // serialized: qty locked to serials length — ignore manual edit if serialized
    if (line.is_serialized) return;
    updateLine(idx, { this_qty: capped });
  };

  const handleWarehouseChange = (idx: number, whId: string) => {
    updateLine(idx, { warehouse_id: whId || null, serial_numbers: [] });
  };

  const needsStock = conversionType !== "proforma_invoice";
  const isGdc = conversionType === "general_dc";
  const isCancelled = String((salesOrder as any).status || "").trim().toLowerCase() === "cancelled";

  // Single builder for stock-preflight lines — shared by the pre-submit check
  // and the post-failure shortfall dialog so reporting is always consistent.
  const buildStockLines = () =>
    lines
      .filter((l) => Number(l.this_qty) > 0 && l.product_id)
      .map((l) => {
        const orig: any = salesOrder.items[l.line_index] || {};
        const model = String(orig.part_model_no || orig.model_no || orig.part_name || l.product_id || "").trim();
        if (!model) return null;
        return {
          model,
          label: orig.description || orig.part_name || `Line ${l.line_index + 1}`,
          warehouseId: (l as any).warehouse_id ?? orig.warehouse_id ?? null,
          warehouseName: warehouses.find((w) => w.id === ((l as any).warehouse_id ?? orig.warehouse_id))?.name ?? null,
          qty: Number(l.this_qty) || 0,
        };
      })
      .filter(Boolean) as { model: string; label: string | null; warehouseId: string | null; warehouseName: string | null; qty: number }[];

  const doSubmit = async (issue: boolean, opts?: { allowNegativeOverride?: boolean }) => {
    // Effective flag: an explicit override wins. The negative-stock dialog
    // retry passes one so it never depends on setState having flushed
    // (the old setTimeout retry raced React's state batching).
    const effAllowNegative = opts?.allowNegativeOverride ?? allowNegative;
    if (isCancelled) {
      toast.error("SO cancelled — no conversions allowed");
      return;
    }
    // Admin-only negative stock guard: never allow non-admin to proceed with oversell
    if (!isAdmin && allowNegative) {
      setAllowNegative(false);
      toast.error("Allow negative stock requires admin privileges");
      return;
    }
    const err = validateThisQty(lines, { requireWarehouse: needsStock });
    if (err) {
      toast.error(err);
      return;
    }
    if (isGdc && returnable && !expectedReturnDate) {
      toast.error("Expected return date required for returnable GDC");
      return;
    }
    // Fully delivered guard for stock docs (proforma still allowed, capped at 0 by balance)
    const fullyDeliveredNow = stats.balance <= 0 && stats.ordered > 0;
    if (fullyDeliveredNow && needsStock) {
      toast.error("Sales Order is fully delivered — stock conversions are blocked. Create a new SO for additional quantity.");
      return;
    }
    // preflight stock for serialized + pooled if stock doc
    if (needsStock) {
      const stockLines = buildStockLines();

      if (stockLines.length > 0 && !effAllowNegative) {
        try {
          const short = await findShortfalls(stockLines);
          if (short.length > 0) {
            if (!isAdmin) {
              toast.error(blockMessage(short[0]));
              return;
            }
            setShortfalls(short);
            setPendingIssue(issue);
            setNegOpen(true);
            return;
          }
        } catch (e) {
          console.error("stock preflight failed", e);
        }
      }
    }

    setBusy(true);
    try {
      if (conversionType === "tax_invoice") {
        const r = await createTaxInvoiceFromSO(salesOrder.id, lines as any, { allow_negative_stock: effAllowNegative });
        // if issue requested, try to flip status to issued
        if (issue) {
          try {
            await supabase.from("invoices" as never).update({ status: "issued" } as never).eq("id", r.id);
          } catch {}
        }
        toast.success(`Invoice ${r.invoice_no || ""} created`);
        onSuccess?.({ type: "tax_invoice", id: r.id });
      } else if (conversionType === "general_dc") {
        const r = await createGeneralDcFromSO(salesOrder.id, lines as any, {
          allow_negative_stock: effAllowNegative,
          returnable,
          expected_return_date: returnable ? (expectedReturnDate || undefined) : undefined,
          purpose: purpose || null,
          issueImmediately: issue,
        } as any);
        toast.success(`General Challan ${r.dc_no || ""} ${issue ? "issued" : "saved"}`);
        onSuccess?.({ type: "general_dc", id: r.id });
      } else {
        const r = await createProformaFromSO(salesOrder.id, lines as any);
        if (issue) {
          try {
            await supabase.from("proforma_invoices" as never).update({ status: "issued" } as never).eq("id", r.id);
          } catch {}
        }
        toast.success(`Proforma ${r.proforma_no || ""} ${issue ? "issued" : "created"}`);
        onSuccess?.({ type: "proforma_invoice", id: r.id });
      }
    } catch (e: any) {
      const msg = e?.message || "Failed to create document";
      // if writer threw shortfall and admin, surface dialog
      if (msg.toLowerCase().includes("insufficient stock") || msg.toLowerCase().includes("available")) {
        if (isAdmin) {
          try {
            const stockLines = buildStockLines();
            if (stockLines.length === 0) {
              // No valid model to check — don't crash, just surface original error
            } else {
              const short = await findShortfalls(stockLines as any);
              if (short.length) {
                setShortfalls(short);
                setPendingIssue(issue);
                setNegOpen(true);
                setBusy(false);
                return;
              }
            }
          } catch {}
        }
      }
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const wName = (id: string | null) => warehouses.find((w) => w.id === id)?.name ?? "—";

  const totalBalance = stats.balance;
  const isFullyDelivered = totalBalance <= 0 && stats.ordered > 0;
  // Fulfillment never arrived (connection/server failure) — never allow a
  // submit on invented balances; the error panel above offers Retry.
  const dataBlocked = summaryFailed && noSummaryData;
  const submitBlocked =
    busy || !!validationError || summaryLoading || dataBlocked || isCancelled || (isFullyDelivered && needsStock);
  const submitTitle = isCancelled
    ? "SO cancelled — no conversions allowed"
    : dataBlocked
      ? "Fulfillment data failed to load — retry before submitting"
      : isFullyDelivered && needsStock
        ? "Fully delivered — stock conversions blocked"
        : undefined;

  // Tabs handler is typed to UI types only — legacy `delivery_challan`
  // defaultType values are normalized via toUiType() above.
  const handleTabChange = (v: string) => {
    if ((VALID_UI_TYPES as string[]).includes(v)) setConversionType(v as UiConversionType);
  };

  return (
    <div
      className={
        mode === "dialog"
          ? "flex flex-col gap-0 bg-background overflow-hidden"
          : "flex flex-col gap-0 rounded-lg border bg-background overflow-hidden"
      }
    >
      <div className="px-6 pt-6 pb-3 border-b shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            Convert Sales Order
            <span className="font-mono text-sm text-muted-foreground">{salesOrder.so_no || salesOrder.id.slice(0, 8)}</span>
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          PO {salesOrder.po_number || "—"} {salesOrder.po_date ? `· ${salesOrder.po_date}` : ""} · Customer {salesOrder.buyer_name || "—"} · Branch {salesOrder.branch_id ? salesOrder.branch_id.slice(0, 6) : "—"} — All fields editable · Qty capped at balance
        </p>
      </div>

          <div className="px-6 pb-3 border-b shrink-0">
            <Tabs value={conversionType} onValueChange={handleTabChange}>
              <TabsList className="h-8 w-full justify-start gap-1 p-1">
                {(Object.keys(TYPE_META) as UiConversionType[]).map((k) => (
                  <TabsTrigger key={k} value={k} className="text-xs gap-1.5 h-6 px-2.5">
                    {TYPE_META[k].icon}
                    {TYPE_META[k].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {/* Cancelled / fully-delivered banners */}
            {String((salesOrder as any).status || "").trim().toLowerCase() === "cancelled" && (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                <X className="h-3.5 w-3.5 shrink-0" /> SO cancelled — no conversions allowed
              </div>
            )}
            {isFullyDelivered && String((salesOrder as any).status || "").trim().toLowerCase() !== "cancelled" && (
              <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${needsStock ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
                {needsStock ? (
                  <span className="font-medium">Fully delivered — stock conversions blocked. Create a new SO for additional quantity. Proforma still allowed (capped at 0).</span>
                ) : (
                  <span className="font-medium">Fully delivered — proforma still allowed but quantities are capped at balance (0).</span>
                )}
              </div>
            )}

            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="font-mono">Ordered {Math.floor(Number(stats.ordered) || 0)}</Badge>
                <span className="text-muted-foreground">Already delivered {Math.floor(Number(stats.fulfilled) || 0)}</span>
                <Badge variant={isFullyDelivered ? "default" : "secondary"} className={isFullyDelivered ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-800"}>
                  Balance {Math.floor(Number(stats.balance) || 0)}
                </Badge>
                <span className="text-muted-foreground">Proforma {Math.floor(Number(stats.fulfilledProforma) || 0)}</span>
                {isFullyDelivered && <span className="text-amber-600 font-medium">· Fully delivered</span>}
              </div>
              <Progress value={Number.isFinite(progressPct) ? progressPct : 0} className="h-1.5" />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{Number.isFinite(progressPct) ? progressPct : 0}% fulfilled</span>
                <span className="tabular-nums">{Math.floor(Number(stats.fulfilled) || 0)}/{Math.floor(Number(stats.ordered) || 0)}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 px-6 py-4 space-y-4 overflow-y-auto">
            {/* Editable header fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">PO No</Label>
                <Input className="h-8 text-sm" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-..." />
              </div>
              <div>
                <Label className="text-xs">PO Date</Label>
                <Input className="h-8 text-sm" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Notes</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery notes…" className="text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Terms</Label>
                <Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Payment terms…" className="text-sm" />
              </div>
            </div>

            {isGdc && (
              <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs flex items-center gap-2">Returnable <Switch checked={returnable} onCheckedChange={setReturnable} /></Label>
                  {returnable && (
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Expected Return</Label>
                      <Input type="date" className="h-7 text-xs w-36" value={expectedReturnDate} onChange={(e) => setExpectedReturnDate(e.target.value)} />
                    </div>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Purpose</Label>
                  <Input className="h-8 text-sm" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Demo at customer site" />
                </div>
              </div>
            )}

            {whError && warehouses.length === 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="flex-1">Warehouses failed to load — stock conversions need one. {whError}</span>
                <Button type="button" size="sm" variant="outline" className="h-7 text-xs border-rose-300" onClick={() => void loadWarehouses()}>
                  Retry
                </Button>
              </div>
            )}

            {summaryLoading ? (
              <div className="space-y-3 py-4" aria-busy="true" aria-label="Loading fulfillment">
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading fulfillment…</div>
                <div className="space-y-2">
                  {[0, 1, 2].map((k) => (
                    <div key={k} className="h-12 animate-pulse rounded-md border bg-muted/40" />
                  ))}
                </div>
              </div>
            ) : summaryFailed && noSummaryData ? (
              <div className="flex flex-col gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Couldn't load fulfillment data — nothing was submitted.
                </div>
                <div className="text-xs opacity-90">
                  {(summaryErr as Error)?.message || "Check your connection to the server, then retry."}
                </div>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-rose-300"
                    onClick={() => void refetchSummary()}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/70 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left w-8">#</th>
                        <th className="px-2 py-2 text-left min-w-[180px]">Description</th>
                        <th className="px-2 py-2 text-right">Ordered</th>
                        <th className="px-2 py-2 text-right">Already</th>
                        <th className="px-2 py-2 text-right">Balance</th>
                        <th className="px-2 py-2 text-right w-28">This Shipment*</th>
                        <th className="px-2 py-2 text-left w-32">Warehouse*</th>
                        <th className="px-2 py-2 text-right">Rate</th>
                        <th className="px-2 py-2 text-right">GST%</th>
                        <th className="px-2 py-2 text-right w-24">Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((ln, idx) => {
                        const orig: any = salesOrder.items[ln.line_index] || {};
                        const lineTotal = (Number(ln.this_qty) || 0) * (Number(orig.rate) || 0);
                        const isZeroBalance = (Number(ln.balance) || 0) <= 0;
                        return (
                          <tr key={idx} className={`border-t ${isZeroBalance ? "bg-muted/20" : "hover:bg-muted/20"}`}>
                            <td className="px-2 py-2 text-xs text-muted-foreground">{idx + 1}</td>
                            <td className="px-2 py-2">
                              <div className="font-medium text-sm leading-tight">{orig.description || "—"}</div>
                              <div className="font-mono text-[11px] text-muted-foreground">{orig.hsn || "—"}</div>
                              <div className="text-[11px] text-muted-foreground tabular-nums">Ordered {Math.floor(Number(ln.ordered_qty) || 0)} · Already {Math.floor(Number(ln.fulfilled_before) || 0)} · Balance {Math.floor(Number(ln.balance) || 0)}</div>
                              {ln.is_serialized && (
                                <div className="mt-1 flex items-center gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={ln.serial_numbers && ln.serial_numbers.length === Math.floor(Number(ln.this_qty)) ? "outline" : "secondary"}
                                    className="h-6 text-[11px] px-2"
                                    disabled={!ln.warehouse_id || Number(ln.balance) <= 0}
                                    onClick={() => setSerialIdx(idx)}
                                  >
                                    Serials: {(ln.serial_numbers || []).length}/{Math.floor(Number(ln.this_qty)) || 0}
                                  </Button>
                                  {(ln.serial_numbers || []).length > 0 && (
                                    <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[140px]">{(ln.serial_numbers || []).join(", ")}</span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-xs">{Math.floor(Number(ln.ordered_qty) || 0)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-xs bg-muted/30">{Math.floor(Number(ln.fulfilled_before) || 0)}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-xs font-medium bg-amber-50">{Math.floor(Number(ln.balance) || 0)}</td>
                            <td className="px-2 py-2">
                              <Input
                                type="number"
                                step="1"
                                min={0}
                                max={Math.floor(Number(ln.balance) || 0)}
                                className="h-7 text-xs text-right tabular-nums"
                                value={ln.this_qty}
                                onChange={(e) => handleQtyChange(idx, e.target.value)}
                                onKeyDown={(e) => {
                                  // Prevent decimal typing — integer only; also block e/E/+/- for robustness
                                  if (e.key === "." || e.key === "," || e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault();
                                }}
                                onPaste={(e) => {
                                  const txt = e.clipboardData.getData("text");
                                  if (txt.includes(".") || txt.includes(",")) e.preventDefault();
                                }}
                                disabled={ln.is_serialized || isZeroBalance}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <select
                                className="w-full h-7 rounded-md border bg-background px-1.5 text-xs"
                                value={(ln as any).warehouse_id || ""}
                                onChange={(e) => handleWarehouseChange(idx, e.target.value)}
                              >
                                <option value="">— select —</option>
                                {warehouses.map((w) => (
                                  <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-xs">{inr(Number(orig.rate) || 0)}</td>
                            <td className="px-2 py-2 text-right text-xs">{orig.gst_rate ?? 0}%</td>
                            <td className="px-2 py-2 text-right tabular-nums text-xs font-medium">{inr(lineTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {totals && (
                      <tfoot className="bg-muted/40 border-t-2 font-medium text-xs">
                        <tr>
                          <td colSpan={9} className="px-2 py-2 text-right text-muted-foreground">Subtotal</td>
                          <td className="px-2 py-2 text-right tabular-nums">{inr(totals.subtotal)}</td>
                        </tr>
                        {totals.cgst > 0 && (
                          <tr>
                            <td colSpan={9} className="px-2 py-1 text-right text-muted-foreground">CGST</td>
                            <td className="px-2 py-1 text-right tabular-nums">{inr(totals.cgst)}</td>
                          </tr>
                        )}
                        {totals.sgst > 0 && (
                          <tr>
                            <td colSpan={9} className="px-2 py-1 text-right text-muted-foreground">SGST</td>
                            <td className="px-2 py-1 text-right tabular-nums">{inr(totals.sgst)}</td>
                          </tr>
                        )}
                        {totals.igst > 0 && (
                          <tr>
                            <td colSpan={9} className="px-2 py-1 text-right text-muted-foreground">IGST</td>
                            <td className="px-2 py-1 text-right tabular-nums">{inr(totals.igst)}</td>
                          </tr>
                        )}
                        {totals.round_off !== 0 && (
                          <tr>
                            <td colSpan={9} className="px-2 py-1 text-right text-muted-foreground">Round Off</td>
                            <td className="px-2 py-1 text-right tabular-nums">{inr(totals.round_off)}</td>
                          </tr>
                        )}
                        <tr className="font-bold">
                          <td colSpan={9} className="px-2 py-2 text-right">Total</td>
                          <td className="px-2 py-2 text-right tabular-nums">{inr(totals.total)}</td>
                        </tr>
                        {totals.total > 0 && (
                          <tr>
                            <td colSpan={10} className="px-2 py-1 text-[11px] italic text-muted-foreground text-left">{amountInWords(totals.total)}</td>
                          </tr>
                        )}
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}

            {validationError && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{validationError}</span>
              </div>
            )}

            {needsStock && (
              <div className="flex items-center gap-2 text-xs">
                <Checkbox
                  id="allowNeg"
                  checked={allowNegative}
                  onCheckedChange={(v) => {
                    if (!isAdmin && !!v) {
                      toast.error("Allow negative stock requires admin privileges");
                      return;
                    }
                    setAllowNegative(!!v);
                  }}
                  disabled={!isAdmin}
                />
                <Label htmlFor="allowNeg" className={`text-xs ${!isAdmin ? "text-muted-foreground" : ""}`}>
                  Allow negative stock (admin only)
                </Label>
                {!isAdmin && <span className="text-[11px] text-muted-foreground">Admin required for oversell</span>}
              </div>
            )}

            <Separator />
            <p className="text-[11px] text-muted-foreground">This Shipment defaults to Balance — lower it for partial delivery. Warehouse required for stock documents. Serial qty locked to selected serials.</p>
          </div>

          <div className="sticky bottom-0 bg-background border-t px-6 py-3 flex items-center justify-end gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => onCancel?.()} disabled={busy}>Cancel</Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => doSubmit(false)}
              disabled={submitBlocked}
              title={submitTitle}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create Draft
            </Button>
            <Button
              size="sm"
              onClick={() => doSubmit(true)}
              disabled={submitBlocked}
              title={submitTitle}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create &amp; Issue
            </Button>
          </div>

      {serialIdx !== null && lines[serialIdx] && (
        <SerialMultiPicker
          open={serialIdx !== null}
          onOpenChange={(v) => !v && setSerialIdx(null)}
          qty={Math.floor(Number(lines[serialIdx].this_qty)) || 0}
          warehouseId={(lines[serialIdx] as any).warehouse_id}
          partModelNo={(salesOrder.items[lines[serialIdx].line_index] as any)?.part_model_no || null}
          partName={(salesOrder.items[lines[serialIdx].line_index] as any)?.part_name || (salesOrder.items[lines[serialIdx].line_index] as any)?.description || null}
          value={(lines[serialIdx] as any).serial_numbers || []}
          excludeSerials={lines.flatMap((l, i) => (i === serialIdx ? [] : (l as any).serial_numbers || []))}
          onConfirm={(sns) => {
            updateLine(serialIdx, { serial_numbers: sns, this_qty: sns.length } as any);
          }}
        />
      )}

      <NegativeStockDialog
        open={negOpen}
        onOpenChange={setNegOpen}
        shortfalls={shortfalls}
        onProceed={async (reason) => {
          void reason;
          setNegOpen(false);
          setAllowNegative(true);
          // Pass the flag explicitly — no setTimeout, no dependence on
          // setState flush timing (see doSubmit effAllowNegative).
          void doSubmit(pendingIssue, { allowNegativeOverride: true });
        }}
      />
    </div>
  );
}

/** Back-compat Dialog wrapper — kept so any lingering `open` callers don't break.
 *  New code should use {@link SoConversionForm} inside the full-page convert route
 *  (`/sales/orders/$id/convert`) instead of this modal. */
export function SoConversionSheet({ open, onOpenChange, salesOrder, defaultType, onSuccess }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 overflow-hidden flex flex-col gap-0">
        <SoConversionForm
          salesOrder={salesOrder}
          defaultType={defaultType}
          onSuccess={(t) => {
            onSuccess?.(t);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
          mode="dialog"
        />
      </DialogContent>
    </Dialog>
  );
}
