import { createFileRoute } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/shared/skeletons";
import { PaginationFooter } from "@/components/PaginationFooter";
import { useDebounced } from "@/lib/sales.hooks";
import { listAudit, type AuditEntry } from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/audit")({
  component: Audit,
});

function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useRouteState<string>("q", "");
  const qDebounced = useDebounced(q, 250);
  const deferredQ = useDeferredValue(qDebounced);
  const [page, setPage] = useRouteState<number>("page", 0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    (async () => {
      try {
        setRows(await listAudit(500));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.entity, r.action, r.entity_id, r.user_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, deferredQ]);

  useEffect(() => {
    setPage(0);
  }, [deferredQ]);

  const paged = useMemo(
    () => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filtered, page],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">IMS Audit Trail</CardTitle>
        <Input
          placeholder="Search entity / action / user…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 w-56 text-sm"
        />
      </CardHeader>
      <CardContent className="p-0">
        <div
          className="max-h-[60vh] overflow-auto overscroll-contain scroll-pt-0"
          style={{ contain: "content" }}
        >
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted shadow-sm">
              <tr className="text-left">
                <th className="p-2 bg-muted">When</th>
                <th className="p-2 bg-muted">User</th>
                <th className="p-2 bg-muted">Entity</th>
                <th className="p-2 bg-muted">Action</th>
                <th className="p-2 bg-muted">Entity ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-0">
                    <TableSkeleton rows={6} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={5}>
                    No audit entries yet.
                  </td>
                </tr>
              ) : (
                paged.map((r) => (
                  <tr
                    key={r.id}
                    style={
                      {
                        contentVisibility: "auto",
                        containIntrinsicSize: "auto 40px",
                      } as React.CSSProperties
                    }
                    className="border-t"
                  >
                    <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="p-2 font-mono text-xs">{r.user_id || "—"}</td>
                    <td className="p-2">{r.entity}</td>
                    <td className="p-2">
                      <Badge variant="outline">{r.action}</Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{r.entity_id || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_SIZE && (
          <PaginationFooter
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onPage={setPage}
          />
        )}
      </CardContent>
    </Card>
  );
}
