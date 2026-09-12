/**
 * Pure helpers for Phase-2 custody (carrier) logic.
 * No React, no Supabase, no side effects — safe for unit tests.
 */

export type CustodyRow = {
  serial_no: string | null;
  current_custodian: string | null | undefined;
};

function normSerial(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim().toUpperCase();
  return t ? t : null;
}

/** True only when the row has never been stamped (NULL/undefined). Empty string counts as set. */
export function shouldStampCustodian(row: Pick<CustodyRow, "current_custodian">): boolean {
  return row.current_custodian == null;
}

/** DC submit: stamp only-NULL rows with carrier. Carrier-less DC is a no-op. Pure (no mutation). */
export function stampDcCustody<T extends CustodyRow>(
  rows: T[],
  carrier: string | null | undefined,
): T[] {
  if (!carrier || !carrier.trim()) return rows.map((r) => ({ ...r }));
  return rows.map((r) => (shouldStampCustodian(r) ? { ...r, current_custodian: carrier } : { ...r }));
}

export type GrnClearInput = {
  serials?: (string | null | undefined)[];
  serial_no?: string | null | undefined;
};

export type GrnClearResult<T> = {
  updated: T[];
  cleared: string[];
  warnings: string[];
};

/**
 * GRN receipt: clear only-NOT-NULL rows matched by serials[] (or serial_no fallback).
 * Unknown serials produce a warning and do not fail the receipt. Pure (no mutation).
 */
export function clearGrnCustody<T extends CustodyRow>(rows: T[], input: GrnClearInput): GrnClearResult<T> {
  const fromList = (input.serials ?? []).map((s) => (s ?? "").trim()).filter(Boolean);
  const requested: string[] = fromList.length > 0
    ? fromList
    : ((input.serial_no ?? "").trim() ? [(input.serial_no as string).trim()] : []);

  if (requested.length === 0) {
    return { updated: rows.map((r) => ({ ...r })), cleared: [], warnings: [] };
  }

  const byNorm = new Map<string, number>();
  rows.forEach((r, i) => {
    const n = normSerial(r.serial_no);
    if (n && !byNorm.has(n)) byNorm.set(n, i);
  });

  const cleared: string[] = [];
  const warnings: string[] = [];
  const updated = rows.map((r) => ({ ...r }));

  for (const raw of requested) {
    const n = normSerial(raw);
    if (!n) continue;
    const idx = byNorm.get(n);
    if (idx == null) {
      warnings.push(`Unknown serial: ${raw}`);
      continue;
    }
    const row = updated[idx];
    if (row.current_custodian !== null && row.current_custodian !== undefined) {
      updated[idx] = { ...row, current_custodian: null };
      cleared.push(row.serial_no as string);
    }
  }

  return { updated, cleared, warnings };
}

/* ── Read-only custody display helpers (Phase-2 surfacing, no writes) ──
 * Non-goal (decision, do NOT implement): GDC stamp trigger + wiring of
 * indents.engineer_employee_id into custody. Left as-is per approved design;
 * custody is display-only (dispatch/receipt never blocked on lookup failure).
 */

export type CustodyDisplayRow = {
  custodian_employee_id?: string | null;
  custodian_name?: string | null;
};

export type CustodianFilterMode = "all" | "in-custody" | "no-custodian";

/** Resolved employee name, trimmed. Null when no custodian id or no name. Never throws. */
export function custodianDisplayName(row: CustodyDisplayRow): string | null {
  try {
    if (!row || row.custodian_employee_id == null || String(row.custodian_employee_id).trim() === "") return null;
    const n = (row.custodian_name ?? "").trim();
    return n ? n : null;
  } catch {
    return null;
  }
}

/**
 * Badge text for pickers/detail. Null when no custodian (nothing to show).
 * Falls back to "Unknown custodian" when the id is present but the name
 * lookup failed — display must never block dispatch/receipt.
 */
export function custodianBadgeLabel(row: CustodyDisplayRow): string | null {
  try {
    if (!row || row.custodian_employee_id == null || String(row.custodian_employee_id).trim() === "") return null;
    const name = custodianDisplayName(row);
    return `In custody: ${name ?? "Unknown custodian"}`;
  } catch {
    return "In custody: Unknown custodian";
  }
}

/** Client-side custody filter. Default "all" (off). Pure (no mutation). */
export function filterByCustodian<T extends { custodian_employee_id?: string | null }>(
  rows: T[],
  mode: CustodianFilterMode,
): T[] {
  if (mode === "all") return rows.slice();
  if (mode === "in-custody")
    return rows.filter((r) => r.custodian_employee_id != null && String(r.custodian_employee_id).trim() !== "");
  return rows.filter((r) => r.custodian_employee_id == null || String(r.custodian_employee_id).trim() === "");
}

/** Rows carried by one employee. Empty when employeeId is missing. Pure. */
export function filterMyCarried<T extends { custodian_employee_id?: string | null }>(
  rows: T[],
  employeeId: string | null | undefined,
): T[] {
  if (!employeeId || !String(employeeId).trim()) return [];
  return rows.filter((r) => r.custodian_employee_id === employeeId);
}

/** Count of carried rows per custodian id. Pure. */
export function countCarriedByCustodian<T extends { custodian_employee_id?: string | null }>(
  rows: T[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const id = r.custodian_employee_id;
    if (id == null || String(id).trim() === "") continue;
    out[String(id)] = (out[String(id)] ?? 0) + 1;
  }
  return out;
}
