/** Carrier (driver/engineer) identity helpers — FK-first, text fallback.
 *
 * Server triggers (migration 20260916000001) own the sync:
 * - FK set → driver_name/mobile overwritten from employees(name,phone)
 * - FK NULL + text changed → FK resolved from text (phone-first, name fallback)
 * The UI only sets/clears the FK and mirrors text for display; it never
 * edits triggers or migrations.
 */

export type CarrierEmployeeChoice = {
  id: string;
  name: string;
  phone: string | null;
};

export type CarrierTextState = {
  driver_name: string;
  driver_mobile: string;
  carrier_employee_id: string | null;
};

/** On picker select: set FK + auto-fill driver text from employee row. */
export function applyCarrierSelection(
  _current: CarrierTextState,
  emp: CarrierEmployeeChoice,
): CarrierTextState {
  return {
    carrier_employee_id: emp.id,
    driver_name: emp.name,
    driver_mobile: emp.phone ?? "",
  };
}

/** On picker clear: NULL the FK, leave text editable for trigger fallback. */
export function clearCarrierSelection(current: CarrierTextState): CarrierTextState {
  return {
    carrier_employee_id: null,
    driver_name: current.driver_name,
    driver_mobile: current.driver_mobile,
  };
}

export type CarrierRecord = {
  carrier_employee_id: string | null | undefined;
  carrier_employee_name: string | null | undefined;
  driver_name: string | null | undefined;
  driver_mobile: string | null | undefined;
};

/** Detail display: linked carrier name when FK present, else driver text. */
export function resolveCarrierDisplay(r: CarrierRecord): {
  name: string;
  mobile: string;
  linked: boolean;
} {
  const linked = !!r.carrier_employee_id;
  if (linked) {
    const name = (r.carrier_employee_name || "").trim() || (r.driver_name || "").trim();
    return { name, mobile: (r.driver_mobile || "").trim(), linked: true };
  }
  return {
    name: (r.driver_name || "").trim(),
    mobile: (r.driver_mobile || "").trim(),
    linked: false,
  };
}

/** Carrier hint staged by a ticket prefill: FK truth + legacy display name. */
export type PrefillCarrierHint = {
  employeeId: string | null;
  engineerName: string;
};

/** Pull the carrier hint out of a staged prefill payload (untyped JSON).
 *  Empty when the prefill carries no engineer — callers must no-op then. */
export function parsePrefillCarrier(payload: Record<string, unknown>): PrefillCarrierHint {
  const fk = payload.assigned_employee_id;
  const nm = payload.assigned_engineer_name;
  return {
    employeeId: typeof fk === "string" && fk ? fk : null,
    engineerName: typeof nm === "string" ? nm.trim() : "",
  };
}

/** Exact case-insensitive name match — the only safe text fallback.
 *  Returns the row only on a single exact hit; null when zero/ambiguous so
 *  the picker stays blank instead of linking the wrong employee. */
export function matchPrefillCarrierByName<T extends { name: string }>(
  rows: T[],
  name: string,
): T | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const exact = (rows || []).filter((r) => (r?.name || "").trim().toLowerCase() === want);
  return exact.length === 1 ? exact[0] : null;
}
