import { supabase } from "@/integrations/supabase/client";

export type CustomerSuggestion = {
  id: string;
  customer_code: string | null;
  company: string;
  customer_type: string;
  gst: string | null;
  phone: string | null;
  city: string | null;
  score: number | null;
};

export type DuplicateHit = {
  existing_customer_id: string;
  customer_code: string | null;
  company: string;
  matched_field: "gstin" | "mobile";
  matched_value: string | null;
};

/** Soft duplicate detection — up to 10 similar customers by name (>= 3 chars). */
export async function searchCustomersByName(searchText: string): Promise<CustomerSuggestion[]> {
  const q = (searchText || "").trim();
  if (q.length < 3) return [];
  const { data, error } = await (supabase as any).rpc("search_customers_by_name", { search_text: q });
  if (error) return [];
  return (data || []) as CustomerSuggestion[];
}

/**
 * Hard duplicate validation — server-side authority.
 * Business → GSTIN, Individual → mobile. Excludes the record being edited.
 */
export async function checkCustomerDuplicate(input: {
  customerType: string;
  gst?: string | null;
  phone?: string | null;
  currentCustomerId?: string | null;
}): Promise<DuplicateHit | null> {
  const { data, error } = await (supabase as any).rpc("check_customer_duplicate", {
    p_customer_type: input.customerType,
    p_gst: input.gst ?? null,
    p_phone: input.phone ?? null,
    p_current_id: input.currentCustomerId ?? null,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    existing_customer_id: row.existing_customer_id,
    customer_code: row.customer_code ?? null,
    company: row.company,
    matched_field: row.matched_field,
    matched_value: row.matched_value ?? null,
  };
}

/** Human-readable message for a DB unique-violation on customers. */
export function describeUniqueViolation(message: string): string | null {
  if (message.includes("customers_business_gstin_uidx")) return "A Business customer with this GSTIN already exists.";
  if (message.includes("customers_individual_mobile_uidx")) return "An Individual customer with this mobile number already exists.";
  return null;
}

export const normGst = (v: string | null | undefined) => (v || "").trim().toUpperCase();
export const normMobile = (v: string | null | undefined) => (v || "").replace(/\D/g, "");

/** Existing GSTIN (Business) and mobile (Individual) keys, for import de-duplication. */
export async function loadExistingIdentifierSets(): Promise<{ gstins: Set<string>; mobiles: Set<string> }> {
  const gstins = new Set<string>();
  const mobiles = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("customers")
      .select("customer_type, gst, phone")
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    for (const r of data as any[]) {
      if (r.customer_type === "Business") {
        const g = normGst(r.gst);
        if (g && g !== "URP") gstins.add(g);
      } else {
        const m = normMobile(r.phone);
        if (m) mobiles.add(m);
      }
    }
    if (data.length < PAGE) break;
  }
  return { gstins, mobiles };
}

/**
 * Splits candidate import rows into unique vs duplicate, checking both the
 * file itself and the database. Mutates the provided sets so callers can chain.
 */
export function partitionCustomerImportRows<T extends { customer_type?: string; gst?: string | null; phone?: string | null }>(
  rows: T[],
  sets: { gstins: Set<string>; mobiles: Set<string> },
): { unique: T[]; duplicates: { row: T; reason: string }[] } {
  const unique: T[] = [];
  const duplicates: { row: T; reason: string }[] = [];
  for (const row of rows) {
    const isBiz = (row.customer_type || "Business") === "Business";
    if (isBiz) {
      const g = normGst(row.gst);
      if (g && g !== "URP") {
        if (sets.gstins.has(g)) { duplicates.push({ row, reason: `Duplicate GSTIN ${g}` }); continue; }
        sets.gstins.add(g);
      }
    } else {
      const m = normMobile(row.phone);
      if (m) {
        if (sets.mobiles.has(m)) { duplicates.push({ row, reason: `Duplicate mobile ${m}` }); continue; }
        sets.mobiles.add(m);
      }
    }
    unique.push(row);
  }
  return { unique, duplicates };
}
