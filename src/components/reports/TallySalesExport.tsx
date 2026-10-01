import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchInvoicesForTally, branchOptions, ALL_BRANCHES } from "@/lib/tallySales";
import { buildSalesExport, salesCsv, type SalesExportResult } from "@/lib/tallyExport";
import { istTodayIso, daysAgoIst } from "@/lib/dateRange";
import { Calendar, FileText, Download, TriangleAlert, CircleCheck, Ban } from "lucide-react";

/**
 * Tally sales export — turns posted sales invoices into the two formats an
 * accountant can actually load into Tally: the import envelope (.xml) and a
 * one-row-per-ledger-entry spreadsheet (.csv) for manual import.
 *
 * Read-only: nothing here writes to the database, so there is no confirm step.
 */

// Blob download for a pre-rendered string. `exportCSV` in @/lib/exports builds a
// CSV from column accessors, and both the Tally XML and `salesCsv()` output are
// already-serialised text — reshaping them into rows to re-join would corrupt
// escaping, so they are written straight to a blob instead.
function downloadText(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Compact, single-line label for a section of the warnings block. */
const label =
  "text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5";
const field = "h-9 bg-card border-border text-[13px] shadow-sm focus-visible:ring-primary/20";

function WarningBlock({
  tone,
  title,
  count,
  children,
}: {
  tone: "warn" | "bad" | "info";
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  const Icon = tone === "bad" ? Ban : tone === "warn" ? TriangleAlert : CircleCheck;
  const toneCls =
    tone === "bad"
      ? "border-destructive/40 bg-destructive/5"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-border/60 bg-muted/20";
  const textCls = tone === "bad" ? "text-destructive" : "text-amber-700 dark:text-amber-400";
  return (
    <div className={`rounded-lg border ${toneCls} p-3`}>
      <p className={`text-xs font-semibold tracking-tight flex items-center gap-1.5 ${textCls}`}>
        <Icon className="h-3.5 w-3.5" />
        {title}
        <span className="font-mono tabular-nums">({count})</span>
      </p>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

export function TallySalesExport() {
  const [from, setFrom] = useState(daysAgoIst(30));
  const [to, setTo] = useState(istTodayIso());
  const [branchId, setBranchId] = useState<string>(ALL_BRANCHES);
  const [result, setResult] = useState<SalesExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const range = useMemo(() => ({ from, to, branchId }), [from, to, branchId]);

  // The branch filter needs the master list, so this runs on mount and refetches
  // whenever the range changes — the Export button then re-runs it to guarantee
  // the built result matches what is on screen at the moment of export.
  const dataQ = useQuery({
    queryKey: ["tally-sales", range],
    queryFn: () => fetchInvoicesForTally(range),
    staleTime: 30_000,
  });

  const branches = useMemo(
    () => branchOptions(dataQ.data?.branchesById ?? new Map()),
    [dataQ.data],
  );
  const branchName = (id: string | null | undefined) =>
    branches.find((b) => b.id === id)?.name ?? (id ? id.slice(0, 8) : "—");

  const stem = `tally_sales_${from}_to_${to}${branchId === ALL_BRANCHES ? "" : `_${branchName(branchId).replace(/\s+/g, "_")}`}`;

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      // Refetch first: a cached batch is how you post yesterday's numbers to
      // today's ledger. Fresh data, then the balance gate below.
      const { data: fresh } = await dataQ.refetch();
      if (!fresh) throw new Error("Could not load invoices for this range");
      setResult(buildSalesExport({ ...fresh, stripBadReferences: true }));
    } catch (e) {
      setResult(null);
      setExportError(msg(e));
    } finally {
      setExporting(false);
    }
  };

  // The backend contract: a voucher that fails the balance check MUST NOT reach
  // Tally — an unbalanced import corrupts the books. Downloads are withheld
  // entirely, not just flagged.
  const blocked = (result?.unbalanced.length ?? 0) > 0;
  const hasWarnings =
    result !== null && (result.referenceWarnings.length > 0 || result.drift.length > 0);

  return (
    <div className="space-y-4">
      <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-[13px] font-semibold tracking-tight flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Tally Export
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Sales invoices → Tally import XML, or a CSV for manual entry. Read-only — nothing is
                posted to Tally from here.
              </CardDescription>
            </div>
            {result && !blocked ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {result.voucherCount} voucher{result.voucherCount === 1 ? "" : "s"}
                </span>
                <Button
                  size="sm"
                  onClick={() =>
                    downloadText(result.xml, `${stem}.xml`, "application/xml;charset=utf-8")
                  }
                >
                  <Download className="h-3.5 w-3.5" /> Download XML
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadText(salesCsv(result), `${stem}.csv`, "text/csv;charset=utf-8")
                  }
                >
                  <Download className="h-3.5 w-3.5" /> Download CSV
                </Button>
              </div>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
            <div className="shrink-0">
              <label className={label}>From</label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className={`${field} pl-8 w-[150px]`}
                />
              </div>
            </div>
            <div className="shrink-0">
              <label className={label}>To</label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className={`${field} pl-8 w-[150px]`}
                />
              </div>
            </div>
            <div className="sm:w-[220px] shrink-0">
              <label className={label}>Branch</label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className={`${field} w-full`}>
                  <SelectValue placeholder="All branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code ? `${b.code} — ` : ""}
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="sm:ml-auto shrink-0"
              onClick={runExport}
              disabled={exporting || dataQ.isFetching || !from || !to || from > to}
            >
              {exporting ? "Exporting…" : "Export"}
            </Button>
          </div>

          {from > to ? (
            <p className="text-xs text-destructive">The from date is after the to date.</p>
          ) : null}

          {/* Result + warnings */}
          {exportError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-xs font-semibold text-destructive">Export failed</p>
              <p className="text-xs text-muted-foreground mt-1">{exportError}</p>
            </div>
          ) : null}

          {result ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="tabular-nums">
                  {result.voucherCount} voucher{result.voucherCount === 1 ? "" : "s"}
                </Badge>
                {result.skippedCancelled > 0 ? (
                  <span>
                    {result.skippedCancelled} cancelled invoice
                    {result.skippedCancelled === 1 ? "" : "s"} skipped
                  </span>
                ) : null}
                {result.unbalanced.length === 0 ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    All vouchers balance
                  </span>
                ) : null}
              </div>

              {blocked ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                  <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                    <Ban className="h-3.5 w-3.5" />
                    {result.unbalanced.length} voucher
                    {result.unbalanced.length === 1 ? "" : "s"} failed the balance check — download
                    withheld
                  </p>
                  <p className="text-xs text-muted-foreground">
                    An unbalanced voucher would corrupt the books on import. Fix the stored totals
                    on these invoices, then export again.
                  </p>
                  <ul className="space-y-1 mt-1">
                    {result.unbalanced.map((u) => (
                      <li key={u.voucherNumber} className="text-xs font-mono tabular-nums">
                        {u.voucherNumber} — off by ₹{Math.abs(u.check.diff).toFixed(2)} (
                        {u.check.sum.toFixed(2)} vs {u.check.expected.toFixed(2)})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {hasWarnings ? <Separator /> : null}

              {result.synthesizedLedgers.length > 0 ? (
                <WarningBlock
                  tone="info"
                  title="Ledgers not in the map"
                  count={result.synthesizedLedgers.length}
                >
                  <p className="text-xs text-muted-foreground">
                    These tax ledgers were named by convention rather than pulled from your ledger
                    map. They import fine on a default Tally company, but rename them here if your
                    chart of accounts spells them differently.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {result.synthesizedLedgers.map((n) => (
                      <Badge key={n} variant="secondary" className="font-mono text-[11px]">
                        {n}
                      </Badge>
                    ))}
                  </div>
                </WarningBlock>
              ) : null}

              <WarningBlock
                tone="warn"
                title="Suspicious references"
                count={result.referenceWarnings.length}
              >
                {result.referenceWarnings.map((w, i) => (
                  <p
                    key={`${w.voucherNumber}-${w.field}-${i}`}
                    className="text-xs text-muted-foreground"
                  >
                    <span className="font-mono text-foreground">{w.voucherNumber}</span> · {w.field}{" "}
                    <span className="font-mono">{w.value}</span> — {w.reason}
                  </p>
                ))}
              </WarningBlock>

              <WarningBlock
                tone="warn"
                title="Stored vs recomputed totals"
                count={result.drift.length}
              >
                <p className="text-xs text-muted-foreground">
                  The export posts the stored header, so these differences are a data warning to
                  investigate rather than something corrected during export.
                </p>
                {result.drift.slice(0, 12).map((d, i) => (
                  <p
                    key={`${d.voucherNumber}-${d.field}-${i}`}
                    className="text-xs text-muted-foreground tabular-nums"
                  >
                    <span className="font-mono text-foreground">{d.voucherNumber}</span> · {d.field}
                    : {d.stored.toFixed(2)} stored vs {d.recomputed.toFixed(2)} recomputed (Δ{" "}
                    {d.delta.toFixed(2)})
                  </p>
                ))}
                {result.drift.length > 12 ? (
                  <p className="text-xs text-muted-foreground">
                    +{result.drift.length - 12} more — see the XML for the full set.
                  </p>
                ) : null}
              </WarningBlock>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Initial load — only before the first export has produced a result. */}
      {dataQ.isLoading && !result ? (
        <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      ) : dataQ.isError && !result ? (
        <Card className="rounded-xl border-destructive/30 bg-card shadow-sm overflow-hidden">
          <CardContent className="p-6 text-center">
            <p className="text-sm font-medium text-destructive">Failed to load invoices</p>
            <p className="text-xs text-muted-foreground mt-1">{msg(dataQ.error)}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => dataQ.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : result && result.voucherCount === 0 ? (
        <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50 mb-3">
                <FileText className="h-6 w-6" />
              </span>
              <p className="text-sm font-semibold tracking-tight">No invoices to export</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Nothing posted between {from} and {to}
                {branchId === ALL_BRANCHES ? " across all branches" : ` at ${branchName(branchId)}`}
                . Widen the range or pick another branch.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
