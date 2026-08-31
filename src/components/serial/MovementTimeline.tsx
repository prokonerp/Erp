import * as React from "react";
import {
  ArrowRight,
  ArrowLeftRight,
  Warehouse,
  Building2,
  Truck,
  Package,
  CalendarDays,
  Hash,
  Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Transaction, WarehouseLite } from "@/lib/ims";
import { resolveTxnType, TxnTypeBadge } from "@/components/serial/TransactionTypeBadge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxnCategory = "in" | "out" | "transfer" | "adjust";

export type TypeResolverResult = {
  label: string;
  icon: LucideIcon;
  badgeClass: string;
  category?: TxnCategory;
  variant?: string;
};

export type MovementTimelineProps = {
  /** Sorted or unsorted — component sorts ascending by txn_date/created_at */
  txns: Transaction[];
  /** Warehouse lookup: array, record map, or Map. Also accepts wMap from SerialTrack. */
  warehouses?: WarehouseLite[] | Record<string, WarehouseLite> | Map<string, WarehouseLite> | null;
  /** Override type resolver (e.g. custom rules). Fallback is resolveTxnType. */
  typeResolver?: (t: Transaction) => TypeResolverResult;
  className?: string;
  /** Dense table variant — default true. If false, uses timeline-card-only layout. */
  compact?: boolean;
};

// ---------------------------------------------------------------------------
// Warehouse name resolution
// ---------------------------------------------------------------------------

function buildWhMap(
  warehouses: MovementTimelineProps["warehouses"],
): Map<string, WarehouseLite> {
  if (!warehouses) return new Map();
  if (warehouses instanceof Map) return warehouses as Map<string, WarehouseLite>;
  if (Array.isArray(warehouses)) {
    return new Map(warehouses.map((w) => [w.id, w]));
  }
  // Record<string, WarehouseLite>
  return new Map(Object.entries(warehouses as Record<string, WarehouseLite>));
}

