/**
 * src/lib/gspPayload.ts — Prokon/NIC shape → GSP request shape.
 *
 * The GSP `POST /einvoice/` endpoint does NOT accept the NIC IRP JSON schema.
 * NIC is PascalCase and flat (`TranDtls.SupTyp`); GSP wraps the same facts in
 * lowercase snake_case (`transaction_details.supply_type`). See
 * `docs/GSP_INTEGRATION_AND_TALLY_EXPORT.md` §3.3 and
 * `docs/gsp-einvoice-api-reference.md`.
 *
 * ## The one rule that matters
 *
 * This module is a **shape transform only**. It never re-derives, rounds or
 * recomputes a tax figure. `buildGstInvoiceJson()` in `invoiceJson.ts` remains
 * the single source of truth for every value, so the JSON we archive and the
 * request we send to the GSP can never disagree. The "mirrors an odd source
 * total" test in `__tests__/gspPayload.test.ts` pins that rule.
 *
 * Pure module: no Supabase, no network, no clock, no randomness.
 *
 * @module src/lib/gspPayload
 */

import type { NicInvoiceJson, NicItem } from "./invoiceJson";

// ── GSP request shape (as documented, §3.3) ─────────────────────────────────

export type GspTransactionDetails = {
  supply_type: string;
  charge_type: string;
  igst_on_intra: string;
  ecommerce_gstin: string;
};

export type GspDocumentDetails = {
  document_type: string;
  document_number: string;
  document_date: string;
};

export type GspPartyDetails = {
  gstin: string | null;
  legal_name: string;
  trade_name: string;
  address1: string;
  address2: string | null;
  location: string;
  pincode: number | null;
  state_code: string | null;
  phone_number: string | null;
  email: string | null;
};

export type GspBuyerDetails = GspPartyDetails & {
  place_of_supply: string | null;
};

export type GspDispatchDetails = {
  company_name: string;
  address1: string;
  address2: string | null;
  location: string;
  pincode: number | null;
  state_code: string | null;
};

export type GspShipDetails = {
  gstin: string | null;
  legal_name: string;
  address1: string;
  address2: string | null;
  location: string;
  pincode: number | null;
  state_code: string | null;
};

export type GspExportDetails = {
  ship_bill_number: string | null;
  ship_bill_date: string | null;
  country_code: string | null;
  foreign_currency: string | null;
  refund_claim: string | null;
  port_code: string | null;
  export_duty: string | null;
};

export type GspPaymentDetails = {
  bank_account_number: string | null;
  paid_balance_amount: number;
  credit_days: number | null;
  credit_transfer: string | null;
  direct_debit: string | null;
  branch_or_ifsc: string | null;
  payment_mode: string | null;
  payee_name: string | null;
  outstanding_amount: number;
  payment_instruction: string | null;
  payment_term: string | null;
};

export type GspReferenceDetails = {
  invoice_remarks: string | null;
  document_period_details: { invoice_start_date: string; invoice_end_date: string } | null;
  preceding_document_details: Array<{ invoice_number: string; invoice_date: string }> | null;
  contract_details: Array<{
    advice_reference: string;
    advice_date: string;
    tender_reference: string;
  }> | null;
};

export type GspAdditionalDocument = {
  supporting_document_url: string | null;
  supporting_document: string | null;
  additional_information: string | null;
};

export type GspEwbDetails = {
  transporter_id: string | null;
  transporter_name: string | null;
  transportation_mode: string;
  transportation_distance: number | null;
  transporter_document_number: string | null;
  transporter_document_date: string | null;
  vehicle_number: string | null;
  vehicle_type: string;
};

export type GspValueDetails = {
  total_assessable_value: number;
  total_cgst_value: number;
  total_sgst_value: number;
  total_igst_value: number;
  total_cess_value: number;
  total_cess_value_of_state: number;
  total_discount: number;
  total_other_charge: number;
  total_invoice_value: number;
  round_off_amount: number;
};

export type GspItem = {
  item_serial_number: string;
  product_description: string;
  is_service: string;
  hsn_code: string;
  bar_code: string | null;
  quantity: number;
  free_quantity: number;
  unit: string;
  unit_price: number;
  total_amount: number;
  pre_tax_value: number;
  discount: number;
  other_charge: number;
  assessable_value: number;
  gst_rate: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  cess_rate: number;
  cess_amount: number;
  cess_nonadvol_amount: number;
  state_cess_rate: number;
  state_cess_amount: number;
  state_cess_nonadvol_amount: number;
  total_item_value: number;
};

