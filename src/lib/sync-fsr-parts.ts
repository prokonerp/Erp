import type { PartLine } from "@/lib/tickets";

/** Source tag for ticket part lines auto-staged from field service reports. */
export const PART_SOURCE_FSR = "fsr";

/** A part line staged from an FSR part_replacements entry, before ticket merge. */
export interface StagedPartLine {
  name: string;
  qty: number;
  model?: string | null;
  serial?: string | null;
  remarks?: string | null;
}

/** One FSR part_replacements entry (camelCase, mirrors partReplacementSchema keys). */
export interface FsrPartInput {
  item?: string | null;
  qty?: number | null;
  model?: string | null;
  oldSrNo?: string | null;
  newSrNo?: string | null;
}

/** Skipped-reason: defective line with a blank old serial (phantom guard). */
export const SKIPPED_REASON_BLANK_OLD_SERIAL = "blank-old-serial";
/** Skipped-reason: entry with an invalid (non-positive-integer) qty. */
export const SKIPPED_REASON_INVALID_QTY = "invalid-qty";

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
 * - Entries with a blank item are skipped (empties, uncounted — legacy behaviour).
 * - A defective line with a blank oldSrNo is a PHANTOM (no identity to dedupe
 *   or reconcile): it is counted in `skipped` with reason `blank-old-serial`
 *   and never appended. The good side of the same entry still stages when
 *   newSrNo is present (a fitted part is real data even when the removed
 *   serial is unknown).
 * - Good lines require newSrNo, staged with remarks: null.
 * - NOTE on qty: the same replacement qty is staged on BOTH the defective
 *   (removed) and good (fitted) sides. That is CORRECT 1:1-swap semantics
 *   (qty removed == qty fitted), not a double-count — do not "fix" it by
 *   halving or zeroing one side.
 */
export function stageFsrParts(parts: FsrPartInput[]): {
  defective: StagedPartLine[];
  good: StagedPartLine[];
  skipped: number;
  skippedReasons: string[];
} {
  const defective: StagedPartLine[] = [];
  const good: StagedPartLine[] = [];
  const skippedReasons: string[] = [];
  for (const p of parts ?? []) {
    const name = clean(p?.item);
    if (!name) continue;
    const qtyRaw = p?.qty;
    const qty = normalizeQty(qtyRaw);
    if (qty === null) {
      skippedReasons.push(SKIPPED_REASON_INVALID_QTY);
      console.warn("[sync-fsr-parts] skipped entry with invalid qty:", qtyRaw, "for item:", name);
      continue;
    }
    const model = clean(p?.model) || null;
    const oldSrNo = clean(p?.oldSrNo);
    const newSrNo = clean(p?.newSrNo);

    if (!oldSrNo) {
      skippedReasons.push(SKIPPED_REASON_BLANK_OLD_SERIAL);
      console.warn("[sync-fsr-parts] skipped defective phantom (blank old serial) for item:", name);
    } else {
      defective.push({ name, qty, model, serial: oldSrNo, remarks: null });
    }

    if (newSrNo) {
      good.push({
        name,
        qty,
        model,
        serial: newSrNo,
        remarks: null,
      });
    }
  }
  return { defective, good, skipped: skippedReasons.length, skippedReasons };
}

/**
 * Dedupe-key format (built by buildPartDedupeKey):
 * - serial present: `sn:<lower(trim(serial))>|m:<lower(trim(model ?? ""))>`
 * - else:           `name:<lower(trim(name))>|m:<lower(trim(model ?? ""))>|q:<qty>`
 * The model is part of the key in both branches so the same serial on a
 * different model cannot collide.
 */
export function buildPartDedupeKey(input: {
  serial?: string | null;
  name: string;
  model?: string | null;
  qty: number | string;
}): string {
  const serial = (input.serial ?? "").trim().toLowerCase();
  const model = (input.model ?? "").trim().toLowerCase();
  if (serial) return `sn:${serial}|m:${model}`;
  const name = (input.name ?? "").trim().toLowerCase();
  return `name:${name}|m:${model}|q:${input.qty}`;
}

/**
 * Additive-only merge of staged FSR lines into existing ticket part lines.
 * - Existing lines come first, staged lines are appended; nothing is removed.
 *   Admin hand-added lines are never thrown away.
 * - The `seen` dedupe set covers ALL existing ticket lines (any source —
 *   fsr or admin hand-added), keyed by normalized serial when present else
 *   `name|model|qty`. So a re-sync after an admin hand-add converges instead
 *   of duplicating, and the single `updated_at` retry in
 *   syncFsrPartsToTicket is safe (retry re-merges the same staged lines
 *   against fresh state and adds nothing twice).
 * - Appended lines mirror the admin-created PartLine shape (qty as string,
 *   model_no when known, indent_id null) with source PART_SOURCE_FSR and
 *   confirmed:false.
 * - Idempotent: merge(merge(existing, staged), staged) deep-equals
 *   merge(existing, staged).
 */
export function mergePartLines(
  existing: PartLine[],
  staged: StagedPartLine[],
): { merged: PartLine[]; added: number } {
  const merged: PartLine[] = [...(existing ?? [])];
  const seen = new Set(
    merged.map((l) =>
      buildPartDedupeKey({ serial: l.serial, name: l.name, model: l.model_no, qty: String(l.qty) }),
    ),
  );
  let added = 0;
  for (const s of staged ?? []) {
    const key = buildPartDedupeKey({ serial: s.serial, name: s.name, model: s.model, qty: s.qty });
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      name: s.name,
      qty: String(s.qty),
      ...(s.model ? { model_no: s.model } : {}),
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
