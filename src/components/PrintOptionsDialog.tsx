import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deriveHeaderFromSerials,
  deriveHeaderFromWarehouseIds,
  getLastUsedSource,
  isProfileIncomplete,
  listHeaderSources,
  profileIssues,
  resolveHeader,
  setLastUsedSource,
  type HeaderSource,
  type HeaderSourceKind,
  type HeaderSourceOption,
  type ProfileHealthInput,
  type ResolvedHeader,
} from "@/lib/documentHeader";

export interface PrintChoice {
  source: HeaderSource;
  header: ResolvedHeader;
  copyLabel: string;
  showSupplyFrom: boolean;
}

export interface AskPrintOptionsConfig {
  /** Used for last-used memory, e.g. "invoice", "delivery_challan", "gatepass". */
  docType: string;
  title?: string;
  description?: string;
  /** From the document itself (its branch / warehouse) — wins over last-used. */
  defaultSource?: HeaderSource | null;
  allowCopyLabel?: boolean;
  defaultCopyLabel?: string;
  allowSupplyFrom?: boolean;
  /** Tax-invoice compliance: warn when selected source GSTIN differs. */
  issuedGstin?: string | null;
  /** Loaded company record — used only for the completeness banner. */
  company?: ProfileHealthInput;
  /** Serials to auto-derive warehouse header from (smart path). */
  smartSerials?: string[];
  /** Warehouse IDs to auto-derive header from (smart path). */
  smartWarehouseIds?: Array<string | null | undefined>;
}

const sameSource = (a: HeaderSource, b: HeaderSource) =>
  a.kind === b.kind && (a.id ?? null) === (b.id ?? null);

function matchOption(options: HeaderSourceOption[], src: HeaderSource | null | undefined) {
  if (!src) return undefined;
  return options.find((o) => o.kind === src.kind && (o.id ?? null) === (src.id ?? null));
}

/**
 * usePrintOptions — imperative "ask before printing" controller.
 *
 *   const printer = usePrintOptions();
 *   const choice = await printer.ask({ docType: "invoice", ... });
 *   if (!choice) return;               // user cancelled
 *   // use choice.header / choice.copyLabel ...
 *   return <>{printer.element}</>
 */
export function usePrintOptions() {
  const [config, setConfig] = useState<AskPrintOptionsConfig | null>(null);
  const resolverRef = useRef<((c: PrintChoice | null) => void) | null>(null);

  const ask = useCallback((cfg: AskPrintOptionsConfig): Promise<PrintChoice | null> => {
    return new Promise((resolve) => {
      resolverRef.current?.(null); // cancel any prior open ask
      resolverRef.current = resolve;
      setConfig(cfg);
    });
  }, []);

  const smartAsk = useCallback(
    async (cfg: AskPrintOptionsConfig): Promise<PrintChoice | null> => {
      if (cfg.smartWarehouseIds) {
        const source = deriveHeaderFromWarehouseIds(cfg.smartWarehouseIds);
        if (source) {
          const header = await resolveHeader(source);
          setLastUsedSource(cfg.docType, source);
          return {
            source,
            header,
            copyLabel:
              cfg.allowCopyLabel === false ? "" : (cfg.defaultCopyLabel ?? "Original Copy"),
            showSupplyFrom: cfg.allowSupplyFrom !== false,
          };
        }
      }

      if (cfg.smartSerials) {
        const source = await deriveHeaderFromSerials(cfg.smartSerials);
        if (source) {
          const header = await resolveHeader(source);
          setLastUsedSource(cfg.docType, source);
          return {
            source,
            header,
            copyLabel:
              cfg.allowCopyLabel === false ? "" : (cfg.defaultCopyLabel ?? "Original Copy"),
            showSupplyFrom: cfg.allowSupplyFrom !== false,
          };
        }
      }

      return ask(cfg);
    },
    [ask],
  );

  const finish = useCallback((choice: PrintChoice | null) => {
    resolverRef.current?.(choice);
    resolverRef.current = null;
    setConfig(null);
  }, []);

  // Use a function so the element re-evaluates with current config on each render
  const element = useMemo(
    () => (
      <>
        <PrintOptionsDialog
          config={config}
          onCancel={() => finish(null)}
          onConfirm={(c) => finish(c)}
        />
        {/* Hide the print dialog during browser print */}
        <style>{`@media print { [data-radix-portal], [role="dialog"], [role="dialog"] ~ * { display: none !important; } }`}</style>
      </>
    ),
    [config, finish],
  );

  return { ask, smartAsk, element };
}

// ---------------------------------------------------------------------------

