import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/amc/settings")({
  component: AmcSettings,
  head: () => ({ meta: [{ title: "AMC Terms Template — Prokon" }] }),
});

function AmcSettings() {
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("amc_settings").select("terms_template").eq("id", 1).maybeSingle()
      .then(({ data }) => setTerms((data?.terms_template as string) || ""));
  }, []);

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("amc_settings").upsert({ id: 1, terms_template: terms, updated_at: new Date().toISOString() } as never);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Default terms template saved");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/amc"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
        <Button onClick={save} disabled={busy}><Save className="h-4 w-4 mr-1" />Save</Button>
      </div>
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