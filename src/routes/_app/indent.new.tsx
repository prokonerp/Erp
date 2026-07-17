import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, ArrowLeft, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { INDENT_TYPES, buildOraclesFromDefectiveParts, buildOraclesFromSelectedList, syncTicketGoodPartsFromIndent, type IndentType, type OracleBlock } from "@/lib/indent";
import { getOemLogo } from "@/lib/oemLogos";
import { OracleBlockEditor } from "@/components/OracleBlockEditor";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { FormShell, FormSection, FormGrid, FormField, StickyMobileActions } from "@/components/form-kit";

const searchSchema = z.object({
  ticket_id: z.string().optional(),
  oracle_no: z.string().optional(),
  oracle_list: z.string().optional(),
});

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
  problem_reported: string;
  product_model: string;
  product_serial: string;
  indent_type: IndentType | "";
  engineer_name: string;
  remarks: string;
  oracles_data: OracleBlock[];
  defective_parts_from_ticket: Array<{ name?: string; model_no?: string; serial?: string; qty?: string | number }>;
};

const blank: Form = {
  indent_date: new Date().toISOString().slice(0, 10),
  ticket_id: "",
  indent_city: "",
  case_id: "",
  oem_case_id: "",
  company: "",
  problem_reported: "",
  product_model: "",
  product_serial: "",
  indent_type: "",
  engineer_name: "",
  remarks: "",
  oracles_data: [],
  defective_parts_from_ticket: [],
};

