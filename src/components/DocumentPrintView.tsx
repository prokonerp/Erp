import { amountInWords } from "@/lib/crm";
import type { CompanyProfile } from "@/lib/companyProfile";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";

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
  warranty?: string | null; // "24 M"
  hsn?: string | null;
  qty: number;
  unit?: string | null;
  rate: number;
  gst_percent: number;
  amount: number; // pre-tax line total (qty * rate - line discount)
};

export type PrintTotals = {
  subtotal: number;
  discount?: number;
  discount_label?: string;
  shipping?: number;
  adjustment?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  round_off?: number;
  grand_total: number;
};

export type PrintPreparedBy = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
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
  prepared_by?: PrintPreparedBy | null;
};

const fmtMoney = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
};

// Rebuild an address from a possibly-messy string: split on commas/newlines,
// trim, drop blank segments, rejoin with a single ", ". Fixes double or
// trailing commas when line 2 / a segment is empty.
const cleanAddress = (raw?: string | null) => {
  if (!raw) return "";
  const stripped = raw.replace(
    /^\s*(sales\s*office|regd\.?\s*office|registered\s*office)\s*[:\-]\s*/i,
    "",
  );
  return stripped
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
};

/**
 * Shared A4 print template for Quotations and Purchase Orders.
 * Parent renders this inside a `hidden print:block` wrapper (or invokes
 * downloadElementAsPdf on the wrapper) and calls window.print().
 */
