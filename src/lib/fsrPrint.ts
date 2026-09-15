// Pure print-model layer for the Field Service Report printout.
// No supabase, no DOM, no sessionStorage. All functions are total over
// sparse DB rows: nulls/empties degrade to dashes, never throw.

export type YesNo = "Yes" | "No";
export type FeedbackStatus = "Complete" | "Incomplete" | "Under Observation";
export type StatusLabel = "Warranty" | "Contract" | "Billable";
export type CallKind = "PM" | "Installation" | "";

/** Null/undefined/blank -> "—"; numbers (incl. 0) -> String(v). */
export function displayOrDash(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : "—";
  }
  return "—";
}

/** Nullable DB boolean -> printed "Yes"/"No". */
export function boolYesNo(v: boolean | null | undefined): YesNo {
  return v ? "Yes" : "No";
}

/** Ticket status -> printout feedback checkbox. */
export function mapCallStatus(status: string | null | undefined): FeedbackStatus {
  if (status === "Closed") return "Complete";
  if (status === "Under Observation") return "Under Observation";
  return "Incomplete";
}

/** Call type -> printed service-head label. */
export function statusLabel(callType: string | null | undefined): StatusLabel {
  if (callType === "Warranty") return "Warranty";
  if (callType === "AMC") return "Contract";
  return "Billable";
}

/** Call type -> printed call-kind checkbox ("…" -> "" leaves Other blank). */
export function typeOfCall(callType: string | null | undefined): CallKind {
  if (!callType) return "";
  if (callType.includes("PM")) return "PM";
  if (callType.includes("Installation")) return "Installation";
  return "";
}

/** Null-safe visit duration: "1h 30m" / "45m" / "—". */
export function formatDurationMin(
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
): string {
  if (!fromIso || !toIso) return "—";
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return "—";
  const mins = Math.round((to.getTime() - from.getTime()) / 60000);
  if (mins <= 0) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export interface VoltsReading {
  volts?: number | null;
}

/** Volts readings -> display strings chunked into rows of `cols`. */
export function readingsGrid(readings: VoltsReading[] | null | undefined, cols = 4): string[][] {
  const cells = (readings ?? []).map((r) =>
    r && typeof r.volts === "number" && Number.isFinite(r.volts) ? String(r.volts) : "—",
  );
  const rows: string[][] = [];
  for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols));
  return rows;
}

// ---- Structural input (loose: every key optional/nullable so DB rows fit) ----

export interface FsrPrintFsr {
  ticket_id?: string | null;
  id?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  mains_voltage_ln?: number | null;
  mains_voltage_ne?: number | null;
  battery_bank_make?: string | null;
  battery_bank_ah?: string | null;
  battery_bank_qty?: number | null;
  charging_readings?: VoltsReading[] | null;
  discharging_readings?: VoltsReading[] | null;
  rating?: number | null;
  ac_provided?: boolean | null;
  dg_provided?: boolean | null;
  environment_duty?: boolean | null;
  ups_location?: string | null;
  pc_details?: { monitor_size_in?: number | null; qty?: number | null }[] | null;
  printer_details?: { rating_w?: number | null; qty?: number | null }[] | null;
  scanner_details?: { rating_w?: number | null; qty?: number | null }[] | null;
  power_failures_count?: number | null;
  power_failures_duration_min?: number | null;
  load_on_dg_percent?: number | null;
  dg_set?: boolean | null;
  dg_set_capacity_kva?: number | null;
  amf_panel?: boolean | null;
  operate_non_business_hours?: boolean | null;
  operate_holidays?: boolean | null;
  part_replacements?:
    | {
        item?: string | null;
        old_sr_no?: string | null;
        new_sr_no?: string | null;
        charges?: number | null;
        qty?: number | null;
      }[]
    | null;
  engineer_name?: string | null;
  engineer_phone?: string | null;
}

