import { useEffect, useMemo, useState } from "react";
import { InvoicePrintView } from "@/components/invoice/InvoicePrintView";
import type { CompanyProfile } from "@/lib/companyProfile";
import type { ProformaRow } from "@/lib/proforma";
import type { SalesOrder, SoFulfillmentSummary } from "@/lib/salesOrders";
import type { BranchRow, InvoiceItemRow, InvoiceRow } from "@/lib/sales";
import { useInvoicePrintEnrichment } from "@/lib/invoicePrintEnrichment";
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
      contact_name: proforma.contact_person || null,
      phone: proforma.contact_mobile || null,
      email: proforma.contact_email || null,
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

  // ---- Warranty + AMC enrichment (shared hook — same logic now feeds the tax-invoice print) ----
  const { products, amc, resolvedItems } = useInvoicePrintEnrichment({
    baseItems: baseItemsLike,
    rawItems: Array.isArray(proforma.items) ? (proforma.items as any[]) : [],
    customerId: proforma.customer_id || null,
    buyerGstin: proforma.buyer_gstin || null,
    docKey: proforma.id,
  });
  // Branch PI appearance — theme color + copy label from proforma_invoice_settings (T2 root fix)
  const [appearance, setAppearance] = useState<{ themeColor?: string | null; copyLabel?: string | null }>({});

  useEffect(() => {
    if (!proforma.branch_id) return;
    let alive = true;
    supabase
      .from("proforma_invoice_settings")
      .select("theme_color, copy_label")
      .eq("branch_id", proforma.branch_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        setAppearance({ themeColor: data.theme_color, copyLabel: data.copy_label });
      });
    return () => {
      alive = false;
    };
  }, [proforma.branch_id]);


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
      themeColor={appearance.themeColor || undefined}
      authorisedSignatureUrl={authorised_signature_url || null}
      copyLabel={appearance.copyLabel || "Original Copy"}
    />
  );
}
