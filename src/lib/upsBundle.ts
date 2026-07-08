// UPS bundling + backup-time + battery recommendation engine.
// Formulas per spec:
//   Backup (hours) = (Voltage × Ah × Qty × 0.8) / Load(W)
//   Required VAh   = Load × BackupHours / 0.8

import { supabase } from "@/integrations/supabase/client";

export type BundleItem = {
  product_id: string;
  qty: number;
  description?: string;
  note?: string;
};

export type UpsBundle = {
  id: string;
  parent_product_id: string;
  label: string | null;
  ups_load_watts: number | null;
  items: BundleItem[];
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type BatteryTier = "economy" | "standard" | "premium";

export type Battery = {
  id: string;
  product_id: string | null;
  brand: string | null;
  model: string | null;
  voltage: number;
  ah: number;
  tier: BatteryTier;
  price: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export const EFFICIENCY = 0.8;

export function backupHours(opts: {
  voltage: number;
  ah: number;
  qty: number;
  loadW: number;
  efficiency?: number;
}): number {
  const { voltage, ah, qty, loadW, efficiency = EFFICIENCY } = opts;
  if (!loadW || loadW <= 0) return 0;
  if (!voltage || !ah || !qty) return 0;
  return (voltage * ah * qty * efficiency) / loadW;
}

export function fmtBackup(hours: number): string {
  if (!hours || !isFinite(hours) || hours <= 0) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export type Recommendation = {
  tier: BatteryTier;
  battery: Battery;
  qty: number;
  total_price: number;
  achieved_backup_h: number;
};

/**
 * For a target load and desired backup hours, pick the cheapest configuration
 * per tier from the given battery catalog that meets the requirement.
 */
export function recommendBatteries(
  batteries: Battery[],
  loadW: number,
  backupH: number,
): Recommendation[] {
  if (loadW <= 0 || backupH <= 0) return [];
  const requiredVAh = (loadW * backupH) / EFFICIENCY;
  const tiers: BatteryTier[] = ["economy", "standard", "premium"];
  const out: Recommendation[] = [];
  for (const tier of tiers) {
    const pool = batteries.filter((b) => b.active && b.tier === tier);
    let best: Recommendation | null = null;
    for (const b of pool) {
      const perUnit = Number(b.voltage) * Number(b.ah);
      if (perUnit <= 0) continue;
      const qty = Math.max(1, Math.ceil(requiredVAh / perUnit));
      const price = qty * Number(b.price || 0);
      const achieved = backupHours({ voltage: b.voltage, ah: b.ah, qty, loadW });
      if (!best || price < best.total_price) {
        best = { tier, battery: b, qty, total_price: price, achieved_backup_h: achieved };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

export async function fetchUpsBundles(): Promise<UpsBundle[]> {
  const { data, error } = await supabase.from("ups_bundles" as any).select("*").eq("active", true);
  if (error) throw error;
  return ((data as any[]) || []).map((r) => ({ ...r, items: Array.isArray(r.items) ? r.items : [] }));
}

export async function fetchBatteryCatalog(): Promise<Battery[]> {
  const { data, error } = await supabase.from("battery_catalog" as any).select("*").eq("active", true).order("tier").order("ah");
  if (error) throw error;
  return (data as any[]) || [];
}

export const TIER_LABEL: Record<BatteryTier, string> = {
  economy: "Economy",
  standard: "Standard",
  premium: "Premium",
};