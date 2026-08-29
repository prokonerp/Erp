import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Save, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { INDIAN_STATES, type CrmSettings, type QuoteTermsTemplate } from "@/lib/crm";
import { OemLogoSettings } from "@/components/OemLogoSettings";
import { useConfirm } from "@/hooks/useConfirm";
import { PageHeader } from "@/components/crm/PageHeader";
import { PageLoader } from "@/components/shared/skeletons";

export const Route = createFileRoute("/_app/crm/settings")({
  component: CrmSettingsPage,
  head: () => ({ meta: [{ title: "CRM Settings — Prokon" }] }),
});

function CrmSettingsPage() {
  const confirm = useConfirm();
  const [s, setS] = useState<CrmSettings>({
    id: 1,
    business_state: "Haryana",
    business_gstin: "",
    default_terms: "",
    default_customer_notes: "Thanks for your business.",
  });
  const [tpls, setTpls] = useState<QuoteTermsTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [r1, r2] = await Promise.all([
      supabase.from("crm_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("quote_terms_templates").select("*").order("sort_order"),
    ]);
    if (r1.data) setS(r1.data as unknown as CrmSettings);
    setTpls((r2.data || []) as unknown as QuoteTermsTemplate[]);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const saveSettings = async () => {
    setSaving(true);
    const { error } = await supabase.from("crm_settings").upsert({
      id: 1,
      business_state: s.business_state,
      business_gstin: s.business_gstin || null,
      default_terms: s.default_terms || "",
      default_customer_notes: s.default_customer_notes || "",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
  };

  const setTpl = (i: number, patch: Partial<QuoteTermsTemplate>) => {
    const next = [...tpls];
    next[i] = { ...next[i], ...patch };
    setTpls(next);
  };
  const addTpl = () =>
    setTpls([
      ...tpls,
      {
        id: crypto.randomUUID(),
        name: "New template",
        body: "",
        is_default: false,
        sort_order: tpls.length + 1,
      } as QuoteTermsTemplate,
    ]);
  const delTpl = async (id: string) => {
    const ok = await confirm({
      title: "Delete this template?",
      description: "Quotations already using it are not affected.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("quote_terms_templates").delete().eq("id", id);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    load();
  };
  const saveTpls = async () => {
    // ensure only one default
    const defaults = tpls.filter((t) => t.is_default);
    if (defaults.length > 1) return toast.error("Only one template can be default");
    for (const t of tpls) {
      const { error } = await supabase.from("quote_terms_templates").upsert({
        id: t.id,
        name: t.name,
        body: t.body || "",
        is_default: !!t.is_default,
        sort_order: Number(t.sort_order || 0),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    toast.success("Templates saved");
    load();
  };
  const makeDefault = (i: number) => {
    setTpls(tpls.map((t, idx) => ({ ...t, is_default: idx === i })));
  };

  if (loading) return <PageLoader label="Loading CRM settings…" />;

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="CRM Settings"
        description="Business details, default terms and quotation templates."
        group="Customers (Sales & CRM)"
        icon={SettingsIcon}
        primary={{
          label: saving ? "Saving…" : "Save Settings",
          onClick: saveSettings,
          icon: Save,
          disabled: saving,
        }}
      />

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">
            Business details
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Business state (for GST split)</Label>
            <Select
              value={s.business_state}
              onValueChange={(v) => setS({ ...s, business_state: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((st) => (
                  <SelectItem key={st} value={st}>
                    {st}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Quotes use CGST + SGST when Place of Supply matches this state, otherwise IGST.
            </p>
          </div>
          <div>
            <Label>Business GSTIN</Label>
            <Input
              value={s.business_gstin || ""}
              onChange={(e) => setS({ ...s, business_gstin: e.target.value })}
              placeholder="06ABCDE1234F1Z5"
            />
          </div>
          <div className="md:col-span-2">
            <Label>Default customer notes</Label>
            <Textarea
              rows={2}
              value={s.default_customer_notes || ""}
              onChange={(e) => setS({ ...s, default_customer_notes: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <Label>Default terms &amp; conditions</Label>
            <Textarea
              rows={6}
              value={s.default_terms || ""}
              onChange={(e) => setS({ ...s, default_terms: e.target.value })}
              placeholder="Payment terms, validity, warranty, jurisdiction..."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">
            Quotation terms templates
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addTpl}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
            <Button size="sm" onClick={saveTpls}>
              <Save className="h-4 w-4 mr-1" />
              Save
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-4 w-3/4 bg-muted rounded" />
              <div className="h-4 w-1/2 bg-muted rounded" />
              <div className="h-4 w-full bg-muted rounded" />
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Reusable terms shown in the quotation editor. Mark one as default to auto-apply on
                new quotes.
              </p>
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="w-48 uppercase tracking-wide text-[11px]">Name</TableHead>
                    <TableHead className="uppercase tracking-wide text-[11px]">Body</TableHead>
                    <TableHead className="w-20 uppercase tracking-wide text-[11px]">
                      Order
                    </TableHead>
                    <TableHead className="w-28 uppercase tracking-wide text-[11px]">
                      Default
                    </TableHead>
                    <TableHead className="w-12 uppercase tracking-wide text-[11px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tpls.map((t, i) => (
                    <TableRow key={t.id} className="hover:bg-muted/30">
                      <TableCell>
                        <Input
                          value={t.name}
                          onChange={(e) => setTpl(i, { name: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Textarea
                          rows={3}
                          value={t.body}
                          onChange={(e) => setTpl(i, { body: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        <Input
                          type="number"
                          value={t.sort_order}
                          onChange={(e) => setTpl(i, { sort_order: Number(e.target.value) })}
                        />
                      </TableCell>
                      <TableCell className="flex items-center justify-center">
                        <Switch
                          checked={t.is_default}
                          onCheckedChange={(v) => {
                            if (v) makeDefault(i);
                          }}
                          aria-label={t.is_default ? "Default template" : "Set as default"}
                        />
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => delTpl(t.id)}>
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {tpls.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        No templates yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <OemLogoSettings />
    </div>
  );
}
