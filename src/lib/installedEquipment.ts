import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { productWarrantyMonths } from "@/lib/sales";
import { localDateIso } from "@/lib/dateRange";

export type InstalledEquipment = {
  id: string;
  customer_id: string;
  product_id?: string | null;
  model_no: string;
  serial_no: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  warranty_months: number;
  amc_start_date: string | null;
  amc_end_date: string | null;
  remarks: string | null;
  created_at: string;
};

export type EquipmentInput = {
  customer_id?: string;
  product_id?: string | null;
  model_no: string;
  serial_no: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  warranty_months: number;
  amc_start_date: string | null;
  amc_end_date: string | null;
  remarks?: string | null;
};

export type CoverStatus = "active" | "expiring" | "expired" | "none";

/** Default AMC period applied on equipment entry / import when none is given. */
export const DEFAULT_AMC_MONTHS = 12;

export const addMonthsIso = (iso: string, months: number): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const idx = m - 1 + months;
  const year = y + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12;
  const last = new Date(year, month + 1, 0).getDate();
  const day = Math.min(d, last);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** Exact inverse of addMonthsIso: returns m where start+m===end, else null. */
export const monthsBetweenIso = (startIso: string, endIso: string): number | null => {
  if (!startIso || !endIso) return null;
  const s = startIso.slice(0, 10);
  const e = endIso.slice(0, 10);
  for (let m = 1; m <= 600; m++) {
    if (addMonthsIso(s, m) === e) return m;
    // stop early once we overshoot the end date
    if (addMonthsIso(s, m) > e) break;
  }
  return null;
};

/** Warranty end = invoice date + warranty months. Null when either is missing. */
export const warrantyEnd = (row: InstalledEquipment): string | null => {
  if (!row.invoice_date || !row.warranty_months) return null;
  return addMonthsIso(row.invoice_date, row.warranty_months);
};

/** Active / expiring (<=30 days) / expired, or "none" when there is no end date. */
export const coverStatus = (end: string | null | undefined): CoverStatus => {
  if (!end) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor(
    (new Date(end.slice(0, 10) + "T00:00:00").getTime() - today.getTime()) / 86400000,
  );
  if (diff < 0) return "expired";
  if (diff <= 30) return "expiring";
  return "active";
};

export const amcStatusOf = (row: InstalledEquipment): CoverStatus =>
  row.amc_end_date ? coverStatus(row.amc_end_date) : "none";

export const statusLabel: Record<CoverStatus, string> = {
  active: "Active",
  expiring: "Expiring",
  expired: "Expired",
  none: "None",
};

export const statusClass = (s: CoverStatus): string =>
  s === "active"
    ? "bg-green-100 text-green-800 border-green-300"
    : s === "expiring"
      ? "bg-orange-100 text-orange-800 border-orange-300"
      : s === "expired"
        ? "bg-red-100 text-red-800 border-red-300"
        : "bg-muted text-muted-foreground border-border";

export const listEquipmentForCustomer = async (
  customerId: string,
): Promise<InstalledEquipment[]> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as { from: (t: string) => any };
  const cols =
    "id,customer_id,product_id,serial_no,model_no,invoice_no,invoice_date,warranty_months,amc_start_date,amc_end_date,remarks,created_at";
  const { data, error } = await sb
    .from("installed_equipment")
    .select(cols)
    .eq("customer_id", customerId)
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as InstalledEquipment[];
};

const table = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase as unknown as { from: (t: string) => any }).from("installed_equipment");

export const createEquipment = async (input: EquipmentInput): Promise<void> => {
  const { error } = await table().insert(input);
  if (error) throw error;
};

export const updateEquipment = async (id: string, input: EquipmentInput): Promise<void> => {
  const { customer_id: _ignored, ...patch } = input;
  const { error } = await table().update(patch).eq("id", id);
  if (error) throw error;
};

export const deleteEquipment = async (id: string): Promise<void> => {
  const { error } = await table().delete().eq("id", id);
  if (error) throw error;
};

/** Lookup by serial (used by the global serial search fallback). */
export const findEquipmentBySerial = async (serial: string): Promise<InstalledEquipment[]> => {
  const cols = "id,customer_id,product_id,serial_no,model_no,invoice_date,warranty_months";
  const { data, error } = await table().select(cols).ilike("serial_no", `%${serial}%`).limit(25);
  if (error) throw error;
  return (data || []) as InstalledEquipment[];
};

