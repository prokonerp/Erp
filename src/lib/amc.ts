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

const addMonthsSafe = (base: Date, months: number): Date => {
  const day = base.getDate();
  const d = new Date(base);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
};

export const generatePMDates = (start: string, end: string): string[] => {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (!(e > s)) return [];
  // Number of full months between start and end (rounded).
  const months = Math.round(
    (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.4375),
  );
  // Quarterly visit count for the AMC duration. 12 months → 4 visits.
  const visits = Math.floor(months / 3);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 1; i <= visits; i++) {
    let d = addMonthsSafe(s, i * 3);
    // Clamp the final visit to the AMC end date if the quarterly
    // anniversary spills one day past end (e.g. start 29-May, end 28-May).
    if (d > e) d = new Date(e);
    const iso = d.toISOString().slice(0, 10);
    if (!seen.has(iso)) {
      seen.add(iso);
      out.push(iso);
    }
  }
  return out;
};

export const addYears = (date: string, years: number): string => {
  const d = new Date(date + "T00:00:00");
  d.setFullYear(d.getFullYear() + years);
  // typical AMC end = day before next anniversary
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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

// Display ISO date (YYYY-MM-DD) as DD-MM-YYYY
export const fmtDate = (iso?: string | null): string => {
  if (!iso) return "";
  const s = iso.slice(0, 10);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  return `${d}-${m}-${y}`;
};