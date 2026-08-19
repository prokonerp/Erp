import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, FileText, Receipt, Lock, LockOpen, CheckCircle2, ChevronDown, ChevronUp, Eye, Download, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { docSatisfied, normalizeOracle, oracleCanAutoClose, oracleIsComplete, oracleStatus, sectionMissingFields, type OracleBlock, type OracleExchangeRow, type OraclePendingDocs, type OracleReceivedRow, type ProductTag } from "@/lib/indent";
import { ControlledActionDialog } from "@/components/ControlledActionDialog";
import { IndentModelPicker } from "@/components/IndentModelPicker";
import { OraclePipeline, type OracleDocInfoMap } from "@/components/OraclePipeline";

type DefectivePart = { name?: string; model_no?: string; serial?: string; qty?: string | number; oracle_no?: string };
type Warehouse = { id: string; name: string; code: string };
type StockRow = { id: string; part_name: string; part_model_no: string | null; part_serial_no: string | null; warehouse_id: string | null; warehouse_name?: string };

/** View / Download PDF pair shown in a section header once its linked
 *  document exists and is settled. */
function DocLinkButtons({ kind, docId }: { kind: "dc" | "grn"; docId: string }) {
  const base = kind === "dc" ? "/challan" : "/grn";
  const open = (suffix = "") => window.open(`${base}/${docId}${suffix}`, "_blank", "noopener");
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" onClick={() => open()} title="Open the linked document">
        <Eye className="h-4 w-4 mr-1" />{kind === "dc" ? "View DC" : "View GRN"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => open("?download=1")} title="Open and download the PDF">
        <Download className="h-4 w-4 mr-1" />Download PDF
      </Button>
    </div>
  );
}

/** Generate button for a section, disabled until that section's own fields
 *  are complete (per `sectionMissingFields`). Shows what's missing on hover. */