export interface FsrPrintTicket {
  case_id?: string | null;
  call_type?: string | null;
  product?: string | null;
  serial_no?: string | null;
  customer_name?: string | null;
  customer_address?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  complaint?: string | null;
  status?: string | null;
  remarks?: string | null;
  assigned_engineer_name?: string | null;
  assigned_engineer_phone?: string | null;
  assigned_at?: string | null;
  preferred_visit_datetime?: string | null;
  closed_at?: string | null;
  created_at?: string | null;
  oem_call?: boolean | null;
  oem_brand?: string | null;
}

export interface FsrPrintCustomer {
  company?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  billing_address?: string | null;
  address?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  gst?: string | null;
}

export interface FsrPrintVisits {
  arrival_at?: string | null;
  departure_at?: string | null;
}

export interface FsrPrintInput {
  fsr: FsrPrintFsr;
  ticket: FsrPrintTicket;
  customer: FsrPrintCustomer | null;
  visits: FsrPrintVisits | null;
}

// ---- Print model ----

export interface LoadPair {
  size: string;
  qty: string;
}

export interface RatingPair {
  rating: string;
  qty: string;
}

export interface PartPrintRow {
  n: number;
  item: string;
  oldSr: string;
  newSr: string;
  charges: string;
  qty: string;
}

export interface FsrPrintModel {
  header: {
    caseId: string;
    reportNo: string;
    submittedAt: string;
    engineerName: string;
    engineerPhone: string;
  };
  customer: {
    name: string;
    addressLines: string[];
    phones: string[];
    email: string;
  };
  product: {
    model: string;
    upsSerial: string;
    batteryPack: string;
    statusLabel: StatusLabel;
    typeOfCall: CallKind;
  };
  problem: {
    reported: string;
    reason: string;
  };
  timing: {
    arrivalDate: string;
    arrivalTime: string;
    departureDate: string;
    departureTime: string;
    onSite: string;
    blanks: true;
  };
  observation: {
    mainsLn: string;
    mainsNe: string;
  };
  load: {
    ac: YesNo;
    dg: YesNo;
    duty: YesNo;
    location: string;
    pcs: LoadPair[];
    printers: RatingPair[];
    scanners: RatingPair[];
  };
  power: {
    failures: string;
    durationMin: string;
    loadDgPct: string;
    dgSet: YesNo;
    dgCapacity: string;
    amf: YesNo;
    nonBiz: YesNo;
    holidays: YesNo;
  };
  battery: {
    make: string;
    ah: string;
    qty: string;
    chargingGrid: string[][];
    dischargingGrid: string[][];
  };
  parts: PartPrintRow[];
  feedback: {
    status: FeedbackStatus;
    rating: string;
  };
  signatures: {
    customerName: string;
    fseName: string;
    fsePhone: string;
  };
}

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function firstPresent(...vals: (string | null | undefined)[]): string {
  for (const v of vals) {
    const t = clean(v);
    if (t) return t;
  }
  return "—";
}

