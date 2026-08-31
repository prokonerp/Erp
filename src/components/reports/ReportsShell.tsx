import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  Hash,
  Shield,
  X,
  Search,
  SlidersHorizontal,
} from "lucide-react";

// ---------------------------------------------------------------------------
// ReportsShell — shell polish for /reports (theme: Prokon Navy Premium)
// File is intentionally isolated: no edits to src/routes/_app/reports.tsx.
// Exports: ReportsPageHeader, ReportsFilters, ReportsTabsNav + helpers
// Tokens only: --primary (oklch 0.32 0.08 250), --secondary, --border #E2E8F0,
// --card, --muted, Glacier #F1F5F9 canvas.
// ---------------------------------------------------------------------------

// ── Page header ────────────────────────────────────────────────────────────

export type ReportsPageHeaderProps = {
  title?: string;
  description?: string;
  /** Optional right-side actions (e.g. ExportButtons) */
  actions?: React.ReactNode;
  /** Optional breadcrumb trail — keep simple premium, first item muted */
  breadcrumbs?: string[];
  className?: string;
};

export function ReportsPageHeader({
  title = "Stock & Serial Reports",
  description = "Track inventory by warehouse, serial movement, and warranty status.",
  actions,
  breadcrumbs,
  className,
}: ReportsPageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-[11px] tracking-wide text-muted-foreground">
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={`${b}-${i}`}>
                {i > 0 && <span className="text-border" aria-hidden>/</span>}
                <span className={i === breadcrumbs.length - 1 ? "font-medium text-foreground" : ""}>{b}</span>
              </React.Fragment>
            ))}
          </nav>
        ) : null}
        <h1 className="text-[22px] font-bold tracking-tight text-foreground leading-none">
          {title}
        </h1>
        {/* subtle navy underline accent */}
        <div className="mt-2 h-1 w-12 rounded-full bg-primary" aria-hidden />
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground max-w-[640px]">
          {description}
        </p>
      </div>
      {actions ? <div className="shrink-0 flex items-center gap-2 self-start sm:self-center">{actions}</div> : null}
    </div>
  );
}

// ── Filters card ───────────────────────────────────────────────────────────

export type ReportsFiltersProps = {
  warehouses: { id: string; name: string; code?: string | null }[];
  stockProducts: { key: string; label: string }[];
  wh: string;
  prod: string;
  q: string;
  onWhChange: (v: string) => void;
  onProdChange: (v: string) => void;
  onQChange: (v: string) => void;
  /** Called when Clear all / chip × pressed. If omitted, clearing is delegated to the three setters */
  onClearAll?: () => void;
  /** Total filtered rows / SKUs — shown as “Showing 12 SKUs” */
  resultsCount?: number;
  resultsLabel?: string;
  className?: string;
};

function warehouseChipLabel(
  wh: string,
  warehouses: ReportsFiltersProps["warehouses"],
): string {
  if (wh === "__all") return "";
  const w = warehouses.find((x) => x.id === wh);
  if (!w) return wh.slice(0, 8);
  return w.code ? `${w.code}` : w.name;
}

function productChipLabel(prod: string, stockProducts: ReportsFiltersProps["stockProducts"]): string {
  if (prod === "__all") return "";
  const p = stockProducts.find((x) => x.key === prod);
  return p?.label ?? prod.slice(0, 12);
}

