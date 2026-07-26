import { amountInWords } from "@/lib/crm";
import type { CompanyProfile } from "@/lib/companyProfile";

export type PrintParty = {
  name: string;
  address?: string | null;
  gstin?: string | null;
  state?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
};

export type PrintItem = {
  description: string;
  item_details?: string | null;
  warranty?: string | null; // e.g. "24 M"
  hsn?: string | null;
  qty: number;
  unit?: string | null;
  rate: number;
  gst_percent: number;
  amount: number; // taxable/line total pre-tax
};

export type PrintTotals = {
  subtotal: number;
  discount?: number;
  shipping?: number;
  adjustment?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  round_off?: number;
  grand_total: number;
};

export type PrintDoc = {
  type: "quotation" | "po";
  number: string;
  date: string;
  reference_no?: string | null;
  subject?: string | null;
  bill_to: PrintParty;
  ship_to?: PrintParty | null;
  is_interstate: boolean;
  place_of_supply?: string | null;
  sales_person?: string | null;
  payment_terms?: string | null;
  delivery_terms?: string | null;
  expiry_or_delivery_date?: string | null;
  items: PrintItem[];
  totals: PrintTotals;
  notes?: string | null;
  terms?: string | null;
};

const fmtMoney = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
};

/**
 * Shared A4 print template for Quotations and Purchase Orders.
 * Parent renders this inside a `hidden print:block` wrapper and calls window.print().
 */
