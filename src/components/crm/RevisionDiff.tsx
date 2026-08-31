import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Quotation, QuoteItem } from "@/lib/crm";
import { fmtMoney, fmtDate, lineAmount, lineTax } from "@/lib/crm";
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Minus,
  Plus,
  Trash2,
  Pencil,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props — supports both call styles requested in the brief
// ---------------------------------------------------------------------------

export type TotalsLite = {
  subtotal?: number;
  discount_amount?: number;
  gst_amount?: number;
  total_tax?: number;
  total?: number;
};

export type RevisionDiffProps =
  | {
      a: Quotation;
      b: Quotation;
      oldTotals?: TotalsLite | null;
      newTotals?: TotalsLite | null;
      oldQuote?: never;
      newQuote?: never;
      className?: string;
    }
  | {
      oldQuote: Quotation;
      newQuote: Quotation;
      oldTotals?: TotalsLite | null;
      newTotals?: TotalsLite | null;
      a?: never;
      b?: never;
      className?: string;
    }
  // permissive fallback so callers can use either without strict union pain
  | {
      a?: Quotation;
      b?: Quotation;
      oldQuote?: Quotation;
      newQuote?: Quotation;
      oldTotals?: TotalsLite | null;
      newTotals?: TotalsLite | null;
      className?: string;
    };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function itemKey(it: QuoteItem): string {
  const pid = (it.product_id || "").trim();
  if (pid) return `pid:${pid.toLowerCase()}`;
  return `desc:${(it.description || "").trim().toLowerCase()}`;
}

type DiffStatus = "added" | "removed" | "changed" | "unchanged";

type DiffRow = {
  key: string;
  oldItem: QuoteItem | null;
  newItem: QuoteItem | null;
  status: DiffStatus;
  oldIndex: number | null;
  newIndex: number | null;
};

function buildDiff(oldItems: QuoteItem[], newItems: QuoteItem[]): DiffRow[] {
  // Count occurrences to disambiguate duplicate keys
  const keyCountsOld = new Map<string, number>();
  const keyCountsNew = new Map<string, number>();

  const oldMap = new Map<string, { item: QuoteItem; idx: number }>();
  oldItems.forEach((it, idx) => {
    let k = itemKey(it);
    const c = keyCountsOld.get(k) || 0;
    keyCountsOld.set(k, c + 1);
    if (c > 0) k = `${k}#${c}`;
    oldMap.set(k, { item: it, idx });
  });

  const newMap = new Map<string, { item: QuoteItem; idx: number }>();
  newItems.forEach((it, idx) => {
    let k = itemKey(it);
    const c = keyCountsNew.get(k) || 0;
    keyCountsNew.set(k, c + 1);
    if (c > 0) k = `${k}#${c}`;
    newMap.set(k, { item: it, idx });
  });

  const allKeys = new Set<string>([...oldMap.keys(), ...newMap.keys()]);
  // Preserve old order first, then new-only
  const ordered: string[] = [];
  oldItems.forEach((it) => {
    let k = itemKey(it);
    // find actual stored key (with suffix)
    for (const ak of allKeys) {
      if (ak === k || ak.startsWith(`${k}#`)) {
        if (!ordered.includes(ak) && oldMap.has(ak)) ordered.push(ak);
      }
    }
  });
  // Append new-only keys not yet ordered
  for (const k of newMap.keys()) if (!ordered.includes(k)) ordered.push(k);

  // Fallback: if ordering is empty (e.g. duplicate handling mismatch), just union order
  const finalKeys = ordered.length ? ordered : [...allKeys];

  return finalKeys.map((k) => {
    const o = oldMap.get(k) || null;
    const n = newMap.get(k) || null;
    const oldItem = o?.item ?? null;
    const newItem = n?.item ?? null;
    let status: DiffStatus = "unchanged";
    if (oldItem && !newItem) status = "removed";
    else if (!oldItem && newItem) status = "added";
    else if (oldItem && newItem) {
      const same =
        (oldItem.description || "").trim() === (newItem.description || "").trim() &&
        Number(oldItem.qty) === Number(newItem.qty) &&
        Number(oldItem.rate) === Number(newItem.rate) &&
        Number(oldItem.discount_percent || 0) === Number(newItem.discount_percent || 0) &&
        Number(oldItem.tax_percent || 0) === Number(newItem.tax_percent || 0) &&
        Number(lineAmount(oldItem)) === Number(lineAmount(newItem)) &&
        (oldItem.hsn || "") === (newItem.hsn || "");
      status = same ? "unchanged" : "changed";
    }
    return {
      key: k,
      oldItem,
      newItem,
      status,
      oldIndex: o?.idx ?? null,
      newIndex: n?.idx ?? null,
    };
  });
}

