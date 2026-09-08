import type { CompanyProfile } from "@/lib/companyProfile";
import type { BranchRow } from "@/lib/sales";
import { supabase } from "@/integrations/supabase/client";

export type PoAddressSource =
  | "branch"
  | "company_registered"
  | "company_factory"
  | "company_sales";

export const PO_ADDRESS_OPTIONS: { value: PoAddressSource; label: string }[] = [
  { value: "branch", label: "Branch Address" },
  { value: "company_registered", label: "Registered Office (company)" },
  { value: "company_factory", label: "Factory Address (company)" },
  { value: "company_sales", label: "Sales Office (company)" },
];

export const DEFAULT_PO_LOGO = "/prokon-logo.jpeg";

export function resolvePoLetterhead(args: {
  source?: PoAddressSource | null;
  branch: BranchRow | null;
  company: CompanyProfile | null | undefined;
}): { address: string; officialLabel: string; source: PoAddressSource } {
  const src: PoAddressSource = args.source ?? "branch";
  const company = args.company;
  const branch = args.branch;
  const pick: Record<PoAddressSource, string | null | undefined> = {
    branch: branch?.address,
    company_registered: company?.regd_address,
    company_factory: company?.factory_address,
    company_sales: company?.sales_office_address,
  };
  const label: Record<PoAddressSource, string> = {
    branch: "Branch",
    company_registered: "Registered Office",
    company_factory: "Factory",
    company_sales: "Sales Office",
  };
  if (pick[src]) return { address: pick[src]!, officialLabel: label[src], source: src };
  if (src !== "branch" && branch?.address) return { address: branch.address, officialLabel: label[src], source: src };
  return { address: "", officialLabel: label[src], source: src };
}

export async function signPoLogoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const { data } = await supabase.storage.from("po-logos").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
