import { supabase } from "@/integrations/supabase/client";

export type InstalledEquipment = {
  id: string;
  customer_id: string;
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

const addMonthsIso = (iso: string, months: number): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const idx = m - 1 + months;
  const year = y + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12;
  const last = new Date(year, month + 1, 0).getDate();
  const day = Math.min(d, last);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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