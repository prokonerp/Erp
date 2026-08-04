import { supabase } from "@/integrations/supabase/client";

export type CustomerSite = {
  id: string;
  customer_id: string;
  site_name: string;
  address: string | null;
  created_at?: string;
};

export async function fetchCustomerSites(customerId: string): Promise<CustomerSite[]> {
  const { data, error } = await supabase
    .from("customer_sites")
    .select("id,customer_id,site_name,address,created_at")
    .eq("customer_id", customerId)
    .order("site_name");
  if (error) throw new Error(error.message);
  return (data || []) as CustomerSite[];
}

/** Warranty state from an end date — same colour language as the AMC dashboard. */
export type WarrantyState = "active" | "expiring" | "expired" | "none";

export const warrantyState = (end?: string | null): WarrantyState => {
  if (!end) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(end.slice(0, 10) + "T00:00:00");
  const days = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "active";
};

export const warrantyBadgeClass = (s: WarrantyState) =>
  s === "active"
    ? "bg-green-100 text-green-800 border-green-300"
    : s === "expiring"
    ? "bg-orange-100 text-orange-800 border-orange-300"
    : s === "expired"
    ? "bg-red-100 text-red-800 border-red-300"
    : "bg-muted text-muted-foreground border-border";

export const warrantyLabel = (s: WarrantyState) =>
  s === "active" ? "In warranty" : s === "expiring" ? "Expiring soon" : s === "expired" ? "Expired" : "No warranty";
