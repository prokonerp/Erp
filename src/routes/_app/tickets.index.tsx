import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDebounced } from "@/lib/sales.hooks";
import { useTicketsTable, useAssignableEngineers } from "@/hooks/useTicketsTable";
import { TableSkeleton } from "@/components/shared/skeletons";
import { PaginationFooter } from "@/components/PaginationFooter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import {
  TICKET_STATUSES,
  CALL_TYPES,
  STATUS_COLOR,
  PRIORITIES,
  waOpen,
  engineerAssignMsg,
  customerClosedMsg,
  ticketElapsedHours,
  timerBadgeColor,
  formatHours,
  statusPriority,
  isTerminalStatus,
} from "@/lib/tickets";
import {
  Plus,
  Eye,
  Trash2,
  MoreHorizontal,
  UserCog,
  MessageCircle,
  RefreshCw,
  ClipboardList,
  Search,
  Calendar,
  User,
  Zap,
  Tag,
  Building2,
  SlidersHorizontal,
  X,
  LayoutGrid,
  List,
  Clock,
  MapPin,
  Phone,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/useRole";
import { FormPageHeader } from "@/components/FormPageHeader";
import { softDelete as softDeleteRow, useRealtimeRefetch } from "@/lib/softDelete";
import { ClosingRemarksDialog } from "@/components/ClosingRemarksDialog";
import { useConfirm } from "@/hooks/useConfirm";

const PRIORITY_DOT: Record<string, string> = {
  P1: "bg-red-500",
  P2: "bg-orange-500",
  P3: "bg-amber-500",
  P4: "bg-blue-500",
  P5: "bg-zinc-300",
};

const PRIORITY_LABEL: Record<string, string> = {
  P1: "Critical",
  P2: "High",
  P3: "Medium",
  P4: "Low",
  P5: "Very Low",
};

function PrioritySelect({
  value,
  onChange,
  size = "md",
}: {
  value: string;
  onChange: (v: string) => void;
  size?: "sm" | "md";
}) {
  const p = value || "P3";
  const dotSize = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";
  const btnSize = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  return (
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-full border border-transparent ${btnSize} hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
              aria-label={`Priority ${p} - ${PRIORITY_LABEL[p]}`}
            >
              <span className={`inline-block rounded-full ${dotSize} ${PRIORITY_DOT[p]}`} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <DropdownMenuContent align="start" className="min-w-[7rem]">
          <DropdownMenuLabel className="text-xs">Set priority</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PRIORITIES.map((pr) => (
            <DropdownMenuItem key={pr} onClick={() => onChange(pr)} className="text-xs gap-2">
              <span className={`inline-block rounded-full h-2.5 w-2.5 ${PRIORITY_DOT[pr]}`} />
              {pr} <span className="text-muted-foreground">· {PRIORITY_LABEL[pr]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipContent side="top">
        <p>
          {p} - {PRIORITY_LABEL[p]}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export const Route = createFileRoute("/_app/tickets/")({
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    engineer?: string;
    status?: string;
    scope?: string;
    priority?: string;
    bucket?: string;
    oem?: string;
    parts?: string;
    ageBucket?: string;
  } => ({
    engineer: typeof s.engineer === "string" ? s.engineer : undefined,
    status: typeof s.status === "string" ? s.status : undefined,
    scope: typeof s.scope === "string" ? s.scope : undefined,
    priority: typeof s.priority === "string" ? s.priority : undefined,
    bucket: typeof s.bucket === "string" ? s.bucket : undefined,
    oem: typeof s.oem === "string" ? s.oem : undefined,
    parts: typeof s.parts === "string" ? s.parts : undefined,
    ageBucket: typeof s.ageBucket === "string" ? s.ageBucket : undefined,
  }),
  component: TicketsList,
});

type Row = {
  id: string;
  case_id: string;
  call_type: string;
  product: string | null;
  serial_no: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  customer_email: string | null;
  location: string | null;
  sector: string | null;
  complaint: string | null;
  status: string;
  priority: string | null;
  assigned_engineer_name: string | null;
  assigned_engineer_phone: string | null;
  raised_by_type: string | null;
  raised_by_name: string | null;
  created_at: string;
  closed_at?: string | null;
  oem_call?: boolean | null;
  parts_used?: boolean | null;
  parts_details?: Array<{ name?: string; confirmed?: boolean }> | null;
  defective_parts_received?: boolean | null;
  good_parts_used?: boolean | null;
  special_instruction?: string | null;
  special_instruction_acknowledged?: boolean | null;
  has_special_activity?: boolean;
};

type Employee = {
  id: string;
  name: string;
  phone: string | null;
  department: string | null;
  active: boolean;
};

function TicketsList() {
  const search = Route.useSearch();
  const { isAdmin } = useIsAdmin();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>(search.status || "all");
  const [type, setType] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [engineerFilter, setEngineerFilter] = useState<string>(search.engineer || "all");
  const [priorityFilter, setPriorityFilter] = useState<string>(search.priority || "all");
  const [scope, setScope] = useState<string>(search.scope || "all");
  const [bucket, setBucket] = useState<string>(search.bucket || "all");
  const [oemFilter, setOemFilter] = useState<string>(search.oem || "all");
  const [partsFilter, setPartsFilter] = useState<string>(search.parts || "all");
  const [ageBucket, setAgeBucket] = useState<string>(search.ageBucket || "all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const debouncedQ = useDebounced(q.trim(), 250);
  const [, setNowTick] = useState(0);
  const [view, setView] = useState<"table" | "cards">("table");
  const [closingCtx, setClosingCtx] = useState<{ r: Row; notify: boolean } | null>(null);
  const [cancellingCtx, setCancellingCtx] = useState<{ r: Row } | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  type SortKey = "created" | "timer" | "priority" | "customer";
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (k: SortKey) => {
    setSortKey((prev) => {
      if (prev === k) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(k === "created" ? "desc" : "asc");
      return k;
    });
  };

  // sync URL → state when navigating to /tickets?engineer=… from dashboard
  useEffect(() => {
    if (search.engineer !== undefined) setEngineerFilter(search.engineer || "all");
    if (search.status !== undefined) setStatus(search.status || "all");
    if (search.scope !== undefined) setScope(search.scope || "all");
    if (search.priority !== undefined) setPriorityFilter(search.priority || "all");
    if (search.bucket !== undefined) setBucket(search.bucket || "all");
    if (search.oem !== undefined) setOemFilter(search.oem || "all");
    if (search.parts !== undefined) setPartsFilter(search.parts || "all");
    if (search.ageBucket !== undefined) setAgeBucket(search.ageBucket || "all");
  }, [
    search.engineer,
    search.status,
    search.scope,
    search.priority,
    search.bucket,
    search.oem,
    search.parts,
    search.ageBucket,
  ]);

  // Tick once per minute so the timer column stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Reset paging when server filters change
  useEffect(() => {
    setPage(0);
  }, [debouncedQ, status, type]);

  const ticketsQuery = useTicketsTable({ status, type, q: debouncedQ, page, pageSize });
  const rows = useMemo(() => (ticketsQuery.data?.rows ?? []) as Row[], [ticketsQuery.data?.rows]);
  const total = ticketsQuery.data?.count ?? 0;
  const isLoading = ticketsQuery.isLoading;
  const isFetching = ticketsQuery.isFetching;
  const employeesQuery = useAssignableEngineers();
  const employees = (employeesQuery.data ?? []) as Employee[];
  const refetchTickets = useCallback(() => {
    ticketsQuery.refetch();
    employeesQuery.refetch();
  }, [ticketsQuery, employeesQuery]);
  useRealtimeRefetch("tickets", () => {
    ticketsQuery.refetch();
  });

  // Keep shim for call-sites that previously called load()
  const load = useCallback(() => {
    ticketsQuery.refetch();
  }, [ticketsQuery]);

  const cities = useMemo(
    () => Array.from(new Set(rows.map((r) => (r.location || "").trim()).filter(Boolean))).sort(),
    [rows],
  );

  const { activeRows, terminalRows } = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const inToday = (iso: string | null | undefined) => {
      if (!iso) return false;
      const d = new Date(iso);
      return d >= startOfToday && d < endOfToday;
    };
    const out = rows.filter((r) => {
      if (cityFilter !== "all" && (r.location || "").trim() !== cityFilter) return false;
      if (engineerFilter !== "all" && (r.assigned_engineer_name || "") !== engineerFilter)
        return false;
      if (priorityFilter !== "all" && (r.priority || "") !== priorityFilter) return false;
      if (oemFilter === "oem" && !r.oem_call) return false;
      if (oemFilter === "phs" && r.oem_call) return false;
      if (partsFilter === "with" && !r.defective_parts_received) return false;
      if (partsFilter === "without" && r.defective_parts_received) return false;
      if (bucket !== "all") {
        if (r.status !== "Closed" || !r.closed_at) return false;
        const h = (new Date(r.closed_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000;
        if (bucket === "lt24" && !(h < 24)) return false;
        if (bucket === "24-48" && !(h >= 24 && h < 48)) return false;
        if (bucket === "48-72" && !(h >= 48 && h < 72)) return false;
        if (bucket === "gt72" && !(h >= 72)) return false;
      }
      if (ageBucket !== "all") {
        if (r.status === "Closed" || r.status === "Cancelled") return false;
        const h = (Date.now() - new Date(r.created_at).getTime()) / 3_600_000;
        if (ageBucket === "lt24" && !(h < 24)) return false;
        if (ageBucket === "24-48" && !(h >= 24 && h < 48)) return false;
        if (ageBucket === "48-72" && !(h >= 48 && h < 72)) return false;
        if (ageBucket === "gt72" && !(h >= 72)) return false;
      }
      if (scope === "today") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const at = (r as any).assigned_at || r.created_at;
        if (!inToday(at)) return false;
      } else if (scope === "carry") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const at = (r as any).assigned_at || r.created_at;
        if (inToday(at) || !at) return false;
        if (r.status === "Closed") return false;
      } else if (scope === "active") {
        if (r.status === "Closed" || r.status === "Cancelled") return false;
      } else if (scope === "closedToday") {
        if (r.status !== "Closed") return false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!inToday((r as any).closed_at)) return false;
      } else if (scope === "highPriority") {
        if (r.status === "Closed" || r.status === "Cancelled") return false;
        if (r.priority !== "P1" && r.priority !== "P2") return false;
      } else if (scope === "overdue") {
        if (r.status === "Closed" || r.status === "Cancelled") return false;
        if (ticketElapsedHours(r) <= 24) return false;
      }
      if (dateRange?.from) {
        const from = new Date(dateRange.from);
        from.setHours(0, 0, 0, 0);
        const to = dateRange.to ? new Date(dateRange.to) : new Date(dateRange.from);
        to.setHours(23, 59, 59, 999);
        const t = new Date(r.created_at).getTime();
        if (t < from.getTime() || t > to.getTime()) return false;
      }
      if (!q.trim()) return true;
      const s = q.toLowerCase();
      return (
        r.case_id.toLowerCase().includes(s) ||
        r.customer_name.toLowerCase().includes(s) ||
        (r.customer_phone || "").toLowerCase().includes(s) ||
        (r.product || "").toLowerCase().includes(s) ||
        (r.serial_no || "").toLowerCase().includes(s) ||
        (r.location || "").toLowerCase().includes(s) ||
        (r.sector || "").toLowerCase().includes(s)
      );
    });
    // Secondary sort key applied WITHIN each status_priority group.
    const priorityWeight: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
    const cmpVal = (r: Row): number | string => {
      switch (sortKey) {
        case "timer":
          return ticketElapsedHours(r);
        case "priority":
          return priorityWeight[r.priority || "P3"] ?? 99;
        case "customer":
          return (r.customer_name || "").toLowerCase();
        case "created":
        default:
          return new Date(r.created_at).getTime();
      }
    };
    const secondary = (a: Row, b: Row) => {
      const av = cmpVal(a);
      const bv = cmpVal(b);
      let c = 0;
      if (typeof av === "number" && typeof bv === "number") c = av - bv;
      else c = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? c : -c;
    };
    // Primary sort: status_priority ASC — ALWAYS. Terminal never sits above active.
    const sorted = out.sort((a, b) => {
      const pa = statusPriority(a.status);
      const pb = statusPriority(b.status);
      if (pa !== pb) return pa - pb;
      return secondary(a, b);
    });
    const active: Row[] = [];
    const terminal: Row[] = [];
    for (const r of sorted) (isTerminalStatus(r.status) ? terminal : active).push(r);
    return { activeRows: active, terminalRows: terminal };
  }, [
    rows,
    q,
    cityFilter,
    engineerFilter,
    priorityFilter,
    scope,
    bucket,
    oemFilter,
    partsFilter,
    ageBucket,
    dateRange,
    sortKey,
    sortDir,
  ]);

  // When the user explicitly filters by a terminal status, show only that group
  // normally — the "sink terminal to bottom" rule only kicks in for mixed views.
  const explicitTerminalFilter = status === "Closed" || status === "Cancelled";
  const activeCount = activeRows.length;
  const terminalCount = terminalRows.length;
  const showTerminalGroup = explicitTerminalFilter || showTerminal;
  const filtered = useMemo(
    () => (showTerminalGroup ? [...activeRows, ...terminalRows] : activeRows),
    [activeRows, terminalRows, showTerminalGroup],
  );

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className="inline-flex items-center gap-0.5 hover:text-foreground"
    >
      {label}
      {sortKey === k &&
        (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );

  const setPriority = async (id: string, p: string) => {
    const { error } = await supabase
      .from("tickets")
      .update({ priority: p } as never)
      .eq("id", id);
    if (error) return toast.error(error.message);
    // Trigger refetch so priority is reflected after server pagination cache
    ticketsQuery.refetch();
  };

  const launchTicketWhatsApp = async (
    r: Row,
    phone: string | null | undefined,
    message: string,
    recipientLabel: string,
  ) => {
    const ok = await waOpen(phone, message, {
      module: "ticket",
      recordId: r.id,
      recordNumber: r.case_id,
      recipientLabel,
      preferWeb: true,
    });
    if (!ok) return toast.error(`${recipientLabel} phone invalid`);
    toast.success("Opening WhatsApp Web…");
  };

  const updateStatus = async (r: Row, next: string, opts: { notify?: boolean } = {}) => {
    if (next === "Closed") {
      setClosingCtx({ r, notify: !!opts.notify });
      return;
    }
    if (next === "Cancelled") {
      setCancellingCtx({ r });
      return;
    }
    const patch: Record<string, unknown> = { status: next };
    const { error } = await supabase
      .from("tickets")
      .update(patch as never)
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    await supabase.from("ticket_activities").insert({
      ticket_id: r.id,
      kind: "status",
      from_status: r.status,
      to_status: next,
      notes: `Status changed: ${r.status} → ${next}`,
    } as never);
    toast.success(`Status updated to ${next}`);
    if (opts.notify && r.customer_phone) {
      await launchTicketWhatsApp(
        r,
        r.customer_phone,
        customerClosedMsg({
          case_id: r.case_id,
          customer_name: r.customer_name,
          product: r.product,
        }),
        "Customer",
      );
    }
    load();
  };

  const confirmClose = async (remarks: string): Promise<boolean> => {
    if (!closingCtx) return false;
    const { r, notify } = closingCtx;
    const { data: u } = await supabase.auth.getUser();
    const actorName =
      (u.user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name ||
      (u.user?.user_metadata as { full_name?: string; name?: string } | null)?.name ||
      u.user?.email ||
      "User";
    const ts = new Date().toLocaleString();
    const noteBody = `Closing Remarks by ${actorName} at ${ts}:\n${remarks}`;
    // 1) Save the note first so remarks are persisted before status change.
    const { error: noteErr } = await supabase.from("ticket_activities").insert({
      ticket_id: r.id,
      kind: "note",
      notes: noteBody,
      actor: u.user?.id ?? null,
    } as never);
    if (noteErr) {
      toast.error(`Could not save remarks: ${noteErr.message}`);
      return false;
    }
    // 2) Update the ticket status only after the note is stored.
    const { error: upErr } = await supabase
      .from("tickets")
      .update({
        status: "Closed",
        closed_at: new Date().toISOString(),
      } as never)
      .eq("id", r.id);
    if (upErr) {
      toast.error(`Remarks saved, but closing failed: ${upErr.message}`);
      return false;
    }
    await supabase.from("ticket_activities").insert({
      ticket_id: r.id,
      kind: "status",
      from_status: r.status,
      to_status: "Closed",
      notes: `Status changed: ${r.status} → Closed`,
      actor: u.user?.id ?? null,
    } as never);
    toast.success("Ticket closed");
    if (notify && r.customer_phone) {
      await launchTicketWhatsApp(
        r,
        r.customer_phone,
        customerClosedMsg({
          case_id: r.case_id,
          customer_name: r.customer_name,
          product: r.product,
        }),
        "Customer",
      );
    }
    load();
    return true;
  };

  const confirmCancel = async (remarks: string): Promise<boolean> => {
    if (!cancellingCtx) return false;
    const { r } = cancellingCtx;
    const { data: u } = await supabase.auth.getUser();
    const actorName =
      (u.user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name ||
      (u.user?.user_metadata as { full_name?: string; name?: string } | null)?.name ||
      u.user?.email ||
      "User";
    const ts = new Date().toLocaleString();
    const noteBody = `Cancellation Reason by ${actorName} at ${ts}:\n${remarks}`;
    // 1) Save the cancellation reason note before changing status.
    const { error: noteErr } = await supabase.from("ticket_activities").insert({
      ticket_id: r.id,
      kind: "note",
      notes: noteBody,
      actor: u.user?.id ?? null,
    } as never);
    if (noteErr) {
      toast.error(`Could not save cancellation reason: ${noteErr.message}`);
      return false;
    }
    // 2) Update the ticket status only after the note is stored.
    const { error: upErr } = await supabase
      .from("tickets")
      .update({
        status: "Cancelled",
      } as never)
      .eq("id", r.id);
    if (upErr) {
      toast.error(`Cancellation reason saved, but cancelling failed: ${upErr.message}`);
      return false;
    }
    await supabase.from("ticket_activities").insert({
      ticket_id: r.id,
      kind: "status",
      from_status: r.status,
      to_status: "Cancelled",
      notes: `Status changed: ${r.status} → Cancelled`,
      actor: u.user?.id ?? null,
    } as never);
    toast.success("Ticket cancelled");
    setCancellingCtx(null);
    load();
    return true;
  };

  const softDelete = async (r: Row) => {
    const { error } = await softDeleteRow("tickets", r.id);
    if (error) return toast.error(error.message);
    toast.success(`Ticket ${r.case_id} moved to Archive`);
    load();
  };

  const reassign = async (r: Row, emp: Employee) => {
    const { error } = await supabase
      .from("tickets")
      .update({
        assigned_engineer_name: emp.name,
        assigned_engineer_phone: emp.phone,
        assigned_at: new Date().toISOString(),
      } as never)
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success(`Assigned to ${emp.name}`);
    if (emp.phone) {
      await launchTicketWhatsApp(
        r,
        emp.phone,
        engineerAssignMsg({
          case_id: r.case_id,
          call_type: r.call_type,
          customer_name: r.customer_name,
          customer_phone: r.customer_phone,
          location: r.location,
          customer_address: r.customer_address,
          product: r.product,
          serial_no: r.serial_no,
          complaint: r.complaint,
        }),
        "Engineer",
      );
    }
    load();
  };

  const notifyCustomer = async (r: Row) => {
    await launchTicketWhatsApp(
      r,
      r.customer_phone,
      customerClosedMsg({ case_id: r.case_id, customer_name: r.customer_name, product: r.product }),
      "Customer",
    );
  };

  const notifyEngineer = async (r: Row) => {
    if (!r.assigned_engineer_phone) return toast.error("No engineer assigned");
    await launchTicketWhatsApp(
      r,
      r.assigned_engineer_phone,
      engineerAssignMsg({
        case_id: r.case_id,
        call_type: r.call_type,
        customer_name: r.customer_name,
        customer_phone: r.customer_phone,
        location: r.location,
        customer_address: r.customer_address,
        product: r.product,
        serial_no: r.serial_no,
        complaint: r.complaint,
      }),
      "Engineer",
    );
  };

  return (
    <div className="space-y-4">
      <FormPageHeader
        title="Service Tickets"
        subtitle="OEM-tagged tickets are highlighted; create Indent from OEM tickets"
      />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle>All Tickets</CardTitle>
          <div className="flex items-center gap-2">
            <ExportButtons
              name="Prokon_Tickets"
              title="Service Tickets"
              rows={filtered}
              columns={[
                { header: "Case ID", get: (r) => r.case_id },
                { header: "Type", get: (r) => r.call_type },
                { header: "Tag", get: (r) => (r.oem_call ? "OEM" : "PHS") },
                { header: "Priority", get: (r) => r.priority || "" },
                { header: "Customer", get: (r) => r.customer_name },
                { header: "Phone", get: (r) => r.customer_phone || "" },
                { header: "Model", get: (r) => r.product || "" },
                { header: "Serial", get: (r) => r.serial_no || "" },
                { header: "Sector/Colony", get: (r) => r.sector || "" },
                { header: "City/Area", get: (r) => r.location || "" },
                { header: "Engineer", get: (r) => r.assigned_engineer_name || "" },
                {
                  header: "Raised By",
                  get: (r) =>
                    r.raised_by_name || (r.raised_by_type === "external" ? "Customer" : ""),
                },
                { header: "Status", get: (r) => r.status },
                { header: "Created", get: (r) => new Date(r.created_at).toLocaleString() },
              ]}
            />
            <Link to="/tickets/new">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                New Ticket
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search case, customer, serial…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={dateRange?.from ? "default" : "outline"}
                  className="h-9 gap-1.5"
                >
                  <Calendar className="h-3.5 w-3.5" />
                  {dateRange?.from
                    ? dateRange.to
                      ? `${format(dateRange.from, "dd MMM")} – ${format(dateRange.to, "dd MMM")}`
                      : format(dateRange.from, "dd MMM yyyy")
                    : "Calendar"}
                  {dateRange?.from && (
                    <X
                      className="h-3 w-3 ml-1 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDateRange(undefined);
                      }}
                    />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0 pointer-events-auto">
                <CalendarUI
                  mode="range"
                  numberOfMonths={2}
                  selected={dateRange}
                  onSelect={setDateRange}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
                <div className="flex justify-end gap-2 border-t p-2">
                  <Button size="sm" variant="ghost" onClick={() => setDateRange(undefined)}>
                    Clear
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <FilterChip
              icon={<User className="h-3.5 w-3.5" />}
              label="Engineer"
              value={engineerFilter !== "all" ? engineerFilter : ""}
              active={engineerFilter !== "all"}
              onClear={() => setEngineerFilter("all")}
            >
              <ChipMenu
                searchable
                options={[
                  { v: "all", l: "All engineers" },
                  ...employees.map((e) => ({ v: e.name, l: e.name })),
                ]}
                value={engineerFilter}
                onChange={setEngineerFilter}
              />
            </FilterChip>
            <FilterChip
              icon={<Tag className="h-3.5 w-3.5" />}
              label="Status"
              value={status !== "all" ? status : ""}
              active={status !== "all"}
              onClear={() => setStatus("all")}
            >
              <ChipMenu
                options={[
                  { v: "all", l: "All statuses" },
                  ...TICKET_STATUSES.map((s) => ({ v: s, l: s })),
                ]}
                value={status}
                onChange={setStatus}
              />
            </FilterChip>
            <FilterChip
              icon={<ClipboardList className="h-3.5 w-3.5" />}
              label="Type"
              value={type !== "all" ? type : ""}
              active={type !== "all"}
              onClear={() => setType("all")}
            >
              <ChipMenu
                searchable
                options={[{ v: "all", l: "All types" }, ...CALL_TYPES.map((s) => ({ v: s, l: s }))]}
                value={type}
                onChange={setType}
              />
            </FilterChip>
            <FilterChip
              icon={<Zap className="h-3.5 w-3.5" />}
              label="Priority"
              value={priorityFilter !== "all" ? priorityFilter : ""}
              active={priorityFilter !== "all"}
              onClear={() => setPriorityFilter("all")}
            >
              <ChipMenu
                options={[
                  { v: "all", l: "All priorities" },
                  ...PRIORITIES.map((p) => ({ v: p, l: p })),
                ]}
                value={priorityFilter}
                onChange={setPriorityFilter}
              />
            </FilterChip>
            <FilterChip
              icon={<Building2 className="h-3.5 w-3.5" />}
              label="City"
              value={cityFilter !== "all" ? cityFilter : ""}
              active={cityFilter !== "all"}
              onClear={() => setCityFilter("all")}
            >
              <ChipMenu
                searchable
                options={[{ v: "all", l: "All cities" }, ...cities.map((c) => ({ v: c, l: c }))]}
                value={cityFilter}
                onChange={setCityFilter}
              />
            </FilterChip>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  More
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-3">
                <MoreField
                  label="OEM / PHS"
                  value={oemFilter}
                  onChange={setOemFilter}
                  options={[
                    { v: "all", l: "All" },
                    { v: "oem", l: "OEM only" },
                    { v: "phs", l: "PHS only" },
                  ]}
                />
                <MoreField
                  label="Parts"
                  value={partsFilter}
                  onChange={setPartsFilter}
                  options={[
                    { v: "all", l: "All" },
                    { v: "with", l: "With parts" },
                    { v: "without", l: "Without parts" },
                  ]}
                />
                <MoreField
                  label="Execution bucket"
                  value={bucket}
                  onChange={setBucket}
                  options={[
                    { v: "all", l: "All" },
                    { v: "lt24", l: "< 24h" },
                    { v: "24-48", l: "24–48h" },
                    { v: "48-72", l: "48–72h" },
                    { v: "gt72", l: "> 72h" },
                  ]}
                />
                <MoreField
                  label="Open age"
                  value={ageBucket}
                  onChange={setAgeBucket}
                  options={[
                    { v: "all", l: "All" },
                    { v: "lt24", l: "< 24h" },
                    { v: "24-48", l: "24–48h" },
                    { v: "48-72", l: "48–72h" },
                    { v: "gt72", l: "> 72h" },
                  ]}
                />
              </PopoverContent>
            </Popover>
            <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5 bg-muted/40">
              <Button
                size="sm"
                variant={view === "table" ? "default" : "ghost"}
                className="h-7 w-7 p-0"
                onClick={() => setView("table")}
                title="Table view"
              >
                <List className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant={view === "cards" ? "default" : "ghost"}
                className="h-7 w-7 p-0"
                onClick={() => setView("cards")}
                title="Card view"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {(engineerFilter !== "all" ||
            priorityFilter !== "all" ||
            scope !== "all" ||
            bucket !== "all" ||
            oemFilter !== "all" ||
            partsFilter !== "all" ||
            status !== "all" ||
            type !== "all" ||
            cityFilter !== "all" ||
            ageBucket !== "all" ||
            dateRange?.from) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Active:</span>
              {status !== "all" && (
                <ActiveChip label={`Status: ${status}`} onClear={() => setStatus("all")} />
              )}
              {scope !== "all" && (
                <ActiveChip label={`Date: ${scopeLabel(scope)}`} onClear={() => setScope("all")} />
              )}
              {dateRange?.from && (
                <ActiveChip
                  label={`Range: ${format(dateRange.from, "dd MMM")}${dateRange.to ? ` – ${format(dateRange.to, "dd MMM")}` : ""}`}
                  onClear={() => setDateRange(undefined)}
                />
              )}
              {engineerFilter !== "all" && (
                <ActiveChip
                  label={`Engineer: ${engineerFilter}`}
                  onClear={() => setEngineerFilter("all")}
                />
              )}
              {priorityFilter !== "all" && (
                <ActiveChip
                  label={`Priority: ${priorityFilter}`}
                  onClear={() => setPriorityFilter("all")}
                />
              )}
              {cityFilter !== "all" && (
                <ActiveChip label={`City: ${cityFilter}`} onClear={() => setCityFilter("all")} />
              )}
              {type !== "all" && (
                <ActiveChip label={`Type: ${type}`} onClear={() => setType("all")} />
              )}
              {oemFilter !== "all" && (
                <ActiveChip
                  label={oemFilter === "oem" ? "OEM only" : "PHS only"}
                  onClear={() => setOemFilter("all")}
                />
              )}
              {partsFilter !== "all" && (
                <ActiveChip
                  label={partsFilter === "with" ? "With parts" : "Without parts"}
                  onClear={() => setPartsFilter("all")}
                />
              )}
              {bucket !== "all" && (
                <ActiveChip
                  label={`Exec: ${({ lt24: "<24h", "24-48": "24–48h", "48-72": "48–72h", gt72: ">72h" } as Record<string, string>)[bucket]}`}
                  onClear={() => setBucket("all")}
                />
              )}
              {ageBucket !== "all" && (
                <ActiveChip
                  label={`Age: ${({ lt24: "<24h", "24-48": "24–48h", "48-72": "48–72h", gt72: ">72h" } as Record<string, string>)[ageBucket]}`}
                  onClear={() => setAgeBucket("all")}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setEngineerFilter("all");
                  setPriorityFilter("all");
                  setScope("all");
                  setBucket("all");
                  setOemFilter("all");
                  setPartsFilter("all");
                  setStatus("all");
                  setType("all");
                  setCityFilter("all");
                  setAgeBucket("all");
                  setDateRange(undefined);
                }}
              >
                Clear all
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 font-medium">
              Active <span className="font-semibold">({activeCount})</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 text-zinc-700 border border-zinc-200 px-2 py-0.5 font-medium">
              Closed / Cancelled <span className="font-semibold">({terminalCount})</span>
            </span>
            {!explicitTerminalFilter && (
              <label className="ml-auto inline-flex items-center gap-2 text-muted-foreground">
                <Switch checked={showTerminal} onCheckedChange={setShowTerminal} />
                <span>Show Closed / Cancelled</span>
              </label>
            )}
          </div>

          {view === "cards" ? (
            isLoading ? (
              <TableSkeleton rows={8} />
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground border rounded-md">
                No tickets match your filters.
              </div>
            ) : (
              <div className="space-y-4">
                {activeRows.length > 0 && (
                  <div>
                    {showTerminalGroup && terminalRows.length > 0 && (
                      <SectionDivider
                        label={`Active Tickets · ${activeRows.length}`}
                        tone="active"
                      />
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {activeRows.map((r) => (
                        <TicketCard
                          key={r.id}
                          r={r}
                          employees={employees}
                          isAdmin={isAdmin}
                          onReassign={reassign}
                          onStatusChange={updateStatus}
                          onNotifyCustomer={notifyCustomer}
                          onNotifyEngineer={notifyEngineer}
                          onSoftDelete={softDelete}
                          onPriority={setPriority}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {showTerminalGroup && terminalRows.length > 0 && (
                  <div>
                    <SectionDivider
                      label={`Closed / Cancelled · ${terminalRows.length}`}
                      tone="terminal"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 opacity-80">
                      {terminalRows.map((r) => (
                        <TicketCard
                          key={r.id}
                          r={r}
                          employees={employees}
                          isAdmin={isAdmin}
                          onReassign={reassign}
                          onStatusChange={updateStatus}
                          onNotifyCustomer={notifyCustomer}
                          onNotifyEngineer={notifyEngineer}
                          onSoftDelete={softDelete}
                          onPriority={setPriority}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            <TooltipProvider delayDuration={200}>
              <div className="overflow-auto border rounded-md max-h-[60vh] overscroll-contain">
                {isLoading ? (
                  <TableSkeleton rows={6} />
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0 z-10">
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="p-2">Case ID</th>
                        <th className="p-2 w-14 text-center">Tag</th>
                        <th className="p-2 w-10 text-center">
                          <SortBtn k="priority" label="Pr." />
                        </th>
                        <th className="p-2 w-20">
                          <SortBtn k="timer" label="Timer" />
                        </th>
                        <th className="p-2">
                          <SortBtn k="customer" label="Customer" />
                        </th>
                        <th className="p-2">Model / Serial</th>
                        <th className="p-2">Sector · City</th>
                        <th className="p-2 max-w-[180px]">Complaint</th>
                        <th className="p-2">Engineer</th>
                        <th className="p-2">Raised By</th>
                        <th className="p-2">Status</th>
                        <th className="p-2 w-12 text-center">·</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="p-4 text-muted-foreground">
                            No tickets.
                          </td>
                        </tr>
                      ) : (
                        <>
                          {activeRows.length > 0 &&
                            showTerminalGroup &&
                            terminalRows.length > 0 && (
                              <tr className="bg-emerald-50/60">
                                <td
                                  colSpan={12}
                                  className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-800"
                                >
                                  — Active Tickets · {activeRows.length} —
                                </td>
                              </tr>
                            )}
                          {activeRows.map((r) => renderTicketRow(r))}
                          {showTerminalGroup && terminalRows.length > 0 && (
                            <>
                              <tr className="bg-zinc-100">
                                <td
                                  colSpan={12}
                                  className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-700"
                                >
                                  — Closed / Cancelled · {terminalRows.length} —
                                </td>
                              </tr>
                              {terminalRows.map((r) => renderTicketRow(r, true))}
                            </>
                          )}
                        </>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              {!isLoading && (
                <PaginationFooter
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  onPage={setPage}
                  isFetching={isFetching && !isLoading}
                />
              )}
              {isFetching && !isLoading && (
                <div className="px-3 py-1 text-xs text-muted-foreground">Updating…</div>
              )}
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
      <ClosingRemarksDialog
        open={!!closingCtx}
        onOpenChange={(v) => {
          if (!v) setClosingCtx(null);
        }}
        caseId={closingCtx?.r.case_id}
        onConfirm={confirmClose}
      />
      <ClosingRemarksDialog
        open={!!cancellingCtx}
        onOpenChange={(v) => {
          if (!v) setCancellingCtx(null);
        }}
        caseId={cancellingCtx?.r.case_id}
        title="Cancellation Reason"
        actionLabel="Save & Cancel Ticket"
        description="Remarks are required to cancel this ticket. They will be added to the ticket's Notes with your name and timestamp."
        placeholder="Describe the reason for cancellation…"
        onConfirm={confirmCancel}
      />
    </div>
  );

  function renderTicketRow(r: Row, dim = false) {
    return (
      <tr key={r.id} className="border-t align-top hover:bg-muted/30">
        <td className="p-2 font-mono text-xs whitespace-nowrap">
          {(r.has_special_activity || (r.special_instruction && r.special_instruction.trim())) &&
            (r.special_instruction_acknowledged ? (
              <div
                className="mb-1 inline-flex items-center gap-1 rounded border border-green-400 bg-green-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-green-800"
                title="Special instruction acknowledged"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Special · Ack
              </div>
            ) : (
              <div
                className="mb-1 inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-700 animate-pulse"
                title={r.special_instruction || "Special instruction tagged in activity log"}
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Special
              </div>
            ))}
          <div className="font-semibold text-foreground">{r.case_id}</div>
          <div className="text-[10px] text-muted-foreground leading-tight">{r.call_type}</div>
        </td>
        <td className="p-2 text-center">
          {r.oem_call ? (
            <Badge className="bg-purple-100 text-purple-800" variant="secondary">
              OEM
            </Badge>
          ) : (
            <Badge variant="outline">PHS</Badge>
          )}
        </td>
        <td className="p-2 text-center">
          <PrioritySelect value={r.priority || "P3"} onChange={(v) => setPriority(r.id, v)} />
        </td>
        <td className="p-2">
          {(() => {
            const h = ticketElapsedHours(r);
            return (
              <span
                className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${timerBadgeColor(h)}`}
                title={`${h.toFixed(2)}h since creation (excl. Sundays)`}
              >
                {formatHours(h)}
              </span>
            );
          })()}
        </td>
        <td className="p-2">
          <div className="text-sm font-semibold text-foreground leading-tight">
            {r.customer_name}
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight font-mono">
            {r.customer_phone || "—"}
          </div>
        </td>
        <td className="p-2">
          <div className="text-sm font-semibold text-foreground leading-tight">
            {r.product || "—"}
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight font-mono">
            {r.serial_no || "—"}
          </div>
        </td>
        <td className="p-2 max-w-[140px]">
          <div className="text-sm leading-tight break-words whitespace-normal">
            {r.sector || "—"}
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight">{r.location || "—"}</div>
        </td>
        <td className="p-2 max-w-[180px] break-words whitespace-normal text-xs">
          {r.complaint || "—"}
        </td>
        <td className="p-2 text-xs whitespace-nowrap">
          {r.assigned_engineer_name || <span className="text-muted-foreground">Unassigned</span>}
        </td>
        <td className="p-2 text-xs">
          {r.raised_by_type === "external" ? (
            <Badge variant="outline">Customer</Badge>
          ) : (
            <span className="text-muted-foreground">{r.raised_by_name || "—"}</span>
          )}
        </td>
        <td className="p-2">
          <Badge
            className={STATUS_COLOR[r.status] || "bg-zinc-100 text-zinc-700"}
            variant="secondary"
          >
            {r.status}
          </Badge>
        </td>
        <td className="p-2 text-center">
          <RowActions
            r={r}
            employees={employees}
            isAdmin={isAdmin}
            onReassign={reassign}
            onStatusChange={updateStatus}
            onNotifyCustomer={notifyCustomer}
            onNotifyEngineer={notifyEngineer}
            onSoftDelete={softDelete}
          />
        </td>
      </tr>
    );
  }
}

function SectionDivider({ label, tone }: { label: string; tone: "active" | "terminal" }) {
  const cls =
    tone === "active"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : "bg-zinc-100 text-zinc-700 border-zinc-200";
  return (
    <div
      className={`mb-2 rounded border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${cls}`}
    >
      — {label} —
    </div>
  );
}

function RowActions({
  r,
  employees,
  isAdmin,
  onReassign,
  onStatusChange,
  onNotifyCustomer,
  onNotifyEngineer,
  onSoftDelete,
}: {
  r: Row;
  employees: Employee[];
  isAdmin: boolean;
  onReassign: (r: Row, e: Employee) => void;
  onStatusChange: (r: Row, next: string, opts?: { notify?: boolean }) => void;
  onNotifyCustomer: (r: Row) => void;
  onNotifyEngineer: (r: Row) => void;
  onSoftDelete: (r: Row) => void;
}) {
  const confirm = useConfirm();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" title="Actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs">Ticket actions</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/tickets/$id" params={{ id: r.id }}>
            <Eye className="h-4 w-4 mr-2" />
            View / Edit
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {(() => {
          const defOn = !!r.defective_parts_received;
          const goodOn = !!r.good_parts_used;
          const canIndent = !!r.oem_call && (defOn || goodOn);
          const title = !r.oem_call
            ? "Enable OEM Call on the ticket to create an Indent"
            : !(defOn || goodOn)
              ? "Enable Defective Parts Received or Good Parts Used on the ticket to create an Indent"
              : "Create Indent from this OEM ticket";
          return (
            <DropdownMenuItem asChild disabled={!canIndent}>
              <Link to="/indent/new" search={{ ticket_id: r.id }} title={title}>
                <ClipboardList className="h-4 w-4 mr-2" />
                Create Indent
              </Link>
            </DropdownMenuItem>
          );
        })()}

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <UserCog className="h-4 w-4 mr-2" />
            Reassign Engineer
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="max-h-72 overflow-auto w-56">
              {employees.length === 0 && <DropdownMenuItem disabled>No employees</DropdownMenuItem>}
              {employees.map((e) => (
                <DropdownMenuItem key={e.id} onClick={() => onReassign(r, e)}>
                  <div className="flex flex-col">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {[e.department, e.phone].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <RefreshCw className="h-4 w-4 mr-2" />
            Update Status
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-48">
              {TICKET_STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s}
                  disabled={s === r.status}
                  onClick={() => onStatusChange(r, s)}
                >
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled={!r.assigned_engineer_phone} onClick={() => onNotifyEngineer(r)}>
          <MessageCircle className="h-4 w-4 mr-2" />
          Notify Engineer
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!r.customer_phone} onClick={() => onNotifyCustomer(r)}>
          <MessageCircle className="h-4 w-4 mr-2" />
          Notify Customer
        </DropdownMenuItem>

        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete ticket ${r.case_id}?`,
                  description:
                    "This hides the ticket from listings (soft delete). An admin can restore it from the Archive for 30 days.",
                  confirmLabel: "Delete",
                  variant: "danger",
                });
                if (ok) onSoftDelete(r);
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function scopeLabel(s: string) {
  return (
    (
      {
        today: "Today",
        carry: "Carry-over",
        active: "Active",
        closedToday: "Closed today",
        overdue: "Overdue",
        highPriority: "High priority",
      } as Record<string, string>
    )[s] || s
  );
}

function FilterChip({
  icon,
  label,
  value,
  active,
  onClear,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  active: boolean;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 h-9 rounded-md border px-2.5 text-xs font-medium transition hover:bg-accent ${active ? "border-primary bg-primary/10 text-primary" : "border-input bg-background text-foreground"}`}
        >
          <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
          <span>{label}</span>
          {value && <span className="max-w-[100px] truncate opacity-90">· {value}</span>}
          {active && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="ml-0.5 -mr-1 rounded p-0.5 hover:bg-primary/20"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function ChipMenu({
  options,
  value,
  onChange,
  searchable,
}: {
  options: { v: string; l: string }[];
  value: string;
  onChange: (v: string) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = searchable
    ? options.filter((o) => o.l.toLowerCase().includes(q.toLowerCase()))
    : options;
  return (
    <div className="space-y-1">
      {searchable && (
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 text-xs"
        />
      )}
      <div className="max-h-64 overflow-auto">
        {filtered.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent ${value === o.v ? "bg-primary/10 font-semibold text-primary" : ""}`}
          >
            {o.l}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground text-center">No matches</div>
        )}
      </div>
    </div>
  );
}

function MoreField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div>
      <div className="text-xs font-medium mb-1">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.v} value={o.v}>
              {o.l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Badge
      variant="secondary"
      className="gap-1 pl-2 pr-1 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium"
    >
      {label}
      <button onClick={onClear} className="rounded-full p-0.5 hover:bg-primary/20">
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

function TicketCard({
  r,
  employees,
  isAdmin,
  onReassign,
  onStatusChange,
  onNotifyCustomer,
  onNotifyEngineer,
  onSoftDelete,
  onPriority,
}: {
  r: Row;
  employees: Employee[];
  isAdmin: boolean;
  onReassign: (r: Row, e: Employee) => void;
  onStatusChange: (r: Row, next: string, opts?: { notify?: boolean }) => void;
  onNotifyCustomer: (r: Row) => void;
  onNotifyEngineer: (r: Row) => void;
  onSoftDelete: (r: Row) => void;
  onPriority: (id: string, p: string) => void;
}) {
  const hours = ticketElapsedHours(r);
  const isOverdue = hours > 24 && r.status !== "Closed" && r.status !== "Cancelled";
  return (
    <div className="group relative flex flex-col rounded-lg border bg-card p-3 shadow-sm hover:shadow-md hover:border-primary/40 transition">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <Link
            to="/tickets/$id"
            params={{ id: r.id }}
            className="font-mono text-xs font-semibold text-primary hover:underline truncate block"
          >
            {r.case_id}
          </Link>
          <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
            <span>{r.call_type}</span>
            {r.oem_call ? (
              <Badge
                className="bg-purple-100 text-purple-800 px-1 py-0 text-[9px]"
                variant="secondary"
              >
                OEM
              </Badge>
            ) : (
              <Badge variant="outline" className="px-1 py-0 text-[9px]">
                PHS
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <PrioritySelect
            value={r.priority || "P3"}
            onChange={(v) => onPriority(r.id, v)}
            size="sm"
          />
          <RowActions
            r={r}
            employees={employees}
            isAdmin={isAdmin}
            onReassign={onReassign}
            onStatusChange={onStatusChange}
            onNotifyCustomer={onNotifyCustomer}
            onNotifyEngineer={onNotifyEngineer}
            onSoftDelete={onSoftDelete}
          />
        </div>
      </div>

      <div className="text-sm font-semibold leading-tight truncate">{r.customer_name}</div>
      <div className="text-[11px] text-muted-foreground truncate">
        {r.product || "—"}
        {r.serial_no ? ` · ${r.serial_no}` : ""}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
        <div className="flex items-center gap-1 min-w-0 text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{r.location || "—"}</span>
        </div>
        <div className="flex items-center gap-1 min-w-0 text-muted-foreground">
          <Phone className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono">{r.customer_phone || "—"}</span>
        </div>
        <div className="flex items-center gap-1 min-w-0 text-muted-foreground col-span-2">
          <User className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {r.assigned_engineer_name || <span className="italic">Unassigned</span>}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 pt-2 border-t">
        <Badge
          className={`${STATUS_COLOR[r.status] || "bg-zinc-100 text-zinc-700"} text-[10px]`}
          variant="secondary"
        >
          {r.status}
        </Badge>
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${timerBadgeColor(hours)}`}
          title={`${hours.toFixed(1)}h since creation`}
        >
          <Clock className="h-2.5 w-2.5" />
          {formatHours(hours)}
          {isOverdue && <AlertTriangle className="h-2.5 w-2.5 ml-0.5" />}
        </span>
      </div>
    </div>
  );
}
