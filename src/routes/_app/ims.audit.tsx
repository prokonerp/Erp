import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { listAudit, type AuditEntry } from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/audit")({
  component: Audit,
});

function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setRows(await listAudit(500)); } finally { setLoading(false); }
    })();
  }, []);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">IMS Audit Trail</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">When</th>
              <th className="p-2">User</th>
              <th className="p-2">Entity</th>
              <th className="p-2">Action</th>
              <th className="p-2">Entity ID</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={5}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={5}>No audit entries yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                <td className="p-2 font-mono text-xs">{r.user_id || "—"}</td>
                <td className="p-2">{r.entity}</td>
                <td className="p-2"><Badge variant="outline">{r.action}</Badge></td>
                <td className="p-2 font-mono text-xs">{r.entity_id || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}