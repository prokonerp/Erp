// Reusable Backup Calculation Engine.
//
// Pure functions — no React, no Supabase, no UI. Consumers (Quotation,
// Sales Order, Invoice, AI Recommendation Engine) import these helpers
// and render the results however they wish.
//
// Formula:
//   Backup Time (hours) = (Voltage × Ah × Qty × EFFICIENCY) / Load(W)
//
// EFFICIENCY defaults to 0.8 (typical inverter/battery efficiency).

export const DEFAULT_EFFICIENCY = 0.8;
export const LOW_BACKUP_THRESHOLD_H = 1;

export type BackupInputs = {
  loadW: number;         // UPS load in Watts
  voltage: number;       // Battery bank voltage (per-unit or series total)
  ah: number;            // Battery capacity in Ah
  qty: number;           // Number of batteries
  efficiency?: number;   // Optional override, defaults to 0.8
};

export type BackupResult = {
  loadW: number;
  fullLoadHours: number;   // hours at 100% load
  halfLoadHours: number;   // hours at 50% load
  isLow: boolean;          // fullLoadHours < LOW_BACKUP_THRESHOLD_H
  warning: string | null;  // human-readable warning
  suggestion: string | null; // human-readable suggestion
};

/** Core formula. Returns backup hours at the given load. */
export function calcBackupHours(inp: BackupInputs): number {
  const v = Number(inp.voltage) || 0;
  const a = Number(inp.ah) || 0;
  const q = Number(inp.qty) || 0;
  const w = Number(inp.loadW) || 0;
  const eff = inp.efficiency ?? DEFAULT_EFFICIENCY;
  if (v <= 0 || a <= 0 || q <= 0 || w <= 0) return 0;
  return (v * a * q * eff) / w;
}

/**
 * Required VAh (voltage × Ah × qty) to sustain a given load for a target
 * number of hours. Useful for the AI recommendation engine.
 */
export function requiredVAh(loadW: number, targetHours: number, efficiency = DEFAULT_EFFICIENCY): number {
  if (loadW <= 0 || targetHours <= 0) return 0;
  return (loadW * targetHours) / (efficiency || DEFAULT_EFFICIENCY);
}

/**
 * Compute full-load & 50%-load backup along with warning/suggestion strings.
 * This is the primary entry point for UI components.
 */
export function computeBackup(inp: BackupInputs): BackupResult {
  const fullLoadHours = calcBackupHours(inp);
  const halfLoad = { ...inp, loadW: (Number(inp.loadW) || 0) / 2 };
  const halfLoadHours = calcBackupHours(halfLoad);
  const isLow = fullLoadHours > 0 && fullLoadHours < LOW_BACKUP_THRESHOLD_H;
  const insufficient = fullLoadHours > 0 && fullLoadHours < LOW_BACKUP_THRESHOLD_H;
  return {
    loadW: Number(inp.loadW) || 0,
    fullLoadHours,
    halfLoadHours,
    isLow,
    warning: isLow ? "Backup is low" : null,
    suggestion: insufficient ? "Consider adding more batteries." : null,
  };
}

/** Format hours as "Xh YYm" / "N min" / "—". */
export function formatBackup(hours: number): string {
  if (!hours || !isFinite(hours) || hours <= 0) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/**
 * Suggest the minimum battery quantity of a given (V, Ah) spec to reach the
 * target backup hours at the given load. Returns 0 if inputs are invalid.
 */
export function suggestBatteryQty(opts: {
  loadW: number;
  targetHours: number;
  voltage: number;
  ah: number;
  efficiency?: number;
}): number {
  const { loadW, targetHours, voltage, ah } = opts;
  const eff = opts.efficiency ?? DEFAULT_EFFICIENCY;
  const perUnit = Number(voltage) * Number(ah);
  if (loadW <= 0 || targetHours <= 0 || perUnit <= 0) return 0;
  return Math.max(1, Math.ceil(requiredVAh(loadW, targetHours, eff) / perUnit));
}