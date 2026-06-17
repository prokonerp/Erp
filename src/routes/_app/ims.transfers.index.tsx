import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, ExternalLink } from "lucide-react";
import { listTransfers, TRANSFER_STATUS_LABEL, type Transfer } from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/transfers/")({
  component: TransfersList,
});

function TransfersList() {
  const [rows, setRows] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setRows(await listTransfers()); } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Stock Transfers</span>
            <Link to="/ims/transfers/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Transfer</Button></Link>
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Transfer No</th>
                <th className="p-2">Date</th>
                <th className="p-2">Part</th>
                <th className="p-2">Serial</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={7}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={7}>No transfers yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-mono">{r.transfer_no}</td>
                  <td className="p-2">{new Date(r.request_date).toLocaleDateString()}</td>
                  <td className="p-2">{r.part_name || "—"}</td>
                  <td className="p-2 font-mono">{r.part_serial_no || "—"}</td>
                  <td className="p-2">{r.qty}</td>
                  <td className="p-2"><Badge variant="outline">{TRANSFER_STATUS_LABEL[r.status]}</Badge></td>
                  <td className="p-2 text-right">
                    <Link to="/ims/transfers/$id" params={{ id: r.id }}>
                      <Button variant="ghost" size="sm"><ExternalLink className="h-4 w-4" /></Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}