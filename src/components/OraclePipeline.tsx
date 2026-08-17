import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, ChevronRight, FileText, Receipt, Eye, Download } from "lucide-react";
import {
  docSatisfied, normalizeOracle, oracleDocRequirements, requiresCustomerReturn,
  sectionMissingFields, type OracleBlock, type OraclePendingDocs, type SectionKey,
} from "@/lib/indent";

export type OracleDocInfo = { no?: string | null; status?: string | null; id?: string | null };
export type OracleDocInfoMap = {
  dc?: OracleDocInfo | null;
  oem_grn?: OracleDocInfo | null;
  customer_grn?: OracleDocInfo | null;
};

export type PipelineStep = {
  key: SectionKey;
  label: string;
  done: boolean;
  /** true when the only thing missing is the document */
  docBlocked: boolean;
  detail: string;
  /** which generate action unblocks this step, if any */
  action?: "dc" | "oem_grn" | "customer_grn";
  actionLabel?: string;
  /** Existing settled document for this section (enables View / Download). */
  docKind?: "dc" | "oem_grn" | "customer_grn";
  docId?: string | null;
  docNo?: string | null;
};

const SECTION_LABEL: Record<SectionKey, string> = {
  A: "A. Defective Part",
  B: "B. Material Exchange",
  C: "C. Received from OEM",
  D: "D. Received from Customer",
};

const docLabel = (k: "dc" | "oem_grn" | "customer_grn") =>
  k === "dc" ? "Delivery Challan" : k === "oem_grn" ? "GRN (from OEM)" : "GRN (from Customer)";

/** Build the A→D step statuses from the SAME data/logic used by
 *  `oracleIsComplete` / `oracleCanAutoClose`. Read-only. */
export function computeOracleSteps(
  oIn: OracleBlock,
  indentType?: string | null,
  pendingDocs?: OraclePendingDocs | null,
  docInfo?: OracleDocInfoMap,
): PipelineStep[] {
  const o = normalizeOracle(oIn);
  const req = oracleDocRequirements(o, indentType);
  const steps: PipelineStep[] = [];

  // Section A — read-only from Ticket; done once the block has defective rows.
  const aMissing = sectionMissingFields(o, "A", indentType);
  const d0 = o.defective_rows[0];
  steps.push({
    key: "A",
    label: SECTION_LABEL.A,
    done: aMissing.length === 0,
    docBlocked: false,
    detail: aMissing.length === 0
      ? [d0?.def_model_no, d0?.def_serial_no].filter(Boolean).join(" · ") +
        (o.defective_rows.length > 1 ? ` +${o.defective_rows.length - 1} more` : "")
      : `${aMissing.join(", ")} not filled in`,
  });

  const build = (
    key: Exclude<SectionKey, "A">,
    docKey: "dc" | "oem_grn" | "customer_grn",
    needDoc: boolean,
    actionLabel: string,
  ): PipelineStep => {
    const missing = sectionMissingFields(o, key, indentType);
    const fieldsOk = missing.length === 0;
    const satisfied = docSatisfied(pendingDocs?.[docKey]);
    const info = docInfo?.[docKey];
    if (!fieldsOk) {
      return {
        key, label: SECTION_LABEL[key], done: false, docBlocked: false,
        detail: `${missing.join(", ")} not filled in`,
      };
    }
    if (needDoc && !satisfied) {
      const created = (pendingDocs?.[docKey]?.pending || 0) > 0;
      return {
        key, label: SECTION_LABEL[key], done: false, docBlocked: !created,
        detail: created
          ? `Fields OK — ${info?.no ? `${info.no} ` : ""}${docLabel(docKey)} awaiting Submit`
          : `Fields OK — ${docLabel(docKey)} not generated`,
        action: created ? undefined : docKey,
        actionLabel,
      };
    }
    return {
      key, label: SECTION_LABEL[key], done: true, docBlocked: false,
      detail: info?.no
        ? `${info.no}${info.status ? ` · ${info.status}` : ""}`
        : needDoc ? "Document Submitted" : "Fields complete",
      docKind: needDoc ? docKey : undefined,
      docId: needDoc ? (info?.id ?? pendingDocs?.[docKey]?.doc_id ?? null) : null,
      docNo: needDoc ? (info?.no ?? pendingDocs?.[docKey]?.doc_no ?? null) : null,
    };
  };

  steps.push(build("B", "dc", req.needDc, "Generate DC"));
  steps.push(build("C", "oem_grn", req.needOemGrn, "Generate GRN"));
  if (requiresCustomerReturn(indentType)) {
    steps.push(build("D", "customer_grn", req.needCustomerGrn, "Generate GRN"));
  }
  return steps;
}

