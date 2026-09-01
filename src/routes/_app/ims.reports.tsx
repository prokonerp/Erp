import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { exportCSV } from "@/lib/exports";
import { ProductStockSummary } from "@/components/ProductStockSummary";
import { SalesServiceStockTables } from "@/components/SalesServiceStockTables";
import { NegativeOverridesList } from "@/components/NegativeOverridesList";
import {
  fetchStockPage, fetchTransactionsPage, listTransfers, listReservations,
  listWarehouses, listProducts, warehouseLookup,
  STOCK_STATUS_LABEL, STOCK_TYPE_LABEL, TXN_TYPE_LABEL, TRANSFER_STATUS_LABEL,
  type StockItem, type Transaction, type Transfer, type Reservation, type WarehouseLite, type ProductLite,
} from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/reports")({
  component: Reports,
});

function Reports() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [resv, setResv] = useState<Reservation[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [q, setQ] = useRouteState<string>("q", "");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [sRes, tRes, x, r, w, p] = await Promise.all([
        fetchStockPage({ page: 0, pageSize: 500 }),
        fetchTransactionsPage({ page: 0, pageSize: 500 }),
        listTransfers(), listReservations(), listWarehouses(), listProducts(),
      ]);
      setStock(sRes.data as StockItem[]); setTxns(tRes.data as Transaction[]); setTransfers(x); setResv(r); setWarehouses(w); setProducts(p);
      setLoading(false);
    })();
  }, []);

  const whName = warehouseLookup(warehouses);

  const trace = q.trim()
    ? stock.filter((s) => [s.part_serial_no, s.part_model_no, s.ticket_id, s.indent_id, s.oem_case_id]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q.toLowerCase().trim())))
    : [];

  function expStock(name: string, items: StockItem[]) {
    exportCSV(name, [
      { header: "OEM", get: (r) => r.oem },
      { header: "Model / Part Name", get: (r) => r.part_name },
      { header: "Model / Part No", get: (r) => r.part_model_no },
      { header: "Model / Part Serial No", get: (r) => r.part_serial_no },
      { header: "Type", get: (r) => STOCK_TYPE_LABEL[r.stock_type] },
      { header: "Status", get: (r) => STOCK_STATUS_LABEL[r.stock_status] },
      { header: "Warehouse", get: (r) => whName(r.warehouse_id) },
      { header: "Ticket", get: (r) => r.ticket_id },
      { header: "Indent", get: (r) => r.indent_id },
      { header: "OEM Case", get: (r) => r.oem_case_id },
      { header: "Created", get: (r) => r.created_at },
    ], items);
  }
  function expTxn(name: string, items: Transaction[]) {
    exportCSV(name, [
      { header: "Txn No", get: (r) => r.txn_no },
      { header: "Date", get: (r) => r.txn_date },
      { header: "Type", get: (r) => TXN_TYPE_LABEL[r.txn_type] },
      { header: "Model / Part", get: (r) => r.part_name },
      { header: "Model / Part Serial No", get: (r) => r.part_serial_no },
      { header: "From Warehouse", get: (r) => whName(r.from_warehouse_id) },
      { header: "To Warehouse", get: (r) => whName(r.to_warehouse_id) },
      { header: "Qty", get: (r) => r.qty },
      { header: "Indent", get: (r) => r.indent_id },
      { header: "OEM Case", get: (r) => r.oem_case_id },
      { header: "Ticket", get: (r) => r.ticket_id },
      { header: "Reference", get: (r) => r.reference },
    ], items);
  }

  return (
    <div className="space-y-4">
      <SalesServiceStockTables stock={stock} warehouses={warehouses} products={products} loading={loading} />
      <ProductStockSummary stock={stock} warehouses={warehouses} products={products} whName={whName} loading={loading} />

      <NegativeOverridesList warehouses={warehouses} />

      <Card>
        <CardHeader><CardTitle className="text-base">Stock Reports (CSV Exports)</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => expStock("ims_good_stock", stock.filter((s) => s.stock_type === "good"))}>Good Stock</Button>
          <Button size="sm" variant="outline" onClick={() => expStock("ims_defective_stock", stock.filter((s) => s.stock_type === "defective"))}>Defective Stock</Button>
          <Button size="sm" variant="outline" onClick={() => expStock("ims_all_stock", stock)}>All Stock</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Movement Reports</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => expTxn("ims_inward", txns.filter((t) => t.txn_type.endsWith("_in") || t.txn_type === "oem_replacement_receipt" || t.txn_type === "transfer_in"))}>Stock Inward</Button>
          <Button size="sm" variant="outline" onClick={() => expTxn("ims_outward", txns.filter((t) => t.txn_type.endsWith("_out") || t.txn_type === "oem_return"))}>Stock Outward</Button>
          <Button size="sm" variant="outline" onClick={() => expTxn("ims_oem_returns", txns.filter((t) => t.txn_type === "oem_return"))}>OEM Returns</Button>
          <Button size="sm" variant="outline" onClick={() => exportCSV("ims_transfers", [
            { header: "No", get: (r) => r.transfer_no },
            { header: "Date", get: (r) => r.request_date },
            { header: "Status", get: (r) => TRANSFER_STATUS_LABEL[r.status] },
            { header: "Source", get: (r) => whName(r.source_warehouse_id) },
            { header: "Destination", get: (r) => whName(r.destination_warehouse_id) },
            { header: "Model / Part", get: (r) => r.part_name },
            { header: "Model / Part Serial No", get: (r) => r.part_serial_no },
            { header: "Qty", get: (r) => r.qty },
          ], transfers)}>Transfers</Button>
          <Button size="sm" variant="outline" onClick={() => exportCSV("ims_reservations", [
            { header: "Stock Item", get: (r) => r.stock_item_id },
            { header: "Ticket", get: (r) => r.ticket_id },
            { header: "Indent", get: (r) => r.indent_id },
            { header: "Status", get: (r) => r.status },
            { header: "Reserved", get: (r) => r.reserved_at },
          ], resv)}>Reservations</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Traceability Search</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Model / Part Serial No / Model / Ticket / Indent / OEM Case ID" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr className="text-left">
                  <th className="p-2">Model / Part Serial No</th><th className="p-2">Model / Part Name</th><th className="p-2">Status</th><th className="p-2">Type</th><th className="p-2">Ticket</th><th className="p-2">Indent</th>
                </tr></thead>
                <tbody>
                  {trace.length === 0 ? (
                    <tr><td className="p-4 text-muted-foreground" colSpan={6}>No matches.</td></tr>
                  ) : trace.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="p-2 font-mono">{r.part_serial_no || "—"}</td>
                      <td className="p-2">{r.part_name}</td>
                      <td className="p-2">{STOCK_STATUS_LABEL[r.stock_status]}</td>
                      <td className="p-2">{STOCK_TYPE_LABEL[r.stock_type]}</td>
                      <td className="p-2 font-mono text-xs">{r.ticket_id || "—"}</td>
                      <td className="p-2 font-mono text-xs">{r.indent_id || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}