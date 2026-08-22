import { useMemo, useState } from "react";
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

  const rowsQuery = useQuery({
    queryKey: ["masters", table],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as any)
        .select(cols)
        .order(orderBy, { ascending: false });
      if (error) {
        toast.error(error.message);
        return [];
      }
      return (data as any) ?? [];
    },
  });
  const rows = (rowsQuery.data ?? []) as any[];
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

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No records yet.</div>
        ) : (
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
                            ? ((optionMap[f.key] ?? []).find((o) => o.value === r[f.key])?.label ??
                              "—")
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