function whName(map: Map<string, WarehouseLite>, id: string | null | undefined): string | null {
  if (!id) return null;
  const wh = map.get(id);
  if (wh?.name) return wh.name;
  // fallback: raw id truncated (never show raw UUID prominently)
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

// ---------------------------------------------------------------------------
// WarehouseFlow — visual pill flow
// Spec: props {fromId, toId, fromParty, toParty, txnTypeCategory}
// Renders pill flow: In = external muted + emerald ArrowRight circle + warehouse navy/emerald pill
// Out = warehouse rose pill + rose ArrowRight circle + external blue pill
// Transfer = pill → pill amber; Adjust = single neutral pill
// ---------------------------------------------------------------------------

export type WarehouseFlowProps = {
  fromId?: string | null;
  toId?: string | null;
  /** Optional pre-resolved display names (takes precedence over id lookup) */
  fromName?: string | null;
  toName?: string | null;
  fromParty?: string | null;
  toParty?: string | null;
  category: TxnCategory;
  /** Optional warehouse map for id → name resolution (injected by parent) */
  warehouses?: MovementTimelineProps["warehouses"];
  /** Control size: 'sm' for table cell, 'md' for card */
  size?: "sm" | "md";
  className?: string;
};

const pillBase =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur whitespace-nowrap max-w-[160px] truncate";

const arrowCircleBase =
  "inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border shadow-sm shrink-0 transition-transform duration-200";

export function WarehouseFlow({
  fromId,
  toId,
  fromName,
  toName,
  fromParty,
  toParty,
  category,
  warehouses,
  size = "sm",
  className,
}: WarehouseFlowProps) {
  const map = React.useMemo(() => buildWhMap(warehouses), [warehouses]);

  const resolvedFromWh = fromName ?? whName(map, fromId);
  const resolvedToWh = toName ?? whName(map, toId);

  const hasFromWh = Boolean(resolvedFromWh || fromId);
  const hasToWh = Boolean(resolvedToWh || toId);

  // Determine external labels
  const externalFromLabel = fromParty?.trim() || "Opening Balance";
  const externalToLabel = toParty?.trim() || "External";

  // Choose arrow & pill theming by category/direction
  const isTransfer = category === "transfer" || (hasFromWh && hasToWh);
  const isIn = !isTransfer && hasToWh && !hasFromWh;
  const isOut = !isTransfer && hasFromWh && !hasToWh;
  const isAdjust = !hasFromWh && !hasToWh;

  // Arrow tint
  const arrowCls = isTransfer
    ? "bg-amber-500 border-amber-500 text-white"
    : isIn
      ? "bg-emerald-500 border-emerald-500 text-white"
      : isOut
        ? "bg-rose-500 border-rose-500 text-white"
        : "bg-slate-400 border-slate-300 text-white";

  const arrowIconSize = size === "sm" ? 11 : 12;

  // Pill tints — warehouse pills stay white with colored border/icon for Glacier theme fidelity
  const whPillAmber = "bg-amber-50/80 border-amber-200 text-amber-900";
  const whPillEmerald = "bg-emerald-50/80 border-emerald-200 text-emerald-900";
  const whPillRose = "bg-rose-50/70 border-rose-200 text-rose-900";
  const whPillNavy = "bg-white border-slate-200 text-slate-800";
  // external pills
  const extSlate = "bg-slate-50 border-slate-200 text-slate-600";
  const extBlue = "bg-blue-50 border-blue-200 text-blue-800";
  const extMuted = "bg-slate-50/80 border-slate-200 text-slate-500";

  if (isAdjust) {
    return (
      <span className={cn("inline-flex items-center", className)}>
        <span className={cn(pillBase, extMuted, "gap-1")}>
          <Package size={12} className="shrink-0 opacity-70" aria-hidden />
          <span className="truncate">Internal Adjustment</span>
        </span>
      </span>
    );
  }

  if (isTransfer && resolvedFromWh && resolvedToWh) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 group/flow", className)}>
        <span className={cn(pillBase, whPillAmber)}>
          <Warehouse size={12} className="shrink-0 text-amber-700" aria-hidden />
          <span className="truncate">{resolvedFromWh}</span>
        </span>
        <span className={cn(arrowCircleBase, arrowCls, "group-hover/flow:scale-110")}>
          <ArrowLeftRight size={arrowIconSize} aria-hidden />
        </span>
        <span className={cn(pillBase, whPillAmber)}>
          <Warehouse size={12} className="shrink-0 text-amber-700" aria-hidden />
          <span className="truncate">{resolvedToWh}</span>
        </span>
      </span>
    );
  }

  if (isIn && resolvedToWh) {
    // Incoming: external (muted) → warehouse (emerald accent)
    const needsExternalIcon = externalFromLabel.toLowerCase().includes("opening") ? Package : Building2;
    const ExtIcon = needsExternalIcon;
    return (
      <span className={cn("inline-flex items-center gap-1.5 group/flow", className)}>
        <span className={cn(pillBase, extSlate)}>
          <ExtIcon size={12} className="shrink-0 opacity-70" aria-hidden />
          <span className="truncate max-w-[110px]">{externalFromLabel}</span>
        </span>
        <span className={cn(arrowCircleBase, arrowCls, "group-hover/flow:translate-x-0.5")}>
          <ArrowRight size={arrowIconSize} aria-hidden />
        </span>
        <span className={cn(pillBase, whPillEmerald)}>
          <Warehouse size={12} className="shrink-0 text-emerald-700" aria-hidden />
          <span className="truncate">{resolvedToWh}</span>
        </span>
      </span>
    );
  }

  if (isOut && resolvedFromWh) {
    // Outgoing: warehouse (rose) → external (blue)
    const isTruck = /customer|site|project|engineer|ticket/i.test(externalToLabel);
    const ExtIcon2 = isTruck ? Truck : Building2;
    return (
      <span className={cn("inline-flex items-center gap-1.5 group/flow", className)}>
        <span className={cn(pillBase, whPillRose)}>
          <Warehouse size={12} className="shrink-0 text-rose-700" aria-hidden />
          <span className="truncate">{resolvedFromWh}</span>
        </span>
        <span className={cn(arrowCircleBase, arrowCls, "group-hover/flow:translate-x-0.5")}>
          <ArrowRight size={arrowIconSize} aria-hidden />
        </span>
        <span className={cn(pillBase, extBlue)}>
          <ExtIcon2 size={12} className="shrink-0" aria-hidden />
          <span className="truncate max-w-[130px]">{externalToLabel}</span>
        </span>
      </span>
    );
  }

  // Fallback: partial data — show whatever we have with navy pills
  if (resolvedFromWh || resolvedToWh) {
    const label = resolvedFromWh ?? resolvedToWh ?? "—";
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span className={cn(pillBase, whPillNavy)}>
          <Warehouse size={12} className="shrink-0 text-slate-500" aria-hidden />
          <span className="truncate">{label}</span>
        </span>
        <span className={cn(arrowCircleBase, arrowCls)}>
          <ArrowRight size={arrowIconSize} aria-hidden />
        </span>
        <span className={cn(pillBase, extMuted)}>{isIn ? externalFromLabel : externalToLabel}</span>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center text-xs text-muted-foreground", className)}>—</span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** CSV / export helper — stable label for a transaction (uses resolver cascade). */
export function getMovementLabel(t: Transaction, resolver?: MovementTimelineProps["typeResolver"]): string {
  if (resolver) {
    try {
      return resolver(t).label;
    } catch {
      // fall through
    }
  }
  return resolveTxnType(t).label;
}

/** Alias kept for SerialTrack import compatibility */
export const movementTypeLabel = getMovementLabel;
export const txnTypeLabel = getMovementLabel;

function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  return v.slice(0, 10);
}

