import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download } from "lucide-react";
import { exportCSV, type ExportColumn } from "@/lib/exports";
import type { StockItem, WarehouseLite, ProductLite } from "@/lib/ims";

/** Same grouping key as ProductStockSummary (model | name | oem). */
const groupKey = (r: StockItem) =>
  `${(r.part_model_no || "").toLowerCase()}|${(r.part_name || "").toLowerCase()}|${(r.oem || "").toLowerCase()}`;

type Bucket = "good" | "defective" | "scrap";

type Row = {
  key: string;
  item: string;
  model: string | null;
  oem: string | null;
  /** warehouseId -> bucket -> qty (absent = never any stock of that kind) */
  cells: Record<string, Partial<Record<Bucket, number>>>;
};

function bucketOf(r: StockItem): Bucket | null {
  if (r.stock_status === "scrapped") return "scrap";
  if (r.stock_type === "good") return "good";
  if (r.stock_type === "defective") return "defective";
  return null;
}

function buildRows(stock: StockItem[], whIds: Set<string>): Row[] {
  const map = new Map<string, Row>();
  for (const r of stock) {
    const wid = r.warehouse_id || "";
    if (!whIds.has(wid)) continue;
    const b = bucketOf(r);
    if (!b) continue;
    const key = groupKey(r);
    let g = map.get(key);
    if (!g) {
      g = { key, item: r.part_name, model: r.part_model_no, oem: r.oem, cells: {} };
      map.set(key, g);
    }
    const cell = (g.cells[wid] ||= {});
    cell[b] = (cell[b] || 0) + (Number(r.qty ?? 1) || 0);
  }
  return [...map.values()].sort((a, b) => a.item.localeCompare(b.item));
}

const cellVal = (row: Row, wid: string, b: Bucket) => row.cells[wid]?.[b];
const rowTotal = (row: Row, whs: WarehouseLite[], buckets: Bucket[]) =>
  whs.reduce((s, w) => s + buckets.reduce((t, b) => t + (cellVal(row, w.id, b) ?? 0), 0), 0);

function StockMatrix({
  title,
  warehouses,
  buckets,
  rows,
  withTotal,
  exportName,
}: {
  title: string;
  warehouses: WarehouseLite[];
  buckets: Bucket[];
  rows: Row[];
  withTotal: boolean;
  exportName: string;
}) {
  const label: Record<Bucket, string> = { good: "Good", defective: "Defective", scrap: "Scrap" };

  const colTotal = (wid: string, b: Bucket) => {
    let has = false;
    let sum = 0;
    for (const r of rows) {
      const v = cellVal(r, wid, b);
      if (v !== undefined) { has = true; sum += v; }
    }
    return has ? sum : undefined;
  };
  const grandTotal = rows.reduce((s, r) => s + rowTotal(r, warehouses, buckets), 0);

  function download() {
    const cols: ExportColumn<Row>[] = [{ header: "Item", get: (r) => r.item }];
    for (const w of warehouses) {
      for (const b of buckets) {
        cols.push({ header: `${w.name} — ${label[b]}`, get: (r) => cellVal(r, w.id, b) ?? "" });
      }
    }
    if (withTotal) cols.push({ header: "Total", get: (r) => rowTotal(r, warehouses, buckets) });
    exportCSV(exportName, cols, rows);
  }

  const span = buckets.length;
  const colCount = 1 + warehouses.length * span + (withTotal ? 1 : 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button size="sm" variant="outline" onClick={download} disabled={rows.length === 0}>
          <Download className="h-4 w-4 mr-1" />Download as CSV
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted/50">
              <tr>
                <th rowSpan={2} className="p-2 text-left border">Item</th>
                {warehouses.map((w) => (
                  <th key={w.id} colSpan={span} className="p-2 text-center border">{w.name}</th>
                ))}
                {withTotal && <th rowSpan={2} className="p-2 text-right border">Total</th>}
              </tr>
              <tr>
                {warehouses.map((w) =>
                  buckets.map((b) => (
                    <th key={`${w.id}-${b}`} className="p-2 text-right border text-xs font-medium">{label[b]}</th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {warehouses.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={colCount}>No warehouses of this type configured.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={colCount}>No stock found.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.key} className="hover:bg-muted/30">
                  <td className="p-2 border">
                    {r.item}
                    {r.model ? <span className="text-xs text-muted-foreground"> · {r.model}</span> : null}
                  </td>
                  {warehouses.map((w) =>
                    buckets.map((b) => {
                      const v = cellVal(r, w.id, b);
                      return <td key={`${w.id}-${b}`} className="p-2 border text-right">{v === undefined ? "" : v}</td>;
                    }),
                  )}
                  {withTotal && <td className="p-2 border text-right font-medium">{rowTotal(r, warehouses, buckets)}</td>}
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-muted/50 font-medium">
                <tr>
                  <td className="p-2 border">Total</td>
                  {warehouses.map((w) =>
                    buckets.map((b) => {
                      const v = colTotal(w.id, b);
                      return <td key={`${w.id}-${b}`} className="p-2 border text-right">{v === undefined ? "" : v}</td>;
                    }),
                  )}
                  {withTotal && <td className="p-2 border text-right">{grandTotal}</td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function SalesServiceStockTables({
  stock,
  warehouses,
  loading,
}: {
  stock: StockItem[];
  warehouses: WarehouseLite[];
  loading?: boolean;
}) {
  const [q, setQ] = useState("");

  const norm = (t: string | null | undefined) => (t || "").trim().toLowerCase();
  const godowns = useMemo(() => warehouses.filter((w) => norm(w.type) === "godown"), [warehouses]);
  const services = useMemo(() => warehouses.filter((w) => norm(w.type) === "service centre"), [warehouses]);

  const salesRows = useMemo(() => buildRows(stock, new Set(godowns.map((w) => w.id))), [stock, godowns]);
  const serviceRows = useMemo(() => buildRows(stock, new Set(services.map((w) => w.id))), [stock, services]);

  const filter = (rows: Row[]) => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => [r.item, r.model, r.oem].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)));
  };

  if (loading) {
    return (
      <Card><CardHeader><CardTitle className="text-base">Sales &amp; Service Stock</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">Loading…</CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <Input placeholder="Search item name, model no or OEM…" value={q} onChange={(e) => setQ(e.target.value)} />
      <StockMatrix
        title="Sales Stock"
        warehouses={godowns}
        buckets={["good", "scrap"]}
        rows={filter(salesRows)}
        withTotal
        exportName="ims_sales_stock"
      />
      <StockMatrix
        title="Service Stock"
        warehouses={services}
        buckets={["good", "defective", "scrap"]}
        rows={filter(serviceRows)}
        withTotal={false}
        exportName="ims_service_stock"
      />
    </div>
  );
}