export type GspInvoiceRequest = {
  user_gstin: string;
  data_source: "erp";
  transaction_details: GspTransactionDetails;
  document_details: GspDocumentDetails;
  seller_details: GspPartyDetails;
  buyer_details: GspBuyerDetails;
  dispatch_details: GspDispatchDetails | null;
  ship_details: GspShipDetails | null;
  export_details: GspExportDetails | null;
  payment_details: GspPaymentDetails | null;
  reference_details: GspReferenceDetails;
  additional_document_details: GspAdditionalDocument[] | null;
  ewaybill_details: GspEwbDetails | null;
  value_details: GspValueDetails;
  item_list: GspItem[];
};

export type GspRequestOptions = {
  /** GSTIN of the entity issuing the invoice. Not present in the NIC schema. */
  userGstin: string;
};

/** Literal required by the GSP; only `"erp"` is ever shown in the docs. */
const DATA_SOURCE = "erp" as const;

function mapItem(item: NicItem): GspItem {
  return {
    item_serial_number: item.SlNo,
    product_description: item.PrdDesc,
    is_service: item.IsServc,
    hsn_code: item.HsnCd,
    bar_code: item.Barcde,
    quantity: item.Qty,
    free_quantity: item.FreeQty,
    unit: item.Unit,
    unit_price: item.UnitPrice,
    total_amount: item.TotAmt,
    pre_tax_value: item.PreTaxVal,
    discount: item.Discount,
    other_charge: item.OthChrg,
    assessable_value: item.AssAmt,
    gst_rate: item.GstRt,
    igst_amount: item.IgstAmt,
    cgst_amount: item.CgstAmt,
    sgst_amount: item.SgstAmt,
    cess_rate: item.CesRt,
    cess_amount: item.CesAmt,
    cess_nonadvol_amount: item.CesNonAdvlAmt,
    state_cess_rate: item.StateCesRt,
    state_cess_amount: item.StateCesAmt,
    state_cess_nonadvol_amount: item.StateCesNonAdvlAmt,
    total_item_value: item.TotItemVal,
  };
}

/**
 * Transform a NIC v1.03 invoice JSON into the GSP `POST /einvoice/` body.
 *
 * Throws when `userGstin` is blank — a GSP request without it is always
 * rejected, so failing here is cheaper than a confusing remote 400.
 */