function resolveCategory(
  t: Transaction,
  resolved: TypeResolverResult | ReturnType<typeof resolveTxnType>,
): TxnCategory {
  if (resolved.category) return resolved.category as TxnCategory;
  // infer from txn_type
  if (t.txn_type === "transfer_in" || t.txn_type === "transfer_out") return "transfer";
  if (t.txn_type === "stock_adjustment" || t.txn_type === "scrap_adjustment") return "adjust";
  if (t.txn_type.includes("_in") || t.txn_type === "oem_replacement_receipt") return "in";
  return "out";
}

// ---------------------------------------------------------------------------
// MovementTimeline — enriched table (desktop) + vertical timeline cards (mobile)
// ---------------------------------------------------------------------------

export const MovementTimeline: React.FC<MovementTimelineProps> = ({
  txns,
  warehouses,
  typeResolver,
  className,
}) => {
  const whMap = React.useMemo(() => buildWhMap(warehouses), [warehouses]);

  const sorted = React.useMemo(() => {
    return [...txns].sort((a, b) =>
      (a.txn_date || a.created_at || "").localeCompare(b.txn_date || b.created_at || ""),
    );
  }, [txns]);

  const partyOf = React.useCallback((t: Transaction) => t.to_party || t.from_party || "—", []);

  if (sorted.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-border/60 bg-white/60 backdrop-blur py-10 text-center",
          className,
        )}
      >
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 border border-slate-200">
          <Layers size={18} className="text-slate-400" aria-hidden />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-700">No movements yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Transactions for this serial will appear here as a visual flow.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* ── Desktop enriched table (>= sm) ── */}
      <div className="hidden sm:block overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm backdrop-blur">
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
                    <Hash size={13} className="text-slate-400" aria-hidden /> Voucher / Reference
                  </span>
                </th>
                <th className="p-2.5 font-semibold text-slate-600">Party</th>
                <th className="p-2.5 font-semibold text-slate-600">Warehouse Flow</th>
                <th className="p-2.5 font-semibold text-slate-600 text-right">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {sorted.map((t) => {
                const r: TypeResolverResult = typeResolver ? typeResolver(t) : resolveTxnType(t);
                const cat = resolveCategory(t, r as ReturnType<typeof resolveTxnType>);
                const Icon = r.icon;
                // Use TxnTypeBadge for fidelity when default resolver is in use; custom resolver uses inline badge
                const useDefaultBadge = !typeResolver;
                return (
                  <tr
                    key={t.id}
                    className="group/row hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="p-2.5 whitespace-nowrap text-slate-700 tabular-nums">
                      {formatDate(t.txn_date || t.created_at)}
                    </td>
                    <td className="p-2.5">
                      {useDefaultBadge ? (
                        <TxnTypeBadge txn={t} iconSize={12} />
                      ) : (
                        <Badge
                          variant="outline"
                          className={cn(
                            r.badgeClass,
                            "inline-flex items-center gap-1 font-medium whitespace-nowrap",
                          )}
                        >
                          <Icon size={12} className="shrink-0" aria-hidden />
                          <span>{r.label}</span>
                        </Badge>
                      )}
                    </td>
                    <td className="p-2.5 font-mono text-xs text-slate-700 max-w-[180px] truncate">
                      {t.txn_no || t.reference || "—"}
                    </td>
                    <td className="p-2.5 text-slate-700 max-w-[160px] truncate" title={partyOf(t)}>
                      {partyOf(t)}
                    </td>
                    <td className="p-2.5">
                      <WarehouseFlow
                        fromId={t.from_warehouse_id}
                        toId={t.to_warehouse_id}
                        fromParty={t.from_party}
                        toParty={t.to_party}
                        category={cat}
                        warehouses={whMap}
                        size="sm"
                      />
                    </td>
                    <td className="p-2.5 text-right tabular-nums">
                      <span
                        className={cn(
                          "inline-flex min-w-[2.25rem] justify-center rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm",
                          cat === "in"
                            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                            : cat === "out"
                              ? "bg-blue-50 border-blue-200 text-blue-800"
                              : cat === "transfer"
                                ? "bg-amber-50 border-amber-200 text-amber-800"
                                : "bg-slate-50 border-slate-200 text-slate-700",
                        )}
                      >
                        {t.qty}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mobile: vertical timeline cards (< sm) ── */}
      <div className="sm:hidden relative">
        {/* vertical spine */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-[15px] top-3 bottom-3 w-px bg-gradient-to-b from-emerald-200 via-amber-200 to-rose-200 opacity-70"
        />

        <div className="space-y-3">
          {sorted.map((t) => {
            const r: TypeResolverResult = typeResolver ? typeResolver(t) : resolveTxnType(t);
            const cat = resolveCategory(t, r as ReturnType<typeof resolveTxnType>);
            const Icon = r.icon;

            const dotCls =
              cat === "in"
                ? "bg-emerald-500 border-emerald-600 ring-emerald-200"
                : cat === "out"
                  ? "bg-rose-500 border-rose-500 ring-rose-200"
                  : cat === "transfer"
                    ? "bg-amber-500 border-amber-500 ring-amber-200"
                    : "bg-slate-400 border-slate-400 ring-slate-200";

            const cardRing =
              cat === "in"
                ? "hover:ring-emerald-200/60"
                : cat === "out"
                  ? "hover:ring-rose-200/60"
                  : cat === "transfer"
                    ? "hover:ring-amber-200/60"
                    : "hover:ring-slate-200/60";

            return (
              <div key={t.id} className="relative pl-9">
                {/* timeline node */}
                <span
                  className={cn(
                    "absolute left-0 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 bg-white shadow-sm ring-4",
                    dotCls,
                  )}
                >
                  <Icon size={13} className="text-white" aria-hidden />
                </span>

                <div
                  className={cn(
                    "rounded-xl border border-border/60 bg-white shadow-sm backdrop-blur p-3.5 transition-all hover:shadow-md hover:ring-2",
                    cardRing,
                  )}
                >
                  {/* card header: date + qty + type */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                          <CalendarDays size={12} className="text-slate-400" aria-hidden />
                          {formatDate(t.txn_date || t.created_at)}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="inline-flex items-center gap-1 font-mono text-xs text-slate-500">
                          <Hash size={11} className="text-slate-400" aria-hidden />
                          <span className="truncate max-w-[140px]">{t.txn_no || t.reference || "—"}</span>
                        </span>
                      </div>
                      <div className="mt-1.5">
                        {typeResolver ? (
                          <Badge
                            variant="outline"
                            className={cn(r.badgeClass, "inline-flex items-center gap-1 text-xs")}
                          >
                            <Icon size={11} className="shrink-0" aria-hidden />
                            {r.label}
                          </Badge>
                        ) : (
                          <TxnTypeBadge txn={t} iconSize={11} className="text-xs" />
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full border px-2.5 text-xs font-bold shadow-sm shrink-0",
                        cat === "in"
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : cat === "out"
                            ? "bg-blue-50 border-blue-200 text-blue-800"
                            : cat === "transfer"
                              ? "bg-amber-50 border-amber-200 text-amber-800"
                              : "bg-slate-50 border-slate-200 text-slate-700",
                      )}
                    >
                      ×{t.qty}
                    </span>
                  </div>

                  {/* party */}
                  <div className="mt-3 flex items-center gap-1.5 text-xs">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-50 border border-slate-200 shrink-0">
                      <Building2 size={12} className="text-slate-500" aria-hidden />
                    </span>
                    <span className="text-slate-500">Party</span>
                    <span className="font-medium text-slate-800 truncate">{partyOf(t)}</span>
                  </div>

                  {/* flow */}
                  <div className="mt-3 rounded-lg bg-[#F8FAFC] border border-slate-200/60 p-2.5">
                    <div className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase mb-1.5">
                      Warehouse Flow
                    </div>
                    <WarehouseFlow
                      fromId={t.from_warehouse_id}
                      toId={t.to_warehouse_id}
                      fromParty={t.from_party}
                      toParty={t.to_party}
                      category={cat}
                      warehouses={whMap}
                      size="md"
                      className="flex-wrap"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MovementTimeline;
