import { supabase } from "@/integrations/supabase/client";
import { fetchCompanyProfile, type CompanyProfile } from "@/lib/companyProfile";

export type LetterheadDocType =
  | "quotation"
  | "sales_order"
  | "delivery_challan"
  | "pi"
  | "invoice";

export type LetterheadSetting = {
  document_type: LetterheadDocType;
  use_letterhead: boolean;
  show_supply_from: boolean;
};

const DEFAULT_SETTING = (t: LetterheadDocType): LetterheadSetting => ({
  document_type: t,
  use_letterhead: true,
  show_supply_from: false,
});

export function getCompany(): Promise<CompanyProfile> {
  return fetchCompanyProfile();
}

export function getLetterheadSettings(): Promise<Record<LetterheadDocType, LetterheadSetting>> {
  return (async () => {
    const { data } = await supabase
      .from("letterhead_settings" as never)
      .select("document_type,use_letterhead,show_supply_from");
    const out: Record<string, LetterheadSetting> = {};
    (["quotation", "sales_order", "delivery_challan", "pi", "invoice"] as const).forEach((t) => {
      out[t] = DEFAULT_SETTING(t);
    });
    ((data as LetterheadSetting[] | null) ?? []).forEach((r) => { out[r.document_type] = r; });
    return out as Record<LetterheadDocType, LetterheadSetting>;
  })();
}

export function invalidateLetterheadCache() {
  // Company headers are deliberately uncached while header rebinding is verified.
}

/**
 * Temporary hard override: every document header uses Company Master only.
 */
export function getDocumentHeader(): Promise<CompanyProfile> {
  return getCompany();
}

/** Read the stored toggle for one document type (defaults when unset). */
export async function shouldShowSupplyFrom(docType?: LetterheadDocType): Promise<boolean> {
  const settings = await getLetterheadSettings();
  const key = docType ?? "invoice";
  return settings[key]?.show_supply_from ?? DEFAULT_SETTING(key).show_supply_from;
}

export async function shouldUseLetterhead(docType?: LetterheadDocType): Promise<boolean> {
  const settings = await getLetterheadSettings();
  const key = docType ?? "invoice";
  return settings[key]?.use_letterhead ?? DEFAULT_SETTING(key).use_letterhead;
}