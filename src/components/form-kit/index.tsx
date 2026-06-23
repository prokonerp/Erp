import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { ChevronDown, Rows3, Rows4 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/* ---------- Density ---------- */
type Density = "comfortable" | "compact";
const DensityCtx = createContext<{
  density: Density;
  setDensity: (d: Density) => void;
}>({ density: "comfortable", setDensity: () => {} });

export function useFormDensity() {
  return useContext(DensityCtx);
}

function DensityToggle() {
  const { density, setDensity } = useFormDensity();
  const next: Density = density === "compact" ? "comfortable" : "compact";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => setDensity(next)}
      title={`Switch to ${next} mode`}
    >
      {density === "compact" ? <Rows3 className="h-3.5 w-3.5" /> : <Rows4 className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline text-xs capitalize">{density}</span>
    </Button>
  );
}

/* ---------- FormShell ---------- */
type ShellProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  storageKey?: string;
};
export function FormShell({
  title,
  description,
  actions,
  children,
  storageKey = "form-density",
}: ShellProps) {
  const [density, setDensityState] = useState<Density>("comfortable");
  useEffect(() => {
    const saved = (typeof window !== "undefined" && (window.localStorage.getItem(storageKey) as Density)) || null;
    if (saved === "compact" || saved === "comfortable") setDensityState(saved);
  }, [storageKey]);
  const setDensity = (d: Density) => {
    setDensityState(d);
    try { window.localStorage.setItem(storageKey, d); } catch {}
  };

  return (
    <DensityCtx.Provider value={{ density, setDensity }}>
      <div data-density={density} className="fk-shell">
        <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-background/85 backdrop-blur border-b border-border/60">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold leading-tight truncate">{title}</h1>
              {description ? (
                <p className="text-xs sm:text-sm text-muted-foreground truncate">{description}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <DensityToggle />
              {actions}
            </div>
          </div>
        </div>
        <div className="space-y-[var(--form-section-gap)] pb-24 sm:pb-4">{children}</div>
      </div>
    </DensityCtx.Provider>
  );
}

/* ---------- FormSection (collapsible card) ---------- */
type SectionProps = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
};
export function FormSection({
  title,
  description,
  defaultOpen = false,
  right,
  children,
  className,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("fk-section", className)}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 min-w-0 text-left flex-1 group"
            aria-label={`Toggle ${title} section`}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                open ? "" : "-rotate-90"
              )}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{title}</div>
              {description ? (
                <div className="text-xs text-muted-foreground truncate">{description}</div>
              ) : null}
            </div>
          </button>
        </CollapsibleTrigger>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <CollapsibleContent>
        <div className="px-4 pb-4 pt-1 border-t border-border/50">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ---------- FormGrid ----------
 * Default: 12-col responsive grid (use FormField size for widths).
 * Pass `auto` to switch to auto-packing CSS grid that fits as many
 * fields per row as their min widths allow (ERP-style density).
 */
export function FormGrid({
  children,
  className,
  auto = false,
}: {
  children: ReactNode;
  className?: string;
  auto?: boolean;
}) {
  return <div className={cn(auto ? "fk-grid-auto" : "fk-grid", className)}>{children}</div>;
}

/* ---------- FormField ---------- */
type FieldSize = "xs" | "sm" | "md" | "lg" | "xl" | "full";
/*
 * Intelligent width allocation on a 12-col grid:
 *   xs   ~ 100-120px  (Qty, UOM, Tax%, Status, Priority)
 *   sm   ~ 150-180px  (Ticket No, PO No, Asset ID, Category, Type, Dates)
 *   md   ~ 220-280px  (Customer/Vendor/Contact/Location/Assigned To)
 *   lg   ~ 1/2 row    (Address line, long ref)
 *   xl   ~ 2/3 row    (Long single-line text)
 *   full              (Description, Remarks, Notes, Specifications)
 * Desktop targets 4–6 fields per row; tablet 3–4; mobile 1–2.
 */
const sizeCls: Record<FieldSize, string> = {
  // Fixed pixel widths — ERP-density. Wrap to next line automatically.
  xs:   "fk-col fk-col-xs",   // ~100px  (Qty, UOM, Tax%, Status, Priority)
  sm:   "fk-col fk-col-sm",   // ~140px  (Dates, Doc No, IDs, Codes)
  md:   "fk-col fk-col-md",   // ~200px  (Customer/Vendor/Contact)
  lg:   "fk-col fk-col-lg",   // ~280px  (Address line, long ref)
  xl:   "fk-col fk-col-xl",   // ~420px  (Long single-line text)
  full: "fk-col fk-col-full", // 100% row
};

type FieldProps = {
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  size?: FieldSize;
  className?: string;
  children: ReactNode;
};
export function FormField({
  label,
  required,
  hint,
  error,
  size = "md",
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn(sizeCls[size], "min-w-0 space-y-1", className)}>
      {label ? (
        <Label className="text-xs font-medium text-muted-foreground">
          {label}
          {required ? <span className="text-destructive ml-0.5">*</span> : null}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/* ---------- StickyMobileActions ----------
 * Fixed bottom action bar shown only on small screens.
 */
export function StickyMobileActions({ children }: { children: ReactNode }) {
  return (
    <div className="sm:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur px-3 py-2 flex gap-2 justify-end">
      {children}
    </div>
  );
}