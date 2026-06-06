import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { toTitleCaseSmart, upperTrim } from "@/lib/text";

export type FieldType = "text" | "textarea" | "email" | "phone" | "number" | "date" | "boolean" | "upper" | "title";

export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  showInList?: boolean;
}

interface Props {
  table: string;
  title: string;
  fields: FieldDef[];
  canEdit: boolean;
  orderBy?: string;
}

export function MasterCrud({ table, title, fields, canEdit, orderBy = "created_at" }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from(table as any).select("*").order(orderBy, { ascending: false });
    if (error) toast.error(error.message);
    setRows((data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [table]);

  function startNew() {
    const init: Record<string, any> = {};
    fields.forEach((f) => { init[f.key] = f.type === "boolean" ? true : ""; });
    setForm(init);
    setEditing({});
  }
  function startEdit(row: any) {
    const init: Record<string, any> = {};
    fields.forEach((f) => { init[f.key] = row[f.key] ?? (f.type === "boolean" ? false : ""); });
    setForm(init);
    setEditing(row);
  }
  function cancel() { setEditing(null); setForm({}); }

  function normalize(): Record<string, any> {
    const out: Record<string, any> = {};
    fields.forEach((f) => {
      let v = form[f.key];
      if (v === "" || v === undefined) { out[f.key] = null; return; }
      if (f.type === "upper") v = upperTrim(String(v));
      else if (f.type === "title" || f.type === "text" || f.type === "textarea") v = toTitleCaseSmart(String(v));
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
      const { error } = await supabase.from(table as any).update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Updated");
    } else {
      const { error } = await supabase.from(table as any).insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Added");
    }
    cancel();
    load();
  }

  async function remove(row: any) {
    if (!confirm(`Delete "${row[fields[0].key] ?? "this record"}"?`)) return;
    const { error } = await supabase.from(table as any).delete().eq("id", row.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  }

  const listFields = fields.filter((f) => f.showInList !== false).slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{title}</CardTitle>
        {canEdit && !editing && (
          <Button size="sm" onClick={startNew}><Plus className="h-4 w-4 mr-1" />New</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {editing && (
          <div className="border rounded-md p-3 bg-muted/30 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fields.map((f) => (
                <div key={f.key} className={f.type === "textarea" ? "md:col-span-2" : ""}>
                  <Label className="text-xs">{f.label}{f.required && " *"}</Label>
                  {f.type === "textarea" ? (
                    <Textarea value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  ) : f.type === "boolean" ? (
                    <select className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                      value={form[f.key] ? "true" : "false"}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value === "true" })}>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <Input
                      type={f.type === "date" ? "date" : f.type === "number" ? "number" : f.type === "email" ? "email" : "text"}
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={cancel}><X className="h-4 w-4 mr-1" />Cancel</Button>
              <Button size="sm" onClick={save}>{editing?.id ? "Update" : "Save"}</Button>
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
                  {listFields.map((f) => <TableHead key={f.key}>{f.label}</TableHead>)}
                  {canEdit && <TableHead className="w-24">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    {listFields.map((f) => (
                      <TableCell key={f.key} className="text-sm">
                        {f.type === "boolean" ? (r[f.key] ? "Yes" : "No") : (r[f.key] ?? "—")}
                      </TableCell>
                    ))}
                    {canEdit && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => startEdit(r)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
  );
}