export function DocumentPrintView({ doc, company }: { doc: PrintDoc; company: CompanyProfile }) {
  const accent = company.accent_color || "#1f3864";
  const title = doc.type === "quotation" ? "QUOTATION" : "PURCHASE ORDER";
  const numLabel = doc.type === "quotation" ? "Quote #" : "PO #";
  const billLabel = doc.type === "quotation" ? "Bill To" : "Vendor";
  const shipLabel = doc.type === "quotation" ? "Ship To" : "Deliver To";
  const dateSecondaryLabel = doc.type === "quotation" ? "Expiry" : "Delivery";

  const t = doc.totals;
  const showCgstSgst = !doc.is_interstate;

  return (
    <div className="doc-print text-black">
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          body { font-family: Arial, Helvetica, sans-serif; color: #000; }
          .doc-print { font-size: 10.5px; }
          .doc-print thead { display: table-header-group; }
          .doc-print tfoot { display: table-row-group; }
          .doc-print tr { page-break-inside: avoid; }
        }
        .doc-print .accent-bar { background: ${accent}; color: #fff; }
        .doc-print .accent-tx { color: ${accent}; }
        .doc-print .accent-bd { border-color: ${accent}; }
        .doc-print table.items { width: 100%; border-collapse: collapse; }
        .doc-print table.items th { background: ${accent}; color: #fff; padding: 6px 5px; font-size: 10px; text-align: left; font-weight: 600; }
        .doc-print table.items td { padding: 5px; border-bottom: 1px solid #e5e7eb; font-size: 10.5px; vertical-align: top; }
        .doc-print .lbl { color: #6b7280; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.02em; }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between pb-2 mb-3 border-b-2 accent-bd">
        <div className="pr-4">
          {company.logo_url && (
            <img src={company.logo_url} alt={company.name} style={{ maxHeight: 48, marginBottom: 4 }} />
          )}
          <div className="text-lg font-bold accent-tx">{company.name}</div>
          {company.registered_office_address && (
            <div className="text-[10px] whitespace-pre-line">{company.registered_office_address}</div>
          )}
          {!company.registered_office_address && company.regd_address && (
            <div className="text-[10px] whitespace-pre-line">{company.regd_address}</div>
          )}
          {company.sales_office_address && (
            <div className="text-[10px] whitespace-pre-line mt-0.5">
              <span className="lbl">Sales Office: </span>{company.sales_office_address}
            </div>
          )}
          <div className="text-[10px] mt-0.5">
            {[
              company.phone ? `Ph: ${company.phone}` : null,
              company.email ? `Email: ${company.email}` : null,
              company.website ? company.website : null,
            ].filter(Boolean).join(" · ")}
          </div>
          {company.gstin && <div className="text-[10px] font-semibold">GSTIN: {company.gstin}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-bold accent-tx">{title}</div>
          <table className="ml-auto mt-1 text-[10.5px]">
            <tbody>
              <tr><td className="lbl pr-2">{numLabel}</td><td className="font-semibold">{doc.number || "—"}</td></tr>
              <tr><td className="lbl pr-2">Date</td><td className="font-semibold">{fmtDate(doc.date)}</td></tr>
              {doc.expiry_or_delivery_date && (
                <tr><td className="lbl pr-2">{dateSecondaryLabel}</td><td className="font-semibold">{fmtDate(doc.expiry_or_delivery_date)}</td></tr>
              )}
              {doc.reference_no && (
                <tr><td className="lbl pr-2">Ref</td><td className="font-semibold">{doc.reference_no}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill / Ship */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="border" style={{ borderColor: "#d1d5db" }}>
          <div className="accent-bar px-2 py-1 text-[10px] font-semibold">{billLabel}</div>
          <div className="p-2 text-[10.5px]">
            <div className="font-semibold">{doc.bill_to.name}</div>
            {doc.bill_to.address && <div className="whitespace-pre-line">{doc.bill_to.address}</div>}
            {doc.bill_to.gstin && <div className="mt-0.5">GSTIN: <span className="font-mono">{doc.bill_to.gstin}</span></div>}
            {doc.bill_to.state && <div>State: {doc.bill_to.state}</div>}
            {(doc.bill_to.contact_name || doc.bill_to.contact_phone || doc.bill_to.contact_email) && (
              <div className="mt-1 text-[10px]">
                {doc.bill_to.contact_name && <div>Attn: {doc.bill_to.contact_name}</div>}
                {[doc.bill_to.contact_phone, doc.bill_to.contact_email].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        </div>
        <div className="border" style={{ borderColor: "#d1d5db" }}>
          <div className="accent-bar px-2 py-1 text-[10px] font-semibold">{shipLabel}</div>
          <div className="p-2 text-[10.5px]">
            <div className="font-semibold">{doc.ship_to?.name || doc.bill_to.name}</div>
            {(doc.ship_to?.address || doc.bill_to.address) && (
              <div className="whitespace-pre-line">{doc.ship_to?.address || doc.bill_to.address}</div>
            )}
            {doc.ship_to?.gstin && <div className="mt-0.5">GSTIN: <span className="font-mono">{doc.ship_to.gstin}</span></div>}
          </div>
        </div>
      </div>

      {/* Meta row */}
      <div className="grid grid-cols-4 gap-3 text-[10.5px] mb-3 border" style={{ borderColor: "#e5e7eb", padding: "6px 8px" }}>
        <div><div className="lbl">Place of Supply</div><div className="font-semibold">{doc.place_of_supply || "—"}</div></div>
        <div><div className="lbl">Sales Person</div><div className="font-semibold">{doc.sales_person || "—"}</div></div>
        <div><div className="lbl">Payment Terms</div><div className="font-semibold">{doc.payment_terms || "—"}</div></div>
        <div><div className="lbl">Delivery Terms</div><div className="font-semibold">{doc.delivery_terms || "—"}</div></div>
      </div>

      {doc.subject && <div className="text-[11px] mb-2"><b>Subject:</b> {doc.subject}</div>}

      {/* Items */}
      <table className="items">
        <thead>
          <tr>
            <th style={{ width: "3%" }}>#</th>
            <th>Product / Description</th>
            <th style={{ width: "8%" }} className="text-center">Warranty</th>
            <th style={{ width: "8%" }} className="text-center">HSN</th>
            <th style={{ width: "7%" }} className="text-right">Qty</th>
            <th style={{ width: "10%" }} className="text-right">Rate</th>
            {showCgstSgst ? (
              <>
                <th style={{ width: "6%" }} className="text-right">CGST%</th>
                <th style={{ width: "9%" }} className="text-right">CGST</th>
                <th style={{ width: "6%" }} className="text-right">SGST%</th>
                <th style={{ width: "9%" }} className="text-right">SGST</th>
              </>
            ) : (
              <>
                <th style={{ width: "8%" }} className="text-right">IGST%</th>
                <th style={{ width: "10%" }} className="text-right">IGST</th>
              </>
            )}
            <th style={{ width: "12%" }} className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.items.map((it, i) => {
            const half = +((it.amount * (it.gst_percent || 0)) / 200).toFixed(2);
            const igst = +((it.amount * (it.gst_percent || 0)) / 100).toFixed(2);
            const line = +(it.amount + (showCgstSgst ? half * 2 : igst)).toFixed(2);
            return (
              <tr key={i}>
                <td className="text-center">{i + 1}</td>
                <td>
                  <div className="font-semibold">{it.description}</div>
                  {it.item_details && <div className="text-[9.5px] text-gray-600 whitespace-pre-line">{it.item_details}</div>}
                </td>
                <td className="text-center">{it.warranty || "—"}</td>
                <td className="text-center">{it.hsn || "—"}</td>
                <td className="text-right">{it.qty} {it.unit || ""}</td>
                <td className="text-right">{fmtMoney(it.rate)}</td>
                {showCgstSgst ? (
                  <>
                    <td className="text-center">{(it.gst_percent / 2).toFixed(1)}%</td>
                    <td className="text-right">{fmtMoney(half)}</td>
                    <td className="text-center">{(it.gst_percent / 2).toFixed(1)}%</td>
                    <td className="text-right">{fmtMoney(half)}</td>
                  </>
                ) : (
                  <>
                    <td className="text-center">{it.gst_percent}%</td>
                    <td className="text-right">{fmtMoney(igst)}</td>
                  </>
                )}
                <td className="text-right font-semibold">{fmtMoney(line)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-4 mt-3">
        <div className="text-[10.5px]">
          <div className="font-semibold">Amount in Words:</div>
          <div className="italic">{amountInWords(t.grand_total)}</div>
        </div>
        <div className="text-[11px]">
          <table className="w-full">
            <tbody>
              <tr><td className="py-0.5">Sub Total</td><td className="py-0.5 text-right">{fmtMoney(t.subtotal)}</td></tr>
              {t.discount ? <tr><td className="py-0.5">Discount</td><td className="py-0.5 text-right">− {fmtMoney(t.discount)}</td></tr> : null}
              {t.shipping ? <tr><td className="py-0.5">Shipping</td><td className="py-0.5 text-right">{fmtMoney(t.shipping)}</td></tr> : null}
              {t.adjustment ? <tr><td className="py-0.5">Adjustment</td><td className="py-0.5 text-right">{fmtMoney(t.adjustment)}</td></tr> : null}
              {t.cgst ? <tr><td className="py-0.5">CGST</td><td className="py-0.5 text-right">{fmtMoney(t.cgst)}</td></tr> : null}
              {t.sgst ? <tr><td className="py-0.5">SGST</td><td className="py-0.5 text-right">{fmtMoney(t.sgst)}</td></tr> : null}
              {t.igst ? <tr><td className="py-0.5">IGST</td><td className="py-0.5 text-right">{fmtMoney(t.igst)}</td></tr> : null}
              {t.round_off ? <tr><td className="py-0.5">Round Off</td><td className="py-0.5 text-right">{fmtMoney(t.round_off)}</td></tr> : null}
              <tr className="border-t-2 accent-bd"><td className="py-1 font-bold">Grand Total</td><td className="py-1 text-right font-bold accent-tx">{fmtMoney(t.grand_total)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Bank details */}
      {(company.bank_name || company.bank_account_number) && (
        <div className="mt-4 border" style={{ borderColor: "#e5e7eb" }}>
          <div className="accent-bar px-2 py-1 text-[10px] font-semibold">Bank Details</div>
          <div className="p-2 grid grid-cols-2 gap-2 text-[10.5px]">
            {company.bank_name && <div><span className="lbl">Bank</span><div className="font-semibold">{company.bank_name}</div></div>}
            {company.bank_account_name && <div><span className="lbl">A/C Name</span><div className="font-semibold">{company.bank_account_name}</div></div>}
            {company.bank_account_number && <div><span className="lbl">A/C No.</span><div className="font-mono font-semibold">{company.bank_account_number}</div></div>}
            {company.bank_ifsc && <div><span className="lbl">IFSC</span><div className="font-mono font-semibold">{company.bank_ifsc}</div></div>}
            {company.bank_branch && <div className="col-span-2"><span className="lbl">Branch</span><div>{company.bank_branch}</div></div>}
          </div>
        </div>
      )}

      {doc.notes && (
        <div className="mt-3 text-[10.5px]"><div className="font-semibold">Notes</div><div className="whitespace-pre-line">{doc.notes}</div></div>
      )}
      {doc.terms && (
        <div className="mt-2 text-[10.5px]"><div className="font-semibold">Terms &amp; Conditions</div><div className="whitespace-pre-line">{doc.terms}</div></div>
      )}

      {/* Signature */}
      <div className="grid grid-cols-2 gap-8 mt-10 text-[10.5px]">
        <div className="border-t pt-1 text-center" style={{ borderColor: "#6b7280" }}>
          {doc.type === "quotation" ? "Customer Signature" : "Vendor Acknowledgement"}
        </div>
        <div className="border-t pt-1 text-center" style={{ borderColor: "#6b7280" }}>
          <div>For {company.name}</div>
          <div className="mt-6 text-gray-600">Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
}