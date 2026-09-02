import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { getInvoiceCompletionStatus } from "@/lib/einvoice";

type InvoiceLite = {
  id: string;
  invoice_no?: string | null;
  transport_details?: unknown;
  einvoice_status?: string | null;
  print_count?: number | null;
  first_printed_at?: string | null;
  last_printed_at?: string | null;
  last_printed_by?: string | null;
  [key: string]: unknown;
};

export type InvoicePrintSelection = {
  copies: string[];
  isReprint: boolean;
  showWatermark: boolean;
  asZip: boolean;
};

export type InvoicePrintModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceLite;
  /** Optional external handlers — if provided, modal delegates audit+PDF to parent; otherwise modal handles audit itself (fallback). */
  onDownload?: (opts: InvoicePrintSelection) => Promise<void> | void;
  onPrint?: (opts: InvoicePrintSelection) => Promise<void> | void;
  themeColor?: string;
  copyLabel?: string;
};

const BASE_COPIES = ["Original", "Duplicate", "Triplicate", "Office"] as const;
type BaseCopy = (typeof BASE_COPIES)[number];

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  try {
    const subtle = (globalThis.crypto as unknown as { subtle?: { digest: (alg: string, d: BufferSource) => Promise<ArrayBuffer> } })?.subtle;
    if (subtle?.digest) {
      const buf = await subtle.digest("SHA-256", bytes as BufferSource);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    /* fallback below */
  }
  let h = 0;
  for (let i = 0; i < bytes.length; i++) h = (Math.imul(31, h) + bytes[i]) | 0;
  return Math.abs(h).toString(16).padStart(8, "0");
}

async function sha256Hex(input: string): Promise<string> {
  return sha256HexBytes(new TextEncoder().encode(input));
}

// Preferred: hash actual PDF bytes (arraybuffer) — caller should pass doc.output('arraybuffer')
async function sha256HexPdfBytes(ab: ArrayBuffer): Promise<string> {
  return sha256HexBytes(new Uint8Array(ab));
}

