import { supabase } from "@/integrations/supabase/client";

export type CompanyProfile = {
  id: string;
  name: string;
  regd_address: string;
  factory_address: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo_url: string | null;
  sales_office_address: string | null;
  registered_office_address: string | null;
  accent_color: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
};

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  id: "",
  name: "PROKON HI-TECH SYSTEMS PVT. LTD.",
  regd_address: "Regd. Office: B-505, Picasso Centre, Sector-61, Gurgaon, Haryana",
  factory_address: "Factory: Plot 12, Industrial Area, Gurgaon",
  gstin: "06AAACP1234A1Z5",
  phone: "+91-124-0000000",
  email: "info@prokon.in",
  website: "www.prokon.in",
  logo_url: null,
  sales_office_address: null,
  registered_office_address: null,
  accent_color: "#1f3864",
  bank_name: null,
  bank_account_name: null,
  bank_account_number: null,
  bank_ifsc: null,
  bank_branch: null,
};

export async function fetchCompanyProfile(): Promise<CompanyProfile> {
  const { data, error } = await supabase
    .from("company_profile" as never)
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return DEFAULT_COMPANY_PROFILE;
  return data as unknown as CompanyProfile;
}

export async function saveCompanyProfile(patch: Partial<CompanyProfile>) {
  const current = await fetchCompanyProfile();
  if (current.id) {
    const { error } = await supabase
      .from("company_profile" as never)
      .update(patch as never)
      .eq("id", current.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("company_profile" as never)
    .insert({ ...DEFAULT_COMPANY_PROFILE, ...patch, id: undefined } as never);
  if (error) throw error;
}