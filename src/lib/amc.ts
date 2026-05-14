export type AmcUnit = { model: string; serial_no: string };

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

export const generatePMDates = (start: string, end: string): string[] => {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const cur = new Date(s);
  cur.setMonth(cur.getMonth() + 3);
  while (cur <= e) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setMonth(cur.getMonth() + 3);
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