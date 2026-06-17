import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { parseCSV, buildCSV, downloadCSV } from "@/lib/csv";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { useIsAdmin } from "@/lib/useRole";
import { FormPageHeader } from "@/components/FormPageHeader";

export const Route = createFileRoute("/_app/import")({
  component: ImportPage,
  head: () => ({ meta: [{ title: "Bulk Import — Prokon" }] }),
});

/* ---------- Schema-driven import: templates mirror the New form for each module ---------- */

type FieldType =
  | "text" | "title" | "upper" | "address" | "email" | "phone" | "gst" | "pan"
  | "number" | "integer" | "date" | "boolean" | "enum";

type FieldDef = {
  key: string;            // CSV header AND db column (unless mapped)
  label: string;          // friendly label for errors/preview
  type: FieldType;
  required?: boolean;
  example?: string;
  options?: string[];     // for enum
  /** Optional override of the db column. Defaults to `key`. */
  column?: string;
  /** If true, this field is not inserted directly (handled specially). */
  virtual?: boolean;
};

type ModuleKey =
  | "customers" | "vendors" | "products" | "employees"
  | "branches" | "warehouses" | "oem_brand_master" | "product_categories"
  | "call_type_master" | "amcs" | "tickets" | "pm_visits";

type ModuleDef = {
  label: string;
  table: string;
  fields: FieldDef[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9][A-Z][0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MODULES: Record<ModuleKey, ModuleDef> = {
  customers: {
    label: "Customers",
    table: "customers",
    fields: [
      { key: "customer_type", label: "Customer Type", type: "enum", options: ["Business", "Individual"], required: true, example: "Business" },
      { key: "salutation", label: "Salutation", type: "text", example: "Mr." },
      { key: "first_name", label: "First Name", type: "title", required: true, example: "Ramesh" },
      { key: "last_name", label: "Last Name", type: "title", example: "Kumar" },
      { key: "company", label: "Company Name", type: "title", example: "Acme Pvt Ltd" },
      { key: "phone", label: "Mobile Number", type: "phone", required: true, example: "9876543210" },
      { key: "email", label: "Email", type: "email", required: true, example: "ramesh@acme.in" },
      { key: "gst_status", label: "GST Treatment", type: "enum", options: ["Regular", "Unregistered", "Composition", "Overseas", "SEZ"], example: "Regular" },
      { key: "gst", label: "GST Number", type: "gst", example: "06ABCDE1234F1Z5" },
      { key: "pan", label: "PAN", type: "pan", example: "ABCDE1234F" },
      { key: "place_of_supply", label: "Place of Supply", type: "text", example: "Haryana" },
      { key: "sector", label: "Sector", type: "title", example: "IT Services" },
      { key: "billing_line1", label: "Billing Address Line 1", type: "address", example: "12, Sector 18" },
      { key: "billing_line2", label: "Billing Address Line 2", type: "address" },
      { key: "billing_landmark", label: "Billing Landmark", type: "title" },
      { key: "billing_city", label: "Billing City", type: "title", example: "Gurgaon" },
      { key: "billing_state", label: "Billing State", type: "text", example: "Haryana" },
      { key: "billing_country", label: "Billing Country", type: "text", example: "India" },
      { key: "billing_pincode", label: "Billing Pincode", type: "text", example: "122015" },
      { key: "shipping_line1", label: "Shipping Address Line 1", type: "address" },
      { key: "shipping_line2", label: "Shipping Address Line 2", type: "address" },
      { key: "shipping_landmark", label: "Shipping Landmark", type: "title" },
      { key: "shipping_city", label: "Shipping City", type: "title" },
      { key: "shipping_state", label: "Shipping State", type: "text" },
      { key: "shipping_country", label: "Shipping Country", type: "text" },
      { key: "shipping_pincode", label: "Shipping Pincode", type: "text" },
      { key: "remarks", label: "Remarks", type: "text" },
    ],
  },
  vendors: {
    label: "Vendors",
    table: "vendors",
    fields: [
      { key: "name", label: "Vendor Name", type: "title", required: true, example: "Bharat Suppliers" },
      { key: "contact_name", label: "Contact Person", type: "title", example: "Anil Mehta" },
      { key: "phone", label: "Phone", type: "phone", example: "9811000000" },
      { key: "email", label: "Email", type: "email", example: "anil@bharat.in" },
      { key: "gstin", label: "GSTIN", type: "gst", example: "06ABCDE1234F1Z5" },
      { key: "payment_terms", label: "Payment Terms", type: "text", example: "Net 30" },
      { key: "address", label: "Address", type: "address", example: "Plot 14, Phase II" },
      { key: "notes", label: "Notes", type: "text" },
    ],
  },
  products: {
    label: "Products",
    table: "products",
    fields: [
      { key: "category", label: "Category", type: "title", required: true, example: "UPS" },
      { key: "brand", label: "Brand / OEM", type: "upper", required: true, example: "APC" },
      { key: "model", label: "Model Number", type: "upper", required: true, example: "SMT1000I" },
      { key: "name", label: "Product Name", type: "title", example: "APC Smart-UPS 1000VA" },
      { key: "unit", label: "Unit", type: "text", example: "Nos" },
      { key: "hsn", label: "HSN", type: "upper", example: "8504" },
      { key: "central_tax_rate", label: "Central Tax Rate (%)", type: "number", required: true, example: "9" },
      { key: "local_tax_rate", label: "Local Tax Rate (%)", type: "number", required: true, example: "9" },
      { key: "default_price", label: "Default Price", type: "number", example: "12000" },
      { key: "description", label: "Description", type: "text" },
      { key: "serial_tracking", label: "Serial Tracking", type: "boolean", example: "true" },
      { key: "warranty_applicable", label: "Warranty Applicable", type: "boolean", example: "true" },
      { key: "warranty_type", label: "Warranty Type", type: "enum", options: ["Manufacturer", "Extended", "Service"], example: "Manufacturer" },
      { key: "warranty_duration", label: "Warranty Duration", type: "integer", example: "12" },
      { key: "warranty_unit", label: "Warranty Unit", type: "enum", options: ["Months", "Years"], example: "Months" },
      { key: "active", label: "Active", type: "boolean", example: "true" },
      { key: "parent_product_models", label: "Parent Product Models (Spare Parts only, comma-separated)", type: "text", virtual: true, example: "SRV3KI,SRV6KI,SRV10KI" },
    ],
  },
  employees: {
    label: "Employees",
    table: "employees",
    fields: [
      { key: "name", label: "Name", type: "title", required: true, example: "Suresh Verma" },
      { key: "role", label: "Role / Designation", type: "title", example: "Service Engineer" },
      { key: "department", label: "Department", type: "title", example: "Operations" },
      { key: "phone", label: "Phone", type: "phone", example: "9811112222" },
      { key: "email", label: "Email", type: "email", example: "suresh@phs.in" },
      { key: "joining_date", label: "Joining Date", type: "date", example: "2024-04-01" },
      { key: "active", label: "Active", type: "boolean", example: "true" },
      { key: "notes", label: "Notes", type: "text" },
    ],
  },
  branches: {
    label: "Branches",
    table: "branches",
    fields: [
      { key: "name", label: "Branch Name", type: "title", required: true, example: "Gurgaon HO" },
      { key: "gstin", label: "GSTIN", type: "gst" },
      { key: "phone", label: "Phone", type: "phone" },
      { key: "address", label: "Address", type: "address" },
    ],
  },
  warehouses: {
    label: "Warehouses",
    table: "warehouses",
    fields: [
      { key: "code", label: "Warehouse Code", type: "upper", required: true, example: "WH-01" },
      { key: "name", label: "Warehouse Name", type: "title", required: true, example: "Gurgaon Godown" },
      { key: "type", label: "Type", type: "enum", options: ["Godown", "Store", "Service Center", "Transit"], example: "Godown" },
      { key: "status", label: "Status", type: "enum", options: ["Active", "Inactive"], example: "Active" },
      { key: "contact_person", label: "Contact Person", type: "title" },
      { key: "contact_number", label: "Contact Number", type: "phone" },
      { key: "email", label: "Email", type: "email" },
      { key: "city", label: "City", type: "title" },
      { key: "state", label: "State", type: "text" },
      { key: "pincode", label: "Pincode", type: "text" },
      { key: "address", label: "Address", type: "address" },
      { key: "remarks", label: "Remarks", type: "text" },
    ],
  },
  oem_brand_master: {
    label: "OEM / Brand Master",
    table: "oem_brand_master",
    fields: [
      { key: "name", label: "OEM / Brand Name", type: "upper", required: true, example: "APC" },
    ],
  },
  product_categories: {
    label: "Product Categories",
    table: "product_categories",
    fields: [
      { key: "name", label: "Category Name", type: "title", required: true, example: "UPS" },
    ],
  },
  call_type_master: {
    label: "Call Type Master",
    table: "call_type_master",
    fields: [
      { key: "name", label: "Call Type", type: "upper", required: true, example: "OOW" },
    ],
  },
  amcs: {
    label: "AMCs",
    table: "amcs",
    fields: [
      { key: "agreement_no", label: "Agreement Number (leave blank to auto-generate)", type: "text", example: "" },
      { key: "client_name", label: "Client Name", type: "title", required: true, example: "Ramesh Kumar" },
      { key: "client_company", label: "Company", type: "title", required: true, example: "Acme Pvt Ltd" },
      { key: "client_address", label: "Client Address", type: "address", example: "12, Sec 18, Gurgaon" },
      { key: "client_gst", label: "Client GST", type: "gst", example: "06ABCDE1234F1Z5" },
      { key: "contact_no", label: "Contact No.", type: "phone", example: "9876543210" },
      { key: "email", label: "Email", type: "email", example: "ramesh@acme.in" },
      { key: "start_date", label: "Start Date (YYYY-MM-DD)", type: "date", required: true, example: "2026-01-01" },
      { key: "duration_years", label: "Duration (Years)", type: "integer", required: true, example: "1" },
      { key: "amc_value", label: "AMC Value", type: "number", example: "12000" },
      { key: "category", label: "Product Category", type: "title", virtual: true, example: "UPS" },
      { key: "model", label: "Model", type: "upper", virtual: true, example: "SMT1000I" },
      { key: "serial_no", label: "Serial Number", type: "upper", virtual: true, example: "APC2024XYZ" },
      { key: "oem_call", label: "Registered with OEM", type: "boolean", example: "false" },
      { key: "oem_brand", label: "OEM Brand", type: "upper", example: "" },
      { key: "oem_ref_id", label: "OEM Agreement No.", type: "text", example: "" },
      { key: "oem_purchase_date", label: "OEM Purchase Date", type: "date" },
      { key: "terms", label: "Terms", type: "text" },
      { key: "remarks", label: "Remarks", type: "text" },
    ],
  },
  tickets: {
    label: "Tickets",
    table: "tickets",
    fields: [
      { key: "case_id", label: "Case ID (leave blank to auto-generate)", type: "text", example: "" },
      { key: "call_type", label: "Call Type", type: "upper", required: true, example: "OOW" },
      { key: "customer_name", label: "Customer Name", type: "title", required: true, example: "Ramesh Kumar" },
      { key: "customer_phone", label: "Customer Phone", type: "phone", example: "9876543210" },
      { key: "customer_email", label: "Customer Email", type: "email", example: "ramesh@acme.in" },
      { key: "location", label: "Location", type: "title", example: "Gurgaon" },
      { key: "customer_address", label: "Customer Address", type: "address", example: "12, Sec 18" },
      { key: "product", label: "Product", type: "title", example: "APC 1000VA" },
      { key: "serial_no", label: "Serial Number", type: "upper", example: "APC2024XYZ" },
      { key: "complaint", label: "Complaint", type: "text", required: true, example: "Not powering on" },
      { key: "status", label: "Status", type: "enum", options: ["New", "Assigned", "In Progress", "On Hold", "Resolved", "Closed"], example: "New" },
    ],
  },
  pm_visits: {
    label: "PM Schedule",
    table: "pm_visits",
    fields: [
      { key: "amc_agreement_no", label: "AMC Agreement Number", type: "text", required: true, virtual: true, example: "PHS/AMC/13062614300001" },
      { key: "scheduled_date", label: "Scheduled Date", type: "date", required: true, example: "2026-07-15" },
      { key: "notes", label: "Notes", type: "text", example: "Quarterly PM" },
    ],
  },
};

/* ---------- transforms + validation ---------- */

function transformValue(type: FieldType, raw: string): unknown {
  const v = (raw || "").trim();
  if (v === "") return null;
  switch (type) {
    case "title": return toTitleCaseSmart(v);
    case "address": return titleCaseAddress(v);
    case "upper":
    case "gst":
    case "pan": return upperTrim(v);
    case "email": return v.toLowerCase();
    case "phone": return v.replace(/\D/g, "");
    case "number": { const n = Number(v); return Number.isFinite(n) ? n : null; }
    case "integer": { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
    case "date": return v;
    case "boolean": return !/^(false|0|no|n)$/i.test(v);
    case "enum": return v;
    case "text": default: return v;
  }
}

function validateField(field: FieldDef, raw: string): string | null {
  const v = (raw || "").trim();
  if (!v) { return field.required ? `${field.label} is required` : null; }
  switch (field.type) {
    case "email": if (!EMAIL_RE.test(v)) return `${field.label}: invalid email`; break;
    case "phone": if (!PHONE_RE.test(v.replace(/\D/g, ""))) return `${field.label}: must be 10 digits`; break;
    case "gst": if (!GST_RE.test(v.toUpperCase())) return `${field.label}: invalid GSTIN`; break;
    case "pan": if (!PAN_RE.test(v.toUpperCase())) return `${field.label}: invalid PAN`; break;
    case "date": if (!DATE_RE.test(v)) return `${field.label}: use YYYY-MM-DD`; break;
    case "number":
    case "integer": if (!Number.isFinite(Number(v))) return `${field.label}: must be a number`; break;
    case "enum":
      if (field.options && !field.options.some((o) => o.toLowerCase() === v.toLowerCase()))
        return `${field.label}: must be one of ${field.options.join(" / ")}`;
      break;
  }
  return null;
}

function buildPayload(fields: FieldDef[], row: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.virtual) continue;
    const col = f.column ?? f.key;
    out[col] = transformValue(f.type, row[f.key] ?? "");
  }
  return out;
}

function validateRow(fields: FieldDef[], row: Record<string, string>): string | null {
  for (const f of fields) {
    const err = validateField(f, row[f.key] ?? "");
    if (err) return err;
  }
  return null;
}

function ImportPage() {
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const [mod, setMod] = useState<ModuleKey>("customers");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: { row: number; reason: string }[] } | null>(null);

  const def = MODULES[mod];
  const headers = useMemo(() => def.fields.map((f) => f.key), [def]);
  const sample = useMemo(() => {
    const o: Record<string, string> = {};
    for (const f of def.fields) o[f.key] = f.example ?? "";
    return o;
  }, [def]);

  const previewIssues = useMemo(() => {
    if (rows.length === 0) return { valid: 0, invalid: 0, errors: [] as { row: number; reason: string }[] };
    const errors: { row: number; reason: string }[] = [];
    rows.forEach((r, i) => {
      const err = validateRow(def.fields, r);
      if (err) errors.push({ row: i + 2, reason: err });
    });
    return { valid: rows.length - errors.length, invalid: errors.length, errors };
  }, [rows, def]);

  if (roleLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!isAdmin) {
    return (
      <Card>
        <CardHeader><CardTitle>Restricted</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Bulk Import / Export is available to admins only.
        </CardContent>
      </Card>
    );
  }

  const onFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length === 0) { toast.error("CSV is empty or missing headers"); return; }
    setRows(parsed);
    setResult(null);
    toast.success(`Parsed ${parsed.length} row(s)`);
  };

  const downloadTemplate = () => {
    const csv = buildCSV(headers, [sample]);
    downloadCSV(`Prokon_${mod}_template.csv`, csv);
  };


  const downloadErrorReport = () => {
    const failedList = result ? result.failed : previewIssues.errors;
    if (failedList.length === 0) return;
    const rowsOut = failedList.map((f) => {
      const src = rows[f.row - 2] || {};
      return { row_number: f.row, error_reason: f.reason, ...src };
    });
    const cols = ["row_number", "error_reason", ...headers];
    downloadCSV(`Prokon_${mod}_import_errors.csv`, buildCSV(cols, rowsOut as never));
  };

  const importRows = async () => {
    if (rows.length === 0) return toast.error("Upload a CSV first");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const failed: { row: number; reason: string }[] = [];
    let ok = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        // Schema validation first — same rules as preview.
        const vErr = validateRow(def.fields, r);
        if (vErr) throw new Error(vErr);

        if (mod === "customers") {
          const payload = buildPayload(def.fields, r) as Record<string, unknown>;
          const first = (payload.first_name as string) || "";
          const last = (payload.last_name as string) || "";
          const isBiz = (r.customer_type || "").toLowerCase() === "business";
          const company = isBiz && payload.company
            ? payload.company as string
            : toTitleCaseSmart([r.salutation, first, last].filter(Boolean).join(" "));
          if (!company) throw new Error("Company / Name required");
          payload.company = company;
          payload.contact_name = toTitleCaseSmart([r.salutation, first, last].filter(Boolean).join(" "));
          payload.state = payload.billing_state ?? null;
          payload.city = payload.billing_city ?? null;
          const joinAddr = (p: string) => [
            payload[`${p}_line1`], payload[`${p}_line2`], payload[`${p}_landmark`],
            payload[`${p}_city`], payload[`${p}_state`], payload[`${p}_pincode`], payload[`${p}_country`],
          ].filter(Boolean).join(", ");
          payload.billing_address = joinAddr("billing") || null;
          payload.shipping_address = joinAddr("shipping") || payload.billing_address;
          payload.address = payload.billing_address;
          payload.created_by = uid;
          const { error } = await supabase.from("customers").insert(payload as never);
          if (error) throw new Error(error.message);
        } else if (mod === "products") {
          const payload = buildPayload(def.fields, r) as Record<string, unknown>;
          const derived = [payload.brand, payload.model].filter(Boolean).join(" ").trim()
            || (payload.name as string) || (payload.category as string) || "";
          payload.name = toTitleCaseSmart(derived);
          if (!payload.name) throw new Error("Product name (or Brand+Model) required");
          payload.unit = payload.unit || "Nos";
          const ct = Number(payload.central_tax_rate ?? 0);
          const lt = Number(payload.local_tax_rate ?? 0);
          payload.tax_rate = ct + lt;
          const isSpare = String(payload.category || "").toLowerCase() === "spare parts";
          const parentModelsRaw = (r["parent_product_models"] || "").trim();
          const parentModels = parentModelsRaw
            ? parentModelsRaw.split(",").map((s) => upperTrim(s)).filter(Boolean)
            : [];
          if (isSpare && parentModels.length === 0) {
            throw new Error("Spare Parts row requires parent_product_models (comma-separated models)");
          }
          const { data: inserted, error } = await supabase
            .from("products").insert(payload as never).select("id").single();
          if (error) throw new Error(error.message);
          if (isSpare && parentModels.length) {
            const spId = (inserted as { id: string } | null)?.id;
            const { data: parents } = await supabase
              .from("products").select("id, model, category, active")
              .in("model", parentModels);
            const parentRows = ((parents || []) as { id: string; model: string; category: string | null; active: boolean | null }[])
              .filter((p) => p.active !== false && (p.category || "") !== "Spare Parts");
            const missing = parentModels.filter((m) => !parentRows.some((p) => (p.model || "").toUpperCase() === m));
            if (missing.length) throw new Error(`Parent model(s) not found / inactive / are spare parts: ${missing.join(", ")}`);
            if (spId) {
              const links = parentRows.map((p) => ({ spare_part_id: spId, parent_product_id: p.id }));
              const { error: lErr } = await supabase.from("product_spare_parts" as never).insert(links as never);
              if (lErr) throw new Error(`Product saved but linking failed: ${lErr.message}`);
            }
          }
        } else if (mod === "amcs") {
          const years = Number(r.duration_years || 1);
          const start = r.start_date;
          const end = new Date(start);
          end.setFullYear(end.getFullYear() + years);
          end.setDate(end.getDate() - 1);
          const endStr = end.toISOString().slice(0, 10);
          const payload = buildPayload(def.fields, r) as Record<string, unknown>;
          if (!r.agreement_no) delete payload.agreement_no; // let trigger generate
          payload.start_date = start;
          payload.end_date = endStr;
          payload.duration_years = years;
          payload.units = (r.model || r.serial_no)
            ? [{
                category: r.category ? toTitleCaseSmart(r.category) : null,
                model: toTitleCaseSmart(r.model || ""),
                serial_no: upperTrim(r.serial_no || ""),
              }]
            : [];
          payload.pm_dates = [];
          payload.created_by = uid;
          const { error } = await supabase.from("amcs").insert(payload as never);
          if (error) throw new Error(error.message);
        } else if (mod === "tickets") {
          const payload = buildPayload(def.fields, r) as Record<string, unknown>;
          if (!r.case_id) delete payload.case_id;
          payload.created_by = uid;
          payload.status = payload.status || "New";
          payload.call_type = payload.call_type || "OOW";
          const { error } = await supabase.from("tickets").insert(payload as never);
          if (error) throw new Error(error.message);
        } else if (mod === "pm_visits") {
          const { data: amc, error: aErr } = await supabase.from("amcs").select("id").eq("agreement_no", r.amc_agreement_no).maybeSingle();
          if (aErr) throw new Error(aErr.message);
          if (!amc) throw new Error(`AMC not found: ${r.amc_agreement_no}`);
          const { error } = await supabase.from("pm_visits").insert({
            amc_id: (amc as { id: string }).id,
            scheduled_date: r.scheduled_date,
            notes: r.notes || null,
          } as never);
          if (error) throw new Error(error.message);
        } else {
          // Generic schema-driven insert (employees, vendors, branches, warehouses, OEM, categories, call types)
          const payload = buildPayload(def.fields, r);
          const { error } = await supabase.from(def.table as never).insert(payload as never);
          if (error) throw new Error(error.message);
        }
        ok++;
      } catch (e) {
        failed.push({ row: i + 2, reason: e instanceof Error ? e.message : "unknown" });
      }
    }
    setResult({ ok, failed });
    setBusy(false);
    if (failed.length === 0) toast.success(`Imported ${ok} record(s)`);
    else toast.warning(`Imported ${ok}, failed ${failed.length}`);
  };

  return (
    <div className="space-y-4">
      <FormPageHeader
        title="Bulk Import"
        subtitle="Import master and transactional records via CSV or Excel templates"
      />

      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose module & download template</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Module</Label>
            <Select value={mod} onValueChange={(v) => { setMod(v as ModuleKey); setRows([]); setResult(null); setFileName(""); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(MODULES) as ModuleKey[]).map((k) => (
                  <SelectItem key={k} value={k}>{MODULES[k].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" />Download CSV template
          </Button>
          <div className="text-xs text-muted-foreground basis-full">
            Fields ({def.fields.length}) — required marked with <span className="text-red-600">*</span>:
            <div className="mt-1 flex flex-wrap gap-1">
              {def.fields.map((f) => (
                <span key={f.key} className="font-mono bg-muted px-1.5 py-0.5 rounded">
                  {f.key}{f.required ? <span className="text-red-600">*</span> : null}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">2. Upload your CSV</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-3 border-2 border-dashed rounded-md p-6 cursor-pointer hover:bg-muted/40">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="font-medium">{fileName || "Click to choose a CSV file"}</div>
              <div className="text-xs text-muted-foreground">UTF-8, comma-separated. First row must be headers.</div>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </label>

          {rows.length > 0 && (
            <div className="text-sm space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <FileCheck2 className="inline h-4 w-4 text-green-700" />
                <span>Total: <b>{rows.length}</b></span>
                <span className="text-green-700">Valid: <b>{previewIssues.valid}</b></span>
                <span className="text-red-700">Invalid: <b>{previewIssues.invalid}</b></span>
                {previewIssues.invalid > 0 && (
                  <Button size="sm" variant="outline" onClick={downloadErrorReport}>
                    <Download className="h-4 w-4 mr-1" />Download validation errors
                  </Button>
                )}
              </div>
              {previewIssues.invalid > 0 && (
                <div className="max-h-40 overflow-y-auto border rounded-md p-2 bg-amber-50 text-amber-900 text-xs">
                  {previewIssues.errors.slice(0, 50).map((e, i) => (
                    <div key={i}>Row {e.row}: {e.reason}</div>
                  ))}
                  {previewIssues.errors.length > 50 && <div>… and {previewIssues.errors.length - 50} more</div>}
                </div>
              )}
              <div className="text-xs text-muted-foreground">Preview first 5 rows:</div>
              <div className="overflow-x-auto border rounded-md mt-2 max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>{Object.keys(rows[0]).map((h) => <th key={h} className="p-1 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        {Object.keys(rows[0]).map((h) => <td key={h} className="p-1">{r[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">3. Import</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={importRows} disabled={busy || rows.length === 0} size="lg">
            {busy ? "Importing…" : `Import ${rows.length || ""} record(s)`}
          </Button>
          {result && (
            <div className="text-sm">
              <div className="font-medium">Imported: {result.ok}, Failed: {result.failed.length}</div>
              {result.failed.length > 0 && (
                <>
                  <div className="mt-2 max-h-60 overflow-y-auto border rounded-md p-2 bg-red-50 text-red-900">
                    {result.failed.map((f, i) => (
                      <div key={i} className="text-xs">Row {f.row}: {f.reason}</div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="mt-2" onClick={downloadErrorReport}>
                    <Download className="h-4 w-4 mr-1" />Download error report (CSV)
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}