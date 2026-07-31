import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import { INDENT_TYPES, buildOraclesFromDefectiveParts, docStatusSettled, formatAge, indentClosedAt, indentStatusFromOracles, normalizeOracle, syncTicketGoodPartsFromIndent, type Indent, type IndentType, type OracleBlock, type OraclePendingDocs } from "@/lib/indent";
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
  const [dcByOracle, setDcByOracle] = useState<Record<string, { challan_no: string | null; challan_date: string | null; status: string | null; id: string }>>({});
  /** Per-oracle count of DC / GRN documents that are not yet Submitted or
   *  Closed. Blocks Oracle auto-close while any remain pending. */
  const [pendingByOracle, setPendingByOracle] = useState<Record<string, OraclePendingDocs>>({});
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const hydratedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      // Load Delivery Challans linked to this indent so we can disable
      // duplicate DC generation per Oracle Number.
      const { data: dcs } = await supabase
        .from("delivery_challans")
        .select("id, challan_no, challan_date, status, items")
        .eq("indent_id", id);
      const map: Record<string, { challan_no: string | null; challan_date: string | null; status: string | null; id: string }> = {};
      for (const dc of (dcs || []) as Array<{ id: string; challan_no: string | null; challan_date: string | null; status: string | null; items: Array<{ oracle_no?: string }> | null }>) {
        if ((dc.status || "").toLowerCase() === "cancelled") continue;
        const seen = new Set<string>();
        for (const it of dc.items || []) {
          const on = (it?.oracle_no || "").trim();
          if (!on || seen.has(on)) continue;
          seen.add(on);
          const key = on.toUpperCase();
          if (!map[key]) map[key] = { id: dc.id, challan_no: dc.challan_no, challan_date: dc.challan_date, status: dc.status };
        }
      }
      setDcByOracle(map);
      // Give React one paint before enabling auto-save so we don't save the
      // freshly-loaded record right back to the DB.
      setTimeout(() => { hydratedRef.current = true; }, 100);
    })();
  }, [id]);

  const update = (p: Partial<Indent>) => setI((s) => (s ? { ...s, ...p } : s));

  /** Debounced auto-save. Skips until the record has hydrated and only fires
   *  when we have a valid Indent Type (required by DB validation). */
  useEffect(() => {
    if (!hydratedRef.current || !i) return;
    if (!i.indent_type) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setAutoSaveState("saving");
    saveTimer.current = setTimeout(async () => {
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
      if (error) { setAutoSaveState("error"); return; }
      await syncTicketGoodPartsFromIndent(supabase, {
        id: i.id, indent_no: i.indent_no, ticket_id: i.ticket_id,
        oracles_data: i.oracles_data || [],
      });
      setAutoSaveState("saved");
    }, 2500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [i]);

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

  /** Sum quantities from prior non-cancelled GRNs linked to this Indent so
   *  the next GRN prefill only shows still-pending items. Keyed by
   *  `${model}||${serial}` (upper-cased/trimmed); falls back to model-only
   *  when serial is blank. Draft GRNs are counted too — they represent
   *  in-flight receipts that shouldn't be duplicated. */
  const fetchPriorGrnQty = async (
    indentId: string,
    category: "oem" | "customer",
  ): Promise<Map<string, number>> => {
    const acc = new Map<string, number>();
    const { data } = await supabase
      .from("grns" as never)
      .select("status, items")
      .eq("indent_id", indentId)
      .eq("category", category);
    for (const g of (data || []) as Array<{ status?: string | null; items?: Array<Record<string, unknown>> | null }>) {
      if ((g.status || "").toLowerCase() === "cancelled") continue;
      for (const it of g.items || []) {
        const model = String((it.model_no as string) || "").trim().toUpperCase();
        const serial = String((it.serial_no as string) || "").trim().toUpperCase();
        const qty = parseFloat(String(it.qty_received ?? it.qty ?? "0")) || 0;
        if (!model && !serial) continue;
        const key = `${model}||${serial}`;
        acc.set(key, (acc.get(key) || 0) + qty);
      }
    }
    return acc;
  };

  const remainingQty = (
    prior: Map<string, number>,
    model: string,
    serial: string,
    qtyStr: string,
  ): number => {
    const req = parseFloat(qtyStr || "1") || 1;
    const key = `${(model || "").trim().toUpperCase()}||${(serial || "").trim().toUpperCase()}`;
    const done = prior.get(key) || 0;
    return Math.max(0, req - done);
  };

  const generateChallan = async (only?: OracleBlock) => {
    if (!i) return;
    // Duplicate DC guard — block generation when any target Oracle already
    // has an active (non-Cancelled) Delivery Challan.
    const targets = only ? [only] : (i.oracles_data || []);
    for (const o of targets) {
      const key = (o.oracle_no || "").trim().toUpperCase();
      if (key && dcByOracle[key]) {
        toast.error(`DC ${dcByOracle[key].challan_no || ""} already exists for Oracle ${o.oracle_no}`);
        return;
      }
    }
    // Aggregate exchange rows across all oracles as the material being sent to the customer.
    const cleanModel = (m?: string) => (m || "").split("||").pop() || "";
    const oracles = only ? [only] : (i.oracles_data || []);
    const items: Array<{
      product_id?: string; part_no: string; part_name: string; description: string;
      uom: string; qty: string; batch_no: string; model_no?: string; serial_no?: string;
      oracle_no?: string; hsn?: string; unit_price?: string; weight_kg?: string;
      defective_model?: string; defective_serial?: string; good_model?: string; good_serial?: string;
      oem_ref_id?: string;
    }> = [];
    // Collect models so we can enrich rows with product master details in one query.
    const modelSet = new Set<string>();
    for (const o of oracles) {
      const rows = (o.exchange_rows && o.exchange_rows.length) ? o.exchange_rows : (o.exchange ? [o.exchange] : []);
      for (const ex of rows) {
        const m = cleanModel(ex?.model_no);
        if (m) modelSet.add(m);
      }
    }
    let prodByModel: Record<string, { id?: string; name?: string; model?: string; description?: string; unit?: string; hsn?: string; default_price?: number | null; weight_kg?: number | null }> = {};
    const ticketModel = cleanModel(i.product_model || "");
    if (ticketModel) modelSet.add(ticketModel);
    if (modelSet.size > 0) {
      const { data: prods } = await supabase.from("products")
        .select("id,name,model,description,unit,hsn,default_price,weight_kg")
        .in("model", Array.from(modelSet));
      for (const p of (prods || []) as any[]) {
        if (p?.model) prodByModel[p.model as string] = p;
      }
    }
    const ticketProd = ticketModel ? prodByModel[ticketModel] : undefined;
    for (const o of oracles) {
      const rows = (o.exchange_rows && o.exchange_rows.length)
        ? o.exchange_rows
        : (o.exchange ? [o.exchange] : []);
      for (let ix = 0; ix < rows.length; ix++) {
        const ex = rows[ix];
        const model = cleanModel(ex?.model_no);
        const serial = (ex?.serial_no || "").trim();
        const qty = (ex?.qty || "").trim();
        if (!model && !serial && !qty) continue;
        const [maybeName, maybeModel] = (ex?.model_no || "").split("||");
        const defRow = o.defective_rows?.[ix];
        // Product on the Challan should reflect the ticket's Product Model
        // (from the Linked Ticket section), not the spare exchange model.
        const prod = ticketProd || (model ? prodByModel[model] : undefined);
        // Unit price must come from the Material Exchange (Good) Model in the
        // Product Master, not the ticket's parent product.
        const exchangeProd = model ? prodByModel[model] : undefined;
        const partName = prod?.name || maybeName || defRow?.part_name || model;
        const desc = prod?.description || (defRow?.part_name && defRow.part_name !== partName ? defRow.part_name : "");
        items.push({
          product_id: prod?.id,
          part_no: maybeModel || model,
          part_name: partName,
          description: desc,
          uom: prod?.unit || "Nos",
          qty: qty || "1",
          batch_no: "",
          model_no: model,
          serial_no: serial,
          oracle_no: (o.oracle_no || "").trim() || undefined,
          hsn: prod?.hsn || undefined,
          unit_price: exchangeProd?.default_price != null ? String(exchangeProd.default_price) : undefined,
          weight_kg: prod?.weight_kg != null ? String(prod.weight_kg) : undefined,
          good_model: model,
          good_serial: serial,
          defective_model: defRow?.def_model_no || undefined,
          defective_serial: defRow?.def_serial_no || undefined,
          oem_ref_id: i.oem_case_id || undefined,
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

  const generateGrn = async (only?: OracleBlock) => {
    if (!i) return;
    // Section C — Material Received (from OEM). Aggregates the OEM-received
    // rows and routes to a **GRN From OEM** prefill (Good stock).
    const cleanModel = (m?: string) => (m || "").split("||").pop() || "";
    const oracles = only ? [only] : (i.oracles_data || []);
    // Partial-receipt / duplicate-GRN guard: subtract quantities already
    // covered by prior non-cancelled GRNs linked to this Indent (OEM category).
    const priorQty = await fetchPriorGrnQty(i.id, "oem");
    const items: Array<{
      product_id?: string; part_no: string; part_name: string; description: string; uom: string;
      qty_received: string; qty_accepted: string; qty_rejected: string;
      batch_no: string; model_no?: string; serial_no?: string; condition?: string; remarks?: string;
      warehouse_id?: string; warehouse_name?: string; received_date?: string; oracle_no?: string;
    }> = [];
    let warehouseIdPrefill: string | null = null;
    let warehouseNamePrefill = "";
    const modelSet = new Set<string>();
    for (const o of oracles) {
      const rows = (o.received_rows && o.received_rows.length) ? o.received_rows : (o.received ? [o.received] : []);
      for (const rv of rows) {
        const m = cleanModel(rv?.model_no);
        if (m) modelSet.add(m);
        if (!warehouseIdPrefill && rv?.warehouse_id) {
          warehouseIdPrefill = rv.warehouse_id;
          warehouseNamePrefill = rv.warehouse_name || "";
        }
      }
    }
    let prodByModel: Record<string, { id?: string; name?: string; description?: string; unit?: string; hsn?: string }> = {};
    if (modelSet.size > 0) {
      const { data: prods } = await supabase.from("products")
        .select("id,name,model,description,unit,hsn")
        .in("model", Array.from(modelSet));
      for (const p of (prods || []) as any[]) {
        if (p?.model) prodByModel[p.model as string] = p;
      }
    }
    for (const o of oracles) {
      const rows = (o.received_rows && o.received_rows.length)
        ? o.received_rows
        : (o.received ? [o.received] : []);
      for (let ix = 0; ix < rows.length; ix++) {
        const rv = rows[ix];
        const model = cleanModel(rv?.model_no);
        const defRowEarly = o.defective_rows?.[ix];
        // Ensure Serial Number is always carried into the GRN — fall back to
        // the matching Defective row's serial when the Section C receipt row
        // was left blank.
        const serial = ((rv?.serial_no || defRowEarly?.def_serial_no || "") as string).trim();
        const qty = (rv?.qty || "").trim();
        if (!model && !serial && !qty) continue;
        const [maybeName, maybeModel] = (rv?.model_no || "").split("||");
        const defRow = o.defective_rows?.[ix];
        const prod = model ? prodByModel[model] : undefined;
        const partName = maybeName || prod?.name || defRow?.part_name || model;
        const desc = prod?.description || (defRow?.part_name && defRow.part_name !== partName ? defRow.part_name : "");
        const remaining = remainingQty(priorQty, model, serial, qty);
        if (remaining <= 0) continue; // already fully GRN'd → skip
        items.push({
          product_id: prod?.id,
          part_no: maybeModel || model,
          part_name: partName,
          description: desc,
          uom: prod?.unit || "Nos",
          qty_received: String(remaining),
          qty_accepted: String(remaining),
          qty_rejected: "0",
          batch_no: "",
          model_no: model,
          serial_no: serial,
          condition: "Good",
          remarks: rv?.remarks || "",
          warehouse_id: rv?.warehouse_id || undefined,
          warehouse_name: rv?.warehouse_name || undefined,
          received_date: rv?.received_date || undefined,
          oracle_no: (o.oracle_no || "").trim() || undefined,
        });
      }
    }
    if (items.length === 0) {
      toast.error("No pending OEM items — all Section C rows are already covered by existing GRNs.");
      return;
    }
    const prefill = {
      source: "indent",
      indent_id: i.id,
      indent_no: i.indent_no,
      indent_date: i.indent_date,
      oem_name: i.company || "",
      ticket_no: i.case_id || i.oem_case_id || "",
      reference_no: i.indent_no || "",
      source_doc_type: "OEM Dispatch",
      source_doc_no: i.indent_no || "",
      source_doc_date: i.indent_date || "",
      warehouse_id: warehouseIdPrefill,
      storage_location: warehouseNamePrefill,
      internal_remarks: [
        i.indent_no ? `OEM receipt from Indent ${i.indent_no}` : "",
        i.remarks || "",
      ].filter(Boolean).join(" · "),
      items,
    };
    try { sessionStorage.setItem("grn:prefill:new-oem", JSON.stringify(prefill)); } catch { /* noop */ }
    navigate({ to: "/grn/oem/new" });
  };

  const generateCustomerGrn = async (only?: OracleBlock) => {
    if (!i) return;
    // Section D — Material Received (from Customer). Uses customer_received_rows
    // and honours product_tag (good/defective/scrap) for stock condition.
    const cleanModel = (m?: string) => (m || "").split("||").pop() || "";
    const oracles = only ? [only] : (i.oracles_data || []);
    // Duplicate-GRN guard (Customer category).
    const priorQty = await fetchPriorGrnQty(i.id, "customer");
    const items: Array<{
      product_id?: string; part_no: string; part_name: string; description: string; uom: string;
      qty_received: string; qty_accepted: string; qty_rejected: string;
      batch_no: string; model_no?: string; serial_no?: string; condition?: string; remarks?: string;
      warehouse_id?: string; warehouse_name?: string; received_date?: string; oracle_no?: string;
    }> = [];
    let warehouseIdPrefill: string | null = null;
    let warehouseNamePrefill = "";
    const modelSet = new Set<string>();
    for (const o of oracles) {
      const rows = o.customer_received_rows || [];
      for (const rv of rows) {
        const m = cleanModel(rv?.model_no);
        if (m) modelSet.add(m);
        if (!warehouseIdPrefill && rv?.warehouse_id) {
          warehouseIdPrefill = rv.warehouse_id;
          warehouseNamePrefill = rv.warehouse_name || "";
        }
      }
    }
    const prodByModel: Record<string, { id?: string; name?: string; description?: string; unit?: string; hsn?: string }> = {};
    if (modelSet.size > 0) {
      const { data: prods } = await supabase.from("products")
        .select("id,name,model,description,unit,hsn")
        .in("model", Array.from(modelSet));
      for (const p of (prods || []) as Array<{ id?: string; name?: string; model?: string; description?: string; unit?: string; hsn?: string }>) {
        if (p?.model) prodByModel[p.model] = p;
      }
    }
    const tagToCondition = (t?: string) => t === "good" ? "Good" : t === "scrap" ? "Scrap" : "Defective";
    for (const o of oracles) {
      const rows = o.customer_received_rows || [];
      for (let ix = 0; ix < rows.length; ix++) {
        const rv = rows[ix];
        const model = cleanModel(rv?.model_no);
        const defRowEarly = o.defective_rows?.[ix];
        // Ensure Serial Number is always carried into the GRN — fall back to
        // the matching Defective row's serial when the Section D receipt row
        // was left blank.
        const serial = ((rv?.serial_no || defRowEarly?.def_serial_no || "") as string).trim();
        const qty = (rv?.qty || "").trim();
        if (!model && !serial && !qty) continue;
        const [maybeName, maybeModel] = (rv?.model_no || "").split("||");
        const defRow = o.defective_rows?.[ix];
        const prod = model ? prodByModel[model] : undefined;
        const partName = maybeName || prod?.name || defRow?.part_name || model;
        const desc = prod?.description || (defRow?.part_name && defRow.part_name !== partName ? defRow.part_name : "");
        const remaining = remainingQty(priorQty, model, serial, qty);
        if (remaining <= 0) continue;
        items.push({
          product_id: prod?.id,
          part_no: maybeModel || model,
          part_name: partName,
          description: desc,
          uom: prod?.unit || "Nos",
          qty_received: String(remaining),
          qty_accepted: String(remaining),
          qty_rejected: "0",
          batch_no: "",
          model_no: model,
          serial_no: serial,
          condition: tagToCondition(rv?.product_tag),
          remarks: rv?.remarks || "",
          warehouse_id: rv?.warehouse_id || undefined,
          warehouse_name: rv?.warehouse_name || undefined,
          received_date: rv?.received_date || undefined,
          oracle_no: (o.oracle_no || "").trim() || undefined,
        });
      }
    }
    if (items.length === 0) {
      toast.error("No pending Customer items — all Section D rows are already covered by existing GRNs.");
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
      source_doc_type: "Customer Return",
      source_doc_no: i.indent_no || "",
      source_doc_date: i.indent_date || "",
      warehouse_id: warehouseIdPrefill,
      storage_location: warehouseNamePrefill,
      internal_remarks: [
        i.indent_no ? `Customer return from Indent ${i.indent_no}` : "",
        i.remarks || "",
      ].filter(Boolean).join(" · "),
      items,
    };
    try { sessionStorage.setItem("grn:prefill:new-customer", JSON.stringify(prefill)); } catch { /* noop */ }
    navigate({ to: "/grn/customer/new" });
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
          <Button variant="outline" size="sm" onClick={() => generateChallan()}>
            <FileOutput className="h-4 w-4 mr-1" />Generate Delivery Challan
          </Button>
          <Button variant="outline" size="sm" onClick={() => generateGrn()}>
            <PackageCheck className="h-4 w-4 mr-1" />Generate GRN
          </Button>
          <span className="text-xs text-muted-foreground self-center min-w-[70px] text-right">
            {autoSaveState === "saving" ? "Saving…" : autoSaveState === "saved" ? "Saved" : autoSaveState === "error" ? "Save Failed" : ""}
          </span>
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
          indentId={i.id}
          value={o}
          defectiveParts={defParts}
          isAdmin={isAdmin}
          collapsed={!!collapsedMap[idx]}
          onToggleCollapse={() => setCollapsedMap((m) => ({ ...m, [idx]: !m[idx] }))}
          onChange={(v) => update({ oracles_data: (i.oracles_data || []).map((x, ix) => (ix === idx ? v : x)) })}
          onRemove={() => update({ oracles_data: (i.oracles_data || []).filter((_, ix) => ix !== idx) })}
          onGenerateChallan={generateChallan}
          onGenerateGrn={generateGrn}
          onGenerateCustomerGrn={generateCustomerGrn}
          dcExists={!!dcByOracle[(o.oracle_no || "").trim().toUpperCase()]}
          dcInfo={dcByOracle[(o.oracle_no || "").trim().toUpperCase()]}
        />
      ))}
    </div>
  );
}