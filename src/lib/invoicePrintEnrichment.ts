import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { InvoiceAmcInfo, InvoiceProductInfo } from "@/components/invoice/InvoicePrintView";
import type { InvoiceItemRow } from "@/lib/sales";

/**
 * useInvoicePrintEnrichment — shared warranty + AMC enrichment for print views.
 *
 * Extracted verbatim from ProformaPrintView so the tax-invoice print gets the
 * same populated warranty / AMC columns that the proforma print gained in the
 * last iterations (previously the tax invoice passed no `products` / `amc`,
 * so those cells rendered "—").
 *
 * - Resolves each item's product master (by id, then by model/name) and merges
 *   any line-level warranty fields over it (line warranty wins when present).
 * - Fetches the latest AMC agreement for the customer (customer_id first,
 *   buyer GSTIN fallback). Silent fallback to null on any error.
 * - Returns `resolvedItems` (base items with `product_id` remapped so it always
 *   resolves, incl. synthetic `__enr_*` placeholders) — null while loading or
 *   on error, so callers fall back to the base items.
 */
export function useInvoicePrintEnrichment({
  baseItems,
  rawItems,
  customerId,
  buyerGstin,
  docKey,
}: {
  /** Already-shaped items for the print view (fallback while resolving). */
  baseItems: InvoiceItemRow[];
  /** Raw line objects carrying warranty/model fields (e.g. proforma JSON lines or invoice rows). */
  rawItems: any[];
  customerId?: string | null;
  buyerGstin?: string | null;
  /** Invalidation key (document id) — re-runs enrichment when the doc changes. */
  docKey?: string | null;
}): {
  products: Record<string, InvoiceProductInfo>;
  amc: InvoiceAmcInfo;
  resolvedItems: InvoiceItemRow[] | null;
} {
  const [products, setProducts] = useState<Record<string, InvoiceProductInfo>>({});
  const [amc, setAmc] = useState<InvoiceAmcInfo>(null);
  const [resolvedItems, setResolvedItems] = useState<InvoiceItemRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const warrantyFromItem = (it: any): InvoiceProductInfo | null => {
      const a: any = it;
      const wm = a.warranty_months;
      const hasWm = wm != null && Number(wm) > 0;
      const applicable =
        a.warranty_applicable != null
          ? (a.warranty_applicable as boolean | null)
          : hasWm
            ? true
            : a.warranty_duration != null && Number(a.warranty_duration) > 0
              ? true
              : null;
      const duration =
        a.warranty_duration != null
          ? Number(a.warranty_duration)
          : hasWm
            ? Number(wm)
            : null;
      const unit = a.warranty_unit || (hasWm ? "Months" : null);
      const start = a.warranty_start_from || null;
      const model = a.part_model_no || a.model || null;
      const hasWarranty = applicable != null || (duration != null && duration > 0);
      if (!hasWarranty) return null;
      return {
        model: model as string | null,
        warranty_applicable: applicable as boolean | null,
        warranty_duration: duration as number | null,
        warranty_unit: unit as string | null,
        warranty_start_from: start as string | null,
      };
    };

    const toProductInfo = (row: any): InvoiceProductInfo => ({
      model: (row.model as string | null) ?? (row.name as string | null) ?? null,
      warranty_applicable: (row.warranty_applicable as boolean | null) ?? null,
      warranty_duration: (row.warranty_duration as number | null) ?? null,
      warranty_unit: (row.warranty_unit as string | null) ?? null,
      warranty_start_from: (row.warranty_start_from as string | null) ?? null,
    });

    (async () => {
      try {
        const raw: any[] = Array.isArray(rawItems) ? rawItems : [];

        // Collect ids + model keys for lookup
        const ids = [...new Set(raw.map((it: any) => it.product_id).filter(Boolean) as string[])];
        const modelKeysRaw = raw
          .filter((it: any) => !it.product_id)
          .map((it: any) => String(it.part_model_no || it.part_name || it.product_name || "").trim())
          .filter(Boolean);
        const modelKeys = [...new Set(modelKeysRaw)];

        // Fetch products by id
        const byId = new Map<string, any>();
        if (ids.length > 0) {
          try {
            const { data } = await supabase
              .from("products")
              .select("id, model, name, warranty_applicable, warranty_duration, warranty_unit, warranty_start_from, item_type")
              .in("id", ids);
            (data || []).forEach((r: any) => byId.set(r.id, r));
          } catch {
            /* ignore — fallback to item warranty */
          }
        }

        // Fetch products by model/name for null-product items
        const byModel = new Map<string, { id: string; info: InvoiceProductInfo }>();
        if (modelKeys.length > 0) {
          try {
            const { data: byModelRows } = await supabase
              .from("products")
              .select("id, model, name, warranty_applicable, warranty_duration, warranty_unit, warranty_start_from, item_type")
              .in("model", modelKeys);
            (byModelRows || []).forEach((r: any) => {
              const k = String(r.model || "").trim().toUpperCase();
              if (k) byModel.set(k, { id: r.id, info: toProductInfo(r) });
            });
            const missing = modelKeys.filter((k) => !byModel.has(k.toUpperCase()));
            if (missing.length > 0) {
              try {
                const { data: byNameRows } = await supabase
                  .from("products")
                  .select("id, model, name, warranty_applicable, warranty_duration, warranty_unit, warranty_start_from, item_type")
                  .in("name", missing);
                (byNameRows || []).forEach((r: any) => {
                  const k = String(r.name || "").trim().toUpperCase();
                  if (k && !byModel.has(k)) byModel.set(k, { id: r.id, info: toProductInfo(r) });
                });
              } catch {
                /* ignore */
              }
            }
          } catch {
            /* ignore */
          }
        }

        // Fetch AMC for this customer (latest, active-first). Silent fallback to null.
        let amcInfo: InvoiceAmcInfo = null;
        if (customerId) {
          try {
            // Prefer customer_id match; respect is_deleted flag if present
            const { data: amcRow } = await supabase
              .from("amcs")
              .select("agreement_no, start_date, end_date, customer_id, client_gst")
              .eq("customer_id", customerId)
              .order("end_date", { ascending: false })
              .limit(1)
              .maybeSingle();
            const row: any = amcRow;
            if (row && row.agreement_no && row.start_date && row.end_date) {
              if ((row as any).is_deleted !== true) {
                amcInfo = {
                  agreement_no: String(row.agreement_no),
                  start_date: String(row.start_date),
                  end_date: String(row.end_date),
                };
              }
            }
            if (!amcInfo && buyerGstin) {
              try {
                const { data: byGst } = await supabase
                  .from("amcs")
                  .select("agreement_no, start_date, end_date, client_gst")
                  .eq("client_gst", buyerGstin)
                  .order("end_date", { ascending: false })
                  .limit(1)
                  .maybeSingle();
                const gRow: any = byGst;
                if (gRow && gRow.agreement_no && gRow.start_date && gRow.end_date) {
                  amcInfo = {
                    agreement_no: String(gRow.agreement_no),
                    start_date: String(gRow.start_date),
                    end_date: String(gRow.end_date),
                  };
                }
              } catch {
                /* ignore */
              }
            }
          } catch {
            /* ignore — AMC stays null */
          }
        }

        // Build enriched products map + remapped items (so product_id always resolves)
        const finalProducts: Record<string, InvoiceProductInfo> = {};
        const finalItems: InvoiceItemRow[] = baseItems.map((base, idx) => {
          const rawIt: any = raw[idx] || {};
          let pid: string | null = base.product_id ?? null;
          const itemW = warrantyFromItem(rawIt);
          let productInfo: InvoiceProductInfo | null = null;
          if (pid && byId.has(pid)) productInfo = toProductInfo(byId.get(pid));

          // Fallback chain: item warranty → product master → model lookup
          let chosen: InvoiceProductInfo | null = null;
          if (itemW && itemW.warranty_duration != null && Number(itemW.warranty_duration) > 0) {
            chosen = itemW;
            // Enrich missing unit/start from product when item only has months
            if ((!chosen.warranty_unit || !chosen.warranty_start_from) && productInfo) {
              chosen = {
                model: chosen.model ?? productInfo.model ?? null,
                warranty_applicable: chosen.warranty_applicable ?? productInfo.warranty_applicable ?? true,
                warranty_duration: chosen.warranty_duration ?? productInfo.warranty_duration ?? null,
                warranty_unit: chosen.warranty_unit ?? productInfo.warranty_unit ?? "Months",
                warranty_start_from: chosen.warranty_start_from ?? productInfo.warranty_start_from ?? null,
              };
            }
          } else if (productInfo) {
            chosen = productInfo;
          } else if (!pid) {
            const key = String(rawIt.part_model_no || rawIt.part_name || rawIt.product_name || "").trim().toUpperCase();
            const hit = key ? byModel.get(key) : undefined;
            if (hit) {
              pid = hit.id;
              productInfo = hit.info;
              chosen = itemW && itemW.warranty_duration ? itemW : productInfo;
            } else if (itemW) {
              chosen = itemW;
              const synthetic = `__enr_${idx}`;
              pid = synthetic;
            }
          }

          // Ensure p is truthy when we have any info or when AMC is active (so AMC badge can render)
          if (pid && chosen) {
            finalProducts[pid] = chosen;
          } else if (pid && productInfo) {
            finalProducts[pid] = productInfo;
          } else if (pid && amcInfo) {
            // Placeholder so InvoicePrintView's `p ? ... : "—"` branch still renders AMC Active
            if (!finalProducts[pid]) finalProducts[pid] = { warranty_applicable: false, warranty_duration: null, warranty_unit: null, warranty_start_from: null };
          } else if (!pid && chosen) {
            const synthetic = `__enr_${idx}`;
            pid = synthetic;
            finalProducts[synthetic] = chosen;
          } else if (!pid && amcInfo) {
            // Custom line with no product — still allow AMC badge via synthetic placeholder
            const synthetic = `__enr_${idx}`;
            pid = synthetic;
            finalProducts[synthetic] = { warranty_applicable: false, warranty_duration: null, warranty_unit: null, warranty_start_from: null };
          }

          return { ...base, product_id: pid };
        });

        if (cancelled) return;
        setProducts(finalProducts);
        setAmc(amcInfo);
        setResolvedItems(finalItems);
      } catch {
        if (cancelled) return;
        // On any unexpected error, fall back gracefully: keep dashes rather than crashing
        setProducts({});
        setAmc(null);
        setResolvedItems(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, customerId, buyerGstin, rawItems, baseItems]);

  return { products, amc, resolvedItems };
}
