import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/hooks/useConfirm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { useIsAdmin } from "@/lib/useRole";
import { MasterCrud } from "@/components/MasterCrud";

export const Route = createFileRoute("/_app/tickets/settings")({
  component: TicketSettings,
});

function TicketSettings() {  const confirm = useConfirm();

  const { isAdmin } = useIsAdmin();
  const [prefix, setPrefix] = useState("TKT");
  const [savingPrefix, setSavingPrefix] = useState(false);
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [newType, setNewType] = useState("");

  const load = async () => {
    const [{ data: s }, { data: ct }] = await Promise.all([
      supabase.from("ticket_settings").select("prefix").eq("id", 1).maybeSingle(),
      supabase.from("call_type_master").select("id,name").order("name"),
    ]);
    if (s) setPrefix((s as { prefix: string }).prefix || "TKT");
    setTypes((ct || []) as { id: string; name: string }[]);
  };
  useEffect(() => { load(); }, []);

  const savePrefix = async () => {
    const p = prefix.trim().toUpperCase();
    if (!p) return toast.error("Prefix required");
    setSavingPrefix(true);
    const { error } = await supabase.from("ticket_settings").update({ prefix: p, updated_at: new Date().toISOString() } as never).eq("id", 1);
    setSavingPrefix(false);
    if (error) return toast.error(error.message);
    toast.success("Prefix updated");
  };

  const addType = async () => {
    const n = newType.trim();
    if (!n) return;
    const { error } = await supabase.from("call_type_master").insert({ name: n } as never);
    if (error) return toast.error(error.message);
    setNewType("");
    load();
  };

  const delType = async (id: string) => {
    const ok = await confirm({
      title: "Delete this call type?",
      description: "Call types already attached to tickets are not affected.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("call_type_master").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader><CardTitle>Ticket ID Prefix {!isAdmin && <Badge variant="secondary" className="ml-2">Admin only</Badge>}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Format: <code className="font-mono">{prefix || "TKT"}yyMMddHHmmss###</code> — e.g. <code className="font-mono">{prefix || "TKT"}240610153045001</code>.
            Sequence is continuous and never resets when the prefix changes.
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1 max-w-xs">
              <Label>Prefix</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase().slice(0, 6))} maxLength={6} disabled={!isAdmin} className="font-mono" />
            </div>
            <Button onClick={savePrefix} disabled={!isAdmin || savingPrefix}>Save</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Call Types</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="Add new call type" onKeyDown={(e) => e.key === "Enter" && addType()} />
            <Button onClick={addType}><Plus className="h-4 w-4 mr-1" />Add</Button>
          </div>
          <div className="border rounded-md divide-y">
            {types.length === 0 && <div className="p-3 text-sm text-muted-foreground">No call types yet.</div>}
            {types.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-2">
                <span>{t.name}</span>
                {isAdmin && (
                  <Button size="icon" variant="ghost" onClick={() => delType(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <MasterCrud
        table="complaint_master"
        title="Complaints"
        canEdit={isAdmin}
        fields={[
          { key: "name", label: "Complaint Name", type: "title", required: true },
          { key: "active", label: "Active", type: "boolean" },
        ]}
      />
    </div>
  );
}