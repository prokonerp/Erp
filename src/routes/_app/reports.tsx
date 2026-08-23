import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { istTodayIso, daysAgoIst } from "@/lib/dateRange";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import {
  listStock, listWarehouses,
  type StockItem, type WarehouseLite,
} from "@/lib/ims";

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Stock & Serial Reports — Prokon" }] }),
});

type Serial = {
  id: string; product_id: string; serial_number: string; status: string;
  warehouse_id: string | null; warranty_end_date: string | null;
  warranty_start_date: string | null; purchase_date: string | null;
  sale_invoice_no: string | null; customer_id: string | null; installation_date: string | null;
};
type Product = { id: string; name: string; brand: string | null; model: string | null; description: string | null; serial_tracking: boolean; warranty_applicable: boolean };
type Customer = { id: string; company: string | null; contact_name: string | null };

/** Group by canonical model + OEM only; name/description are never part of the key. */
const groupKey = (r: { part_model_no: string | null; oem: string | null }) =>
  `${(r.part_model_no || "").toLowerCase()}|${(r.oem || "").toLowerCase()}`;

/** Product column shows ONLY the model number — no brand/name/description. */
const productLabel = (r: { part_model_no: string | null }) => r.part_model_no || "—";

/** One-serial-per-row: split comma/newline joined serials. */
function splitSerials(v: string | null): string[] {
  if (!v) return [];
  return v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

function ReportsPage() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [serials, setSerials] = useState<Serial[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tab, setTab] = useState("stock");
  const [wh, setWh] = useState("__all");
  const [prod, setProd] = useState("__all");
  const [q, setQ] = useState("");
  const [openSerialGroups, setOpenSerialGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const [st, w, s, p] = await Promise.all([
        listStock(),
        listWarehouses(),
        supabase.from("serials").select("*"),
        supabase.from("products").select("id,name,brand,model,description,serial_tracking,warranty_applicable"),
      ]);
      setStock(st);
      setWarehouses(w);
      setSerials((s.data || []) as any);
      setProducts((p.data || []) as any);
      // Resolve only the customers referenced by these serials — fetching the
      // whole table truncates at Supabase's 1000-row cap.
      const ids = ((s.data || []) as any[]).map((x) => x.customer_id);
      const { data: c } = ids.filter(Boolean).length
        ? await supabase.from("customers").select("id,company,contact_name").in("id", Array.from(new Set(ids.filter(Boolean))).slice(0, 1000))
        : { data: [] as any[] };
      setCustomers((c || []) as any);
    })();
  }, []);

  const pMap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const wMap = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  const cMap = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);
  /** Plain warehouse name only — no godown/ASP/branch suffix. */
  const plainWhName = (id: string | null | undefined) => (id ? (wMap[id]?.name || "—") : "—");

  /** Distinct products present in inventory, for the Product filter. */
  const stockProducts = useMemo(() => {
    const m = new Map<string, string>();
    stock.forEach((r) => { if (!m.has(groupKey(r))) m.set(groupKey(r), productLabel(r)); });
    return [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [stock]);

  const filteredStock = useMemo(() => stock.filter((r) => {
    if (wh !== "__all" && r.warehouse_id !== wh) return false;
    if (prod !== "__all" && groupKey(r) !== prod) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![r.part_serial_no, r.part_name, r.part_model_no, r.oem, r.customer_name, r.transaction_ref]
        .some((v) => (v || "").toLowerCase().includes(s))) return false;
    }
    return true;
  }), [stock, wh, prod, q]);

  /** Stock-by-warehouse: available stock only, grouped by warehouse + product. */
  const stockGroups = useMemo(() => {
    const m = new Map<string, { warehouse: string; product: string; oem: string; good: number; defective: number; qty: number }>();
    filteredStock.filter((r) => r.stock_status === "available").forEach((r) => {
      const key = `${r.warehouse_id || "__"}_${groupKey(r)}`;
      const e = m.get(key) || { warehouse: plainWhName(r.warehouse_id), product: productLabel(r), oem: r.oem || "—", good: 0, defective: 0, qty: 0 };
      const n = Number(r.qty ?? 1) || 0;
      if (r.stock_type === "defective") e.defective += n; else e.good += n;
      e.qty += n;
      m.set(key, e);
    });
    return Array.from(m.values()).sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.product.localeCompare(b.product));
  }, [filteredStock, warehouses]);

  /** Serial tracking: grouped by Model No + Warehouse (+ OEM via the shared groupKey). */
  const serialGroups = useMemo(() => {
    const m = new Map<string, { key: string; model: string; oem: string; warehouse: string; qty: number; serials: string[] }>();
    filteredStock.filter((r) => r.stock_status === "available").forEach((r) => {
      const list = splitSerials(r.part_serial_no);
      if (list.length === 0) return;
      const key = `${r.warehouse_id || "__"}_${groupKey(r)}`;
      const e = m.get(key) || {
        key,
        model: r.part_model_no || "—",
        oem: r.oem || "—",
        warehouse: plainWhName(r.warehouse_id),
        qty: 0,
        serials: [] as string[],
      };
      e.qty += list.length;
      e.serials.push(...list);
      m.set(key, e);
    });
    return Array.from(m.values())
      .map((g) => ({ ...g, serials: Array.from(new Set(g.serials)).sort((a, b) => a.localeCompare(b)) }))
      .sort((a, b) => a.model.localeCompare(b.model) || a.warehouse.localeCompare(b.warehouse));
  }, [filteredStock, warehouses]);

  // --- Warranty tab still reads the legacy `serials` table (ims_stock_items has no warranty dates) ---
  const enriched = useMemo(() => serials.map((s) => ({
    ...s,
    product: pMap[s.product_id]?.name || "—",
    brand_model: [pMap[s.product_id]?.brand, pMap[s.product_id]?.model].filter(Boolean).join(" / ") || "",
    customer: s.customer_id ? (cMap[s.customer_id]?.company || cMap[s.customer_id]?.contact_name || "—") : "—",
  })), [serials, pMap, cMap]);

  const filtered = useMemo(() => enriched.filter((r) => {
    if (wh !== "__all" && r.warehouse_id !== wh) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![r.serial_number, r.product, r.customer, r.sale_invoice_no || ""].some((v) => (v || "").toLowerCase().includes(s))) return false;
    }
    return true;
  }), [enriched, wh, q]);

  const today = istTodayIso();
  const in30 = daysAgoIst(-30);
  const warrantyRows = useMemo(() => filtered.filter((r) => r.warranty_end_date), [filtered]);
  function warrantyState(end: string) {
    if (end < today) return { label: "Expired", cls: "bg-red-100 text-red-800" };
    if (end <= in30) return { label: "Expiring Soon", cls: "bg-amber-100 text-amber-800" };
    return { label: "Active", cls: "bg-green-100 text-green-800" };
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Stock &amp; Serial Reports</h1>
        <p className="text-sm text-muted-foreground">Track inventory by warehouse, serial movement, and warranty status.</p>
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Warehouse</label>
            <Select value={wh} onValueChange={setWh}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All warehouses</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.code ? `${w.code} — ` : ""}{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Product</label>
            <Select value={prod} onValueChange={setProd}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All products</SelectItem>
                {stockProducts.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground block mb-1">Search</label>
            <Input placeholder="Serial / product / customer / invoice…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="stock">Stock by Warehouse</TabsTrigger>
          <TabsTrigger value="serials">Serial Tracking</TabsTrigger>
          <TabsTrigger value="warranty">Warranty Status</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Available Stock by Warehouse ({stockGroups.length})</CardTitle>
              <ExportButtons name="Stock_By_Warehouse" title="Stock by Warehouse" rows={stockGroups} columns={[
                { header: "Warehouse", get: (r) => r.warehouse },
                { header: "OEM", get: (r) => r.oem },
                { header: "Product", get: (r) => r.product },
                { header: "Good", get: (r) => r.good },
                { header: "Defective", get: (r) => r.defective },
                { header: "Total", get: (r) => r.qty },
              ]} />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Warehouse</TableHead><TableHead>OEM</TableHead><TableHead>Product</TableHead>
                  <TableHead className="text-right">Good</TableHead><TableHead className="text-right">Defective</TableHead><TableHead className="text-right">Total Available</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {stockGroups.map((g, i) => (
                    <TableRow key={i}>
                      <TableCell>{g.warehouse}</TableCell>
                      <TableCell>{g.oem}</TableCell>
                      <TableCell>{g.product}</TableCell>
                      <TableCell className="text-right">{g.good || "—"}</TableCell>
                      <TableCell className="text-right">{g.defective || "—"}</TableCell>
                      <TableCell className="text-right font-medium">{g.qty}</TableCell>
                    </TableRow>
                  ))}
                  {stockGroups.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No available stock matches these filters.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="serials" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Serial Number Tracking ({serialGroups.length})</CardTitle>
              <ExportButtons name="Serial_Tracking" title="Serial Number Tracking" rows={serialGroups} columns={[
                { header: "Model No", get: (r) => r.model },
                { header: "Warehouse", get: (r) => r.warehouse },
                { header: "Total Qty", get: (r) => r.qty },
              ]} />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Model No</TableHead><TableHead>Warehouse</TableHead>
                  <TableHead className="text-right">Total Quantity</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {serialGroups.map((g) => {
                    const open = !!openSerialGroups[g.key];
                    return (
                      <Fragment key={g.key}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setOpenSerialGroups((s) => ({ ...s, [g.key]: !s[g.key] }))}
                        >
                          <TableCell className="w-8 text-muted-foreground">
                            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{g.model}</TableCell>
                          <TableCell>{g.warehouse}</TableCell>
                          <TableCell className="text-right font-medium">{g.qty}</TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell />
                            <TableCell colSpan={3} className="py-3">
                              <div className="text-xs text-muted-foreground mb-2">Serial numbers ({g.serials.length})</div>
                              <div className="flex flex-wrap gap-1.5">
                                {g.serials.map((sn) => (
                                  <Badge key={sn} variant="secondary" className="font-mono text-[11px]">{sn}</Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  {serialGroups.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No serialised stock matches these filters.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warranty" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Warranty Status ({warrantyRows.length})</CardTitle>
              <ExportButtons name="Warranty_Status" title="Warranty Status" rows={warrantyRows} columns={[
                { header: "Serial", get: (r) => r.serial_number },
                { header: "Product", get: (r) => r.product },
                { header: "Customer", get: (r) => r.customer },
                { header: "Start", get: (r) => r.warranty_start_date || "" },
                { header: "End", get: (r) => r.warranty_end_date || "" },
                { header: "Status", get: (r) => warrantyState(r.warranty_end_date!).label },
              ]} />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Serial</TableHead><TableHead>Product</TableHead><TableHead>Customer</TableHead>
                  <TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>State</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {warrantyRows.map((r) => {
                    const st = warrantyState(r.warranty_end_date!);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.serial_number}</TableCell>
                        <TableCell className="text-xs">{r.product}</TableCell>
                        <TableCell className="text-xs">{r.customer}</TableCell>
                        <TableCell className="text-xs">{r.warranty_start_date || "—"}</TableCell>
                        <TableCell className="text-xs">{r.warranty_end_date}</TableCell>
                        <TableCell><span className={`inline-flex rounded px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span></TableCell>
                      </TableRow>
                    );
                  })}
                  {warrantyRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No warranty records.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}