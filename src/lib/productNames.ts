/**
 * Standardized product naming.
 *
 * - `short_name` (falls back to model) → internal UI: stock reports, IMS,
 *   tables, dropdowns.
 * - `display_name` (falls back to "<brand> <model>") → customer-facing
 *   documents: quotations, invoices, purchase orders, challans.
 */
export type NameableProduct = {
  short_name?: string | null;
  display_name?: string | null;
  model?: string | null;
  brand?: string | null;
  name?: string | null;
};

const t = (v: string | null | undefined) => (v ?? "").trim();

/** Clean name for internal screens — model only, no brand duplication. */
export function productShortName(p: NameableProduct | null | undefined): string {
  if (!p) return "—";
  return t(p.short_name) || t(p.model) || t(p.name) || "—";
}

/** Full name for customer documents — "APC BX1100I-IN". */
export function productDisplayName(p: NameableProduct | null | undefined): string {
  if (!p) return "—";
  const explicit = t(p.display_name);
  if (explicit) return explicit;
  const model = t(p.model);
  const brand = t(p.brand);
  if (model) return brand ? `${brand} ${model}` : model;
  return t(p.name) || "—";
}

/** Lowercased search blob so users can match either naming form. */
export function productSearchBlob(p: NameableProduct & { sku?: string | null; category?: string | null }): string {
  return [p.short_name, p.display_name, p.model, p.brand, p.name, p.sku, p.category]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