function splitDateTime(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "—", time: "—" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "—", time: "—" };
  const pad = (n: number): string => String(n).padStart(2, "0");
  return {
    date: `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** Build the full print model. Pure; never throws on sparse input. */
export function buildFsrPrintModel(input: FsrPrintInput): FsrPrintModel {
  const fsr = input.fsr ?? {};
  const ticket = input.ticket ?? {};
  const customer = input.customer ?? null;
  const visits = input.visits ?? null;

  const rawId = clean(fsr.id);

  // Address mirrors tickets.$id.tsx: billing_address || street+address combo,
  // then city/state/country combo; ticket address only when no customer row.
  const addressLines: string[] = customer
    ? [
        clean(customer.billing_address) ||
          [clean(customer.street), clean(customer.address)].filter(Boolean).join("\n") ||
          "",
        [clean(customer.city), clean(customer.state), clean(customer.country)]
          .filter(Boolean)
          .join(", "),
      ].filter(Boolean)
    : [clean(ticket.customer_address)].filter(Boolean);

  const phones = [clean(customer?.phone), clean(ticket.customer_phone)].filter(Boolean);
  const uniquePhones = [...new Set(phones)];

  const callType = clean(ticket.call_type);
  const ticketRemarks = clean(ticket.remarks);
  const reason = callType
    ? ticketRemarks
      ? `${callType} — ${ticketRemarks}`
      : callType
    : ticketRemarks || "—";

  const arrival = splitDateTime(visits?.arrival_at);
  const departure = splitDateTime(visits?.departure_at);

  return {
    header: {
      caseId: displayOrDash(ticket.case_id),
      reportNo: rawId ? rawId.slice(0, 8).toUpperCase() : "—",
      submittedAt: displayOrDash(fsr.submitted_at ?? fsr.created_at),
      engineerName: firstPresent(fsr.engineer_name, ticket.assigned_engineer_name),
      engineerPhone: firstPresent(fsr.engineer_phone, ticket.assigned_engineer_phone),
    },
    customer: {
      name: firstPresent(customer?.company, customer?.contact_name, ticket.customer_name),
      addressLines,
      phones: uniquePhones,
      email: firstPresent(customer?.email, ticket.customer_email),
    },
    product: {
      model: displayOrDash(ticket.product),
      upsSerial: displayOrDash(ticket.serial_no),
      batteryPack: "—",
      statusLabel: statusLabel(callType || null),
      typeOfCall: typeOfCall(callType || null),
    },
    problem: {
      reported: displayOrDash(ticket.complaint),
      reason,
    },
    timing: {
      arrivalDate: arrival.date,
      arrivalTime: arrival.time,
      departureDate: departure.date,
      departureTime: departure.time,
      onSite: formatDurationMin(visits?.arrival_at, visits?.departure_at),
      blanks: true,
    },
    observation: {
      mainsLn: displayOrDash(fsr.mains_voltage_ln),
      mainsNe: displayOrDash(fsr.mains_voltage_ne),
    },
    load: {
      ac: boolYesNo(fsr.ac_provided),
      dg: boolYesNo(fsr.dg_provided),
      duty: boolYesNo(fsr.environment_duty),
      location: displayOrDash(fsr.ups_location),
      pcs: (fsr.pc_details ?? []).map((p) => ({
        size: displayOrDash(p?.monitor_size_in),
        qty: displayOrDash(p?.qty),
      })),
      printers: (fsr.printer_details ?? []).map((p) => ({
        rating: displayOrDash(p?.rating_w),
        qty: displayOrDash(p?.qty),
      })),
      scanners: (fsr.scanner_details ?? []).map((s) => ({
        rating: displayOrDash(s?.rating_w),
        qty: displayOrDash(s?.qty),
      })),
    },
    power: {
      failures: displayOrDash(fsr.power_failures_count),
      durationMin: displayOrDash(fsr.power_failures_duration_min),
      loadDgPct: displayOrDash(fsr.load_on_dg_percent),
      dgSet: boolYesNo(fsr.dg_set),
      dgCapacity: displayOrDash(fsr.dg_set_capacity_kva),
      amf: boolYesNo(fsr.amf_panel),
      nonBiz: boolYesNo(fsr.operate_non_business_hours),
      holidays: boolYesNo(fsr.operate_holidays),
    },
    battery: {
      make: displayOrDash(fsr.battery_bank_make),
      ah: displayOrDash(fsr.battery_bank_ah),
      qty: displayOrDash(fsr.battery_bank_qty),
      chargingGrid: readingsGrid(fsr.charging_readings),
      dischargingGrid: readingsGrid(fsr.discharging_readings),
    },
    parts: (fsr.part_replacements ?? []).slice(0, 5).map((p, i) => ({
      n: i + 1,
      item: displayOrDash(p?.item),
      oldSr: displayOrDash(p?.old_sr_no),
      newSr: displayOrDash(p?.new_sr_no),
      charges: displayOrDash(p?.charges),
      qty: displayOrDash(p?.qty),
    })),
    feedback: {
      status: mapCallStatus(clean(ticket.status) || null),
      rating: displayOrDash(fsr.rating),
    },
    signatures: {
      customerName: firstPresent(customer?.contact_name, customer?.company, ticket.customer_name),
      fseName: firstPresent(fsr.engineer_name, ticket.assigned_engineer_name),
      fsePhone: firstPresent(fsr.engineer_phone, ticket.assigned_engineer_phone),
    },
  };
}
