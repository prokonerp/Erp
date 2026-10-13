import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DefectiveInRecord } from "@/lib/defectiveTags";

/** Editable copy of one tag's fields. Values that were auto-picked from the
 * source record arrive pre-filled; every field below is required before a
 * tag may be generated (ASP code is optional on No-ASP rows). */
export type TagDetailDraft = {
  key: string;
  modelNo: string;
  serialNo: string;
  customerName: string;
  oemCaseId: string;
  oracleOrderNo: string;
  aspCode: string;
  engineerName: string;
  /** yyyy-mm-dd — matches defective_tags.replacement_date (date). */
  replacementDate: string;
  /** Maps to defective_tags.reason ("Reason / Remarks"). */
  reason: string;
};

/** "2026-10-13" out of an ISO datetime, or "" when unparseable. Avoids any
 * timezone-shift by never going through `new Date(...)`. */
function toDateInput(v?: string | null): string {
  if (!v) return "";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function draftFromRecord(r: DefectiveInRecord): TagDetailDraft {
  return {
    key: r.key,
    modelNo: r.model_no || r.part_name || "",
    serialNo: r.serial_no || "",
    customerName: r.customer_name || "",
    oemCaseId: r.oem_ref_id || "",
    oracleOrderNo: r.oracle_order_no || "",
    aspCode: r.asp_code || "",
    engineerName: r.engineer_name || "",
    replacementDate: toDateInput(r.replacement_date),
    reason: r.reason || "",
  };
}

/** Field labels still missing on one draft, for the inline error line. */
function missingFields(d: TagDetailDraft, aspRequired: boolean): string[] {
  const missing: string[] = [];
  if (!d.modelNo.trim()) missing.push("Model");
  if (!d.serialNo.trim()) missing.push("Defective Serial");
  if (!d.customerName.trim()) missing.push("Customer");
  if (!d.oemCaseId.trim()) missing.push("OEM Case ID");
  if (!d.oracleOrderNo.trim()) missing.push("Oracle Order");
  if (aspRequired && !d.aspCode.trim()) missing.push("ASP Code");
  if (!d.engineerName.trim()) missing.push("Engineer Name");
  if (!d.replacementDate.trim()) missing.push("Placement (Replacement) Date");
  if (!d.reason.trim()) missing.push("Reason / Remarks");
  return missing;
}

function Req({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-xs">
      {children} <span className="text-destructive">*</span>
    </Label>
  );
}

export function DefectiveTagDetailsDialog({
  open,
  rows,
  aspRequired,
  saving,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  /** Only the selected rows that still need a tag (i.e. !tag_generated). */
  rows: DefectiveInRecord[];
  /** False on the No-ASP tab, where ASP Code is legitimately blank. */
  aspRequired: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the records patched with the user-approved field values. */
  onConfirm: (edited: DefectiveInRecord[]) => void;
}) {
  const [drafts, setDrafts] = useState<TagDetailDraft[]>([]);
  /** Reset drafts only on the closed→open transition: `rows` is a fresh
   * array on every parent render, so depending on it directly would wipe
   * typed edits on any background re-render while the dialog is open. */
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) setDrafts(rows.map(draftFromRecord));
    wasOpen.current = open;
  }, [open, rows]);

  function patch(key: string, k: keyof Omit<TagDetailDraft, "key">, v: string) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, [k]: v } : d)));
  }

  const missingByKey = new Map(drafts.map((d) => [d.key, missingFields(d, aspRequired)]));
  const totalMissing = [...missingByKey.values()].reduce((n, m) => n + m.length, 0);
  const canConfirm = drafts.length > 0 && totalMissing === 0 && !saving;

  /** Destructive border for a required field that is still empty. */
  const errCls = (bad: boolean) => (bad ? "border-destructive focus-visible:ring-destructive" : "");

  function confirm() {
    if (!canConfirm) return;
    const byKey = new Map(drafts.map((d) => [d.key, d]));
    onConfirm(
      rows.map((r) => {
        const d = byKey.get(r.key);
        if (!d) return r;
        return {
          ...r,
          model_no: d.modelNo.trim() || null,
          serial_no: d.serialNo.trim() || null,
          customer_name: d.customerName.trim() || null,
          oem_ref_id: d.oemCaseId.trim() || null,
          oracle_order_no: d.oracleOrderNo.trim() || null,
          asp_code: d.aspCode.trim() || null,
          engineer_name: d.engineerName.trim() || null,
          replacement_date: d.replacementDate.trim() || null,
          reason: d.reason.trim() || null,
        };
      }),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Tag Details — {drafts.length} tag{drafts.length === 1 ? "" : "s"} · all fields required
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {drafts.map((d, i) => {
            const missing = missingByKey.get(d.key) || [];
            return (
              <div key={d.key} className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-semibold">
                  Tag {i + 1}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {d.modelNo || "—"} · {d.serialNo || "—"}
                  </span>
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Req>Model No.</Req>
                    <Input
                      value={d.modelNo}
                      onChange={(e) => patch(d.key, "modelNo", e.target.value)}
                      aria-invalid={!d.modelNo.trim()}
                      className={errCls(!d.modelNo.trim())}
                    />
                  </div>
                  <div className="space-y-1">
                    <Req>Defective Serial No.</Req>
                    <Input
                      value={d.serialNo}
                      onChange={(e) => patch(d.key, "serialNo", e.target.value.toUpperCase())}
                      aria-invalid={!d.serialNo.trim()}
                      className={`font-mono ${errCls(!d.serialNo.trim())}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <Req>Customer Name</Req>
                    <Input
                      value={d.customerName}
                      onChange={(e) => patch(d.key, "customerName", e.target.value)}
                      aria-invalid={!d.customerName.trim()}
                      className={errCls(!d.customerName.trim())}
                    />
                  </div>
                  <div className="space-y-1">
                    <Req>OEM Case ID</Req>
                    <Input
                      value={d.oemCaseId}
                      onChange={(e) => patch(d.key, "oemCaseId", e.target.value)}
                      aria-invalid={!d.oemCaseId.trim()}
                      className={errCls(!d.oemCaseId.trim())}
                    />
                  </div>
                  <div className="space-y-1">
                    <Req>Oracle Order No.</Req>
                    <Input
                      value={d.oracleOrderNo}
                      onChange={(e) => patch(d.key, "oracleOrderNo", e.target.value.toUpperCase())}
                      aria-invalid={!d.oracleOrderNo.trim()}
                      className={`font-mono ${errCls(!d.oracleOrderNo.trim())}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      ASP Code{" "}
                      {!aspRequired && (
                        <span className="text-muted-foreground">(optional — No ASP)</span>
                      )}
                      {aspRequired && <span className="text-destructive"> *</span>}
                    </Label>
                    <Input
                      value={d.aspCode}
                      onChange={(e) => patch(d.key, "aspCode", e.target.value)}
                      aria-invalid={aspRequired && !d.aspCode.trim()}
                      className={errCls(aspRequired && !d.aspCode.trim())}
                    />
                  </div>
                  <div className="space-y-1">
                    <Req>Engineer Name</Req>
                    <Input
                      value={d.engineerName}
                      onChange={(e) => patch(d.key, "engineerName", e.target.value)}
                      aria-invalid={!d.engineerName.trim()}
                      className={errCls(!d.engineerName.trim())}
                    />
                  </div>
                  <div className="space-y-1">
                    <Req>Placement (Replacement) Date</Req>
                    <Input
                      type="date"
                      value={d.replacementDate}
                      onChange={(e) => patch(d.key, "replacementDate", e.target.value)}
                      aria-invalid={!d.replacementDate.trim()}
                      className={errCls(!d.replacementDate.trim())}
                    />
                  </div>
                  <div className="space-y-1 md:col-span-1">
                    <Req>Reason / Remarks</Req>
                    <Textarea
                      rows={2}
                      value={d.reason}
                      onChange={(e) => patch(d.key, "reason", e.target.value)}
                      aria-invalid={!d.reason.trim()}
                      className={errCls(!d.reason.trim())}
                    />
                  </div>
                </div>
                {missing.length > 0 && (
                  <p className="text-xs text-destructive" role="alert">
                    Required: {missing.join(", ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!canConfirm}>
            {saving ? "Generating…" : `Generate & Print (${drafts.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
