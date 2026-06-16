import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { INDENT_TYPES, type IndentType } from "@/lib/indent";
import { getOemLogo } from "@/lib/oemLogos";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";

const searchSchema = z.object({ ticket_id: z.string().optional() });

export const Route = createFileRoute("/_app/indent/new")({
  validateSearch: (s) => searchSchema.parse(s),
  component: NewIndent,
});

type Form = {
  indent_date: string;
  ticket_id: string;
  indent_city: string;
  case_id: string;
  oem_case_id: string;
  company: string;
  def_model_no: string;
  def_serial_no: string;
  problem_reported: string;
  indent_type: IndentType | "";
  oracles: string;
  material_exchange_model: string;
  material_exchange_serial_no: string;
  material_rec_model_no: string;
  material_rec_serial_no: string;
  material_rec_date: string;
  engineer_name: string;
  remarks: string;
};

const blank: Form = {
  indent_date: new Date().toISOString().slice(0, 10),
  ticket_id: "",
  indent_city: "",
  case_id: "",
  oem_case_id: "",
  company: "",
  def_model_no: "",
  def_serial_no: "",
  problem_reported: "",
  indent_type: "",
  oracles: "",
  material_exchange_model: "",
  material_exchange_serial_no: "",
  material_rec_model_no: "",
  material_rec_serial_no: "",
  material_rec_date: "",
  engineer_name: "",
  remarks: "",
};

function NewIndent() {
  const { ticket_id } = Route.useSearch();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(ticket_id));

  useEffect(() => {
    if (!ticket_id) return;
    (async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("id, case_id, oem_call, oem_brand, oem_ref_id, product, serial_no, location, complaint, assigned_engineer_name")
        .eq("id", ticket_id)
        .maybeSingle();
      if (error) { toast.error(error.message); setLoading(false); return; }
      if (!data) { toast.error("Ticket not found"); setLoading(false); return; }
      if (!data.oem_call) {
        toast.error("Indent can only be created from OEM-tagged tickets");
        navigate({ to: "/tickets/$id", params: { id: ticket_id } });
        return;
      }
      setForm((f) => ({
        ...f,
        ticket_id: data.id,
        case_id: data.case_id || "",
        oem_case_id: data.oem_ref_id || "",
        company: data.oem_brand || "",
        def_model_no: data.product || "",
        def_serial_no: data.serial_no || "",
        indent_city: data.location || "",
        problem_reported: data.complaint || "",
        engineer_name: data.assigned_engineer_name || "",
      }));
      setLoading(false);
    })();
  }, [ticket_id, navigate]);

  const set = (p: Partial<Form>) => setForm((s) => ({ ...s, ...p }));

  const save = async () => {
    if (!form.ticket_id) return toast.error("Linked Ticket is required");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const payload = {
      indent_date: form.indent_date,
      ticket_id: form.ticket_id,
      indent_city: form.indent_city || null,
      case_id: form.case_id || null,
      oem_case_id: form.oem_case_id || null,
      company: form.company || null,
      def_model_no: form.def_model_no || null,
      def_serial_no: form.def_serial_no || null,
      problem_reported: form.problem_reported || null,
      indent_type: form.indent_type || null,
      oracles: form.oracles || null,
      material_exchange_model: form.material_exchange_model || null,
      material_exchange_serial_no: form.material_exchange_serial_no || null,
      material_rec_model_no: form.material_rec_model_no || null,
      material_rec_serial_no: form.material_rec_serial_no || null,
      material_rec_date: form.material_rec_date || null,
      engineer_name: form.engineer_name || null,
      remarks: form.remarks || null,
      created_by: u.user?.id ?? null,
    };
    const { data, error } = await supabase.from("indents" as never).insert(payload as never).select("id").maybeSingle() as unknown as { data: { id: string } | null; error: { message: string } | null };
    setBusy(false);
    if (error) return toast.error(error.message);
    if (!data) return toast.error("Failed to create Indent");
    toast.success("Indent created");
    navigate({ to: "/indent/$id", params: { id: data.id } });
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading ticket…</div>;

  const oem = getOemLogo(form.company);

  return (
    <div className="space-y-4">
      {/* Branded header */}
      <Card>
        <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <img src={prokonLogo.url} alt="Prokon" className="h-10 w-auto object-contain" />
            <div>
              <div className="font-semibold leading-tight">Prokon Hi-Tech Systems</div>
              <div className="text-xs text-muted-foreground">New Indent</div>
            </div>
          </div>
          {oem && <img src={oem.url} alt={oem.alt} className="h-9 w-auto object-contain" />}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Link to="/tickets/$id" params={{ id: form.ticket_id || "" }}>
          <Button variant="ghost" size="sm" disabled={!form.ticket_id}>
            <ArrowLeft className="h-4 w-4 mr-1" />Back to Ticket
          </Button>
        </Link>
        <Button onClick={save} disabled={busy}>
          <Save className="h-4 w-4 mr-1" />{busy ? "Saving…" : "Save Indent"}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Linked Ticket (auto)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Case ID</Label><Input value={form.case_id} readOnly className="font-mono bg-muted/50" /></div>
          <div><Label>OEM Case ID</Label><Input value={form.oem_case_id} onChange={(e) => set({ oem_case_id: e.target.value })} className="font-mono" /></div>
          <div><Label>Company (OEM)</Label><Input value={form.company} onChange={(e) => set({ company: e.target.value })} /></div>
          <div><Label>DEF Model No</Label><Input value={form.def_model_no} onChange={(e) => set({ def_model_no: e.target.value })} /></div>
          <div><Label>DEF Serial No</Label><Input value={form.def_serial_no} onChange={(e) => set({ def_serial_no: e.target.value.toUpperCase() })} className="font-mono" /></div>
          <div><Label>Engineer</Label><Input value={form.engineer_name} onChange={(e) => set({ engineer_name: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>Problem Reported</Label><Textarea rows={2} value={form.problem_reported} onChange={(e) => set({ problem_reported: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Indent</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Indent City</Label><Input value={form.indent_city} onChange={(e) => set({ indent_city: e.target.value })} /></div>
          <div><Label>Indent Date</Label><Input type="date" value={form.indent_date} onChange={(e) => set({ indent_date: e.target.value })} /></div>
          <div>
            <Label>Indent Type</Label>
            <Select value={form.indent_type} onValueChange={(v) => set({ indent_type: v as IndentType })}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {INDENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3"><Label>Oracles</Label><Input value={form.oracles} onChange={(e) => set({ oracles: e.target.value })} placeholder="Oracle reference / SR / SO" /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Material Exchange</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><Label>Material Exchange Model</Label><Input value={form.material_exchange_model} onChange={(e) => set({ material_exchange_model: e.target.value })} /></div>
          <div><Label>Material Exchange Serial No</Label><Input value={form.material_exchange_serial_no} onChange={(e) => set({ material_exchange_serial_no: e.target.value.toUpperCase() })} className="font-mono" /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Material Received</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Material Rec Model No</Label><Input value={form.material_rec_model_no} onChange={(e) => set({ material_rec_model_no: e.target.value })} /></div>
          <div><Label>Material Rec Serial No</Label><Input value={form.material_rec_serial_no} onChange={(e) => set({ material_rec_serial_no: e.target.value.toUpperCase() })} className="font-mono" /></div>
          <div><Label>Material Rec Date</Label><Input type="date" value={form.material_rec_date} onChange={(e) => set({ material_rec_date: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>Remarks</Label><Textarea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} /></div>
        </CardContent>
      </Card>
    </div>
  );
}