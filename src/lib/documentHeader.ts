/**
 * documentHeader.ts — SINGLE SOURCE OF TRUTH for everything printed.
 *
 * Every printed document (invoice, DC, GRN, gatepass, job sheet, AMC
 * agreement, quotation, PO) resolves its letterhead through this module.
 * Read-only: only SELECTs on company_profile / branches / companies /
 * warehouses / ims_stock_items. No writes anywhere.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_COMPANY_PROFILE,
  fetchCompanyProfile,
  type CompanyProfile,
} from "@/lib/companyProfile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HeaderSourceKind = "regd_office" | "sales_office" | "factory" | "branch" | "warehouse";

export interface HeaderSource {
  kind: HeaderSourceKind;
  /** Required for branch / warehouse kinds. */
  id?: string | null;
}

export interface ResolvedBank {
  name: string | null;
  accountName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  branch: string | null;
  upiId: string | null;
}

export interface ResolvedHeader {
  source: HeaderSource;
  /** e.g. "Regd. Office" | "Faridabad Branch" | "NIT Warehouse" */
  label: string;
  /** Legal/trading name printed large on the letterhead. */
  orgName: string;
  addressLines: string[];
  gstin: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  stateName: string | null;
  stateCode: string | null;
  bank: ResolvedBank | null;
  invoiceFooter: string | null;
}

export interface HeaderSourceOption {
  kind: HeaderSourceKind;
  id?: string | null;
  label: string;
  group: "Company Offices" | "Branches" | "Warehouses";
  preview: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Split a messy multi-line/comma address into trimmed display lines. */
function splitAddress(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\s*(sales\s*office|regd\.?\s*office|registered\s*office|factory)\s*[:]\s*/i, "")
    .split(/[\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((line) =>
      line.includes(",") && line.length > 60
        ? line
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [line],
    );
}

const coalesce = (...vals: Array<string | null | undefined>): string | null =>
  vals.map((v) => (v && v.trim() ? v.trim() : null)).find(Boolean) ?? null;

function bankFromRow(row: {
  bank_name?: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_account?: string | null;
  bank_ifsc?: string | null;
  bank_branch?: string | null;
  upi_id?: string | null;
}): ResolvedBank | null {
  const out: ResolvedBank = {
    name: row.bank_name ?? null,
    accountName: row.bank_account_name ?? null,
    accountNumber: row.bank_account_number ?? row.bank_account ?? null,
    ifsc: row.bank_ifsc ?? null,
    branch: row.bank_branch ?? null,
    upiId: row.upi_id ?? null,
  };
  return Object.values(out).some(Boolean) ? out : null;
}

// ---------------------------------------------------------------------------
// Row fetchers (read-only)
// ---------------------------------------------------------------------------

interface BranchFullRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  pin_code: string | null;
  state_name: string | null;
  state_code: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
  upi_id: string | null;
  logo_url: string | null;
  invoice_footer: string | null;
  is_default: boolean | null;
  company: {
    name: string | null;
    gstin: string | null;
    phone: string | null;
    email: string | null;
  } | null;
}

async function getBranchFull(id: string): Promise<BranchFullRow | null> {
  const { data } = await supabase
    .from("branches")
    .select(
      `id,name,address,city,pin_code,state_name,state_code,gstin,phone,email,
       bank_name,bank_account_name,bank_account,bank_ifsc,bank_branch,upi_id,
       logo_url,invoice_footer,is_default,
       company:companies(name,gstin,phone,email)`,
    )
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as BranchFullRow) ?? null;
}

interface WarehouseAddrRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  address: string | null;
  contact_person: string | null;
  contact_number: string | null;
  email: string | null;
  branch_id: string | null;
}

async function getWarehouseFull(id: string): Promise<WarehouseAddrRow | null> {
  const { data } = await supabase
    .from("warehouses")
    .select("id,name,city,state,pincode,address,contact_person,contact_number,email,branch_id")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as WarehouseAddrRow) ?? null;
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

