/**
 * UI-visible Sales Order conversion options.
 *
 * The DB / ledger layer (`documentFlow.ConversionType`, `salesOrders.SoConversionType`)
 * still carries the legacy `delivery_challan` value so old ledger rows, stock
 * reversals and timeline links keep working. The creation UI, however, offers
 * only three options — Tax Invoice / General Challan / Proforma.
 *
 * This module is the single source of truth for that UI mapping. It is pure
 * (no Supabase, no router) so it is unit-testable — see
 * `src/lib/__tests__/soConversionUi.test.ts`.
 */

import type { ConversionType } from "./documentFlow";

/** Conversion types the SO creation UI offers. */
export type UiConversionType = "tax_invoice" | "general_dc" | "proforma_invoice";

export const UI_CONVERSION_TYPES: readonly UiConversionType[] = [
  "tax_invoice",
  "general_dc",
  "proforma_invoice",
] as const;

const UI_TYPE_SET: ReadonlySet<string> = new Set(UI_CONVERSION_TYPES);

export function isUiConversionType(t: unknown): t is UiConversionType {
  return typeof t === "string" && UI_TYPE_SET.has(t.trim());
}

/**
 * Normalize any incoming conversion-type value (route `?type=` search param,
 * legacy `defaultType` prop, deep link) to a renderable UI tab.
 *
 * - Valid UI types pass through (whitespace-tolerant).
 * - Legacy `delivery_challan` maps to `general_dc` — the surviving challan flow.
 * - Anything else (null, undefined, garbage) falls back to `tax_invoice`.
 */
export function toUiConversionType(t: unknown): UiConversionType {
  if (typeof t !== "string") return "tax_invoice";
  const v = t.trim();
  if (isUiConversionType(v)) return v;
  if (v === "delivery_challan") return "general_dc";
  return "tax_invoice";
}

/** Back-compat alias — some callers imported the route-local name. */
export const toUiType = toUiConversionType;
export const toUiDefault = toUiConversionType;

/** Legacy creation-time value: accepted for display only, never offered for new conversions. */
export type LegacyConversionType = ConversionType | "delivery_challan";

export type ConvertTarget =
  | { to: "/sales/invoices/$id"; params: { id: string } }
  | { to: "/sales/general-dc/$id"; params: { id: string } }
  | { to: "/sales/proforma/$id"; params: { id: string } };

/**
 * Full-window route for a created conversion target.
 * Returns null for unknown/legacy types so callers can fall back safely
 * (e.g. back to the SO detail page) instead of navigating to a broken route.
 */
export function resolveConvertTarget(
  type: string | null | undefined,
  id: string | null | undefined,
): ConvertTarget | null {
  if (!type || !id) return null;
  const t = String(type).trim();
  const cleanId = String(id).trim();
  if (!cleanId) return null;
  if (t === "tax_invoice") return { to: "/sales/invoices/$id", params: { id: cleanId } };
  if (t === "general_dc") return { to: "/sales/general-dc/$id", params: { id: cleanId } };
  if (t === "proforma_invoice") return { to: "/sales/proforma/$id", params: { id: cleanId } };
  return null;
}

/** Human label for UI conversion tabs and menus. */
export function uiConversionLabel(t: UiConversionType): string {
  switch (t) {
    case "tax_invoice":
      return "Tax Invoice";
    case "general_dc":
      return "General Challan";
    case "proforma_invoice":
      return "Proforma";
  }
}
