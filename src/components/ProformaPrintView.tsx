import type { CompanyProfile } from "@/lib/companyProfile";
import type { ProformaRow } from "@/lib/proforma";
import type { SalesOrder, SoFulfillmentSummary } from "@/lib/salesOrders";
import { amountInWords } from "@/lib/gst";
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
    .replace(/^\s*(sales\s*office|regd\.?\s*office|registered\s*office)\s*[:-]\s*/i, "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

export function ProformaPrintView({
  proforma,
  company,
  branch,
  so,
  fulfillments,
  authorised_signature_url,
  docId,
  soConversions,
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
  const accent = (company.accent_color && company.accent_color.trim()) || "#14225C";
  const salesOffice = cleanAddress(company.sales_office_address);
  const regdOffice = cleanAddress(company.registered_office_address || company.regd_address);
  const items: any[] = Array.isArray(proforma.items) ? proforma.items : [];

  // derive per-line fulfilled before for annexure
  const priorMap = new Map<number, number>();
  if (Array.isArray(proforma.prior_fulfilled)) {
    for (const r of proforma.prior_fulfilled as any[]) {
      priorMap.set(Number(r.line_index), Number(r.fulfilled_before) || 0);
    }
  } else if (fulfillments) {
    for (const f of fulfillments) priorMap.set(f.line_index, f.fulfilled_stock);
  }

  return (
    <div className="doc-print text-black relative">
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
          position: relative;
          overflow: hidden;
        }
        .doc-print .watermark {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-30deg);
          font-size: 72px;
          font-weight: 800;
          color: rgba(180, 180, 180, 0.18);
          letter-spacing: 0.08em;
          white-space: nowrap;
          pointer-events: none;
          user-select: none;
          z-index: 0;
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

      <div className="watermark">PROFORMA — NOT A TAX INVOICE</div>

      {/* Header */}
      <div className="flex items-start justify-between pb-2 mb-3 border-b-2 accent-bd relative z-10">
        <div className="pr-4">
          <img
            src={company.logo_url || prokonLogo.url}
            alt={company.name}
            style={{ maxHeight: 56, marginBottom: 4 }}
            crossOrigin="anonymous"
            onError={(e) => { (e.currentTarget as HTMLImageElement).src = prokonLogo.url; }}
          />
          <div className="text-lg font-bold accent-tx">{company.name}</div>
          {salesOffice && <div className="text-[10px] mt-0.5"><span className="lbl">Sales Office: </span>{salesOffice}</div>}
          {regdOffice && <div className="text-[10px] mt-0.5"><span className="lbl">Regd. Office: </span>{regdOffice}</div>}
          <div className="text-[10px] mt-0.5">
            {[company.gstin ? `GSTIN: ${company.gstin}` : null, company.phone ? `Phone: ${company.phone}` : null].filter(Boolean).join(" | ")}
          </div>
          <div className="text-[10px]">
            {[company.email ? `Email: ${company.email}` : null, company.website ? `Web: ${company.website}` : null].filter(Boolean).join(" | ")}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xl font-bold accent-tx">PROFORMA INVOICE</div>
          <div className="mt-1 inline-block border px-2 py-0.5 text-[9px] font-bold tracking-widest bg-amber-50 border-amber-200 text-amber-800">
            NOT A TAX INVOICE
          </div>
          <table className="ml-auto mt-1 text-[10.5px]">
            <tbody>
              <tr><td className="lbl pr-2">Proforma No</td><td className="font-semibold font-mono">{proforma.proforma_no || "—"}</td></tr>
              <tr><td className="lbl pr-2">Date</td><td className="font-semibold">{fmtDate(proforma.proforma_date)}</td></tr>
              <tr><td className="lbl pr-2">Status</td><td className="font-semibold">{proforma.status}</td></tr>
              {so?.so_no && <tr><td className="lbl pr-2">Against SO</td><td className="font-mono font-semibold">{so.so_no}</td></tr>}
              {proforma.po_number && <tr><td className="lbl pr-2">PO</td><td className="font-semibold">{proforma.po_number} {proforma.po_date ? `(${fmtDate(proforma.po_date)})` : ""}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bill / Ship */}
      <div className="grid grid-cols-2 gap-3 mb-3 relative z-10">
        <div className="border" style={{ borderColor: "#d1d5db" }}>
          <div className="accent-bar px-2 py-1 text-[10px] font-semibold">Bill To</div>
          <div className="p-2 text-[10.5px]">
            <div className="font-semibold">{proforma.buyer_name || "—"}</div>
            {proforma.billing_address && <div>{cleanAddress(proforma.billing_address)}</div>}
            {proforma.buyer_gstin && <div className="mt-0.5">GSTIN: <span className="font-mono">{proforma.buyer_gstin}</span></div>}
            {proforma.buyer_state && <div>State: {proforma.buyer_state}</div>}
          </div>
        </div>
        <div className="border" style={{ borderColor: "#d1d5db" }}>
          <div className="accent-bar px-2 py-1 text-[10px] font-semibold">Ship To</div>
          <div className="p-2 text-[10.5px]">
            <div className="font-semibold">{proforma.buyer_name || "—"}</div>
            {(proforma.shipping_address || proforma.billing_address) && <div>{cleanAddress(proforma.shipping_address || proforma.billing_address)}</div>}
          </div>
        </div>
      </div>

      {so && (
        <div className="text-[10px] mb-2 px-2 py-1 border bg-slate-50" style={{ borderColor: "#d1d5db" }}>
          <span className="lbl">Against Sales Order</span> <span className="font-mono font-semibold ml-1">{so.so_no}</span>
          <span className="mx-2">·</span> SO Date {fmtDate(so.so_date)}
          {branch?.name && <><span className="mx-2">·</span> Branch {branch.name}</>}
        </div>
      )}

      {/* Items */}
      <table className="items relative z-10">
        <thead>
          <tr>
            <th style={{ width: "4%" }} className="text-center">#</th>
            <th>Description</th>
            <th style={{ width: "10%" }} className="text-center">HSN</th>
            <th style={{ width: "8%" }} className="text-right">Qty</th>
            <th style={{ width: "12%" }} className="text-right">Rate</th>
            <th style={{ width: "7%" }} className="text-center">GST%</th>
            <th style={{ width: "14%" }} className="text-right">Line Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it: any, i: number) => {
            const qty = Number(it.qty) || 0;
            const rate = Number(it.rate) || 0;
            const disc = Number(it.discount_pct) || 0;
            const gst = Number(it.gst_rate) || 0;
            const gross = qty * rate;
            const discAmt = gross * (disc / 100);
            const taxable = gross - discAmt;
            const gstAmt = taxable * gst / 100;
            const lineTotal = taxable + gstAmt + (Number(it.cess) || 0);
            // prefer stored line_total if present
            const displayTotal = Number(it.line_total) || lineTotal;
            return (
              <tr key={i}>
                <td className="text-center">{i + 1}</td>
                <td>
                  <div className="font-semibold">{it.description || it.part_name || "—"}</div>
                  {it.part_model_no && <div className="text-[9.5px] text-gray-600 font-mono">{it.part_model_no}</div>}
                </td>
                <td className="text-center font-mono text-[10px]">{it.hsn || "—"}</td>
                <td className="text-right tabular-nums">{qty} {it.unit || ""}</td>
                <td className="text-right tabular-nums">{fmtMoney(rate)}</td>
                <td className="text-center tabular-nums">{gst}%</td>
                <td className="text-right tabular-nums font-semibold">{fmtMoney(displayTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-4 mt-3 relative z-10">
        <div className="text-[10.5px]">
          <div className="font-semibold">Amount in Words:</div>
          <div className="italic">{amountInWords(Number(proforma.total) || 0)}</div>
          <div className="text-[9px] mt-2 text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            This is a Proforma Invoice — not a tax invoice. Stock: Not applicable — Proforma is not a delivery document.
          </div>
        </div>
        <div className="text-[11px]">
          <table className="w-full">
            <tbody>
              <tr><td className="py-0.5">Sub Total</td><td className="py-0.5 text-right">{fmtMoney(proforma.subtotal)}</td></tr>
              {proforma.discount > 0 && <tr><td className="py-0.5">{proforma.discount_label || "Discount"}</td><td className="py-0.5 text-right">− {fmtMoney(proforma.discount)}</td></tr>}
              {proforma.shipping_charges > 0 && <tr><td className="py-0.5">Shipping</td><td className="py-0.5 text-right">{fmtMoney(proforma.shipping_charges)}</td></tr>}
              {proforma.adjustment !== 0 && proforma.adjustment != null && <tr><td className="py-0.5">Adjustment</td><td className="py-0.5 text-right">{fmtMoney(proforma.adjustment)}</td></tr>}
              {proforma.cgst > 0 && <tr><td className="py-0.5">CGST</td><td className="py-0.5 text-right">{fmtMoney(proforma.cgst)}</td></tr>}
              {proforma.sgst > 0 && <tr><td className="py-0.5">SGST</td><td className="py-0.5 text-right">{fmtMoney(proforma.sgst)}</td></tr>}
              {proforma.igst > 0 && <tr><td className="py-0.5">IGST</td><td className="py-0.5 text-right">{fmtMoney(proforma.igst)}</td></tr>}
              {proforma.round_off !== 0 && <tr><td className="py-0.5">Round Off</td><td className="py-0.5 text-right">{fmtMoney(proforma.round_off)}</td></tr>}
              <tr className="border-t-2 accent-bd"><td className="py-1 font-bold">Grand Total</td><td className="py-1 text-right font-bold accent-tx">{fmtMoney(proforma.total)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Annexure: Previously Satisfied Qty */}
      {(so || priorMap.size > 0) && (
        <div className="mt-4 border relative z-10" style={{ borderColor: "#d1d5db" }}>
          <div className="accent-bar px-2 py-1 text-[10px] font-semibold">Annexure — Previously Satisfied Quantity</div>
          <div className="p-2 text-[10.5px]">
            {so && <div className="mb-1">Against Sales Order <span className="font-mono font-semibold">{so.so_no}</span> (PO: {so.po_number || "—"} {so.po_date ? fmtDate(so.po_date) : ""})</div>}
            <table className="w-full text-[10px] border-collapse border" style={{ borderColor: "#d1d5db" }}>
              <thead>
                <tr className="bg-slate-100">
                  <th className="border px-1.5 py-1 text-left" style={{ borderColor: "#d1d5db" }}>#</th>
                  <th className="border px-1.5 py-1 text-left" style={{ borderColor: "#d1d5db" }}>Item</th>
                  <th className="border px-1.5 py-1 text-right" style={{ borderColor: "#d1d5db" }}>Ordered</th>
                  <th className="border px-1.5 py-1 text-right" style={{ borderColor: "#d1d5db" }}>Already Delivered</th>
                  <th className="border px-1.5 py-1 text-right" style={{ borderColor: "#d1d5db" }}>This Proforma</th>
                  <th className="border px-1.5 py-1 text-right" style={{ borderColor: "#d1d5db" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it: any, i: number) => {
                  const idx = i; // assume same order as SO items; fallback to i
                  const soItem: any = so?.items[idx] || it;
                  const ordered = Number(soItem.qty) || Number(it.qty) || 0;
                  const rawAlready = priorMap.get(idx) ?? 0;
                  const thisQty = Number(it.qty) || 0;
                  // B16: only subtract if this doc is already in ledger (prevents double-count)
                  const effectiveDocId = docId ?? proforma.id;
                  const isThisDocInLedger = !!soConversions?.some((c: any) => c.target_id === effectiveDocId);
                  // If doc is in ledger and priorMap came from fulfillments (which may include current), derive prior
                  const already = isThisDocInLedger && rawAlready >= thisQty && thisQty > 0 ? Math.max(0, rawAlready - thisQty) : rawAlready;
                  const remaining = Math.max(0, ordered - already - thisQty);
                  return (
                    <tr key={i}>
                      <td className="border px-1.5 py-1 text-center" style={{ borderColor: "#d1d5db" }}>{i + 1}</td>
                      <td className="border px-1.5 py-1" style={{ borderColor: "#d1d5db" }}>{it.description || soItem.description || "—"}</td>
                      <td className="border px-1.5 py-1 text-right tabular-nums" style={{ borderColor: "#d1d5db" }}>{ordered}</td>
                      <td className="border px-1.5 py-1 text-right tabular-nums" style={{ borderColor: "#d1d5db" }}>{already}</td>
                      <td className="border px-1.5 py-1 text-right tabular-nums font-semibold" style={{ borderColor: "#d1d5db" }}>{thisQty}</td>
                      <td className="border px-1.5 py-1 text-right tabular-nums" style={{ borderColor: "#d1d5db" }}>{remaining}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-[9px] text-gray-600 mt-1">Stock: Not applicable — Proforma is not a delivery document. Quantities shown for reference only.</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6 mt-4 text-[10.5px] relative z-10">
        <div>
          {proforma.terms && (<><div className="font-semibold accent-tx">Terms &amp; Conditions</div><div className="whitespace-pre-line">{proforma.terms}</div></>)}
          {proforma.notes && (<div className={proforma.terms ? "mt-2" : ""}><div className="font-semibold accent-tx">Notes</div><div className="whitespace-pre-line">{proforma.notes}</div></div>)}
        </div>
        <div />
      </div>

      <div className="doc-spacer" />

      <div className="grid grid-cols-2 gap-8 mt-6 text-[10.5px] relative z-10">
        <div className="text-center">
          <div className="sign-field"><div className="sign-space" /><div className="sign-caption">&nbsp;</div></div>
          <div className="border-t pt-1.5 mt-2" style={{ borderColor: "#6b7280" }}>Customer Signature</div>
        </div>
        <div className="text-center">
          <div className="sign-field">
            {authorised_signature_url ? <img src={authorised_signature_url} crossOrigin="anonymous" className="sign-img" alt="Authorised signature" /> : <div className="sign-space" />}
            <div className="sign-caption mt-1 font-semibold">For {company.name}</div>
          </div>
          <div className="border-t pt-1.5 mt-2 text-center" style={{ borderColor: "#6b7280" }}>Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
}
