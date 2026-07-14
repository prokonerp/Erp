import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, ArrowLeft, Trash2, ExternalLink, RefreshCw, Timer, ChevronsDownUp, ChevronsUpDown, FileOutput, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { INDENT_TYPES, buildOraclesFromDefectiveParts, formatAge, indentClosedAt, indentStatusFromOracles, normalizeOracle, syncTicketGoodPartsFromIndent, type Indent, type IndentType, type OracleBlock } from "@/lib/indent";
import { getOemLogo } from "@/lib/oemLogos";
import { OracleBlockEditor } from "@/components/OracleBlockEditor";
import { useIsAdmin } from "@/lib/useRole";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";

export const Route = createFileRoute("/_app/indent/$id")({
  component: IndentDetail,
});

function IndentDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [i, setI] = useState<Indent | null>(null);
  const [busy, setBusy] = useState(false);
  const [defParts, setDefParts] = useState<Array<{ name?: string; model_no?: string; serial?: string; qty?: string | number; oracle_no?: string }>>([]);
  const { isAdmin } = useIsAdmin();
  const [tick, setTick] = useState(0);
  const storageKey = `indent:collapsed:${id}`;
  const [collapsedMap, setCollapsedMap] = useState<Record<number, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(sessionStorage.getItem(`indent:collapsed:${id}`) || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(collapsedMap)); } catch { /* noop */ }
  }, [collapsedMap, storageKey]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("indents" as never).select("*").eq("id", id).maybeSingle();
      if (error) { toast.error(error.message); return; }
      const ind = (data || null) as unknown as Indent | null;
      if (ind) {
        // Normalize legacy single-row oracles to the new row-array shape.
        ind.oracles_data = (ind.oracles_data || []).map(normalizeOracle);
      }
      setI(ind);
      if (ind?.ticket_id) {
        const { data: t } = await supabase.from("tickets").select("defective_parts_details").eq("id", ind.ticket_id).maybeSingle();
        const raw = (t as { defective_parts_details?: unknown } | null)?.defective_parts_details;
        setDefParts(Array.isArray(raw) ? (raw as Array<{ name?: string; model_no?: string; serial?: string; qty?: string | number; oracle_no?: string }>) : []);
      }
    })();
  }, [id]);

  const update = (p: Partial<Indent>) => setI((s) => (s ? { ...s, ...p } : s));

  // Resync oracle blocks from the linked ticket's current defective parts.
  // Existing closed oracles are preserved; open oracles are re-derived from
  // the ticket so newly added defective rows produce new exchange/received rows.
  const resyncFromTicket = () => {
    if (!i) return;
    const rebuilt = buildOraclesFromDefectiveParts(defParts);
    const current = i.oracles_data || [];
    const closedByOracle = new Map<string, OracleBlock>();
    for (const o of current) {
      if (o.status === "closed") closedByOracle.set((o.oracle_no || "").trim(), o);
    }
    const merged: OracleBlock[] = rebuilt.map((nb) => {
      const key = (nb.oracle_no || "").trim();
      const closed = closedByOracle.get(key);
      if (closed) return closed;
      // Preserve any in-progress exchange/received rows from the current open block.
      const existing = current.find((o) => (o.oracle_no || "").trim() === key && o.status !== "closed");
      if (!existing) return nb;
      const ex = normalizeOracle(existing).exchange_rows;
      const rv = normalizeOracle(existing).received_rows;
      return {
        ...nb,
        exchange_rows: nb.defective_rows.map((_, ix) => ex[ix] || nb.exchange_rows[ix]),
        received_rows: nb.defective_rows.map((_, ix) => rv[ix] || nb.received_rows[ix]),
      };
    });
    update({ oracles_data: merged });
    toast.success("Oracles resynced from ticket defective parts");
  };

  const save = async () => {
    if (!i) return;
    if (!i.indent_type) { toast.error("Please select an Indent Type before saving"); return; }
    setBusy(true);
    const { error } = await supabase.from("indents" as never).update({
      indent_date: i.indent_date,
      indent_city: i.indent_city,
      case_id: i.case_id,
      oem_case_id: i.oem_case_id,
      company: i.company,
      problem_reported: i.problem_reported,
      indent_type: i.indent_type,
      oracles_data: i.oracles_data || [],
      engineer_name: i.engineer_name,
      remarks: i.remarks,
      product_model: i.product_model,
      product_serial: i.product_serial,
    } as never).eq("id", i.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    await syncTicketGoodPartsFromIndent(supabase, {
      id: i.id,
      indent_no: i.indent_no,
      ticket_id: i.ticket_id,
      oracles_data: i.oracles_data || [],
    });
    toast.success("Saved");
  };

  const del = async () => {
    if (!i || !confirm("Delete this Indent?")) return;
    const { softDelete } = await import("@/lib/softDelete");
    const { error } = await softDelete("indents", i.id);
    if (error) return toast.error(error.message);
    toast.success("Moved to Archive");
    navigate({ to: "/indent" });
  };

  const generateChallan = async () => {
    if (!i) return;
    // Aggregate exchange rows across all oracles as the material being sent to the customer.
    const cleanModel = (m?: string) => (m || "").split("||").pop() || "";
    const oracles = i.oracles_data || [];
    const items: Array<{
      part_no: string; part_name: string; description: string;
      uom: string; qty: string; batch_no: string; model_no?: string; serial_no?: string;
    }> = [];
    for (const o of oracles) {
      const rows = (o.exchange_rows && o.exchange_rows.length)
        ? o.exchange_rows
        : (o.exchange ? [o.exchange] : []);
      for (const ex of rows) {
        const model = cleanModel(ex?.model_no);
        const serial = (ex?.serial_no || "").trim();
        const qty = (ex?.qty || "").trim();
        if (!model && !serial && !qty) continue;
        const [maybeName, maybeModel] = (ex?.model_no || "").split("||");
        items.push({
          part_no: maybeModel || model,
          part_name: maybeName || model,
          description: "",
          uom: "Nos",
          qty: qty || "1",
          batch_no: "",
          model_no: model,
          serial_no: serial,
        });
      }
    }
    if (items.length === 0) {
      toast.error("No exchange items to dispatch. Fill Material Exchange rows in at least one Oracle first.");
      return;
    }
    // Fetch linked ticket to derive the customer.
    let customerId: string | null = null;
    if (i.ticket_id) {
      const { data: t } = await supabase.from("tickets").select("customer_id").eq("id", i.ticket_id).maybeSingle();
      customerId = (t as { customer_id?: string | null } | null)?.customer_id || null;
    }
    if (!customerId) {
      toast.error("Linked ticket is missing a customer. Set the customer on the ticket first.");
      return;
    }
    const prefill = {
      source: "indent",
      indent_id: i.id,
      indent_no: i.indent_no,
      indent_date: i.indent_date,
      customer_id: customerId,
      reference_no: i.indent_no || "",
      internal_remarks: [
        i.indent_no ? `From Indent ${i.indent_no}` : "",
        i.remarks || "",
      ].filter(Boolean).join(" · "),
      items,
    };
    try { sessionStorage.setItem("challan:prefill:new-customer", JSON.stringify(prefill)); } catch { /* noop */ }
    navigate({ to: "/challan/customer/new" });
  };

  const generateGrn = async () => {
    if (!i) return;
    // Aggregate received rows across all oracles — defective units taken back from the customer.
    const cleanModel = (m?: string) => (m || "").split("||").pop() || "";
    const oracles = i.oracles_data || [];
    const items: Array<{
      part_no: string; part_name: string; description: string; uom: string;
      qty_received: string; qty_accepted: string; qty_rejected: string;
      batch_no: string; model_no?: string; serial_no?: string; condition?: string; remarks?: string;
    }> = [];
    for (const o of oracles) {
      const rows = (o.received_rows && o.received_rows.length)
        ? o.received_rows
        : (o.received ? [o.received] : []);
      for (const rv of rows) {
        const model = cleanModel(rv?.model_no);
        const serial = (rv?.serial_no || "").trim();
        const qty = (rv?.qty || "").trim();
        if (!model && !serial && !qty) continue;
        const [maybeName, maybeModel] = (rv?.model_no || "").split("||");
        items.push({
          part_no: maybeModel || model,
          part_name: maybeName || model,
          description: "",
          uom: "Nos",
          qty_received: qty || "1",
          qty_accepted: qty || "1",
          qty_rejected: "0",
          batch_no: "",
          model_no: model,
          serial_no: serial,
          condition: "Defective",
          remarks: rv?.remarks || "",
        });
      }
    }
    if (items.length === 0) {
      toast.error("No received items yet. Fill Material Received rows in at least one Oracle first.");
      return;
    }
    let customerId: string | null = null;
    if (i.ticket_id) {
      const { data: t } = await supabase.from("tickets").select("customer_id").eq("id", i.ticket_id).maybeSingle();
      customerId = (t as { customer_id?: string | null } | null)?.customer_id || null;
    }
    if (!customerId) {
      toast.error("Linked ticket is missing a customer. Set the customer on the ticket first.");
      return;
    }
    const prefill = {
      source: "indent",
      indent_id: i.id,
      indent_no: i.indent_no,
      indent_date: i.indent_date,
      customer_id: customerId,
      ticket_no: i.case_id || i.oem_case_id || "",
      reference_no: i.indent_no || "",
      source_doc_type: "Return Note",
      source_doc_no: i.indent_no || "",
      source_doc_date: i.indent_date || "",
      internal_remarks: [
        i.indent_no ? `From Indent ${i.indent_no}` : "",
        i.remarks || "",
      ].filter(Boolean).join(" · "),
      items,
    };
    try { sessionStorage.setItem("grn:prefill:new-customer", JSON.stringify(prefill)); } catch { /* noop */ }
    navigate({ to: "/grn/new" });
  };

  if (!i) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const oem = getOemLogo(i.company);
  const indStatus = indentStatusFromOracles(i.oracles_data);
  const closedAt = indentClosedAt(i.oracles_data);
  const age = formatAge(i.created_at, closedAt);
  void tick;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <img src={prokonLogo.url} alt="Prokon" className="h-10 w-auto object-contain" />
            <div>
              <div className="font-semibold leading-tight">Prokon Hi-Tech Systems</div>
              <div className="text-xs text-muted-foreground">Indent · <span className="font-mono">{i.indent_no}</span></div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={indStatus === "closed" ? "default" : "secondary"}>{indStatus === "closed" ? "Closed" : "Open"}</Badge>
            <div className="inline-flex items-center text-xs text-muted-foreground">
              <Timer className="h-3 w-3 mr-1" />
              {indStatus === "closed" ? `Resolution Time: ${age}` : `Age: ${age}`}
            </div>
            {oem && <img src={oem.url} alt={oem.alt} className="h-9 w-auto object-contain" />}
          </div>
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
          <Button variant="outline" size="sm" onClick={resyncFromTicket}>
            <RefreshCw className="h-4 w-4 mr-1" />Resync from Ticket
          </Button>
          <Button variant="outline" size="sm" onClick={generateChallan}>
            <FileOutput className="h-4 w-4 mr-1" />Generate Delivery Challan
          </Button>
          <Button variant="outline" size="sm" onClick={generateGrn}>
            <PackageCheck className="h-4 w-4 mr-1" />Generate GRN
          </Button>
          <Button onClick={save} disabled={busy}><Save className="h-4 w-4 mr-1" />Save</Button>
          <Button variant="destructive" size="icon" onClick={del}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Linked Ticket (read-only sync)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Case ID</Label><Input value={i.case_id || ""} onChange={(e) => update({ case_id: e.target.value })} className="font-mono bg-muted/50" readOnly /></div>
          <div><Label>OEM Case ID</Label><Input value={i.oem_case_id || ""} readOnly className="font-mono bg-muted/50" /></div>
          <div><Label>Company (OEM)</Label><Input value={i.company || ""} onChange={(e) => update({ company: e.target.value })} /></div>
          <div><Label>Product Model</Label><Input value={i.product_model || ""} readOnly className="bg-muted/50" /></div>
          <div><Label>Product Serial</Label><Input value={i.product_serial || ""} readOnly className="font-mono bg-muted/50" /></div>
          <div><Label>Engineer</Label><Input value={i.engineer_name || ""} onChange={(e) => update({ engineer_name: e.target.value })} /></div>
          <div className="md:col-span-3"><Label>Problem Reported</Label><Textarea rows={2} value={i.problem_reported || ""} onChange={(e) => update({ problem_reported: e.target.value })} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Indent</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><Label>Indent City</Label><Input value={i.indent_city || ""} onChange={(e) => update({ indent_city: e.target.value })} /></div>
          <div><Label>Indent Date</Label><Input type="date" value={i.indent_date} onChange={(e) => update({ indent_date: e.target.value })} /></div>
          <div>
            <Label>Indent Type <span className="text-destructive">*</span></Label>
            <Select value={i.indent_type || ""} onValueChange={(v) => update({ indent_type: v as IndentType })}>
              <SelectTrigger aria-required="true"><SelectValue placeholder="Select type (required)" /></SelectTrigger>
              <SelectContent>{INDENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3"><Label>Remarks</Label><Textarea rows={2} value={i.remarks || ""} onChange={(e) => update({ remarks: e.target.value })} /></div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Oracles <span className="text-xs font-normal text-muted-foreground">(auto from Ticket Defective Parts)</span></h2>
        {(i.oracles_data || []).length > 0 && (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCollapsedMap(Object.fromEntries((i.oracles_data || []).map((_, ix) => [ix, false])))}>
              <ChevronsUpDown className="h-4 w-4 mr-1" />Expand All
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setCollapsedMap(Object.fromEntries((i.oracles_data || []).map((_, ix) => [ix, true])))}>
              <ChevronsDownUp className="h-4 w-4 mr-1" />Collapse All
            </Button>
          </div>
        )}
      </div>
      {(!i.oracles_data || i.oracles_data.length === 0) && (
        <div className="text-sm text-muted-foreground border rounded-md p-4 text-center">
          No Oracle entries — add defective parts with Oracle # tags in the linked ticket then click <span className="font-medium">Resync from Ticket</span>.
        </div>
      )}
      {(i.oracles_data || []).map((o: OracleBlock, idx: number) => (
        <OracleBlockEditor
          key={idx}
          index={idx}
          value={o}
          defectiveParts={defParts}
          isAdmin={isAdmin}
          collapsed={!!collapsedMap[idx]}
          onToggleCollapse={() => setCollapsedMap((m) => ({ ...m, [idx]: !m[idx] }))}
          onChange={(v) => update({ oracles_data: (i.oracles_data || []).map((x, ix) => (ix === idx ? v : x)) })}
          onRemove={() => update({ oracles_data: (i.oracles_data || []).filter((_, ix) => ix !== idx) })}
          onGenerateChallan={generateChallan}
          onGenerateGrn={generateGrn}
        />
      ))}
    </div>
  );
}