export function ReportsFilters({
  warehouses,
  stockProducts,
  wh,
  prod,
  q,
  onWhChange,
  onProdChange,
  onQChange,
  onClearAll,
  resultsCount,
  resultsLabel = "SKUs",
  className,
}: ReportsFiltersProps) {
  const hasActive = wh !== "__all" || prod !== "__all" || q.trim().length > 0;

  const handleClearAll = React.useCallback(() => {
    if (onClearAll) onClearAll();
    else {
      onWhChange("__all");
      onProdChange("__all");
      onQChange("");
    }
  }, [onClearAll, onWhChange, onProdChange, onQChange]);

  const whLabel = warehouseChipLabel(wh, warehouses);
  const prodLabel = productChipLabel(prod, stockProducts);

  return (
    <Card className={cn("rounded-xl border-border/60 bg-card shadow-sm overflow-hidden", className)}>
      <CardContent className="p-4 sm:p-5">
        {/* fields row — compact enterprise density, responsive */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-3">
          {/* Warehouse */}
          <div className="sm:w-[200px] shrink-0">
            <label className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5">
              Warehouse
            </label>
            <Select value={wh} onValueChange={onWhChange}>
              <SelectTrigger className="h-9 w-full bg-card border-border text-[13px] focus:ring-primary/20 focus:border-primary/30 shadow-sm">
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All warehouses</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.code ? `${w.code} — ` : ""}
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Product */}
          <div className="sm:w-[200px] shrink-0">
            <label className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5">
              Product
            </label>
            <Select value={prod} onValueChange={onProdChange}>
              <SelectTrigger className="h-9 w-full bg-card border-border text-[13px] focus:ring-primary/20 focus:border-primary/30 shadow-sm">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All products</SelectItem>
                {stockProducts.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search — grows */}
          <div className="flex-1 min-w-0">
            <label className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden />
              <Input
                placeholder="Serial / product / customer / invoice…"
                value={q}
                onChange={(e) => onQChange(e.target.value)}
                className="h-9 pl-9 bg-card border-border text-[13px] placeholder:text-muted-foreground/50 focus-visible:ring-primary/20 focus-visible:border-primary/30 shadow-sm"
              />
            </div>
          </div>

          {/* subtle filter affordance on desktop */}
          <div className="hidden sm:flex h-9 items-center gap-1.5 text-muted-foreground/60 shrink-0 pl-1" aria-hidden>
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </div>
        </div>

        {/* active chips + results count */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {hasActive ? (
            <>
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground mr-1 hidden sm:inline">Filters:</span>
              {wh !== "__all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/[0.06] pl-2.5 pr-1 py-1 text-xs font-medium leading-none text-primary">
                  {whLabel}
                  <button
                    type="button"
                    aria-label="Clear warehouse filter"
                    onClick={() => onWhChange("__all")}
                    className="grid h-5 w-5 place-items-center rounded-full hover:bg-primary/10 transition-colors cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {prod !== "__all" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-secondary/15 bg-secondary/[0.07] pl-2.5 pr-1 py-1 text-xs font-medium leading-none text-secondary">
                  {prodLabel}
                  <button
                    type="button"
                    aria-label="Clear product filter"
                    onClick={() => onProdChange("__all")}
                    className="grid h-5 w-5 place-items-center rounded-full hover:bg-secondary/10 transition-colors cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {q.trim() ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted pl-2.5 pr-1 py-1 text-xs font-medium leading-none text-foreground max-w-[220px]">
                  <span className="truncate">“{q.trim().slice(0, 32)}{q.trim().length > 32 ? "…" : ""}”</span>
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => onQChange("")}
                    className="grid h-5 w-5 place-items-center rounded-full hover:bg-foreground/5 transition-colors cursor-pointer shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : null}
              <button
                type="button"
                onClick={handleClearAll}
                className="ml-1 text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground/30 transition-colors cursor-pointer"
              >
                Clear all
              </button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground/70">No filters — showing everything</span>
          )}

          {typeof resultsCount === "number" && (
            <span className="ml-auto inline-flex items-center rounded-full bg-muted border border-border px-2.5 py-1 text-xs font-medium leading-none text-muted-foreground tabular-nums">
              Showing {resultsCount.toLocaleString("en-IN")} {resultsLabel}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tabs — pill segmented, theme-matched ─────────────────────────────────

export type ReportsTabsNavProps = {
  /** Optional counts shown as subtle pills inside each trigger */
  counts?: { stock?: number; serials?: number; warranty?: number };
  className?: string;
};

export function ReportsTabsNav({ counts, className }: ReportsTabsNavProps) {
  const pill = "min-w-5 justify-center rounded-full bg-foreground/5 border border-border px-1.5 py-0 text-[11px] font-semibold leading-none tabular-nums data-[state=active]:bg-primary/10 data-[state=active]:border-primary/15 data-[state=active]:text-primary";
  // We use a small span for count so trigger text stays primary-colour aware via data-state
  return (
    <TabsList
      className={cn(
        "inline-flex h-auto items-center gap-1 rounded-full bg-muted p-1 text-muted-foreground border border-border/40 shadow-inner",
        className,
      )}
    >
      <TabsTrigger
        value="stock"
        className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium leading-none transition-all duration-150 data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border/40 cursor-pointer focus-visible:ring-primary/20"
      >
        <LayoutGrid className="h-3.5 w-3.5 opacity-70 data-[state=active]:opacity-100" aria-hidden />
        Stock by Warehouse
        {typeof counts?.stock === "number" && (
          <span className={cn("ml-1 inline-flex items-center", pill)} aria-label={`${counts.stock} SKUs`}>
            {counts.stock}
          </span>
        )}
      </TabsTrigger>
      <TabsTrigger
        value="serials"
        className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium leading-none transition-all duration-150 data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border/40 cursor-pointer focus-visible:ring-primary/20"
      >
        <Hash className="h-3.5 w-3.5 opacity-70" aria-hidden />
        Serial Tracking
        {typeof counts?.serials === "number" && (
          <span className={cn("ml-1 inline-flex items-center", pill)}>{counts.serials}</span>
        )}
      </TabsTrigger>
      <TabsTrigger
        value="warranty"
        className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium leading-none transition-all duration-150 data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border/40 cursor-pointer focus-visible:ring-primary/20"
      >
        <Shield className="h-3.5 w-3.5 opacity-70" aria-hidden />
        Warranty Status
        {typeof counts?.warranty === "number" && (
          <span className={cn("ml-1 inline-flex items-center", pill)}>{counts.warranty}</span>
        )}
      </TabsTrigger>
    </TabsList>
  );
}

// ── Generic card shell for Warranty (and any tab content) ─────────────────
// Theme-matched Card chrome: rounded-xl border-border/60 bg-card shadow-sm

export type ReportsCardProps = {
  title: string;
  count?: number;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function ReportsCard({
  title,
  count,
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
}: ReportsCardProps) {
  return (
    <Card className={cn("rounded-xl border-border/60 bg-card shadow-sm overflow-hidden", className)}>
      <div className="flex flex-col gap-3 border-b border-border/60 bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          {Icon ? (
            <span className="hidden sm:grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/15 ring-1 ring-primary/10 shrink-0">
              <Icon className="h-4 w-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold tracking-tight text-foreground leading-none">{title}</h2>
              {typeof count === "number" && (
                <span className="inline-flex items-center rounded-full bg-primary/[0.08] border border-primary/10 px-2 py-0.5 text-xs font-semibold tracking-wide text-primary tabular-nums">
                  {count.toLocaleString("en-IN")}
                </span>
              )}
            </div>
            {subtitle ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-1">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="shrink-0 flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-0">{children}</div>
    </Card>
  );
}

/** Convenience preset for the Warranty tab — same chrome, Shield icon + default subtitle */
export function ReportsWarrantyShell({
  count,
  actions,
  children,
  className,
}: {
  count: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ReportsCard
      title="Warranty Status"
      count={count}
      subtitle="Legacy serials table · expiry tracked via warranty_end_date"
      icon={Shield}
      actions={actions}
      className={className}
    >
      {children}
    </ReportsCard>
  );
}

export default ReportsFilters;
