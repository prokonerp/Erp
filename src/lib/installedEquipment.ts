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
  const diff = Math.floor((new Date(end.slice(0, 10) + "T00:00:00").getTime() - today.getTime()) / 86400000);
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

export const listEquipmentForCustomer = async (customerId: string): Promise<InstalledEquipment[]> => {
  const sb = supabase as unknown as { from: (t: string) => any };
  const { data, error } = await sb
    .from("installed_equipment")
    .select("*")
    .eq("customer_id", customerId)
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as InstalledEquipment[];
};

const table = () => (supabase as unknown as { from: (t: string) => any }).from("installed_equipment");

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
  const { data, error } = await table().select("*").ilike("serial_no", `%${serial}%`).limit(25);
  if (error) throw error;
  return (data || []) as InstalledEquipment[];
};

/** Every equipment row across all customers (used by the Summary tab). */
export const listAllEquipment = async (): Promise<InstalledEquipment[]> =>
  fetchAll<InstalledEquipment>("installed_equipment", (q) => q.select("*"));

export type ImportOutcome = {
  imported: number;
  skipped: { row: number; reason: string }[];
  failed: { row: number; reason: string }[];
};

const pick = (r: Record<string, string>, keys: string[]) => {
  for (const k of keys) {
    const hit = Object.keys(r).find((h) => h.trim().toLowerCase() === k.toLowerCase());
    if (hit && (r[hit] || "").trim()) return r[hit].trim();
  }
  return "";
};

const toIso = (s: string): string | null => {
  if (!s) return null;
  const t = s.trim();
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
 * Import CSV rows into installed_equipment.
 * Per-row validation: customer must resolve, (customer, serial) must be unique,
 * model is matched against Product Master to fill product_id / default warranty.
 */
export const importEquipmentRows = async (rows: Record<string, string>[]): Promise<ImportOutcome> => {
  const out: ImportOutcome = { imported: 0, skipped: [], failed: [] };
  if (!rows.length) return out;

  const customers = await fetchAll<any>("customers", (q) => q.select("id,company,customer_code"));
  const byName = new Map<string, string>();
  const byCode = new Map<string, string>();
  for (const c of customers) {
    if (c.company) byName.set(String(c.company).trim().toLowerCase(), c.id);
    if (c.customer_code) byCode.set(String(c.customer_code).trim().toLowerCase(), c.id);
  }

  const products = await fetchAll<any>("products", (q) =>
    q.select("id,name,model,short_name,warranty_applicable,warranty_duration,warranty_unit"));
  const byModel = new Map<string, any>();
  for (const p of products) {
    for (const key of [p.model, p.short_name, p.name]) {
      const k = String(key || "").trim().toLowerCase();
      if (k && !byModel.has(k)) byModel.set(k, p);
    }
  }

  const existing = await listAllEquipment();
  const seen = new Set(
    existing.filter((e) => e.serial_no).map((e) => `${e.customer_id}|${e.serial_no!.toUpperCase()}`),
  );

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 2; // header is line 1
    const custRaw = pick(r, ["Customer", "Customer Name", "Company", "Customer Code"]);
    const model = pick(r, ["Model No", "Model", "Model Number"]);
    if (!custRaw && !model) continue; // blank line
    const customerId = byName.get(custRaw.toLowerCase()) || byCode.get(custRaw.toLowerCase());
    if (!customerId) { out.failed.push({ row: line, reason: `Customer "${custRaw || "(blank)"}" not found` }); continue; }
    if (!model) { out.failed.push({ row: line, reason: "Model No is required" }); continue; }

    const serial = pick(r, ["Serial No", "Serial", "Serial Number"]).toUpperCase() || null;
    if (serial) {
      const key = `${customerId}|${serial}`;
      if (seen.has(key)) { out.skipped.push({ row: line, reason: `${serial} already exists for this customer` }); continue; }
      seen.add(key);
    }

    const prod = byModel.get(model.trim().toLowerCase()) || null;
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