export async function resolveHeader(source: HeaderSource): Promise<ResolvedHeader> {
  const profile = await fetchCompanyProfile();

  // ---- Company office variants -------------------------------------------
  if (
    source.kind === "regd_office" ||
    source.kind === "sales_office" ||
    source.kind === "factory"
  ) {
    const addrRaw =
      source.kind === "sales_office"
        ? profile.sales_office_address
        : source.kind === "factory"
          ? profile.factory_address
          : profile.registered_office_address || profile.regd_address;
    const label =
      source.kind === "sales_office"
        ? "Sales Office"
        : source.kind === "factory"
          ? "Factory"
          : "Regd. Office";
    return {
      source,
      label,
      orgName: profile.name,
      addressLines: splitAddress(addrRaw),
      gstin: profile.gstin,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      logoUrl: profile.logo_url,
      accentColor: profile.accent_color,
      stateName: null,
      stateCode: null,
      bank: bankFromRow(profile),
      invoiceFooter: null,
    };
  }

  // ---- Warehouse ----------------------------------------------------------
  if (source.kind === "warehouse") {
    if (!source.id) throw new Error("Warehouse header source requires an id");
    const wh = await getWarehouseFull(source.id);
    if (!wh) throw new Error("Selected warehouse no longer exists");
    const branch = wh.branch_id ? await getBranchFull(wh.branch_id) : null;
    const lines = [
      ...(wh.address ? splitAddress(wh.address) : []),
      [wh.city, wh.state].filter(Boolean).join(", ") + (wh.pincode ? ` - ${wh.pincode}` : ""),
    ].filter((l) => l.trim().length > 0);
    return {
      source,
      label: wh.name,
      orgName: branch?.company?.name || profile.name,
      addressLines: lines,
      gstin: branch?.gstin || branch?.company?.gstin || profile.gstin,
      phone: coalesce(wh.contact_number, branch?.phone, profile.phone),
      email: coalesce(wh.email, branch?.email, profile.email),
      website: profile.website,
      logoUrl: branch?.logo_url || profile.logo_url,
      accentColor: profile.accent_color,
      stateName: wh.state ?? branch?.state_name ?? null,
      stateCode: branch?.state_code ?? null,
      bank: branch ? bankFromRow(branch) : bankFromRow(profile),
      invoiceFooter: branch?.invoice_footer ?? null,
    };
  }

  // ---- Branch -------------------------------------------------------------
  if (!source.id) throw new Error("Branch header source requires an id");
  const b = await getBranchFull(source.id);
  if (!b) throw new Error("Selected branch no longer exists");
  const lines = [
    ...(b.address ? splitAddress(b.address) : []),
    [b.city, b.state_name].filter(Boolean).join(", ") + (b.pin_code ? ` - ${b.pin_code}` : ""),
  ].filter((l) => l.trim().length > 0);
  return {
    source,
    label: b.name,
    orgName: b.company?.name || profile.name,
    addressLines: lines.length ? lines : splitAddress(profile.regd_address),
    gstin: b.gstin || b.company?.gstin || profile.gstin,
    phone: coalesce(b.phone, profile.phone),
    email: coalesce(b.email, profile.email),
    website: profile.website,
    logoUrl: b.logo_url || profile.logo_url,
    accentColor: profile.accent_color,
    stateName: b.state_name,
    stateCode: b.state_code,
    bank: bankFromRow(b),
    invoiceFooter: b.invoice_footer,
  };
}

/**
 * Map a resolved header onto the legacy CompanyProfile shape so existing
 * print templates (DocumentPrintView, GeneralDcPrintView, inline DOM
 * letterheads, jsPDF renderers) keep working unchanged.
 */
export function headerToCompanyProfile(h: ResolvedHeader): CompanyProfile {
  return {
    id: "",
    name: h.orgName,
    regd_address: h.addressLines.join(", "),
    factory_address: null,
    gstin: h.gstin,
    phone: h.phone,
    email: h.email,
    website: h.website,
    logo_url: h.logoUrl,
    sales_office_address: null,
    registered_office_address: null,
    accent_color: h.accentColor,
    bank_name: h.bank?.name ?? null,
    bank_account_name: h.bank?.accountName ?? null,
    bank_account_number: h.bank?.accountNumber ?? null,
    bank_ifsc: h.bank?.ifsc ?? null,
    bank_branch: h.bank?.branch ?? null,
  };
}

// ---------------------------------------------------------------------------
// Options list for the print dialog
// ---------------------------------------------------------------------------

