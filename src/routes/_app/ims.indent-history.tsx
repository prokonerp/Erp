import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  listIndentTransactions, listWarehouses, warehouseLookup,
  TXN_TYPE_LABEL, type Transaction, type WarehouseLite,
} from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/indent-history")({
  component: IndentHistory,
});

function IndentHistory() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [t, w] = await Promise.all([listIndentTransactions(), listWarehouses()]);
        setRows(t); setWarehouses(w);
      } finally { setLoading(false); }
    })();
  }, []);

  const wh = warehouseLookup(warehouses);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.txn_no, r.part_name, r.part_serial_no, r.part_model_no, r.oem,
       r.indent_id, r.ticket_id, r.oem_case_id, r.reference, r.notes]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, q]);

  // Group by indent for lifecycle view
  const grouped = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    filtered.forEach((r) => {
      const key = r.indent_id || r.oem_case_id || "(unlinked)";
      const arr = m.get(key) || [];
      arr.push(r);
      m.set(key, arr);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Indent Inventory History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            placeholder="Filter by Indent No / Ticket No / OEM Case ID / Model / Part Serial No"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">
            {filtered.length} transaction{filtered.length === 1 ? "" : "s"} from indents
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : grouped.length === 0 ? (
        <Card><CardContent className="p-6 text-muted-foreground">No indent-linked inventory movements yet.</CardContent></Card>
      ) : grouped.map(([key, items]) => (
        <Card key={key}>
          <CardHeader>
            <CardTitle className="text-sm font-mono flex items-center gap-2">
              <Badge variant="outline">Indent / Case</Badge>
              <span>{key}</span>
              <span className="text-xs text-muted-foreground">· {items.length} movement{items.length === 1 ? "" : "s"}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="p-2">Txn No</th>
                  <th className="p-2">Date</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Model / Part · Serial</th>
                  <th className="p-2">From</th>
                  <th className="p-2">To</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2">Ticket</th>
                  <th className="p-2">OEM Case</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-mono">{r.txn_no}</td>
                    <td className="p-2">{new Date(r.txn_date).toLocaleString()}</td>
                    <td className="p-2"><Badge variant="outline">{TXN_TYPE_LABEL[r.txn_type]}</Badge></td>
                    <td className="p-2">{r.part_name || "—"}{r.part_serial_no ? ` / ${r.part_serial_no}` : ""}</td>
                    <td className="p-2">{wh(r.from_warehouse_id)}{r.from_party ? ` (${r.from_party})` : ""}</td>
                    <td className="p-2">{wh(r.to_warehouse_id)}{r.to_party ? ` (${r.to_party})` : ""}</td>
                    <td className="p-2">{r.qty}</td>
                    <td className="p-2 font-mono text-xs">{r.ticket_id || "—"}</td>
                    <td className="p-2 font-mono text-xs">{r.oem_case_id || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}