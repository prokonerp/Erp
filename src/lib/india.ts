import { INDIAN_STATES } from "@/lib/crm";

/** GSTIN first 2 digits → State / UT name. */
export const GSTIN_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export function stateFromGSTIN(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const code = gstin.trim().slice(0, 2);
  return GSTIN_STATE_CODES[code] ?? null;
}

export function isValidGSTIN(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  return GSTIN_REGEX.test(gstin.trim().toUpperCase());
}

// ── P1 — GSTIN checksum (mod-36, NIC spec) ──────────────────────────────
const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function gstinCharValue(ch: string): number {
  const idx = GSTIN_CHARSET.indexOf(ch);
  return idx >= 0 ? idx : -1;
}

/** checksum char for first 14 chars of a GSTIN */
export function gstinChecksumChar(gstin14: string): string | null {
  const s = gstin14.trim().toUpperCase();
  if (s.length !== 14) return null;
  let factor = 1; // FIX: factor 1 LTR per NIC, was 2
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = gstinCharValue(s[i]);
    if (v < 0) return null;
    const prod = v * factor;
    sum += Math.floor(prod / 36) + (prod % 36);
    factor = factor === 2 ? 1 : 2;
  }
  const check = (36 - (sum % 36)) % 36;
  return GSTIN_CHARSET[check];
}

/** true if GSTIN passes regex AND checksum char matches (15th char) */
export function validateGSTINChecksum(gstin: string | null | undefined): boolean {
  if (!gstin) return false;
  const s = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(s)) return false;
  if (s.length !== 15) return false;
  const expected = gstinChecksumChar(s.slice(0, 14));
  return expected !== null && s[14] === expected;
}

// ── P1 — PIN → state lookup (fallback when GSTIN not available) ─────────
// First 2-3 digits of PIN map to postal circle → GST state code.
// Approximate but covers demo pins 122001, 110001 and all circles.
const PIN_PREFIX_TO_STATE_CODE: Record<string, string> = {
  "11": "07", // Delhi
  "12": "06", // Haryana
  "13": "06",
  "14": "03", // Punjab
  "15": "03",
  "16": "04", // Chandigarh
  "17": "02", // HP
  "18": "01", // J&K
  "19": "01",
  "20": "09", // UP
  "21": "09",
  "22": "09",
  "23": "23", // MP
  "24": "09",
  "25": "09",
  "26": "09",
  "27": "09",
  "28": "09",
  "30": "08", // Rajasthan
  "31": "08",
  "32": "08",
  "33": "08",
  "34": "08",
  "36": "36", // Telangana / Gujarat overlap — prefer Telangana for 50xxx
  "37": "37", // AP
  "38": "24", // Gujarat
  "39": "24",
  "40": "27", // Maharashtra
  "41": "27",
  "42": "27",
  "43": "27",
  "44": "27",
  "45": "23", // MP
  "46": "23",
  "47": "23",
  "48": "23",
  "49": "22", // Chhattisgarh
  "50": "36", // Telangana
  "51": "37",
  "52": "37",
  "53": "37",
  "56": "29", // Karnataka
  "57": "29",
  "58": "29",
  "59": "29",
  "60": "33", // Tamil Nadu
  "61": "33",
  "62": "33",
  "63": "33",
  "64": "33",
  "67": "32", // Kerala
  "68": "32",
  "69": "32",
  "70": "19", // WB
  "71": "19",
  "72": "19",
  "73": "19",
  "74": "19",
  "75": "10", // Bihar / Odisha zone
  "76": "21", // Odisha
  "77": "21",
  "78": "18", // Assam / NE
  "79": "18",
  "80": "10", // Bihar
  "81": "10",
  "82": "10",
  "83": "20", // Jharkhand
  "84": "10",
  "85": "37",
  // ── M2 3-digit PIN overrides (p3 was sliced but void — now live) ──
  "110": "07", // Delhi 110xxx
  "122": "06", // Haryana Gurgaon 122xxx
  "500": "36", // Telangana Hyderabad 500xxx
  "560": "29", // Karnataka Bangalore 560xxx
  "400": "27", // Maharashtra Mumbai 400xxx
  "700": "19", // West Bengal Kolkata 700xxx
  "600": "33", // Tamil Nadu Chennai 600xxx
};

export function pinToStateCode(pin: string | number | null | undefined): string | null {
  if (pin == null) return null;
  const s = String(pin).trim();
  if (!/^[1-9][0-9]{5}$/.test(s)) return null;
  const p3 = s.slice(0, 3);
  const p2 = s.slice(0, 2);
  if (PIN_PREFIX_TO_STATE_CODE[p3]) return PIN_PREFIX_TO_STATE_CODE[p3];
  return PIN_PREFIX_TO_STATE_CODE[p2] ?? null;
}

export function pinToState(pin: string | number | null | undefined): string | null {
  const code = pinToStateCode(pin);
  if (!code) return null;
  return GSTIN_STATE_CODES[code] ?? null;
}

export { INDIAN_STATES };