export async function listHeaderSources(): Promise<{
  options: HeaderSourceOption[];
  defaultSource: HeaderSource;
}> {
  const p = await fetchCompanyProfile();
  const options: HeaderSourceOption[] = [];

  const pushOffice = (kind: HeaderSourceKind, label: string, raw: string | null) => {
    const lines = splitAddress(raw);
    if (kind !== "regd_office" && !lines.length) return; // optional offices must be filled first
    options.push({
      kind,
      id: null,
      label,
      group: "Company Offices",
      preview: lines.join(", ") || "(address not set)",
    });
  };
  pushOffice("regd_office", "Regd. Office", p.registered_office_address || p.regd_address);
  pushOffice("sales_office", "Sales Office", p.sales_office_address);
  pushOffice("factory", "Factory", p.factory_address);

  try {
    const { data: branches } = await supabase
      .from("branches")
      .select("id,name,address,city,state_name,pin_code,active,is_default")
      .order("name");
    for (const b of (branches as Array<Record<string, unknown>> | null) ?? []) {
      if (b.active === false) continue;
      const preview =
        [b.address, b.city, b.state_name].filter(Boolean).join(", ") +
        (b.pin_code ? ` - ${b.pin_code}` : "");
      options.push({
        kind: "branch",
        id: String(b.id),
        label: String(b.name) + ((b.is_default as boolean) ? " (default)" : ""),
        group: "Branches",
        preview: preview || "(address not set)",
      });
    }
  } catch {
    /* branches optional */
  }

  try {
    const { data: whs } = await supabase
      .from("warehouses")
      .select("id,name,city,state,status")
      .eq("status", "Active")
      .order("name");
    for (const w of (whs as Array<Record<string, unknown>> | null) ?? []) {
      options.push({
        kind: "warehouse",
        id: String(w.id),
        label: String(w.name),
        group: "Warehouses",
        preview: [w.city, w.state].filter(Boolean).join(", ") || "(no city set)",
      });
    }
  } catch {
    /* warehouses optional */
  }

  const def = options.find((o) => o.kind === "regd_office") ??
    options[0] ?? {
      kind: "regd_office" as const,
      id: null,
      label: "",
      group: "Company Offices" as const,
      preview: "",
    };

  return { options, defaultSource: { kind: def.kind, id: def.id } };
}

// ---------------------------------------------------------------------------
// Last-used-per-document-type memory (localStorage only — no DB)
// ---------------------------------------------------------------------------

const LAST_KEY = (docType: string) => `print_header_source:${docType}`;

