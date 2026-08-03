import { supabase } from "@/integrations/supabase/client";
import { toTitleCaseSmart, upperTrim } from "@/lib/text";
import { type Customer } from "@/lib/crm";

export type QuickCustomerInput = {
  company: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  gst?: string;
  state?: string;
};

/**
 * Lean customer insert used by the inline "Quick Add Customer" modal.
 * Mirrors the normalisation rules of the full Customer Master form
 * (title-cased names, upper-cased GSTIN, lower-cased email).
 */
export async function createQuickCustomer(input: QuickCustomerInput): Promise<Customer> {
  const company = toTitleCaseSmart(input.company.trim());
  if (!company) throw new Error("Company name is required");

  const contact = toTitleCaseSmart((input.contact_name || "").trim());
  const payload = {
    customer_type: "Business",
    company,
    contact_name: contact || company,
    first_name: contact ? contact.split(" ")[0] : null,
    phone: input.phone?.trim() || null,
    phone_area_code: "+91",
    email: input.email?.trim().toLowerCase() || null,
    gst: input.gst ? upperTrim(input.gst) : null,
    state: input.state || null,
    billing_state: input.state || null,
    shipping_state: input.state || null,
    place_of_supply: input.state || null,
    country: "India",
  };

  const { data, error } = await supabase.from("customers").insert(payload as any).select("*").single();
  if (error) throw new Error(error.message);
  return data as unknown as Customer;
}