/** Exact (case-insensitive; serials are stored upper-cased) lookup by serial — used to
 *  pull a registered unit into a ticket when its serial is typed. */
export const findEquipmentBySerialExact = async (serial: string): Promise<InstalledEquipment[]> => {
  const s = serial.trim().toUpperCase();
  if (!s) return [];
  const cols = "id,customer_id,product_id,serial_no,model_no,invoice_date,warranty_months";
  const { data, error } = await table().select(cols).eq("serial_no", s).limit(5);
  if (error) throw error;
  return (data || []) as InstalledEquipment[];
};

/** Resolve a Product Master row by exact model (case-insensitive). Returns the first match. */
export const findProductByModel = async (
  model: string,
): Promise<{
  id: string;
  model: string;
  brand: string | null;
  name: string;
} | null> => {
  const m = (model || "").trim();
  if (!m) return null;
  const { data, error } = await supabase
    .from("products")
    .select("id, name, model, brand")
    .eq("active", true)
    .ilike("model", m)
    .limit(1);
  if (error) throw error;
  const prod = (data || [])[0];
  return prod
    ? { id: prod.id, model: prod.model || "", brand: prod.brand || null, name: prod.name || "" }
    : null;
};

/** Exact lookup scoped to one customer — used to detect an existing unit before appending. */
export const findEquipmentByCustomerAndSerial = async (
  customerId: string,
  serial: string,
): Promise<InstalledEquipment | null> => {
  const s = serial.trim().toUpperCase();
  if (!customerId || !s) return null;
  const cols = "id,customer_id,product_id,serial_no,model_no,invoice_date,warranty_months";
  const { data, error } = await table()
    .select(cols)
    .eq("customer_id", customerId)
    .eq("serial_no", s)
    .limit(1);
  if (error) throw error;
  return data && data[0] ? (data[0] as InstalledEquipment) : null;
};

/**
 * Link a ticket to Installed Equipment: reuse the row if the (customer, serial)
 * already exists, otherwise append a new row for that customer and return its id.
 * This is the "reverse link" — raising/aissing a ticket grows the register.
 */
