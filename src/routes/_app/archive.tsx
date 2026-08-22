import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Archive as ArchiveIcon, RotateCcw, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { restoreRecord, purgeRecord, useRealtimeRefetch, type ArchivableTable } from "@/lib/softDelete";
import { useConfirm } from "@/hooks/useConfirm";

export const Route = createFileRoute("/_app/archive")({
  component: ArchivePage,
  head: () => ({ meta: [{ title: "Archive — Prokon" }] }),
});

type Row = {
  id: string;
  label: string;
  sub: string;
  deleted_at: string | null;
};

const TABLES: { key: ArchivableTable; title: string }[] = [
  { key: "tickets", title: "Tickets" },
  { key: "indents", title: "Indents" },
  { key: "amcs", title: "AMCs" },
];

function daysLeft(deleted_at: string | null): number {
  if (!deleted_at) return 30;
  const ms = 30 * 24 * 3600_000 - (Date.now() - new Date(deleted_at).getTime());
  return Math.max(0, Math.ceil(ms / (24 * 3600_000)));
}

function ArchivePage() {
  const { isAdmin, loading } = useIsAdmin();

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto text-amber-500 mb-2" />
          <h2 className="font-semibold mb-1">Admin only</h2>
          <p className="text-sm text-muted-foreground">The Archive is only available to administrators.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
          <ArchiveIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Archive</h1>
          <p className="text-xs text-muted-foreground">
            Soft-deleted Tickets, Indents and AMCs. Records are permanently purged 30 days after deletion.
          </p>
        </div>
      </div>

      <Tabs defaultValue="tickets">
        <TabsList>
          {TABLES.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.title}</TabsTrigger>
          ))}
        </TabsList>
        {TABLES.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-3">
            <ArchiveTable table={t.key} title={t.title} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function ArchiveTable({ table, title }: { table: ArchivableTable; title: string }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    let mapped: Row[] = [];
    if (table === "tickets") {
      const { data } = await supabase
        .from("tickets")
        .select("id,case_id,customer_name,status,deleted_at")
        .eq("is_deleted", true)
        .order("deleted_at", { ascending: false });
      mapped = (data || []).map((r: any) => ({
        id: r.id,
        label: r.case_id,
        sub: `${r.customer_name ?? "—"} · ${r.status ?? ""}`,
        deleted_at: r.deleted_at,
      }));
    } else if (table === "indents") {
      const { data } = await supabase
        .from("indents" as never)
        .select("id,indent_no,company,case_id,deleted_at")
        .eq("is_deleted", true)
        .order("deleted_at", { ascending: false });
      mapped = ((data as any[]) || []).map((r: any) => ({
        id: r.id,
        label: r.indent_no || r.id,
        sub: `${r.company || "—"} · Case ${r.case_id ?? "—"}`,
        deleted_at: r.deleted_at,
      }));
    } else {
      const { data } = await supabase
        .from("amcs")
        .select("id,agreement_no,client_company,client_name,deleted_at")
        .eq("is_deleted", true)
        .order("deleted_at", { ascending: false });
      mapped = ((data as any[]) || []).map((r: any) => ({
        id: r.id,
        label: r.agreement_no,
        sub: r.client_company || r.client_name || "—",
        deleted_at: r.deleted_at,
      }));
    }
    setRows(mapped);
  }, [table]);

  useEffect(() => { load(); }, [load]);
  useRealtimeRefetch(table, load);

  const restore = async (id: string) => {
    const { error } = await restoreRecord(table, id);
    if (error) return toast.error(error.message);
    toast.success("Restored");
    load();
  };

  const purge = async (id: string, label: string) => {
    const ok = await confirm({
      title: `Permanently delete ${label}?`,
      description: "This cannot be undone. The record will be erased immediately, before its 30-day auto-purge.",
      confirmLabel: "Delete Forever",
      variant: "danger",
    });
    if (!ok) return;
    const { error } = await purgeRecord(table, id);
    if (error) return toast.error(error.message);
    toast.success("Permanently deleted");
    load();
  };

  return (
    <Card>
      <CardHeader className="py-3"><CardTitle className="text-sm">Archived {title} ({rows?.length ?? 0})</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Record</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Deleted</TableHead>
              <TableHead>Auto-purge in</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows === null ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No archived {title.toLowerCase()}.</TableCell></TableRow>
            ) : rows.map((r) => {
              const d = daysLeft(r.deleted_at);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.label}</TableCell>
                  <TableCell className="text-sm">{r.sub}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.deleted_at ? new Date(r.deleted_at).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={d <= 3 ? "destructive" : "secondary"}>{d} day{d === 1 ? "" : "s"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" onClick={() => restore(r.id)}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => purge(r.id, r.label)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Purge
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="px-4 py-2 text-[11px] text-muted-foreground border-t">
          <Link to="/dashboard" className="underline">← Back to dashboard</Link>
        </div>
      </CardContent>
    </Card>
  );
}