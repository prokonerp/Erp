import type { CompanyProfile } from "@/lib/companyProfile";
import type { GeneralDcRow } from "@/lib/generalDc";
import { gdcTotal } from "@/lib/generalDc";
import { amountInWords } from "@/lib/crm";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";

const fmtMoney = (n: number) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
};

const cleanAddress = (raw?: string | null) =>
  (raw || "")
    .replace(/^\s*(sales\s*office|regd\.?\s*office|registered\s*office)\s*[:\-]\s*/i, "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

/** A4 print template for the General Delivery Challan (same chrome as Quotation/PO). */
export function GeneralDcPrintView({
  dc,
  company,
  warehouseNames = {},
  authorised_signature_url,
}: {
  dc: GeneralDcRow;
  company: CompanyProfile;
  warehouseNames?: Record<string, string>;
  authorised_signature_url?: string | null;
}) {
  const accent = (company.accent_color && company.accent_color.trim()) || "#14225C";
  const salesOffice = cleanAddress(company.sales_office_address);
  const regdOffice = cleanAddress(company.registered_office_address || company.regd_address);
  const total = gdcTotal(dc.items || []);

  return (
    <div className="doc-print text-black">
      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          .doc-print thead { display: table-header-group; }
          .doc-print tr { page-break-inside: avoid; }
        }
        .doc-print {
          font-family: Arial, Helvetica, sans-serif;
          color: #000;
          font-size: 10.5px;
          line-height: 1.35;
          border: 2px solid ${accent};
          padding: 14px 18px;
          display: flex;
          flex-direction: column;
          min-height: 272mm;
          box-sizing: border-box;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .doc-print .sign-field { height: 80px; display: flex; flex-direction: column; justify-content: flex-end; }
        .doc-print .sign-caption { min-height: 16px; display: flex; align-items: center; justify-content: center; }
        .doc-print .sign-field .sign-space { height: 60px; }
        .doc-print .sign-field .sign-img { max-height: 60px; }
        .doc-print .accent-bar { background: ${accent} !important; color: #ffffff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-print .accent-tx { color: ${accent}; }
        .doc-print .accent-bd { border-color: ${accent}; }
        .doc-print table.items { width: 100%; border-collapse: collapse; border: 1px solid ${accent}; }
        .doc-print table.items th { background: ${accent} !important; color: #ffffff !important; padding: 5px 4px; font-size: 10px; font-weight: 700; border: 1px solid ${accent}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-print table.items td { padding: 5px 4px; border: 1px solid #e5e7eb; font-size: 10.5px; vertical-align: top; }
        .doc-print .doc-spacer { flex: 1 1 auto; min-height: 8px; }
        .doc-print .lbl { color: #374151; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.02em; font-weight: 600; }
        .doc-print .sign-img { display: block; margin: 0 auto; max-height: 60px; max-width: 160px; object-fit: contain; }
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
            <div className="text-[10px] mt-0.5"><span className="lbl">Sales Office: </span>{salesOffice}</div>
          )}
          {regdOffice && (
            <div className="text-[10px] mt-0.5"><span className="lbl">Regd. Office: </span>{regdOffice}</div>
          )}
          <div className="text-[10px] mt-0.5">
            {[company.gstin ? `GSTIN: ${company.gstin}` : null, company.phone ? `Phone: ${company.phone}` : null]
              .filter(Boolean).join(" | ")}
          </div>
          <div className="text-[10px]">
            {[company.email ? `Email: ${company.email}` : null, company.website ? `Web: ${company.website}` : null]
              .filter(Boolean).join(" | ")}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-bold accent-tx">DELIVERY CHALLAN</div>
          <div className="mt-1 inline-block border px-2 py-0.5 text-[10.5px] font-bold accent-bd accent-tx">
            {dc.returnable ? "RETURNABLE" : "NON-RETURNABLE"}
          </div>
          <table className="ml-auto mt-1 text-[10.5px]">
            <tbody>
              <tr><td className="lbl pr-2">DC No</td><td className="font-semibold">{dc.dc_no || "—"}</td></tr>
              <tr><td className="lbl pr-2">DC Date</td><td className="font-semibold">{fmtDate(dc.dc_date)}</td></tr>
              <tr><td className="lbl pr-2">Status</td><td className="font-semibold">{dc.status}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill / Ship */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="border" style={{ borderColor: "#d1d5db" }}>
          <div className="accent-bar px-2 py-1 text-[10px] font-semibold">Bill To</div>
          <div className="p-2 text-[10.5px]">
            <div className="font-semibold">{dc.customer_name || "—"}</div>
            {dc.billing_address && <div>{cleanAddress(dc.billing_address)}</div>}
          </div>
        </div>
        <div className="border" style={{ borderColor: "#d1d5db" }}>
          <div className="accent-bar px-2 py-1 text-[10px] font-semibold">Ship To</div>
          <div className="p-2 text-[10.5px]">
            <div className="font-semibold">{dc.customer_name || "—"}</div>
            {(dc.shipping_address || dc.billing_address) && (
              <div>{cleanAddress(dc.shipping_address || dc.billing_address)}</div>
            )}
          </div>
        </div>
      </div>

      {dc.purpose && (
        <div className="text-[11px] mb-2 border p-2" style={{ borderColor: "#d1d5db" }}>
          <b>Purpose of Dispatch:</b> {dc.purpose}
        </div>
      )}

      {/* Dispatched From — derived from the warehouses chosen on the lines */}
      {(() => {
        const ids = Array.from(new Set((dc.items || []).map((it) => it.warehouse_id).filter(Boolean))) as string[];
        const labels = ids.map((id) => warehouseNames[id]).filter(Boolean);
        if (!labels.length) return null;
        return (
          <div className="text-center text-[10.5px] mb-2">
            <b>Dispatched From:</b> {labels.join("  ·  ")}
          </div>
        );
      })()}

      {/* Items */}
      <table className="items">
        <thead>
          <tr>
            <th style={{ width: "4%" }} className="text-center">#</th>
            <th>Product / Model</th>
            <th style={{ width: "26%" }}>Serial No.</th>
            <th style={{ width: "10%" }} className="text-center">Warehouse</th>
            <th style={{ width: "8%" }} className="text-right">Qty</th>
            <th style={{ width: "12%" }} className="text-right">Unit Price</th>
            <th style={{ width: "14%" }} className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(dc.items || []).map((it, i) => (
            <tr key={i}>
              <td className="text-center">{i + 1}</td>
              <td>
                <div className="font-semibold">{it.part_name || it.model_no || "—"}</div>
                {it.model_no && it.part_name && <div className="text-[9.5px] text-gray-600">{it.model_no}</div>}
              </td>
              <td className="text-[9.5px] font-mono">{(it.serial_numbers || []).join(", ") || "—"}</td>
              <td className="text-center text-[9.5px]">{(it.warehouse_id && warehouseNames[it.warehouse_id]) || "—"}</td>
              <td className="text-right">{it.qty} {it.uom || ""}</td>
              <td className="text-right">{fmtMoney(it.unit_price)}</td>
              <td className="text-right font-semibold">{fmtMoney((Number(it.qty) || 0) * (Number(it.unit_price) || 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-4 mt-3">
        <div className="text-[10.5px]">
          <div className="font-semibold">Value in Words:</div>
          <div className="italic">{amountInWords(total)}</div>
          <div className="text-[9.5px] mt-1 text-gray-600">
            Not a tax invoice. Goods dispatched {dc.returnable ? "on returnable basis" : "on non-returnable basis"}.
          </div>
        </div>
        <div className="text-[11px]">
          <table className="w-full">
            <tbody>
              <tr className="border-t-2 accent-bd">
                <td className="py-1 font-bold">Total Value</td>
                <td className="py-1 text-right font-bold accent-tx">{fmtMoney(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mt-4 text-[10.5px]">
        <div>
          {dc.terms && (
            <>
              <div className="font-semibold accent-tx">Terms &amp; Conditions</div>
              <div className="whitespace-pre-line">{dc.terms}</div>
            </>
          )}
          {dc.notes && (
            <div className={dc.terms ? "mt-2" : ""}>
              <div className="font-semibold accent-tx">Notes</div>
              <div className="whitespace-pre-line">{dc.notes}</div>
            </div>
          )}
        </div>
        <div />
      </div>

      <div className="doc-spacer" />

      <div className="grid grid-cols-2 gap-8 mt-6 text-[10.5px]">
        <div className="text-center">
          <div className="sign-field">
            <div className="sign-space" />
            <div className="sign-caption">&nbsp;</div>
          </div>
          <div className="border-t pt-1.5 mt-2" style={{ borderColor: "#6b7280" }}>
            Receiver&apos;s Signature
          </div>
        </div>
        <div className="text-center">
          <div className="sign-field">
            {authorised_signature_url ? (
              <img src={authorised_signature_url} crossOrigin="anonymous" className="sign-img" alt="Authorised signature" />
            ) : (
              <div className="sign-space" />
            )}
            <div className="sign-caption mt-1 font-semibold">For {company.name}</div>
          </div>
          <div className="border-t pt-1.5 mt-2 text-center" style={{ borderColor: "#6b7280" }}>
            Authorised Signatory
          </div>
        </div>
      </div>
    </div>
  );
}