function numericDeltaClass(oldVal: number, newVal: number): string {
  if (newVal > oldVal) return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200";
  if (newVal < oldVal) return "bg-red-50 text-red-700 ring-1 ring-red-200";
  return "";
}

function DeltaArrow({ delta }: { delta: number }) {
  if (delta > 0) return <ArrowUp className="h-3 w-3 text-emerald-600" />;
  if (delta < 0) return <ArrowDown className="h-3 w-3 text-red-600" />;
  return <Minus className="h-3 w-3 text-slate-400" />;
}

function HeaderField({
  label,
  oldVal,
  newVal,
}: {
  label: string;
  oldVal: string;
  newVal: string;
}) {
  const changed = oldVal !== newVal;
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 rounded-md px-2 py-1 text-sm",
          changed ? "bg-amber-50 ring-1 ring-amber-200" : "bg-muted/40"
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-slate-600">{oldVal || "—"}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />
          <span className={cn("truncate font-medium", changed ? "text-amber-900" : "text-slate-900")}>
            {newVal || "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RevisionDiff(props: RevisionDiffProps) {
  const oldQ = (props as { oldQuote?: Quotation }).oldQuote ?? (props as { a?: Quotation }).a;
  const newQ = (props as { newQuote?: Quotation }).newQuote ?? (props as { b?: Quotation }).b;

  if (!oldQ || !newQ) {
    return (
      <Card className="rounded-xl border border-border">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Revision diff requires two quotations.
        </CardContent>
      </Card>
    );
  }

  const oldItems = Array.isArray(oldQ.items) ? oldQ.items : [];
  const newItems = Array.isArray(newQ.items) ? newQ.items : [];
  const rows = buildDiff(oldItems, newItems);

  const oldRev = Number(oldQ.revision_no || 1);
  const newRev = Number(newQ.revision_no || 1);

  // Totals — prefer explicit totals prop, fallback to quotation fields + computed tax
  const resolveTotals = (q: Quotation, override?: TotalsLite | null) => {
    if (override) {
      return {
        subtotal: Number(override.subtotal ?? q.subtotal ?? 0),
        discount: Number(override.discount_amount ?? q.discount_amount ?? 0),
        tax: Number(override.gst_amount ?? override.total_tax ?? q.gst_amount ?? 0),
        total: Number(override.total ?? q.total ?? 0),
      };
    }
    return {
      subtotal: Number(q.subtotal ?? 0),
      discount: Number(q.discount_amount ?? 0),
      tax: Number(q.gst_amount ?? 0),
      total: Number(q.total ?? 0),
    };
  };

  const ot = resolveTotals(oldQ, props.oldTotals);
  const nt = resolveTotals(newQ, props.newTotals);
  // fallback computed tax if both zero but items exist
  const computedOldTax = oldItems.reduce((s, it) => s + lineTax(it), 0);
  const computedNewTax = newItems.reduce((s, it) => s + lineTax(it), 0);
  const finalOt = { ...ot, tax: ot.tax !== 0 ? ot.tax : computedOldTax };
  const finalNt = { ...nt, tax: nt.tax !== 0 ? nt.tax : computedNewTax };

  const deltas = {
    subtotal: finalNt.subtotal - finalOt.subtotal,
    discount: finalNt.discount - finalOt.discount,
    tax: finalNt.tax - finalOt.tax,
    total: finalNt.total - finalOt.total,
  };

  const fmtDelta = (d: number) =>
    `${d > 0 ? "+" : d < 0 ? "" : ""}${fmtMoney(d)}`;

  const headerChangedCount = rows.filter((r) => r.status !== "unchanged").length;

  return (
    <Card className={cn("rounded-xl border border-border bg-card overflow-hidden", (props as { className?: string }).className)}>
      {/* Top bar — trail + badges */}
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <History className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold leading-none">Revision diff</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Side-by-side comparison · {headerChangedCount} {headerChangedCount === 1 ? "change" : "changes"} in items
              </p>
            </div>
          </div>

          {/* Trail badge V1 → V2 */}
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-slate-50 px-3 py-1 text-xs font-medium">
              <span className="rounded-full bg-white px-2 py-0.5 border text-slate-700">V{oldRev}</span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
              <span className="rounded-full bg-primary px-2 py-0.5 text-primary-foreground">V{newRev}</span>
            </div>
            <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-200">
              {oldQ.quote_no} → {newQ.quote_no}
            </Badge>
          </div>
        </div>

        {/* Quote identity row */}
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-white border-slate-200 text-slate-700">
                {oldQ.quote_no}
              </Badge>
              <Badge className="bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-100">
                v{oldRev}
              </Badge>
              {oldQ.is_latest === false && (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                  Superseded
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">Date: {fmtDate(oldQ.quote_date)}</div>
            <div className="text-xs text-muted-foreground truncate">
              {oldQ.subject || oldQ.customer_id || "—"}
            </div>
          </div>
          <div className="space-y-1 text-right">
            <div className="flex items-center justify-end gap-2">
              <Badge className="bg-primary text-primary-foreground border-transparent">v{newRev}</Badge>
              <Badge variant="outline" className="bg-white border-slate-200 text-slate-700">
                {newQ.quote_no}
              </Badge>
              {newQ.is_latest !== false && (
                <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50">
                  Latest
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">Date: {fmtDate(newQ.quote_date)}</div>
            <div className="text-xs font-medium text-slate-900 truncate">
              {newQ.subject || newQ.customer_id || "—"}
            </div>
          </div>
        </div>

        {/* Header fields delta */}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          <HeaderField label="Quote date" oldVal={fmtDate(oldQ.quote_date)} newVal={fmtDate(newQ.quote_date)} />
          <HeaderField label="Expiry" oldVal={fmtDate(oldQ.expiry_date)} newVal={fmtDate(newQ.expiry_date)} />
          <HeaderField label="Status" oldVal={oldQ.status} newVal={newQ.status} />
          <HeaderField label="Place of supply" oldVal={oldQ.place_of_supply || "—"} newVal={newQ.place_of_supply || "—"} />
          <HeaderField label="Payment terms" oldVal={oldQ.payment_terms || "—"} newVal={newQ.payment_terms || "—"} />
          <HeaderField label="Salesperson" oldVal={oldQ.salesperson || "—"} newVal={newQ.salesperson || "—"} />
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Items table diff */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40 border-b">
                <TableHead className="w-10 text-xs">#</TableHead>
                <TableHead className="min-w-[220px] text-xs">Description</TableHead>
                <TableHead className="w-20 text-right text-xs">Qty</TableHead>
                <TableHead className="w-24 text-right text-xs">Rate</TableHead>
                <TableHead className="w-16 text-right text-xs">Disc%</TableHead>
                <TableHead className="w-16 text-right text-xs">Tax%</TableHead>
                <TableHead className="w-28 text-right text-xs">Amount</TableHead>
                <TableHead className="w-28 text-center text-xs">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    No items in either revision.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const displayItem = r.newItem ?? r.oldItem;
                  const idx = r.newIndex != null ? r.newIndex + 1 : r.oldIndex != null ? r.oldIndex + 1 : 0;

                  const isAdded = r.status === "added";
                  const isRemoved = r.status === "removed";
                  const isChanged = r.status === "changed";

                  // per-field deltas when both present
                  const qtyDelta = r.oldItem && r.newItem ? Number(r.newItem.qty) - Number(r.oldItem.qty) : 0;
                  const rateDelta = r.oldItem && r.newItem ? Number(r.newItem.rate) - Number(r.oldItem.rate) : 0;
                  const discDelta =
                    r.oldItem && r.newItem
                      ? Number(r.newItem.discount_percent || 0) - Number(r.oldItem.discount_percent || 0)
                      : 0;
                  const taxDelta =
                    r.oldItem && r.newItem
                      ? Number(r.newItem.tax_percent || 0) - Number(r.oldItem.tax_percent || 0)
                      : 0;
                  const oldAmt = r.oldItem ? lineAmount(r.oldItem) : 0;
                  const newAmt = r.newItem ? lineAmount(r.newItem) : 0;
                  const amtDelta = newAmt - oldAmt;

                  const descChanged =
                    isChanged &&
                    (r.oldItem?.description || "").trim() !== (r.newItem?.description || "").trim();

                  const rowBg = isAdded
                    ? "bg-emerald-50/60"
                    : isRemoved
                      ? "bg-red-50/60"
                      : isChanged
                        ? "bg-amber-50/30"
                        : "";

                  return (
                    <TableRow key={r.key} className={cn("border-b", rowBg)}>
                      <TableCell className="text-xs text-muted-foreground">{idx}</TableCell>

                      <TableCell className="min-w-[220px]">
                        <div
                          className={cn(
                            "rounded px-1.5 py-0.5 text-sm",
                            descChanged ? "bg-amber-100 text-amber-900 ring-1 ring-amber-200" : "",
                            isAdded ? "bg-emerald-50" : isRemoved ? "bg-red-50" : ""
                          )}
                        >
                          <span className={cn(isRemoved && "line-through text-slate-500")}>
                            {displayItem?.description || "—"}
                          </span>
                          {displayItem?.product_name && displayItem?.product_name !== displayItem?.description && (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              ({displayItem.product_name})
                            </span>
                          )}
                          {displayItem?.hsn && (
                            <span className="ml-1 font-mono text-[11px] text-slate-500">HSN {displayItem.hsn}</span>
                          )}
                        </div>
                        {r.oldItem && r.newItem && descChanged && (
                          <div className="mt-1 text-[11px] text-muted-foreground line-through">
                            {r.oldItem.description}
                          </div>
                        )}
                      </TableCell>

                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums",
                          isChanged && qtyDelta !== 0 ? numericDeltaClass(Number(r.oldItem!.qty), Number(r.newItem!.qty)) + " rounded px-1.5 py-0.5" : ""
                        )}
                      >
                        {r.newItem != null ? r.newItem.qty : r.oldItem?.qty ?? "—"}
                      </TableCell>

                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums",
                          isChanged && rateDelta !== 0
                            ? numericDeltaClass(Number(r.oldItem!.rate), Number(r.newItem!.rate)) + " rounded px-1.5 py-0.5"
                            : ""
                        )}
                      >
                        {r.newItem != null ? fmtMoney(Number(r.newItem.rate)) : fmtMoney(Number(r.oldItem?.rate))}
                      </TableCell>

                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums",
                          isChanged && discDelta !== 0
                            ? numericDeltaClass(
                                Number(r.oldItem!.discount_percent || 0),
                                Number(r.newItem!.discount_percent || 0)
                              ) + " rounded px-1.5 py-0.5"
                            : ""
                        )}
                      >
                        {r.newItem != null
                          ? `${Number(r.newItem.discount_percent || 0)}%`
                          : `${Number(r.oldItem?.discount_percent || 0)}%`}
                      </TableCell>

                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums",
                          isChanged && taxDelta !== 0
                            ? numericDeltaClass(
                                Number(r.oldItem!.tax_percent || 0),
                                Number(r.newItem!.tax_percent || 0)
                              ) + " rounded px-1.5 py-0.5"
                            : ""
                        )}
                      >
                        {r.newItem != null
                          ? `${Number(r.newItem.tax_percent || 0)}%`
                          : `${Number(r.oldItem?.tax_percent || 0)}%`}
                      </TableCell>

                      <TableCell
                        className={cn(
                          "text-right text-sm font-medium tabular-nums",
                          isChanged && amtDelta !== 0
                            ? numericDeltaClass(oldAmt, newAmt) + " rounded px-1.5 py-0.5"
                            : isAdded
                              ? "bg-emerald-50 text-emerald-800 rounded px-1.5 py-0.5"
                              : isRemoved
                                ? "bg-red-50 text-red-700 rounded px-1.5 py-0.5"
                                : ""
                        )}
                      >
                        {isRemoved ? fmtMoney(oldAmt) : fmtMoney(newAmt)}
                      </TableCell>

                      <TableCell className="text-center">
                        {isAdded ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 border border-emerald-200">
                            <Plus className="h-3 w-3" /> Added
                          </span>
                        ) : isRemoved ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 border border-red-200">
                            <Trash2 className="h-3 w-3" /> Removed
                          </span>
                        ) : isChanged ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
                            <Pencil className="h-3 w-3" /> Changed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 border border-slate-200">
                            <Minus className="h-3 w-3" /> —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Totals delta */}
        <div className="border-t bg-muted/20 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(
              [
                { label: "Subtotal", oldVal: finalOt.subtotal, newVal: finalNt.subtotal, delta: deltas.subtotal, emphasized: false },
                { label: "Discount", oldVal: finalOt.discount, newVal: finalNt.discount, delta: deltas.discount, emphasized: false },
                { label: "Tax", oldVal: finalOt.tax, newVal: finalNt.tax, delta: deltas.tax, emphasized: false },
                { label: "Total", oldVal: finalOt.total, newVal: finalNt.total, delta: deltas.total, emphasized: true },
              ] as const
            ).map((row) => {
              const up = row.delta > 0;
              const down = row.delta < 0;
              return (
                <div
                  key={row.label}
                  className={cn(
                    "rounded-xl border bg-card p-3",
                    (row as { emphasized: boolean }).emphasized ? "border-primary/20 bg-primary/[0.04]" : "border-border"
                  )}
                >
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {row.label}
                  </div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold tabular-nums">{fmtMoney(row.newVal)}</span>
                    <span className="text-xs text-muted-foreground line-through">{fmtMoney(row.oldVal)}</span>
                  </div>
                  <div
                    className={cn(
                      "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border",
                      up
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : down
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-slate-50 text-slate-500 border-slate-200"
                    )}
                  >
                    <DeltaArrow delta={row.delta} />
                    {fmtDelta(row.delta)}
                    <span className="ml-0.5 hidden sm:inline">{up ? "↑" : down ? "↓" : "—"}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Green = increase, red = decrease, amber = description/text change. All amounts in ₹.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Named export alias for flexibility
export { RevisionDiff };
