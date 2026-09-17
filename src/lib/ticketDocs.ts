import { GRN_CUSTOMER_PREFILL_KEY } from "@/lib/generalDc";
import type { ChallanItem } from "@/lib/challan";
import type { GrnItem } from "@/lib/grn";
import type { PartLine } from "@/lib/tickets";

/** Identity of the source ticket for both prefill builders.
 *  assignedEmployeeId is the FK truth (tickets.assigned_employee_id);
 *  assignedEngineerName is the legacy display fallback. Both are optional so
 *  non-ticket callers and unassigned tickets stage exactly as before. */
export type TicketDocInput = {
  ticketId: string;
  caseId: string;
  customerId: string | null;
  assignedEmployeeId?: string | null;
  assignedEngineerName?: string | null;
};

/** No exported const exists repo-wide for the customer-DC prefill key
 *  (ChallanForm consumes the literal), so the literal is used here. */
const CHALLAN_CUSTOMER_PREFILL_KEY = "challan:prefill:new-customer";

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** Mirror normalizeQty in sync-fsr-parts (finite number > 0 floored, else 1);
 *  PartLine qty is a string, so parse it first. */
function normalizeLineQty(qty: string | null | undefined): number {
  const n = Number((qty ?? "").trim());
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/** Split ticket part lines into those safe to stage into a GRN/DC prefill
 *  vs. unconfirmed FSR lines that must stay out until an admin confirms them.
 *  (Blank-name skipping stays in the builders, not here.) */
export function stageableTicketLines(lines: PartLine[]): {
  included: PartLine[];
  excludedUnconfirmed: number;
} {
  const list = lines ?? [];
  const included = list.filter((p) => p.confirmed !== false && (p.confirmed || p.source !== "fsr"));
  // Every staged-out line counts — including confirmed:false non-FSR lines,
  // so the admin banner never under-reports what was held back.
  const excludedUnconfirmed = list.length - included.length;
  return { included, excludedUnconfirmed };
}

/** Swap-pair guard: a serial present on BOTH the good-parts side and the
 *  defective-parts side means the same physical part was staged twice —
 *  block staging, don't guess which side is right. Comparison is
 *  upper(trim())-normalized; blank serials are ignored. */
export function findSwapConflicts(good: PartLine[], defective: PartLine[]): { serial: string }[] {
  const norm = (v: string | null | undefined): string => (v ?? "").trim().toUpperCase();
  const goodSet = new Set((good ?? []).map((p) => norm(p?.serial)).filter(Boolean));
  const seen = new Set<string>();
  const out: { serial: string }[] = [];
  for (const p of defective ?? []) {
    const s = norm(p?.serial);
    if (!s || !goodSet.has(s) || seen.has(s)) continue;
    seen.add(s);
    out.push({ serial: s });
  }
  return out;
}

/** Build the Customer GRN prefill payload for defective ticket parts.
 *  Item mapping mirrors buildReturnGrnPrefill in generalDc.ts. */
export function buildTicketGrnPrefill(input: TicketDocInput, defective: PartLine[]) {
  const items: GrnItem[] = (defective ?? []).flatMap((it) => {
    const name = clean(it?.name);
    if (!name) return [];
    const modelNo = clean(it?.model_no);
    const serial = clean(it?.serial);
    const base = {
      part_no: modelNo || name,
      part_name: name,
      description: "",
      uom: "Nos",
      batch_no: "",
      model_no: modelNo || undefined,
      condition: "Defective",
      remarks: it?.remarks ?? "",
    };
    if (serial) {
      return [
        {
          ...base,
          serial_no: serial,
          // NOTE: dual keys intentional — grn_post_inventory prefers serials[] when present; GrnSerialInputs syncs on serial_no.
          serials: [serial],
          qty_received: "1",
          qty_accepted: "1",
          qty_rejected: "0",
        },
      ];
    }
    const q = String(normalizeLineQty(it?.qty));
    return [{ ...base, serial_no: "", qty_received: q, qty_accepted: q, qty_rejected: "0" }];
  });
  return {
    source: "ticket",
    ticket_id: input.ticketId,
    customer_id: input.customerId,
    reference_no: `Ticket ${input.caseId}`,
    source_doc_type: "Field Service Report",
    source_doc_no: `Ticket ${input.caseId}`,
    ticket_no: input.caseId,
    assigned_employee_id: input.assignedEmployeeId ?? null,
    assigned_engineer_name: input.assignedEngineerName ?? null,
    internal_remarks: `Defective parts received from customer against ticket ${input.caseId}`,
    items,
  };
}

/** Build the Customer DC prefill payload for good ticket parts.
 *  Items use the real emptyItem() keys from @/lib/challan; no challan remark. */
export function buildTicketDcPrefill(input: TicketDocInput, good: PartLine[]) {
  const items: ChallanItem[] = (good ?? []).flatMap((it) => {
    const name = clean(it?.name);
    if (!name) return [];
    const modelNo = clean(it?.model_no);
    const serial = clean(it?.serial);
    if (serial) {
      return [
        {
          part_no: modelNo || name,
          part_name: name,
          description: "",
          uom: "Nos",
          qty: "1",
          model_no: modelNo,
          serial_no: serial,
        },
      ];
    }
    return [
      {
        part_no: modelNo || name,
        part_name: name,
        description: "",
        uom: "Nos",
        qty: String(normalizeLineQty(it?.qty)),
        model_no: modelNo,
        serial_no: "",
      },
    ];
  });
  return {
    source: "ticket",
    ticket_id: input.ticketId,
    customer_id: input.customerId,
    reference_no: `Ticket ${input.caseId}`,
    assigned_employee_id: input.assignedEmployeeId ?? null,
    assigned_engineer_name: input.assignedEngineerName ?? null,
    internal_remarks: `Good parts issued to customer against ticket ${input.caseId}`,
    items,
  };
}

/** Store the GRN prefill and hand off to the Customer GRN creation screen. */
export function stageTicketGrnPrefill(input: TicketDocInput, defective: PartLine[]): void {
  try {
    sessionStorage.setItem(
      GRN_CUSTOMER_PREFILL_KEY,
      JSON.stringify(buildTicketGrnPrefill(input, defective)),
    );
  } catch {
    /* noop */
  }
}

/** Store the DC prefill and hand off to the Customer DC creation screen. */
export function stageTicketDcPrefill(input: TicketDocInput, good: PartLine[]): void {
  try {
    sessionStorage.setItem(
      CHALLAN_CUSTOMER_PREFILL_KEY,
      JSON.stringify(buildTicketDcPrefill(input, good)),
    );
  } catch {
    /* noop */
  }
}
