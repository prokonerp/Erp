import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type Customer } from "@/lib/crm";
import { type ProductMaster } from "@/components/ProductPicker";

// Shared query keys for masters data. All masters pages + pickers use these so
// the data is cached once and reused across the app.
export const masterKeys = {
  all: ["masters"] as const,
  customers: () => [...masterKeys.all, "customers"] as const,
  products: () => [...masterKeys.all, "products"] as const,
  vendors: () => [...masterKeys.all, "vendors"] as const,
  employees: () => [...masterKeys.all, "employees"] as const,
  categories: () => [...masterKeys.all, "categories"] as const,
};

// Columns needed for list views + pickers (not select("*")). Edit-only fields
// are loaded on demand via useCustomerDetail/useProductDetail.
const CUSTOMER_LIST_COLS =
  "id, company, contact_name, phone, email, gst, state, customer_type, city, pan, gst_status, billing_address, shipping_address, address, remarks";
const PRODUCT_LIST_COLS =
  "id, name, sku, short_name, display_name, model, brand, category, hsn, unit, description, active, item_type, serial_tracking, is_serialized, serial_format, default_price, weight_kg, warranty_applicable, warranty_duration, warranty_unit, warranty_start_from, warranty_manual_override";
const VENDOR_LIST_COLS = "id, name, gstin, contact_name, phone, email, address";
const EMPLOYEE_LIST_COLS = "id, name, role, department, phone, email, active";

const STALE_MS = 5 * 60 * 1000; // 5 minutes — data is fresh for 5 min

export function useCustomers() {
  return useQuery({
    queryKey: masterKeys.customers(),
    queryFn: async () => {
      // Paginated fetch (bypasses 1000-row Supabase cap).
      const PAGE = 1000;
      let from = 0;
      const all: Customer[] = [];
      let count: number | null = null;
      while (true) {
        const {
          data,
          error,
          count: c,
        } = await supabase
          .from("customers")
          .select(CUSTOMER_LIST_COLS, { count: "exact" })
          .order("company")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (c != null) count = c;
        all.push(...((data || []) as unknown as Customer[]));
        if ((data || []).length < PAGE) break;
        from += PAGE;
      }
      return { rows: all, count };
    },
    staleTime: STALE_MS,
  });
}

export function useProducts() {
  return useQuery({
    queryKey: masterKeys.products(),
    queryFn: async () => {
      // Paginated fetch (bypasses 1000-row Supabase cap).
      const PAGE = 1000;
      let from = 0;
      const all: ProductMaster[] = [];
      while (true) {
        const { data, error } = await supabase
          .from("products")
          .select(PRODUCT_LIST_COLS)
          .order("name")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        all.push(...((data || []) as unknown as ProductMaster[]));
        if ((data || []).length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
    staleTime: STALE_MS,
  });
}

export function useVendors() {
  return useQuery({
    queryKey: masterKeys.vendors(),
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select(VENDOR_LIST_COLS).order("name");
      if (error) throw error;
      return (data || []) as unknown as any[];
    },
    staleTime: STALE_MS,
  });
}

export function useEmployees() {
  return useQuery({
    queryKey: masterKeys.employees(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select(EMPLOYEE_LIST_COLS)
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as any[];
    },
    staleTime: STALE_MS,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: masterKeys.categories(),
    queryFn: async () => {
      const { data } = await supabase
        .from("product_categories" as any)
        .select("name")
        .order("name");
      return ((data || []) as unknown as { name: string }[]).map((c) => c.name);
    },
    staleTime: STALE_MS,
  });
}

/** Full customer row (edit form needs columns not present in the list view). */
export function useCustomerDetail(id: string | null) {
  return useQuery({
    queryKey: [...masterKeys.customers(), "detail", id] as const,
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("*")
        .eq("id", id as string)
        .single();
      return data as unknown as Customer;
    },
    enabled: !!id,
  });
}

/** Full product row (edit form needs serial/warranty/tax fields not in the list). */
export function useProductDetail(id: string | null) {
  return useQuery({
    queryKey: [...masterKeys.products(), "detail", id] as const,
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("id", id as string)
        .single();
      return data as unknown as ProductMaster;
    },
    enabled: !!id,
  });
}
