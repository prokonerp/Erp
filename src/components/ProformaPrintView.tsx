import { useEffect, useMemo, useState } from "react";
import { InvoicePrintView } from "@/components/invoice/InvoicePrintView";
import type { CompanyProfile } from "@/lib/companyProfile";
import type { ProformaRow } from "@/lib/proforma";
import type { SalesOrder, SoFulfillmentSummary } from "@/lib/salesOrders";
import type { BranchRow, InvoiceItemRow, InvoiceRow } from "@/lib/sales";
import type { InvoiceAmcInfo, InvoiceProductInfo } from "@/components/invoice/InvoicePrintView";
import { supabase } from "@/integrations/supabase/client";

/**
 * ProformaPrintView — EXACT same green premium layout as InvoicePrintView (tax invoice).
 * Wrapper that maps ProformaRow → InvoiceRow shape and delegates to InvoicePrintView with variant="proforma".
 * Guarantees pixel-identical structure: header (PROKON + APC), meta grid, Bill/Ship, items (GST split), totals, payment, terms, signature (image above FOR), footer.
 * Stock: NOT APPLICABLE — Proforma is read-only, no warehouse/serial columns, skip_stock_posting in writers.
 */
export function ProformaPrintView({
  proforma,
  company,
  branch,
  so: _so,
  fulfillments: _fulfillments,
  authorised_signature_url,
  docId: _docId,
  soConversions: _soConversions,
}: {
  proforma: ProformaRow;
  company: CompanyProfile;
  branch?: { name?: string | null } | null;
  so?: SalesOrder | null;
  fulfillments?: SoFulfillmentSummary[] | null;
  authorised_signature_url?: string | null;
  docId?: string | null;
  soConversions?: any[] | null;
}) {
  // Map ProformaRow → InvoiceRow (invoice core is subset; extra proforma fields dropped)
  const invoiceLike: InvoiceRow = useMemo(
    () =>
      ({
        id: proforma.id,
        invoice_no: proforma.proforma_no,
        invoice_date: proforma.proforma_date,
        due_date: null,
        branch_id: proforma.branch_id || "",
        customer_id: proforma.customer_id || "",
        seller_name: proforma.seller_name || company.name,
        seller_gstin: proforma.seller_gstin || company.gstin,
        seller_state: proforma.seller_state || null,
        seller_state_code: proforma.seller_state_code || null,
        seller_address: proforma.seller_address || company.regd_address,
        buyer_name: proforma.buyer_name,
        buyer_gstin: proforma.buyer_gstin,
        buyer_state: proforma.buyer_state,
        buyer_state_code: proforma.buyer_state_code,
        billing_address: proforma.billing_address,
        shipping_address: proforma.shipping_address,
        place_of_supply: proforma.place_of_supply,
        place_of_supply_code: proforma.place_of_supply_code,
        is_interstate: !!proforma.is_interstate,
        sales_type: null,
        is_tax_inclusive: false,
        supply_class: null,
        lut_no: null,
        transport_details: null,
        reverse_charge: !!proforma.reverse_charge,
        linked_quote_id: null,
        linked_dc_ids: null,
        po_number: proforma.po_number,
        po_date: proforma.po_date,
        subtotal: Number(proforma.subtotal) || 0,
        discount: Number(proforma.discount) || 0,
        taxable_value: Number(proforma.taxable_value) || 0,
        cgst: Number(proforma.cgst) || 0,
        sgst: Number(proforma.sgst) || 0,
        igst: Number(proforma.igst) || 0,
        cess: Number(proforma.cess) || 0,
        round_off: Number(proforma.round_off) || 0,
        total: Number(proforma.total) || 0,
        total_paid: 0,
        total_in_words: proforma.total_in_words,
        status: proforma.status as any,
        cancel_reason: proforma.cancelled_reason || null,
        cancelled_at: proforma.cancelled_at || null,
        irn: null,
        ack_no: null,
        ack_date: null,
        qr_payload: null,
        einvoice_status: null,
        einvoice_error: null,
        ewaybill_no: null,
        ewaybill_date: null,
        ewaybill_valid_till: null,
        notes: proforma.notes,
        terms: proforma.terms,
        pdf_url: null,
        payment_terms: (proforma as any).payment_terms ?? null,
        created_by: proforma.created_by,
        created_at: proforma.created_at,
        updated_at: proforma.updated_at,
      }) as unknown as InvoiceRow,
    [proforma, company],
  );

  // Base items (before warranty/AMC enrichment) — used as fallback while async fetch runs.
  const baseItemsLike: InvoiceItemRow[] = useMemo(
    () =>
      (Array.isArray(proforma.items) ? proforma.items : []).map((it: any, idx: number) => {
        const qty = Number(it.qty) || 0;
        const rate = Number(it.rate) || 0;
        const disc = Number(it.discount_pct) || 0;
        const gst = Number(it.gst_rate) || 0;
        const gross = qty * rate;
        const discAmt = gross * (disc / 100);
        const computedTaxable = gross - discAmt;
        const taxable = it.taxable_value != null ? Number(it.taxable_value) : computedTaxable;
        const isInter = !!proforma.is_interstate;
        const cg = it.cgst != null ? Number(it.cgst) : isInter ? 0 : (taxable * (gst / 2)) / 100;
        const sg = it.sgst != null ? Number(it.sgst) : isInter ? 0 : (taxable * (gst / 2)) / 100;
        const ig = it.igst != null ? Number(it.igst) : isInter ? (taxable * gst) / 100 : 0;
        const cess = it.cess != null ? Number(it.cess) : 0;
        const lineTotal = taxable + cg + sg + ig + cess;
        return {
          id: `pi-${idx}`,
          invoice_id: proforma.id,
          sr_no: idx + 1,
          product_id: it.product_id || null,
          description: it.description || it.part_name || "",
          hsn: it.hsn || null,
          qty,
          unit: it.unit || "Nos",
          rate,
          discount_pct: disc,
          taxable_value: taxable,
          gst_rate: gst,
          cgst: cg,
          sgst: sg,
          igst: ig,
          cess,
          line_total: Number(it.line_total) || lineTotal,
          warehouse_id: null,
          serial_numbers: [],
        } as InvoiceItemRow;
      }),
    [proforma.items, proforma.id, proforma.is_interstate],
  );

  const customerLike = useMemo(
    () => ({
      company: proforma.buyer_name || "",
      contact_name: (proforma as any).contact_person || null,
      phone: (proforma as any).contact_mobile || null,
      email: (proforma as any).contact_email || null,
      gst: proforma.buyer_gstin || null,
      state: proforma.buyer_state || null,
      address: proforma.billing_address || null,
      billing_address: proforma.billing_address || null,
      shipping_address: proforma.shipping_address || null,
    }),
    [proforma],
  );

  // BranchRow minimal for InvoicePrintView header (name/address for warehouseFallback, bank etc)
  const branchLike = useMemo(
    () => (branch ? ({ name: (branch as any).name || null, address: null } as unknown as BranchRow) : null),
    [branch],
  );

  // ---- Warranty + AMC enrichment (fetched, with graceful fallback to "—") ------------
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
        const rawItems: any[] = Array.isArray(proforma.items) ? proforma.items : [];

        // Collect ids + model keys for lookup
        const ids = [...new Set(rawItems.map((it: any) => it.product_id).filter(Boolean) as string[])];
        const modelKeysRaw = rawItems
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
        if (proforma.customer_id) {
          try {
            // Prefer customer_id match; respect is_deleted flag if present
            const { data: amcRow } = await supabase
              .from("amcs")
              .select("agreement_no, start_date, end_date, customer_id, client_gst")
              .eq("customer_id", proforma.customer_id)
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
            if (!amcInfo && proforma.buyer_gstin) {
              try {
                const { data: byGst } = await supabase
                  .from("amcs")
                  .select("agreement_no, start_date, end_date, client_gst")
                  .eq("client_gst", proforma.buyer_gstin)
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
        const finalItems: InvoiceItemRow[] = baseItemsLike.map((base, idx) => {
          const raw: any = rawItems[idx] || {};
          let pid: string | null = base.product_id ?? null;
          const itemW = warrantyFromItem(raw);
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
            const key = String(raw.part_model_no || raw.part_name || raw.product_name || "").trim().toUpperCase();
            const hit = key ? byModel.get(key) : undefined;
            if (hit) {
              pid = hit.id;
              productInfo = hit.info;
              chosen = itemW && itemW.warranty_duration ? itemW : productInfo;
            } else if (itemW) {
              chosen = itemW;
              const synthetic = `__pi_${idx}`;
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
            const synthetic = `__pi_${idx}`;
            pid = synthetic;
            finalProducts[synthetic] = chosen;
          } else if (!pid && amcInfo) {
            // Custom line with no product — still allow AMC badge via synthetic placeholder
            const synthetic = `__pi_${idx}`;
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
  }, [proforma.id, proforma.customer_id, proforma.buyer_gstin, proforma.items, baseItemsLike]);

  const itemsForView = resolvedItems ?? baseItemsLike;

  return (
    <InvoicePrintView
      invoice={invoiceLike}
      items={itemsForView}
      company={company}
      customer={customerLike as any}
      branch={branchLike}
      products={products}
      amc={amc}
      variant="proforma"
      authorisedSignatureUrl={authorised_signature_url || null}
      copyLabel="Original Copy"
    />
  );
}
