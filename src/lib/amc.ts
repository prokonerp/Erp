export type AmcUnit = {
  model: string;
  serial_no: string;
  // New optional fields (Product Master driven). Older records may lack these.
  category?: string | null;
  product_id?: string | null;
};

export type Amc = {
  id: string;
  agreement_no: string;
  client_name: string;
  client_company: string | null;
  client_address: string | null;
  client_gst: string | null;
  contact_no: string | null;
  email: string | null;
  units: AmcUnit[];
  start_date: string;
  end_date: string;
  bill_date?: string | null;
  duration_years: number;
  amc_value: number | null;
  terms: string | null;
  pm_dates: string[];
  remarks: string | null;
  prev_amc_id: string | null;
  created_at: string;
  oem_call?: boolean;
  oem_brand?: string | null;
  oem_ref_id?: string | null;
  oem_purchase_date?: string | null;
  agreement_doc_path?: string | null;
};

export const amcStatus = (end_date: string): "active" | "expiring" | "expired" => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(end_date + "T00:00:00");
  const diffDays = Math.floor((end.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "expired";
  if (diffDays <= 30) return "expiring";
  return "active";
};

export const statusLabel = (s: ReturnType<typeof amcStatus>) =>
  s === "active" ? "Active" : s === "expiring" ? "Expiring soon" : "Expired";

export const statusBadgeClass = (s: ReturnType<typeof amcStatus>) =>
  s === "active"
    ? "bg-green-100 text-green-800 border-green-300"
    : s === "expiring"
    ? "bg-orange-100 text-orange-800 border-orange-300"
    : "bg-red-100 text-red-800 border-red-300";

export const statusRowClass = (s: ReturnType<typeof amcStatus>) =>
  s === "active"
    ? "bg-green-50 hover:bg-green-100/70"
    : s === "expiring"
    ? "bg-orange-50 hover:bg-orange-100/70"
    : "bg-red-50 hover:bg-red-100/70";

// Add N months to a YYYY-MM-DD date, returning YYYY-MM-DD. Preserves day-of-month
// where possible (clamps to month end for shorter months).
const addMonths = (iso: string, months: number): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const targetMonthIdx = (m - 1) + months;
  const targetYear = y + Math.floor(targetMonthIdx / 12);
  const targetMonth = ((targetMonthIdx % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d, lastDayOfTargetMonth);
  const mm = String(targetMonth + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
};

// PM schedule: 4 visits per year with a 2-3-3 interval pattern from start
// (Year 1: +2, +3, +3, +3 months). Each additional year adds 4 more visits at +3 months each.
// L15: the final contract month must not be skipped — the last visit is anchored
// to the contract end date so every agreement gets a closing PM.
export const generatePMDates = (start: string, durationYears: number): string[] => {
  if (!start || !durationYears || durationYears <= 0) return [];
  const totalVisits = 4 * durationYears;
  const out: string[] = [];
  let cur = start.slice(0, 10);
  for (let i = 0; i < totalVisits; i++) {
    const inc = i === 0 ? 2 : 3;
    cur = addMonths(cur, inc);
    out.push(cur);
  }
  out[out.length - 1] = addYears(start.slice(0, 10), durationYears);
  return out;
};

export const addYears = (date: string, years: number): string => {
  const months = Math.round(years * 12);
  const isoAfter = addMonths(date, months); // "YYYY-MM-DD"
  // Subtract 1 day using UTC math to avoid timezone shifts.
  // AMC end = Start + duration − 1 day (e.g. 22-Jul-2026 + 1Y = 21-Jul-2027).
  const [y, m, d] = isoAfter.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

export const nextAgreementNo = (existing: string[]): string => {
  const yr = new Date().getFullYear();
  const prefix = `PHS/AMC/${yr}/`;
  let max = 0;
  for (const a of existing) {
    if (a?.startsWith(prefix)) {
      const n = parseInt(a.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(4, "0");
};

// Display ISO date (YYYY-MM-DD) as DD-MMM-YYYY (e.g. 29-May-2026)
export const fmtDate = (iso?: string | null): string => {
  if (!iso) return "";
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = parseInt(m, 10) - 1;
  if (mi < 0 || mi > 11) return s;
  return `${d}-${months[mi]}-${y}`;
};

// Display ISO date as MMM-YYYY (e.g. Jul-2026). Used in AMC Agreement
// tentative service schedule.
export const fmtMonthYear = (iso?: string | null): string => {
  if (!iso) return "";
  const s = iso.slice(0, 10);
  const [y, m] = s.split("-");
  if (!y || !m) return s;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = parseInt(m, 10) - 1;
  if (mi < 0 || mi > 11) return s;
  return `${months[mi]}-${y}`;
};