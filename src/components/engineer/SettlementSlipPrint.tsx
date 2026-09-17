import type { AdminEngineer } from "@/lib/engineersAdmin";
import type { CompanyProfile } from "@/lib/companyProfile";
import { amountInWords } from "@/lib/crm";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";

/** One payable day: mirrors payableForPeriod().perDay rows. */
export type PayableDay = {
  date: string;
  km: number;
  rate: number | null;
  amount: number;
};

export type SettlementSlipData = {
  period_start: string | null;
  period_end: string | null;
  status: string | null;
  reference_no?: string | null;
  computed_amount: number | string | null;
  flat_expenses: number | string | null;
  adjusted_amount: number | string | null;
  adjustment_reason?: string | null;
  payment_ref?: string | null;
  paid_at?: string | null;
};

function num(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Dedicated A4 conveyance payslip (TASK 4). Reuses the .doc-print +
 * @media print shell from DocumentPrintView — the PrintDoc union there
 * stays (quotation|po), so this slip owns its own component.
 * Render inside <div className="hidden print:block"> and print with
 * window.print().
 */
export function SettlementSlipPrint({
  employee,
  company,
  settlement,
  perDay,
}: {
  employee: AdminEngineer;
  company: CompanyProfile;
  settlement: SettlementSlipData;
  perDay: PayableDay[];
}) {
  const accent = company.accent_color?.trim() || "#1f3864";
  const kmTotal = Math.round(perDay.reduce((s, d) => s + (Number.isFinite(d.km) ? d.km : 0), 0) * 10) / 10;
  const computed = num(settlement.computed_amount);
  const flat = num(settlement.flat_expenses);
  const grand = Math.round((computed + flat) * 100) / 100;
  const adjustedRaw = num(settlement.adjusted_amount);
  const hasOverride = settlement.adjusted_amount != null && String(settlement.adjusted_amount).trim() !== "";
  const payable = hasOverride ? adjustedRaw : grand;
  const from = (settlement.period_start ?? "").slice(0, 10);
  const to = (settlement.period_end ?? "").slice(0, 10);

  return (
    <div className="doc-print text-black">
      <style>{`
        @media print {
          @page { size: A4; margin: 5mm; }
          .doc-print thead { display: table-header-group; }
          .doc-print tr { page-break-inside: avoid; }
        }
        .doc-print {
          font-family: Arial, Helvetica, sans-serif;
          color: #000;
          font-size: 10.5px;
          line-height: 1.35;
          border: 1.5px solid ${accent};
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          min-height: 287mm;
          box-sizing: border-box;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .doc-print .sign-field { height: 80px; display: flex; flex-direction: column; justify-content: flex-end; }
        .doc-print .sign-caption { min-height: 16px; display: flex; align-items: center; justify-content: center; }
        .doc-print .accent-bar { background: ${accent} !important; color: #ffffff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-print .accent-tx { color: ${accent}; }
        .doc-print .accent-bd { border-color: ${accent}; }
        .doc-print table.items { width: 100%; border-collapse: collapse; border: 1px solid ${accent}; }
        .doc-print table.items th { background: ${accent} !important; color: #ffffff !important; padding: 5px 4px; font-size: 10px; font-weight: 700; border: 1px solid ${accent}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .doc-print table.items td { padding: 5px 4px; border: 1px solid #e5e7eb; font-size: 10.5px; vertical-align: top; }
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
          {company.regd_address && <div className="text-[10px] mt-0.5">{company.regd_address}</div>}
          {[company.phone, company.email].filter(Boolean).join(" · ") && (
            <div className="text-[10px] mt-0.5">
              {[company.phone, company.email].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="lbl-r accent-tx">Conveyance Payslip</div>
          <div className="font-mono text-xs mt-1">
            {from || "—"} → {to || "—"}
          </div>
          {settlement.reference_no && (
            <div className="font-mono text-[10px] text-gray-600">Ref: {settlement.reference_no}</div>
          )}
          <div className="text-[10px] mt-1 font-semibold">{settlement.status ?? "Pending"}</div>
        </div>
      </div>

      {/* Employee + payment meta */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="lbl mb-1">Payee</div>
          <div className="font-semibold text-[12px]">{employee.name ?? employee.employee_id}</div>
          <div className="font-mono text-[10px] text-gray-600">{employee.employee_id}</div>
          {[employee.phone, employee.email].filter(Boolean).length > 0 && (
            <div className="text-[10px] text-gray-600">
              {[employee.phone, employee.email].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="lbl mb-1">Payment</div>
          {settlement.payment_ref ? (
            <>
              <div className="font-mono text-[11px]">{settlement.payment_ref}</div>
              {settlement.paid_at && (
                <div className="font-mono text-[10px] text-gray-600">
                  Paid {settlement.paid_at.slice(0, 10)}
                </div>
              )}
            </>
          ) : (
            <div className="text-[10px] text-gray-600">Unpaid</div>
          )}
        </div>
      </div>

      {/* Per-day break-up */}
      <table className="items">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Date</th>
            <th style={{ textAlign: "right" }}>Km</th>
            <th style={{ textAlign: "right" }}>Rate (₹/km)</th>
            <th style={{ textAlign: "right" }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {perDay.map((d) => (
            <tr key={d.date}>
              <td className="font-mono">{d.date}</td>
              <td style={{ textAlign: "right" }} className="tabular-nums">{d.km}</td>
              <td style={{ textAlign: "right" }} className="tabular-nums">
                {d.rate === null ? "—" : `₹${d.rate}`}
              </td>
              <td style={{ textAlign: "right" }} className="tabular-nums">₹{d.amount}</td>
            </tr>
          ))}
          {perDay.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center" }} className="text-gray-500">
                No day logs in this period.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className="font-semibold">Conveyance subtotal · {kmTotal} km</td>
            <td colSpan={2} />
            <td style={{ textAlign: "right" }} className="font-semibold tabular-nums">₹{computed}</td>
          </tr>
          <tr>
            <td className="font-semibold">Flat expenses</td>
            <td colSpan={2} />
            <td style={{ textAlign: "right" }} className="font-semibold tabular-nums">₹{flat}</td>
          </tr>
          {hasOverride && (
            <tr>
              <td className="font-semibold">
                Adjusted total{settlement.adjustment_reason ? ` — ${settlement.adjustment_reason}` : ""}
              </td>
              <td colSpan={2} />
              <td style={{ textAlign: "right" }} className="font-semibold tabular-nums">₹{payable}</td>
            </tr>
          )}
          <tr className="accent-bar">
            <td className="font-bold">Net payable</td>
            <td colSpan={2} />
            <td style={{ textAlign: "right" }} className="font-bold tabular-nums">₹{payable}</td>
          </tr>
        </tfoot>
      </table>

      <div className="text-[10px] mt-2 text-gray-700">
        Amount in words: {amountInWords(payable)}.
      </div>

      <div className="doc-spacer" />

      {/* Signatory */}
      <div className="grid grid-cols-2 gap-6 mt-4">
        <div className="sign-field text-center">
          <div className="sign-caption lbl">Prepared by</div>
        </div>
        <div className="sign-field text-center">
          <div className="sign-caption lbl">Authorised signatory</div>
        </div>
      </div>
    </div>
  );
}