export function toGspInvoiceRequest(
  nic: NicInvoiceJson,
  opts: GspRequestOptions,
): GspInvoiceRequest {
  const userGstin = String(opts?.userGstin ?? "").trim();
  if (!userGstin) {
    throw new Error(
      "toGspInvoiceRequest: userGstin is required (seller GSTIN for the GSP request)",
    );
  }
  if (!nic) throw new Error("toGspInvoiceRequest: nic invoice json is required");

  const seller = nic.SellerDtls;
  const buyer = nic.BuyerDtls;

  return {
    user_gstin: userGstin,
    data_source: DATA_SOURCE,
    transaction_details: {
      supply_type: nic.TranDtls.SupTyp,
      charge_type: nic.TranDtls.RegRev,
      igst_on_intra: nic.TranDtls.IgstOnIntra,
      ecommerce_gstin: nic.TranDtls.EcmGstin ?? "",
    },
    document_details: {
      document_type: nic.DocDtls.Typ,
      document_number: nic.DocDtls.No,
      document_date: nic.DocDtls.Dt,
    },
    seller_details: {
      gstin: seller.Gstin,
      legal_name: seller.LglNm,
      trade_name: seller.TrdNm,
      address1: seller.Addr1,
      address2: seller.Addr2,
      location: seller.Loc,
      pincode: seller.Pin,
      state_code: seller.Stcd,
      phone_number: seller.Ph,
      email: seller.Em,
    },
    buyer_details: {
      gstin: buyer.Gstin,
      legal_name: buyer.LglNm,
      trade_name: buyer.TrdNm,
      address1: buyer.Addr1,
      address2: buyer.Addr2,
      location: buyer.Loc,
      pincode: buyer.Pin,
      state_code: buyer.Stcd,
      phone_number: buyer.Ph,
      email: buyer.Em,
      place_of_supply: buyer.Pos,
    },
    dispatch_details: nic.DispDtls
      ? {
          company_name: nic.DispDtls.Nm,
          address1: nic.DispDtls.Addr1,
          address2: nic.DispDtls.Addr2,
          location: nic.DispDtls.Loc,
          pincode: nic.DispDtls.Pin,
          state_code: nic.DispDtls.Stcd,
        }
      : null,
    ship_details: nic.ShipDtls
      ? {
          gstin: nic.ShipDtls.Gstin,
          legal_name: nic.ShipDtls.LglNm,
          address1: nic.ShipDtls.Addr1,
          address2: nic.ShipDtls.Addr2,
          location: nic.ShipDtls.Loc,
          pincode: nic.ShipDtls.Pin,
          state_code: nic.ShipDtls.Stcd,
        }
      : null,
    // NIC's ExpDtls carries only an address and a port; the GSP block wants a
    // different field set, so we emit the port and leave the rest null rather
    // than inventing values the GSP never asked for.
    export_details: nic.ExpDtls
      ? {
          ship_bill_number: null,
          ship_bill_date: null,
          country_code: null,
          foreign_currency: nic.ValDtls.TotInvValFc ? null : null,
          refund_claim: null,
          port_code: nic.ExpDtls.Port,
          export_duty: null,
        }
      : null,
    payment_details: nic.PayDtls
      ? {
          bank_account_number: nic.PayDtls.AccDet,
          paid_balance_amount: nic.PayDtls.PaidAmt,
          credit_days: nic.PayDtls.CrDay,
          credit_transfer: nic.PayDtls.CrTrn,
          direct_debit: nic.PayDtls.DirDr,
          branch_or_ifsc: nic.PayDtls.FinInsBr,
          payment_mode: nic.PayDtls.Mode,
          payee_name: nic.PayDtls.Nm,
          outstanding_amount: nic.PayDtls.PayDue,
          payment_instruction: nic.PayDtls.PayInstr,
          payment_term: nic.PayDtls.PayTerm,
        }
      : null,
    reference_details: {
      invoice_remarks: nic.RefDtls?.InvRm ?? null,
      document_period_details: nic.RefDtls?.DocPerdDtls
        ? {
            invoice_start_date: nic.RefDtls.DocPerdDtls.InvStDt,
            invoice_end_date: nic.RefDtls.DocPerdDtls.InvEndDt,
          }
        : null,
      preceding_document_details: nic.RefDtls?.PrecDocDtls
        ? nic.RefDtls.PrecDocDtls.map((d) => ({
            invoice_number: d.InvNo,
            invoice_date: d.InvDt,
          }))
        : null,
      contract_details: nic.RefDtls?.ContrDtls
        ? nic.RefDtls.ContrDtls.map((d) => ({
            advice_reference: d.RecAdvRefr,
            advice_date: d.RecAdvDt,
            tender_reference: d.TendRefr,
          }))
        : null,
    },
    additional_document_details: nic.AddlDocDtls
      ? nic.AddlDocDtls.map((d) => ({
          supporting_document_url: d.Url,
          supporting_document: d.Docs,
          additional_information: d.Info,
        }))
      : null,
    ewaybill_details: nic.EwbDtls
      ? {
          transporter_id: nic.EwbDtls.TransId,
          transporter_name: nic.EwbDtls.TransName,
          transportation_mode: nic.EwbDtls.TransMode,
          transportation_distance: nic.EwbDtls.Distance,
          transporter_document_number: nic.EwbDtls.TransDocNo,
          transporter_document_date: nic.EwbDtls.TransDocDt,
          vehicle_number: nic.EwbDtls.VehNo,
          vehicle_type: nic.EwbDtls.VehType,
        }
      : null,
    value_details: {
      total_assessable_value: nic.ValDtls.AssVal,
      total_cgst_value: nic.ValDtls.CgstVal,
      total_sgst_value: nic.ValDtls.SgstVal,
      total_igst_value: nic.ValDtls.IgstVal,
      total_cess_value: nic.ValDtls.CesVal,
      total_cess_value_of_state: nic.ValDtls.StCesVal,
      total_discount: nic.ValDtls.Discount,
      total_other_charge: nic.ValDtls.OthChrg,
      total_invoice_value: nic.ValDtls.TotInvVal,
      round_off_amount: nic.ValDtls.RndOffAmt,
    },
    item_list: (nic.ItemList ?? []).map(mapItem),
  };
}
