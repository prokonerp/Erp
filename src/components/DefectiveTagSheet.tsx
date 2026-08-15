import { forwardRef } from "react";
import { fmtDate, type DefectiveTag } from "@/lib/defectiveTags";

/** Tags per A4 portrait page — 2 columns × 2 rows. */
export const TAGS_PER_PAGE = 4;

function Field({ label, value, wide }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={`flex border-b border-black/70 min-h-[6mm] ${wide ? "col-span-2" : ""}`}>
      <div className="w-[40%] shrink-0 border-r border-black/70 px-2 py-[3px] text-[9px] font-semibold uppercase tracking-tight leading-tight">
        {label}
      </div>
      <div className="flex-1 px-2 py-[3px] text-[9.5px] leading-tight break-words">{value || ""}</div>
    </div>
  );
}

export function DefectiveTagCard({ tag }: { tag: DefectiveTag }) {
  const count = Math.max(0, Math.min(4, tag.replacement_count ?? 1));
  return (
    <div
      className="defective-tag border-2 border-black bg-white text-black flex flex-col overflow-hidden"
      style={{ width: "130mm", height: "90mm" }}
    >
      <div className="border-b-2 border-black px-2 py-[3px] flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.1em] uppercase">Defective Tag</span>
        <span className="text-[9px] font-mono">{tag.tag_no || ""}</span>
      </div>
      <div className="grid grid-cols-1">
        <Field label="Model No." value={tag.model_no} />
        <Field label="Defective Sr. No." value={tag.serial_no} />
        <Field label="OEM Case ID" value={tag.oem_case_id} />
        <Field label="Oracle Order No." value={tag.oracle_order_no} />
        <Field label="Customer Name" value={tag.customer_name} />
        <Field label="ASP Code" value={tag.asp_code} />
        <Field label="Engineer Name" value={tag.engineer_name} />
        <Field label="Replacement Date" value={fmtDate(tag.replacement_date)} />
        <div className="flex border-b border-black/70 min-h-[6mm]">
          <div className="w-[40%] shrink-0 border-r border-black/70 px-2 py-[3px] text-[9px] font-semibold uppercase tracking-tight leading-tight">
            No. of Warranty Repl.
          </div>
          <div className="flex-1 px-2 py-[3px] flex items-center gap-2">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className="flex items-center gap-[3px] text-[9px]">
                <span className="inline-flex h-[11px] w-[11px] items-center justify-center border border-black leading-none text-[8px]">
                  {n <= count ? "X" : ""}
                </span>
                {n}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 flex">
        <div className="w-[40%] shrink-0 border-r border-black/70 px-2 py-[3px] text-[9px] font-semibold uppercase tracking-tight leading-tight">
          Reason for Replacement
        </div>
        <div className="flex-1 px-2 py-[3px] text-[9.5px] leading-tight break-words">{tag.reason || ""}</div>
      </div>
      <div className="border-t border-black/70 px-2 py-[1px] flex justify-end text-[8px]">
        <span>Generated: {fmtDate(tag.tag_date)}</span>
      </div>
    </div>
  );
}

/**
 * A4 portrait sheet(s) holding {@link TAGS_PER_PAGE} tags each, with equal
 * spacing and no tag ever split across a page. Used for both preview and print
 * so the two outputs are identical.
 */
export const DefectiveTagSheet = forwardRef<HTMLDivElement, { tags: DefectiveTag[] }>(
  function DefectiveTagSheet({ tags }, ref) {
    const pages: DefectiveTag[][] = [];
    for (let i = 0; i < tags.length; i += TAGS_PER_PAGE) pages.push(tags.slice(i, i + TAGS_PER_PAGE));
    return (
      <div ref={ref} className="defective-tag-sheet">
        {pages.map((page, i) => (
          <div
            key={i}
            className="defective-tag-page bg-white mx-auto"
            style={{ width: "277mm", minHeight: "190mm", padding: "0", boxSizing: "border-box" }}
          >
            <div className="grid grid-cols-2 gap-x-[8mm] gap-y-[6mm] justify-items-start">
              {page.map((t) => (
                <div key={t.id} style={{ width: "130mm", height: "90mm" }} className="break-inside-avoid">
                  <DefectiveTagCard tag={t} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  },
);