export function DocumentPrintView({ doc, company }: { doc: PrintDoc; company: CompanyProfile }) {
  const accent = (company.accent_color && company.accent_color.trim()) || "#14225C";
  const title = doc.type === "quotation" ? "QUOTATION" : "PURCHASE ORDER";
  const numLabel = doc.type === "quotation" ? "Ref No" : "PO No";
  const billLabel = doc.type === "quotation" ? "Bill To" : "Vendor";
  const shipLabel = doc.type === "quotation" ? "Ship To" : "Deliver To";
  const dateLabel = doc.type === "quotation" ? "Quote Date" : "PO Date";
  const dateSecondaryLabel = doc.type === "quotation" ? "Valid Until" : "Delivery";

  const t = doc.totals;
  const showCgstSgst = !doc.is_interstate;

  // Auto-route addresses to the correct label even if a user typed a
  // "Sales Office:" prefix into the Regd. Office field (or vice-versa).
  const detectKind = (raw?: string | null): "sales" | "regd" | null => {
    if (!raw) return null;
    const m = raw.match(/^\s*(sales\s*office|regd\.?\s*office|registered\s*office)/i);
    if (!m) return null;
    return /sales/i.test(m[1]) ? "sales" : "regd";
  };
  const rawSales = company.sales_office_address;
  const rawRegd = company.registered_office_address || company.regd_address;
  let salesOffice = cleanAddress(rawSales);
  let regdOffice = cleanAddress(rawRegd);
  // Swap if the value in one slot is explicitly prefixed as the other kind
  // and its target slot is empty.
  if (!salesOffice && detectKind(rawRegd) === "sales") {
    salesOffice = regdOffice;
    regdOffice = "";
  } else if (!regdOffice && detectKind(rawSales) === "regd") {
    regdOffice = salesOffice;
    salesOffice = "";
  }
  const showBothOffices = !!(salesOffice && regdOffice && salesOffice !== regdOffice);
  const billAddr = cleanAddress(doc.bill_to.address);
  const shipAddr = cleanAddress(doc.ship_to?.address || doc.bill_to.address);
  const billContact = [doc.bill_to.contact_name, doc.bill_to.contact_phone, doc.bill_to.contact_email]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="doc-print text-black">
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          body { font-family: Arial, Helvetica, sans-serif; color: #000; }
          .doc-print { font-size: 10.5px; }
          .doc-print thead { display: table-header-group; }
          .doc-print tr { page-break-inside: avoid; }
        }
        .doc-print .accent-bar { background: ${accent} !important; color: #ffffff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-print .accent-tx { color: ${accent}; }
        .doc-print .accent-bd { border-color: ${accent}; }
        .doc-print table.items { width: 100%; border-collapse: collapse; border: 1px solid ${accent}; }
        .doc-print table.items th { background: ${accent} !important; color: #ffffff !important; padding: 5px 4px; font-size: 10px; font-weight: 700; border: 1px solid ${accent}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-print table.items td { padding: 5px 4px; border: 1px solid #e5e7eb; font-size: 10.5px; vertical-align: top; }
        .doc-print { border: 1.5px solid ${accent}; padding: 10px 12px; display: flex; flex-direction: column; min-height: 272mm; box-sizing: border-box; }
        .doc-print .doc-spacer { flex: 1 1 auto; min-height: 8px; }
        .doc-print .lbl { color: #374151; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.02em; font-weight: 600; }
        .doc-print .lbl-r { color: #111827; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between pb-2 mb-3 border-b-2 accent-bd">
        <div className="pr-4">
          <img
            src={company.logo_url || prokonLogo.url}
            alt={company.name}
            style={{ maxHeight: 56, marginBottom: 4 }}
            crossOrigin="anonymous"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = prokonLogo.url; }}
          />
          <div className="text-lg font-bold accent-tx">{company.name}</div>
          {salesOffice && (
            <div className="text-[10px] mt-0.5" style={{ lineHeight: 1.35 }}>
              <span className="lbl">Sales Office: </span>{salesOffice}
            </div>
          )}
          {(showBothOffices || (!salesOffice && regdOffice)) && (
            <div className="text-[10px] mt-0.5" style={{ lineHeight: 1.35 }}>
              <span className="lbl">Regd. Office: </span>{regdOffice}
            </div>
          )}
          <div className="text-[10px] mt-0.5">
            {[
              company.gstin ? `GSTIN: ${company.gstin}` : null,
              company.phone ? `Phone: ${company.phone}` : null,
            ].filter(Boolean).join(" | ")}
          </div>
          <div className="text-[10px]">
            {[
              company.email ? `Email: ${company.email}` : null,
              company.website ? `Web: ${company.website}` : null,
            ].filter(Boolean).join(" | ")}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-bold accent-tx">{title}</div>
          <table className="ml-auto mt-1 text-[10.5px]">
            <tbody>
              <tr><td className="lbl pr-2">{numLabel}</td><td className="font-semibold">{doc.number || "—"}</td></tr>
              <tr><td className="lbl pr-2">{dateLabel}</td><td className="font-semibold">{fmtDate(doc.date)}</td></tr>
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
            {billAddr && <div>{billAddr}</div>}
            {doc.bill_to.gstin && <div className="mt-0.5">GSTIN: <span className="font-mono">{doc.bill_to.gstin}</span></div>}
            {doc.bill_to.state && <div>State: {doc.bill_to.state}</div>}
            {billContact && <div className="mt-1 text-[10px]">{billContact}</div>}
          </div>
        </div>
        <div className="border" style={{ borderColor: "#d1d5db" }}>
          <div className="accent-bar px-2 py-1 text-[10px] font-semibold">{shipLabel}</div>
          <div className="p-2 text-[10.5px]">
            <div className="font-semibold">{doc.ship_to?.name || doc.bill_to.name}</div>
            {shipAddr && <div>{shipAddr}</div>}
            {doc.ship_to?.gstin && <div className="mt-0.5">GSTIN: <span className="font-mono">{doc.ship_to.gstin}</span></div>}
          </div>
        </div>
      </div>

      {/* Meta row: asymmetric — left compact/muted, right bold/wide */}
      <div className="grid grid-cols-2 text-[10.5px] mb-3 border" style={{ borderColor: "#d1d5db" }}>
        <div className="p-2" style={{ borderRight: "1px solid #d1d5db" }}>
          <div className="flex items-baseline">
            <span className="lbl" style={{ width: 130 }}>Place of Supply</span><span>:</span>
            <span className="ml-2 font-semibold">{doc.place_of_supply || "—"}</span>
          </div>
          <div className="flex items-baseline mt-0.5">
            <span className="lbl" style={{ width: 130 }}>Sales Person</span><span>:</span>
            <span className="ml-2 font-semibold">{doc.sales_person || "—"}</span>
          </div>
        </div>
        <div className="p-2">
          <div className="flex items-baseline">
            <span className="lbl-r" style={{ width: 170 }}>Payment Terms</span><span>:</span>
            <span className="ml-4 font-bold">{doc.payment_terms || "—"}</span>
          </div>
          <div className="flex items-baseline mt-0.5">
            <span className="lbl-r" style={{ width: 170 }}>Delivery Terms</span><span>:</span>
            <span className="ml-4 font-bold">{doc.delivery_terms || "—"}</span>
          </div>
        </div>
      </div>

      {doc.subject && <div className="text-[11px] mb-2"><b>Subject:</b> {doc.subject}</div>}

      {/* Items — grouped two-row tax headers */}
      <table className="items">
        <thead>
          <tr>
            <th rowSpan={2} style={{ width: "3%" }} className="text-center">#</th>
            <th rowSpan={2}>Product / Description</th>
            <th rowSpan={2} style={{ width: "8%" }} className="text-center">Warranty</th>
            <th rowSpan={2} style={{ width: "8%" }} className="text-center">HSN</th>
            <th rowSpan={2} style={{ width: "7%" }} className="text-right">Qty</th>
            <th rowSpan={2} style={{ width: "11%" }} className="text-right">Rate</th>
            {showCgstSgst ? (
              <>
                <th colSpan={2} className="text-center">CGST</th>
                <th colSpan={2} className="text-center">SGST</th>
              </>
            ) : (
              <th colSpan={2} className="text-center">IGST</th>
            )}
            <th rowSpan={2} style={{ width: "12%" }} className="text-right">Amount</th>
          </tr>
          <tr>
            {showCgstSgst ? (
              <>
                <th style={{ width: "5%" }} className="text-center">%</th>
                <th style={{ width: "8%" }} className="text-right">Amt</th>
                <th style={{ width: "5%" }} className="text-center">%</th>
                <th style={{ width: "8%" }} className="text-right">Amt</th>
              </>
            ) : (
              <>
                <th style={{ width: "6%" }} className="text-center">%</th>
                <th style={{ width: "10%" }} className="text-right">Amt</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {doc.items.map((it, i) => {
            const half = +((it.amount * (it.gst_percent || 0)) / 200).toFixed(2);
            const igst = +((it.amount * (it.gst_percent || 0)) / 100).toFixed(2);
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
                <td className="text-right font-semibold">{fmtMoney(it.amount)}</td>
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
              {t.discount ? <tr><td className="py-0.5">{t.discount_label || "Discount"}</td><td className="py-0.5 text-right">− {fmtMoney(t.discount)}</td></tr> : null}
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
          <div className="p-2 grid grid-cols-3 gap-x-4 gap-y-1 text-[10.5px]">
            {company.bank_name && <div><span className="lbl">Bank: </span><span className="font-semibold">{company.bank_name}</span></div>}
            {company.bank_account_name && <div><span className="lbl">A/C Name: </span><span className="font-semibold">{company.bank_account_name}</span></div>}
            {company.bank_account_number && <div><span className="lbl">A/C No.: </span><span className="font-mono font-semibold">{company.bank_account_number}</span></div>}
            {company.bank_ifsc && <div><span className="lbl">IFSC: </span><span className="font-mono font-semibold">{company.bank_ifsc}</span></div>}
            {company.bank_branch && <div><span className="lbl">Branch: </span><span className="font-semibold">{company.bank_branch}</span></div>}
          </div>
        </div>
      )}

      {/* Terms / Notes (left) + Prepared By (right) */}
      <div className="grid grid-cols-2 gap-6 mt-4 text-[10.5px]">
        <div>
          {doc.terms && (
            <>
              <div className="font-semibold accent-tx">Terms &amp; Conditions</div>
              <div className="whitespace-pre-line">{doc.terms}</div>
            </>
          )}
          {doc.notes && (
            <div className={doc.terms ? "mt-2" : ""}>
              <div className="font-semibold accent-tx">Notes</div>
              <div className="whitespace-pre-line">{doc.notes}</div>
            </div>
          )}
        </div>
        <div className="text-right">
          {doc.prepared_by?.name && (
            <div>
              <div><span className="lbl">Prepared By: </span><span className="font-semibold">{doc.prepared_by.name}</span></div>
              {doc.prepared_by.phone && <div><span className="lbl">Mobile: </span>{doc.prepared_by.phone}</div>}
              {doc.prepared_by.email && <div><span className="lbl">Email: </span>{doc.prepared_by.email}</div>}
            </div>
          )}
        </div>
      </div>

      <div className="doc-spacer" />

      {/* Signature */}
      <div className="grid grid-cols-2 gap-8 mt-6 text-[10.5px]">
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
