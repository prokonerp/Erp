import * as React from "react";
import { Search, Package, Factory, Warehouse, Hash, Truck, Activity, Wrench, Download, X, Sparkles, Clock3, ExternalLink, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StockStatusBadge } from "@/components/StockStatusBadge";
import type { StockStatus, StockType } from "@/lib/ims";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getTxnDocMeta } from "@/lib/txnDocument";

// ---------------------------------------------------------------------------
// SerialSearchHero — premium search bar inside Card
// ---------------------------------------------------------------------------

export type SerialSearchHeroProps = {
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  /** Hint line below input e.g. '1 match(es) for “0H2…”' — pass '' to hide */
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Optional recent searches to show as chips */
  recentSerials?: string[];
  onPickRecent?: (serial: string) => void;
  className?: string;
};

export function SerialSearchHero({
  value,
  onChange,
  loading = false,
  hint,
  placeholder = "Type any serial…",
  autoFocus = true,
  recentSerials,
  onPickRecent,
  className,
}: SerialSearchHeroProps) {
  const showRecent = Boolean(recentSerials && recentSerials.length > 0);

  return (
    <Card className={cn("overflow-hidden rounded-xl border-border/60 bg-card shadow-sm", className)}>
      {/* subtle top hairline accent — ties to SerialHeaderCard */}
      <div aria-hidden className="h-[2px] w-full bg-gradient-to-r from-primary via-secondary to-primary/40" />
      <CardContent className="p-4 sm:p-5">
        {/* kicker */}
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Sparkles size={13} aria-hidden />
          </span>
          <div>
            <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase leading-none">
              Global Serial Search
            </div>
            <div className="text-[12px] font-medium text-slate-700 leading-none mt-0.5">Find any serial across IMS + service</div>
          </div>
        </div>

        <div className="relative max-w-[640px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            name="q"
            autoComplete="off"
            spellCheck={false}
            className={cn(
              "h-11 w-full !max-w-none rounded-xl border-border bg-white pl-10 pr-9 text-[14px] shadow-sm",
              "placeholder:text-muted-foreground/70",
              "focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/30 focus-visible:outline-none",
              "transition-colors",
            )}
          />
          {value ? (
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 border border-slate-200 text-slate-500 hover:bg-white hover:text-slate-700 transition-colors"
            >
              <X size={13} aria-hidden />
            </button>
          ) : null}
        </div>

        {/* hint line */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2 min-h-[18px]">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-primary" aria-hidden />
              Searching…
            </span>
          ) : hint ? (
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-slate-700">{hint}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Type a serial number to search — supports partial match</span>
          )}
        </div>

        {/* recent chips */}
        {showRecent && onPickRecent ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-widest uppercase text-muted-foreground mr-1">
              <Clock3 size={11} aria-hidden /> Recent
            </span>
            {recentSerials!.slice(0, 6).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPickRecent(s)}
                className="inline-flex max-w-[160px] truncate rounded-full border border-border bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:border-primary/20 hover:text-primary transition-colors"
                title={s}
              >
                <span className="font-mono truncate">{s}</span>
              </button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SerialHeaderCard — mono serial + status + type + meta grid + issued band
// ---------------------------------------------------------------------------

export type SerialHeaderCardProps = {
  serial: string;
  stockStatus: StockStatus;
  stockType?: StockType;
  /** Product / Model display string — fallback chain already resolved by caller */
  productLabel: string;
  oemLabel?: string | null;
  warehouseLabel?: string | null;
  qty: number;
  /** Issued destination resolved from latest good_out / defective_out */
  issuedTo?: { party: string; reference?: string | null } | null;
  className?: string;
};

function StockTypeBadge({ type }: { type?: StockType }) {
  if (!type) return null;
  const isGood = type === "good";
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm",
        isGood
          ? "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-50"
          : "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-50",
      )}
    >
      {isGood ? "Good" : "Defective"}
    </Badge>
  );
}

type MetaItemProps = {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: "slate" | "primary" | "emerald" | "amber";
};

function MetaItem({ icon: Icon, label, value, tone = "slate" }: MetaItemProps) {
  const toneMap: Record<string, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-600",
    primary: "bg-primary/10 border-primary/20 text-primary",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
  };
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-sm", toneMap[tone])}>
        <Icon size={14} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground leading-none">{label}</div>
        <div className="mt-1 truncate text-[13px] font-semibold leading-none text-slate-800" title={String(value)}>
          {value ?? "—"}
        </div>
      </div>
    </div>
  );
}

