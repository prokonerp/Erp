import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageLoader } from "@/components/shared/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/hooks/useConfirm";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  CALL_TYPES,
  TICKET_STATUSES,
  STATUS_COLOR,
  PRIORITIES,
  PRIORITY_COLOR,
  waOpen,
  engineerAssignMsg,
  customerClosedMsg,
  renderTemplate,
  isTerminalStatus,
  type PartLine,
} from "@/lib/tickets";
import {
  Save,
  Trash2,
  Plus,
  MessageCircle,
  FileText,
  UserPlus,
  CheckCircle2,
  ArrowLeft,
  Printer,
  CalendarClock,
  AlertTriangle,
  ClipboardList,
  Check,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { getOemLogo } from "@/lib/oemLogos";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { useIsAdmin } from "@/lib/useRole";
import { useTicketVerifications } from "@/hooks/useTicketVerifications";
import { useFieldServiceReport } from "@/hooks/useFieldServiceReport";
import { VerificationDiff } from "@/components/VerificationDiff";
import { FsrPrintButton, type FsrDbRow } from "@/components/fsr/FsrPrintButton";
import { fetchEngineerLoginIds } from "@/hooks/useTicketsTable";
import { attachLoginFlags, sortEngineersLoginFirst } from "@/lib/eng-queue-utils";
import { TicketPartPicker } from "@/components/TicketPartPicker";
import {
  stageableTicketLines,
  stageTicketDcPrefill,
  stageTicketGrnPrefill,
  type TicketDocInput,
} from "@/lib/ticketDocs";
import { DateTimePicker } from "@/components/DateTimePicker";
import { ComplaintPicker } from "@/components/ComplaintPicker";
import { ClosingRemarksDialog } from "@/components/ClosingRemarksDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listIndentMapForTicket } from "@/lib/indent.functions";
import { resetTicketEngineerWork } from "@/lib/reset-ticket-engineer.functions";
import { syncFsrPartsToTicket } from "@/lib/sync-fsr-parts.functions";
import { Eye } from "lucide-react";
import { RotateCcw } from "lucide-react";

type FsrVolts = { volts: number | null };
type FsrPc = { monitor_size_in: number | null; qty: number | null };
type FsrWattQty = { rating_w: number | null; qty: number | null };
type FsrPart = {
  item: string | null;
  old_sr_no: string | null;
  new_sr_no: string | null;
  charges: number | null;
  qty: number | null;
};

function asFsrArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export const Route = createFileRoute("/_app/tickets/$id")({
  component: TicketDetail,
});

type Ticket = {
  id: string;
  case_id: string;
  call_type: string;
  product: string | null;
  serial_no: string | null;
  customer_name: string;
  customer_address: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  location: string | null;
  sector: string | null;
  priority: string | null;
  complaint: string | null;
  status: string;
  assigned_engineer_name: string | null;
  assigned_engineer_phone: string | null;
  assigned_at: string | null;
  equipment_id: string | null;
  parts_used: boolean;
  parts_details: PartLine[];
  defective_parts_received: boolean;
  defective_parts_details: PartLine[];
  good_parts_used: boolean;
  good_parts_details: PartLine[];
  quotation_id: string | null;
  closed_at: string | null;
  remarks: string | null;
  created_at: string;
  customer_id: string | null;
  grn_no?: string | null;
  dc_no?: string | null;
  oem_call: boolean;
  oem_brand: string | null;
  oem_ref_id: string | null;
  oem_purchase_date: string | null;
  source: string | null;
  amc_id: string | null;
  pm_visit_id: string | null;
  special_instruction: string | null;
  special_instruction_acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  preferred_visit_datetime: string | null;
};

type CustomerBilling = {
  id: string;
  company: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  billing_address: string | null;
  address: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  gst: string | null;
};

type Employee = {
  id: string;
  name: string;
  phone: string | null;
  department: string | null;
  role: string | null;
  active: boolean;
  /** True when linked to a portal login (can receive calls in /eng). */
  hasLogin?: boolean;
};

type Activity = {
  id: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  notes: string | null;
  created_at: string;
  special_instruction?: boolean | null;
};

const VERIFY_LABEL: Record<string, string> = {
  customer_verify: "Customer verification",
  equipment_verify: "Equipment verification",
  photo: "Photo",
  note: "Note",
  acknowledge: "Acknowledge",
  verification_reset: "Verification reset",
};

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function preferredRibbonStyle(dt: string | null) {
  if (!dt) return "";
  const pv = new Date(dt).getTime();
  const now = Date.now();
  const diffHours = (pv - now) / 3600000;
  if (diffHours >= 0 && diffHours <= 2) {
    return "border-amber-300 bg-amber-50 text-amber-700 animate-pulse";
  }
  if (diffHours < 0) {
    return "border-red-300 bg-red-50 text-red-700";
  }
  return "border-blue-300 bg-blue-50 text-blue-700 animate-pulse";
}

function formatPreferred(dt: string | null): string {
  if (!dt) return "";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear().toString().slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TicketDetail() {
  const confirm = useConfirm();

  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [t, setT] = useState<Ticket | null>(null);
  const [products, setProducts] = useState<
    {
      id: string;
      name: string;
      model?: string | null;
      brand?: string | null;
      description?: string | null;
    }[]
  >([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteSpecial, setNoteSpecial] = useState(false);
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [quoteNo, setQuoteNo] = useState<string>("");
  const [customer, setCustomer] = useState<CustomerBilling | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [oemBrands, setOemBrands] = useState<string[]>([
    "APC",
    "Luminous",
    "Microtek",
    "Eaton",
    "Exide",
    "Quanta",
  ]);
  const [closingOpen, setClosingOpen] = useState(false);
  const [cancellingOpen, setCancellingOpen] = useState(false);

  const { isAdmin } = useIsAdmin();
  const { data: verifications } = useTicketVerifications(id);
  const { data: fsrRows, refetch: refetchFsr } = useFieldServiceReport(id);
  const fsrLatest = fsrRows?.[0] ?? null;
  const [selectedDefRows, setSelectedDefRows] = useState<Record<number, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string>("");
  const dirtyRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmBusyRef = useRef<boolean>(false);
  const fetchIndentMap = useServerFn(listIndentMapForTicket);
  const callResetEngineerWork = useServerFn(resetTicketEngineerWork);
  const callSyncFsrParts = useServerFn(syncFsrPartsToTicket);
  const [syncPartsBusy, setSyncPartsBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetTyped, setResetTyped] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [resetPreview, setResetPreview] = useState<{
    customerRows: number;
    equipmentRows: number;
    activityRows: number;
    visitRows: number;
    fsrRows: number;
    photoCount: number;
  } | null>(null);
  const [reopenFsrBusy, setReopenFsrBusy] = useState(false);
  const indentMapQuery = useQuery({
    queryKey: ["indent-oracle-map", id],
    queryFn: () => fetchIndentMap({ data: { ticket_id: id } }),
    enabled: !!id,
  });
  const indentByOracle = new Map<
    string,
    { indent_id: string; indent_no: string | null; status: string | null }
  >(
    (indentMapQuery.data || []).map((r) => [
      r.oracle_no.trim().toUpperCase(),
      { indent_id: r.indent_id, indent_no: r.indent_no, status: r.status },
    ]),
  );

  const load = async () => {
    const [{ data: tk }, { data: pr }, { data: ac }, { data: tpl }, { data: emps }, linked] =
      await Promise.all([
        supabase.from("tickets").select("*").eq("id", id).single(),
        supabase.from("products").select("id,name,model,brand,description").order("name"),
        supabase
          .from("ticket_activities")
          .select("*")
          .eq("ticket_id", id)
          .order("created_at", { ascending: false }),
        supabase.from("wa_templates").select("id,body"),
        supabase
          .from("assignable_engineers")
          .select("id,name,phone,department,role,active")
          .order("name"),
        fetchEngineerLoginIds(),
      ]);
    if (tk) {
      const row = tk as unknown as Ticket;
      const parts = Array.isArray((tk as { parts_details?: unknown }).parts_details)
        ? ((tk as { parts_details: unknown[] }).parts_details as PartLine[])
        : [];
      const defParts = Array.isArray(
        (tk as { defective_parts_details?: unknown }).defective_parts_details,
      )
        ? ((tk as { defective_parts_details: unknown[] }).defective_parts_details as PartLine[])
        : [];
      const goodParts = Array.isArray((tk as { good_parts_details?: unknown }).good_parts_details)
        ? ((tk as { good_parts_details: unknown[] }).good_parts_details as PartLine[])
        : [];
      setT({
        ...row,
        parts_details: parts,
        defective_parts_received: !!(tk as { defective_parts_received?: boolean })
          .defective_parts_received,
        defective_parts_details: defParts,
        good_parts_used: !!(tk as { good_parts_used?: boolean }).good_parts_used,
        good_parts_details: goodParts,
      });
      if (row.quotation_id) {
        const { data: q } = await supabase
          .from("quotations")
          .select("quote_no")
          .eq("id", row.quotation_id)
          .single();
        setQuoteNo((q as { quote_no?: string } | null)?.quote_no || "");
      } else {
        setQuoteNo("");
      }
      if (row.customer_id) {
        const { data: c } = await supabase
          .from("customers")
          .select(
            "id,company,contact_name,phone,email,billing_address,address,street,city,state,country,gst",
          )
          .eq("id", row.customer_id)
          .single();
        setCustomer((c as CustomerBilling | null) ?? null);
      } else {
        setCustomer(null);
      }
    }
    setProducts(
      (pr || []) as { id: string; name: string; model?: string | null; brand?: string | null }[],
    );
    setActivities((ac || []) as Activity[]);
    // Portal engineers first so assignment routes to real logins.
    setEmployees(
      sortEngineersLoginFirst(
        attachLoginFlags((emps || []) as Omit<Employee, "hasLogin">[], linked),
      ),
    );
    const map: Record<string, string> = {};
    for (const r of (tpl || []) as { id: string; body: string }[]) map[r.id] = r.body;
    setTemplates(map);
    const { data: brands } = await supabase
      .from("oem_brand_master" as never)
      .select("name")
      .order("name");
    const bnames = ((brands as { name: string }[] | null) || []).map((b) => b.name);
    if (bnames.length) setOemBrands(Array.from(new Set(bnames)));
  };

  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [id]);

  // Auto-save on any change to the ticket. Debounces 2s of inactivity, silently
  // updates the DB, and reports status via `saveStatus`. Skips server round-trip
  // until the user has actually edited a field this session.
  useEffect(() => {
    if (!t) return;
    if (!dirtyRef.current) return;
    // Terminal records are never auto-overwritten — reopen via status change.
    if (isTerminalStatus(t.status)) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setSaveStatus("saving");
    autoSaveTimerRef.current = setTimeout(async () => {
      // Re-check: the record may have reached a terminal status during debounce.
      if (isTerminalStatus(t.status)) return;
      // Soft validation: if payload violates a hard rule, pause auto-save
      // and surface it so the user knows why nothing is being persisted.
      if (t.oem_call && (!t.oem_brand || !t.oem_ref_id || !t.oem_purchase_date)) {
        setSaveStatus("error");
        setSaveError("OEM Brand, Ref ID and Purchase Date are required");
        return;
      }
      if (t.preferred_visit_datetime) {
        const pv = new Date(t.preferred_visit_datetime).getTime();
        if (pv < Date.now() - 60000) {
          setSaveStatus("error");
          setSaveError("Preferred visit date & time cannot be in the past");
          return;
        }
      }
      const parts_used = !!t.defective_parts_received || !!t.good_parts_used;
      const { error } = await supabase
        .from("tickets")
        .update({
          case_id: t.case_id,
          call_type: t.call_type,
          product: t.product,
          serial_no: t.serial_no,
          customer_name: t.customer_name,
          customer_address: t.customer_address,
          customer_email: t.customer_email,
          customer_phone: t.customer_phone,
          location: t.location,
          sector: t.sector,
          priority: t.priority,
          complaint: t.complaint,
          status: t.status,
          assigned_engineer_name: t.assigned_engineer_name,
          assigned_engineer_phone: t.assigned_engineer_phone,
          assigned_at: t.assigned_at,
          parts_used,
          parts_details: t.parts_details,
          defective_parts_received: t.defective_parts_received,
          defective_parts_details: t.defective_parts_received ? t.defective_parts_details : [],
          good_parts_used: t.good_parts_used,
          good_parts_details: t.good_parts_used ? t.good_parts_details : [],
          remarks: t.remarks,
          oem_call: t.oem_call,
          oem_brand: t.oem_call ? t.oem_brand : null,
          oem_ref_id: t.oem_call ? t.oem_ref_id : null,
          oem_purchase_date: t.oem_call ? t.oem_purchase_date : null,
          special_instruction: (t.special_instruction ?? "").toString().trim() || null,
          preferred_visit_datetime: t.preferred_visit_datetime || null,
        } as never)
        .eq("id", t.id);
      if (error) {
        setSaveStatus("error");
        setSaveError(error.message);
        return;
      }
      dirtyRef.current = false;
      setSaveError("");
      setSaveStatus("saved");
    }, 2000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [t]);

  // Warn on unload while there are pending unsaved changes so users don't
  // lose in-flight edits mid-debounce.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || saveStatus === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveStatus]);

  if (!t) return <PageLoader />;

  const update = (patch: Partial<Ticket>) => {
    dirtyRef.current = true;
    setT((s) => (s ? { ...s, ...patch } : s));
  };

  const tplVars = (extra: Record<string, string> = {}) => ({
    case_id: t.case_id,
    call_type: t.call_type,
    customer_name: t.customer_name,
    customer_phone: t.customer_phone || "",
    location: t.location || "",
    customer_address: t.customer_address || "",
    product: t.product || "",
    serial_no: t.serial_no || "",
    complaint: t.complaint || "",
    product_line: t.product ? ` for ${t.product}` : "",
    quote_no: quoteNo,
    ...extra,
  });

  const renderMsg = (
    id: "engineer_assign" | "oow_quotation" | "ticket_closed",
    fallback: string,
  ) => (templates[id] ? renderTemplate(templates[id], tplVars()) : fallback);

  const logActivity = async (
    kind: string,
    notes: string,
    from_status?: string,
    to_status?: string,
    special?: boolean,
  ) => {
    const { data: u } = await supabase.auth.getUser();
    // B-16: activity history is the audit trail for status changes — a failed
    // insert must be visible. We warn instead of throwing so an already-applied
    // status change isn't misreported as failed.
    const { error } = await supabase.from("ticket_activities").insert({
      ticket_id: t.id,
      kind,
      notes,
      from_status: from_status ?? null,
      to_status: to_status ?? null,
      actor: u.user?.id ?? null,
      special_instruction: !!special,
    } as never);
    if (error) {
      console.error("ticket_activities insert failed:", error.message);
      toast.warning(`Action done, but recording it in ticket history failed: ${error.message}`);
    }
  };

  const launchTicketWhatsApp = async (
    phone: string | null | undefined,
    message: string,
    recipientLabel: string,
  ) => {
    const ok = await waOpen(phone, message, {
      module: "ticket",
      recordId: t.id,
      recordNumber: t.case_id,
      recipientLabel,
      preferWeb: true,
    });
    if (!ok) return toast.error("Valid mobile number is required before sending WhatsApp message.");
    toast.success("Opening WhatsApp Web…");
  };

  const save = async (extra: Partial<Ticket> = {}) => {
    setBusy(true);
    const payload = { ...t, ...extra };
    if (payload.oem_call) {
      if (!payload.oem_brand || !payload.oem_ref_id || !payload.oem_purchase_date) {
        setBusy(false);
        toast.error("OEM Call is enabled — Brand, Ref ID and Purchase Date are required.");
        return false;
      }
    }
    if (payload.defective_parts_received) {
      const valid = (payload.defective_parts_details || []).some((p) => (p.name || "").trim());
      if (!valid) {
        setBusy(false);
        toast.error("Add at least one Defective Part Received or turn the section off.");
        return false;
      }
    }
    if (payload.good_parts_used) {
      const valid = (payload.good_parts_details || []).some((p) => (p.name || "").trim());
      if (!valid) {
        setBusy(false);
        toast.error("Add at least one Good Part Used or turn the section off.");
        return false;
      }
    }
    // Keep legacy parts_used flag in sync for back-compat
    payload.parts_used = !!payload.defective_parts_received || !!payload.good_parts_used;
    if (payload.preferred_visit_datetime) {
      const pv = new Date(payload.preferred_visit_datetime).getTime();
      if (pv < Date.now() - 60000) {
        setBusy(false);
        toast.error("Preferred visit date & time cannot be in the past");
        return false;
      }
    }
    const { error } = await supabase
      .from("tickets")
      .update({
        case_id: payload.case_id,
        call_type: payload.call_type,
        product: payload.product,
        serial_no: payload.serial_no,
        customer_name: payload.customer_name,
        customer_address: payload.customer_address,
        customer_email: payload.customer_email,
        customer_phone: payload.customer_phone,
        location: payload.location,
        sector: payload.sector,
        priority: payload.priority,
        complaint: payload.complaint,
        status: payload.status,
        assigned_engineer_name: payload.assigned_engineer_name,
        assigned_engineer_phone: payload.assigned_engineer_phone,
        assigned_at: payload.assigned_at,
        parts_used: payload.parts_used,
        parts_details: payload.parts_details,
        defective_parts_received: payload.defective_parts_received,
        defective_parts_details: payload.defective_parts_received
          ? payload.defective_parts_details
          : [],
        good_parts_used: payload.good_parts_used,
        good_parts_details: payload.good_parts_used ? payload.good_parts_details : [],
        remarks: payload.remarks,
        closed_at: payload.closed_at,
        oem_call: payload.oem_call,
        oem_brand: payload.oem_call ? payload.oem_brand : null,
        oem_ref_id: payload.oem_call ? payload.oem_ref_id : null,
        oem_purchase_date: payload.oem_call ? payload.oem_purchase_date : null,
        special_instruction: (payload.special_instruction ?? "").toString().trim() || null,
        preferred_visit_datetime: payload.preferred_visit_datetime || null,
      } as never)
      .eq("id", t.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success("Saved");
    return true;
  };

  const changeStatus = async (next: string) => {
    if (next === "Closed") {
      setClosingOpen(true);
      return;
    }
    if (next === "Cancelled") {
      setCancellingOpen(true);
      return;
    }
    const prev = t.status;
    const extra: Partial<Ticket> = { status: next };
    update(extra);
    const ok = await save(extra);
    if (!ok) return;
    await logActivity("status", `Status changed: ${prev} → ${next}`, prev, next);
    await load();
  };

  const confirmClose = async (remarks: string): Promise<boolean> => {
    const prev = t.status;
    const { data: u } = await supabase.auth.getUser();
    const actorName =
      (u.user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name ||
      (u.user?.user_metadata as { full_name?: string; name?: string } | null)?.name ||
      u.user?.email ||
      "User";
    const ts = new Date().toLocaleString();
    const noteBody = `Closing Remarks by ${actorName} at ${ts}:\n${remarks}`;
    const { error: noteErr } = await supabase.from("ticket_activities").insert({
      ticket_id: t.id,
      kind: "note",
      notes: noteBody,
      actor: u.user?.id ?? null,
    } as never);
    if (noteErr) {
      toast.error(`Could not save remarks: ${noteErr.message}`);
      return false;
    }
    const closedAt = new Date().toISOString();
    const { error: upErr } = await supabase
      .from("tickets")
      .update({
        status: "Closed",
        closed_at: closedAt,
      } as never)
      .eq("id", t.id);
    if (upErr) {
      toast.error(`Remarks saved, but closing failed: ${upErr.message}`);
      return false;
    }
    await logActivity("status", `Status changed: ${prev} → Closed`, prev, "Closed");
    toast.success("Ticket closed");
    await load();
    if (t.customer_phone) {
      await launchTicketWhatsApp(
        t.customer_phone,
        renderMsg("ticket_closed", customerClosedMsg(t)),
        "Customer",
      );
    }
    return true;
  };

  const confirmCancel = async (remarks: string): Promise<boolean> => {
    const prev = t.status;
    const { data: u } = await supabase.auth.getUser();
    const actorName =
      (u.user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name ||
      (u.user?.user_metadata as { full_name?: string; name?: string } | null)?.name ||
      u.user?.email ||
      "User";
    const ts = new Date().toLocaleString();
    const noteBody = `Cancellation Reason by ${actorName} at ${ts}:\n${remarks}`;
    const { error: noteErr } = await supabase.from("ticket_activities").insert({
      ticket_id: t.id,
      kind: "note",
      notes: noteBody,
      actor: u.user?.id ?? null,
    } as never);
    if (noteErr) {
      toast.error(`Could not save reason: ${noteErr.message}`);
      return false;
    }
    const { error: upErr } = await supabase
      .from("tickets")
      .update({
        status: "Cancelled",
      } as never)
      .eq("id", t.id);
    if (upErr) {
      toast.error(`Reason saved, but cancellation failed: ${upErr.message}`);
      return false;
    }
    await logActivity("status", `Status changed: ${prev} → Cancelled`, prev, "Cancelled");
    toast.success("Ticket cancelled");
    await load();
    // No customer WhatsApp message on cancellation — only genuine closures should notify the customer.
    return true;
  };

  const assignEngineer = async () => {
    if (!t.assigned_engineer_name || !t.assigned_engineer_phone) {
      return toast.error("Engineer name and phone required");
    }
    const extra: Partial<Ticket> = {
      assigned_at: new Date().toISOString(),
      status: t.status === "New" || t.status === "Call Log" ? "In Progress" : t.status,
    };
    update(extra);
    const ok = await save(extra);
    if (!ok) return;
    await logActivity(
      "assigned",
      `Assigned to ${t.assigned_engineer_name} (${t.assigned_engineer_phone})`,
    );
    await load();
    await launchTicketWhatsApp(
      t.assigned_engineer_phone,
      renderMsg("engineer_assign", engineerAssignMsg(t)),
      "Engineer",
    );
  };

  const addDef = () =>
    update({
      defective_parts_details: [...(t.defective_parts_details || []), { name: "", qty: "1" }],
    });
  const updDef = (i: number, p: Partial<PartLine>) =>
    update({
      defective_parts_details: (t.defective_parts_details || []).map((x, idx) =>
        idx === i ? { ...x, ...p } : x,
      ),
    });
  const delDef = (i: number) =>
    update({
      defective_parts_details: (t.defective_parts_details || []).filter((_, idx) => idx !== i),
    });
  const addGood = () =>
    update({ good_parts_details: [...(t.good_parts_details || []), { name: "", qty: "1" }] });
  const updGood = (i: number, p: Partial<PartLine>) =>
    update({
      good_parts_details: (t.good_parts_details || []).map((x, idx) =>
        idx === i ? { ...x, ...p } : x,
      ),
    });
  const delGood = (i: number) =>
    update({ good_parts_details: (t.good_parts_details || []).filter((_, idx) => idx !== i) });

  // FSR-line review (admin-only UI below). Actor name reuses the page's
  // existing user_metadata pattern (see confirmClose/confirmCancel).
  const getActorName = async (): Promise<string | null> => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return null;
    const md = u.user?.user_metadata as { full_name?: string; name?: string } | null;
    return md?.full_name || md?.name || u.user?.email || "User";
  };
  const confirmDef = async (indexes: number[]) => {
    if (confirmBusyRef.current) return;
    confirmBusyRef.current = true;
    try {
      const by = await getActorName();
      if (!by) {
        toast.error("Session expired — please re-login");
        return;
      }
      const at = new Date().toISOString();
      const patch: Partial<Ticket> = {
        defective_parts_details: (t.defective_parts_details || []).map((x, idx) =>
          indexes.includes(idx) ? { ...x, confirmed: true, confirmed_by: by, confirmed_at: at } : x,
        ),
      };
      update(patch);
      const ok = await save(patch);
      if (!ok) await load();
    } finally {
      confirmBusyRef.current = false;
    }
  };
  const confirmGood = async (indexes: number[]) => {
    if (confirmBusyRef.current) return;
    confirmBusyRef.current = true;
    try {
      const by = await getActorName();
      if (!by) {
        toast.error("Session expired — please re-login");
        return;
      }
      const at = new Date().toISOString();
      const patch: Partial<Ticket> = {
        good_parts_details: (t.good_parts_details || []).map((x, idx) =>
          indexes.includes(idx) ? { ...x, confirmed: true, confirmed_by: by, confirmed_at: at } : x,
        ),
      };
      update(patch);
      const ok = await save(patch);
      if (!ok) await load();
    } finally {
      confirmBusyRef.current = false;
    }
  };
  const ticketDocInput = (): TicketDocInput => ({
    ticketId: t.id,
    caseId: t.case_id,
    customerId: t.customer_id,
  });
  const handleGenerateGrn = () => {
    stageTicketGrnPrefill(
      ticketDocInput(),
      stageableTicketLines(t.defective_parts_details || []).included,
    );
    navigate({ to: "/grn/new" });
  };
  const handleGenerateDc = () => {
    stageTicketDcPrefill(
      ticketDocInput(),
      stageableTicketLines(t.good_parts_details || []).included,
    );
    navigate({ to: "/challan/customer/new" });
  };
  // Nulls the doc-number stamp (covers abandoned drafts). If the grn_no/dc_no
  // columns are missing (migration not yet applied), the update errors and we
  // surface it without touching local state.
  const clearStamp = async (col: "grn_no" | "dc_no") => {
    const { error } = await supabase
      .from("tickets")
      .update({ [col]: null } as never)
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    update({ [col]: null } as Partial<Ticket>);
    toast.success("Link cleared");
  };

  const unconfirmedDef = (t.defective_parts_details || []).flatMap((p, i) =>
    p.source === "fsr" && !p.confirmed ? [i] : [],
  );
  const unconfirmedGood = (t.good_parts_details || []).flatMap((p, i) =>
    p.source === "fsr" && !p.confirmed ? [i] : [],
  );
  const stagedDef = stageableTicketLines(t.defective_parts_details || []);
  const stagedGood = stageableTicketLines(t.good_parts_details || []);
  const hasNamedDef = (t.defective_parts_details || []).some((p) => (p.name || "").trim());
  const hasNamedGood = (t.good_parts_details || []).some((p) => (p.name || "").trim());

  const addNote = async () => {
    if (!noteText.trim()) return;
    await logActivity("note", noteText, undefined, undefined, noteSpecial);
    setNoteText("");
    setNoteSpecial(false);
    await load();
    toast.success(noteSpecial ? "Special instruction added" : "Note added");
  };

  const createOOWQuote = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Not signed in");
    const item = {
      description: `${t.product || "Service"} — ${t.complaint || "OOW Service"}`,
      hsn: "",
      qty: 1,
      unit: "Nos",
      rate: 0,
      discount_percent: 0,
      tax_percent: 18,
      amount: 0,
    };
    const { data, error } = await supabase
      .from("quotations")
      .insert({
        quote_no: "",
        owner_id: u.user.id,
        subject: `OOW Service — ${t.case_id}`,
        reference_no: t.case_id,
        customer_notes: `Case: ${t.case_id}\nModel: ${t.product || "—"}\nSerial: ${t.serial_no || "—"}\nIssue: ${t.complaint || "—"}`,
        items: [item],
      } as never)
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    const qid = (data as { id: string }).id;
    await supabase
      .from("tickets")
      .update({ quotation_id: qid } as never)
      .eq("id", t.id);
    await logActivity("quote", `OOW quotation created`);
    toast.success("OOW quotation created — opening editor");
    navigate({ to: "/crm/quotations/$id", params: { id: qid } });
  };

  const del = async () => {
    const ok = await confirm({
      title: `Delete ticket ${t.case_id}?`,
      description:
        "This hides the ticket from listings (soft delete). An admin can restore it from the Archive for 30 days.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const { softDelete } = await import("@/lib/softDelete");
    const { error } = await softDelete("tickets", t.id);
    if (error) return toast.error(error.message);
    toast.success("Moved to Archive");
    navigate({ to: "/tickets" });
  };

  const handleResetEngineerWork = async () => {
    if (!t || !isAdmin || resetBusy) return;
    setResetBusy(true);
    try {
      const preview = await callResetEngineerWork({ data: { ticket_id: t.id, dryRun: true } });
      setResetPreview({
        customerRows: preview.customerRows ?? 0,
        equipmentRows: preview.equipmentRows ?? 0,
        activityRows: preview.activityRows ?? 0,
        visitRows: preview.visitRows ?? 0,
        fsrRows: preview.fsrRows ?? 0,
        photoCount: (preview.photoPaths ?? []).length,
      });
      setResetTyped("");
      setResetReason("");
      setResetDialogOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetBusy(false);
    }
  };

  const confirmResetEngineerWork = async () => {
    if (!t || resetBusy) return;
    if (resetTyped !== t.case_id || !resetReason.trim()) return;
    setResetBusy(true);
    try {
      const res = await callResetEngineerWork({
        data: { ticket_id: t.id, reason: resetReason.trim() },
      });
      toast.success(
        `Engineer work reset: ${res.deletedActivities ?? 0} activities, ${res.deletedVisits ?? 0} visits, ${res.deletedFsr ?? 0} service reports, ${(res.removedPhotos ?? []).length} photos removed.`,
      );
      setResetDialogOpen(false);
      setResetTyped("");
      setResetReason("");
      setResetPreview(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetBusy(false);
    }
  };

  const handleSyncFsrParts = async () => {
    if (!t || !isAdmin || syncPartsBusy) return;
    setSyncPartsBusy(true);
    try {
      const res = await callSyncFsrParts({ data: { ticketId: t.id } });
      toast.success(
        `Parts synced: ${res.defectiveAdded ?? 0} defective received, ${res.goodAdded ?? 0} good used (${res.defectiveTotal ?? 0} total, ${res.goodTotal ?? 0} total)`,
      );
      await Promise.all([load(), refetchFsr()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncPartsBusy(false);
    }
  };

  const reopenFsr = async () => {
    if (!t || !isAdmin || reopenFsrBusy) return;
    const ok = await confirm({
      title: `Reopen field service report for ${t.case_id}?`,
      description:
        "This deletes the submitted report(s) so the engineer can resubmit. The reset audit row and activity log remain the trail.",
      confirmLabel: "Reopen",
      variant: "danger",
    });
    if (!ok) return;
    setReopenFsrBusy(true);
    try {
      const { error } = await supabase.from("field_service_reports").delete().eq("ticket_id", t.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Report reopened — engineer can resubmit");
      await Promise.all([load(), refetchFsr()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reopen failed");
    } finally {
      setReopenFsrBusy(false);
    }
  };

  const hasSpecialActivity = activities.some((a) => a.special_instruction);
  const showSpecialRibbon =
    !!(t.special_instruction && t.special_instruction.trim()) || hasSpecialActivity;
  const acknowledged = !!t.special_instruction_acknowledged;

  const acknowledgeSpecial = async () => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("tickets")
      .update({
        special_instruction_acknowledged: true,
        acknowledged_by: uid,
        acknowledged_at: now,
      } as never)
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setT({
      ...t,
      special_instruction_acknowledged: true,
      acknowledged_by: uid,
      acknowledged_at: now,
    });
    await logActivity("ack", "Special instruction acknowledged");
    load();
    toast.success("Acknowledged");
  };

  const reopenSpecial = async () => {
    const { error } = await supabase
      .from("tickets")
      .update({
        special_instruction_acknowledged: false,
        acknowledged_by: null,
        acknowledged_at: null,
      } as never)
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setT({
      ...t,
      special_instruction_acknowledged: false,
      acknowledged_by: null,
      acknowledged_at: null,
    });
    await logActivity("ack", "Special instruction reopened");
    load();
    toast.success("Reopened");
  };

  return (
    <div className="space-y-4">
      {/* Branded header with OEM at top */}
      <Card className="print:hidden">
        <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <img src={prokonLogo.url} alt="Prokon" className="h-10 w-auto object-contain" />
            <div>
              <div className="font-semibold leading-tight">Prokon Hi-Tech Systems</div>
              <div className="text-xs text-muted-foreground">
                Ticket · <span className="font-mono">{t.case_id}</span>
              </div>
            </div>
          </div>
          {t.oem_call &&
            (() => {
              const oem = getOemLogo(t.oem_brand);
              return (
                <div className="flex items-center gap-3">
                  <Badge className="bg-purple-600 text-white hover:bg-purple-700">
                    OEM{t.oem_brand ? ` · ${t.oem_brand}` : ""}
                  </Badge>
                  {oem && <img src={oem.url} alt={oem.alt} className="h-9 w-auto object-contain" />}
                </div>
              );
            })()}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/tickets" })}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex flex-col gap-1">
            {showSpecialRibbon && (
              <div
                className={`inline-flex items-center gap-2 self-start rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${acknowledged ? "border-green-400 bg-green-100 text-green-800" : "border-red-300 bg-red-50 text-red-700 animate-pulse"}`}
              >
                <AlertTriangle className="h-3 w-3" />
                Special Instruction{acknowledged ? " · Acknowledged" : ""}
                {acknowledged ? (
                  <button
                    type="button"
                    onClick={reopenSpecial}
                    className="ml-2 underline decoration-dotted normal-case font-medium tracking-normal"
                  >
                    Reopen
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={acknowledgeSpecial}
                    className="ml-2 rounded bg-red-700 px-2 py-0.5 text-white normal-case font-semibold tracking-normal hover:bg-red-800"
                  >
                    Mark as Acknowledged
                  </button>
                )}
              </div>
            )}
            {t.preferred_visit_datetime && (
              <div
                className={`inline-flex items-center gap-2 self-start rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${preferredRibbonStyle(t.preferred_visit_datetime)}`}
              >
                <CalendarClock className="h-3 w-3" />
                Preferred Visit: {formatPreferred(t.preferred_visit_datetime)}
              </div>
            )}
            <h2 className="text-xl font-semibold font-mono">{t.case_id}</h2>
          </div>
          <Badge className={STATUS_COLOR[t.status] || ""} variant="secondary">
            {t.status}
          </Badge>
          <Badge
            variant={t.oem_call ? "default" : "outline"}
            className={t.oem_call ? "bg-purple-600 text-white hover:bg-purple-700" : ""}
          >
            {t.oem_call ? "OEM" : "PHS"}
          </Badge>
          <div className="flex items-center gap-2 ml-2 text-sm">
            <span className="text-muted-foreground">OEM Call</span>
            <Switch
              checked={t.oem_call}
              onCheckedChange={(v) =>
                update({
                  oem_call: v,
                  oem_brand: v ? t.oem_brand || "" : null,
                  oem_ref_id: v ? t.oem_ref_id || "" : null,
                  oem_purchase_date: v ? t.oem_purchase_date || "" : null,
                })
              }
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" />
            Print
          </Button>
          <div
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground min-w-[70px]"
            aria-live="polite"
            title={saveStatus === "error" ? saveError : undefined}
          >
            {saveStatus === "saving" && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="h-3.5 w-3.5 text-green-600" />
                Saved
              </>
            )}
            {saveStatus === "error" && (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                <span className="text-red-600">Save failed</span>
                <button
                  type="button"
                  className="ml-1 underline"
                  onClick={() => {
                    dirtyRef.current = true;
                    setT((s) => (s ? { ...s } : s));
                  }}
                >
                  Retry
                </button>
              </>
            )}
          </div>
          <Button onClick={() => save()} disabled={busy}>
            <Save className="h-4 w-4 mr-1" />
            Save
          </Button>
          <Button variant="destructive" size="icon" onClick={del}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 print:hidden">
        {/* Left: ticket details */}
        <div className="lg:col-span-2 space-y-4">
          {t.oem_call && (
            <Card className="border-purple-300">
              <CardHeader>
                <CardTitle className="text-base">OEM Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>OEM Brand *</Label>
                  <Select value={t.oem_brand || ""} onValueChange={(v) => update({ oem_brand: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select brand" />
                    </SelectTrigger>
                    <SelectContent>
                      {oemBrands.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>OEM Ref ID *</Label>
                  <Input
                    value={t.oem_ref_id || ""}
                    onChange={(e) => update({ oem_ref_id: e.target.value })}
                    placeholder="OEM reference / ticket id"
                  />
                </div>
                <div>
                  <Label>OEM Customer Purchase Date *</Label>
                  <Input
                    type="date"
                    value={t.oem_purchase_date || ""}
                    onChange={(e) => update({ oem_purchase_date: e.target.value })}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Ticket Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <Label>Case ID</Label>
                <Input
                  value={t.case_id}
                  onChange={(e) => update({ case_id: e.target.value })}
                  className="font-mono"
                />
              </div>
              <div className="md:col-span-1">
                <Label>Call Type</Label>
                <Select value={t.call_type} onValueChange={(v) => update({ call_type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALL_TYPES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Model</Label>
                <Select
                  value={t.product || ""}
                  onValueChange={(v) => {
                    const p = products.find((x) => (x.model || x.name) === v);
                    update({ product: v, ...(p?.brand ? { oem_brand: p.brand } : {}) });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => {
                      const label = p.model || p.name;
                      return (
                        <SelectItem key={p.id} value={label}>
                          <div className="flex flex-col">
                            <span className="truncate">{p.model || "—"}</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {p.description || "—"}
                            </span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-1">
                <Label>Serial Number</Label>
                <Input
                  value={t.serial_no || ""}
                  onChange={(e) => update({ serial_no: e.target.value.toUpperCase() })}
                  className="font-mono"
                />
              </div>
              <div className="md:col-span-3">
                <Label>Complaint</Label>
                <ComplaintPicker
                  value={t.complaint || ""}
                  onChange={(v) => update({ complaint: v })}
                />
              </div>
              <div className="md:col-span-3">
                <Label>
                  Special Instruction{" "}
                  <span className="text-xs text-muted-foreground">
                    (shows blinking ribbon when filled)
                  </span>
                </Label>
                <Textarea
                  rows={2}
                  value={t.special_instruction || ""}
                  onChange={(e) => update({ special_instruction: e.target.value })}
                  placeholder="Critical handling notes for engineer (optional)"
                />
                {acknowledged && (
                  <div className="mt-1 text-xs text-green-700">
                    Acknowledged
                    {t.acknowledged_at ? ` at ${new Date(t.acknowledged_at).toLocaleString()}` : ""}
                    {t.acknowledged_by ? ` by ${t.acknowledged_by.slice(0, 8)}` : ""}
                  </div>
                )}
              </div>
              <div className="md:col-span-3">
                <Label>
                  Preferred Visit Date & Time{" "}
                  <span className="text-xs text-muted-foreground">(optional)</span>
                </Label>
                <DateTimePicker
                  value={toDatetimeLocal(t.preferred_visit_datetime)}
                  onChange={(v) => {
                    update({ preferred_visit_datetime: v || null });
                    save({ preferred_visit_datetime: v || null });
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {t.equipment_id && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <span className="font-medium">Linked Equipment:</span>{" "}
              <span className="font-mono">{t.equipment_id.slice(0, 8)}…</span>
              <span className="text-muted-foreground ml-2">
                (synced from Installed Equipment register)
              </span>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Name *</Label>
                <Input
                  value={t.customer_name}
                  onChange={(e) => update({ customer_name: e.target.value })}
                />
              </div>
              <div>
                <Label>Contact Number</Label>
                <Input
                  value={t.customer_phone || ""}
                  onChange={(e) => update({ customer_phone: e.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={t.customer_email || ""}
                  onChange={(e) => update({ customer_email: e.target.value })}
                />
              </div>
              <div>
                <Label>Sector / Colony Name</Label>
                <Input
                  value={t.sector || ""}
                  onChange={(e) => update({ sector: e.target.value })}
                />
              </div>
              <div>
                <Label>City / Area</Label>
                <Input
                  value={t.location || ""}
                  onChange={(e) => update({ location: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Address</Label>
                <Textarea
                  rows={2}
                  value={t.customer_address || ""}
                  onChange={(e) => update({ customer_address: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>

          {customer && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Billing Address{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (from Customer Master)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div className="font-semibold">{customer.company}</div>
                {(customer.billing_address || customer.address || customer.street) && (
                  <div className="whitespace-pre-wrap text-muted-foreground">
                    {customer.billing_address ||
                      [customer.street, customer.address].filter(Boolean).join("\n")}
                  </div>
                )}
                <div className="text-muted-foreground">
                  {[customer.city, customer.state].filter(Boolean).join(", ")}
                  {customer.country ? `, ${customer.country}` : ""}
                </div>
                {customer.contact_name && (
                  <div>
                    <span className="text-muted-foreground">Contact: </span>
                    {customer.contact_name}
                  </div>
                )}
                {customer.phone && (
                  <div>
                    <span className="text-muted-foreground">Phone: </span>
                    {customer.phone}
                  </div>
                )}
                {customer.email && (
                  <div>
                    <span className="text-muted-foreground">Email: </span>
                    {customer.email}
                  </div>
                )}
                {customer.gst && (
                  <div>
                    <span className="text-muted-foreground">GSTIN: </span>
                    <span className="font-mono">{customer.gst}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>
                Defective Parts Received{" "}
                <span className="text-xs font-normal text-muted-foreground">(from customer)</span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label className="text-sm">{t.defective_parts_received ? "ON" : "OFF"}</Label>
                <Switch
                  checked={!!t.defective_parts_received}
                  onCheckedChange={(v) =>
                    update({
                      defective_parts_received: v,
                      defective_parts_details: v
                        ? t.defective_parts_details && t.defective_parts_details.length
                          ? t.defective_parts_details
                          : [{ name: "", qty: "1" }]
                        : [],
                    })
                  }
                />
              </div>
            </CardHeader>
            <CardContent>
              {t.defective_parts_received ? (
                <div className="space-y-2">
                  {(t.defective_parts_details || []).length === 0 && (
                    <p className="text-sm text-muted-foreground">No defective parts added yet.</p>
                  )}
                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 bg-muted/30">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!hasNamedDef || !!t.grn_no}
                        onClick={handleGenerateGrn}
                        title={
                          t.grn_no
                            ? `Linked GRN ${t.grn_no}`
                            : "Stage defective lines to a Customer GRN"
                        }
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        Generate GRN (Customer)
                      </Button>
                      {unconfirmedDef.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => confirmDef(unconfirmedDef)}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Confirm all FSR ({unconfirmedDef.length})
                        </Button>
                      )}
                      {stagedDef.excludedUnconfirmed > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {stagedDef.excludedUnconfirmed} unconfirmed FSR line(s) excluded — confirm
                          to include
                        </span>
                      )}
                      {t.grn_no && (
                        <span className="text-xs text-muted-foreground">
                          GRN{" "}
                          <span className="font-mono font-medium text-foreground">{t.grn_no}</span>
                          <button
                            type="button"
                            className="ml-1 underline underline-offset-2"
                            onClick={() => clearStamp("grn_no")}
                          >
                            clear link
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                  {t.oem_call &&
                    (t.defective_parts_details || []).length > 0 &&
                    (() => {
                      const checkedOracles = Object.entries(selectedDefRows)
                        .filter(([, v]) => v)
                        .map(
                          ([i]) =>
                            (t.defective_parts_details || [])[Number(i)]?.oracle_no?.trim() || "",
                        )
                        .filter(Boolean);
                      const uniq = Array.from(new Set(checkedOracles.map((s) => s.toUpperCase())));
                      const disabled = uniq.length < 2;
                      return (
                        <div className="flex items-center justify-between rounded-md border border-dashed p-2 bg-muted/30">
                          <div className="text-xs text-muted-foreground">
                            Select 2+ rows with Oracle # to build a single combined Indent.
                            {uniq.length > 0 && (
                              <span className="ml-1 font-medium text-foreground">
                                {uniq.length} selected.
                              </span>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={disabled}
                            onClick={() => {
                              navigate({
                                to: "/indent/new",
                                search: { ticket_id: t.id, oracle_list: uniq.join(",") },
                              });
                            }}
                          >
                            <ClipboardList className="h-4 w-4 mr-1" />
                            Create Combined Indent
                          </Button>
                        </div>
                      );
                    })()}
                  {(t.defective_parts_details || []).map((p, i) => (
                    <div key={i} className="rounded-md border p-2">
                      {p.source === "fsr" && (
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-[10px]">
                            FSR · {p.confirmed ? "confirmed" : "unconfirmed"}
                          </Badge>
                          {!p.confirmed && isAdmin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => confirmDef([i])}
                            >
                              <Check className="h-3.5 w-3.5 mr-1" />
                              Confirm
                            </Button>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-12 md:col-span-1 flex items-center pb-1">
                          <Checkbox
                            checked={!!selectedDefRows[i]}
                            disabled={!(p.oracle_no && p.oracle_no.trim())}
                            onCheckedChange={(v) => setSelectedDefRows((m) => ({ ...m, [i]: !!v }))}
                            aria-label="Select for combined indent"
                          />
                        </div>
                        <div className="col-span-12 md:col-span-2">
                          <Label>Oracle #</Label>
                          <Input
                            value={p.oracle_no || ""}
                            onChange={(e) => updDef(i, { oracle_no: e.target.value.toUpperCase() })}
                            placeholder="e.g. ORA-001"
                            className="font-mono"
                          />
                        </div>
                        <div className="col-span-12 md:col-span-2">
                          <Label>Part / Item</Label>
                          <TicketPartPicker
                            ticketProduct={t.product}
                            value={p.model_no || p.name}
                            onSelect={(item) =>
                              updDef(i, { name: item.name, model_no: item.model || item.name })
                            }
                          />
                        </div>
                        <div className="col-span-12 md:col-span-2">
                          <Label>Model / Part No</Label>
                          <Input
                            value={p.model_no || ""}
                            onChange={(e) => updDef(i, { model_no: e.target.value })}
                          />
                        </div>
                        <div className="col-span-12 md:col-span-2">
                          <Label>Serial No</Label>
                          <Input
                            value={p.serial || ""}
                            onChange={(e) => updDef(i, { serial: e.target.value.toUpperCase() })}
                            className="font-mono"
                          />
                        </div>
                        <div className="col-span-4 md:col-span-1">
                          <Label>Qty</Label>
                          <Input
                            value={p.qty}
                            onChange={(e) => updDef(i, { qty: e.target.value })}
                          />
                        </div>
                        <div className="col-span-6 md:col-span-1">
                          <Label>Remarks</Label>
                          <Input
                            value={p.remarks || ""}
                            onChange={(e) => updDef(i, { remarks: e.target.value })}
                          />
                        </div>
                        <div className="col-span-12 md:col-span-2 flex items-end gap-1">
                          {t.oem_call &&
                            (() => {
                              const key = (p.oracle_no || "").trim().toUpperCase();
                              const existing = key ? indentByOracle.get(key) : undefined;
                              if (existing) {
                                return (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() =>
                                      navigate({
                                        to: "/indent/$id",
                                        params: { id: existing.indent_id },
                                      })
                                    }
                                    title={`Open ${existing.indent_no || "Indent"}`}
                                  >
                                    <Eye className="h-3.5 w-3.5 mr-1" />
                                    View
                                  </Button>
                                );
                              }
                              return (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  onClick={() =>
                                    navigate({
                                      to: "/indent/new",
                                      search: { ticket_id: t.id, oracle_no: key || "NEW" },
                                    })
                                  }
                                  title="Create Indent for this row"
                                >
                                  <Plus className="h-3.5 w-3.5 mr-1" />
                                  Indent
                                </Button>
                              );
                            })()}
                          <Button size="icon" variant="ghost" onClick={() => delDef(i)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={addDef}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add defective part
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Toggle ON to record defective material received from the customer.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>
                Good Parts Used{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (issued to customer)
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label className="text-sm">{t.good_parts_used ? "ON" : "OFF"}</Label>
                <Switch
                  checked={!!t.good_parts_used}
                  onCheckedChange={(v) =>
                    update({
                      good_parts_used: v,
                      good_parts_details: v
                        ? t.good_parts_details && t.good_parts_details.length
                          ? t.good_parts_details
                          : [{ name: "", qty: "1" }]
                        : [],
                    })
                  }
                />
              </div>
            </CardHeader>
            <CardContent>
              {t.good_parts_used ? (
                <div className="space-y-2">
                  {(t.good_parts_details || []).length === 0 && (
                    <p className="text-sm text-muted-foreground">No good parts added yet.</p>
                  )}
                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 bg-muted/30">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!hasNamedGood || !!t.dc_no}
                        onClick={handleGenerateDc}
                        title={
                          t.dc_no ? `Linked DC ${t.dc_no}` : "Stage good lines to a Customer DC"
                        }
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        Generate DC (Customer)
                      </Button>
                      {unconfirmedGood.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => confirmGood(unconfirmedGood)}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Confirm all FSR ({unconfirmedGood.length})
                        </Button>
                      )}
                      {stagedGood.excludedUnconfirmed > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {stagedGood.excludedUnconfirmed} unconfirmed FSR line(s) excluded —
                          confirm to include
                        </span>
                      )}
                      {t.dc_no && (
                        <span className="text-xs text-muted-foreground">
                          DC{" "}
                          <span className="font-mono font-medium text-foreground">{t.dc_no}</span>
                          <button
                            type="button"
                            className="ml-1 underline underline-offset-2"
                            onClick={() => clearStamp("dc_no")}
                          >
                            clear link
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                  {(t.good_parts_details || []).map((p, i) => {
                    const fromOracle = p.source === "oracle_exchange";
                    const ro = fromOracle && !isAdmin;
                    return (
                      <div
                        key={i}
                        className={`rounded-md border p-2 ${fromOracle ? "bg-muted/40 border-primary/30" : ""}`}
                      >
                        {fromOracle && (
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="secondary" className="text-[10px]">
                              Oracle Exchange{p.oracle_no ? ` · ${p.oracle_no}` : ""}
                              {p.indent_no ? ` · ${p.indent_no}` : ""}
                            </Badge>
                            {ro && (
                              <span className="text-[10px] text-muted-foreground">
                                Auto-synced (read-only)
                              </span>
                            )}
                          </div>
                        )}
                        {p.source === "fsr" && (
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="secondary" className="text-[10px]">
                              FSR · {p.confirmed ? "confirmed" : "unconfirmed"}
                            </Badge>
                            {!p.confirmed &&
                              (isAdmin ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => confirmGood([i])}
                                >
                                  <Check className="h-3.5 w-3.5 mr-1" />
                                  Confirm
                                </Button>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">
                                  Pending admin review
                                </span>
                              ))}
                          </div>
                        )}
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-12 md:col-span-3">
                            <Label>Part / Item</Label>
                            <TicketPartPicker
                              ticketProduct={t.product}
                              value={p.model_no || p.name}
                              onSelect={(item) =>
                                updGood(i, { name: item.name, model_no: item.model || item.name })
                              }
                              disabled={ro}
                            />
                          </div>
                          <div className="col-span-12 md:col-span-3">
                            <Label>Model / Part No</Label>
                            <Input
                              value={p.model_no || ""}
                              onChange={(e) => updGood(i, { model_no: e.target.value })}
                              readOnly={ro}
                            />
                          </div>
                          <div className="col-span-12 md:col-span-2">
                            <Label>Serial No</Label>
                            <Input
                              value={p.serial || ""}
                              onChange={(e) => updGood(i, { serial: e.target.value.toUpperCase() })}
                              className="font-mono"
                              readOnly={ro}
                            />
                          </div>
                          <div className="col-span-4 md:col-span-1">
                            <Label>Qty</Label>
                            <Input
                              value={p.qty}
                              onChange={(e) => updGood(i, { qty: e.target.value })}
                              readOnly={ro}
                            />
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <Label>Remarks</Label>
                            <Input
                              value={p.remarks || ""}
                              onChange={(e) => updGood(i, { remarks: e.target.value })}
                              readOnly={ro}
                            />
                          </div>
                          <div className="col-span-2 md:col-span-1 flex">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => delGood(i)}
                              disabled={ro}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <Button size="sm" variant="outline" onClick={addGood}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add good part
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Toggle ON to record replacement material issued to the customer.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a note…"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                  />
                  <Button onClick={addNote}>Add</Button>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={noteSpecial}
                    onCheckedChange={(v) => setNoteSpecial(v === true)}
                  />
                  <span>
                    Tag as <b className="text-red-700">Special Instruction</b> (flags this ticket as
                    critical)
                  </span>
                </label>
              </div>
              <div className="space-y-2 max-h-72 overflow-auto">
                {activities.length === 0 && (
                  <p className="text-sm text-muted-foreground">No activity yet.</p>
                )}
                {activities.map((a) => (
                  <div
                    key={a.id}
                    className={`border rounded-md p-2 text-sm ${a.special_instruction ? "border-red-300 bg-red-50/60" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize flex items-center gap-2">
                        {VERIFY_LABEL[a.kind] ?? a.kind}
                        {a.special_instruction && (
                          <span className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700">
                            <AlertTriangle className="h-3 w-3" />
                            Special
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                    </div>
                    {a.notes && <div className="text-muted-foreground mt-1">{a.notes}</div>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: status + actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={t.status} onValueChange={changeStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div>
                <Label>Priority</Label>
                <Select
                  value={t.priority || "P3"}
                  onValueChange={(v) => {
                    update({ priority: v });
                    save({ priority: v });
                  }}
                >
                  <SelectTrigger className={PRIORITY_COLOR[t.priority || "P3"]}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {t.closed_at && (
                <p className="text-xs text-muted-foreground">
                  Closed: {new Date(t.closed_at).toLocaleString()}
                </p>
              )}
              {t.status !== "Closed" && t.status !== "Cancelled" && (
                <Button variant="outline" className="w-full" onClick={() => changeStatus("Closed")}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Close & Notify Customer
                </Button>
              )}
            </CardContent>
          </Card>

          {verifications && (verifications.customer || verifications.equipment) && (
            <Card>
              <CardHeader>
                <CardTitle>Engineer Verification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {verifications.customer && (
                  <div className="space-y-1">
                    <Badge
                      variant={
                        verifications.customer.verdict === "verified" ? "default" : "destructive"
                      }
                      className="text-[10px]"
                    >
                      Customer:{" "}
                      {verifications.customer.verdict === "verified" ? "Verified" : "Corrected"}
                    </Badge>
                    {verifications.customer.verdict === "incorrect" &&
                      verifications.customer.snapshot &&
                      verifications.customer.corrected && (
                        <div className="space-y-1 mt-1">
                          <VerificationDiff
                            label="Customer mobile"
                            original={
                              (verifications.customer.snapshot as Record<string, unknown>)
                                .customer_phone as string | null
                            }
                            corrected={
                              (verifications.customer.corrected as Record<string, unknown>)
                                .customer_phone as string | null
                            }
                            engineer={verifications.customer.engineer_name}
                            at={verifications.customer.verified_at}
                          />
                          <VerificationDiff
                            label="Email"
                            original={
                              (verifications.customer.snapshot as Record<string, unknown>)
                                .customer_email as string | null
                            }
                            corrected={
                              (verifications.customer.corrected as Record<string, unknown>)
                                .customer_email as string | null
                            }
                            engineer={verifications.customer.engineer_name}
                            at={verifications.customer.verified_at}
                          />
                        </div>
                      )}
                  </div>
                )}
                {verifications.equipment && (
                  <div className="space-y-1">
                    <Badge
                      variant={
                        verifications.equipment.verdict === "matched" ? "default" : "destructive"
                      }
                      className="text-[10px]"
                    >
                      Equipment:{" "}
                      {verifications.equipment.verdict === "matched" ? "Matched" : "Mismatch"}
                    </Badge>
                    {verifications.equipment.verdict === "mismatch" && (
                      <div className="space-y-1 mt-1">
                        <VerificationDiff
                          label="Model"
                          original={verifications.equipment.original_model}
                          corrected={verifications.equipment.corrected_model}
                          engineer={verifications.equipment.engineer_name}
                          at={verifications.equipment.verified_at}
                          photoPath={verifications.equipment.photo_path}
                        />
                        <VerificationDiff
                          label="Serial No"
                          original={verifications.equipment.original_serial}
                          corrected={verifications.equipment.corrected_serial}
                          engineer={verifications.equipment.engineer_name}
                          at={verifications.equipment.verified_at}
                          photoPath={verifications.equipment.photo_path}
                        />
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle>Field Service Report</CardTitle>
              <FsrPrintButton ticketId={id} fsrRow={fsrLatest as unknown as FsrDbRow | null} />
            </CardHeader>
            <CardContent className="space-y-2">
              {!fsrLatest ? (
                <p className="text-xs text-muted-foreground">
                  No field service report submitted yet.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Submitted</span>
                      <span className="font-medium">
                        {fsrLatest.submitted_at
                          ? new Date(fsrLatest.submitted_at).toLocaleString()
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Engineer</span>
                      <span className="font-medium">{fsrLatest.engineer_name ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Overall rating (1–10)</span>
                      <Badge variant="default" className="text-[10px]">
                        {fsrLatest.rating ?? "—"}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Readings
                    </p>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Mains voltage L-N (VAC)</span>
                      <span className="font-medium">{fsrLatest.mains_voltage_ln ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Mains voltage N-E (VAC)</span>
                      <span className="font-medium">{fsrLatest.mains_voltage_ne ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Battery bank make</span>
                      <span className="font-medium">{fsrLatest.battery_bank_make ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Battery bank Ah</span>
                      <span className="font-medium">{fsrLatest.battery_bank_ah ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Battery bank qty</span>
                      <span className="font-medium">{fsrLatest.battery_bank_qty ?? "—"}</span>
                    </div>
                    {(() => {
                      const charging = asFsrArray<FsrVolts>(fsrLatest.charging_readings);
                      if (charging.length === 0) {
                        return (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">Charging</span>
                            <span className="font-medium">None</span>
                          </div>
                        );
                      }
                      return charging.map((r, i) => (
                        <div
                          key={`charging-${i}`}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-muted-foreground">Charging</span>
                          <span className="font-medium">
                            Battery {i + 1}: {r?.volts ?? "—"} Vdc
                          </span>
                        </div>
                      ));
                    })()}
                    {(() => {
                      const discharging = asFsrArray<FsrVolts>(fsrLatest.discharging_readings);
                      if (discharging.length === 0) {
                        return (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">Discharging</span>
                            <span className="font-medium">None</span>
                          </div>
                        );
                      }
                      return discharging.map((r, i) => (
                        <div
                          key={`discharging-${i}`}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-muted-foreground">Discharging</span>
                          <span className="font-medium">
                            Battery {i + 1}: {r?.volts ?? "—"} Vdc
                          </span>
                        </div>
                      ));
                    })()}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Load Record
                    </p>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">AC provided</span>
                      <Badge
                        variant={fsrLatest.ac_provided ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {fsrLatest.ac_provided ? "Yes" : "No"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">DG provided</span>
                      <Badge
                        variant={fsrLatest.dg_provided ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {fsrLatest.dg_provided ? "Yes" : "No"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Environment duty</span>
                      <Badge
                        variant={fsrLatest.environment_duty ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {fsrLatest.environment_duty ? "Yes" : "No"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">UPS location</span>
                      <span className="font-medium">{fsrLatest.ups_location ?? "—"}</span>
                    </div>
                    {(() => {
                      const pcs = asFsrArray<FsrPc>(fsrLatest.pc_details);
                      if (pcs.length === 0) {
                        return (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">PCs</span>
                            <span className="font-medium">None</span>
                          </div>
                        );
                      }
                      return pcs.map((p, i) => (
                        <div
                          key={`pc-${i}`}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {i === 0 ? `PCs (${pcs.length})` : `PC ${i + 1}`}
                          </span>
                          <span className="font-medium">
                            {p?.monitor_size_in ?? "—"}″ × {p?.qty ?? "—"}
                          </span>
                        </div>
                      ));
                    })()}
                    {(() => {
                      const printers = asFsrArray<FsrWattQty>(fsrLatest.printer_details);
                      if (printers.length === 0) {
                        return (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">Printers</span>
                            <span className="font-medium">None</span>
                          </div>
                        );
                      }
                      return printers.map((p, i) => (
                        <div
                          key={`printer-${i}`}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {i === 0 ? `Printers (${printers.length})` : `Printer ${i + 1}`}
                          </span>
                          <span className="font-medium">
                            {p?.rating_w ?? "—"} W × {p?.qty ?? "—"}
                          </span>
                        </div>
                      ));
                    })()}
                    {(() => {
                      const scanners = asFsrArray<FsrWattQty>(fsrLatest.scanner_details);
                      if (scanners.length === 0) {
                        return (
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">Scanners</span>
                            <span className="font-medium">None</span>
                          </div>
                        );
                      }
                      return scanners.map((s, i) => (
                        <div
                          key={`scanner-${i}`}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-muted-foreground">
                            {i === 0 ? `Scanners (${scanners.length})` : `Scanner ${i + 1}`}
                          </span>
                          <span className="font-medium">
                            {s?.rating_w ?? "—"} W × {s?.qty ?? "—"}
                          </span>
                        </div>
                      ));
                    })()}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Power Condition
                    </p>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Power failures / day</span>
                      <span className="font-medium">{fsrLatest.power_failures_count ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Failure duration (min / day)</span>
                      <span className="font-medium">
                        {fsrLatest.power_failures_duration_min ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Load on DG (%)</span>
                      <span className="font-medium">{fsrLatest.load_on_dg_percent ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">DG set</span>
                      <Badge
                        variant={fsrLatest.dg_set ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {fsrLatest.dg_set ? "Yes" : "No"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">DG set capacity (kVA)</span>
                      <span className="font-medium">{fsrLatest.dg_set_capacity_kva ?? "—"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">AMF panel</span>
                      <Badge
                        variant={fsrLatest.amf_panel ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {fsrLatest.amf_panel ? "Yes" : "No"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Operates non-business hours</span>
                      <Badge
                        variant={fsrLatest.operate_non_business_hours ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {fsrLatest.operate_non_business_hours ? "Yes" : "No"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Operates on holidays</span>
                      <Badge
                        variant={fsrLatest.operate_holidays ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {fsrLatest.operate_holidays ? "Yes" : "No"}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Part Replacements
                    </p>
                    {(() => {
                      const parts = asFsrArray<FsrPart>(fsrLatest.part_replacements);
                      if (parts.length === 0) {
                        return <p className="text-xs text-muted-foreground">None</p>;
                      }
                      return parts.map((p, i) => (
                        <div key={`part-${i}`} className="space-y-1">
                          <p className="text-xs font-medium">
                            Part {i + 1}
                            {p.item ? ` — ${p.item}` : ""}
                          </p>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">Item</span>
                            <span className="font-medium">{p.item ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">Old Sr. No</span>
                            <span className="font-medium">{p.old_sr_no ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">New Sr. No</span>
                            <span className="font-medium">{p.new_sr_no ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">Charges</span>
                            <span className="font-medium">{p.charges ?? "—"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">Qty</span>
                            <span className="font-medium">{p.qty ?? "—"}</span>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {isAdmin && (
            <>
              <Card className="border-destructive/40">
                <CardHeader>
                  <CardTitle>Admin — Engineer Work</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Clears engineer verification data so Step 2 can be redone. Assignment and status
                    are preserved.
                  </p>
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={resetBusy}
                    onClick={handleResetEngineerWork}
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    {resetBusy ? "Resetting…" : "Reset engineer work"}
                  </Button>
                </CardContent>
              </Card>
              <Card className="border-destructive/40">
                <CardHeader>
                  <CardTitle>Admin — Field Service Reports</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(fsrRows ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No submissions yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {(fsrRows ?? []).map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between gap-2 flex-wrap text-xs"
                        >
                          <span className="text-muted-foreground">
                            {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}
                          </span>
                          <span className="font-medium">{r.engineer_name ?? "—"}</span>
                          <span className="font-medium">Rating: {r.rating ?? "—"}/10</span>
                          {r.customer_signature_path ? (
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={async () => {
                                const sigPath = r.customer_signature_path;
                                if (!sigPath) return;
                                const { data, error } = await supabase.storage
                                  .from("ticket-attachments")
                                  .createSignedUrl(sigPath, 3600);
                                if (error || !data?.signedUrl) {
                                  toast.error(error?.message ?? "Could not open signature");
                                  return;
                                }
                                window.open(data.signedUrl, "_blank", "noopener");
                              }}
                            >
                              View signature
                            </button>
                          ) : null}
                          <FsrPrintButton
                            ticketId={id}
                            fsrRow={r as unknown as FsrDbRow | null}
                            compact
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={reopenFsrBusy || (fsrRows ?? []).length === 0}
                    onClick={reopenFsr}
                  >
                    {reopenFsrBusy ? "Reopening…" : "Reopen for engineer"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full min-h-[44px]"
                    disabled={syncPartsBusy || (fsrRows ?? []).length === 0}
                    onClick={handleSyncFsrParts}
                    title="Additive-only and idempotent — backfills ticket parts from submitted reports and retries missed syncs without duplicating rows."
                  >
                    {syncPartsBusy ? "Syncing…" : "Sync FSR parts"}
                  </Button>
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Assign Engineer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <Label>Department filter</Label>
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {Array.from(
                      new Set(employees.map((e) => e.department).filter(Boolean) as string[]),
                    ).map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  Engineer{" "}
                  <span className="text-xs text-muted-foreground">(portal logins first)</span>
                </Label>
                <Select
                  value={employees.find((e) => e.name === t.assigned_engineer_name)?.id || ""}
                  onValueChange={(empId) => {
                    const emp = employees.find((e) => e.id === empId);
                    if (emp)
                      update({
                        assigned_engineer_name: emp.name,
                        assigned_engineer_phone: emp.phone || "",
                      });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={employees.length ? "Select engineer" : "No active employees"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {employees
                      .filter((e) => deptFilter === "all" || e.department === deptFilter)
                      .map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                          {e.department ? ` · ${e.department}` : ""}
                          {e.phone ? ` · ${e.phone}` : ""}
                          {e.hasLogin ? " · Portal" : " · No login"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {employees.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Add employees in Masters → Employees.
                  </p>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {t.assigned_engineer_name ? (
                  <>
                    Selected: <b>{t.assigned_engineer_name}</b>
                    {t.assigned_engineer_phone ? ` (${t.assigned_engineer_phone})` : ""}
                  </>
                ) : (
                  "No engineer selected"
                )}
              </div>
              {(() => {
                const sel = employees.find((e) => e.name === t.assigned_engineer_name);
                return sel && !sel.hasLogin ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                    {sel.name} has no portal login — this call won't appear in the engineer app
                    until Admin links a login (Employees → link auth user).
                  </p>
                ) : null;
              })()}
              {t.assigned_at && (
                <p className="text-xs text-muted-foreground">
                  Assigned: {new Date(t.assigned_at).toLocaleString()}
                </p>
              )}
              <Button className="w-full" onClick={assignEngineer}>
                <UserPlus className="h-4 w-4 mr-1" />
                Assign & Send WhatsApp
              </Button>
              {t.assigned_engineer_phone && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    launchTicketWhatsApp(
                      t.assigned_engineer_phone,
                      renderMsg("engineer_assign", engineerAssignMsg(t)),
                      "Engineer",
                    )
                  }
                >
                  <MessageCircle className="h-4 w-4 mr-1" />
                  Resend WhatsApp
                </Button>
              )}
            </CardContent>
          </Card>

          {t.call_type === "OOW" && (
            <Card>
              <CardHeader>
                <CardTitle>OOW Quotation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {t.quotation_id ? (
                  <>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() =>
                        navigate({ to: "/crm/quotations/$id", params: { id: t.quotation_id! } })
                      }
                    >
                      <FileText className="h-4 w-4 mr-1" />
                      Open Quotation{" "}
                      {quoteNo && <span className="ml-1 font-mono text-xs">({quoteNo})</span>}
                    </Button>
                    {t.customer_phone && (
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          launchTicketWhatsApp(
                            t.customer_phone,
                            renderMsg(
                              "oow_quotation",
                              `Dear ${t.customer_name}, please find our OOW quotation ${quoteNo} for case ${t.case_id}.`,
                            ),
                            "Customer",
                          )
                        }
                      >
                        <MessageCircle className="h-4 w-4 mr-1" />
                        Share Quotation on WhatsApp
                      </Button>
                    )}
                  </>
                ) : (
                  <Button className="w-full" onClick={createOOWQuote}>
                    <FileText className="h-4 w-4 mr-1" />
                    Create OOW Quotation
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  Opens the Sales CRM quotation editor pre-filled with case details.
                </p>
              </CardContent>
            </Card>
          )}

          {t.customer_phone && (
            <Card>
              <CardHeader>
                <CardTitle>Customer WhatsApp</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    launchTicketWhatsApp(
                      t.customer_phone,
                      renderMsg("ticket_closed", customerClosedMsg(t)),
                      "Customer",
                    )
                  }
                >
                  <MessageCircle className="h-4 w-4 mr-1" />
                  Send Closure Message
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Opens WhatsApp Web in a new browser tab with the message prefilled.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <TicketPrint
        t={t}
        customer={customer}
        productModel={products.find((p) => p.name === t.product)?.model || t.product}
      />
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 14mm; }
          body { background: white !important; }
          .no-print, header, nav { display: none !important; }
        }
        .ticket-print { display: none; }
        @media print { .ticket-print { display: block !important; } }
      `}</style>
      <Dialog
        open={resetDialogOpen}
        onOpenChange={(v) => {
          if (!resetBusy) setResetDialogOpen(v);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset engineer work</DialogTitle>
            <DialogDescription>
              {t.case_id} — deletes customer verifications ({resetPreview?.customerRows ?? 0}),
              equipment verifications ({resetPreview?.equipmentRows ?? 0}), engineer activities (
              {resetPreview?.activityRows ?? 0}), site visits (arrival/departure) (
              {resetPreview?.visitRows ?? 0}), field service reports incl. customer signature (
              {resetPreview?.fsrRows ?? 0}), and signature photos ({resetPreview?.photoCount ?? 0}
              ). Assignment and status are preserved. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="reset-confirm-input">Type {t.case_id} to confirm</Label>
              <Input
                id="reset-confirm-input"
                value={resetTyped}
                onChange={(e) => setResetTyped(e.target.value)}
                placeholder={t.case_id}
                disabled={resetBusy}
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="reset-reason-input">Reason (saved in audit log)</Label>
              <Textarea
                id="reset-reason-input"
                rows={4}
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                placeholder="Why is this reset needed?"
                disabled={resetBusy}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetDialogOpen(false)}
              disabled={resetBusy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmResetEngineerWork}
              disabled={resetTyped !== t.case_id || !resetReason.trim() || resetBusy}
            >
              {resetBusy ? "Resetting..." : "Reset engineer work"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ClosingRemarksDialog
        open={closingOpen}
        onOpenChange={setClosingOpen}
        caseId={t.case_id}
        onConfirm={confirmClose}
      />
      <ClosingRemarksDialog
        open={cancellingOpen}
        onOpenChange={setCancellingOpen}
        caseId={t.case_id}
        title={`Cancellation Reason — ${t.case_id}`}
        actionLabel="Save & Cancel Ticket"
        placeholder="Describe why this ticket is being cancelled…"
        onConfirm={confirmCancel}
      />
    </div>
  );
}

function TicketPrint({
  t,
  customer,
  productModel,
}: {
  t: Ticket;
  customer: CustomerBilling | null;
  productModel?: string | null;
}) {
  const billLines = customer
    ? ([
        customer.company,
        customer.billing_address || [customer.street, customer.address].filter(Boolean).join("\n"),
        [customer.city, customer.state, customer.country].filter(Boolean).join(", "),
        customer.contact_name ? `Attn: ${customer.contact_name}` : null,
        customer.phone ? `Phone: ${customer.phone}` : null,
        customer.email ? `Email: ${customer.email}` : null,
        customer.gst ? `GSTIN: ${customer.gst}` : null,
      ].filter(Boolean) as string[])
    : [
        t.customer_name,
        t.customer_address || "",
        t.location || "",
        t.customer_phone ? `Phone: ${t.customer_phone}` : "",
        t.customer_email ? `Email: ${t.customer_email}` : "",
      ].filter(Boolean);
  return (
    <div className="ticket-print bg-white text-black mx-auto max-w-3xl p-6 text-[12px] leading-relaxed">
      <div className="text-center border-b-2 border-[#1e40af] pb-3 mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-[#1e3a8a] via-[#2563eb] to-[#dc2626] bg-clip-text text-transparent">
          PROKON HI-TECH SYSTEMS
        </h1>
        <div className="text-sm">B-505, Picasso Centre, Sector-61, Gurgaon</div>
        <div className="mt-2 inline-block px-3 py-0.5 border-2 border-black font-bold tracking-widest text-sm">
          SERVICE TICKET
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
        <div>
          <b>Case ID:</b> <span className="font-mono">{t.case_id}</span>
        </div>
        <div className="text-right">
          <b>Date:</b> {new Date(t.created_at).toLocaleDateString()}
        </div>
        <div>
          <b>Call Type:</b> {t.call_type}
        </div>
        <div className="text-right">
          <b>Status:</b> {t.status}
        </div>
      </div>
      <table className="w-full border border-black mb-3">
        <tbody>
          <tr>
            <td className="border border-black px-2 py-1 w-32 font-bold align-top">
              Billing Address
            </td>
            <td className="border border-black px-2 py-1 whitespace-pre-wrap">
              {billLines.join("\n")}
            </td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1 font-bold">Model</td>
            <td className="border border-black px-2 py-1">{productModel || t.product || "-"}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1 font-bold">Serial No.</td>
            <td className="border border-black px-2 py-1 font-mono">{t.serial_no || "-"}</td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1 font-bold align-top">Complaint</td>
            <td className="border border-black px-2 py-1 whitespace-pre-wrap">
              {t.complaint || "-"}
            </td>
          </tr>
          <tr>
            <td className="border border-black px-2 py-1 font-bold">Assigned Engineer</td>
            <td className="border border-black px-2 py-1">
              {t.assigned_engineer_name || "-"}
              {t.assigned_engineer_phone ? ` (${t.assigned_engineer_phone})` : ""}
            </td>
          </tr>
        </tbody>
      </table>
      {t.defective_parts_received && (t.defective_parts_details || []).length > 0 && (
        <>
          <div className="font-bold mb-1">Defective Parts Received</div>
          <table className="w-full border border-black mb-3">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-black px-2 py-1 w-8">#</th>
                <th className="border border-black px-2 py-1">Oracle #</th>
                <th className="border border-black px-2 py-1">Part / Item</th>
                <th className="border border-black px-2 py-1">Model / Part No</th>
                <th className="border border-black px-2 py-1">Serial No</th>
                <th className="border border-black px-2 py-1 w-16">Qty</th>
                <th className="border border-black px-2 py-1">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {(t.defective_parts_details || []).map((p, i) => (
                <tr key={i}>
                  <td className="border border-black px-2 py-1 text-center">{i + 1}</td>
                  <td className="border border-black px-2 py-1 font-mono">{p.oracle_no || "-"}</td>
                  <td className="border border-black px-2 py-1">{p.name}</td>
                  <td className="border border-black px-2 py-1">{p.model_no || "-"}</td>
                  <td className="border border-black px-2 py-1 font-mono">{p.serial || "-"}</td>
                  <td className="border border-black px-2 py-1 text-center">{p.qty}</td>
                  <td className="border border-black px-2 py-1">{p.remarks || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {t.good_parts_used && (t.good_parts_details || []).length > 0 && (
        <>
          <div className="font-bold mb-1">Good Parts Used</div>
          <table className="w-full border border-black mb-3">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-black px-2 py-1 w-8">#</th>
                <th className="border border-black px-2 py-1">Part / Item</th>
                <th className="border border-black px-2 py-1">Model / Part No</th>
                <th className="border border-black px-2 py-1">Serial No</th>
                <th className="border border-black px-2 py-1 w-16">Qty</th>
                <th className="border border-black px-2 py-1">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {(t.good_parts_details || []).map((p, i) => (
                <tr key={i}>
                  <td className="border border-black px-2 py-1 text-center">{i + 1}</td>
                  <td className="border border-black px-2 py-1">{p.name}</td>
                  <td className="border border-black px-2 py-1">{p.model_no || "-"}</td>
                  <td className="border border-black px-2 py-1 font-mono">{p.serial || "-"}</td>
                  <td className="border border-black px-2 py-1 text-center">{p.qty}</td>
                  <td className="border border-black px-2 py-1">{p.remarks || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="grid grid-cols-2 gap-8 mt-12">
        <div>
          <div className="border-t border-black pt-1 text-center">Customer Signature</div>
        </div>
        <div>
          <div className="border-t border-black pt-1 text-center">For Prokon Hi-Tech Systems</div>
        </div>
      </div>
    </div>
  );
}
