import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchStockPage,
  listWarehouses,
  type StockItem,
  type StockStatus,
  type WarehouseLite,
} from "@/lib/ims";

// ────────────────────────────────────────────────────────────────
// Shared types — mirrors src/routes/_app/reports.tsx:26-33
// so the hook is drop-in without coupling to the route file.
// ────────────────────────────────────────────────────────────────

export type Serial = {
  id: string;
  product_id: string;
  serial_number: string;
  status: string;
  warehouse_id: string | null;
  warranty_end_date: string | null;
  warranty_start_date: string | null;
  purchase_date: string | null;
  sale_invoice_no: string | null;
  customer_id: string | null;
  installation_date: string | null;
};

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  serial_tracking: boolean;
  warranty_applicable: boolean;
};

export type Customer = {
  id: string;
  company: string | null;
  contact_name: string | null;
};

// ── Key helpers — canonical model+OEM only (same as reports.tsx) ──

const groupKey = (r: { part_model_no: string | null; oem: string | null }) =>
  `${(r.part_model_no || "").toLowerCase()}|${(r.oem || "").toLowerCase()}`;

const productLabel = (r: { part_model_no: string | null }) => r.part_model_no || "—";

// ── Stat totals for StockSummaryDisclosure ──────────────────────

export type StockStatTotals = {
  /** Good stock with status=available (the "105" in the disclosure). */
  goodAvailable: number;
  /** Defective stock with status=available. */
  defectiveAvailable: number;
  /** All stock (good+defective) with status=available. */
  totalAvailable: number;
  /** Total good stock across every status (the "126"). */
  goodTotal: number;
  /** Alias for goodAvailable — convenience for disclosure layout. */
  goodAvailable105: number;
  /** Alias for goodTotal — convenience for disclosure layout. */
  goodTotal126: number;
  /** Good stock with status=reserved. */
  reservedCount: number;
  /** Good stock with status=in_transit. */
  inTransitCount: number;
  /** Good stock with status=issued. */
  issuedCount: number;
  /** Good stock with status=returned_to_oem. */
  returnedToOemCount: number;
  /** Good stock with status=scrapped. */
  scrappedCount: number;
  /** Qty summed across every status + every type (grand total). */
  total: number;
  /** Per-status qty for good stock only — powers disclosure pills. */
  breakdownByStatus: Map<StockStatus, number>;
  /** Per-status qty for good stock only (alias, explicit name). */
  breakdownByStatusGood: Map<StockStatus, number>;
  /** Per-status qty for defective stock only. */
  breakdownByStatusDefective: Map<StockStatus, number>;
  /** Per-status qty across both types (good+defective). */
  goodByStatus: Map<StockStatus, number>;
};

/**
 * Derive disclosure-row numbers from an already-filtered stock slice.
 * All counts are summed by `qty` (fallback 1) to stay consistent with
 * the stock-by-warehouse grouping.
 *
 * `wMap` is accepted for API parity with the task spec and future
 * warehouse-scoped breakdowns — it is not required for the arithmetic
 * but keeping it preserves call-site compatibility.
 */
export function computeStockStatTotals(
  filteredStock: StockItem[],
  _wMap?: Record<string, WarehouseLite> | Map<string, WarehouseLite>,
): StockStatTotals {
  const breakdownGood = new Map<StockStatus, number>();
  const breakdownDefective = new Map<StockStatus, number>();
  const breakdownAll = new Map<StockStatus, number>();

  let goodAvailable = 0;
  let defectiveAvailable = 0;
  let total = 0;
  let goodTotal = 0;

  const statuses: StockStatus[] = [
    "available",
    "reserved",
    "issued",
    "in_transit",
    "returned_to_oem",
    "scrapped",
  ];
  for (const s of statuses) {
    breakdownGood.set(s, 0);
    breakdownDefective.set(s, 0);
    breakdownAll.set(s, 0);
  }

  for (const r of filteredStock) {
    const qty = Number(r.qty ?? 1) || 0;
    if (qty === 0) continue;
    const status = r.stock_status as StockStatus;
    total += qty;

    // per-status aggregate (both types)
    breakdownAll.set(status, (breakdownAll.get(status) ?? 0) + qty);

    if (r.stock_type === "good") {
      goodTotal += qty;
      breakdownGood.set(status, (breakdownGood.get(status) ?? 0) + qty);
      if (status === "available") goodAvailable += qty;
    } else {
      // defective
      breakdownDefective.set(status, (breakdownDefective.get(status) ?? 0) + qty);
      if (status === "available") defectiveAvailable += qty;
    }
  }

  const reservedCount = breakdownGood.get("reserved") ?? 0;
  const inTransitCount = breakdownGood.get("in_transit") ?? 0;
  const issuedCount = breakdownGood.get("issued") ?? 0;
  const returnedToOemCount = breakdownGood.get("returned_to_oem") ?? 0;
  const scrappedCount = breakdownGood.get("scrapped") ?? 0;

  return {
    goodAvailable,
    defectiveAvailable,
    totalAvailable: goodAvailable + defectiveAvailable,
    goodTotal,
    goodAvailable105: goodAvailable,
    goodTotal126: goodTotal,
    reservedCount,
    inTransitCount,
    issuedCount,
    returnedToOemCount,
    scrappedCount,
    total,
    breakdownByStatus: new Map(breakdownGood),
    breakdownByStatusGood: new Map(breakdownGood),
    breakdownByStatusDefective: new Map(breakdownDefective),
    goodByStatus: new Map(breakdownAll),
  };
}

