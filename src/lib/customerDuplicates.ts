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
