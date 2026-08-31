import * as React from "react";
import { Boxes, ShieldCheck, TriangleAlert, Warehouse } from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Stock by Warehouse — Premium KPI + Header
// Theme: Prokon Navy Premium (Glacier bg, Navy #1E3A5F primary)
// Tailwind v4 tokens: bg-primary, bg-card, border-border/60, text-muted-foreground
// Anti-slop: no purple gradients, no 3-equal generic cards, tight Inter typography
// ─────────────────────────────────────────────────────────────

export type StockGroup = {
  warehouse: string;
  product: string;
  oem: string;
  good: number;
  defective: number;
  qty: number;
};

// ── KPI ──────────────────────────────────────────────────────

type KpiItem = {
  label: string;
  value: number;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  // visual
  bar: string; // left accent
  iconWrap: string;
  iconFg: string;
  valueCls: string;
  gradient: string;
};

export function StockWarehouseKpis({ groups }: { groups: StockGroup[] }) {
  const totals = React.useMemo(() => {
    const total = groups.reduce((s, g) => s + g.qty, 0);
    const good = groups.reduce((s, g) => s + g.good, 0);
    const defective = groups.reduce((s, g) => s + g.defective, 0);
    const whSet = new Set(groups.map((g) => g.warehouse));
    return {
      total,
      good,
      defective,
      warehouses: whSet.size,
      skus: groups.length,
    };
  }, [groups]);

  const fmt = (n: number) => n.toLocaleString("en-IN");

  const items: KpiItem[] = [
    {
      label: "Total Available",
      value: totals.total,
      hint: `${fmt(totals.skus)} SKUs · across ${fmt(totals.warehouses)} warehouses`,
      icon: Boxes,
      bar: "bg-primary",
      iconWrap: "bg-primary text-primary-foreground shadow-sm shadow-primary/20 ring-1 ring-primary/10",
      iconFg: "",
      valueCls: "text-foreground",
      gradient: "from-primary/[0.07] via-primary/[0.03] to-transparent",
    },
    {
      label: "Good Stock",
      value: totals.good,
      hint: totals.total ? `${Math.round((totals.good / totals.total) * 100)}% of available` : "Ready to issue",
      icon: ShieldCheck,
      bar: "bg-emerald-500",
      iconWrap: "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 ring-1 ring-emerald-600/10",
      iconFg: "",
      valueCls: "text-emerald-700",
      gradient: "from-emerald-500/[0.08] via-emerald-500/[0.03] to-transparent",
    },
    {
      label: "Defective",
      value: totals.defective,
      hint: totals.defective ? "Needs QC / return" : "No defective stock",
      icon: TriangleAlert,
      bar: "bg-rose-500",
      iconWrap: "bg-rose-500 text-white shadow-sm shadow-rose-500/20 ring-1 ring-rose-600/10",
      iconFg: "",
      valueCls: "text-rose-700",
      gradient: "from-rose-500/[0.08] via-rose-500/[0.03] to-transparent",
    },
    {
      label: "Warehouses",
      value: totals.warehouses,
      hint: `${fmt(totals.skus)} SKU groups`,
      icon: Warehouse,
      bar: "bg-slate-400",
      iconWrap: "bg-slate-900 text-white shadow-sm ring-1 ring-slate-900/10 dark:bg-white dark:text-slate-900",
      iconFg: "",
      valueCls: "text-foreground",
      gradient: "from-slate-500/[0.06] via-slate-500/[0.02] to-transparent",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((it) => {
        const Icon = it.icon;
        const isWarehouses = it.label === "Warehouses";
        return (
          <div
            key={it.label}
            className="relative overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm hover:shadow-md transition-shadow"
          >
            {/* left accent bar */}
            <div className={`absolute left-0 top-0 h-full w-[3px] ${it.bar}`} aria-hidden />

            {/* subtle gradient wash */}
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${it.gradient}`} aria-hidden />

            {/* decorative corner glow */}
            <div
              className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.045]"
              style={{ background: "radial-gradient(circle at center, var(--primary) 0%, transparent 70%)" }}
              aria-hidden
            />

            <div className="relative p-4 pl-5 pr-4">
              {/* top row: label + icon */}
              <div className="flex items-start justify-between gap-3">
                <p className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground leading-none pt-1.5">
                  {it.label}
                </p>
                <span className={`grid h-9 w-9 place-items-center rounded-xl shrink-0 ${it.iconWrap}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
              </div>

              {/* value */}
              <div className="mt-3 flex items-baseline gap-2">
                <span className={`text-[26px] font-bold leading-none tracking-tight tabular-nums ${it.valueCls}`}>
                  {fmt(it.value)}
                </span>
                {isWarehouses && totals.skus > 0 && (
                  <span className="inline-flex items-center rounded-full bg-muted border border-border px-2 py-0.5 text-[11px] font-semibold leading-none text-muted-foreground tabular-nums">
                    {fmt(totals.skus)} SKUs
                  </span>
                )}
              </div>

              {/* hint */}
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground line-clamp-1">
                {it.hint}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Header (drop-in for CardHeader) ─────────────────────────

export function StockWarehouseHeader({
  count,
  children,
  subtitle = "Available stock grouped by warehouse and product · good vs defective split",
}: {
  count: number;
  children?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/60 bg-card px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 rounded-t-xl">
      <div className="flex items-start gap-3.5 min-w-0">
        {/* icon */}
        <span className="hidden sm:grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/20 ring-1 ring-primary/10 shrink-0">
          <Warehouse className="h-5 w-5" />
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground leading-none">
              Stock by Warehouse
            </h2>
            <span className="inline-flex items-center rounded-full bg-primary/[0.08] border border-primary/10 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-primary tabular-nums">
              {count.toLocaleString("en-IN")} {count === 1 ? "SKU" : "SKUs"}
            </span>
            <span className="hidden sm:inline-flex h-1 w-1 rounded-full bg-border shrink-0" aria-hidden />
            <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              good
              <span className="mx-1 text-border">·</span>
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden />
              defective
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground max-w-[560px] line-clamp-2 sm:line-clamp-1">
            {subtitle}
          </p>
        </div>
      </div>

      {children ? <div className="shrink-0 flex items-center gap-2 sm:justify-end">{children}</div> : null}
    </div>
  );
}
