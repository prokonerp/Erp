/**
 * scripts/fsr-real-pdf.tsx — DEV UTILITY (kept in the repo per user decision).
 *
 * Renders a REAL ticket's FSR to a static HTML file that Chrome headless can
 * print to PDF. Read-only: Supabase REST GETs + one storage sign POST, no DB
 * writes. Service-role key from .env bypasses RLS — no login, no auth flow.
 * Must not affect app code, tests, or build.
 *
 * Run: `bun run scripts/fsr-real-pdf.tsx [ticketId]`
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { FsrPrintView } from "@/components/fsr/FsrPrintView";
import {
  buildFsrPrintModel,
  type FsrPrintCustomer,
  type FsrPrintFsr,
  type FsrPrintInput,
  type FsrPrintTicket,
  type FsrPrintVisits,
} from "@/lib/fsrPrint";
import type { CompanyProfile } from "@/lib/companyProfile";
import { getOemLogo } from "@/lib/oemLogos";

// DEMO AND LTD ticket PHS1209261823436.
const DEFAULT_TICKET_ID = "525ef012-419b-4078-b23c-b60355cde9e9";
const ticketId: string = process.argv[2] ?? DEFAULT_TICKET_ID;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL in .env");
if (!SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env");

const BASE = SUPABASE_URL;
const KEY = SERVICE_KEY;

/** Read-only REST GET → parsed JSON. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(path: string): Promise<any> {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const FSR_SELECT =
  "id,ticket_id,submitted_at,created_at,mains_voltage_ln,mains_voltage_ne,battery_bank_make,battery_bank_ah,battery_bank_qty,charging_readings,discharging_readings,rating,ac_provided,dg_provided,environment_duty,ups_location,pc_details,printer_details,scanner_details,power_failures_count,power_failures_duration_min,load_on_dg_percent,dg_set,dg_set_capacity_kva,amf_panel,operate_non_business_hours,operate_holidays,part_replacements,engineer_name,engineer_phone,customer_signature_path";

const TICKET_SELECT =
  "id,case_id,call_type,product,serial_no,customer_name,customer_address,customer_email,customer_phone,complaint,status,remarks,assigned_engineer_name,assigned_engineer_phone,assigned_at,preferred_visit_datetime,closed_at,created_at,oem_call,oem_brand,customer_id";

const CUSTOMER_SELECT =
  "id,company,contact_name,phone,email,billing_address,address,street,city,state,country,gst";

// Newest FSR for the ticket.
const fsrRows = await getJson(
  `field_service_reports?select=${FSR_SELECT}&ticket_id=eq.${ticketId}&order=submitted_at.desc&limit=1`,
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const fsr = fsrRows?.[0] as FsrPrintFsr | undefined;
if (!fsr) {
  console.error(`No submitted FSR for ticket ${ticketId}`);
  process.exit(1);
}

const ticketRows = await getJson(`tickets?select=${TICKET_SELECT}&id=eq.${ticketId}`);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const ticket = ticketRows?.[0] as (FsrPrintTicket & { customer_id?: string | null }) | undefined;
if (!ticket) {
  console.error(`Ticket not found: ${ticketId}`);
  process.exit(1);
}

let customer: FsrPrintCustomer | null = null;
if (ticket.customer_id) {
  const customerRows = await getJson(
    `customers?select=${CUSTOMER_SELECT}&id=eq.${ticket.customer_id}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  customer = (customerRows?.[0] as FsrPrintCustomer | undefined) ?? null;
}

const visitRows = await getJson(
  `ticket_visits?select=arrival_at,departure_at&ticket_id=eq.${ticketId}`,
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const visits = (visitRows?.[0] as FsrPrintVisits | undefined) ?? null;

// First active company_profile row (mirrors fetchCompanyProfile).
const companyRows = await getJson(
  `company_profile?select=*&is_active=eq.true&order=created_at.asc&limit=1`,
);
if (!companyRows?.[0]) throw new Error("No active company_profile row");
const company = companyRows[0] as CompanyProfile;

// Customer signature → data URL. Null (with warning) on ANY error.
let sigDataUrl: string | null = null;
const sigPath = (fsr as { customer_signature_path?: string | null }).customer_signature_path;
if (sigPath) {
  try {
    const fileRes = await fetch(
      `${BASE}/storage/v1/object/ticket-attachments/${encodeURIComponent(sigPath)}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
    );
    if (!fileRes.ok) throw new Error(`signature fetch failed: ${fileRes.status}`);
    const mime = fileRes.headers.get("content-type") ?? "image/png";
    sigDataUrl = `data:${mime};base64,${Buffer.from(await fileRes.arrayBuffer()).toString("base64")}`;
  } catch (e) {
    console.warn("Customer signature unavailable — rendering without it:", e);
    sigDataUrl = null;
  }
}

const input: FsrPrintInput = { fsr, ticket, customer, visits };
const model = buildFsrPrintModel(input);

const oem = getOemLogo(ticket.oem_brand ?? ticket.product) ?? {
  url: "/oem-apc.png",
  alt: "APC",
};

let html = renderToStaticMarkup(
  <FsrPrintView model={model} company={company as CompanyProfile} oem={oem} signatureDataUrl={sigDataUrl} />,
);

// Inline public assets as data URLs so the static file renders offline.
function assetDataUrl(fileName: string): string | null {
  try {
    const buf = fs.readFileSync(path.resolve("public", fileName));
    const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
    const mime =
      ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : ext === "gif" ? "image/gif" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}
for (const url of [
  "/oem-apc.png",
  "/prokon-logo.jpeg",
  "/oem-schneider.png",
  "/oem-eaton.svg",
  "/oem-exide.svg",
  "/oem-luminous.svg",
  "/oem-quanta.svg",
]) {
  const needle = `src="${url}"`;
  if (html.includes(needle)) {
    const du = assetDataUrl(url.slice(1));
    if (du) html = html.split(needle).join(`src="${du}"`);
  }
}

const outPath = "/tmp/fsr-real.html";
fs.writeFileSync(
  outPath,
  `<!doctype html><html><head><meta charset="utf-8"><title>FSR ${model.header.caseId}</title></head><body>${html}</body></html>`,
);

const cells = (grid: string[][]): number => grid.reduce((n, r) => n + r.length, 0);
console.log(`case id: ${model.header.caseId}`);
console.log(`report no: ${model.header.reportNo}`);
console.log(`date: ${model.header.submittedAt}`);
console.log(`parts: ${model.parts.length}`);
console.log(
  `battery cells: charging ${cells(model.battery.chargingGrid)}, discharging ${cells(model.battery.dischargingGrid)}`,
);
console.log(`signature: ${sigDataUrl ? "yes" : "no"}`);
console.log(`html: ${outPath}`);
process.exit(0);