function IssuedToBand({ party, reference }: { party: string; reference?: string | null }) {
  const navigate = useNavigate();
  const [loading, setLoading] = React.useState(false);
  const meta = React.useMemo(() => {
    if (!reference) return null;
    // Reuse the same preference logic: treat reference string as document number when possible
    // Build a fake Transaction to leverage getTxnDocMeta's parsing.
    return getTxnDocMeta({ reference, txn_no: null } as unknown as import("@/lib/ims").Transaction);
  }, [reference]);
  const isClickable = !!meta?.docType && !!meta?.docNo;
  const handleClick = React.useCallback(async () => {
    if (!isClickable || !meta?.docNo || !meta?.docType) return;
    setLoading(true);
    try {
      const sb = supabase as unknown as { from: (t: string) => any };
      const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      if (meta.docType === "dc") {
        const { data } = await sb.from("delivery_challans").select("id").eq("challan_no", meta.docNo).maybeSingle();
        if (data?.id) navigate({ to: "/challan/$id", params: { id: data.id } } as any);
        else toast.error(`Delivery Challan ${meta.docNo} not found`);
      } else if (meta.docType === "grn") {
        let found: { id: string } | null = null;
        if (isUuid(meta.docNo)) {
          const { data } = await sb.from("grns").select("id").eq("id", meta.docNo).maybeSingle();
          if (data?.id) found = data as { id: string };
        }
        if (!found) {
          const { data } = await sb.from("grns").select("id").eq("grn_no", meta.docNo).maybeSingle();
          if (data?.id) found = data as { id: string };
        }
        if (found?.id) navigate({ to: "/grn/$id", params: { id: found.id } } as any);
        else toast.error(`GRN ${meta.docNo} not found`);
      } else if (meta.docType === "gdc") {
        const { data } = await sb.from("general_delivery_challans").select("id").eq("dc_no", meta.docNo).maybeSingle();
        if (data?.id) navigate({ to: "/sales/general-dc/$id", params: { id: data.id } } as any);
        else toast.error(`General DC ${meta.docNo} not found`);
      } else if (meta.docType === "invoice") {
        const { data } = await sb.from("invoices").select("id").eq("invoice_no", meta.docNo).maybeSingle();
        if (data?.id) navigate({ to: "/sales/invoices/$id", params: { id: data.id } } as any);
        else toast.error(`Invoice ${meta.docNo} not found`);
      } else if (meta.docType === "transfer") {
        const tid = (meta as unknown as { transferId?: string | null }).transferId;
        if (tid) navigate({ to: "/ims/transfers/$id", params: { id: tid } } as any);
        else if (meta.docNo) {
          const { data } = await sb.from("ims_transfers").select("id").eq("transfer_no", meta.docNo).maybeSingle();
          if (data?.id) navigate({ to: "/ims/transfers/$id", params: { id: data.id } } as any);
          else toast.error(`Transfer ${meta.docNo} not found`);
        }
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to open document");
    } finally {
      setLoading(false);
    }
  }, [isClickable, meta, navigate]);

  return (
    <div className="flex items-center gap-3 border-t border-border/60 bg-muted/20 px-4 sm:px-5 py-3">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 border border-blue-200 text-blue-700 shadow-sm">
        <Truck size={14} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-muted-foreground leading-none">Issued to</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-slate-800 truncate max-w-[260px]" title={party}>
            {party || "—"}
          </span>
          {reference ? (
            isClickable ? (
              <button
                type="button"
                onClick={handleClick}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-xs font-mono font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 shadow-sm transition-colors"
                title={`${reference} — click to open`}
              >
                {loading ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} className="opacity-60" />}
                <span>· {reference}</span>
              </button>
            ) : (
              <span className="text-xs text-muted-foreground truncate" title={reference}>
                · {reference}
              </span>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SerialHeaderCard({
  serial,
  stockStatus,
  stockType,
  productLabel,
  oemLabel,
  warehouseLabel,
  qty,
  issuedTo,
  className,
}: SerialHeaderCardProps) {
  const hasIssued = Boolean(issuedTo && (stockStatus === "issued" || stockStatus === "returned_to_oem"));

  return (
    <Card className={cn("overflow-hidden rounded-xl border-border/60 bg-white shadow-sm", className)}>
      {/* accent top border */}
      <div aria-hidden className="h-[3px] w-full bg-gradient-to-r from-primary via-secondary to-accent" />

      {/* header row: mono serial + badges */}
      <div className="px-4 sm:px-5 pt-4 pb-3 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[15px] sm:text-[16px] font-bold tracking-tight text-slate-900 break-all">{serial}</span>
        <span className="inline-flex items-center gap-1.5 flex-wrap">
          <StockStatusBadge status={stockStatus} type={stockType} />
          <StockTypeBadge type={stockType} />
        </span>
      </div>

      {/* meta grid */}
      <div className="px-4 sm:px-5 pb-4">
        <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
          <MetaItem icon={Package} label="Product / Model" value={productLabel || "—"} tone="slate" />
          <MetaItem icon={Factory} label="OEM" value={oemLabel || "—"} tone="slate" />
          <MetaItem icon={Warehouse} label="Warehouse" value={warehouseLabel || "—"} tone="primary" />
          <MetaItem icon={Hash} label="Qty" value={String(qty)} tone="emerald" />
        </div>
      </div>

      {/* issued band */}
      {hasIssued && issuedTo ? (
        <IssuedToBand party={issuedTo.party} reference={issuedTo.reference} />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SectionHeader — title + icon circle + count pill + Download CSV action
// ---------------------------------------------------------------------------

export type SectionHeaderProps = {
  title: string;
  count: number;
  /** Activity for Movement, Wrench for Service — or any LucideIcon */
  icon?: LucideIcon;
  /** Visual variant for the count pill */
  countVariant?: "primary" | "secondary" | "neutral";
  onDownload?: () => void;
  downloadDisabled?: boolean;
  downloadLabel?: string;
  className?: string;
};

const sectionIconMap: Record<string, LucideIcon> = {
  movement: Activity,
  service: Wrench,
};

export function SectionHeader({
  title,
  count,
  icon,
  countVariant = "primary",
  onDownload,
  downloadDisabled = false,
  downloadLabel = "Download CSV",
  className,
}: SectionHeaderProps) {
  // Resolve icon: explicit > keyword in title > Activity fallback
  const ResolvedIcon: LucideIcon =
    icon ||
    (title.toLowerCase().includes("service") ? Wrench : title.toLowerCase().includes("movement") ? Activity : Activity);

  // Keep for potential custom mapping consumers, silences unused warning if lint checks it
  void sectionIconMap;

  const pillCls =
    countVariant === "secondary"
      ? "bg-secondary text-secondary-foreground border-secondary"
      : countVariant === "neutral"
        ? "bg-slate-100 text-slate-700 border-slate-200"
        : "bg-primary text-primary-foreground border-primary";

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm border border-primary">
          <ResolvedIcon size={14} aria-hidden />
        </span>
        <h3 className="text-sm font-semibold tracking-tight text-slate-800 truncate">{title}</h3>
        <span
          className={cn(
            "inline-flex min-w-[28px] justify-center rounded-full border px-2 py-0.5 text-xs font-bold shadow-sm tabular-nums",
            pillCls,
          )}
          aria-label={`${count} items`}
        >
          {count}
        </span>
      </div>

      {onDownload ? (
        <Button
          variant="outline"
          size="sm"
          disabled={downloadDisabled}
          onClick={onDownload}
          className="h-8 rounded-full border-border bg-white px-3.5 text-xs font-medium shadow-sm hover:bg-slate-50 disabled:opacity-50 gap-1.5"
        >
          <Download size={13} aria-hidden />
          {downloadLabel}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Optional page-shell wrapper for ergonomic composition (not required by spec
// but handy for new callers). Keep independent — no coupling to page state.
// ---------------------------------------------------------------------------

export type SerialTrackShellProps = {
  search: React.ReactNode;
  header?: React.ReactNode | null;
  movement?: React.ReactNode | null;
  service?: React.ReactNode | null;
  className?: string;
};

export function SerialTrackShell({ search, header, movement, service, className }: SerialTrackShellProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {search}
      {header}
      {movement}
      {service}
    </div>
  );
}

export default SerialTrackShell;
