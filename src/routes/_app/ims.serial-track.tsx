import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Download } from "lucide-react";
import { StockStatusBadge } from "@/components/StockStatusBadge";
import { exportCSV } from "@/lib/exports";
import {
  listStock, listWarehouses, listTransactions,
  TXN_TYPE_LABEL, type StockItem, type Transaction, type WarehouseLite,
} from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/serial-track")({
  component: SerialTrack,
  head: () => ({
    meta: [
      { title: "Serial Track — Global Serial Search | Prokon" },
      { name: "description", content: "Search any serial number to see its current status, warehouse location and complete movement history." },
      { property: "og:title", content: "Serial Track — Global Serial Search" },
      { property: "og:description", content: "Instant serial lookup with live status and full transaction history." },
    ],
  }),
});

const splitSerials = (v: string | null | undefined): string[] =>
  (v || "").split(",").map((s) => s.trim()).filter(Boolean);

function SerialTrack() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [s, t, w] = await Promise.all([listStock(), listTransactions(), listWarehouses()]);
        setStock(s); setTxns(t); setWarehouses(w);
      } finally { setLoading(false); }
    })();
  }, []);

  const wMap = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  /** Plain warehouse name only — no ASP/Godown suffix (same style as Reports). */
  const plainWhName = (id: string | null | undefined) => (id ? (wMap[id]?.name || "—") : "—");

  const term = q.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!term) return [] as { serial: string; row: StockItem }[];
    const out: { serial: string; row: StockItem }[] = [];
    for (const r of stock) {
      for (const s of splitSerials(r.part_serial_no)) {
        if (s.toLowerCase().includes(term)) out.push({ serial: s, row: r });
      }
    }
    return out.slice(0, 25);
  }, [stock, term]);

  const historyFor = (row: StockItem) =>
    txns
      .filter((t) => t.stock_item_id === row.id ||
        (!!t.part_serial_no && splitSerials(t.part_serial_no).some((s) => s.toLowerCase() === (row.part_serial_no || "").toLowerCase())))
      .sort((a, b) => (a.txn_date || a.created_at).localeCompare(b.txn_date || b.created_at));

  const party = (t: Transaction) => t.to_party || t.from_party || "—";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Serial Track — Global Serial Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-9"
              placeholder="Type any serial number…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {loading ? "Loading inventory…" : `${stock.length} stock records searchable`}
          </p>
        </CardContent>
      </Card>

      {!loading && term && matches.length === 0 && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          No serial found matching “{q.trim()}”
        </CardContent></Card>
      )}

      {matches.map(({ serial, row }) => {
        const hist = historyFor(row);
        const issuedTo = row.stock_status === "issued"
          ? (hist.slice().reverse().find((t) => t.txn_type === "good_out" || t.txn_type === "defective_out"))
          : null;
        return (
          <Card key={`${row.id}-${serial}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex flex-wrap items-center gap-2">
                <span className="font-mono">{serial}</span>
                <StockStatusBadge status={row.stock_status} type={row.stock_type} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div><div className="text-xs text-muted-foreground">Product / Model</div>
                  <div>{row.part_model_no || row.part_name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">OEM</div><div>{row.oem || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Warehouse</div>
                  <div>{plainWhName(row.warehouse_id)}</div></div>
                <div><div className="text-xs text-muted-foreground">Qty</div><div>{row.qty}</div></div>
                {issuedTo && (
                  <div className="sm:col-span-2 lg:col-span-4">
                    <div className="text-xs text-muted-foreground">Issued to</div>
                    <div>{issuedTo.to_party || row.customer_name || "—"}
                      {issuedTo.reference ? <span className="text-muted-foreground"> · {issuedTo.reference}</span> : null}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Movement history ({hist.length})</h3>
                <Button
                  variant="outline" size="sm" disabled={hist.length === 0}
                  onClick={() => exportCSV(`serial_${serial}_history`, [
                    { header: "Date", get: (t: Transaction) => (t.txn_date || t.created_at || "").slice(0, 10) },
                    { header: "Type", get: (t: Transaction) => TXN_TYPE_LABEL[t.txn_type] || t.txn_type },
                    { header: "Voucher/Reference", get: (t: Transaction) => t.txn_no || t.reference || "" },
                    { header: "Party", get: (t: Transaction) => party(t) },
                    { header: "From Warehouse", get: (t: Transaction) => plainWhName(t.from_warehouse_id) },
                    { header: "To Warehouse", get: (t: Transaction) => plainWhName(t.to_warehouse_id) },
                    { header: "Qty", get: (t: Transaction) => t.qty },
                  ], hist)}
                >
                  <Download className="h-4 w-4 mr-1" />Download as CSV
                </Button>
              </div>

              {hist.length === 0 ? (
                <p className="text-sm text-muted-foreground">No transactions recorded for this serial yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="p-2">Date</th>
                        <th className="p-2">Type</th>
                        <th className="p-2">Voucher / Reference</th>
                        <th className="p-2">Party</th>
                        <th className="p-2">Warehouse</th>
                        <th className="p-2 text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hist.map((t) => (
                        <tr key={t.id} className="border-t">
                          <td className="p-2 whitespace-nowrap">{(t.txn_date || t.created_at || "").slice(0, 10)}</td>
                          <td className="p-2"><Badge variant="outline">{TXN_TYPE_LABEL[t.txn_type] || t.txn_type}</Badge></td>
                          <td className="p-2">{t.txn_no || t.reference || "—"}</td>
                          <td className="p-2">{party(t)}</td>
                          <td className="p-2 whitespace-nowrap">
                            {t.from_warehouse_id && t.to_warehouse_id
                              ? `${plainWhName(t.from_warehouse_id)} → ${plainWhName(t.to_warehouse_id)}`
                              : t.to_warehouse_id ? `→ ${plainWhName(t.to_warehouse_id)}`
                              : t.from_warehouse_id ? `${plainWhName(t.from_warehouse_id)} →` : "—"}
                          </td>
                          <td className="p-2 text-right">{t.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}