function NewIndent() {
  const { ticket_id, oracle_no, oracle_list } = Route.useSearch();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(ticket_id));
  const [collapsedMap, setCollapsedMap] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (!ticket_id) return;
    (async () => {
      const { data, error } = await supabase
        .from("tickets")
        .select("id, case_id, oem_call, oem_brand, oem_ref_id, product, serial_no, location, complaint, assigned_engineer_name, defective_parts_received, defective_parts_details, good_parts_used, good_parts_details")
        .eq("id", ticket_id)
        .maybeSingle();
      if (error) { toast.error(error.message); setLoading(false); return; }
      if (!data) { toast.error("Ticket not found"); setLoading(false); return; }
      if (!data.oem_call) {
        toast.error("Indent can only be created from OEM-tagged tickets");
        navigate({ to: "/tickets/$id", params: { id: ticket_id } });
        return;
      }
      const dRaw = (data as { defective_parts_details?: unknown }).defective_parts_details;
      const gRaw = (data as { good_parts_details?: unknown }).good_parts_details;
      const defParts: Array<{ name?: string; model_no?: string; serial?: string; qty?: string | number; oracle_no?: string }> = Array.isArray(dRaw) ? (dRaw as Array<{ name?: string; model_no?: string; serial?: string; qty?: string | number; oracle_no?: string }>) : [];
      const goodParts: Array<{ name?: string; model_no?: string; serial?: string }> = Array.isArray(gRaw) ? (gRaw as Array<{ name?: string; model_no?: string; serial?: string }>) : [];
      const defOn = !!(data as { defective_parts_received?: boolean }).defective_parts_received;
      const goodOn = !!(data as { good_parts_used?: boolean }).good_parts_used;
      if (!defOn && !goodOn) {
        toast.error("Indent requires Defective Parts Received or Good Parts Used to be enabled on the ticket");
        navigate({ to: "/tickets/$id", params: { id: ticket_id } });
        return;
      }
      // Build the requested oracle list from search params.
      const requested: string[] = oracle_list
        ? oracle_list.split(",").map((s) => s.trim()).filter(Boolean)
        : oracle_no
        ? [oracle_no]
        : [];

      // Block duplicates: if any requested oracle already has an indent, redirect there.
      const nonNewRequested = requested.filter((o) => o.toUpperCase() !== "NEW");
      if (nonNewRequested.length > 0) {
        const { data: mapRows } = await supabase
          .from("indent_oracle_map" as never)
          .select("indent_id, oracle_no")
          .eq("ticket_id", ticket_id) as unknown as { data: Array<{ indent_id: string; oracle_no: string }> | null };
        const dup = (mapRows || []).find((r) =>
          nonNewRequested.some((o) => o.toUpperCase() === r.oracle_no.trim().toUpperCase())
        );
        if (dup) {
          toast.info(`Indent already exists for Oracle ${dup.oracle_no} — opening it.`);
          navigate({ to: "/indent/$id", params: { id: dup.indent_id } });
          return;
        }
      }
      const firstDef = defParts.find((p) => (p?.name || "").trim() || (p?.model_no || "").trim() || (p?.serial || "").trim()) || {};
      // Suppress unused warning — goodParts retained for future Good Parts mapping needs.
      void goodParts;
      // Latest engineer from assignment activity history
      let latestEngineer = data.assigned_engineer_name || "";
      const { data: acts } = await supabase
        .from("ticket_activities")
        .select("notes, created_at, kind")
        .eq("ticket_id", ticket_id)
        .eq("kind", "assigned")
        .order("created_at", { ascending: false })
        .limit(1);
      if (acts && acts.length) {
        const note = (acts[0] as { notes?: string }).notes || "";
        const m = note.match(/Assigned to (.+?)(?:\s*\(|$)/);
        if (m) latestEngineer = m[1].trim();
      }
      void firstDef;
      const oracles = requested.length > 0
        ? buildOraclesFromSelectedList(defParts, requested)
        : buildOraclesFromDefectiveParts(defParts);
      setForm((f) => ({
        ...f,
        ticket_id: data.id,
        case_id: data.case_id || "",
        oem_case_id: data.oem_ref_id || "",
        company: data.oem_brand || "",
        product_model: data.product || "",
        product_serial: data.serial_no || "",
        indent_city: data.location || "",
        problem_reported: data.complaint || "",
        engineer_name: latestEngineer,
        defective_parts_from_ticket: defParts,
        oracles_data: oracles,
      }));
      setLoading(false);
    })();
  }, [ticket_id, oracle_no, oracle_list, navigate]);

  const set = (p: Partial<Form>) => setForm((s) => ({ ...s, ...p }));

  const save = async () => {
    if (!form.ticket_id) return toast.error("Linked Ticket is required");
    if (!form.indent_type) return toast.error("Please select an Indent Type before saving");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const payload = {
      indent_date: form.indent_date,
      ticket_id: form.ticket_id,
      indent_city: form.indent_city || null,
      case_id: form.case_id || null,
      oem_case_id: form.oem_case_id || null,
      company: form.company || null,
      problem_reported: form.problem_reported || null,
      product_model: form.product_model || null,
      product_serial: form.product_serial || null,
      indent_type: form.indent_type || null,
      oracles_data: form.oracles_data,
      engineer_name: form.engineer_name || null,
      remarks: form.remarks || null,
      created_by: u.user?.id ?? null,
    };
    const { data, error } = await supabase.from("indents" as never).insert(payload as never).select("id, indent_no").maybeSingle() as unknown as { data: { id: string; indent_no: string | null } | null; error: { message: string } | null };
    setBusy(false);
    if (error) return toast.error(error.message);
    if (!data) return toast.error("Failed to create Indent");
    // Auto-populate the linked Ticket's Good Parts Used from closed Oracles.
    await syncTicketGoodPartsFromIndent(supabase, {
      id: data.id,
      indent_no: data.indent_no,
      ticket_id: form.ticket_id,
      oracles_data: form.oracles_data,
    });
    toast.success("Indent created");
    navigate({ to: "/indent/$id", params: { id: data.id } });
  };

  if (loading) return <div className="text-sm text-muted-foreground">Loading ticket…</div>;

  const oem = getOemLogo(form.company);

  return (
    <FormShell
      title="New Indent"
      description="Create an Oracle indent from the linked OEM ticket"
      storageKey="indent-form-density"
      actions={
        <>
          <Link to="/tickets/$id" params={{ id: form.ticket_id || "" }}>
            <Button variant="ghost" size="sm" disabled={!form.ticket_id}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
          </Link>
          <Button size="sm" onClick={save} disabled={busy}>
            <Save className="h-4 w-4 mr-1" />{busy ? "Saving…" : "Save Indent"}
          </Button>
        </>
      }
    >
      {/* Branded header */}
      <Card className="fk-section">
        <CardContent className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <img src={prokonLogo.url} alt="Prokon" className="h-9 w-auto object-contain" />
            <div>
              <div className="text-sm font-semibold leading-tight">Prokon Hi-Tech Systems</div>
              <div className="text-xs text-muted-foreground">New Indent</div>
            </div>
          </div>
          {oem && <img src={oem.url} alt={oem.alt} className="h-8 w-auto object-contain" />}
        </CardContent>
      </Card>

      <FormSection title="Linked Ticket (auto)" defaultOpen>
        <FormGrid>
          <FormField label="Case ID" name="case_id">
            <Input value={form.case_id} readOnly className="font-mono bg-muted/50" />
          </FormField>
          <FormField label="OEM Case ID" name="oem_case_id">
            <Input value={form.oem_case_id} readOnly className="font-mono bg-muted/50" />
          </FormField>
          <FormField label="Company (OEM)" name="company">
            <Input value={form.company} onChange={(e) => set({ company: e.target.value })} />
          </FormField>
          <FormField label="Product Model" name="product_model">
            <Input value={form.product_model} readOnly className="bg-muted/50" />
          </FormField>
          <FormField label="Product Serial" name="product_serial">
            <Input value={form.product_serial} readOnly className="font-mono bg-muted/50" />
          </FormField>
          <FormField label="Engineer" name="engineer_name">
            <Input value={form.engineer_name} onChange={(e) => set({ engineer_name: e.target.value })} />
          </FormField>
          <FormField label="Problem Reported" size="full">
            <Textarea rows={2} value={form.problem_reported} onChange={(e) => set({ problem_reported: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <FormSection title="Indent Details" defaultOpen>
        <FormGrid>
          <FormField label="Indent City" name="indent_city">
            <Input value={form.indent_city} onChange={(e) => set({ indent_city: e.target.value })} />
          </FormField>
          <FormField label="Indent Date" name="indent_date">
            <Input type="date" value={form.indent_date} onChange={(e) => set({ indent_date: e.target.value })} />
          </FormField>
          <FormField label={<span>Indent Type <span className="text-destructive">*</span></span>} name="indent_type" size="sm">
            <Select value={form.indent_type} onValueChange={(v) => set({ indent_type: v as IndentType })}>
              <SelectTrigger aria-required="true"><SelectValue placeholder="Select type (required)" /></SelectTrigger>
              <SelectContent>
                {INDENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Remarks" size="full">
            <Textarea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </FormField>
        </FormGrid>
      </FormSection>

      <div className="flex items-center justify-between pt-1">
        <h2 className="text-lg font-semibold">Oracles <span className="text-xs font-normal text-muted-foreground">(auto from Ticket Defective Parts)</span></h2>
        {form.oracles_data.length > 0 && (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCollapsedMap(Object.fromEntries(form.oracles_data.map((_, i) => [i, false])))}>
              <ChevronsUpDown className="h-4 w-4 mr-1" />Expand All
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setCollapsedMap(Object.fromEntries(form.oracles_data.map((_, i) => [i, true])))}>
              <ChevronsDownUp className="h-4 w-4 mr-1" />Collapse All
            </Button>
          </div>
        )}
      </div>
      {form.oracles_data.length === 0 && (
        <div className="text-sm text-muted-foreground border rounded-md p-4 text-center">
          No defective parts captured on the ticket — add parts with Oracle # tags in the linked ticket to auto-create Oracle blocks here.
        </div>
      )}
      {form.oracles_data.map((o, idx) => (
        <OracleBlockEditor
          key={idx}
          index={idx}
          value={o}
          defectiveParts={form.defective_parts_from_ticket}
          collapsed={!!collapsedMap[idx]}
          onToggleCollapse={() => setCollapsedMap((m) => ({ ...m, [idx]: !m[idx] }))}
          onChange={(v) => set({ oracles_data: form.oracles_data.map((x, i) => (i === idx ? v : x)) })}
          onRemove={() => set({ oracles_data: form.oracles_data.filter((_, i) => i !== idx) })}
          onGenerateChallan={() => toast.info("Save the Indent first, then open it to generate a Delivery Challan.")}
          onGenerateGrn={() => toast.info("Save the Indent first, then open it to generate a GRN.")}
        />
      ))}

      <StickyMobileActions>
        <Button onClick={save} disabled={busy} className="flex-1">
          <Save className="h-4 w-4 mr-1" />{busy ? "Saving…" : "Save Indent"}
        </Button>
      </StickyMobileActions>
    </FormShell>
  );
}