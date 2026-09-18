import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pageRange } from "@/lib/sales.hooks";
import { attachLoginFlags, sortEngineersLoginFirst } from "@/lib/eng-queue-utils";

export type TicketTableRow = {
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
  assigned_at?: string | null;
  raised_by_type: string | null;
  raised_by_name: string | null;
  created_at: string;
  closed_at?: string | null;
  oem_call?: boolean | null;
  oem_ref_id?: string | null;
  oem_brand?: string | null;
  oem_purchase_date?: string | null;
  parts_used?: boolean | null;
  defective_parts_received?: boolean | null;
  good_parts_used?: boolean | null;
  special_instruction?: string | null;
  special_instruction_acknowledged?: boolean | null;
  has_special_activity?: boolean;
  good_parts_details?: unknown;
  defective_parts_details?: unknown;
};

const TICKET_LIST_COLS =
  "id,case_id,status,priority,customer_name,customer_id,serial_no,created_at,assigned_engineer_name,good_parts_details,defective_parts_details,call_type,product,customer_phone,customer_address,customer_email,location,sector,complaint,assigned_engineer_phone,raised_by_type,raised_by_name,oem_call,oem_ref_id,oem_brand,oem_purchase_date,parts_used,defective_parts_received,good_parts_used,special_instruction,special_instruction_acknowledged,closed_at,assigned_at";

/** Max rows a single export may pull. The UI toasts explicitly when the cap bites. */
export const TICKETS_EXPORT_CAP = 2000;

const HOUR_MS = 3_600_000;
const TERMINAL_IN = '("Closed","Cancelled")';

export type TicketTableFilters = {
  status: string;
  type: string;
  q: string;
  page: number;
  pageSize: number;
  /** "open" = active statuses, "closed" = Closed + Cancelled, "all" = no filter */
  tab?: "open" | "closed" | "all";
  engineer?: string;
  priority?: string;
  city?: string;
  scope?: string;
  bucket?: string;
  oem?: string;
  parts?: string;
  ageBucket?: string;
  /** ISO bounds; callers pass local-midnight day edges (matches prior client logic). */
  dateFrom?: string | null;
  dateTo?: string | null;
};

type ResolvedTicketFilters = {
  status: string;
  type: string;
  term: string;
  tab: "open" | "closed" | "all";
  engineer: string;
  priority: string;
  city: string;
  scope: string;
  bucket: string;
  oem: string;
  parts: string;
  ageBucket: string;
  dateFrom: string | null;
  dateTo: string | null;
};

function resolveFilters(opts: TicketTableFilters): ResolvedTicketFilters {
  return {
    status: opts.status ?? "all",
    type: opts.type ?? "all",
    term: (opts.q ?? "").trim(),
    tab: opts.tab ?? "all",
    engineer: opts.engineer ?? "all",
    priority: opts.priority ?? "all",
    city: opts.city ?? "all",
    scope: opts.scope ?? "all",
    bucket: opts.bucket ?? "all",
    oem: opts.oem ?? "all",
    parts: opts.parts ?? "all",
    ageBucket: opts.ageBucket ?? "all",
    dateFrom: opts.dateFrom ?? null,
    dateTo: opts.dateTo ?? null,
  };
}

/** Local-midnight [start, end) ISO bounds for "today" (same basis the list used client-side). */
function todayBounds(): { start: string; end: string } {
  const s = new Date();
  s.setHours(0, 0, 0, 0);
  const e = new Date(s);
  e.setDate(e.getDate() + 1);
  return { start: s.toISOString(), end: e.toISOString() };
}

function hoursAgoIso(h: number): string {
  return new Date(Date.now() - h * HOUR_MS).toISOString();
}

/** Execution duration in hours (closed_at − created_at); null when the ticket isn't closed. */
export function ticketExecutionHours(r: {
  created_at: string;
  closed_at?: string | null;
}): number | null {
  if (!r.closed_at) return null;
  const ms = new Date(r.closed_at).getTime() - new Date(r.created_at).getTime();
  if (Number.isNaN(ms)) return null;
  return ms / HOUR_MS;
}

