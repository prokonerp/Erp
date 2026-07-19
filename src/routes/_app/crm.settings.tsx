import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Save, Star } from "lucide-react";
import { toast } from "sonner";
import { INDIAN_STATES, type CrmSettings, type QuoteTermsTemplate } from "@/lib/crm";
import { OemLogoSettings } from "@/components/OemLogoSettings";

export const Route = createFileRoute("/_app/crm/settings")({
  component: CrmSettingsPage,
  head: () => ({ meta: [{ title: "CRM Settings — Prokon" }] }),
});

function CrmSettingsPage() {
  const [s, setS] = useState<CrmSettings>({
    id: 1, business_state: "Haryana", business_gstin: "",
    default_terms: "", default_customer_notes: "Thanks for your business.",
  });
  const [tpls, setTpls] = useState<QuoteTermsTemplate[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [r1, r2] = await Promise.all([
      supabase.from("crm_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("quote_terms_templates").select("*").order("sort_order"),
    ]);
    if (r1.data) setS(r1.data as unknown as CrmSettings);
    setTpls((r2.data || []) as unknown as QuoteTermsTemplate[]);
  };
  useEffect(() => { load(); }, []);

  const saveSettings = async () => {
    setSaving(true);
    const { error } = await supabase.from("crm_settings").upsert({
      id: 1,
      business_state: s.business_state,
      business_gstin: s.business_gstin || null,
      default_terms: s.default_terms || "",
      default_customer_notes: s.default_customer_notes || "",
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
  };

  const setTpl = (i: number, patch: Partial<QuoteTermsTemplate>) => {
    const next = [...tpls]; next[i] = { ...next[i], ...patch }; setTpls(next);
  };
  const addTpl = () => setTpls([...tpls, { id: crypto.randomUUID(), name: "New template", body: "", is_default: false, sort_order: tpls.length + 1 } as QuoteTermsTemplate]);
  const delTpl = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    await supabase.from("quote_terms_templates").delete().eq("id", id);
    load();
  };
  const saveTpls = async () => {
    // ensure only one default
    const defaults = tpls.filter((t) => t.is_default);
    if (defaults.length > 1) return toast.error("Only one template can be default");
    for (const t of tpls) {
      const { error } = await supabase.from("quote_terms_templates").upsert({
        id: t.id, name: t.name, body: t.body || "", is_default: !!t.is_default, sort_order: Number(t.sort_order || 0),
      } as any);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Templates saved"); load();
  };
  const makeDefault = (i: number) => {
    setTpls(tpls.map((t, idx) => ({ ...t, is_default: idx === i })));
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Business details</CardTitle>
          <Button size="sm" onClick={saveSettings} disabled={saving}>
            <Save className="h-4 w-4 mr-1" />{saving ? "Saving..." : "Save"}
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Business state (for GST split)</Label>
            <Select value={s.business_state} onValueChange={(v) => setS({ ...s, business_state: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Quotes use CGST + SGST when Place of Supply matches this state, otherwise IGST.
            </p>
          </div>
          <div>
            <Label>Business GSTIN</Label>
            <Input value={s.business_gstin || ""} onChange={(e) => setS({ ...s, business_gstin: e.target.value })} placeholder="06ABCDE1234F1Z5" />
          </div>
          <div className="md:col-span-2">
            <Label>Default customer notes</Label>
            <Textarea rows={2} value={s.default_customer_notes || ""} onChange={(e) => setS({ ...s, default_customer_notes: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label>Default terms &amp; conditions</Label>
            <Textarea rows={6} value={s.default_terms || ""} onChange={(e) => setS({ ...s, default_terms: e.target.value })} placeholder="Payment terms, validity, warranty, jurisdiction..." />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Quotation terms templates</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addTpl}><Plus className="h-4 w-4 mr-1" />Add</Button>
            <Button size="sm" onClick={saveTpls}><Save className="h-4 w-4 mr-1" />Save</Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Reusable terms shown in the quotation editor. Mark one as default to auto-apply on new quotes.</p>
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-48">Name</TableHead>
              <TableHead>Body</TableHead>
              <TableHead className="w-20">Order</TableHead>
              <TableHead className="w-24">Default</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {tpls.map((t, i) => (
                <TableRow key={t.id}>
                  <TableCell><Input value={t.name} onChange={(e) => setTpl(i, { name: e.target.value })} /></TableCell>
                  <TableCell><Textarea rows={3} value={t.body} onChange={(e) => setTpl(i, { body: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" value={t.sort_order} onChange={(e) => setTpl(i, { sort_order: Number(e.target.value) })} /></TableCell>
                  <TableCell>
                    <Button size="sm" variant={t.is_default ? "default" : "outline"} onClick={() => makeDefault(i)}>
                      <Star className={"h-4 w-4 " + (t.is_default ? "fill-current" : "")} />
                    </Button>
                  </TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => delTpl(t.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button></TableCell>
                </TableRow>
              ))}
              {tpls.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No templates yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <OemLogoSettings />
    </div>
  );
}