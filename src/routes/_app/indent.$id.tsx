import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, ArrowLeft, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { INDENT_TYPES, type Indent, type IndentType } from "@/lib/indent";
import { getOemLogo } from "@/lib/oemLogos";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";

export const Route = createFileRoute("/_app/indent/$id")({
  component: IndentDetail,
});

function IndentDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [i, setI] = useState<Indent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("indents" as never).select("*").eq("id", id).maybeSingle();
      if (error) { toast.error(error.message); return; }
      setI((data || null) as unknown as Indent | null);
    })();
  }, [id]);

  const update = (p: Partial<Indent>) => setI((s) => (s ? { ...s, ...p } : s));

  const save = async () => {
    if (!i) return;
    setBusy(true);
    const { error } = await supabase.from("indents" as never).update({
      indent_date: i.indent_date,
      indent_city: i.indent_city,
      case_id: i.case_id,
      oem_case_id: i.oem_case_id,
      company: i.company,
      def_model_no: i.def_model_no,
      def_serial_no: i.def_serial_no,
      problem_reported: i.problem_reported,
      indent_type: i.indent_type,
      oracles: i.oracles,
      material_exchange_model: i.material_exchange_model,
      material_exchange_serial_no: i.material_exchange_serial_no,
      material_rec_model_no: i.material_rec_model_no,
      material_rec_serial_no: i.material_rec_serial_no,
      material_rec_date: i.material_rec_date,
      engineer_name: i.engineer_name,
      remarks: i.remarks,
    } as never).eq("id", i.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
  };

  const del = async () => {
    if (!i || !confirm("Delete this INDENT?")) return;
    const { error } = await supabase.from("indents" as never).delete().eq("id", i.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    navigate({ to: "/indent" });
  };

  if (!i) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const oem = getOemLogo(i.company);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <img src={prokonLogo.url} alt="Prokon" className="h-10 w-auto object-contain" />
            <div>
              <div className="font-semibold leading-tight">Prokon Hi-Tech Systems</div>
              <div className="text-xs text-muted-foreground">INDENT · <span className="font-mono">{i.indent_no}</span></div>
            </div>
          </div>
          {oem && <img src={oem.url} alt={oem.alt} className="h-9 w-auto object-contain" />}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/indent" })}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div className="flex gap-2">
          <Link to="/tickets/$id" params={{ id: i.ticket_id }}>
            <Button variant="outline" size="sm"><ExternalLink className="h-4 w-4 mr-1" />Open Ticket</Button>
          </Link>
          <Button onClick={save} disabled={busy}><Save className="h-4 w-4 mr-1" />Save</Button>
          <Button variant="destructive" size="icon" onClick={del}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Linked Ticket (read-only sync)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Case ID</Label><Input value={i.case_id || ""} onChange={(e) => update({ case_id: e.target.value })} className="font-mono bg-muted/50" readOnly /></div>
          <div><Label>OEM Case ID</Label><Input value={i.oem_case_id || ""} onChange={(e) => update({ oem_case_id: e.target.value })} className="font-mono" /></div>
          <div><Label>Company (OEM)</Label><Input value={i.company || ""} onChange={(e) => update({ company: e.target.value })} /></div>
          <div><Label>DEF Model No</Label><Input value={i.def_model_no || ""} onChange={(e) => update({ def_model_no: e.target.value })} /></div>
          <div><Label>DEF Serial No</Label><Input value={i.def_serial_no || ""} onChange={(e) => update({ def_serial_no: e.target.value.toUpperCase() })} className="font-mono" /></div>
          <div><Label>Engineer</Label><Input value={i.engineer_name || ""} onChange={(e) => update({ engineer_name: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>Problem Reported</Label><Textarea rows={2} value={i.problem_reported || ""} onChange={(e) => update({ problem_reported: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">INDENT</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Indent City</Label><Input value={i.indent_city || ""} onChange={(e) => update({ indent_city: e.target.value })} /></div>
          <div><Label>Indent Date</Label><Input type="date" value={i.indent_date} onChange={(e) => update({ indent_date: e.target.value })} /></div>
          <div>
            <Label>Indent Type</Label>
            <Select value={i.indent_type || ""} onValueChange={(v) => update({ indent_type: v as IndentType })}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>{INDENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3"><Label>Oracles</Label><Input value={i.oracles || ""} onChange={(e) => update({ oracles: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Material Exchange</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Material Exchange Model</Label><Input value={i.material_exchange_model || ""} onChange={(e) => update({ material_exchange_model: e.target.value })} /></div>
          <div><Label>Material Exchange Serial No</Label><Input value={i.material_exchange_serial_no || ""} onChange={(e) => update({ material_exchange_serial_no: e.target.value.toUpperCase() })} className="font-mono" /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Material Received</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Material Rec Model No</Label><Input value={i.material_rec_model_no || ""} onChange={(e) => update({ material_rec_model_no: e.target.value })} /></div>
          <div><Label>Material Rec Serial No</Label><Input value={i.material_rec_serial_no || ""} onChange={(e) => update({ material_rec_serial_no: e.target.value.toUpperCase() })} className="font-mono" /></div>
          <div><Label>Material Rec Date</Label><Input type="date" value={i.material_rec_date || ""} onChange={(e) => update({ material_rec_date: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>Remarks</Label><Textarea rows={2} value={i.remarks || ""} onChange={(e) => update({ remarks: e.target.value })} /></div>
        </CardContent>
      </Card>
    </div>
  );
}