export function oracleBlockerLine(steps: PipelineStep[], closed: boolean): string {
  if (closed) return "Closed — all sections complete and all documents settled.";
  const first = steps.find((s) => !s.done);
  if (!first) return "Ready to close — nothing is blocking this Oracle.";
  const what = first.detail.startsWith("Fields OK")
    ? first.action
      ? `generate and submit the ${first.action === "dc" ? "Delivery Challan" : "GRN"} to close this Oracle.`
      : `submit the pending ${first.key === "B" ? "Delivery Challan" : "GRN"} to close this Oracle.`
    : `complete ${first.detail.replace(" not filled in", "")} to close this Oracle.`;
  return `Waiting on: Section ${first.key} — ${what}`;
}

export function OraclePipeline({
  oracle, indentType, pendingDocs, docInfo, duplicateIndentNo, condensed = false,
  onGenerateChallan, onGenerateGrn, onGenerateCustomerGrn, onOpenBlock,
}: {
  oracle: OracleBlock;
  indentType?: string | null;
  pendingDocs?: OraclePendingDocs | null;
  docInfo?: OracleDocInfoMap;
  duplicateIndentNo?: string | null;
  condensed?: boolean;
  onGenerateChallan?: (o: OracleBlock) => void;
  onGenerateGrn?: (o: OracleBlock) => void;
  onGenerateCustomerGrn?: (o: OracleBlock) => void;
  onOpenBlock?: () => void;
}) {
  const steps = computeOracleSteps(oracle, indentType, pendingDocs, docInfo);
  const closed = oracle.status === "closed";
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const statusText = closed
    ? "Closed"
    : allDone ? "Ready to close" : `Open — ${doneCount} of ${steps.length} steps done`;

  const runAction = (a?: PipelineStep["action"]) => {
    if (!a) return;
    if (a === "dc") onGenerateChallan?.(oracle);
    else if (a === "oem_grn") onGenerateGrn?.(oracle);
    else onGenerateCustomerGrn?.(oracle);
  };

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold font-mono">
          Oracle {oracle.oracle_no || "(unassigned)"}
        </span>
        <Badge className={closed || allDone ? "bg-emerald-600 hover:bg-emerald-600" : "bg-destructive hover:bg-destructive"}>
          {statusText}
        </Badge>
        {duplicateIndentNo && (
          <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300 text-[11px]">
            ⚠ Also used on Indent {duplicateIndentNo}
          </Badge>
        )}
        {condensed && onOpenBlock && (
          <Button variant="link" size="sm" className="h-6 px-1 text-xs" onClick={onOpenBlock}>
            Open block
          </Button>
        )}
      </div>

      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {steps.map((s, ix) => (
          <div key={s.key} className="flex items-stretch gap-1 min-w-0">
            <div
              className={`rounded-md border-2 px-2 py-1.5 min-w-[150px] ${
                s.done
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-destructive bg-destructive/10"
              }`}
            >
              <div className="flex items-center gap-1 text-xs font-semibold">
                {s.done
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  : <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                <span className="truncate">{s.label}</span>
              </div>
              {!condensed && (
                <div className={`text-[11px] mt-0.5 ${s.done ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>
                  {s.detail}
                </div>
              )}
              {s.action && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 mt-1 text-[11px] px-2"
                  onClick={() => runAction(s.action)}
                >
                  {s.action === "dc" ? <FileText className="h-3 w-3 mr-1" /> : <Receipt className="h-3 w-3 mr-1" />}
                  {s.actionLabel}
                </Button>
              )}
              {!s.action && s.docId && (
                <div className="flex items-center gap-1 mt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => window.open(`${s.docKind === "dc" ? "/challan" : "/grn"}/${s.docId}`, "_blank", "noopener")}
                  >
                    <Eye className="h-3 w-3 mr-1" />
                    {s.docKind === "dc" ? "View DC" : "View GRN"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => window.open(`${s.docKind === "dc" ? "/challan" : "/grn"}/${s.docId}?download=1`, "_blank", "noopener")}
                  >
                    <Download className="h-3 w-3 mr-1" />
                    Download PDF
                  </Button>
                </div>
              )}
            </div>
            {ix < steps.length - 1 && (
              <ChevronRight className="h-4 w-4 self-center text-muted-foreground shrink-0" />
            )}
          </div>
        ))}
      </div>

      <div className={`text-xs ${closed || allDone ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>
        {oracleBlockerLine(steps, closed)}
      </div>
    </div>
  );
}
