import { useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/DatePicker";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, ClipboardPaste, Upload, PackageOpen } from "lucide-react";
import { listWarehouses, type WarehouseLite } from "@/lib/ims";
import { cn } from "@/lib/utils";

export type OpeningStockState = {
  enabled: boolean;
  date: string;                // YYYY-MM-DD
  warehouse_id: string;
  unit_cost: string;
  stock_type: "good" | "defective";
  qty: string;
  serials: string[];
};

export const emptyOpeningStock = (): OpeningStockState => ({
  enabled: false,
  date: new Date().toISOString().slice(0, 10),
  warehouse_id: "",
  unit_cost: "",
  stock_type: "good",
  qty: "",
  serials: [],
});

/** Validate the opening-stock form. Returns error string, or null when valid. */
export function validateOpeningStock(
  s: OpeningStockState,
  serialTracked: boolean,
): string | null {
  if (!s.enabled) return null;
  if (!s.warehouse_id) return "Opening Stock: Warehouse is required";
  const q = Number(s.qty);
  if (!q || q <= 0) return "Opening Stock: Quantity must be greater than 0";
  if (serialTracked) {
    const cleaned = s.serials.map((x) => x.trim()).filter(Boolean);
    if (cleaned.length !== q) return `Opening Stock: Enter ${q} serial number(s)`;
    const unique = new Set(cleaned.map((x) => x.toUpperCase()));
    if (unique.size !== cleaned.length) return "Opening Stock: Serial numbers must be unique";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => { listWarehouses().then(setWarehouses).catch(() => {}); }, []);

  const qty = Number(value.qty) || 0;

  // Keep serials array synced to quantity while preserving typed values.
  useEffect(() => {
    if (!serialTracked || !value.enabled) return;
    if (value.serials.length === qty) return;
    const next = [...value.serials];
    if (qty > next.length) while (next.length < qty) next.push("");
    else next.length = qty;
    onChange({ ...value, serials: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty, serialTracked, value.enabled]);

  const dupSet = useMemo(() => {
    const map = new Map<string, number>();
    value.serials.forEach((s) => {
      const k = s.trim().toUpperCase();
      if (!k) return;
      map.set(k, (map.get(k) || 0) + 1);
    });
    return new Set(Array.from(map.entries()).filter(([, n]) => n > 1).map(([k]) => k));
  }, [value.serials]);

  const gridCls = qty > 10
    ? "grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1"
    : qty > 4
      ? "grid grid-cols-1 sm:grid-cols-2 gap-2"
      : "grid grid-cols-1 gap-2";

  function applyPaste(text: string) {
    const lines = text.split(/\r?\n|,|;|\t/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return;
    const next = [...value.serials];
    // grow to fit pasted list
    if (lines.length > next.length) while (next.length < lines.length) next.push("");
    lines.forEach((v, i) => { next[i] = v; });
    onChange({
      ...value,
      qty: String(Math.max(lines.length, qty)),
      serials: next,
    });
  }

  async function onCsv(file: File) {
    const text = await file.text();
    applyPaste(text);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border p-3 bg-muted/20">
        <div className="flex items-center gap-2">
          <PackageOpen className="h-4 w-4 text-primary" />
          <div>
            <Label className="text-sm font-medium">Enable Opening Stock</Label>
            <p className="text-[11px] text-muted-foreground">
              Record on-hand inventory for {productLabel || "this product"} at product creation.
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
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label>Opening Date</Label>
              <DatePicker
                value={value.date}
                onChange={(d) => onChange({ ...value, date: d })}
                disabled={readOnly}
              />
            </div>
            <div>
              <Label>Warehouse / Branch *</Label>
              <Select
                value={value.warehouse_id}
                onValueChange={(v) => onChange({ ...value, warehouse_id: v })}
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
              <Label>Unit Cost (₹)</Label>
              <Input
                type="number" min="0" step="0.01"
                value={value.unit_cost}
                onChange={(e) => onChange({ ...value, unit_cost: e.target.value })}
                placeholder="Optional"
                disabled={readOnly}
              />
            </div>
            <div>
              <Label>Stock Type</Label>
              <Select
                value={value.stock_type}
                onValueChange={(v) => onChange({ ...value, stock_type: v as "good" | "defective" })}
                disabled={readOnly}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="defective">Defective</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{serialTracked ? "Quantity *" : "Opening Quantity *"}</Label>
              <Input
                type="number" min="1" step="1"
                value={value.qty}
                onChange={(e) => onChange({ ...value, qty: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="0"
                disabled={readOnly}
              />
            </div>
          </div>

          {serialTracked && qty > 0 && (
            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <Label className="text-sm font-medium">Serial Numbers *</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Enter one serial per unit ({qty} required). Duplicates are highlighted.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setPasteOpen((o) => !o)} disabled={readOnly}>
                    <ClipboardPaste className="h-3.5 w-3.5 mr-1" /> Paste Serial Numbers
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={readOnly}>
                    <Upload className="h-3.5 w-3.5 mr-1" /> Upload CSV
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onCsv(f); e.target.value = ""; }}
                  />
                </div>
              </div>

              {pasteOpen && (
                <div className="space-y-2">
                  <Textarea
                    rows={4}
                    placeholder={"Paste one serial per line, e.g.\nXYZ1\nXYZ2\nXYZ3"}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setPasteOpen(false); setPasteText(""); }}>Cancel</Button>
                    <Button type="button" size="sm" onClick={() => { applyPaste(pasteText); setPasteText(""); setPasteOpen(false); }}>
                      Apply
                    </Button>
                  </div>
                </div>
              )}

              <div className={gridCls}>
                {value.serials.map((s, i) => {
                  const key = s.trim().toUpperCase();
                  const isDup = !!key && dupSet.has(key);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground w-14 shrink-0">Serial {i + 1}</span>
                      <Input
                        value={s}
                        onChange={(e) => {
                          const next = [...value.serials];
                          next[i] = e.target.value;
                          onChange({ ...value, serials: next });
                        }}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== s) {
                            const next = [...value.serials];
                            next[i] = v;
                            onChange({ ...value, serials: next });
                          }
                        }}
                        placeholder={`SN-${String(i + 1).padStart(3, "0")}`}
                        className={cn("font-mono h-8", isDup && "border-destructive text-destructive")}
                        disabled={readOnly}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
  warehouseName,
}: {
  state: OpeningStockState;
  warehouseName?: string | null;
}) {
  const qty = Number(state.qty) || 0;
  if (!state.enabled || qty <= 0) {
    return (
      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 bg-amber-50">
        <AlertTriangle className="h-3 w-3" /> No Opening Stock Added
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-emerald-700 border-emerald-300 bg-emerald-50">
      <CheckCircle2 className="h-3 w-3" />
      Opening Stock: {qty} Units{warehouseName ? ` (${warehouseName})` : ""}
    </Badge>
  );
}