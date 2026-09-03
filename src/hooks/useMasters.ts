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
      // Parallel paginated fetch — first page gets count, remaining pages fetched concurrently.
      // Cuts 2s sequential (4×500ms) to ~400ms and benefits from stale cache for fractions-of-ms subsequent opens.
      const PAGE = 1000;
      const first = await supabase
        .from("customers")
        .select(CUSTOMER_LIST_COLS, { count: "exact" })
        .order("company")
        .range(0, PAGE - 1);
      if (first.error) throw first.error;
      const all: Customer[] = [...((first.data || []) as unknown as Customer[])];
      let count: number | null = first.count ?? null;
      if (count != null && count > PAGE) {
        const pages = Math.ceil(count / PAGE);
        const promises: Promise<any>[] = [];
        for (let p = 1; p < pages; p++) {
          promises.push(
            (supabase
              .from("customers")
              .select(CUSTOMER_LIST_COLS)
              .order("company")
              .range(p * PAGE, p * PAGE + PAGE - 1) as unknown as Promise<any>),
          );
        }
        const results = await Promise.all(promises);
        for (const r of results) {
          if (r.error) throw r.error;
          all.push(...((r.data || []) as unknown as Customer[]));
        }
      } else if (count == null && first.data.length === PAGE) {
        // Fallback when count not returned — fetch remaining sequentially but in parallel batches
        let from = PAGE;
        while (true) {
          const { data, error } = await supabase
            .from("customers")
            .select(CUSTOMER_LIST_COLS)
            .order("company")
            .range(from, from + PAGE - 1);
          if (error) throw error;
          all.push(...((data || []) as unknown as Customer[]));
          if ((data || []).length < PAGE) break;
          from += PAGE;
        }
      }
      return { rows: all, count };
    },
    staleTime: STALE_MS,
    gcTime: 10 * 60 * 1000,
  });
}

// Lightweight picker query — server-side search, not full download.
// Returns only top N matches for the current search term. Falls back to small
// initial list when search is empty (first 25 by company). This makes the
// picker open in fractions-of-ms vs loading 3101 rows.
const CUSTOMER_PICKER_COLS = "id, company, contact_name, phone, email, gst, state, city, billing_address, shipping_address, address";
export function useCustomersForPicker(search: string = "") {
  const term = search.trim();
  return useQuery({
    queryKey: [...masterKeys.customers(), "picker", term] as const,
    queryFn: async () => {
      const cols = CUSTOMER_PICKER_COLS;
      // Empty term → first 25 alphabetically (instant, tiny payload)
      if (!term) {
        const { data, error } = await supabase
          .from("customers")
          .select(cols)
          .order("company")
          .limit(25);
        if (error) throw error;
        return { rows: (data || []) as unknown as Customer[], count: 25 };
      }
      // Server-side ilike search across indexed columns + limit 30
      const q = `%${term}%`;
      const { data, error } = await supabase
        .from("customers")
        .select(cols)
        .or(`company.ilike.${q},contact_name.ilike.${q},phone.ilike.${q},gst.ilike.${q},city.ilike.${q}`)
        .order("company")
        .limit(30);
      if (error) throw error;
      return { rows: (data || []) as unknown as Customer[], count: (data || []).length };
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    keepPreviousData: true,
  } as any);
}

// Production-grade paginated table query for Customer Master.
// Server filters + sorts + paginates — avoids downloading 3101 rows and
// rendering 3000+ DOM nodes. Use this for the master list, not the picker.
export function useCustomersTable(opts: {
  search: string;
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}) {
  const { search, page, pageSize, sortBy = "company", sortDir = "asc" } = opts;
  const term = search.trim();
  return useQuery({
    queryKey: [...masterKeys.customers(), "table", { term, page, pageSize, sortBy, sortDir }] as const,
    queryFn: async () => {
      let q = supabase.from("customers").select(CUSTOMER_LIST_COLS, { count: "exact" });
      if (term) {
        const p = `%${term}%`;
        q = q.or(`company.ilike.${p},contact_name.ilike.${p},phone.ilike.${p},gst.ilike.${p},state.ilike.${p},city.ilike.${p}`);
      }
      q = q.order(sortBy, { ascending: sortDir === "asc", nullsFirst: sortDir === "asc" }).range(page * pageSize, (page + 1) * pageSize - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as unknown as Customer[], count: count ?? 0 };
    },
    staleTime: 30 * 1000,
    keepPreviousData: true,
  } as any);
}

export function useProducts() {
  return useQuery({
    queryKey: masterKeys.products(),
    queryFn: async () => {
      // Small table (235 rows) — single page is enough, but keep parallel-ready
      const { data, error } = await supabase
        .from("products")
        .select(PRODUCT_LIST_COLS)
        .order("name")
        .limit(1000);
      if (error) throw error;
      return (data || []) as unknown as ProductMaster[];
    },
    staleTime: STALE_MS,
    gcTime: 10 * 60 * 1000,
  });
}

// Lightweight product picker — server search, 25 row limit, instant open
export function useProductsForPicker(search: string = "") {
  const term = search.trim();
  return useQuery({
    queryKey: [...masterKeys.products(), "picker", term] as const,
    queryFn: async () => {
      if (!term) {
        const { data, error } = await supabase
          .from("products")
          .select("id, name, model, short_name, display_name, brand, category, hsn, unit, is_serialized, serial_tracking")
          .eq("active", true)
          .order("name")
          .limit(25);
        if (error) throw error;
        return (data || []) as unknown as ProductMaster[];
      }
      const q = `%${term}%`;
      const { data, error } = await supabase
        .from("products")
        .select("id, name, model, short_name, display_name, brand, category, hsn, unit, is_serialized, serial_tracking")
        .or(`name.ilike.${q},model.ilike.${q},brand.ilike.${q},category.ilike.${q}`)
        .eq("active", true)
        .order("name")
        .limit(30);
      if (error) throw error;
      return (data || []) as unknown as ProductMaster[];
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: (prev: any) => prev,
  } as any);
}

export function useProductsTable(opts: {
  search: string;
  category: string;
  brand: string;
  page: number;
  pageSize: number;
}) {
  const { search, category, brand, page, pageSize } = opts;
  const term = search.trim();
  return useQuery({
    queryKey: [...masterKeys.products(), "table", { term, category, brand, page, pageSize }] as const,
    queryFn: async () => {
      let q = supabase.from("products").select(PRODUCT_LIST_COLS, { count: "exact" });
      if (term) {
        const p = `%${term}%`;
        q = q.or(`name.ilike.${p},model.ilike.${p},brand.ilike.${p},category.ilike.${p},hsn.ilike.${p}`);
      }
      if (category !== "__all") q = q.eq("category", category);
      if (brand !== "__all") q = q.eq("brand", brand);
      q = q.order("name").range(page * pageSize, (page + 1) * pageSize - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data || []) as unknown as ProductMaster[], count: count ?? 0 };
    },
    staleTime: 30 * 1000,
    placeholderData: (prev: any) => prev,
  } as any);
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
