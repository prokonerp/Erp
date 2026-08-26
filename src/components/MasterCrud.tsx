import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { toTitleCaseSmart, upperTrim } from "@/lib/text";

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "boolean"
  | "upper"
  | "title"
  | "select";

export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  showInList?: boolean;
  /** For type: "select" — options loader (async) or static list. Returns [{value,label}]. */
  optionsFrom?: { table: string; valueKey?: string; labelKey?: string; orderBy?: string };
  options?: { value: string; label: string }[];
}

interface Props {
  table: string;
  title: string;
  fields: FieldDef[];
  canEdit: boolean;
  orderBy?: string;
}

export function MasterCrud({ table, title, fields, canEdit, orderBy = "created_at" }: Props) {
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const queryClient = useQueryClient();

  // Fetch only the columns the form/list actually use (not select("*")).
  const cols = useMemo(() => ["id", ...fields.map((f) => f.key)].join(", "), [fields]);

  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const rowsQuery = useQuery({
    queryKey: ["masters", table, { page, pageSize, debouncedQ, cols, orderBy }],
    queryFn: async () => {
      let query = supabase.from(table as any).select(cols, { count: "exact" });
      if (debouncedQ) {
        const p = `%${debouncedQ}%`;
        // Search first 3 text-like fields server-side for instant filtering
        const searchKeys = fields
          .filter((f) => ["text", "title", "upper", "textarea", "email", "phone"].includes(f.type || "text"))
          .slice(0, 3)
          .map((f) => f.key);
        if (searchKeys.length) {
          query = query.or(searchKeys.map((k) => `${k}.ilike.${p}`).join(","));
        }
      }
      query = query.order(orderBy, { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1);
      const { data, error, count } = await query;
      if (error) {
        toast.error(error.message);
        return { rows: [], count: 0 };
      }
      return { rows: (data as any) ?? [], count: count ?? 0 };
    },
    placeholderData: (prev: any) => prev,
    staleTime: 30 * 1000,
  });
  const rows = (rowsQuery.data?.rows ?? []) as any[];
  const totalCount = rowsQuery.data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const loading = rowsQuery.isLoading;

  const optionsQuery = useQuery({
    queryKey: ["masters", table, "options"],
    queryFn: async () => {
      const map: Record<string, { value: string; label: string }[]> = {};
      for (const f of fields) {
        if (f.type === "select") {
          if (f.options) {
            map[f.key] = f.options;
            continue;
          }
          if (f.optionsFrom) {
            const vk = f.optionsFrom.valueKey ?? "id";
            const lk = f.optionsFrom.labelKey ?? "name";
            const ob = f.optionsFrom.orderBy ?? lk;
            const { data } = await supabase
              .from(f.optionsFrom.table as any)
              .select(`${vk},${lk}`)
              .order(ob, { ascending: true });
            map[f.key] = ((data as any[]) ?? []).map((r) => ({ value: r[vk], label: r[lk] }));
          }
        }
      }
      return map;
    },
  });
  const optionMap = optionsQuery.data ?? {};

  function startNew() {
    const init: Record<string, any> = {};
    fields.forEach((f) => {
      init[f.key] = f.type === "boolean" ? true : "";
    });
    setForm(init);
    setEditing({});
  }
  function startEdit(row: any) {
    const init: Record<string, any> = {};
    fields.forEach((f) => {
      init[f.key] = row[f.key] ?? (f.type === "boolean" ? false : "");
    });
    setForm(init);
    setEditing(row);
  }
  function cancel() {
    setEditing(null);
    setForm({});
  }

  function normalize(): Record<string, any> {
    const out: Record<string, any> = {};
    fields.forEach((f) => {
      let v = form[f.key];
      if (v === "" || v === undefined) {
        out[f.key] = null;
        return;
      }
      if (f.type === "upper") v = upperTrim(String(v));
      else if (f.type === "title" || f.type === "text" || f.type === "textarea")
        v = toTitleCaseSmart(String(v));
      else if (f.type === "number") v = Number(v);
      out[f.key] = v;
    });
    return out;
  }

  async function save() {
    for (const f of fields) {
      if (f.required && !form[f.key] && f.type !== "boolean") {
        toast.error(`${f.label} is required`);
        return;
      }
    }
    const payload = normalize();
    if (editing?.id) {
      const { error } = await supabase
        .from(table as any)
        .update(payload)
        .eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Updated");
    } else {
      const { error } = await supabase.from(table as any).insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Added");
    }
    cancel();
    queryClient.invalidateQueries({ queryKey: ["masters", table] });
  }

  const [confirmTarget, setConfirmTarget] = useState<{ title: string; onConfirm: () => void } | null>(null);

  async function remove(row: any) {
    setConfirmTarget({
      title: `Delete "${row[fields[0].key] ?? "this record"}"?`,
      onConfirm: async () => {
        const { error } = await supabase
          .from(table as any)
          .delete()
          .eq("id", row.id);
        if (error) return toast.error(error.message);
        toast.success("Deleted");
        queryClient.invalidateQueries({ queryKey: ["masters", table] });
      },
    });
  }

  const listFields = fields.filter((f) => f.showInList !== false).slice(0, 5);

  return (
    <>
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{title}</CardTitle>
        {canEdit && !editing && (
          <Button size="sm" onClick={startNew}>
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {editing && (
          <div className="border rounded-md p-3 bg-muted/30 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fields.map((f) => (
                <div key={f.key} className={f.type === "textarea" ? "md:col-span-2" : ""}>
                  <Label className="text-xs">
                    {f.label}
                    {f.required && " *"}
                  </Label>
                  {f.type === "textarea" ? (
                    <Textarea
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  ) : f.type === "boolean" ? (
                    <select
                      className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                      value={form[f.key] ? "true" : "false"}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value === "true" })}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : f.type === "select" ? (
                    <select
                      className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value || null })}
                    >
                      <option value="">— Select —</option>
                      {(optionMap[f.key] ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      type={
                        f.type === "date"
                          ? "date"
                          : f.type === "number"
                            ? "number"
                            : f.type === "email"
                              ? "email"
                              : "text"
                      }
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={cancel}>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={save}>
                {editing?.id ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 pl-8 text-sm" />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{totalCount.toLocaleString()} total{totalCount > pageSize ? ` · Page ${page + 1} of ${pageCount}` : ""}</span>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">{debouncedQ ? `No results for "${debouncedQ}"` : "No records yet."}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {listFields.map((f) => (
                      <TableHead key={f.key}>{f.label}</TableHead>
                    ))}
                    {canEdit && <TableHead className="w-24">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      {listFields.map((f) => (
                        <TableCell key={f.key} className="text-sm">
                          {f.type === "boolean"
                            ? r[f.key]
                              ? "Yes"
                              : "No"
                            : f.type === "select"
                              ? ((optionMap[f.key] ?? []).find((o) => o.value === r[f.key])?.label ?? "—")
                              : (r[f.key] ?? "—")}
                        </TableCell>
                      ))}
                      {canEdit && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => startEdit(r)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => remove(r)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalCount > pageSize && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">
                  Page {page + 1} of {pageCount} · {totalCount.toLocaleString()} records
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
    <ConfirmDialog
      open={!!confirmTarget}
      onOpenChange={(o) => !o && setConfirmTarget(null)}
      title={confirmTarget?.title ?? ""}
      description="This action cannot be undone."
      confirmLabel="Delete"
      variant="danger"
      onConfirm={async () => { await confirmTarget?.onConfirm(); setConfirmTarget(null); }}
    />
  </>
  );
}