function PrintOptionsDialog({
  config,
  onConfirm,
  onCancel,
}: {
  config: AskPrintOptionsConfig | null;
  onConfirm: (c: PrintChoice) => void;
  onCancel: () => void;
}) {
  const open = !!config;
  const [options, setOptions] = useState<HeaderSourceOption[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [copyLabel, setCopyLabel] = useState("Original Copy");
  const [showSupplyFrom, setShowSupplyFrom] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  /** Post-resolve GSTIN compliance warning (tax invoices). */
  const [gstWarning, setGstWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    setGstWarning(null);
  }, [config, selectedKey]);

  useEffect(() => {
    if (!config) return;
    let alive = true;
    setLoadErr(null);
    (async () => {
      try {
        const { options: opts } = await listHeaderSources();
        if (!alive) return;
        setOptions(opts);
        const preferred =
          matchOption(opts, config.defaultSource) ??
          matchOption(opts, getLastUsedSource(config.docType)) ??
          opts.find((o) => o.kind === ("regd_office" as HeaderSourceKind)) ??
          opts[0];
        setSelectedKey(preferred ? `${preferred.kind}:${preferred.id ?? ""}` : "");
        setCopyLabel(config.defaultCopyLabel ?? "Original Copy");
        setShowSupplyFrom(config.allowSupplyFrom !== false);
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : "Failed to load letterhead sources");
      }
    })();
    return () => {
      alive = false;
    };
  }, [config]);

  const selected = useMemo(() => {
    const [kind, id] = selectedKey.split(":");
    return options.find(
      (o) => o.kind === (kind as HeaderSourceKind) && (o.id ?? "") === (id ?? ""),
    );
  }, [options, selectedKey]);

  const groups = useMemo(() => {
    const map = new Map<string, HeaderSourceOption[]>();
    for (const o of options) {
      const arr = map.get(o.group) ?? [];
      arr.push(o);
      map.set(o.group, arr);
    }
    return Array.from(map.entries());
  }, [options]);

  const confirm = async () => {
    if (!config || !selected) return;
    setBusy(true);
    try {
      const source: HeaderSource = { kind: selected.kind, id: selected.id };
      const header = await resolveHeader(source);
      // Tax-invoice compliance guard: warn (once) when the chosen office's
      // GSTIN differs from the GSTIN the tax was actually computed under.
      const chosenGstin = header.gstin?.trim() || "";
      const issued = config.issuedGstin?.trim() || "";
      if (issued && chosenGstin && chosenGstin !== issued && !gstWarning) {
        setGstWarning(
          `The selected office has GSTIN ${chosenGstin}, but this invoice was taxed under ${issued}. ` +
            `Printing with a different GSTIN can create a GST mismatch — continue only if that is intended.`,
        );
        setBusy(false);
        return;
      }
      setLastUsedSource(config.docType, source);
      onConfirm({
        source,
        header,
        copyLabel: config.allowCopyLabel === false ? "" : copyLabel.trim() || "Original Copy",
        showSupplyFrom: config.allowSupplyFrom === false ? false : showSupplyFrom,
      });
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Failed to resolve letterhead");
    } finally {
      setBusy(false);
    }
  };

  const incomplete = config ? isProfileIncomplete(config.company) : false;
  const missing = config ? profileIssues(config.company) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-4 w-4" />
            {config?.title ?? "Print document"}
          </DialogTitle>
          <DialogDescription>
            {config?.description ?? "Choose which office details appear on the letterhead."}
          </DialogDescription>
        </DialogHeader>

        {incomplete && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <b>Company Master incomplete.</b> These details are missing or still placeholder
                values: {missing.join(", ")}. Fix them under Company settings before issuing
                customer copies.
              </div>
            </div>
          </div>
        )}
        {gstWarning && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {gstWarning}
            <button
              className="ml-auto shrink-0 rounded border border-red-400 px-2 py-0.5 font-semibold hover:bg-red-100"
              onClick={() => setGstWarning(null)}
            >
              Continue anyway
            </button>
          </div>
        )}
        {loadErr && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {loadErr}
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Letterhead / Office</Label>
          <select
            className="w-full h-9 rounded-md border bg-background px-2 text-sm"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
          >
            {!options.length && <option value="">Loading…</option>}
            {groups.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((o) => (
                  <option key={`${o.kind}:${o.id ?? ""}`} value={`${o.kind}:${o.id ?? ""}`}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selected && <p className="text-xs text-muted-foreground pl-1">{selected.preview}</p>}
        </div>

        {config?.allowCopyLabel !== false && (
          <div className="space-y-1.5">
            <Label className="text-xs">Copy label</Label>
            <Input
              value={copyLabel}
              onChange={(e) => setCopyLabel(e.target.value)}
              placeholder="Original Copy"
            />
          </div>
        )}

        {config?.allowSupplyFrom !== false && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={showSupplyFrom}
              onChange={(e) => setShowSupplyFrom(e.target.checked)}
            />
            Show Supply-From line on the document
          </label>
        )}

        <p className="text-[11px] text-muted-foreground">
          Your selection is remembered for future {config?.docType.replace(/_/g, " ") ?? ""} prints
          until you change it.
        </p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={confirm} disabled={!selected || busy}>
            {busy ? "Preparing…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
