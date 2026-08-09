import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { StockStatusBadge } from "@/components/StockStatusBadge";
import { exportCSV } from "@/lib/exports";
import { STOCK_TYPE_LABEL, type StockItem, type WarehouseLite, type ProductLite } from "@/lib/ims";
import { qtyCellClass } from "@/lib/negativeStock";

const LOW_STOCK_THRESHOLD = 3;

type Group = {
  key: string;
  oem: string | null;
  model: string;
  total: number;
  available: number;
  reservedIssued: number;
  defective: number;
  byWarehouse: Record<string, number>;
  rows: StockItem[];
};

type SortKey = "model" | "oem" | "total" | "available" | "reservedIssued" | "defective";

export function ProductStockSummary({
  stock,
  warehouses,
  products,
  whName,
  loading,
}: {
  stock: StockItem[];
  warehouses: WarehouseLite[];
  products: ProductLite[];
  whName: (id: string | null | undefined) => string;
  loading?: boolean;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "model", dir: "asc" });
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const productMap = useMemo(() => {
    const map = new Map<string, ProductLite>();
    for (const p of products) {
      if (p.model) map.set(p.model, p);
    }
    return map;
  }, [products]);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const r of stock) {
      const product = r.part_model_no ? productMap.get(r.part_model_no) : undefined;
      if (!product || product.item_type !== "product") continue;
      const key = `${(r.part_model_no || "").toLowerCase()}|${(r.oem || "").toLowerCase()}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key, oem: r.oem, model: product.model || r.part_model_no || "—",
          total: 0, available: 0, reservedIssued: 0, defective: 0, byWarehouse: {}, rows: [],
        };
        map.set(key, g);
      }
      const qty = Number(r.qty ?? 1) || 0;
      g.total += qty;
      if (r.stock_status === "available") g.available += qty;
      if (r.stock_status === "reserved" || r.stock_status === "issued") g.reservedIssued += qty;
      if (r.stock_type === "defective" && r.stock_status !== "scrapped") g.defective += qty;
      const wid = r.warehouse_id || "unassigned";
      g.byWarehouse[wid] = (g.byWarehouse[wid] || 0) + qty;
      g.rows.push(r);
    }
    return [...map.values()];
  }, [stock, productMap]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? groups.filter((g) => [g.model, g.oem].filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(term)))
      : groups;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sort.key] as string | number | null;
      const bv = b[sort.key] as string | number | null;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [groups, q, sort]);

  function th(label: string, key: SortKey, align = "left") {
    const active = sort.key === key;
    return (
      <th className={`p-2 cursor-pointer select-none ${align === "right" ? "text-right" : "text-left"}`}
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))}>
        {label}{active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  function download() {
    exportCSV("ims_product_stock_summary", [
      { header: "OEM", get: (r: Group) => r.oem },
      { header: "Model", get: (r: Group) => r.model },
      { header: "Total Qty", get: (r: Group) => r.total },
      { header: "Available", get: (r: Group) => r.available },
      { header: "Reserved/Issued", get: (r: Group) => r.reservedIssued },
      { header: "Defective", get: (r: Group) => r.defective },
      { header: "Warehouses", get: (r: Group) => Object.entries(r.byWarehouse).map(([id, n]) => `${whName(id === "unassigned" ? null : id)}: ${n}`).join(" | ") },
    ], filtered);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Product-wise Stock Summary</CardTitle>
        <Button size="sm" variant="outline" onClick={download} disabled={filtered.length === 0}>
          <Download className="h-4 w-4 mr-1" />Download CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="Search by product name, model no or OEM…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 w-8" />
                {th("OEM", "oem")}
                {th("Model", "model")}
                {th("Total Qty", "total", "right")}
                {th("Available", "available", "right")}
                {th("Reserved/Issued", "reservedIssued", "right")}
                {th("Defective", "defective", "right")}
                <th className="p-2 text-left">Warehouses</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={8}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={8}>No products found.</td></tr>
              ) : filtered.map((g) => {
                const isOpen = !!open[g.key];
                const low = g.available < LOW_STOCK_THRESHOLD;
                return (
                  <Fragment key={g.key}>
                    <tr className="border-t hover:bg-muted/30 cursor-pointer"
                      onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}>
                      <td className="p-2 text-muted-foreground">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="p-2">{g.oem || "—"}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{g.model}</span>
                          {low && (
                            <Badge variant="outline" className={g.available === 0
                              ? "bg-rose-100 text-rose-800 border-rose-300"
                              : "bg-amber-100 text-amber-800 border-amber-300"}>
                              {g.available < 0 ? "Negative stock" : g.available === 0 ? "Out of stock" : "Low stock"}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-right font-medium">{g.total}</td>
                      <td className={`p-2 text-right ${qtyCellClass(g.available)}`}>{g.available}</td>
                      <td className="p-2 text-right">{g.reservedIssued}</td>
                      <td className="p-2 text-right">{g.defective}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {Object.entries(g.byWarehouse)
                          .map(([id, n]) => `${whName(id === "unassigned" ? null : id)}: ${n}`)
                          .join(" • ")}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/20">
                        <td className="p-2" colSpan={8}>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="p-1">Serial No</th>
                                <th className="p-1">Qty</th>
                                <th className="p-1">Warehouse</th>
                                <th className="p-1">Type</th>
                                <th className="p-1">Status</th>
                                <th className="p-1">Ticket / Indent</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.rows.map((r) => (
                                <tr key={r.id} className="border-t">
                                  <td className="p-1 font-mono">{r.part_serial_no || "—"}</td>
                                  <td className="p-1">{r.qty ?? 1}</td>
                                  <td className="p-1">{whName(r.warehouse_id)}</td>
                                  <td className="p-1">
                                    <Badge variant={r.stock_type === "good" ? "default" : "secondary"}>{STOCK_TYPE_LABEL[r.stock_type]}</Badge>
                                  </td>
                                  <td className="p-1"><StockStatusBadge status={r.stock_status} type={r.stock_type} /></td>
                                  <td className="p-1 font-mono">{r.ticket_id || r.indent_id || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Low stock threshold: Available &lt; {LOW_STOCK_THRESHOLD}. {warehouses.length} warehouse(s) tracked.
        </p>
      </CardContent>
    </Card>
  );
}