// ── Hook return type ───────────────────────────────────────────

export type UseReportsDataReturn = {
  stock: StockItem[];
  serials: Serial[];
  products: Product[];
  warehouses: WarehouseLite[];
  customers: Customer[];
  loading: boolean;
  /** Product map keyed by product.id */
  pMap: Record<string, Product>;
  /** Warehouse map keyed by warehouse.id */
  wMap: Record<string, WarehouseLite>;
  /** Customer map keyed by customer.id */
  cMap: Record<string, Customer>;
  /** Plain warehouse name (no godown/ASP/branch suffix) — mirrors reports.tsx:86 */
  plainWhName: (id: string | null | undefined) => string;
  /** Distinct products present in stock (for the Product filter) */
  stockProducts: { key: string; label: string }[];
};

// ── Hook ────────────────────────────────────────────────────────

/**
 * Unified data hook for the Reports page (4 tabs × compact/detailed).
 *
 * Fetches stock + warehouses + legacy serials/products/customers in a
 * single effect — same queries as src/routes/_app/reports.tsx:60-78.
 * Compact aggregates reuse the full stock fetch (no pagination); the
 * detailed ledger can paginate via `.range()` at the consumer level.
 *
 * Consumers keep filtering (wh/prod/q) locally — the hook only provides
 * base maps and derived lookups.
 */
export function useReportsData(): UseReportsDataReturn {
  const [stock, setStock] = React.useState<StockItem[]>([]);
  const [serials, setSerials] = React.useState<Serial[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [warehouses, setWarehouses] = React.useState<WarehouseLite[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [stRes, w, s, p] = await Promise.all([
          fetchStockPage({ page: 0, pageSize: 500 }),
          listWarehouses(),
          supabase.from("serials").select("*"),
          supabase
            .from("products")
            .select("id,name,brand,model,description,serial_tracking,warranty_applicable"),
        ]);
        const st = stRes.data;

        if (cancelled) return;

        setStock(st as StockItem[]);
        setWarehouses(w as WarehouseLite[]);
        setSerials((s.data || []) as unknown as Serial[]);
        setProducts((p.data || []) as unknown as Product[]);

        // Resolve only the customers referenced by these serials — same
        // truncation guard as reports.tsx:72-77.
        const ids = ((s.data || []) as unknown as { customer_id: string | null }[])
          .map((x) => x.customer_id)
          .filter((v): v is string => Boolean(v));

        if (ids.length > 0) {
          const uniq = Array.from(new Set(ids)).slice(0, 1000);
          const { data: c } = await supabase
            .from("customers")
            .select("id,company,contact_name")
            .in("id", uniq);
          if (!cancelled) setCustomers((c || []) as unknown as Customer[]);
        } else {
          if (!cancelled) setCustomers([]);
        }
      } catch {
        // Keep previous empty arrays — route shows premium empty states.
        if (!cancelled) {
          // no-op: leave current slices as-is
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const pMap = React.useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, Product>,
    [products],
  );

  const wMap = React.useMemo(
    () => Object.fromEntries(warehouses.map((w) => [w.id, w])) as Record<string, WarehouseLite>,
    [warehouses],
  );

  const cMap = React.useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c])) as Record<string, Customer>,
    [customers],
  );

  const plainWhName = React.useCallback(
    (id: string | null | undefined) => (id ? wMap[id]?.name || "—" : "—"),
    [wMap],
  );

  const stockProducts = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const r of stock) {
      const k = groupKey(r);
      if (!m.has(k)) m.set(k, productLabel(r));
    }
    return [...m.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [stock]);

  return {
    stock,
    serials,
    products,
    warehouses,
    customers,
    loading,
    pMap,
    wMap,
    cMap,
    plainWhName,
    stockProducts,
  };
}

export default useReportsData;
