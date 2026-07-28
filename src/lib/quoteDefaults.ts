import { supabase } from "@/integrations/supabase/client";

export type QuoteDefaults = { terms: string; notes: string; business_state: string };

let cached: QuoteDefaults | null = null;
let inflight: Promise<QuoteDefaults> | null = null;

/**
 * Resolve default Customer notes & Terms for quotations for ANY signed-in user
 * (admin or not). Fallback chain:
 *   terms: crm_settings.default_terms -> default terms template -> first template
 *   notes: crm_settings.default_customer_notes -> "Thanks for your business."
 */
export async function getQuoteDefaults(): Promise<QuoteDefaults> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      const out: QuoteDefaults = { terms: "", notes: "Thanks for your business.", business_state: "Haryana" };
      try {
        const [{ data: s }, { data: tpl }] = await Promise.all([
          supabase.from("crm_settings").select("business_state,default_terms,default_customer_notes").eq("id", 1).maybeSingle(),
          supabase.from("quote_terms_templates").select("body,is_default,sort_order").order("is_default", { ascending: false }).order("sort_order"),
        ]);
        const row = s as { business_state?: string | null; default_terms?: string | null; default_customer_notes?: string | null } | null;
        if (row?.business_state) out.business_state = row.business_state;
        if (row?.default_customer_notes) out.notes = row.default_customer_notes;
        if (row?.default_terms && row.default_terms.trim()) out.terms = row.default_terms;
        if (!out.terms) {
          const list = (tpl || []) as { body?: string | null }[];
          const body = list.find((t) => (t.body || "").trim())?.body || "";
          out.terms = body;
        }
      } catch { /* keep fallbacks */ }
      cached = out;
      return out;
    })();
  }
  return inflight;
}

export function resetQuoteDefaultsCache() {
  cached = null;
  inflight = null;
}
