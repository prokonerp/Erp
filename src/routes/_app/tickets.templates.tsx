import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TEMPLATE_PLACEHOLDERS, type WaTemplateId } from "@/lib/tickets";
import { Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/tickets/templates")({
  component: TemplatesPage,
});

type Row = { id: string; name: string; body: string };

function TemplatesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase.from("wa_templates").select("id,name,body").order("name");
    setRows((data || []) as Row[]);
  };
  useEffect(() => { load(); }, []);

  const update = (id: string, body: string) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, body } : x)));

  const save = async (row: Row) => {
    setBusy(row.id);
    const { error } = await supabase.from("wa_templates").update({ body: row.body } as never).eq("id", row.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`${row.name} saved`);
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold">WhatsApp Templates</h2>
        <p className="text-sm text-muted-foreground">
          Edit the message text sent via WhatsApp. Use <code className="font-mono">{"{{placeholder}}"}</code> tokens — they're auto-replaced with ticket data.
        </p>
      </div>
      {rows.map((row) => {
        const phs = TEMPLATE_PLACEHOLDERS[row.id as WaTemplateId] || [];
        return (
          <Card key={row.id}>
            <CardHeader>
              <CardTitle>{row.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Message</Label>
                <Textarea
                  rows={10}
                  value={row.body}
                  onChange={(e) => update(row.id, e.target.value)}
                  className="font-mono text-sm"
                />
              </div>
              {phs.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Available placeholders:</span>{" "}
                  {phs.map((p) => (
                    <code key={p} className="font-mono bg-muted px-1 py-0.5 rounded mr-1">{`{{${p}}}`}</code>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => save(row)} disabled={busy === row.id}>
                  <Save className="h-4 w-4 mr-1" />Save
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Loading…</p>}
    </div>
  );
}