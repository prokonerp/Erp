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

// Frontend cache — company profile + settings are effectively static per session.
let companyCache: Promise<CompanyProfile> | null = null;
let settingsCache: Promise<Record<LetterheadDocType, LetterheadSetting>> | null = null;

export function getCompany(): Promise<CompanyProfile> {
  if (!companyCache) companyCache = fetchCompanyProfile();
  return companyCache;
}

export function getLetterheadSettings(): Promise<Record<LetterheadDocType, LetterheadSetting>> {
  if (!settingsCache) {
    settingsCache = supabase
      .from("letterhead_settings" as never)
      .select("document_type,use_letterhead,show_supply_from")
      .then(({ data }) => {
        const out: Record<string, LetterheadSetting> = {};
        (["quotation", "sales_order", "delivery_challan", "pi", "invoice"] as const).forEach((t) => {
          out[t] = DEFAULT_SETTING(t);
        });
        ((data as LetterheadSetting[] | null) ?? []).forEach((r) => { out[r.document_type] = r; });
        return out as Record<LetterheadDocType, LetterheadSetting>;
      });
  }
  return settingsCache;
}

export function invalidateLetterheadCache() {
  companyCache = null;
  settingsCache = null;
}

/**
 * Smart header resolver. Returns the company letterhead payload when
 * the toggle for the doc type is on, otherwise null (no header).
 */
export async function getDocumentHeader(docType: LetterheadDocType): Promise<CompanyProfile | null> {
  const [company, settings] = await Promise.all([getCompany(), getLetterheadSettings()]);
  const s = settings[docType] ?? DEFAULT_SETTING(docType);
  return s.use_letterhead ? company : null;
}

export async function shouldShowSupplyFrom(docType: LetterheadDocType): Promise<boolean> {
  const settings = await getLetterheadSettings();
  return !!(settings[docType] ?? DEFAULT_SETTING(docType)).show_supply_from;
}