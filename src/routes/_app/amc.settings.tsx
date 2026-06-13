import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/useRole";

export const Route = createFileRoute("/_app/amc/settings")({
  component: AmcSettings,
  head: () => ({ meta: [{ title: "AMC Terms Template — Prokon" }] }),
});

function AmcSettings() {
  const [terms, setTerms] = useState("");
  const [prefix, setPrefix] = useState("PHS/AMC/");
  const [busy, setBusy] = useState(false);
  const { isAdmin } = useIsAdmin();

  useEffect(() => {
    supabase.from("amc_settings").select("terms_template,prefix").eq("id", 1).maybeSingle()
      .then(({ data }) => {
        const row = data as { terms_template?: string; prefix?: string } | null;
        setTerms(row?.terms_template || "");
        setPrefix(row?.prefix || "PHS/AMC/");
      });
  }, []);

  const save = async () => {
    setBusy(true);
    const payload: Record<string, unknown> = { id: 1, terms_template: terms, updated_at: new Date().toISOString() };
    if (isAdmin) payload.prefix = prefix.trim() || "PHS/AMC/";
    const { error } = await supabase.from("amc_settings").upsert(payload as never);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("AMC settings saved");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/amc"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
        <Button onClick={save} disabled={busy}><Save className="h-4 w-4 mr-1" />Save</Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>AMC Agreement Number</CardTitle>
          <p className="text-sm text-muted-foreground">
            Format: <span className="font-mono">{`{PREFIX}{ddMMyyHHmm}{SEQ}`}</span> — example <span className="font-mono">{`${prefix || "PHS/AMC/"}1306261430` + "0001"}</span>. Auto-generated on save; manual editing is disabled.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 max-w-md">
          <Label>AMC Prefix {isAdmin ? "" : <span className="text-xs text-muted-foreground">(admin only)</span>}</Label>
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={!isAdmin} placeholder="PHS/AMC/" className="font-mono" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Default Terms & Conditions Template</CardTitle>
          <p className="text-sm text-muted-foreground">This text is pre-loaded into every new AMC and can still be edited per-agreement.</p>
        </CardHeader>
        <CardContent>
          <Textarea rows={20} value={terms} onChange={(e) => setTerms(e.target.value)} className="font-mono text-xs" />
        </CardContent>
      </Card>
    </div>
  );
}