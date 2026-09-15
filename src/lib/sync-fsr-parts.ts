import type { PartLine } from "@/lib/tickets";

/** Source tag for ticket part lines auto-staged from field service reports. */
export const PART_SOURCE_FSR = "fsr";

/** A part line staged from an FSR part_replacements entry, before ticket merge. */
export interface StagedPartLine {
  name: string;
  qty: number;
  serial?: string | null;
  remarks?: string | null;
}

/** One FSR part_replacements entry (camelCase, mirrors partReplacementSchema keys). */
export interface FsrPartInput {
  item?: string | null;
  qty?: number | null;
  oldSrNo?: string | null;
  newSrNo?: string | null;
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function normalizeQty(qty: number | null | undefined): number | null {
  if (qty === null || qty === undefined) return 1;
  return typeof qty === "number" && Number.isFinite(qty) && Number.isInteger(qty) && qty > 0
    ? qty
    : null;
}

/**
 * Split FSR part_replacements entries into defective (removed) and good (fitted) lines.
 * - Entries with a blank item are skipped (empties).
 * - Defective serial = oldSrNo; staged whenever the item is present.
 * - Good lines require newSrNo, staged with remarks: null.
 */
export function stageFsrParts(parts: FsrPartInput[]): {
  defective: StagedPartLine[];
  good: StagedPartLine[];
  skipped: number;
} {
  const defective: StagedPartLine[] = [];
  const good: StagedPartLine[] = [];
  let skipped = 0;
  for (const p of parts ?? []) {
    const name = clean(p?.item);
    if (!name) continue;
    const qtyRaw = p?.qty;
    const qty = normalizeQty(qtyRaw);
    if (qty === null) {
      skipped++;
      console.warn("[sync-fsr-parts] skipped entry with invalid qty:", qtyRaw, "for item:", name);
      continue;
    }
    const oldSrNo = clean(p?.oldSrNo);
    const newSrNo = clean(p?.newSrNo);

    const defSerial = oldSrNo || null;
    defective.push({ name, qty, serial: defSerial, remarks: null });

    if (newSrNo) {
      good.push({
        name,
        qty,
        serial: newSrNo,
        remarks: null,
      });
    }
  }
  return { defective, good, skipped };
}

/** Dedupe key: serial when present, else lower(trim(name)) + qty. */
function partKey(serial: string | null | undefined, name: string, qty: number | string): string {
  const base = (serial ?? name ?? "").trim().toLowerCase();
  return serial ? base : `${base}:q${qty}`;
}

/**
 * Additive-only merge of staged FSR lines into existing ticket part lines.
 * - Existing lines come first, staged lines are appended; nothing is removed.
 * - A staged line is skipped when an existing line with source === PART_SOURCE_FSR
 *   has an equal dedupe key. Admin lines (source !== "fsr", including unset)
 *   never block a staged line.
 * - Appended lines mirror the admin-created PartLine shape (qty as string,
 *   indent_id null) with source PART_SOURCE_FSR and confirmed:false.
 * - Idempotent: merge(merge(existing, staged), staged) deep-equals
 *   merge(existing, staged).
 */
export function mergePartLines(
  existing: PartLine[],
  staged: StagedPartLine[],
): { merged: PartLine[]; added: number } {
  const merged: PartLine[] = [...(existing ?? [])];
  const seen = new Set(
    merged
      .filter((l) => (l.source as string | undefined) === PART_SOURCE_FSR)
      .map((l) => partKey(l.serial, l.name, String(l.qty))),
  );
  let added = 0;
  for (const s of staged ?? []) {
    const key = partKey(s.serial, s.name, s.qty);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      name: s.name,
      qty: String(s.qty),
      ...(s.serial ? { serial: s.serial } : {}),
      ...(s.remarks ? { remarks: s.remarks } : {}),
      confirmed: false,
      source: PART_SOURCE_FSR as PartLine["source"],
      indent_id: null,
    });
    added++;
  }
  return { merged, added };
}
