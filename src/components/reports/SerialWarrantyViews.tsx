import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  ListTree,
  Hash,
  Shield,
  ShieldCheck,
  TriangleAlert,
  Clock3,
  CircleCheck,
  CalendarDays,
  Building2,
  SearchX,
  Boxes,
  ChevronDown,
  ChevronRight,
  Package,
  Warehouse,
  TrendingUp,
} from "lucide-react";
import { MovementTimeline, WarehouseFlow } from "@/components/serial/MovementTimeline";
import type { StockType, Transaction, WarehouseLite } from "@/lib/ims";

// ---------------------------------------------------------------------------
// SerialWarrantyViews — compact / detailed presentational helpers for
// Reports 4-tab page (theme: Glacier Navy — Prokon Navy Premium).
// File is intentionally isolated: no edits to src/routes/_app/reports.tsx.
// Consumers pass already-filtered data; this file only renders.
// Tokens: --primary oklch 0.32 0.08 250, --secondary #2563EB, --border #E2E8F0,
// --card, --muted, Glacier #F1F5F9 canvas.
// ---------------------------------------------------------------------------

// ── Types ───────────────────────────────────────────────────────────────────

export type SerialEntry = { sn: string; type: StockType };

export type SerialGroupLite = {
  key: string;
  model: string;
  oem: string;
  warehouse: string;
  qty: number;
  good: number;
  defective: number;
  serials: SerialEntry[];
};

export type WarrantyRowLite = {
  id: string;
  serial_number: string;
  product: string;
  /** Optional brand/model string ("Brand / Model") */
  brand_model?: string;
  customer: string;
  warranty_start_date: string | null;
  warranty_end_date: string | null;
  warehouse_id?: string | null;
};

export type WarrantyState = {
  label: "Active" | "Expiring Soon" | "Expired";
  cls: string;
  dot: string;
  group: "active" | "expiring" | "expired";
};

export type CompactDetailedView = "compact" | "detailed";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