/** Client-side hour slice for the execution bucket (see applyTicketFilters for why). */
export function matchesTicketBucket(
  r: { created_at: string; closed_at?: string | null },
  bucket: string,
): boolean {
  if (bucket === "all") return true;
  const h = ticketExecutionHours(r);
  if (h === null) return false;
  if (bucket === "lt24") return h < 24;
  if (bucket === "24-48") return h >= 24 && h < 48;
  if (bucket === "48-72") return h >= 48 && h < 72;
  if (bucket === "gt72") return h >= 72;
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyTicketFilters(sel: any, f: ResolvedTicketFilters): any {
  // Server-side tab filtering: open = not terminal, closed = terminal only
  if (f.tab === "open") {
    sel = sel.not("status", "in", TERMINAL_IN);
  } else if (f.tab === "closed") {
    sel = sel.in("status", ["Closed", "Cancelled"]);
  }

  // Execution bucket implies Closed (mirrors the old client predicate, which
  // rejected every non-Closed row when a bucket was picked).
  if (f.bucket !== "all") {
    sel = sel.eq("status", "Closed").not("closed_at", "is", null);
  } else if (f.status !== "all") {
    sel = sel.eq("status", f.status);
  }
  if (f.type !== "all") sel = sel.eq("call_type", f.type);
  if (f.term) {
    const safe = f.term.replace(/[%_]/g, "\\$&");
    const p = `%${safe}%`;
    // Plain `col.ilike.%term%` per branch — no wrapping functions — so the
    // pg_trgm GIN indexes (20260928000005) can serve each OR branch. Terms
    // shorter than 3 chars can't use trigram extraction and fall back to a
    // sequential scan; the UI debounces input (250ms) to keep that rare.
    sel = sel.or(
      `case_id.ilike.${p},customer_name.ilike.${p},serial_no.ilike.${p},product.ilike.${p},customer_phone.ilike.${p},location.ilike.${p},sector.ilike.${p},oem_ref_id.ilike.${p},oem_brand.ilike.${p}`,
    );
  }

  if (f.engineer !== "all") sel = sel.eq("assigned_engineer_name", f.engineer);
  if (f.priority !== "all") sel = sel.eq("priority", f.priority);
  if (f.city !== "all") sel = sel.eq("location", f.city);

  // Nullable booleans: the "negative" side must also match NULL (legacy rows),
  // which neither `.eq(col, false)` nor `.neq(col, true)` does in PostgREST.
  if (f.oem === "oem") sel = sel.eq("oem_call", true);
  else if (f.oem === "phs") sel = sel.or("oem_call.is.null,oem_call.eq.false");
  if (f.parts === "with") sel = sel.eq("defective_parts_received", true);
  else if (f.parts === "without")
    sel = sel.or("defective_parts_received.is.null,defective_parts_received.eq.false");

  if (f.dateFrom) sel = sel.gte("created_at", f.dateFrom);
  if (f.dateTo) sel = sel.lte("created_at", f.dateTo);

  if (f.scope === "today") {
    const { start, end } = todayBounds();
    sel = sel.or(
      `and(assigned_at.gte.${start},assigned_at.lt.${end}),and(assigned_at.is.null,created_at.gte.${start},created_at.lt.${end})`,
    );
  } else if (f.scope === "carry") {
    const { start, end } = todayBounds();
    sel = sel.neq("status", "Closed");
    sel = sel.or(
      `assigned_at.lt.${start},assigned_at.gte.${end},and(assigned_at.is.null,created_at.lt.${start}),and(assigned_at.is.null,created_at.gte.${end})`,
    );
  } else if (f.scope === "active") {
    sel = sel.not("status", "in", TERMINAL_IN);
  } else if (f.scope === "closedToday") {
    const { start, end } = todayBounds();
    sel = sel.eq("status", "Closed").gte("closed_at", start).lt("closed_at", end);
  } else if (f.scope === "highPriority") {
    sel = sel.not("status", "in", TERMINAL_IN).in("priority", ["P1", "P2"]);
  } else if (f.scope === "overdue") {
    // Approximation: wall-clock age > 24h. The on-screen timer excludes
    // Sundays (IST), so a ticket created on Saturday may badge overdue a few
    // hours before this predicate matches — accepted; exact Sunday-aware SQL
    // would need a stored function.
    sel = sel.not("status", "in", TERMINAL_IN).lte("created_at", hoursAgoIso(24));
  }

  // Open-ticket age on wall-clock created_at (matches the old client buckets,
  // which used Date.now() − created_at with no Sunday exclusion).
  if (f.ageBucket !== "all") {
    sel = sel.not("status", "in", TERMINAL_IN);
    if (f.ageBucket === "lt24") sel = sel.gte("created_at", hoursAgoIso(24));
    else if (f.ageBucket === "24-48")
      sel = sel.gte("created_at", hoursAgoIso(48)).lt("created_at", hoursAgoIso(24));
    else if (f.ageBucket === "48-72")
      sel = sel.gte("created_at", hoursAgoIso(72)).lt("created_at", hoursAgoIso(48));
    else if (f.ageBucket === "gt72") sel = sel.lt("created_at", hoursAgoIso(72));
  }

  return sel;
}

export function useTicketsTable(opts: TicketTableFilters) {
  const f = resolveFilters(opts);
  const { page, pageSize } = opts;
  return useQuery({
    queryKey: ["tickets", "table", { ...f, page, pageSize }] as const,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const { from, to } = pageRange(page, pageSize);
      // Count rides the same filtered query (count: exact) so the pager total
      // always honors the active filters. Tradeoff: on a huge unfiltered
      // table this count is a full scan — accepted because the pager needs an
      // exact total; revisit with estimated counts past ~100k tickets.
      let sel = applyTicketFilters(
        supabase
          .from("tickets")
          .select(TICKET_LIST_COLS, { count: "exact" })
          .eq("is_deleted", false)
          .order("created_at", { ascending: false }),
        f,
      );
      sel = sel.range(from, to);
      const { data, count, error } = await sel;
      if (error) throw error;
      const baseRows = (data || []) as unknown as TicketTableRow[];
      const ids = baseRows.map((r) => r.id);
      let flagged = new Set<string>();
      if (ids.length) {
        const { data: acts } = await supabase
          .from("ticket_activities")
          .select("ticket_id")
          .eq("special_instruction", true)
          .in("ticket_id", ids)
          .limit(200);
        flagged = new Set(((acts as { ticket_id: string }[] | null) || []).map((a) => a.ticket_id));
      }
      const rows = baseRows.map((r) => ({ ...r, has_special_activity: flagged.has(r.id) }));
      return { rows, count: count ?? 0 };
    },
  });
}

