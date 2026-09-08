import { useEffect, useMemo, useState } from "react";
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
  createDeliveryChallanFromSO,
} from "@/lib/documentFlow.writers";
import { computeTotals, amountInWords } from "@/lib/gst";
import { inr } from "@/lib/sales";
import { useIsAdmin } from "@/lib/useRole";
import { findShortfalls, blockMessage, type Shortfall } from "@/lib/negativeStock";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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
import { AlertTriangle, Loader2, Package, FileText, Truck, Receipt } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  salesOrder: SalesOrder;
  defaultType?: ConversionType;
  onSuccess?: (target: { type: string; id: string }) => void;
};

const TYPE_META: Record<ConversionType, { label: string; short: string; icon: React.ReactNode }> = {
  tax_invoice: { label: "Tax Invoice", short: "Tax Invoice", icon: <Receipt className="h-3.5 w-3.5" /> },
  general_dc: { label: "General DC", short: "General DC", icon: <Truck className="h-3.5 w-3.5" /> },
  proforma_invoice: { label: "Proforma", short: "Proforma", icon: <FileText className="h-3.5 w-3.5" /> },
  delivery_challan: { label: "Delivery Challan", short: "DC", icon: <Package className="h-3.5 w-3.5" /> },
};

export function SoConversionSheet({ open, onOpenChange, salesOrder, defaultType, onSuccess }: Props) {
  const { isAdmin } = useIsAdmin();
  const [conversionType, setConversionType] = useState<ConversionType>(defaultType || "tax_invoice");
  const [lines, setLines] = useState<FulfillmentLine[]>([]);
  const [poNumber, setPoNumber] = useState(salesOrder.po_number || "");
  const [poDate, setPoDate] = useState(salesOrder.po_date || "");
  const [notes, setNotes] = useState(salesOrder.notes || "");
  const [terms, setTerms] = useState(salesOrder.terms || "");
  const [purpose, setPurpose] = useState("");
  const [returnable, setReturnable] = useState(false);
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [allowNegative, setAllowNegative] = useState(false);
  const [serialIdx, setSerialIdx] = useState<number | null>(null);
  const [shortfalls, setShortfalls] = useState<Shortfall[]>([]);
  const [negOpen, setNegOpen] = useState(false);
  const [pendingIssue, setPendingIssue] = useState(false);

  useEffect(() => {
    if (defaultType) setConversionType(defaultType);
  }, [defaultType, open]);

  useEffect(() => {
    setPoNumber(salesOrder.po_number || "");
    setPoDate(salesOrder.po_date || "");
    setNotes(salesOrder.notes || "");
    setTerms(salesOrder.terms || "");
  }, [salesOrder, open]);

  // B8: reset transient state when sheet closes so re-open is clean
  useEffect(() => {
    if (!open) {
      setAllowNegative(false);
      setShortfalls([]);
      setNegOpen(false);
      setPendingIssue(false);
      setPurpose("");
      setReturnable(false);
      setExpectedReturnDate("");
      setSerialIdx(null);
    }
  }, [open]);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("warehouses")
          .select("id,name")
          .eq("status", "Active")
          .order("name");
        if (error) {
          toast.error(error.message || "Could not load warehouses");
          return;
        }
        setWarehouses((data ?? []) as { id: string; name: string }[]);
      } catch (e: unknown) {
        toast.error((e as Error).message || "Could not load warehouses");
      }
    })();
  }, []);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["so-fulfillment", salesOrder.id],
    queryFn: () => fetchSoFulfillmentSummary(salesOrder.id),
    enabled: open,
  });

  const preview = useMemo(() => {
    if (!summary) {
      return buildFulfillmentPreview(salesOrder, []);
    }
    return buildFulfillmentPreview(salesOrder, summary as any);
  }, [salesOrder, summary]);

  useEffect(() => {
    if (!open) return;
    if (preview.length) setLines(preview.map((l) => ({ ...l })));
  }, [preview, open]);

  const stats = useMemo(() => orderedVsFulfilled(salesOrder, (summary as any) || []), [salesOrder, summary]);
  const progressPct = stats.ordered > 0 ? Math.min(100, Math.round((stats.fulfilled / stats.ordered) * 100)) : 0;

  const validationError = useMemo(() => validateThisQty(lines), [lines]);

  const totals = useMemo(() => {
    const active = lines.filter((l) => Number(l.this_qty) > 0);
    if (active.length === 0) return null;
    const items = active.map((fl) => {
      const orig: any = salesOrder.items[fl.line_index] || {};
      return {
        qty: Number(fl.this_qty) || 0,
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
    const n = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(n)) return;
    const line = lines[idx];
    const capped = Math.max(0, Math.min(n, Number(line.balance) || 0));
    // serialized: qty locked to serials length — ignore manual edit if serialized
    if (line.is_serialized) return;
    updateLine(idx, { this_qty: capped });
  };

  const handleWarehouseChange = (idx: number, whId: string) => {
    updateLine(idx, { warehouse_id: whId || null, serial_numbers: [] });
  };

  const needsStock = conversionType !== "proforma_invoice";
  const isGdc = conversionType === "general_dc";

  const doSubmit = async (issue: boolean) => {
    const err = validateThisQty(lines);
    if (err) {
      toast.error(err);
      return;
    }
    if (isGdc && returnable && !expectedReturnDate) {
      toast.error("Expected return date required for returnable GDC");
      return;
    }
    // preflight stock for serialized + pooled if stock doc
    if (needsStock) {
      const stockLines = lines
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

      if (stockLines.length > 0 && !allowNegative) {
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
        const r = await createTaxInvoiceFromSO(salesOrder.id, lines as any, { allow_negative_stock: allowNegative });
        // if issue requested, try to flip status to issued
        if (issue) {
          try {
            await supabase.from("invoices" as never).update({ status: "issued" } as never).eq("id", r.id);
          } catch {}
        }
        toast.success(`Invoice ${r.invoice_no || ""} created`);
        onSuccess?.({ type: "tax_invoice", id: r.id });
        onOpenChange(false);
      } else if (conversionType === "general_dc") {
        const r = await createGeneralDcFromSO(salesOrder.id, lines as any, {
          allow_negative_stock: allowNegative,
          returnable,
          expected_return_date: returnable ? (expectedReturnDate || undefined) : undefined,
          purpose: purpose || null,
          issueImmediately: issue,
        } as any);
        toast.success(`General DC ${r.dc_no || ""} ${issue ? "issued" : "saved"}`);
        onSuccess?.({ type: "general_dc", id: r.id });
        onOpenChange(false);
      } else if (conversionType === "proforma_invoice") {
        const r = await createProformaFromSO(salesOrder.id, lines as any);
        if (issue) {
          try {
            await supabase.from("proforma_invoices" as never).update({ status: "issued" } as never).eq("id", r.id);
          } catch {}
        }
        toast.success(`Proforma ${r.proforma_no || ""} ${issue ? "issued" : "created"}`);
        onSuccess?.({ type: "proforma_invoice", id: r.id });
        onOpenChange(false);
      } else {
        const r = await createDeliveryChallanFromSO(salesOrder.id, lines as any);
        toast.success(`Delivery Challan ${r.challan_no || ""} created`);
        onSuccess?.({ type: "delivery_challan", id: r.id });
        onOpenChange(false);
      }
    } catch (e: any) {
      const msg = e?.message || "Failed to create document";
      // if writer threw shortfall and admin, surface dialog
      if (msg.toLowerCase().includes("insufficient stock") || msg.toLowerCase().includes("available")) {
        if (isAdmin) {
          try {
            const stockLines = lines
              .filter((l) => Number(l.this_qty) > 0)
              .map((l) => {
                const orig: any = salesOrder.items[l.line_index] || {};
                return {
                  model: String(orig.part_model_no || orig.model_no || orig.part_name || "").trim(),
                  label: orig.description || `Line ${l.line_index + 1}`,
                  warehouseId: (l as any).warehouse_id ?? null,
                  warehouseName: null,
                  qty: Number(l.this_qty) || 0,
                };
              })
              .filter((x) => x.model);
            const short = await findShortfalls(stockLines as any);
            if (short.length) {
              setShortfalls(short);
              setPendingIssue(issue);
              setNegOpen(true);
              setBusy(false);
              return;
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

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[640px] sm:max-w-[640px] overflow-y-auto p-0 flex flex-col">
          <div className="sticky top-0 z-10 bg-background border-b">
            <SheetHeader className="px-6 pt-6 pb-3 text-left">
              <SheetTitle className="text-base font-semibold flex items-center gap-2">
                Convert Sales Order
                <span className="font-mono text-sm text-muted-foreground">{salesOrder.so_no || salesOrder.id.slice(0, 8)}</span>
              </SheetTitle>
              <SheetDescription className="text-xs">
                PO {salesOrder.po_number || "—"} {salesOrder.po_date ? `· ${salesOrder.po_date}` : ""} · Customer {salesOrder.buyer_name || "—"} · Branch {salesOrder.branch_id ? salesOrder.branch_id.slice(0, 6) : "—"} — All fields editable · qty capped at balance
              </SheetDescription>
            </SheetHeader>

            <div className="px-6 pb-3">
              <Tabs value={conversionType} onValueChange={(v) => setConversionType(v as ConversionType)}>
                <TabsList className="h-8 w-full justify-start gap-1 p-1">
                  {(Object.keys(TYPE_META) as ConversionType[]).map((k) => (
                    <TabsTrigger key={k} value={k} className="text-xs gap-1.5 h-6 px-2.5">
                      {TYPE_META[k].icon}
                      {TYPE_META[k].label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>

            <div className="px-6 pb-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="font-mono">Ordered {stats.ordered}</Badge>
                <span className="text-muted-foreground">Already delivered {stats.fulfilled}</span>
                <Badge variant={isFullyDelivered ? "default" : "secondary"} className={isFullyDelivered ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-800"}>
                  Balance {stats.balance}
                </Badge>
                <span className="text-muted-foreground">Proforma {stats.fulfilledProforma}</span>
                {isFullyDelivered && <span className="text-amber-600 font-medium">· Fully delivered</span>}
              </div>
              <Progress value={progressPct} className="h-1.5" />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{progressPct}% fulfilled</span>
                <span className="tabular-nums">{stats.fulfilled}/{stats.ordered}</span>
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

            {summaryLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading fulfillment…
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
                              <div className="text-[11px] text-muted-foreground tabular-nums">Ordered {ln.ordered_qty} · Already {ln.fulfilled_before} · Balance {ln.balance}</div>
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
                            <td className="px-2 py-2 text-right tabular-nums text-xs">{ln.ordered_qty}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-xs bg-muted/30">{ln.fulfilled_before}</td>
                            <td className="px-2 py-2 text-right tabular-nums text-xs font-medium bg-amber-50">{ln.balance}</td>
                            <td className="px-2 py-2">
                              <Input
                                type="number"
                                step="0.001"
                                min={0}
                                max={ln.balance}
                                className="h-7 text-xs text-right tabular-nums"
                                value={ln.this_qty}
                                onChange={(e) => handleQtyChange(idx, e.target.value)}
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
                <Checkbox id="allowNeg" checked={allowNegative} onCheckedChange={(v) => setAllowNegative(!!v)} disabled={!isAdmin} />
                <Label htmlFor="allowNeg" className={`text-xs ${!isAdmin ? "text-muted-foreground" : ""}`}>
                  Allow negative stock (admin only)
                </Label>
                {!isAdmin && allowNegative && <span className="text-[11px] text-amber-600">Admin required</span>}
              </div>
            )}

            <Separator />
            <p className="text-[11px] text-muted-foreground">This Shipment defaults to Balance — lower it for partial delivery. Warehouse required for stock documents. Serial qty locked to selected serials.</p>
          </div>

          <div className="sticky bottom-0 bg-background border-t px-6 py-3 flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button variant="secondary" size="sm" onClick={() => doSubmit(false)} disabled={busy || !!validationError || summaryLoading}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create Draft
            </Button>
            <Button size="sm" onClick={() => doSubmit(true)} disabled={busy || !!validationError || summaryLoading || isFullyDelivered}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {conversionType === "proforma_invoice" ? "Create & Issue" : "Create & Issue"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

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
          setNegOpen(false);
          setAllowNegative(true);
          // retry with allowNegative true
          setTimeout(() => doSubmit(pendingIssue), 100);
        }}
      />
    </>
  );
}