function warrantyStateFor(
  end: string | null | undefined,
  todayIso: string,
  in30Iso: string,
): WarrantyState {
  if (!end) return { label: "Active", cls: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400", group: "active" };
  if (end < todayIso) return { label: "Expired", cls: "bg-rose-50 text-rose-800 border-rose-200", dot: "bg-rose-500", group: "expired" };
  if (end <= in30Iso) return { label: "Expiring Soon", cls: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-500", group: "expiring" };
  return { label: "Active", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500", group: "active" };
}

function todayIsoLocal(): string {
  return new Date().toISOString().slice(0, 10);
}

function in30IsoLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

// ── Compact / Detailed toggle (pill segmented, theme-matched) ──────────────

export function CompactDetailedToggle({
  value,
  onChange,
  className,
}: {
  value: CompactDetailedView;
  onChange: (v: CompactDetailedView) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-muted p-1 border border-border/40 shadow-inner",
        className,
      )}
      role="group"
      aria-label="View toggle"
    >
      <button
        type="button"
        aria-pressed={value === "compact"}
        onClick={() => onChange("compact")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium leading-none transition-all cursor-pointer",
          value === "compact"
            ? "bg-card text-primary shadow-sm ring-1 ring-border/40"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> Compact
      </button>
      <button
        type="button"
        aria-pressed={value === "detailed"}
        onClick={() => onChange("detailed")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium leading-none transition-all cursor-pointer",
          value === "detailed"
            ? "bg-card text-primary shadow-sm ring-1 ring-border/40"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <ListTree className="h-3.5 w-3.5" aria-hidden /> Detailed
      </button>
    </div>
  );
}

// ── Serial — summary KPI cards (compact hero) ─────────────────────────────

export function SerialSummaryCards({
  groups,
  className,
}: {
  groups: SerialGroupLite[];
  className?: string;
}) {
  const totals = React.useMemo(() => {
    const total = groups.reduce((s, g) => s + g.qty, 0);
    const good = groups.reduce((s, g) => s + g.good, 0);
    const defective = groups.reduce((s, g) => s + g.defective, 0);
    return { total, good, defective, models: groups.length };
  }, [groups]);

  const goodPct = totals.total ? Math.round((totals.good / totals.total) * 100) : 0;

  const cards = [
    {
      label: "Total Serials",
      value: totals.total,
      hint: `${fmt(totals.models)} model${totals.models === 1 ? "" : "s"} · across warehouses`,
      icon: Hash,
      bar: "bg-primary",
      wrap: "bg-primary text-primary-foreground shadow-sm shadow-primary/20 ring-1 ring-primary/10",
      valueCls: "text-foreground",
      gradient: "from-primary/[0.07] via-primary/[0.03] to-transparent",
    },
    {
      label: "Good",
      value: totals.good,
      hint: totals.total ? `${goodPct}% ready to issue` : "Ready to issue",
      icon: CircleCheck,
      bar: "bg-emerald-500",
      wrap: "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 ring-1 ring-emerald-600/10",
      valueCls: "text-emerald-700",
      gradient: "from-emerald-500/[0.08] via-emerald-500/[0.03] to-transparent",
    },
    {
      label: "Defective",
      value: totals.defective,
      hint: totals.defective ? "Needs QC / return" : "No defective serials",
      icon: TriangleAlert,
      bar: "bg-rose-500",
      wrap: "bg-rose-500 text-white shadow-sm shadow-rose-500/20 ring-1 ring-rose-600/10",
      valueCls: "text-rose-700",
      gradient: "from-rose-500/[0.08] via-rose-500/[0.03] to-transparent",
    },
  ] as const;

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-3 gap-3", className)}>
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className="relative overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow"
          >
            <div className={cn("absolute left-0 top-0 h-full w-[3px]", c.bar)} aria-hidden />
            <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", c.gradient)} aria-hidden />
            <div className="relative p-4 pl-5 pr-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground leading-none pt-1.5">
                  {c.label}
                </p>
                <span className={cn("grid h-9 w-9 place-items-center rounded-xl shrink-0", c.wrap)}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className={cn("text-[26px] font-bold leading-none tracking-tight tabular-nums", c.valueCls)}>
                  {fmt(c.value)}
                </span>
                {c.label === "Good" && totals.total > 0 ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold leading-none text-emerald-700 tabular-nums">
                    {goodPct}%
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground line-clamp-1">{c.hint}</p>
              {c.label !== "Defective" && totals.total > 0 ? (
                <div className="mt-3 h-1.5 rounded-full bg-muted border border-border/40 overflow-hidden flex">
                  {totals.good > 0 ? <span className="h-full bg-emerald-500" style={{ width: `${(totals.good / totals.total) * 100}%` }} /> : null}
                  {totals.defective > 0 ? <span className="h-full bg-rose-500" style={{ width: `${(totals.defective / totals.total) * 100}%` }} /> : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Warranty — summary KPI cards (compact hero) ───────────────────────────

export function WarrantySummaryCards({
  rows,
  todayIso,
  in30Iso,
  className,
}: {
  rows: WarrantyRowLite[];
  todayIso?: string;
  in30Iso?: string;
  className?: string;
}) {
  const today = todayIso ?? todayIsoLocal();
  const in30 = in30Iso ?? in30IsoLocal();

  const counts = React.useMemo(() => {
    let active = 0, expiring = 0, expired = 0;
    for (const r of rows) {
      const s = warrantyStateFor(r.warranty_end_date, today, in30);
      if (s.group === "active") active += 1;
      else if (s.group === "expiring") expiring += 1;
      else expired += 1;
    }
    return { active, expiring, expired, total: rows.length };
  }, [rows, today, in30]);

  const cards: {
    key: string;
    label: string;
    sub?: string;
    value: number;
    hint: string;
    icon: typeof ShieldCheck;
    bar: string;
    wrap: string;
    valueCls: string;
    gradient: string;
    pill: string;
  }[] = [
    {
      key: "active",
      label: "Active",
      value: counts.active,
      hint: counts.total ? `${Math.round((counts.active / counts.total) * 100)}% under warranty` : "No warranty rows",
      icon: ShieldCheck,
      bar: "bg-emerald-500",
      wrap: "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 ring-1 ring-emerald-600/10",
      valueCls: "text-emerald-700",
      gradient: "from-emerald-500/[0.08] via-emerald-500/[0.03] to-transparent",
      pill: "bg-emerald-50 border-emerald-200 text-emerald-700",
    },
    {
      key: "expiring",
      label: "Expiring Soon",
      sub: "≤ 30 days",
      value: counts.expiring,
      hint: counts.expiring ? "Renew / schedule service" : "Nothing expiring soon",
      icon: Clock3,
      bar: "bg-amber-500",
      wrap: "bg-amber-500 text-white shadow-sm shadow-amber-500/20 ring-1 ring-amber-600/10",
      valueCls: "text-amber-700",
      gradient: "from-amber-500/[0.08] via-amber-500/[0.03] to-transparent",
      pill: "bg-amber-50 border-amber-200 text-amber-800",
    },
    {
      key: "expired",
      label: "Expired",
      value: counts.expired,
      hint: counts.expired ? "Out of warranty" : "No expired warranties",
      icon: Shield,
      bar: "bg-rose-500",
      wrap: "bg-rose-500 text-white shadow-sm shadow-rose-500/20 ring-1 ring-rose-600/10",
      valueCls: "text-rose-700",
      gradient: "from-rose-500/[0.08] via-rose-500/[0.03] to-transparent",
      pill: "bg-rose-50 border-rose-200 text-rose-700",
    },
  ];

  // segmented progress bar proportions
  const total = counts.total || 1;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.key}
              className="relative overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow"
            >
              <div className={cn("absolute left-0 top-0 h-full w-[3px]", c.bar)} aria-hidden />
              <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", c.gradient)} aria-hidden />
              <div className="relative p-4 pl-5 pr-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground leading-none pt-1.5">
                      {c.label}
                    </p>
                    {c.sub ? <p className="text-[11px] font-medium text-muted-foreground mt-0.5">{c.sub}</p> : null}
                  </div>
                  <span className={cn("grid h-9 w-9 place-items-center rounded-xl shrink-0", c.wrap)}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className={cn("text-[26px] font-bold leading-none tracking-tight tabular-nums", c.valueCls)}>
                    {fmt(c.value)}
                  </span>
                  {counts.total > 0 ? (
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none tabular-nums", c.pill)}>
                      {Math.round((c.value / counts.total) * 100)}%
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground line-clamp-1">{c.hint}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* segmented health bar + legend — only when there is data */}
      {counts.total > 0 ? (
        <div className="rounded-xl border border-border/60 bg-card shadow-sm px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase text-muted-foreground shrink-0">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden /> Warranty mix
          </div>
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <div className="flex-1 h-2.5 rounded-full bg-muted border border-border/40 overflow-hidden flex shrink-0">
              {counts.active > 0 ? <span className="h-full bg-emerald-500" style={{ width: `${(counts.active / total) * 100}%` }} /> : null}
              {counts.expiring > 0 ? <span className="h-full bg-amber-500" style={{ width: `${(counts.expiring / total) * 100}%` }} /> : null}
              {counts.expired > 0 ? <span className="h-full bg-rose-500" style={{ width: `${(counts.expired / total) * 100}%` }} /> : null}
            </div>
            <span className="text-xs tabular-nums text-muted-foreground shrink-0 hidden sm:inline">
              {fmt(counts.total)} total
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs shrink-0">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Active</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Soon</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" /> Expired</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Serial — compact view (grouped table) ─────────────────────────────────

export function SerialCompactView({
  groups,
  defaultOpen = false,
  onSerialClick,
  className,
}: {
  groups: SerialGroupLite[];
  defaultOpen?: boolean;
  onSerialClick?: (sn: string) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  // if defaultOpen flip, open all
  React.useEffect(() => {
    if (defaultOpen) {
      const m: Record<string, boolean> = {};
      for (const g of groups) m[g.key] = true;
      setOpen(m);
    }
  }, [defaultOpen, groups]);

  const totalGood = React.useMemo(() => groups.reduce((s, g) => s + g.good, 0), [groups]);
  const totalBad = React.useMemo(() => groups.reduce((s, g) => s + g.defective, 0), [groups]);

  if (groups.length === 0) {
    return (
      <div className={cn("rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 flex flex-col items-center justify-center text-center gap-3", className)}>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50">
          <SearchX className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold tracking-tight text-foreground">No serialised stock</p>
        <p className="text-xs leading-relaxed text-muted-foreground max-w-sm">No serialised stock matches these filters.</p>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm", className)}>
      {/* header band with pills — matches StockWarehouseHeader density */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-card px-4 py-3">
        <span className="hidden sm:grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/10 shrink-0">
          <Hash className="h-4 w-4" />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-foreground">Serial groups</span>
        <span className="inline-flex items-center rounded-full bg-primary/[0.08] border border-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
          {fmt(groups.length)} model{groups.length === 1 ? "" : "s"}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          <CircleCheck className="h-3 w-3" /> Good {fmt(totalGood)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
          <TriangleAlert className="h-3 w-3" /> Defective {fmt(totalBad)}
        </span>
        <span className="ml-auto text-xs text-muted-foreground hidden sm:inline">{fmt(totalGood + totalBad)} total serials · click row to expand</span>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Model No</TableHead>
              <TableHead className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Warehouse</TableHead>
              <TableHead className="text-center text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Good</TableHead>
              <TableHead className="text-center text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Defective</TableHead>
              <TableHead className="text-right text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => {
              const isOpen = Boolean(open[g.key]);
              return (
                <React.Fragment key={g.key}>
                  <TableRow
                    className="cursor-pointer hover:bg-muted/50 border-b border-border/50"
                    onClick={() => setOpen((s) => ({ ...s, [g.key]: !s[g.key] }))}
                  >
                    <TableCell className="w-8 text-muted-foreground py-2.5">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell className="font-medium text-foreground py-2.5">{g.model}</TableCell>
                    <TableCell className="text-muted-foreground py-2.5">{g.warehouse}</TableCell>
                    <TableCell className="text-center py-2.5">
                      {g.good > 0 ? (
                        <span className="inline-flex items-center justify-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-700 min-w-6 tabular-nums">
                          {g.good}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center py-2.5">
                      {g.defective > 0 ? (
                        <span className="inline-flex items-center justify-center rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs font-semibold text-rose-700 min-w-6 tabular-nums">
                          {g.defective}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-foreground py-2.5">{g.qty}</TableCell>
                  </TableRow>
                  {isOpen ? (
                    <TableRow className="bg-muted/20 hover:bg-muted/20 border-b border-border/50">
                      <TableCell className="py-0" />
                      <TableCell colSpan={5} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                          <div className="flex items-center gap-3 text-xs">
                            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Good ({g.good})
                            </span>
                            <span className="inline-flex items-center gap-1.5 font-medium text-rose-700">
                              <span className="h-2 w-2 rounded-full bg-rose-500" /> Defective ({g.defective})
                            </span>
                            <span className="text-muted-foreground hidden sm:inline">— click a serial to copy</span>
                          </div>
                          <span className="text-xs text-muted-foreground">Serial numbers ({g.serials.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {g.serials.map(({ sn, type }) => {
                            const isBad = type === "defective";
                            return (
                              <Badge
                                key={sn}
                                variant="outline"
                                title={isBad ? "Defective — QC required" : "Good — ready to issue"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onSerialClick) onSerialClick(sn);
                                  else if (navigator.clipboard) void navigator.clipboard.writeText(sn);
                                }}
                                className={cn(
                                  "group inline-flex items-center gap-1.5 font-mono text-[11px] leading-none py-1 pl-2 pr-1.5 border shadow-sm transition-colors cursor-pointer select-all",
                                  isBad
                                    ? "bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100 hover:border-rose-400"
                                    : "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100 hover:border-emerald-400",
                                )}
                              >
                                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", isBad ? "bg-rose-500" : "bg-emerald-500")} />
                                {sn}
                                <span
                                  className={cn(
                                    "ml-1 inline-flex items-center rounded px-1 py-0.5 text-[9px] font-sans font-bold tracking-wide leading-none",
                                    isBad ? "bg-rose-500 text-white" : "bg-emerald-600 text-white",
                                  )}
                                >
                                  {isBad ? "BAD" : "GOOD"}
                                </span>
                              </Badge>
                            );
                          })}
                        </div>
                        {g.defective > 0 && g.good > 0 ? (
                          <p className="text-[11px] text-muted-foreground mt-2">
                            Red <span className="font-semibold text-rose-700">BAD</span> serials are defective stock in this warehouse — don&apos;t issue without QC. Green{" "}
                            <span className="font-semibold text-emerald-700">GOOD</span> are ready to issue.
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Serial — detailed view (per-serial timeline) ──────────────────────────

export function SerialDetailedView({
  groups,
  transactions,
  warehouses,
  className,
}: {
  groups: SerialGroupLite[];
  /** Optional transaction ledger for rich timeline; when omitted a lightweight serial table is shown */
  transactions?: Transaction[] | null;
  warehouses?: WarehouseLite[] | Record<string, WarehouseLite> | Map<string, WarehouseLite> | null;
  className?: string;
}) {
  const [selectedSn, setSelectedSn] = React.useState<string | null>(null);

  const flatSerials = React.useMemo(() => {
    const list: { sn: string; model: string; warehouse: string; type: StockType }[] = [];
    for (const g of groups) {
      for (const s of g.serials) list.push({ sn: s.sn, model: g.model, warehouse: g.warehouse, type: s.type });
    }
    return list.sort((a, b) => a.sn.localeCompare(b.sn));
  }, [groups]);

  // auto-select first serial
  React.useEffect(() => {
    if (!selectedSn && flatSerials.length > 0) setSelectedSn(flatSerials[0].sn);
  }, [flatSerials, selectedSn]);

  const txnsForSelected = React.useMemo(() => {
    if (!transactions || !selectedSn) return [];
    return transactions.filter((t) => (t.part_serial_no || "").trim() === selectedSn);
  }, [transactions, selectedSn]);

  if (groups.length === 0) {
    return (
      <div className={cn("rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 flex flex-col items-center justify-center text-center gap-3", className)}>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50">
          <Boxes className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold tracking-tight text-foreground">No serials to detail</p>
        <p className="text-xs leading-relaxed text-muted-foreground max-w-sm">No serialised stock matches these filters.</p>
      </div>
    );
  }

  const hasTxns = Boolean(transactions && transactions.length > 0);

  return (
    <div className={cn("grid gap-4 lg:grid-cols-[320px_1fr] items-start", className)}>
      {/* left: serial picker — sticky */}
      <div className="lg:sticky lg:top-4 space-y-3">
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/10 shrink-0">
              <Hash className="h-3.5 w-3.5" />
            </span>
            <span className="text-[13px] font-semibold tracking-tight text-foreground">Serials</span>
            <span className="ml-auto inline-flex items-center rounded-full bg-card border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {fmt(flatSerials.length)}
            </span>
          </div>
          <div className="max-h-[50vh] lg:max-h-[62vh] overflow-auto divide-y divide-border/40">
            {flatSerials.map((s) => {
              const active = s.sn === selectedSn;
              const isBad = s.type === "defective";
              return (
                <button
                  key={s.sn}
                  type="button"
                  onClick={() => setSelectedSn(s.sn)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors cursor-pointer",
                    active ? "bg-primary/[0.06] border-l-2 border-l-primary" : "hover:bg-muted/50 border-l-2 border-l-transparent",
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0", isBad ? "bg-rose-500" : "bg-emerald-500")} />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs font-semibold tracking-tight text-foreground truncate block">{s.sn}</span>
                    <span className="text-[11px] text-muted-foreground truncate block">
                      {s.model} · {s.warehouse}
                    </span>
                  </span>
                  <span className={cn("inline-flex rounded px-1 py-0.5 text-[9px] font-bold tracking-wide leading-none shrink-0", isBad ? "bg-rose-500 text-white" : "bg-emerald-600 text-white")}>
                    {isBad ? "BAD" : "GOOD"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground px-1">Detailed view · select a serial to inspect its movement timeline.</p>
      </div>

      {/* right: timeline */}
      <div className="min-w-0 space-y-3">
        <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-card px-4 py-3">
            <span className="font-mono text-sm font-bold tracking-tight text-foreground break-all">{selectedSn ?? "—"}</span>
            {selectedSn ? (
              <span className="inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {flatSerials.find((x) => x.sn === selectedSn)?.model ?? "—"} · {flatSerials.find((x) => x.sn === selectedSn)?.warehouse ?? "—"}
              </span>
            ) : null}
            <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" /> Timeline
            </span>
          </div>
          <div className="p-3 sm:p-4">
            {hasTxns ? (
              txnsForSelected.length > 0 ? (
                <MovementTimeline txns={txnsForSelected} warehouses={warehouses ?? null} />
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-6 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">No transactions for this serial</p>
                  <p className="mt-1 text-xs text-muted-foreground">This serial has no ledger entries yet. The compact view still shows its current warehouse / type.</p>
                </div>
              )
            ) : (
              // lightweight fallback: per-serial movement-like table (no txn ledger available)
              <div className="overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#F8FAFC] border-b border-border/60 text-left">
                        <th className="p-2.5 font-semibold text-slate-600 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays size={13} className="text-slate-400" aria-hidden /> Date
                          </span>
                        </th>
                        <th className="p-2.5 font-semibold text-slate-600">Type</th>
                        <th className="p-2.5 font-semibold text-slate-600">
                          <span className="inline-flex items-center gap-1.5">
                            <Hash size={13} className="text-slate-400" aria-hidden /> Voucher
                          </span>
                        </th>
                        <th className="p-2.5 font-semibold text-slate-600">Party</th>
                        <th className="p-2.5 font-semibold text-slate-600">Warehouse Flow</th>
                        <th className="p-2.5 font-semibold text-slate-600 text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      <tr className="hover:bg-slate-50/80">
                        <td className="p-2.5 text-slate-700 tabular-nums">—</td>
                        <td className="p-2.5">
                          <Badge variant="outline" className="bg-slate-50 border-slate-200 text-slate-700">
                            Current stock
                          </Badge>
                        </td>
                        <td className="p-2.5 font-mono text-xs text-slate-600">—</td>
                        <td className="p-2.5 text-slate-600">—</td>
                        <td className="p-2.5">
                          <WarehouseFlow
                            toId={null}
                            toName={flatSerials.find((x) => x.sn === selectedSn)?.warehouse ?? null}
                            category="in"
                            warehouses={warehouses ?? null}
                            size="sm"
                          />
                        </td>
                        <td className="p-2.5 text-right">
                          <span className="inline-flex min-w-[2.25rem] justify-center rounded-full border bg-emerald-50 border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-800">1</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-border/40 bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  Tip: wire <code className="rounded bg-card border border-border px-1 py-0.5 font-mono text-[11px]">transactions</code> from{" "}
                  <code className="rounded bg-card border border-border px-1 py-0.5 font-mono text-[11px]">listTransactions()</code> to render the full{" "}
                  <span className="font-medium text-foreground">MovementTimeline</span> with pill flow.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Serial — unified wrapper with view prop ─────────────────────────────────

export function SerialViews({
  groups,
  view,
  transactions,
  warehouses,
  onSerialClick,
  className,
}: {
  groups: SerialGroupLite[];
  view: CompactDetailedView;
  transactions?: Transaction[] | null;
  warehouses?: WarehouseLite[] | Record<string, WarehouseLite> | Map<string, WarehouseLite> | null;
  onSerialClick?: (sn: string) => void;
  className?: string;
}) {
  if (view === "detailed") {
    return <SerialDetailedView groups={groups} transactions={transactions} warehouses={warehouses} className={className} />;
  }
  return <SerialCompactView groups={groups} onSerialClick={onSerialClick} className={className} />;
}

// Keep the name requested in the brief as an alias
export const SerialCompactDetailed = SerialViews;

// ── Warranty — compact view (KPI cards) ────────────────────────────────────

export function WarrantyCompactView({
  rows,
  todayIso,
  in30Iso,
  className,
}: {
  rows: WarrantyRowLite[];
  todayIso?: string;
  in30Iso?: string;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className={cn("rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 flex flex-col items-center justify-center text-center gap-3", className)}>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50">
          <Shield className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold tracking-tight text-foreground">No warranty records</p>
        <p className="text-xs leading-relaxed text-muted-foreground max-w-sm">No warranty rows match these filters.</p>
      </div>
    );
  }

  return <WarrantySummaryCards rows={rows} todayIso={todayIso} in30Iso={in30Iso} className={className} />;
}

// ── Warranty — detailed view (sticky header, paginated, state pills) ──────

export function WarrantyDetailedView({
  rows,
  todayIso,
  in30Iso,
  pageSize = 20,
  className,
}: {
  rows: WarrantyRowLite[];
  todayIso?: string;
  in30Iso?: string;
  pageSize?: number;
  className?: string;
}) {
  const today = todayIso ?? todayIsoLocal();
  const in30 = in30Iso ?? in30IsoLocal();

  const [page, setPage] = React.useState(1);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);

  React.useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);

  const pageRows = React.useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, safePage, pageSize]);

  if (rows.length === 0) {
    return (
      <div className={cn("rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 flex flex-col items-center justify-center text-center gap-3", className)}>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50">
          <Shield className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold tracking-tight text-foreground">No warranty records</p>
        <p className="text-xs leading-relaxed text-muted-foreground max-w-sm">Legacy serials table · expiry tracked via warranty_end_date</p>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm", className)}>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">Serial</TableHead>
                <TableHead className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Product</TableHead>
                <TableHead className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Customer</TableHead>
                <TableHead className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">Start</TableHead>
                <TableHead className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">End</TableHead>
                <TableHead className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((r) => {
                const st = warrantyStateFor(r.warranty_end_date, today, in30);
                return (
                  <TableRow key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                    <TableCell className="font-mono text-xs font-medium tracking-tight text-foreground py-2.5 max-w-[160px] truncate" title={r.serial_number}>
                      {r.serial_number}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary/10 text-secondary ring-1 ring-secondary/10 shrink-0">
                          <Package className="h-3 w-3" />
                        </span>
                        <span className="text-[13px] font-medium text-foreground truncate max-w-[180px]" title={r.brand_model ? `${r.product} · ${r.brand_model}` : r.product}>
                          {r.product}
                        </span>
                      </span>
                      {r.brand_model ? <span className="block text-[11px] text-muted-foreground truncate max-w-[200px] ml-7">{r.brand_model}</span> : null}
                    </TableCell>
                    <TableCell className="text-xs text-foreground py-2.5 max-w-[180px] truncate" title={r.customer}>
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden /> {r.customer}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-muted-foreground py-2.5 whitespace-nowrap">
                      {r.warranty_start_date ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3 opacity-60" aria-hidden /> {r.warranty_start_date.slice(0, 10)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-foreground py-2.5 whitespace-nowrap">{r.warranty_end_date ? r.warranty_end_date.slice(0, 10) : "—"}</TableCell>
                    <TableCell className="py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none shadow-sm whitespace-nowrap",
                          st.cls,
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", st.dot)} aria-hidden />
                        {st.label}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* pagination footer — matches Stock pattern but lighter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-4 py-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, rows.length)} of {fmt(rows.length)} warranty rows
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="inline-flex h-8 items-center justify-center rounded-full border border-border bg-card px-3 text-xs font-medium shadow-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Prev
          </button>
          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-primary text-primary-foreground px-2 text-xs font-semibold tabular-nums shadow-sm">
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="inline-flex h-8 items-center justify-center rounded-full border border-border bg-card px-3 text-xs font-medium shadow-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Warranty — unified wrapper with view prop ───────────────────────────────

export function WarrantyViews({
  rows,
  view,
  todayIso,
  in30Iso,
  pageSize,
  className,
}: {
  rows: WarrantyRowLite[];
  view: CompactDetailedView;
  todayIso?: string;
  in30Iso?: string;
  pageSize?: number;
  className?: string;
}) {
  if (view === "detailed") {
    return <WarrantyDetailedView rows={rows} todayIso={todayIso} in30Iso={in30Iso} pageSize={pageSize} className={className} />;
  }
  return <WarrantyCompactView rows={rows} todayIso={todayIso} in30Iso={in30Iso} className={className} />;
}

// ── Combined page-level helpers (optional) ─────────────────────────────────

export function WarrantyHeaderChips({
  rows,
  todayIso,
  in30Iso,
}: {
  rows: WarrantyRowLite[];
  todayIso?: string;
  in30Iso?: string;
}) {
  const today = todayIso ?? todayIsoLocal();
  const in30 = in30Iso ?? in30IsoLocal();
  const { active, expiring, expired } = React.useMemo(() => {
    let a = 0, e = 0, x = 0;
    for (const r of rows) {
      const s = warrantyStateFor(r.warranty_end_date, today, in30);
      if (s.group === "active") a += 1;
      else if (s.group === "expiring") e += 1;
      else x += 1;
    }
    return { active: a, expiring: e, expired: x };
  }, [rows, today, in30]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
        <ShieldCheck className="h-3 w-3" /> Active {fmt(active)}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
        <Clock3 className="h-3 w-3" /> Soon {fmt(expiring)}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
        <Shield className="h-3 w-3" /> Expired {fmt(expired)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card wrappers that mimic ReportsWarrantyShell but with view toggle built-in
// ---------------------------------------------------------------------------

export function WarrantyCardShell({
  count,
  view,
  onViewChange,
  rows,
  todayIso,
  in30Iso,
  actions,
  children,
  className,
}: {
  count: number;
  view?: CompactDetailedView;
  onViewChange?: (v: CompactDetailedView) => void;
  rows?: WarrantyRowLite[];
  todayIso?: string;
  in30Iso?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-xl border-border/60 bg-card shadow-sm overflow-hidden", className)}>
      <div className="flex flex-col gap-3 border-b border-border/60 bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="hidden sm:grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/15 ring-1 ring-primary/10 shrink-0">
            <Shield className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold tracking-tight text-foreground leading-none">Warranty Status</h2>
              <span className="inline-flex items-center rounded-full bg-primary/[0.08] border border-primary/10 px-2 py-0.5 text-xs font-semibold tracking-wide text-primary tabular-nums">
                {fmt(count)}
              </span>
              {rows && rows.length > 0 ? (
                <span className="hidden sm:inline-flex h-1 w-1 rounded-full bg-border shrink-0" aria-hidden />
              ) : null}
              {rows ? <span className="hidden sm:inline-flex"><WarrantyHeaderChips rows={rows} todayIso={todayIso} in30Iso={in30Iso} /></span> : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-1">Legacy serials table · expiry tracked via warranty_end_date</p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {view && onViewChange ? <CompactDetailedToggle value={view} onChange={onViewChange} /> : null}
          {actions}
        </div>
      </div>
      <div className="p-4 bg-muted/10">{children}</div>
    </Card>
  );
}

export function SerialCardShell({
  count,
  view,
  onViewChange,
  totalGood,
  totalBad,
  actions,
  children,
  className,
}: {
  count: number;
  view?: CompactDetailedView;
  onViewChange?: (v: CompactDetailedView) => void;
  totalGood?: number;
  totalBad?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-xl border-border/60 bg-card shadow-sm overflow-hidden", className)}>
      <div className="flex flex-col gap-3 border-b border-border/60 bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="hidden sm:grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/15 ring-1 ring-primary/10 shrink-0">
            <Hash className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold tracking-tight text-foreground leading-none">Serial Tracking</h2>
              <span className="inline-flex items-center rounded-full bg-primary/[0.08] border border-primary/10 px-2 py-0.5 text-xs font-semibold tracking-wide text-primary tabular-nums">
                {fmt(count)} model{count === 1 ? "" : "s"}
              </span>
              {typeof totalGood === "number" && typeof totalBad === "number" ? (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {fmt(totalGood)} good
                  <span className="mx-1 text-border">·</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> {fmt(totalBad)} defective
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-1">
              Grouped by Model No + Warehouse · Good/Bad pill flow · collapsible serial list
            </p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {view && onViewChange ? <CompactDetailedToggle value={view} onChange={onViewChange} /> : null}
          {actions}
        </div>
      </div>
      <div className="p-4 bg-muted/10">{children}</div>
    </Card>
  );
}

export default WarrantyViews;