/**
 * Bounded export query honoring the SAME server-side filters as the list
 * (plus the exact execution-bucket slice, which PostgREST can't express
 * column-to-column — see applyTicketFilters). Skips the per-row
 * special-activity enrichment; export columns don't use it.
 */
export async function fetchTicketsForExport(
  opts: TicketTableFilters,
): Promise<{ rows: TicketTableRow[]; capped: boolean }> {
  const f = resolveFilters(opts);
  let sel = applyTicketFilters(
    supabase
      .from("tickets")
      .select(TICKET_LIST_COLS)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false }),
    f,
  );
  sel = sel.limit(TICKETS_EXPORT_CAP + 1);
  const { data, error } = await sel;
  if (error) throw error;
  const raw = ((data || []) as unknown as TicketTableRow[]).slice(0, TICKETS_EXPORT_CAP + 1);
  const capped = raw.length > TICKETS_EXPORT_CAP;
  let rows = raw.slice(0, TICKETS_EXPORT_CAP);
  if (f.bucket !== "all") rows = rows.filter((r) => matchesTicketBucket(r, f.bucket));
  return { rows, capped };
}

/**
 * Distinct ticket cities for the City filter. The list query only returns one
 * page, so options can't be derived from its rows once filtering is
 * server-side — this lightweight location-only query feeds the dropdown.
 */
export function useTicketCities() {
  return useQuery({
    queryKey: ["tickets", "cities"] as const,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("tickets")
        .select("location")
        .eq("is_deleted", false)
        .not("location", "is", null)
        .limit(1000);
      if (error) throw error;
      return Array.from(
        new Set(
          ((data || []) as { location: string | null }[])
            .map((r) => (r.location || "").trim())
            .filter(Boolean),
        ),
      ).sort();
    },
  });
}

/** Lightweight count for Open vs Closed tabs — runs in parallel, no row data fetched. */
export function useTicketTabCounts() {
  return useQuery({
    queryKey: ["tickets", "tab_counts"] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const [openRes, closedRes] = await Promise.all([
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("is_deleted", false)
          .not("status", "in", TERMINAL_IN),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("is_deleted", false)
          .in("status", ["Closed", "Cancelled"]),
      ]);
      return {
        open: openRes.count ?? 0,
        closed: closedRes.count ?? 0,
      };
    },
  });
}

export type AssignableEngineer = {
  id: string;
  name: string;
  phone: string | null;
  department: string | null;
  active: boolean;
  /** True when the employee row has a linked auth login (can use the /eng portal). */
  hasLogin: boolean;
};

/**
 * Employee ids that hold a portal login (employees.auth_user_id IS NOT NULL).
 * Small admin-managed table; safe to fetch whole (id column only).
 */
export async function fetchEngineerLoginIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("employees")
    .select("id")
    .not("auth_user_id", "is", null);
  if (error) return new Set();
  return new Set(((data || []) as { id: string }[]).map((r) => r.id));
}

export function useAssignableEngineers() {
  return useQuery({
    queryKey: ["tickets", "assignable_engineers"] as const,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AssignableEngineer[]> => {
      const [dir, linked] = await Promise.all([
        supabase
          .from("assignable_engineers")
          .select("id,name,phone,department,active")
          .order("name")
          .limit(200),
        fetchEngineerLoginIds(),
      ]);
      if (dir.error) throw dir.error;
      const list = (dir.data || []) as {
        id: string;
        name: string;
        phone: string | null;
        department: string | null;
        active: boolean;
      }[];
      // Portal engineers first so assignment routes to real logins.
      return sortEngineersLoginFirst(attachLoginFlags(list, linked));
    },
  });
}
