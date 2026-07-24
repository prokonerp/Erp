import { useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/DatePicker";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, ClipboardPaste, Upload, PackageOpen, Plus, Trash2 } from "lucide-react";
import { listWarehouses, type WarehouseLite } from "@/lib/ims";
import { cn } from "@/lib/utils";

export type OpeningStockRow = {
  warehouse_id: string;
  unit_cost: string;
  stock_type: "good" | "defective";
  qty: string;
  serials: string[];
};

export type OpeningStockState = {
  enabled: boolean;
  date: string; // YYYY-MM-DD
  rows: OpeningStockRow[];
};

export const emptyOpeningRow = (): OpeningStockRow => ({
  warehouse_id: "",
  unit_cost: "",
  stock_type: "good",
  qty: "",
  serials: [],
});

export const emptyOpeningStock = (): OpeningStockState => ({
  enabled: false,
  date: new Date().toISOString().slice(0, 10),
  rows: [emptyOpeningRow()],
});

/** Validate the opening-stock form. Returns error string, or null when valid. */
export function validateOpeningStock(
  s: OpeningStockState,
  serialTracked: boolean,
): string | null {
  if (!s.enabled) return null;
  if (!s.rows.length) return "Opening Stock: Add at least one warehouse row";
  const whSeen = new Set<string>();
  const allSerials: string[] = [];
  for (let i = 0; i < s.rows.length; i++) {
    const r = s.rows[i];
    const tag = `Row ${i + 1}`;
    if (!r.warehouse_id) return `Opening Stock: ${tag} — Warehouse is required`;
    if (whSeen.has(r.warehouse_id)) return `Opening Stock: ${tag} — Warehouse cannot repeat`;
    whSeen.add(r.warehouse_id);
    const q = Number(r.qty);
    if (!q || q <= 0) return `Opening Stock: ${tag} — Quantity must be greater than 0`;
    if (serialTracked) {
      const cleaned = r.serials.map((x) => x.trim()).filter(Boolean);
      if (cleaned.length !== q) return `Opening Stock: ${tag} — Enter ${q} serial number(s)`;
      const dupInRow = new Set(cleaned.map((x) => x.toUpperCase()));
      if (dupInRow.size !== cleaned.length) return `Opening Stock: ${tag} — Serial numbers must be unique`;
      allSerials.push(...cleaned.map((x) => x.toUpperCase()));
    }
  }
  if (serialTracked) {
    const uniq = new Set(allSerials);
    if (uniq.size !== allSerials.length) return "Opening Stock: Serial numbers must be unique across all warehouses";
  }
  return null;
}

export function ProductOpeningStock({
  value,
  onChange,
  serialTracked,
  productLabel,
  readOnly,
}: {
  value: OpeningStockState;
  onChange: (next: OpeningStockState) => void;
  serialTracked: boolean;
  productLabel?: string;
  readOnly?: boolean;
}) {
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [pasteFor, setPasteFor] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState("");
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => { listWarehouses().then(setWarehouses).catch(() => {}); }, []);

  // Keep serials array synced to qty on every row.
  useEffect(() => {
    if (!serialTracked || !value.enabled) return;
    let dirty = false;
    const rows = value.rows.map((r) => {
      const q = Number(r.qty) || 0;
      if (r.serials.length === q) return r;
      dirty = true;
      const next = [...r.serials];
      if (q > next.length) while (next.length < q) next.push("");
      else next.length = q;
      return { ...r, serials: next };
    });
    if (dirty) onChange({ ...value, rows });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialTracked, value.enabled, value.rows.map((r) => r.qty).join("|")]);

  // Duplicates highlighted across all warehouses.
  const globalDupSet = useMemo(() => {
    const map = new Map<string, number>();
    value.rows.forEach((r) => r.serials.forEach((s) => {
      const k = s.trim().toUpperCase();
      if (!k) return;
      map.set(k, (map.get(k) || 0) + 1);
    }));
    return new Set(Array.from(map.entries()).filter(([, n]) => n > 1).map(([k]) => k));
  }, [value.rows]);

  function updateRow(i: number, patch: Partial<OpeningStockRow>) {
    const rows = value.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange({ ...value, rows });
  }
  function removeRow(i: number) {
    const rows = value.rows.filter((_, idx) => idx !== i);
    onChange({ ...value, rows: rows.length ? rows : [emptyOpeningRow()] });
  }
  function addRow() {
    onChange({ ...value, rows: [...value.rows, emptyOpeningRow()] });
  }

  function applyPaste(i: number, text: string) {
    const lines = text.split(/\r?\n|,|;|\t/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return;
    const row = value.rows[i];
    const q = Math.max(lines.length, Number(row.qty) || 0);
    const next = [...row.serials];
    if (lines.length > next.length) while (next.length < lines.length) next.push("");
    lines.forEach((v, idx) => { next[idx] = v; });
    updateRow(i, { qty: String(q), serials: next });
  }
  async function onCsv(i: number, file: File) {
    const text = await file.text();
    applyPaste(i, text);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border p-3 bg-muted/20">
        <div className="flex items-center gap-2">
          <PackageOpen className="h-4 w-4 text-primary" />
          <div>
            <Label className="text-sm font-medium">Enable Opening Stock</Label>
            <p className="text-[11px] text-muted-foreground">
              Record on-hand inventory for {productLabel || "this product"} across one or more warehouses.
            </p>
          </div>
        </div>
        <Switch
          checked={value.enabled}
          onCheckedChange={(v) => onChange({ ...value, enabled: v })}
          disabled={readOnly}
        />
      </div>

      {value.enabled && (
        <div className="space-y-4">
          <div className="max-w-xs">
            <Label>Opening Date</Label>
            <DatePicker
              value={value.date}
              onChange={(d) => onChange({ ...value, date: d })}
              disabled={readOnly}
            />
          </div>

          <div className="space-y-3">
            {value.rows.map((row, i) => {
              const q = Number(row.qty) || 0;
              const gridCls = q > 10
                ? "grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1"
                : q > 4
                  ? "grid grid-cols-1 sm:grid-cols-2 gap-2"
                  : "grid grid-cols-1 gap-2";
              return (
                <div key={i} className="rounded-md border p-3 space-y-3 bg-background">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Warehouse Row {i + 1}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeRow(i)}
                      disabled={readOnly || value.rows.length <= 1} className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                    </Button>
                  </div>

                  <div className="grid md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                      <Label>Warehouse / Branch *</Label>
                      <Select
                        value={row.warehouse_id}
                        onValueChange={(v) => updateRow(i, { warehouse_id: v })}
                        disabled={readOnly}
                      >
                        <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                        <SelectContent>
                          {warehouses.map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.name}{w.type ? ` (${w.type})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{serialTracked ? "Quantity *" : "Opening Qty *"}</Label>
                      <Input
                        type="number" min="1" step="1"
                        value={row.qty}
                        onChange={(e) => updateRow(i, { qty: e.target.value.replace(/[^0-9]/g, "") })}
                        placeholder="0"
                        disabled={readOnly}
                      />
                    </div>
                    <div>
                      <Label>Unit Cost (₹)</Label>
                      <Input
                        type="number" min="0" step="0.01"
                        value={row.unit_cost}
                        onChange={(e) => updateRow(i, { unit_cost: e.target.value })}
                        placeholder="Optional"
                        disabled={readOnly}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Stock Type</Label>
                      <Select
                        value={row.stock_type}
                        onValueChange={(v) => updateRow(i, { stock_type: v as "good" | "defective" })}
                        disabled={readOnly}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="good">Good</SelectItem>
                          <SelectItem value="defective">Defective</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {serialTracked && q > 0 && (
                    <div className="rounded-md border p-3 space-y-3 bg-muted/20">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <Label className="text-sm font-medium">Serial Numbers * ({q})</Label>
                          <p className="text-[11px] text-muted-foreground">
                            Duplicates highlighted; must be unique across all warehouses.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button type="button" size="sm" variant="outline"
                            onClick={() => { setPasteFor(pasteFor === i ? null : i); setPasteText(""); }}
                            disabled={readOnly}>
                            <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Paste
                          </Button>
                          <Button type="button" size="sm" variant="outline"
                            onClick={() => fileRefs.current[i]?.click()} disabled={readOnly}>
                            <Upload className="h-3.5 w-3.5 mr-1" /> CSV
                          </Button>
                          <input
                            ref={(el) => { fileRefs.current[i] = el; }}
                            type="file" accept=".csv,.txt" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(i, f); e.target.value = ""; }}
                          />
                        </div>
                      </div>

                      {pasteFor === i && (
                        <div className="space-y-2">
                          <Textarea rows={4} placeholder={"Paste one serial per line"}
                            value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="ghost"
                              onClick={() => { setPasteFor(null); setPasteText(""); }}>Cancel</Button>
                            <Button type="button" size="sm"
                              onClick={() => { applyPaste(i, pasteText); setPasteText(""); setPasteFor(null); }}>
                              Apply
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className={gridCls}>
                        {row.serials.map((s, si) => {
                          const key = s.trim().toUpperCase();
                          const isDup = !!key && globalDupSet.has(key);
                          return (
                            <div key={si} className="flex items-center gap-2">
                              <span className="text-[11px] text-muted-foreground w-14 shrink-0">Serial {si + 1}</span>
                              <Input
                                value={s}
                                onChange={(e) => {
                                  const next = [...row.serials];
                                  next[si] = e.target.value;
                                  updateRow(i, { serials: next });
                                }}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v !== s) {
                                    const next = [...row.serials];
                                    next[si] = v;
                                    updateRow(i, { serials: next });
                                  }
                                }}
                                placeholder={`SN-${String(si + 1).padStart(3, "0")}`}
                                className={cn("font-mono h-8", isDup && "border-destructive text-destructive")}
                                disabled={readOnly}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={readOnly}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Warehouse Row
          </Button>

          {readOnly && (
            <p className="text-[11px] text-muted-foreground italic">
              Opening stock has been posted. Only admins can edit it directly; users must adjust via Stock Adjustment.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Top-right status badge shown in the product dialog header. */
export function OpeningStockBadge({
  state,
  warehouseNames,
}: {
  state: OpeningStockState;
  warehouseNames?: (string | null | undefined)[];
}) {
  const totalQty = state.rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const whCount = state.rows.filter((r) => r.warehouse_id).length;
  if (!state.enabled || totalQty <= 0) {
    return (
      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50">
        <AlertTriangle className="h-3 w-3" /> No Opening Stock Added
      </Badge>
    );
  }
  const names = (warehouseNames || []).filter(Boolean).slice(0, 2).join(", ");
  const extra = whCount > 2 ? ` +${whCount - 2}` : "";
  return (
    <Badge variant="outline" className="gap-1 text-emerald-700 border-emerald-300 bg-emerald-50">
      <CheckCircle2 className="h-3 w-3" />
      Opening Stock: {totalQty} Units{names ? ` (${names}${extra})` : ""}
    </Badge>
  );
}