import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageLoader } from "@/components/shared/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, ArrowRightLeft, ChevronDown, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchSalesOrder,
  fetchSoFulfillmentSummary,
  fetchSoConversions,
  SO_STATUSES,
  soStatusMeta,
  soDerivedStatus,
  isSoCancellable,
  type SalesOrder,
  type SoStatus,
  type SoConversionRow,
  type SoFulfillmentSummary,
} from "@/lib/salesOrders";
import { getReverseEffect } from "@/lib/documentFlow";
import { inr } from "@/lib/sales";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { getDocumentHeader } from "@/lib/letterhead";
import type { CompanyProfile } from "@/lib/companyProfile";
import { useConfirm } from "@/hooks/useConfirm";

export const Route = createFileRoute("/_app/sales/orders/$id")({ component: SalesOrderDetail });

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return String(d);
  }
}

function sumQty(arr: unknown): number {
  if (!Array.isArray(arr)) return 0;
  return Math.round(arr.reduce((s: number, x: any) => s + (Number(x?.this_qty ?? x?.qty ?? 0) || 0), 0));
}

function convTypeMeta(t: string) {
  switch (t) {
    case "tax_invoice":
      return { label: "Tax Invoice", tone: "primary" as const, short: "Tax" };
    case "general_dc":
      return { label: "General Challan", tone: "info" as const, short: "General Challan" };
    case "proforma_invoice":
      return { label: "Proforma", tone: "neutral" as const, short: "Proforma" };
    // Legacy: old SO conversions created as `delivery_challan` (now removed from
    // creation UI) still render in the timeline — keep the label so history doesn't break.
    case "delivery_challan":
      return { label: "Delivery Challan (legacy)", tone: "warning" as const, short: "DC" };
    default:
      return { label: t, tone: "neutral" as const, short: t };
  }
}

function convTargetLink(c: SoConversionRow): { to: string; params?: any; label: string } | null {
  if (!c.target_id) return null;
  if (c.target_table === "invoices") return { to: "/sales/invoices/$id", params: { id: c.target_id }, label: c.target_no || c.target_id.slice(0, 8) };
  if (c.target_table === "general_delivery_challans") return { to: "/sales/general-dc/$id", params: { id: c.target_id }, label: c.target_no || c.target_id.slice(0, 8) };
  if (c.target_table === "proforma_invoices") return { to: "/sales/proforma/$id", params: { id: c.target_id }, label: c.target_no || c.target_id.slice(0, 8) };
  if (c.target_table === "delivery_challans") return { to: "/challan/$id", params: { id: c.target_id }, label: c.target_no || c.target_id.slice(0, 8) };
  return null;
}

function SalesOrderDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [so, setSo] = useState<SalesOrder | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);

  const loadSo = () =>
    fetchSalesOrder(id)
      .then(setSo)
      .catch((e) => toast.error(e.message));
  useEffect(() => {
    loadSo();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    getDocumentHeader()
      .then(setCompany)
      .catch(() => {});
  }, []);

  const summaryQuery = useQuery({
    queryKey: ["so-fulfillment", id],
    queryFn: () => fetchSoFulfillmentSummary(id),
    enabled: !!id,
    staleTime: 15_000,
  });
  const conversionsQuery = useQuery({
    queryKey: ["so-conversions", id],
    queryFn: () => fetchSoConversions(id),
    enabled: !!id,
    staleTime: 15_000,
  });

  const summary: SoFulfillmentSummary[] = (summaryQuery.data ?? []) as SoFulfillmentSummary[];
  const conversions: SoConversionRow[] = (conversionsQuery.data ?? []) as SoConversionRow[];

  // Derived stats — matches orderedVsFulfilled in documentFlow but computed from summary + so.items fallback
  const orderedTotal = useMemo(() => {
    if (summary.length > 0) return summary.reduce((s, r) => s + (Number(r.ordered_qty) || 0), 0);
    if (!so || !Array.isArray(so.items)) return 0;
    return so.items.reduce((s, i) => s + (Number((i as any)?.qty) || 0), 0);
  }, [so, summary]);
  const fulfilledTotal = useMemo(() => Math.round(summary.reduce((s, r) => s + (Number(r.fulfilled_stock) || 0), 0)), [summary]);
  const fulfilledProforma = useMemo(() => Math.round(summary.reduce((s, r) => s + (Number((r as any).fulfilled_proforma) || 0), 0)), [summary]);
  // B13: use summary.reduce balance when summary non-empty (consistent with orderedVsFulfilled helper)
  const balanceTotal = useMemo(() => {
    if (summary.length > 0) return Math.round(summary.reduce((s, r) => s + (Number((r as any).balance) || 0), 0));
    const raw = orderedTotal - fulfilledTotal;
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }, [summary, orderedTotal, fulfilledTotal]);
  const isFullyDelivered = orderedTotal > 0 && balanceTotal <= 0;
  const progressRaw = orderedTotal > 0 ? (fulfilledTotal / orderedTotal) * 100 : 0;
  const progressPct = Number.isFinite(progressRaw) ? Math.min(100, Math.round(progressRaw)) : 0;

  // Derived status for display (does not mutate DB); falls back to stored status
  const derivedStatus: SoStatus = useMemo(() => {
    if (!so) return "draft";
    try {
      return soDerivedStatus(summary, so.status as SoStatus, conversions as any);
    } catch {
      return so.status as SoStatus;
    }
  }, [so, summary, conversions]);

  // Keep conversions in sync when cancelled externally: refetch on focus + every 30s poll
  useEffect(() => {
    const onFocus = () => {
      qc.invalidateQueries({ queryKey: ["so-fulfillment", id] });
      qc.invalidateQueries({ queryKey: ["so-conversions", id] });
    };
    window.addEventListener("focus", onFocus);
    const iv = window.setInterval(onFocus, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(iv);
    };
  }, [id, qc]);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const row of conversions) c[row.conversion_type] = (c[row.conversion_type] || 0) + 1;
    return c;
  }, [conversions]);

  // map line_index -> summary row for items table
  const summaryByLine = useMemo(() => {
    const m = new Map<number, SoFulfillmentSummary>();
    for (const r of summary) m.set(Number(r.line_index), r);
    return m;
  }, [summary]);

  if (!so) return <PageLoader />;

  const stStored = soStatusMeta(so.status);
  const stDerived = soStatusMeta(derivedStatus);
  // Prefer derived badge tone when fulfillment data exists; keep distinct cancelled styling
  const st = summary.length > 0 ? stDerived : stStored;
  const isCancelled = String(so.status || "").trim().toLowerCase() === "cancelled";

  const setStatus = async (s: SoStatus) => {
    if (s === "invoiced" && so.status !== "invoiced") {
      toast.error("Use 'Convert to Invoice' to set invoiced status");
      return;
    }
    if (s === "cancelled" && so.status !== "cancelled") {
      const guard = isSoCancellable(so as any, summary as any, conversions as any);
      if (!guard.allowed) {
        toast.error(guard.reason);
        return;
      }
      const stockFulfilled = fulfilledTotal;
      const ok = await confirm({
        title: "Cancel Sales Order?",
        description: stockFulfilled > 0
          ? `This SO has ${stockFulfilled} fulfilled unit(s) — cancel downstream documents first or they will remain. Proceed to cancel SO?`
          : "This will mark the Sales Order as cancelled and block further conversions. Continue?",
        confirmLabel: "Cancel SO",
        variant: "danger",
      });
      if (!ok) return;
    }
    const { error } = await supabase
      .from("sales_orders" as never)
      .update({ status: s } as never)
      .eq("id", id);
    if (error) return toast.error(error.message);
    setSo({ ...so, status: s });
    toast.success("Status updated");
    qc.invalidateQueries({ queryKey: ["so-fulfillment", id] });
    qc.invalidateQueries({ queryKey: ["so-conversions", id] });
  };

  const handleCancelSO = async () => {
    const guard = isSoCancellable(so as any, summary as any, conversions as any);
    if (!guard.allowed) {
      toast.error(guard.reason);
      return;
    }
    const ok = await confirm({
      title: "Cancel Sales Order?",
      description: fulfilledTotal > 0
        ? `This SO has ${fulfilledTotal} fulfilled unit(s) — cancel downstream docs first. Cancel SO anyway?`
        : "Cancel this Sales Order? No further conversions will be allowed.",
      confirmLabel: "Cancel SO",
      variant: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("sales_orders" as never).update({ status: "cancelled" } as never).eq("id", id);
    if (error) return toast.error(error.message);
    setSo({ ...so, status: "cancelled" as SoStatus });
    toast.success("Sales Order cancelled");
    qc.invalidateQueries({ queryKey: ["so-fulfillment", id] });
    qc.invalidateQueries({ queryKey: ["so-conversions", id] });
  };

  // Conversion now opens as a full-window page (/sales/orders/$id/convert?type=…)
  // instead of the old modal/side-panel sheet. Success navigation lives in the
  // convert route — detail page just refreshes its ledger when revisited.
  const goConvert = (t: "tax_invoice" | "general_dc" | "proforma_invoice") => {
    if (isCancelled) return;
    nav({ to: "/sales/orders/$id/convert", params: { id }, search: { type: t } });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link to="/sales/orders">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div className="flex gap-2 flex-wrap items-center">
          <StatusBadge tone={st.badgeTone}>{st.label}</StatusBadge>
          {derivedStatus !== so.status && !isCancelled && (
            <span className="text-[11px] text-muted-foreground">(stored: {stStored.label})</span>
          )}
          <Select value={so.status} onValueChange={(v) => setStatus(v as SoStatus)}>
            <SelectTrigger className="w-40 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SO_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isCancelled && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs border-rose-200 text-rose-700 hover:bg-rose-50"
              onClick={handleCancelSO}
            >
              Cancel SO
            </Button>
          )}
          {so.linked_quote_id && (
            <Link to="/crm/quotations/$id" params={{ id: so.linked_quote_id }}>
              <Button variant="outline" size="sm">
                <FileText className="h-4 w-4 mr-1" />
                Source Quote
              </Button>
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                disabled={isCancelled || isFullyDelivered}
                title={isCancelled ? "SO cancelled — no conversions allowed" : isFullyDelivered ? "Fully delivered — create new SO for additional qty." : "Convert"}
              >
                <ArrowRightLeft className="mr-2 h-4 w-4" /> Convert <ChevronDown className="ml-2 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                disabled={isCancelled}
                onClick={() => goConvert("tax_invoice")}
              >
                Tax Invoice (stock)
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isCancelled}
                onClick={() => goConvert("general_dc")}
              >
                General Challan (stock)
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isCancelled}
                onClick={() => goConvert("proforma_invoice")}
              >
                Proforma Invoice (no stock)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base font-mono">{so.so_no || "(unsaved)"}</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Seller</div>
            <div className="font-medium">{company?.name || "…"}</div>
            <div className="text-muted-foreground whitespace-pre-line">
              {company?.regd_address || ""}
            </div>
            {company?.gstin && <div className="font-mono text-xs mt-1">GSTIN: {company.gstin}</div>}
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Buyer</div>
            <div className="font-medium">{so.buyer_name || "—"}</div>
            <div className="text-muted-foreground whitespace-pre-line">{so.billing_address}</div>
            {so.buyer_gstin && (
              <div className="font-mono text-xs mt-1">GSTIN: {so.buyer_gstin}</div>
            )}
            {so.place_of_supply && (
              <div className="text-xs mt-1">
                Place of Supply: {so.place_of_supply}
                {so.is_interstate ? " (Interstate)" : " (Intra-state)"}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">SO Date:</span> {so.so_date}
            </div>
            {so.expected_delivery && (
              <div>
                <span className="text-muted-foreground">Delivery:</span> {so.expected_delivery}
              </div>
            )}
            {so.po_number && (
              <div>
                <span className="text-muted-foreground">PO:</span> {so.po_number}{" "}
                {so.po_date && `(${so.po_date})`}
              </div>
            )}
            {so.salesperson && (
              <div>
                <span className="text-muted-foreground">Salesperson:</span> {so.salesperson}
              </div>
            )}
            {so.payment_terms && (
              <div>
                <span className="text-muted-foreground">Payment:</span> {so.payment_terms}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Fulfillment Summary Card */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm font-semibold">Fulfillment Summary</CardTitle>
          <div className="flex items-center gap-2">
            {summaryQuery.isLoading ? (
              <span className="text-xs text-muted-foreground">Loading…</span>
            ) : isFullyDelivered ? (
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 border-transparent text-xs">Fully delivered</Badge>
            ) : fulfilledTotal > 0 ? (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-transparent text-xs">Partial</Badge>
            ) : (
              <Badge variant="outline" className="text-xs">Not started</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isCancelled && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              SO cancelled — no further conversions allowed. Cancel downstream docs to reverse stock where applicable.
            </div>
          )}
          <div className="space-y-1.5">
            <Progress value={Number.isFinite(progressPct) ? progressPct : 0} className="h-2" />
            <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
              <span>{Number.isFinite(progressPct) ? progressPct : 0}% fulfilled</span>
              <span>{fulfilledTotal}/{orderedTotal}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="rounded-md border bg-slate-50 dark:bg-muted/20 p-2.5 flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Ordered</span>
              <span className="font-semibold tabular-nums text-slate-700 dark:text-foreground">{orderedTotal}</span>
            </div>
            <div className="rounded-md border bg-emerald-50 dark:bg-emerald-950/20 p-2.5 flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Already Delivered</span>
              <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{fulfilledTotal}</span>
            </div>
            <div className={`rounded-md border p-2.5 flex flex-col gap-0.5 ${balanceTotal > 0 ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200" : "bg-emerald-50 dark:bg-emerald-950/20"}`}>
              <span className={`text-[11px] uppercase tracking-wide ${balanceTotal > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>Balance</span>
              <span className={`font-semibold tabular-nums ${balanceTotal > 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>{balanceTotal}</span>
            </div>
            <div className="rounded-md border bg-muted/30 p-2.5 flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Proforma</span>
              <span className="font-semibold tabular-nums text-muted-foreground">{fulfilledProforma}</span>
            </div>
          </div>
          {(conversions.length > 0 || summary.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground border-t pt-2.5">
              <span className="font-medium text-foreground">Breakdown:</span>
              <span className="tabular-nums">Tax Invoice {typeCounts["tax_invoice"] || 0}</span>
              <span className="opacity-30">·</span>
              <span className="tabular-nums">General Challan {typeCounts["general_dc"] || 0}</span>
              <span className="opacity-30">·</span>
              <span className="tabular-nums">Proforma {typeCounts["proforma_invoice"] || 0}</span>
              {(typeCounts["delivery_challan"] || 0) > 0 && (
                <>
                  <span className="opacity-30">·</span>
                  <span className="tabular-nums" title="Legacy conversions created before the DC option was removed">
                    DC (legacy) {typeCounts["delivery_challan"] || 0}
                  </span>
                </>
              )}
              <span className="opacity-30">·</span>
              <span>Balance {balanceTotal} {isFullyDelivered ? "(0 remaining)" : `(${orderedTotal - fulfilledTotal} remaining)`}</span>
            </div>
          )}
          {isFullyDelivered && (
            <div className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-md px-3 py-2">
              Fully delivered — create a new Sales Order for additional quantity. Proforma still allowed but capped at 0.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Items</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="text-left p-2 w-8">#</th>
                <th className="text-left p-2">Description</th>
                <th className="text-left p-2">HSN</th>
                <th className="text-right p-2">Ordered</th>
                <th className="text-right p-2">Already Delivered</th>
                <th className="text-right p-2">Balance</th>
                <th className="text-right p-2">Rate</th>
                <th className="text-right p-2">Disc %</th>
                <th className="text-right p-2">GST %</th>
                <th className="text-right p-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(so.items) ? so.items : []).length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-4 text-center text-sm text-muted-foreground">No items</td>
                </tr>
              ) : (
                (so.items as any[]).map((it: any, i: number) => {
                  const s = summaryByLine.get(i);
                  const already = s ? Math.round(Number((s as any).fulfilled_stock) || 0) : 0;
                  const balanceRaw = s ? (s as any).balance : (Number(it?.qty) || 0);
                  const balance = Number.isFinite(Number(balanceRaw)) ? Math.round(Number(balanceRaw)) : 0;
                  const balZero = balance <= 0;
                  const lineTotal = Number(it?.line_total);
                  return (
                    <tr key={i} className="border-t">
                      <td className="p-2">{i + 1}</td>
                      <td className="p-2">{String(it?.description || "—")}</td>
                      <td className="p-2 font-mono text-xs">{it?.hsn || "—"}</td>
                      <td className="p-2 text-right tabular-nums">{Number(it?.qty) || 0} {it?.unit || ""}</td>
                      <td className={`p-2 text-right tabular-nums text-xs ${already > 0 ? "bg-muted/30" : ""}`}>{already}</td>
                      <td className={`p-2 text-right tabular-nums text-xs font-medium ${balZero ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-300"}`}>{balance}</td>
                      <td className="p-2 text-right tabular-nums">{inr(Number(it?.rate) || 0)}</td>
                      <td className="p-2 text-right tabular-nums">{Number(it?.discount_pct) || 0}%</td>
                      <td className="p-2 text-right tabular-nums">{Number(it?.gst_rate) || 0}%</td>
                      <td className="p-2 text-right font-medium tabular-nums">{inr(Number.isFinite(lineTotal) ? lineTotal : 0)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot className="border-t bg-muted/30">
              <tr>
                <td colSpan={9} className="p-2 text-right text-muted-foreground">
                  Subtotal
                </td>
                <td className="p-2 text-right tabular-nums">{inr(so.subtotal)}</td>
              </tr>
              {so.discount > 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-right text-muted-foreground">
                    Discount
                  </td>
                  <td className="p-2 text-right text-red-600 tabular-nums">−{inr(so.discount)}</td>
                </tr>
              )}
              {so.cgst > 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-right text-muted-foreground">
                    CGST
                  </td>
                  <td className="p-2 text-right tabular-nums">{inr(so.cgst)}</td>
                </tr>
              )}
              {so.sgst > 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-right text-muted-foreground">
                    SGST
                  </td>
                  <td className="p-2 text-right tabular-nums">{inr(so.sgst)}</td>
                </tr>
              )}
              {so.igst > 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-right text-muted-foreground">
                    IGST
                  </td>
                  <td className="p-2 text-right tabular-nums">{inr(so.igst)}</td>
                </tr>
              )}
              {so.cess > 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-right text-muted-foreground">
                    Cess
                  </td>
                  <td className="p-2 text-right tabular-nums">{inr(so.cess)}</td>
                </tr>
              )}
              {(so as any).shipping_charges > 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-right text-muted-foreground">
                    Shipping
                  </td>
                  <td className="p-2 text-right tabular-nums">{inr((so as any).shipping_charges)}</td>
                </tr>
              )}
              {(so as any).adjustment !== 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-right text-muted-foreground">
                    Adjustment
                  </td>
                  <td className="p-2 text-right tabular-nums">{inr((so as any).adjustment)}</td>
                </tr>
              )}
              {(so as any).tcs_amount > 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-right text-muted-foreground">
                    TCS ({(so as any).tcs_percent}%)
                  </td>
                  <td className="p-2 text-right tabular-nums">{inr((so as any).tcs_amount)}</td>
                </tr>
              )}
              {so.round_off !== 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-right text-muted-foreground">
                    Round Off
                  </td>
                  <td className="p-2 text-right tabular-nums">{inr(so.round_off)}</td>
                </tr>
              )}
              <tr className="font-semibold">
                <td colSpan={9} className="p-2 text-right">
                  Total
                </td>
                <td className="p-2 text-right tabular-nums">{inr(so.total)}</td>
              </tr>
            </tfoot>
          </table>
          {so.total_in_words && (
            <div className="text-xs italic text-muted-foreground mt-2">
              Rupees {so.total_in_words}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Documents Timeline */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Linked Documents</CardTitle>
        </CardHeader>
        <CardContent>
          {conversionsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground py-4">Loading conversions…</div>
          ) : conversions.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 border border-dashed rounded-md px-4">
              No conversions yet — use <span className="font-medium text-foreground">Convert</span> to create Tax Invoice, General Challan or Proforma.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Doc No</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Qty this doc</th>
                    <th className="text-right p-2">Cumulative</th>
                    <th className="text-right p-2">Balance after</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-right p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // compute running cumulative for display: sort oldest first for cumulative, but data is newest first
                    const sorted = [...conversions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                    let running = 0;
                    const withCum = sorted.map((c) => {
                      const thisQty = sumQty(c.this_fulfilled);
                      running = Math.round(running + thisQty);
                      const balanceAfterRaw = c.balance_after;
                      let balAfter: number | null = null;
                      if (Array.isArray(balanceAfterRaw)) balAfter = Math.round((balanceAfterRaw as any[]).reduce((s, x: any) => s + (Number(x?.balance ?? 0) || 0), 0));
                      else if (balanceAfterRaw != null && typeof balanceAfterRaw === "object") balAfter = 0;
                      // fallback: ordered - cumulative
                      if (balAfter == null || (Array.isArray(balanceAfterRaw) && (balanceAfterRaw as any[]).length === 0)) {
                        balAfter = Math.max(0, orderedTotal - running);
                      }
                      return { c, thisQty, cumulative: running, balanceAfter: balAfter };
                    });
                    // render newest first
                    return [...withCum].reverse().map(({ c, thisQty, cumulative, balanceAfter }) => {
                      const meta = convTypeMeta(c.conversion_type);
                      const link = convTargetLink(c);
                      const isConvCancelled = String(c.status || "").trim().toLowerCase() === "cancelled";
                      const reversesStock = getReverseEffect(c.conversion_type);
                      const rowClass = isConvCancelled ? "border-t opacity-60 bg-muted/20" : "border-t";
                      const docNoClass = isConvCancelled ? "p-2 font-mono text-xs line-through text-muted-foreground" : "p-2 font-mono text-xs";
                      // balanceAfter graceful fallback: if conversions cancelled, balance math may still valid but show muted
                      const balDisplay = balanceAfter == null || !Number.isFinite(Number(balanceAfter)) ? "—" : String(balanceAfter);
                      return (
                        <tr key={c.id} className={rowClass} title={isConvCancelled && reversesStock ? "Cancelled — stock reversed" : isConvCancelled ? "Cancelled (no stock effect)" : undefined}>
                          <td className="p-2 text-xs tabular-nums">{fmtDate(c.created_at)}</td>
                          <td className={docNoClass}>{c.target_no || c.target_id.slice(0, 8)}</td>
                          <td className="p-2">
                            <StatusBadge tone={isConvCancelled ? "neutral" as any : (meta.tone as any)}>{meta.label}</StatusBadge>
                            {isConvCancelled && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">(cancelled)</span>}
                          </td>
                          <td className={`p-2 text-right tabular-nums ${isConvCancelled ? "line-through text-muted-foreground" : ""}`}>{thisQty}</td>
                          <td className={`p-2 text-right tabular-nums ${isConvCancelled ? "line-through text-muted-foreground" : ""}`}>{cumulative}</td>
                          <td className={`p-2 text-right tabular-nums font-medium ${isConvCancelled ? "text-muted-foreground line-through" : Number(balanceAfter) <= 0 ? "text-emerald-600" : "text-amber-600"}`}>{balDisplay}</td>
                          <td className={`p-2 text-xs capitalize ${isConvCancelled ? "text-muted-foreground line-through" : ""}`}>
                            {c.status}
                            {isConvCancelled && reversesStock && <span className="ml-1 text-[10px]">· stock restored</span>}
                          </td>
                          <td className="p-2 text-right">
                            {link ? (
                              <Link to={link.to as any} params={link.params} className="text-primary hover:underline text-xs font-medium">
                                View
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {(so.terms || so.notes) && (
        <Card>
          <CardContent className="pt-4 grid md:grid-cols-2 gap-4 text-sm">
            {so.terms && (
              <div>
                <div className="font-medium mb-1">Terms</div>
                <div className="whitespace-pre-line text-muted-foreground">{so.terms}</div>
              </div>
            )}
            {so.notes && (
              <div>
                <div className="font-medium mb-1">Notes</div>
                <div className="whitespace-pre-line text-muted-foreground">{so.notes}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Conversion is now a full-window page (see sales.orders.$id_.convert.tsx).
          The legacy SoConversionSheet Dialog wrapper is kept for compat but no
          longer mounted here. */}
    </div>
  );
}