export function getLastUsedSource(docType: string): HeaderSource | null {
  try {
    const raw = localStorage.getItem(LAST_KEY(docType));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HeaderSource;
    if (!parsed?.kind) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setLastUsedSource(docType: string, source: HeaderSource) {
  try {
    localStorage.setItem(
      LAST_KEY(docType),
      JSON.stringify({ kind: source.kind, id: source.id ?? null }),
    );
  } catch {
    /* private mode etc. */
  }
}

// ---------------------------------------------------------------------------
// Shared message signature (WhatsApp / email templates)
// ---------------------------------------------------------------------------

export async function companySignature(opts?: { tagline?: string }): Promise<string> {
  const p = await fetchCompanyProfile();
  const parts: string[] = [];
  if (opts?.tagline) parts.push(opts.tagline);
  parts.push(p.name);
  const contact = [p.phone ? `Phone: ${p.phone}` : null, p.email ? `Email: ${p.email}` : null]
    .filter(Boolean)
    .join(" | ");
  if (contact) parts.push(contact);
  const addr = splitAddress(p.registered_office_address || p.regd_address).join(", ");
  if (addr) parts.push(addr);
  return parts.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Dispatched-from derivation for serial-based documents (READ-ONLY)
// ---------------------------------------------------------------------------

export interface SerialOrigin {
  serial: string;
  warehouseId: string | null;
  warehouseName: string;
  city: string | null;
  state: string | null;
}

/**
 * Given the serial numbers printed on a document, look up where each one
 * currently sits. Pure reads — never mutates stock.
 */
export async function lookupSerialOrigins(serials: string[]): Promise<{
  bySerial: Map<string, SerialOrigin>;
  /** Unique, order-preserved "NIT Warehouse, Faridabad" strings. */
  uniqueLabels: string[];
}> {
  const cleaned = Array.from(new Set(serials.map((s) => s.trim()).filter(Boolean)));
  const bySerial = new Map<string, SerialOrigin>();
  if (!cleaned.length) return { bySerial, uniqueLabels: [] };

  try {
    const { data: stock } = await supabase
      .from("ims_stock_items")
      .select("part_serial_no,warehouse_id")
      .in("part_serial_no", cleaned);
    const rows =
      (stock as Array<{ part_serial_no: string | null; warehouse_id: string | null }> | null) ?? [];
    const whIds = Array.from(new Set(rows.map((r) => r.warehouse_id).filter(Boolean))) as string[];

    let whMap = new Map<string, { name: string; city: string | null; state: string | null }>();
    if (whIds.length) {
      const { data: whs } = await supabase
        .from("warehouses")
        .select("id,name,city,state")
        .in("id", whIds);
      whMap = new Map(
        (
          (whs as Array<{ id: string; name: string; city: string | null; state: string | null }>) ??
          []
        ).map((w) => [w.id, { name: w.name, city: w.city, state: w.state }]),
      );
    }

    for (const r of rows) {
      if (!r.part_serial_no) continue;
      const w = r.warehouse_id ? whMap.get(r.warehouse_id) : undefined;
      bySerial.set(r.part_serial_no, {
        serial: r.part_serial_no,
        warehouseId: r.warehouse_id ?? null,
        warehouseName: w?.name ?? "",
        city: w?.city ?? null,
        state: w?.state ?? null,
      });
    }
  } catch {
    // Lookup is best-effort decoration — never block printing.
  }

  const uniqueLabels: string[] = [];
  for (const o of bySerial.values()) {
    if (!o.warehouseName) continue;
    const label = [o.warehouseName, o.city].filter(Boolean).join(", ");
    if (!uniqueLabels.includes(label)) uniqueLabels.push(label);
  }
  return { bySerial, uniqueLabels };
}

/** id → "Name, City" map for warehouse ids (read-only). */
export async function lookupWarehouseNames(
  ids: Array<string | null | undefined>,
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => !!v)));
  if (!unique.length) return {};
  try {
    const { data } = await supabase.from("warehouses").select("id,name,city").in("id", unique);
    const out: Record<string, string> = {};
    for (const w of (data as Array<{ id: string; name: string; city: string | null }> | null) ??
      []) {
      out[w.id] = [w.name, w.city].filter(Boolean).join(", ");
    }
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Profile health (fail-loud instead of silently printing placeholder data)
// ---------------------------------------------------------------------------

/** Structural subset accepted by the health checks — any partial company object works. */
export type ProfileHealthInput =
  | {
      name?: string | null;
      gstin?: string | null;
      phone?: string | null;
      email?: string | null;
      regd_address?: string | null;
      registered_office_address?: string | null;
    }
  | null
  | undefined;

/** True when the loaded profile is missing critical identity data. */
export function isProfileIncomplete(p: ProfileHealthInput): boolean {
  if (!p) return true;
  const looksLikeDefault =
    p.name === DEFAULT_COMPANY_PROFILE.name &&
    (p.gstin ?? "") === (DEFAULT_COMPANY_PROFILE.gstin ?? "");
  const missingCritical =
    !p.name?.trim() || !p.gstin?.trim() || !(p.registered_office_address || p.regd_address)?.trim();
  return looksLikeDefault || missingCritical;
}

/** Human-readable list of what is missing. */
export function profileIssues(p: ProfileHealthInput): string[] {
  if (!p) return ["Company Master record not found"];
  const issues: string[] = [];
  if (!p.name?.trim()) issues.push("Company name");
  if (!p.gstin?.trim()) issues.push("GSTIN");
  if (!(p.registered_office_address || p.regd_address)?.trim())
    issues.push("Registered office address");
  if (!p.phone?.trim()) issues.push("Phone");
  if (!p.email?.trim()) issues.push("Email");
  return issues;
}

// ---------------------------------------------------------------------------
// Header derivation from serials / warehouse ids (smart print path)
// ---------------------------------------------------------------------------

export async function deriveHeaderFromSerials(serials: string[]): Promise<HeaderSource | null> {
  const { bySerial } = await lookupSerialOrigins(serials);
  if (bySerial.size === 0) return null;
  let warehouseId: string | null = null;
  for (const origin of bySerial.values()) {
    if (!origin.warehouseId) return null;
    if (warehouseId && origin.warehouseId !== warehouseId) return null;
    warehouseId = origin.warehouseId;
  }
  if (!warehouseId) return null;
  return { kind: "warehouse", id: warehouseId };
}

export function deriveHeaderFromWarehouseIds(
  ids: Array<string | null | undefined>,
): HeaderSource | null {
  const valid = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (valid.length !== 1) return null;
  return { kind: "warehouse", id: valid[0] };
}
