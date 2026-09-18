/**
 * Centralized TanStack Query key factories.
 * Keep keys stable and serializable so cache invalidation is predictable.
 * Usage: queryKeys.indent.list({ status: "open" }) or indentKeys.detail(id)
 */

type Filters = Record<string, unknown> | unknown;
type PaginationParams = { page: number; pageSize: number } & Record<string, unknown>;

function paginationKey(base: readonly string[], params: PaginationParams) {
  return [...base, "paginated", params] as const;
}

// Generic helper to build a standard set: all / list / detail / paginated
function createKeyFactory<NS extends readonly string[]>(namespace: NS) {
  const all = [...namespace] as unknown as NS;
  return {
    all,
    list: (filters?: Filters) =>
      (filters !== undefined
        ? [...(all as unknown as readonly string[]), "list", filters]
        : [...(all as unknown as readonly string[]), "list"]) as readonly unknown[],
    detail: (id: string) => [...(all as unknown as readonly string[]), "detail", id] as const,
    paginated: (params: PaginationParams) =>
      paginationKey(all as unknown as readonly string[], params),
    pagination: (params: PaginationParams) =>
      paginationKey(all as unknown as readonly string[], params),
  } as const;
}

// Named factories — each mirrors one domain table / feature

export const masterKeys = createKeyFactory(["masters"] as const);
export const indentKeys = createKeyFactory(["indents"] as const);
export const ticketKeys = createKeyFactory(["tickets"] as const);
export const verificationKeys = createKeyFactory(["verifications"] as const);
export const fieldServiceReportKeys = createKeyFactory(["field_service_reports"] as const);
export const grnKeys = createKeyFactory(["grns"] as const);
export const dcKeys = createKeyFactory(["delivery_challans"] as const);
export const imsKeys = createKeyFactory(["ims"] as const);

// Back-compat alias: some code historically used `challanKeys`, others `dcKeys` —
// both point to the same delivery_challans domain/table.
export const challanKeys = dcKeys;
export const stockKeys = createKeyFactory(["ims_stock_items"] as const);
export const txnKeys = createKeyFactory(["ims_transactions"] as const);
export const soKeys = createKeyFactory(["sales_orders"] as const);
export const proformaKeys = createKeyFactory(["proforma_invoices"] as const);
export const conversionKeys = createKeyFactory(["so_conversions"] as const);
// Engineer portal keys. The portal historically used ad-hoc ["eng", …]
// literals, which split cache invalidation across two conventions (a ticket
// mutation invalidating ticketKeys never refreshed the eng queue). All eng
// hooks and all eng cross-invalidations go through this factory; prefix
// entries exist so one invalidateQueries call busts a whole family.
export const engKeys = {
  all: ["eng"] as const,
  queue: (uid: string | null) => ["eng", "queue", uid] as const,
  queuePrefix: ["eng", "queue"] as const,
  // Completed visits live under the queue family so every queuePrefix
  // invalidation (FSR submit, depart, admin edits) busts them too.
  completedQueue: (uid: string | null) => ["eng", "queue", uid, "completed"] as const,
  carriedCount: (uid: string | null) => ["eng", "carried-count", uid] as const,
  employee: (uid: string | null) => ["eng", "employee", uid] as const,
  dashboard: (employeeId: string | null, today: string) =>
    ["eng", "dashboard-direct", employeeId, today] as const,
  dashboardPrefix: ["eng", "dashboard-direct"] as const,
  conveyanceLog: (employeeId: string | null, date: string) =>
    ["eng", "conveyance-log", employeeId, date] as const,
  conveyanceExpenses: (employeeId: string | null, date: string) =>
    ["eng", "conveyance-expenses", employeeId, date] as const,
  placeVisits: (employeeId: string | null, date: string) =>
    ["eng", "place-visits", employeeId, date] as const,
} as const;

// Engineers admin keys. Separate "admin-eng" namespace so admin roster /
// payables / ledger caches never collide with the engineer-portal "eng"
// family above (engKeys intentionally untouched).
export const adminEngKeys = {
  all: ["admin-eng"] as const,
  roster: () => ["admin-eng", "roster"] as const,
  payables: (employeeId: string | null, from: string, to: string) =>
    ["admin-eng", "payables", employeeId, from, to] as const,
  // All-engineers grouped payables for one window (client-side grouping).
  payablesAll: (from: string, to: string) =>
    ["admin-eng", "payables-all", from, to] as const,
  payablesAllPrefix: ["admin-eng", "payables-all"] as const,
  ledger: (from: string, to: string) => ["admin-eng", "ledger", from, to] as const,
  rates: (employeeId: string | null) => ["admin-eng", "rates", employeeId] as const,
  ratesPrefix: ["admin-eng", "rates"] as const,
  settlements: (employeeId: string | null) => ["admin-eng", "settlements", employeeId] as const,
  settlementsPrefix: ["admin-eng", "settlements"] as const,
  overview: () => ["admin-eng", "overview"] as const,
  overviewPrefix: ["admin-eng", "overview"] as const,
  tickets: (employeeId: string | null) => ["admin-eng", "tickets", employeeId] as const,
  ticketsPrefix: ["admin-eng", "tickets"] as const,
  conveyance: (employeeId: string | null, from: string, to: string) =>
    ["admin-eng", "conveyance", employeeId, from, to] as const,
  conveyancePrefix: ["admin-eng", "conveyance"] as const,
  documents: (employeeId: string | null) => ["admin-eng", "documents", employeeId] as const,
  documentsPrefix: ["admin-eng", "documents"] as const,
  custody: (employeeId: string | null) => ["admin-eng", "custody", employeeId] as const,
  custodyPrefix: ["admin-eng", "custody"] as const,
  attention: () => ["admin-eng", "attention"] as const,
  attentionPrefix: ["admin-eng", "attention"] as const,
} as const;

// Aggregate export for convenience
export const queryKeys = {
  master: masterKeys,
  indent: indentKeys,
  ticket: ticketKeys,
  verification: verificationKeys,
  fieldServiceReport: fieldServiceReportKeys,
  grn: grnKeys,
  dc: dcKeys,
  ims: imsKeys,
  challan: challanKeys,
  stock: stockKeys,
  txn: txnKeys,
  so: soKeys,
  proforma: proformaKeys,
  conversion: conversionKeys,
  eng: engKeys,
  adminEng: adminEngKeys,
} as const;
