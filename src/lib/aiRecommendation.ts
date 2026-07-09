// Rule-based AI Recommendation Engine for UPS battery configuration.
//
// Pure module — no React, no Supabase, no UI. UI layers pass in the
// current rule set + optional battery catalog and render the results.
// All thresholds / preferences live in `RecommendationRules` so the
// engine can be tuned without code changes, and swapped for an
// ML-based implementation in the future by keeping the same
// `recommend()` signature.

import {
  DEFAULT_EFFICIENCY,
  calcBackupHours,
  requiredVAh,
} from "./backupEngine";
import type { Battery, BatteryTier } from "./upsBundle";

export type RecommendationLevel = BatteryTier; // "economy" | "standard" | "premium"

export type TierRule = {
  /** Ordered list of preferred single-battery voltages (V). Engine picks the first that yields a valid config. */
  preferredVoltages: number[];
  /** Ordered list of preferred Ah ratings — first that meets the target with the fewest units wins. */
  preferredAh: number[];
  /** Optional cap on the number of batteries. If a candidate exceeds this, engine tries the next Ah. */
  maxQty?: number;
  /** Depth-of-discharge, 0..1. Effective capacity = Ah × DoD. */
  depthOfDischarge: number;
  /** Safety / ageing margin applied on top of required VAh (e.g. 1.15 = +15 %). */
  reserveFactor: number;
  /** Human label shown in UI. */
  label: string;
  /** Short marketing blurb. */
  blurb: string;
};

export type RecommendationRules = {
  efficiency: number; // typically 0.8
  tiers: Record<RecommendationLevel, TierRule>;
};

/** Sensible defaults. Tune from Settings > Rules in the future. */
export const DEFAULT_RULES: RecommendationRules = {
  efficiency: DEFAULT_EFFICIENCY,
  tiers: {
    economy: {
      label: "Economy",
      blurb: "Lowest cost. Meets target backup with baseline capacity.",
      preferredVoltages: [12],
      preferredAh: [42, 65, 100, 150, 200],
      depthOfDischarge: 0.8,
      reserveFactor: 1.0,
      maxQty: 32,
    },
    standard: {
      label: "Standard",
      blurb: "Balanced sizing with a safety margin for battery ageing.",
      preferredVoltages: [12],
      preferredAh: [100, 150, 200],
      depthOfDischarge: 0.7,
      reserveFactor: 1.15,
      maxQty: 32,
    },
    premium: {
      label: "Premium",
      blurb: "Longer runtime and headroom. Fewer, larger batteries.",
      preferredVoltages: [12],
      preferredAh: [150, 200, 250],
      depthOfDischarge: 0.6,
      reserveFactor: 1.3,
      maxQty: 40,
    },
  },
};

export type RecommendationInputs = {
  loadW: number;
  targetHours: number;
  rules?: RecommendationRules;
  /** Optional live catalog. When provided, engine prefers matching (V, Ah) rows to attach price & product_id. */
  catalog?: Battery[];
};

export type BatteryPick = {
  voltage: number;
  ah: number;
  qty: number;
  /** Human-readable configuration, e.g. "12V 150Ah × 16". */
  configuration: string;
  /** Total Ah capacity of the bank (single string of qty batteries). */
  totalAh: number;
  /** Achieved backup hours at full load. */
  achievedBackupH: number;
  /** Effective bank voltage assuming series stringing at 12V multiples (informational). */
  bankVoltage: number;
  /** Optional catalog match. */
  battery?: Battery | null;
  /** Optional total price when catalog match is present. */
  totalPrice?: number | null;
};

export type TierRecommendation = {
  level: RecommendationLevel;
  label: string;
  blurb: string;
  pick: BatteryPick | null;
  /** Non-fatal notes / warnings for the UI ("no catalog match", "qty exceeds cap", ...). */
  notes: string[];
};

export type RecommendationResult = {
  loadW: number;
  targetHours: number;
  efficiency: number;
  requiredVAh: number;
  tiers: TierRecommendation[];
};

function fmtConfig(voltage: number, ah: number, qty: number): string {
  return `${voltage}V ${ah}Ah × ${qty}`;
}

function pickTier(
  level: RecommendationLevel,
  rule: TierRule,
  loadW: number,
  targetHours: number,
  efficiency: number,
  catalog: Battery[] | undefined,
): TierRecommendation {
  const notes: string[] = [];
  const needed = requiredVAh(loadW, targetHours, efficiency) * rule.reserveFactor;

  let best: BatteryPick | null = null;

  for (const v of rule.preferredVoltages) {
    for (const ah of rule.preferredAh) {
      const effective = ah * rule.depthOfDischarge;
      const perUnit = v * effective;
      if (perUnit <= 0) continue;
      const qty = Math.max(1, Math.ceil(needed / perUnit));
      if (rule.maxQty && qty > rule.maxQty) continue;

      const achieved = calcBackupHours({ voltage: v, ah, qty, loadW, efficiency });
      const match = catalog?.find(
        (b) => b.active && b.tier === level && Number(b.voltage) === v && Number(b.ah) === ah,
      ) ?? null;
      const totalPrice = match ? qty * Number(match.price || 0) : null;

      const candidate: BatteryPick = {
        voltage: v,
        ah,
        qty,
        configuration: fmtConfig(v, ah, qty),
        totalAh: ah * qty,
        achievedBackupH: achieved,
        bankVoltage: v * qty,
        battery: match,
        totalPrice,
      };

      // Selection heuristic:
      //   1. Prefer configurations with a catalog match (has real price / product_id).
      //   2. Then prefer fewer batteries (simpler installation).
      //   3. Then cheaper total price when both matched.
      if (
        !best ||
        (candidate.battery && !best.battery) ||
        (!!candidate.battery === !!best.battery && candidate.qty < best.qty) ||
        (!!candidate.battery === !!best.battery &&
          candidate.qty === best.qty &&
          (candidate.totalPrice ?? Infinity) < (best.totalPrice ?? Infinity))
      ) {
        best = candidate;
      }
    }
  }

  if (!best) {
    notes.push("No configuration within tier constraints. Loosen max quantity or expand preferred Ah list.");
  } else if (!best.battery && catalog && catalog.length > 0) {
    notes.push("No exact catalog match for this tier — configuration shown is calculated from rules.");
  }

  return { level, label: rule.label, blurb: rule.blurb, pick: best, notes };
}

/**
 * Main entry point. Returns a recommendation for every tier defined in the rules.
 * Swap this function's body for an ML-based implementation later while keeping
 * the same signature.
 */
export function recommend(inp: RecommendationInputs): RecommendationResult {
  const rules = inp.rules ?? DEFAULT_RULES;
  const efficiency = rules.efficiency || DEFAULT_EFFICIENCY;
  const loadW = Number(inp.loadW) || 0;
  const targetHours = Number(inp.targetHours) || 0;

  const tiers: TierRecommendation[] = (Object.keys(rules.tiers) as RecommendationLevel[]).map(
    (level) => pickTier(level, rules.tiers[level], loadW, targetHours, efficiency, inp.catalog),
  );

  return {
    loadW,
    targetHours,
    efficiency,
    requiredVAh: requiredVAh(loadW, targetHours, efficiency),
    tiers,
  };
}

/** Formatter helper for currency in INR. */
export function fmtINR(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}