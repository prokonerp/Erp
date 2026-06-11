import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExportButtons } from "@/components/ExportButtons";

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
type Product = { id: string; name: string; brand: string | null; model: string | null; serial_tracking: boolean; warranty_applicable: boolean };
type Warehouse = { id: string; name: string; code: string };
type Customer = { id: string; company: string | null; contact_name: string | null };

function ReportsPage() {
  const [serials, setSerials] = useState<Serial[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tab, setTab] = useState("stock");
  const [wh, setWh] = useState("__all");
  const [prod, setProd] = useState("__all");
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const [s, p, w, c] = await Promise.all([
        supabase.from("serials").select("*"),
        supabase.from("products").select("id,name,brand,model,serial_tracking,warranty_applicable"),
        supabase.from("warehouses").select("id,name,code").order("name"),
        supabase.from("customers").select("id,company,contact_name"),
      ]);
      setSerials((s.data || []) as any);
      setProducts((p.data || []) as any);
      setWarehouses((w.data || []) as any);
      setCustomers((c.data || []) as any);
    })();
  }, []);

  const pMap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const wMap = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  const cMap = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);

  const enriched = useMemo(() => serials.map((s) => ({
    ...s,
    product: pMap[s.product_id]?.name || "—",
    brand_model: [pMap[s.product_id]?.brand, pMap[s.product_id]?.model].filter(Boolean).join(" / ") || "",
    warehouse: s.warehouse_id ? `${wMap[s.warehouse_id]?.code || ""} — ${wMap[s.warehouse_id]?.name || ""}` : "—",
    customer: s.customer_id ? (cMap[s.customer_id]?.company || cMap[s.customer_id]?.contact_name || "—") : "—",
  })), [serials, pMap, wMap, cMap]);

  const filtered = useMemo(() => enriched.filter((r) => {
    if (wh !== "__all" && r.warehouse_id !== wh) return false;
    if (prod !== "__all" && r.product_id !== prod) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![r.serial_number, r.product, r.customer, r.sale_invoice_no || ""].some((v) => (v || "").toLowerCase().includes(s))) return false;
    }
    return true;
  }), [enriched, wh, prod, q]);

  // Stock-by-warehouse aggregation: only In Stock items
  const stockGroups = useMemo(() => {
    const m = new Map<string, { warehouse: string; product: string; qty: number }>();
    filtered.filter((r) => r.status === "In Stock").forEach((r) => {
      const key = `${r.warehouse_id || "__"}_${r.product_id}`;
      const e = m.get(key) || { warehouse: r.warehouse, product: r.product, qty: 0 };
      e.qty += 1;
      m.set(key, e);
    });
    return Array.from(m.values()).sort((a, b) => a.warehouse.localeCompare(b.warehouse));
  }, [filtered]);

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
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
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Product</label>
            <Select value={prod} onValueChange={setProd}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All products</SelectItem>
                {products.filter((p) => p.serial_tracking).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
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
              <CardTitle className="text-base">In-Stock Quantities ({stockGroups.length})</CardTitle>
              <ExportButtons name="Stock_By_Warehouse" title="Stock by Warehouse" rows={stockGroups} columns={[
                { header: "Warehouse", get: (r) => r.warehouse },
                { header: "Product", get: (r) => r.product },
                { header: "Qty", get: (r) => r.qty },
              ]} />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Warehouse</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Qty In Stock</TableHead></TableRow></TableHeader>
                <TableBody>
                  {stockGroups.map((g, i) => (
                    <TableRow key={i}><TableCell>{g.warehouse}</TableCell><TableCell>{g.product}</TableCell><TableCell className="text-right font-medium">{g.qty}</TableCell></TableRow>
                  ))}
                  {stockGroups.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No in-stock serials match these filters.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="serials" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Serial Number Tracking ({filtered.length})</CardTitle>
              <ExportButtons name="Serial_Tracking" title="Serial Number Tracking" rows={filtered} columns={[
                { header: "Serial", get: (r) => r.serial_number },
                { header: "Product", get: (r) => r.product },
                { header: "Brand / Model", get: (r) => r.brand_model },
                { header: "Warehouse", get: (r) => r.warehouse },
                { header: "Status", get: (r) => r.status },
                { header: "Customer", get: (r) => r.customer },
                { header: "Sale Invoice", get: (r) => r.sale_invoice_no || "" },
                { header: "Purchase Date", get: (r) => r.purchase_date || "" },
                { header: "Installation", get: (r) => r.installation_date || "" },
                { header: "Warranty End", get: (r) => r.warranty_end_date || "" },
              ]} />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Serial #</TableHead><TableHead>Product</TableHead><TableHead>Warehouse</TableHead>
                  <TableHead>Status</TableHead><TableHead>Customer</TableHead><TableHead>Warranty End</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.serial_number}</TableCell>
                      <TableCell className="text-xs">{r.product}<br /><span className="text-muted-foreground">{r.brand_model}</span></TableCell>
                      <TableCell className="text-xs">{r.warehouse}</TableCell>
                      <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                      <TableCell className="text-xs">{r.customer}</TableCell>
                      <TableCell className="text-xs">{r.warranty_end_date || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No serials match these filters.</TableCell></TableRow>}
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