function GenerateButton({
  label, icon, missing, onClick,
}: { label: string; icon: "dc" | "grn"; missing: string[]; onClick: () => void }) {
  const disabled = missing.length > 0;
  const Icon = icon === "dc" ? FileText : Receipt;
  const btn = (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? `Missing: ${missing.join(", ")}` : undefined}
    >
      <Icon className="h-4 w-4 mr-1" />{label}
    </Button>
  );
  if (!disabled) return btn;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild><span className="inline-flex cursor-not-allowed">{btn}</span></TooltipTrigger>
        <TooltipContent>Missing: {missing.join(", ")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function OracleBlockEditor({
  index, value: rawValue, onChange, onRemove, defectiveParts, isAdmin = false,
  collapsed = false, onToggleCollapse, onGenerateChallan, onGenerateGrn,
  onGenerateCustomerGrn, dcExists = false, dcInfo, indentId,
  pendingDocs, indentType, docInfo, duplicateIndentNo,
}: {
  index: number;
  value: OracleBlock;
  onChange: (v: OracleBlock) => void;
  onRemove: () => void;
  defectiveParts: DefectivePart[];
  isAdmin?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onGenerateChallan?: (oracle: OracleBlock) => void;
  onGenerateGrn?: (oracle: OracleBlock) => void;
  onGenerateCustomerGrn?: (oracle: OracleBlock) => void;
  dcExists?: boolean;
  dcInfo?: { challan_no?: string | null; challan_date?: string | null; status?: string | null; id?: string | null };
  /** Parent indent id — required for controlled admin reopen. */
  indentId?: string;
  /** Count of related DC / GRN documents that are still not Submitted or
   *  Closed. While either is > 0 the Oracle must stay Open. */
  pendingDocs?: OraclePendingDocs;
  /** Parent indent type — decides whether Section D (customer return) is
   *  mandatory for completeness / auto-close. */
  indentType?: string | null;
  /** Document numbers/statuses per section, for the status pipeline. */
  docInfo?: OracleDocInfoMap;
  /** Indent No where this same Oracle # also appears (informational). */
  duplicateIndentNo?: string | null;
}) {
  // Always work with a normalized block (arrays guaranteed).
  const value = useMemo(() => normalizeOracle(rawValue), [rawValue]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  // Per-row stock pools, keyed by row index.
  const [exchStockByRow, setExchStockByRow] = useState<Record<number, StockRow[]>>({});
  const [shortageOpen, setShortageOpen] = useState(false);
  const [shortageMsg, setShortageMsg] = useState<string>("");
  const [shortageHasOther, setShortageHasOther] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [forceCloseOpen, setForceCloseOpen] = useState(false);

  const status = oracleStatus(value);
  const closed = status === "closed";
  const complete = oracleIsComplete(value, indentType);
  const pendingParts = [
    { label: "DC", n: pendingDocs?.dc.pending || 0 },
    { label: "OEM GRN", n: pendingDocs?.oem_grn.pending || 0 },
    { label: "Customer GRN", n: pendingDocs?.customer_grn.pending || 0 },
  ].filter((p) => p.n > 0);
  const docsPending = pendingParts.reduce((s, p) => s + p.n, 0);
  const canAutoClose = oracleCanAutoClose(value, pendingDocs, indentType);
  // Per-section completeness — the single source of truth for gating the
  // three Generate buttons below.
  const missingB = sectionMissingFields(value, "B", indentType);
  const missingC = sectionMissingFields(value, "C", indentType);
  const missingD = sectionMissingFields(value, "D", indentType);
  const locked = closed && !isAdmin;
  void defectiveParts;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("warehouses").select("id,name,code").eq("status", "Active").order("name");
      setWarehouses((data || []) as Warehouse[]);
    })();
  }, []);

  // Watch warehouse selection per row and refresh stock lists.
  const exchWhKey = value.exchange_rows.map((r) => r.warehouse_id).join("|");
  useEffect(() => {
    (async () => {
      const next: Record<number, StockRow[]> = {};
      await Promise.all(value.exchange_rows.map(async (r, i) => {
        if (!r.warehouse_id) { next[i] = []; return; }
        const { data } = await supabase.from("ims_stock_items")
          .select("id,part_name,part_model_no,part_serial_no,warehouse_id")
          .eq("warehouse_id", r.warehouse_id)
          .eq("stock_type", "good")
          .eq("stock_status", "available")
          .order("part_name");
        next[i] = (data || []) as StockRow[];
      }));
      setExchStockByRow(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchWhKey]);


  const setBlock = (patch: Partial<OracleBlock>) => onChange({ ...value, ...patch });
  const setExchRow = (i: number, patch: Partial<OracleExchangeRow>) =>
    setBlock({ exchange_rows: value.exchange_rows.map((r, ix) => ix === i ? { ...r, ...patch } : r) });
  const setRecvRow = (i: number, patch: Partial<OracleReceivedRow>) =>
    setBlock({ received_rows: value.received_rows.map((r, ix) => ix === i ? { ...r, ...patch } : r) });
  const custRows = value.customer_received_rows || [];
  const setCustRow = (i: number, patch: Partial<OracleReceivedRow>) =>
    setBlock({ customer_received_rows: custRows.map((r, ix) => ix === i ? { ...r, ...patch } : r) });
  const removeCustRow = (i: number) =>
    setBlock({ customer_received_rows: custRows.filter((_, ix) => ix !== i) });

  // Auto-close: once every defective/exchange/received row is fully filled,
  // mark the block closed automatically (no manual confirmation).
  useEffect(() => {
    if (closed || !canAutoClose) return;
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (cancelled) return;
      const uid = u.user?.id || null;
      const meta = (u.user?.user_metadata || {}) as { full_name?: string; name?: string };
      const name = meta.full_name || meta.name || u.user?.email || null;
      onChange({
        ...value,
        status: "closed",
        closed_by: uid,
        closed_by_name: name,
        closed_at: new Date().toISOString(),
      });
      toast.success(`Oracle ${value.oracle_no || `#${index + 1}`} auto-closed`);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAutoClose, closed]);

  const reopen = () => {
    // Local-only reset kept for non-controlled callers (no indentId): flips
    // block status but performs no stock reversal.
    onChange({ ...value, status: "open", closed_by: null, closed_by_name: null, closed_at: null });
    toast.success(`Oracle ${value.oracle_no || `#${index + 1}`} reopened`);
  };

  /** Serial numbers of the defective units in Section A — these must never
   *  be offered as exchange (good) stock. */
  const defectiveSerials = useMemo(
    () => new Set(value.defective_rows.map((d) => (d.def_serial_no || "").trim().toUpperCase()).filter(Boolean)),
    [value.defective_rows],
  );

  const modelsFor = (rows: StockRow[]) => {
    const seen = new Set<string>();
    const out: { key: string; label: string }[] = [];
    for (const s of rows) {
      const key = `${s.part_name}||${s.part_model_no || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: s.part_model_no || s.part_name });
    }
    return out;
  };
  const serialsFor = (rows: StockRow[], modelKey: string) => {
    const [pn, mn] = (modelKey || "").split("||");
    return rows.filter((s) =>
      s.part_name === pn &&
      (s.part_model_no || "") === (mn || "") &&
      !defectiveSerials.has((s.part_serial_no || "").trim().toUpperCase()),
    );
  };
  /** Ensure the currently-saved model/serial always renders in the Select,
   *  even if the underlying IMS row is no longer 'available' (e.g. issued
   *  after a DC was posted). Without this, saved values disappear on reopen. */
  const modelsWithSaved = (rows: StockRow[], savedKey: string) => {
    const list = modelsFor(rows);
    if (savedKey && !list.some((m) => m.key === savedKey)) {
      const [pn, mn] = savedKey.split("||");
      list.unshift({ key: savedKey, label: mn || pn });
    }
    return list;
  };
  const serialsWithSaved = (rows: StockRow[], modelKey: string, savedSerial: string) => {
    const list = serialsFor(rows, modelKey);
    if (savedSerial && !list.some((s) => (s.part_serial_no || s.id) === savedSerial)) {
      const [pn, mn] = (modelKey || "").split("||");
      list.unshift({ id: `saved:${savedSerial}`, part_name: pn || "", part_model_no: mn || null, part_serial_no: savedSerial, warehouse_id: null });
    }
    return list;
  };

  const checkStockAndValidate = async (rowIdx: number, qtyStr: string) => {
    const row = value.exchange_rows[rowIdx];
    const qty = parseInt(qtyStr, 10);
    if (!qty || !row?.warehouse_id || !row?.model_no) return;
    const [partName, modelNo] = row.model_no.split("||");
    const here = (exchStockByRow[rowIdx] || []).filter((s) => s.part_name === partName && (s.part_model_no || "") === modelNo).length;
    if (qty <= here) return;
    const { data: others } = await supabase.from("ims_stock_items")
      .select("id,warehouse_id")
      .eq("stock_status", "available")
      .eq("part_name", partName)
      .neq("warehouse_id", row.warehouse_id);
    const otherCount = (others || []).length;
    const totalElsewhere = otherCount;
    if (totalElsewhere > 0) {
      setShortageHasOther(true);
      setShortageMsg(`Only ${here} available in selected warehouse. ${totalElsewhere} available across other warehouses.`);
    } else {
      setShortageHasOther(false);
      setShortageMsg(`Insufficient stock available across all warehouses. Purchase/Order required.`);
    }
    setShortageOpen(true);
  };

  const oracleLabel = value.oracle_no ? value.oracle_no : `Oracle #${index + 1}`;

  // Progress metrics for collapsed summary.
  const defCount = value.defective_rows.length;
  const exchDone = value.exchange_rows.filter((r) => r.warehouse_id && r.model_no && r.serial_no && parseInt(String(r.qty || "0"), 10) > 0).length;
  const recvDone = value.received_rows.filter((r) => r.warehouse_id && r.model_no && r.serial_no && parseInt(String(r.qty || "0"), 10) > 0 && r.received_date).length;
  const totalSlots = Math.max(defCount, 1) * 3;
  const doneSlots = defCount + exchDone + recvDone;
  const pct = defCount === 0 ? 0 : Math.min(100, Math.round((doneSlots / totalSlots) * 100));

  return (
    <Card className={`border-2 ${closed ? "border-emerald-500/60 bg-emerald-500/5" : "border-amber-500/40"}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {onToggleCollapse && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleCollapse} aria-label={collapsed ? "Expand" : "Collapse"}>
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          )}
          <CardTitle className="text-base">Oracle {oracleLabel}</CardTitle>
          <Badge className={closed ? "bg-emerald-600 hover:bg-emerald-600" : "bg-amber-500 hover:bg-amber-500"}>{closed ? "Closed" : "Open"}</Badge>
          {value.reopened && (
            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">Reopened</Badge>
          )}
          {closed && value.force_closed && (
            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300" title={value.force_close_reason || undefined}>
              Force Closed
            </Badge>
          )}
          {collapsed && (
            <span className="text-xs text-muted-foreground inline-flex flex-wrap gap-x-3 gap-y-0.5">
              <span>Def: {defCount}</span>
              <span>Exch: {exchDone}/{defCount}</span>
              <span>Recv: {recvDone}/{defCount}</span>
              <span className="font-medium">{pct}%</span>
            </span>
          )}
          {closed && !collapsed && (
            <span className="text-xs text-muted-foreground">
              by {value.closed_by_name || "—"} · {value.closed_at ? new Date(value.closed_at).toLocaleString() : ""}
            </span>
          )}
          {closed && value.force_closed && value.force_close_reason && !collapsed && (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              Force close reason: {value.force_close_reason}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {closed ? (
            isAdmin ? (
              <Button variant="outline" size="sm" onClick={() => (indentId ? setReopenOpen(true) : reopen())}>
                <LockOpen className="h-4 w-4 mr-1" />Reopen
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground inline-flex items-center"><Lock className="h-3 w-3 mr-1" />Locked</span>
            )
          ) : (
            <>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {canAutoClose
                ? "Closing…"
                : complete && docsPending > 0
                  ? `Awaiting ${pendingParts.map((p) => `${p.n} ${p.label}`).join(" & ")} to be Submitted`
                  : complete
                    ? "Awaiting required DC / GRN to be generated & Submitted"
                    : "Auto-closes when all rows are complete & all required DC/GRN are Submitted"}
            </span>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setForceCloseOpen(true)} title="Admin: close this Oracle with a mandatory reason">
                <ShieldCheck className="h-4 w-4 mr-1" />Force Close
              </Button>
            )}
            </>
          )}
          {!closed && (
            <Button variant="ghost" size="icon" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
          )}
        </div>
      </CardHeader>
      {!collapsed && (
      <CardContent className={`space-y-4 ${locked ? "pointer-events-none opacity-80" : ""}`}>
        <div className="pointer-events-auto">
          <OraclePipeline
            oracle={value}
            indentType={indentType}
            pendingDocs={pendingDocs}
            docInfo={{ ...(docInfo || {}), dc: docInfo?.dc ?? (dcInfo ? { no: dcInfo.challan_no, status: dcInfo.status } : null) }}
            duplicateIndentNo={duplicateIndentNo}
            onGenerateChallan={onGenerateChallan}
            onGenerateGrn={onGenerateGrn}
            onGenerateCustomerGrn={onGenerateCustomerGrn}
          />
        </div>
        <div className="max-w-xs">
          <Label>Oracle #</Label>
          <Input
            type="text"
            value={value.oracle_no}
            onChange={(e) => setBlock({ oracle_no: e.target.value })}
            placeholder="Auto-set from Ticket"
            readOnly
            className="font-mono bg-muted/50"
          />
        </div>

        {/* Defective — auto-populated from ticket, read-only */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="text-sm font-semibold">A. Defective Parts (from Ticket — read-only)</div>
          {value.defective_rows.length === 0 && (
            <div className="text-xs text-muted-foreground">No defective parts tagged to this Oracle in the ticket.</div>
          )}
          {value.defective_rows.map((d, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-12 md:col-span-3"><Label>Parts / Item</Label><Input value={d.part_name || ""} readOnly className="bg-muted/50" /></div>
              <div className="col-span-12 md:col-span-3"><Label>DEF Part Model No</Label><Input value={d.def_model_no} readOnly className="bg-muted/50" /></div>
              <div className="col-span-12 md:col-span-3"><Label>DEF Part Serial No</Label><Input value={d.def_serial_no} readOnly className="font-mono bg-muted/50" /></div>
              <div className="col-span-12 md:col-span-3"><Label>Qty</Label><Input value={d.qty} readOnly className="bg-muted/50" /></div>
            </div>
          ))}
        </div>

        {/* Exchange — one row per defective row */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">B. Material Exchange (from IMS)</div>
            {onGenerateChallan && (dcExists ? (
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="secondary" className="font-mono">
                  DC {dcInfo?.challan_no || ""}{dcInfo?.status ? ` · ${dcInfo.status}` : ""}
                </Badge>
                {(dcInfo?.id || pendingDocs?.dc.doc_id) ? (
                  <DocLinkButtons kind="dc" docId={(dcInfo?.id || pendingDocs?.dc.doc_id) as string} />
                ) : (
                  <Button variant="outline" size="sm" disabled title="Delivery Challan already generated for this Oracle Number">
                    <FileText className="h-4 w-4 mr-1" />DC Generated
                  </Button>
                )}
              </div>
            ) : (
              <GenerateButton
                label="Generate Delivery Challan"
                icon="dc"
                missing={missingB}
                onClick={() => onGenerateChallan(value)}
              />
            ))}
          </div>
          {value.exchange_rows.map((ex, i) => {
            const stock = exchStockByRow[i] || [];
            const models = modelsWithSaved(stock, ex.model_no);
            const serials = serialsWithSaved(stock, ex.model_no, ex.serial_no);
            return (
              <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t first:border-t-0 first:pt-0">
                <div>
                  <Label>Warehouse <span className="text-muted-foreground text-xs">(Row {i + 1})</span></Label>
                  <Select
                    value={ex.warehouse_id}
                    onValueChange={(v) => {
                      const w = warehouses.find((x) => x.id === v);
                      setExchRow(i, { warehouse_id: v, warehouse_name: w?.name || "", model_no: "", serial_no: "" });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Material Exchange Model</Label>
                  <Select
                    value={ex.model_no}
                    onValueChange={(v) => setExchRow(i, { model_no: v, serial_no: "" })}
                    disabled={!ex.warehouse_id}
                  >
                    <SelectTrigger><SelectValue placeholder={ex.warehouse_id ? "Select model" : "Pick warehouse first"} /></SelectTrigger>
                    <SelectContent>{models.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Material Exchange Serial</Label>
                  <Select
                    value={ex.serial_no}
                    onValueChange={(v) => setExchRow(i, { serial_no: v })}
                    disabled={!ex.model_no}
                  >
                    <SelectTrigger><SelectValue placeholder={ex.model_no ? "Select serial" : "Pick model first"} /></SelectTrigger>
                    <SelectContent>{serials.map((s) => <SelectItem key={s.id} value={s.part_serial_no || s.id}>{s.part_serial_no || "(no serial)"}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Qty</Label>
                  <Input
                    type="number" min={1}
                    value={ex.qty}
                    onChange={(e) => setExchRow(i, { qty: e.target.value })}
                    onBlur={(e) => checkStockAndValidate(i, e.target.value)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Received — one row per defective row */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">C. Material Received (from OEM)</div>
            {onGenerateGrn && (docSatisfied(pendingDocs?.oem_grn) ? (
              <div className="flex items-center gap-2 text-xs">
                {docInfo?.oem_grn?.no && (
                  <Badge variant="secondary" className="font-mono">
                    {docInfo.oem_grn.no}{docInfo.oem_grn.status ? ` · ${docInfo.oem_grn.status}` : ""}
                  </Badge>
                )}
                {(docInfo?.oem_grn?.id || pendingDocs?.oem_grn.doc_id) ? (
                  <DocLinkButtons kind="grn" docId={(docInfo?.oem_grn?.id || pendingDocs?.oem_grn.doc_id) as string} />
                ) : (
                  <Button variant="outline" size="sm" disabled><Receipt className="h-4 w-4 mr-1" />GRN Generated</Button>
                )}
              </div>
            ) : (
              <GenerateButton
                label="Generate GRN"
                icon="grn"
                missing={missingC}
                onClick={() => onGenerateGrn(value)}
              />
            ))}
          </div>
          {value.received_rows.map((rcv, i) => {
            const def = value.defective_rows[i];
            return (
              <div key={i} className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t first:border-t-0 first:pt-0">
                <div>
                  <Label>Warehouse <span className="text-muted-foreground text-xs">(Row {i + 1})</span></Label>
                  <Select
                    value={rcv.warehouse_id}
                    onValueChange={(v) => {
                      const w = warehouses.find((x) => x.id === v);
                      setRecvRow(i, { warehouse_id: v, warehouse_name: w?.name || "" });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Material Rec Model No <span className="text-muted-foreground text-xs">(Product Master)</span></Label>
                  <IndentModelPicker
                    value={rcv.model_no || ""}
                    onPick={({ name, model }) => setRecvRow(i, { part_name: name, model_no: model })}
                    placeholder={def?.def_model_no || "Select model"}
                  />
                </div>
                <div>
                  <Label>Material Rec Serial No</Label>
                  <Input
                    value={rcv.serial_no}
                    onChange={(e) => setRecvRow(i, { serial_no: e.target.value })}
                    placeholder={def?.def_serial_no || "Serial No"}
                    className="font-mono"
                  />
                </div>
                <div><Label>Qty</Label><Input type="number" min={1} value={rcv.qty} onChange={(e) => setRecvRow(i, { qty: e.target.value })} /></div>
                <div><Label>Material Rec Date</Label><Input type="date" value={rcv.received_date} onChange={(e) => setRecvRow(i, { received_date: e.target.value })} /></div>
                <div className="md:col-span-3"><Label>Remarks</Label><Textarea rows={2} value={rcv.remarks} onChange={(e) => setRecvRow(i, { remarks: e.target.value })} /></div>
              </div>
            );
          })}
        </div>

        {/* Section D — Material Received (from Customer) */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">D. Material Received (from Customer)</div>
            <div className="flex items-center gap-2">
              {onGenerateCustomerGrn && (docSatisfied(pendingDocs?.customer_grn) ? (
                <div className="flex items-center gap-2 text-xs">
                  {docInfo?.customer_grn?.no && (
                    <Badge variant="secondary" className="font-mono">
                      {docInfo.customer_grn.no}{docInfo.customer_grn.status ? ` · ${docInfo.customer_grn.status}` : ""}
                    </Badge>
                  )}
                  {(docInfo?.customer_grn?.id || pendingDocs?.customer_grn.doc_id) ? (
                    <DocLinkButtons kind="grn" docId={(docInfo?.customer_grn?.id || pendingDocs?.customer_grn.doc_id) as string} />
                  ) : (
                    <Button variant="outline" size="sm" disabled><Receipt className="h-4 w-4 mr-1" />GRN Generated</Button>
                  )}
                </div>
              ) : (
                <GenerateButton
                  label="Generate GRN"
                  icon="grn"
                  missing={missingD}
                  onClick={() => onGenerateCustomerGrn(value)}
                />
              ))}
            </div>
          </div>
          {custRows.map((rcv, i) => {
            const def = value.defective_rows[i] || value.defective_rows[0];
            return (
              <div key={i} className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t first:border-t-0 first:pt-0">
                <div>
                  <Label>Warehouse <span className="text-muted-foreground text-xs">(Row {i + 1})</span></Label>
                  <Select
                    value={rcv.warehouse_id}
                    onValueChange={(v) => {
                      const w = warehouses.find((x) => x.id === v);
                      setCustRow(i, { warehouse_id: v, warehouse_name: w?.name || "" });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Product Tag / Condition <span className="text-destructive">*</span></Label>
                  <Select
                    value={rcv.product_tag || ""}
                    onValueChange={(v) => setCustRow(i, { product_tag: v as ProductTag })}
                  >
                    <SelectTrigger><SelectValue placeholder="Select condition" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="good">🟢 Good</SelectItem>
                      <SelectItem value="defective">🔴 Defective</SelectItem>
                      <SelectItem value="scrap">⚫ Scrap</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Material Rec Model No <span className="text-muted-foreground text-xs">(Product Master)</span></Label>
                  <IndentModelPicker
                    value={rcv.model_no || ""}
                    onPick={({ name, model }) => setCustRow(i, { part_name: name, model_no: model })}
                    placeholder={def?.def_model_no || "Select model"}
                  />
                </div>
                <div>
                  <Label>Material Rec Serial No</Label>
                  <Input
                    value={rcv.serial_no}
                    onChange={(e) => setCustRow(i, { serial_no: e.target.value })}
                    placeholder={def?.def_serial_no || "Serial No"}
                    className="font-mono"
                  />
                </div>
                <div><Label>Qty</Label><Input type="number" min={1} value={rcv.qty} onChange={(e) => setCustRow(i, { qty: e.target.value })} placeholder={def?.qty || "1"} /></div>
                <div><Label>Material Rec Date</Label><Input type="date" value={rcv.received_date} onChange={(e) => setCustRow(i, { received_date: e.target.value })} /></div>
                <div className="md:col-span-3 flex gap-2 items-end">
                  <div className="flex-1"><Label>Remarks</Label><Textarea rows={2} value={rcv.remarks} onChange={(e) => setCustRow(i, { remarks: e.target.value })} /></div>
                  {!locked && (
                    <Button variant="ghost" size="icon" onClick={() => removeCustRow(i)} title="Remove row">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      )}

      <ControlledActionDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title={`Reopen Oracle ${value.oracle_no || `#${index + 1}`}?`}
        description="This will reverse stock and document flow for the selected scope. Affected GRNs move back to Draft, and DCs release their reserved/issued stock. All actions are audited."
        warning="This will reverse stock & document flow. Reopening is blocked if any linked Invoice exists — use the correction workflow instead."
        scopes={[
          { value: "grn", label: "GRN only", hint: "Reverse GRN receipts on this indent." },
          { value: "dc", label: "DC only", hint: "Release stock issued via Delivery Challans." },
          { value: "full", label: "Full cycle", hint: "Reverse both GRNs and DCs." },
        ]}
        defaultScope="full"
        confirmLabel="Reopen Oracle"
        reasonPlaceholder="e.g., Wrong serial dispatched, OEM sent replacement in error…"
        onConfirm={async ({ reason, scope }) => {
          if (!indentId) return { error: "Missing indent id" };
          const { error } = await supabase.rpc("admin_reopen_oracle" as never, {
            _indent_id: indentId,
            _oracle_no: value.oracle_no || "",
            _reason: reason,
            _scope: scope || "full",
          } as never);
          if (error) return { error: error.message };
          toast.success(`Oracle ${value.oracle_no || `#${index + 1}`} reopened`);
          onChange({
            ...value,
            status: "open",
            closed_by: null,
            closed_by_name: null,
            closed_at: null,
            reopened: {
              at: new Date().toISOString(),
              by: null,
              reason,
              scope: (scope as "grn" | "dc" | "full") || "full",
            },
          });
        }}
      />
      <ControlledActionDialog
        open={forceCloseOpen}
        onOpenChange={setForceCloseOpen}
        title={`Force Close Oracle ${value.oracle_no || `#${index + 1}`}?`}
        description="Admin override: closes this Oracle even though its sections / documents are not complete. The reason is stored on the record and shown as a Force Closed badge."
        warning="This bypasses the normal auto-close checks. No stock or document changes are made."
        confirmLabel="Force Close Oracle"
        reasonPlaceholder="e.g., Section B completed via standalone DC-CUST/2026/0101, backfilled manually"
        onConfirm={async ({ reason }) => {
          const { data: u } = await supabase.auth.getUser();
          const meta = (u.user?.user_metadata || {}) as { full_name?: string; name?: string };
          onChange({
            ...value,
            status: "closed",
            closed_by: u.user?.id || null,
            closed_by_name: meta.full_name || meta.name || u.user?.email || null,
            closed_at: new Date().toISOString(),
            force_closed: true,
            force_close_reason: reason,
          });
          toast.success(`Oracle ${value.oracle_no || `#${index + 1}`} force-closed`);
        }}
      />
      <AlertDialog open={shortageOpen} onOpenChange={setShortageOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{shortageHasOther ? "Stock shortage in selected warehouse" : "Insufficient stock"}</AlertDialogTitle>
            <AlertDialogDescription>
              {shortageMsg}
              {shortageHasOther ? " Create Stock Transfer Request?" : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {shortageHasOther && (
              <AlertDialogAction onClick={() => { window.location.href = "/ims/transfers/new"; }}>
                Create Transfer
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </Card>
  );
}