function formatFirstPrinted(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function InvoicePrintModal({ open, onOpenChange, invoice, onDownload, onPrint, themeColor, copyLabel }: InvoicePrintModalProps) {
  const completion = useMemo(() => getInvoiceCompletionStatus(invoice as unknown as Parameters<typeof getInvoiceCompletionStatus>[0]), [invoice]);
  const isReprint = (invoice.print_count ?? 0) > 0;

  const [selected, setSelected] = useState<Record<BaseCopy, boolean>>({
    Original: true,
    Duplicate: true,
    Triplicate: true,
    Office: false,
  });
  const [extraCount, setExtraCount] = useState(0);
  const [asZip, setAsZip] = useState<"single" | "zip">("single");
  const [showWatermark, setShowWatermark] = useState(false);
  const [busy, setBusy] = useState<"download" | "print" | null>(null);

  // default selection: COMPLETE → Original+Duplicate+Triplicate, pending → Original+Office
  useEffect(() => {
    if (!open) return;
    if (completion.complete) {
      setSelected({ Original: true, Duplicate: true, Triplicate: true, Office: false });
    } else {
      setSelected({ Original: true, Duplicate: false, Triplicate: false, Office: true });
    }
    setExtraCount(0);
    setAsZip("single");
    setShowWatermark(false);
  }, [open, completion.complete, invoice.id]);

  function buildCopies(): string[] {
    const base = (Object.keys(selected) as BaseCopy[]).filter((k) => selected[k]);
    const extras: string[] = [];
    for (let i = 1; i <= extraCount; i++) extras.push(`EXTRA ${i}`);
    return [...base, ...extras];
  }

  const copiesPreview = buildCopies();

  async function handleInternalAudit(copies: string[], isReprintFlag: boolean): Promise<void> {
    const nowIso = new Date().toISOString();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id ?? null;
    const pdfHash = await sha256Hex(copies.join(",") + nowIso + (invoice.id || ""));
    const nextCount = (invoice.print_count ?? 0) + 1;
    // invoice_print_log insert (audit) — copies text[], snapshot theme/copy, is_reprint, pdf_hash
    const logPayload: Record<string, unknown> = {
      invoice_id: invoice.id,
      copies,
      copy_labels_snapshot: copies.join("/"),
      theme_color_snapshot: themeColor ?? null,
      is_reprint: isReprintFlag,
      pdf_hash: pdfHash,
      printed_by: userId,
      is_provisional: !completion.complete,
    };
    const { error: logErr } = await (supabase as unknown as { from: (t: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> } }).from("invoice_print_log").insert(logPayload);
    if (logErr) throw new Error(logErr.message);
    // invoices print_count first_printed_at coalesce + last_printed_at/by
    const updatePayload: Record<string, unknown> = {
      print_count: nextCount,
      first_printed_at: (invoice.first_printed_at as string | null) ?? nowIso,
      last_printed_at: nowIso,
      last_printed_by: userId,
    };
    const { error: updErr } = await (supabase as unknown as { from: (t: string) => { update: (v: unknown) => { eq: (c: string, v:unknown)=>Promise<{error:{message:string}|null}> } } }).from("invoices").update(updatePayload).eq("id", invoice.id);
    if (updErr) throw new Error(updErr.message);
  }

  async function handleAction(mode: "download" | "print") {
    const copies = buildCopies();
    if (copies.length === 0) {
      toast.error("Select at least one copy");
      return;
    }
    const isReprintFlag = isReprint;
    // If parent handlers are provided, delegate — parent is expected to do audit before blob (route handles it).
    // Keep internal audit path as fallback when no handlers.
    const hasExternalHandler = mode === "download" ? !!onDownload : !!onPrint;
    if (hasExternalHandler) {
      try {
        setBusy(mode);
        if (mode === "download" && onDownload) {
          await onDownload({ copies, isReprint: isReprintFlag, showWatermark, asZip: asZip === "zip" });
        } else if (mode === "print" && onPrint) {
          await onPrint({ copies, isReprint: isReprintFlag, showWatermark, asZip: asZip === "zip" });
        }
        onOpenChange(false);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Print failed");
      } finally {
        setBusy(null);
      }
      return;
    }

    // Fallback: modal handles audit itself before closing (no PDF generation without external handler)
    try {
      setBusy(mode);
      await handleInternalAudit(copies, isReprintFlag);
      toast.success(mode === "download" ? "Audit logged — ready to download" : "Audit logged — ready to print");
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Audit failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Print / Download Invoice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold">Copies</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {BASE_COPIES.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm border rounded px-3 py-2 cursor-pointer hover:bg-accent">
                  <Checkbox
                    checked={!!selected[c]}
                    onCheckedChange={(v) => setSelected((s) => ({ ...s, [c]: !!v }))}
                  />
                  <span>{c}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Default: {completion.complete ? "Original + Duplicate + Triplicate (COMPLETE)" : "Original + Office (pending)"} — per-print choice overrides settings.
            </p>
          </div>

          <div className="flex items-center justify-between border rounded px-3 py-2">
            <Label className="text-xs">Extra copies</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setExtraCount((n) => Math.max(0, n - 1))} disabled={extraCount <= 0}>
                −
              </Button>
              <span className="w-8 text-center text-sm font-mono">{extraCount}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setExtraCount((n) => Math.min(5, n + 1))} disabled={extraCount >= 5}>
                +
              </Button>
              <span className="text-xs text-muted-foreground ml-2">0–5</span>
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Output</Label>
            <RadioGroup value={asZip} onValueChange={(v) => setAsZip(v as "single" | "zip")} className="mt-2">
              <div className="flex items-center space-x-2 border rounded px-3 py-2">
                <RadioGroupItem value="single" id="r-single" />
                <Label htmlFor="r-single" className="text-sm font-normal cursor-pointer flex-1">
                  One multi-page PDF (default)
                </Label>
              </div>
              <div className="flex items-center space-x-2 border rounded px-3 py-2">
                <RadioGroupItem value="zip" id="r-zip" />
                <Label htmlFor="r-zip" className="text-sm font-normal cursor-pointer flex-1">
                  Separate PDFs as ZIP
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between border rounded px-3 py-2">
            <Label htmlFor="watermark" className="text-xs">
              Show watermark
            </Label>
            <Switch id="watermark" checked={showWatermark} onCheckedChange={setShowWatermark} />
          </div>

          {/* Preview */}
          <div className="text-xs text-muted-foreground border rounded px-3 py-2 bg-muted/30">
            <div>
              Selected: <span className="font-mono">{copiesPreview.length ? copiesPreview.join(", ") : "—"}</span>
            </div>
            {isReprint && <div className="text-amber-700">Reprint — watermark “REPRINT” will be applied</div>}
            {!completion.complete && <div className="text-rose-600">Provisional — watermark “PROVISIONAL — IRN PENDING” (red)</div>}
          </div>
        </div>

        <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
          {invoice.first_printed_at ? (
            <div>
              First printed: <span className="font-mono">{formatFirstPrinted(invoice.first_printed_at as string)}</span>
            </div>
          ) : (
            <div>Not printed yet</div>
          )}
          <div>Click Print → audit logged</div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => handleAction("download")} disabled={!!busy}>
            {busy === "download" ? "…" : "Download"}
          </Button>
          <Button onClick={() => handleAction("print")} disabled={!!busy}>
            {busy === "print" ? "…" : "Print"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