export const getOrCreateEquipmentForTicket = async (input: {
  customer_id: string;
  model_no: string;
  serial_no: string;
}): Promise<string> => {
  const s = input.serial_no.trim().toUpperCase();
  if (input.customer_id && s) {
    const existing = await findEquipmentByCustomerAndSerial(input.customer_id, s);
    if (existing) return existing.id;
  }
  const { data, error } = await table()
    .insert({
      customer_id: input.customer_id,
      model_no: input.model_no.trim(),
      serial_no: s || null,
      warranty_months: 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
};

/** Every equipment row across all customers (used by the Summary tab) — bounded, explicit cols (export uses paginated RPC). */
export const listAllEquipment = async (): Promise<InstalledEquipment[]> => {
  const cols =
    "id,customer_id,product_id,serial_no,model_no,invoice_no,invoice_date,warranty_months,amc_start_date,amc_end_date,remarks,created_at";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("installed_equipment")
    .select(cols)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as InstalledEquipment[];
};
/** @deprecated fetchAll for exports only — use bounded listAllEquipment for UI */
export const listAllEquipmentForExport = async (): Promise<InstalledEquipment[]> =>
  fetchAll<InstalledEquipment>("installed_equipment", (q) =>
    q.select(
      "id,customer_id,product_id,serial_no,model_no,invoice_no,invoice_date,warranty_months",
    ),
  );

export type ImportOutcome = {
  imported: number;
  skipped: { row: number; reason: string }[];
  failed: { row: number; reason: string }[];
};

const FALSE_SENTINELS = new Set(["false", "null", "nil", "#n/a", "na", "-"]);

const pick = (r: Record<string, string>, keys: string[]) => {
  for (const k of keys) {
    const hit = Object.keys(r).find((h) => h.trim().toLowerCase() === k.toLowerCase());
    if (hit == null) continue;
    const raw = (r[hit] ?? "").trim();
    if (!raw) continue;
    // Excel exports boolean FALSE / #N/A for empty cells — treat as blank
    if (FALSE_SENTINELS.has(raw.toLowerCase())) continue;
    return raw;
  }
  return "";
};

const toIso = (s: string): string | null => {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  if (FALSE_SENTINELS.has(t.toLowerCase())) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : localDateIso(d);
};

const addMonths = (iso: string, months: number) => addMonthsIso(iso, months);

/**
 * Import CSV rows into installed_equipment — customer-specific, exact-master matching.
 * - Admin must have selected a customer in the UI; all rows are validated against that
 *   customer's exact company name (as in masters) and against Product Master's exact model.
 * - If a row's Customer or Model does not EXACTLY match masters, it is NOT inserted and
 *   is collected as failed with true reason; rest rows continue.
 * - Duplicate serial (customer+serial) is checked against DB and within-file; duplicates
 *   are skipped with reason and included in exportable errors.
 */
export const importEquipmentRows = async (
  rows: Record<string, string>[],
  opts?: { selectedCustomerId?: string | null; selectedCustomerName?: string | null },
): Promise<ImportOutcome> => {
  const out: ImportOutcome = { imported: 0, skipped: [], failed: [] };
  if (!rows.length) return out;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customers = await fetchAll<any>("customers", (q) => q.select("id,company,customer_code"));
  // Exact maps (trimmed, case-sensitive) for strict validation
  const byNameExact = new Map<string, string>();
  const byCodeExact = new Map<string, string>();
  // Fallback lower maps for helpful error messages
  const byNameLower = new Map<string, string>();
  for (const c of customers) {
    if (c.company) {
      const exact = String(c.company).trim();
      if (exact) {
        byNameExact.set(exact, c.id);
        byNameLower.set(exact.toLowerCase(), c.id);
      }
    }
    if (c.customer_code) {
      const exact = String(c.customer_code).trim();
      if (exact) byCodeExact.set(exact, c.id);
    }
  }
  // Resolve selected customer exact name for validation
  const selectedCustomerId = opts?.selectedCustomerId?.trim() || null;
  let selectedCustomerName: string | null = opts?.selectedCustomerName?.trim() || null;
  if (selectedCustomerId && !selectedCustomerName) {
    const hit = customers.find((c) => c.id === selectedCustomerId);
    selectedCustomerName = hit ? String(hit.company || "").trim() : null;
  }
  // If no explicit selection, require Customer column to exactly match masters
  // (old behavior but now exact). If selection provided, we enforce row Customer equals selected.
  if (!selectedCustomerId) {
    // No customer pre-selected — will validate per-row exact match and resolve id per row
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const products = await fetchAll<any>("products", (q) =>
    q.select("id,name,model,short_name,warranty_applicable,warranty_duration,warranty_unit"),
  );
  // Exact model map — ONLY the canonical `model` field, trimmed exact, case-sensitive
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byModelExact = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byModelLower = new Map<string, any>();
  for (const p of products) {
    const exact = String(p.model || "").trim();
    if (exact) {
      if (!byModelExact.has(exact)) byModelExact.set(exact, p);
      const low = exact.toLowerCase();
      if (!byModelLower.has(low)) byModelLower.set(low, p);
    }
  }

  // Duplicate guard: fetch existing serials; if the read fails (e.g. schema drift)
  // we degrade gracefully to a file-internal dedup only, so the import still
  // surfaces per-row successes/failures instead of throwing a blanket error.
  let existing: InstalledEquipment[] = [];
  try {
    existing = await listAllEquipment();
  } catch (e) {
    console.warn("[importEquipmentRows] listAllEquipment failed – falling back to file-only dedup:", e);
  }
  const seen = new Set(
    existing
      .filter((e) => e.serial_no)
      .map((e) => `${e.customer_id}|${e.serial_no!.trim().toUpperCase()}`),
  );

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2; // header is line 1
    const custRaw = pick(r, ["Customer", "Customer Name", "Company", "Customer Code"]);
    const modelRaw = pick(r, ["Model No", "Model", "Model Number"]);
    if (!custRaw && !modelRaw) continue; // blank line

    // --- Customer validation (exact) ---
    let customerId: string | null = null;
    if (selectedCustomerId) {
      // Customer-specific import: row's Customer must exactly equal selected customer's company (or code)
      const rowCustTrimmed = custRaw.trim();
      const expectedExact = selectedCustomerName || "";
      const expectedCodeExact =
        customers.find((c) => c.id === selectedCustomerId)?.customer_code?.trim() || "";
      const matchesExact =
        rowCustTrimmed === expectedExact ||
        (expectedCodeExact && rowCustTrimmed === expectedCodeExact);
      if (!custRaw.trim()) {
        out.failed.push({
          row: line,
          reason: `Customer is required – row must contain exactly "${expectedExact}" (as in masters) for the selected customer`,
        });
        continue;
      }
      if (!matchesExact) {
        // Provide helpful hint if case-insensitive would have matched
        const lowerMatch = rowCustTrimmed.toLowerCase() === expectedExact.toLowerCase();
        out.failed.push({
          row: line,
          reason: `Customer mismatch – row has "${custRaw}" but selected customer is "${expectedExact}"${lowerMatch ? " (case/spacing differs – must be exactly as in masters)" : ""} – must be exactly as in masters`,
        });
        continue;
      }
      customerId = selectedCustomerId;
    } else {
      // No pre-selection: require exact match against masters
      const exactTrim = custRaw.trim();
      customerId = byNameExact.get(exactTrim) || byCodeExact.get(exactTrim) || null;
      if (!customerId) {
        const lowerHit = byNameLower.get(exactTrim.toLowerCase());
        out.failed.push({
          row: line,
          reason: lowerHit
            ? `Customer "${custRaw}" case/spacing differs from masters – must be exactly as stored (exact: "${customers.find((c) => c.id === lowerHit)?.company}")`
            : `Customer "${custRaw || "(blank)"}" not found in masters – must be exactly as in Customer Master`,
        });
        continue;
      }
    }

    const model = modelRaw.trim();
    if (!model) {
      out.failed.push({ row: line, reason: "Model No is required" });
      continue;
    }

    // --- Serial duplicate check ---
    const serialRaw = pick(r, ["Serial No", "Serial", "Serial Number"]);
    const serial = serialRaw.trim().toUpperCase() || null;
    if (serial) {
      const key = `${customerId}|${serial}`;
      if (seen.has(key)) {
        out.skipped.push({
          row: line,
          reason: `Duplicate serial "${serialRaw.trim()}" already exists for this customer (checked DB + file) – not inserted`,
        });
        continue;
      }
      seen.add(key);
    }

    // --- Model exact match (must be exactly as in Product Master) ---
    const prod = byModelExact.get(model) || null;
    if (!prod) {
      const lowerHit = byModelLower.get(model.toLowerCase());
      out.failed.push({
        row: line,
        reason: lowerHit
          ? `Model "${model}" case/spacing differs from masters – must be exactly "${String(lowerHit.model).trim()}" as in Product Master`
          : `Model "${model}" not found in Product Master – must be exactly as in masters (check spelling)`,
      });
      continue;
    }
    const csvWarranty = pick(r, ["Warranty Months", "Warranty (Months)", "Warranty"]);
    const warranty = csvWarranty ? Number(csvWarranty) || 0 : productWarrantyMonths(prod);
    const amcStart = toIso(pick(r, ["AMC Start Date", "AMC Start"]));
    const amcMonthsRaw = Number(pick(r, ["AMC Months", "AMC Duration"])) || 0;
    // Default to 12 months when a start date is given without an explicit period.
    const amcMonths = amcMonthsRaw || (amcStart ? DEFAULT_AMC_MONTHS : 0);

    const payload: EquipmentInput = {
      customer_id: customerId,
      product_id: prod?.id ?? null,
      model_no: model.trim(),
      serial_no: serial,
      invoice_no: pick(r, ["Invoice No", "Invoice Number"]) || null,
      invoice_date: toIso(pick(r, ["Invoice Date"])),
      warranty_months: warranty,
      amc_start_date: amcStart,
      amc_end_date: amcStart && amcMonths ? addMonths(amcStart, amcMonths) : null,
      remarks: pick(r, ["Remarks", "Notes"]) || null,
    };

    const { error } = await table().insert(payload);
    if (error) out.failed.push({ row: line, reason: error.message });
    else out.imported++;
  }
  return out;
};
