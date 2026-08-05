import { forwardRef } from "react";
import { fmtDate, type DefectiveTag } from "@/lib/defectiveTags";

/** Tags per A4 portrait page — 2 columns × 2 rows. */
export const TAGS_PER_PAGE = 4;

function Field({ label, value, wide }: { label: string; value?: string | null; wide?: boolean }) {
  return (
    <div className={`flex border-b border-black/70 min-h-[16px] ${wide ? "col-span-2" : ""}`}>
      <div className="w-[44%] shrink-0 border-r border-black/70 px-1 py-[2px] text-[7.5px] font-semibold uppercase tracking-tight leading-tight">
        {label}
      </div>
      <div className="flex-1 px-1 py-[2px] text-[8.5px] leading-tight break-words">{value || ""}</div>
    </div>
  );
}

export function DefectiveTagCard({ tag }: { tag: DefectiveTag }) {
  const count = Math.max(0, Math.min(4, tag.replacement_count ?? 1));
  return (
    <div className="defective-tag h-full border-2 border-black bg-white text-black flex flex-col overflow-hidden">
      <div className="border-b-2 border-black px-1.5 py-[2px] flex items-center justify-between">
        <span className="text-[10px] font-bold tracking-[0.1em] uppercase">Defective Tag</span>
        <span className="text-[8px] font-mono">{tag.tag_no || ""}</span>
      </div>
      <div className="grid grid-cols-1">
        <Field label="Model No." value={tag.model_no} />
        <Field label="Defective Sr. No." value={tag.serial_no} />
        <Field label="Service Request No." value={tag.service_request_no} />
        <Field label="Oracle Order No." value={tag.oracle_order_no} />
        <Field label="Customer Name" value={tag.customer_name} />
        <Field label="ASP Code" value={tag.asp_code} />
        <Field label="Engineer Name" value={tag.engineer_name} />
        <Field label="Replacement Date" value={fmtDate(tag.replacement_date)} />
        <div className="flex border-b border-black/70 min-h-[16px]">
          <div className="w-[44%] shrink-0 border-r border-black/70 px-1 py-[2px] text-[7.5px] font-semibold uppercase tracking-tight leading-tight">
            No. of Warranty Repl.
          </div>
          <div className="flex-1 px-1 py-[2px] flex items-center gap-1.5">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className="flex items-center gap-[2px] text-[7.5px]">
                <span className="inline-flex h-[9px] w-[9px] items-center justify-center border border-black leading-none text-[7px]">
                  {n <= count ? "X" : ""}
                </span>
                {n}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 flex">
        <div className="w-[44%] shrink-0 border-r border-black/70 px-1 py-[2px] text-[7.5px] font-semibold uppercase tracking-tight leading-tight">
          Reason for Replacement
        </div>
        <div className="flex-1 px-1 py-[2px] text-[8.5px] leading-tight break-words">{tag.reason || ""}</div>
      </div>
      <div className="border-t border-black/70 px-1 py-[1px] flex justify-between text-[7px]">
        <span>Stock IN: {tag.txn_no || "—"}</span>
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
            style={{ width: "190mm", minHeight: "277mm", padding: "0", boxSizing: "border-box" }}
          >
            <div className="grid grid-cols-2 gap-x-[8mm] gap-y-[8mm]">
              {page.map((t) => (
                <div key={t.id} style={{ height: "125mm" }} className="break-inside-avoid">
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