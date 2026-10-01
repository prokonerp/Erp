/**
 * src/lib/gsp.functions.ts — server-side entry points for GSP operations.
 *
 * This is the only place that talks to the GSP *and* the database, which is
 * deliberate: credentials never reach the browser, and the invoice payload is
 * rebuilt server-side from the database rather than accepted from the client.
 * Accepting a caller-supplied payload would let anyone mint an IRN for an
 * arbitrary document (BOLA).
 *
 * Every function:
 *   - requires an authenticated, active user (`requireActiveUser`)
 *   - requires the admin-managed `sales · edit` permission, because these
 *     actions create statutory documents
 *   - writes a redacted row to `gsp_api_log`
 *
 * Mock vs live is chosen by `GSP_MODE`; see docs/adr/0003-gsp-mock-first.md.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { assertModulePermission } from "@/lib/server-permissions";
import { reportDbError } from "@/lib/format-error";
import { buildGstInvoiceJson } from "@/lib/invoiceJson";
import type {
  BranchLite,
  CompanyProfileLite,
  CustomerLite,
  InvoiceItemLite,
  InvoiceLite,
} from "@/lib/invoiceJson";
import { toGspInvoiceRequest } from "@/lib/gspPayload";
import {
  GspError,
  GspTimeoutError,
  getGspConfig,
  createHttpTransport,
  type GspEnvelope,
  type GspMessage,
  type GspMode,
  type GspTransport,
} from "@/lib/gspClient";
import { createMockTransport } from "@/lib/gspMock";
import type { TransportDetails } from "@/lib/transport";
import {
  ewbInputSchema,
  normalizeGstinDetails,
  resolveEwbTransportFields,
  isWithinIrnCancelWindow,
} from "@/lib/gspEwb";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabaseAdmin Proxy is not narrowed to the generated row types for these tables
async function getAdmin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabaseAdmin Proxy is not narrowed to the generated row types for these tables
  return supabaseAdmin as any;
}

/** Pick the transport the environment asks for. */
function transportForMode(
  mode: "mock" | "sandbox" | "production",
  config: ReturnType<typeof getGspConfig>,
): GspTransport {
  return mode === "mock" ? createMockTransport() : createHttpTransport({ config });
}

function messageOf(envelope: GspEnvelope): GspMessage {
  const m = envelope?.results?.message;
  return typeof m === "object" && m !== null ? (m as GspMessage) : {};
}

/** Strip secrets and signed legal artefacts before a payload reaches the log. */
function redact(body: unknown): unknown {
  if (body === null || typeof body !== "object") return body;
  const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  for (const key of Object.keys(clone)) {
    if (/^(signedinvoice|signedqrcode|qrcodeurl|token|password)$/i.test(key)) {
      clone[key] = "[redacted]";
    }
  }
  return clone;
}

async function logCall(entry: {
  invoiceId?: string | null;
  operation: string;
  endpoint: string;
  httpStatus?: number | null;
  ok: boolean;
  code?: string | null;
  errorMessage?: string | null;
  requestId?: string | null;
  request?: unknown;
  response?: unknown;
  durationMs?: number;
  userId?: string | null;
}): Promise<void> {
  try {
    const admin = await getAdmin();
    await admin.from("gsp_api_log").insert({
      invoice_id: entry.invoiceId ?? null,
      operation: entry.operation,
      endpoint: entry.endpoint,
      http_status: entry.httpStatus ?? null,
      ok: entry.ok,
      gsp_code: entry.code ?? null,
      error_message: entry.errorMessage?.slice(0, 2000) ?? null,
      request_id: entry.requestId ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb column — supabase-js expects Json for these tables
      request_body: redact(entry.request) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb column — supabase-js expects Json for these tables
      response_body: redact(entry.response) as any,
      duration_ms: entry.durationMs ?? null,
      created_by: entry.userId ?? null,
    });
  } catch (e) {
    // Never let logging failure break the caller — but do not hide it either.
    console.error("[gsp] failed to write gsp_api_log", e);
  }
}

/** Load everything the NIC builder needs, straight from the database. */
async function loadInvoiceBundle(invoiceId: string) {
  const admin = await getAdmin();

  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) throw new Error(reportDbError("gsp.loadInvoice", invErr));
  if (!invoice) throw new Error("Invoice not found");

  const { data: items, error: itemErr } = await admin
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sr_no", { ascending: true });
  if (itemErr) throw new Error(reportDbError("gsp.loadItems", itemErr));
  if (!items || items.length === 0) throw new Error("Invoice has no items");

  let branch: BranchLite | null = null;
  if (invoice.branch_id) {
    const { data } = await admin
      .from("branches")
      .select("*")
      .eq("id", invoice.branch_id)
      .maybeSingle();
    if (data) {
      branch = {
        ...data,
        company_name: data.company_name ?? data.name ?? null,
        company_address: data.company_address ?? data.address ?? null,
      } as BranchLite;
    }
  }

  let customer: CustomerLite | null = null;
  if (invoice.customer_id) {
    const { data } = await admin
      .from("customers")
      .select("*")
      .eq("id", invoice.customer_id)
      .maybeSingle();
    if (data) customer = data as CustomerLite;
  }

  let companyProfile: CompanyProfileLite | null = null;
  const { data: company } = await admin.from("company_profile").select("*").limit(1).maybeSingle();
  if (company) {
    companyProfile = {
      name: company.name ?? null,
      regd_address: company.regd_address ?? null,
      address: company.address ?? company.regd_address ?? null,
      gstin: company.gstin ?? null,
    } as CompanyProfileLite;
    if (branch) {
      branch.company_name = company.name ?? branch.company_name ?? null;
      branch.company_address = company.regd_address ?? branch.company_address ?? null;
    }
  }

  return {
    invoice: invoice as InvoiceLite,
    items: items as InvoiceItemLite[],
    branch,
    customer,
    companyProfile,
    transport: (invoice.transport_details ?? null) as TransportDetails | null,
    raw: invoice,
  };
}

const zInvoiceId = z.object({ invoiceId: z.string().uuid() });

// ── 1. Generate IRN ─────────────────────────────────────────────────────────

export const generateGspIrn = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => zInvoiceId.parse(input))
  .handler(async ({ data, context }) => {
    await assertModulePermission(context.userId, "sales", "edit");

    const admin = await getAdmin();
    const config = getGspConfig();
    const transport = transportForMode(config.mode, config);
    const started = Date.now();

    const bundle = await loadInvoiceBundle(data.invoiceId);
    if (bundle.raw.irn) {
      return { ok: true as const, alreadyGenerated: true as const, irn: bundle.raw.irn as string };
    }
    if (bundle.raw.sales_type === "sez_zero_rated" && !String(bundle.raw.lut_no ?? "").trim()) {
      throw new Error("SEZ Zero Rated requires a LUT No. before an IRN can be generated");
    }

    const nic = buildGstInvoiceJson(
      bundle.invoice,
      bundle.items,
      bundle.branch,
      bundle.customer,
      bundle.transport,
      bundle.transport?.dispatch_details ?? null,
      bundle.companyProfile,
    );
    const request = toGspInvoiceRequest(nic, {
      userGstin: bundle.branch?.gstin || bundle.invoice.seller_gstin || config.userGstin,
    });

    let envelope: GspEnvelope;
    try {
      envelope = await transport.generateIrn(request);
    } catch (e) {
      // A timeout leaves the outcome unknown. Confirm with a by-document read
      // before deciding anything — a blind retry could mint a duplicate IRN.
      if (e instanceof GspTimeoutError) {
        const resolved = await resolveOutcome(
          transport,
          request,
          data.invoiceId,
          context.userId,
          started,
        );
        if (resolved) return resolved;
      }
      await recordFailure(bundle, "generate_irn", e, request, context.userId, started);
      throw toFriendlyError(e);
    }

    const message = messageOf(envelope);
    const irn = String(message.Irn ?? "");
    if (!/^[0-9a-f]{64}$/i.test(irn)) {
      const err = new Error("GSP returned no valid IRN");
      await recordFailure(bundle, "generate_irn", err, request, context.userId, started);
      throw err;
    }

    const now = new Date().toISOString();
    const { error: updErr } = await admin
      .from("invoices")
      .update({
        irn,
        ack_no: message.AckNo ?? null,
        ack_date: now,
        qr_payload: message.SignedQRCode ?? null,
        signed_qr: message.SignedQRCode ?? null,
        einvoice_status: "generated",
        einvoice_error: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb column — supabase-js expects Json for these tables
        compliance_json: nic as any,
        compliance_pasted_at: null,
        compliance_pasted_by: null,
      })
      .eq("id", data.invoiceId);
    if (updErr) {
      throw new Error(reportDbError("gsp.persistIrn", updErr));
    }

    await logCall({
      invoiceId: data.invoiceId,
      operation: "generate_irn",
      endpoint: "/api/v1/einvoice/",
      ok: true,
      request,
      response: envelope,
      durationMs: Date.now() - started,
      userId: context.userId,
    });

    return {
      ok: true as const,
      alreadyGenerated: false as const,
      irn,
      ackNo: message.AckNo ?? null,
    };
  });

/**
 * After an ambiguous failure, ask the GSP whether the document is already
 * registered. This is the safety rule that prevents duplicate IRNs.
 */
async function resolveOutcome(
  transport: GspTransport,
  request: {
    user_gstin: string;
    document_details: { document_number: string; document_date: string };
  },
  invoiceId: string,
  userId: string,
  started: number,
): Promise<{ ok: true; alreadyGenerated: true; irn: string } | null> {
  try {
    const found = await transport.getEinvoiceByDoc({
      user_gstin: request.user_gstin,
      document_number: request.document_details.document_number,
      document_date: request.document_details.document_date,
    });
    const irn = String(messageOf(found).Irn ?? "");
    if (!/^[0-9a-f]{64}$/i.test(irn)) return null;

    const admin = await getAdmin();
    await admin
      .from("invoices")
      .update({ irn, einvoice_status: "generated", einvoice_error: null })
      .eq("id", invoiceId);
    await logCall({
      invoiceId,
      operation: "generate_irn",
      endpoint: "get-einvoice-details-by-doc (recovery)",
      ok: true,
      response: found,
      durationMs: Date.now() - started,
      userId,
    });
    return { ok: true, alreadyGenerated: true, irn };
  } catch {
    return null;
  }
}

async function recordFailure(
  bundle: { raw: Record<string, unknown> },
  operation: string,
  e: unknown,
  request: unknown,
  userId: string,
  started: number,
): Promise<void> {
  const err = e instanceof Error ? e : new Error(String(e));
  const code = e instanceof GspError ? e.code : null;
  try {
    const admin = await getAdmin();
    // `failed` is a valid einvoice_status; keep the invoice out of
    // `generated` so the compliance view stays honest.
    await admin
      .from("invoices")
      .update({ einvoice_status: "failed", einvoice_error: err.message.slice(0, 2000) })
      .eq("id", bundle.raw.id as string);
  } catch (dbErr) {
    console.error("[gsp] failed to record invoice failure", dbErr);
  }
  await logCall({
    invoiceId: (bundle.raw.id as string) ?? null,
    operation,
    endpoint: "/api/v1/einvoice/",
    ok: false,
    code: code === null ? null : String(code),
    errorMessage: err.message,
    request,
    durationMs: Date.now() - started,
    userId,
  });
}

function toFriendlyError(e: unknown): Error {
  if (e instanceof GspTimeoutError) {
    return new Error(
      "The GSP did not respond in time. We could not confirm whether the IRN was created — " +
        "check the compliance status before retrying.",
    );
  }
  if (e instanceof GspError) {
    return new Error(e.code === null ? e.message : `[${e.code}] ${e.message}`);
  }
  return e instanceof Error ? e : new Error("GSP call failed");
}

// ── 2. Cancel IRN ───────────────────────────────────────────────────────────

const zCancel = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().min(1).max(100),
  remark: z.string().max(500).optional(),
});

export const cancelGspIrn = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => zCancel.parse(input))
  .handler(async ({ data, context }) => {
    await assertModulePermission(context.userId, "sales", "edit");
    const admin = await getAdmin();
    const config = getGspConfig();
    const transport = transportForMode(config.mode, config);

    const { data: invoice, error } = await admin
      .from("invoices")
      .select("id,irn,ack_date")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (error) throw new Error(reportDbError("gsp.loadForCancel", error));
    if (!invoice?.irn) throw new Error("Invoice has no IRN to cancel");
    // The GSP only accepts a cancellation within 24h of the AckDate. Checking
    // here turns an opaque GSP rejection into an actionable message, and stops
    // us burning a GSP call (and writing a misleading log row) on a request
    // that can only ever be refused.
    if (!isWithinIrnCancelWindow(invoice.ack_date)) {
      throw new Error(
        "IRN can only be cancelled within 24 hours of generation. Raise a credit note instead.",
      );
    }

    const userGstin = config.userGstin;
    await transport.cancelIrn({
      user_gstin: userGstin,
      irn: invoice.irn as string,
      reason: data.reason,
      remark: data.remark,
    });

    await admin
      .from("invoices")
      .update({ einvoice_status: "cancelled", einvoice_error: null })
      .eq("id", data.invoiceId);
    await admin.from("eway_bills").update({ status: "cancelled" }).eq("invoice_id", data.invoiceId);

    return { ok: true as const };
  });

// ── 3. Generate e-way bill (always AFTER the IRN) ───────────────────────────

export const generateGspEwb = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => ewbInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertModulePermission(context.userId, "sales", "edit");
    const admin = await getAdmin();
    const config = getGspConfig();
    const transport = transportForMode(config.mode, config);

    const { data: invoice, error } = await admin
      .from("invoices")
      .select("id,irn,transport_details,ewaybill_no,total")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (error) throw new Error(reportDbError("gsp.loadForEwb", error));
    if (!invoice) throw new Error("Invoice not found");
    if (!invoice.irn) {
      throw new Error(
        "Generate the IRN first — an e-invoice-enabled supplier must raise its e-way bill by IRN",
      );
    }
    if (invoice.ewaybill_no)
      return {
        ok: true as const,
        alreadyGenerated: true as const,
        ewbNo: invoice.ewaybill_no as string,
      };

    const transportDetails = (invoice.transport_details ?? {}) as TransportDetails;
    // Explicit Part-B input wins; anything omitted falls back to the invoice's
    // frozen transport_details. See resolveEwbTransportFields for the rules.
    const ewbFields = resolveEwbTransportFields(transportDetails, data);
    const envelope = await transport.genEwbByIrn({
      user_gstin: config.userGstin,
      irn: invoice.irn as string,
      distance: data.distance,
      transporter_id: ewbFields.transporter_id,
      transporter_name: ewbFields.transporter_name,
      vehicle_number: ewbFields.vehicle_number,
    });

    const message = messageOf(envelope);
    // The only reliable success signal is a non-null EwbNo.
    const ewbNo =
      message.EwbNo === null || message.EwbNo === undefined ? null : String(message.EwbNo);
    if (!ewbNo || !/^\d{12}$/.test(ewbNo)) {
      throw new Error("GSP did not return an e-way bill number");
    }

    const now = new Date().toISOString();
    await admin
      .from("invoices")
      .update({
        ewaybill_no: ewbNo,
        ewaybill_date: now,
        ewaybill_valid_till: message.EwbValidTill ?? null,
        eway_status: "generated",
      })
      .eq("id", data.invoiceId);

    await admin.from("eway_bills").insert({
      invoice_id: data.invoiceId,
      transporter_name: ewbFields.transporter_name,
      transporter_id: ewbFields.transporter_id,
      vehicle_no: ewbFields.vehicle_number,
      transport_mode: transportDetails.transport_mode ?? null,
      distance_km: data.distance,
      ewb_no: ewbNo,
      ewb_date: now,
      valid_till: message.EwbValidTill ? new Date(message.EwbValidTill).toISOString() : null,
      status: "generated",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb column — supabase-js expects Json for these tables
      response: redact(envelope) as any,
      created_by: context.userId,
    });

    return { ok: true as const, alreadyGenerated: false as const, ewbNo };
  });

// ── 4. Status check ─────────────────────────────────────────────────────────

export const getGspComplianceStatus = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((input) => zInvoiceId.parse(input))
  .handler(async ({ data, context }) => {
    await assertModulePermission(context.userId, "sales", "read");
    const admin = await getAdmin();
    const config = getGspConfig();
    const transport = transportForMode(config.mode, config);

    const { data: invoice, error } = await admin
      .from("invoices")
      .select(
        "id,invoice_no,invoice_date,branch_id,einvoice_status,eway_status,irn,ack_no,ewaybill_no,total",
      )
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (error) throw new Error(reportDbError("gsp.status", error));
    if (!invoice) throw new Error("Invoice not found");

    const local: ComplianceStatus = {
      mode: config.mode,
      invoiceNo: invoice.invoice_no as string,
      irn: (invoice.irn as string) ?? null,
      ackNo: (invoice.ack_no as string) ?? null,
      einvoiceStatus: (invoice.einvoice_status as string) ?? null,
      ewayStatus: (invoice.eway_status as string) ?? null,
      ewbNo: (invoice.ewaybill_no as string) ?? null,
      remoteChecked: false,
      remoteMatches: null,
      remoteMessage: null,
    };

    // If there is an IRN, confirm it with the GSP; otherwise there is nothing
    // remote to check and the local state is the whole story.
    if (!invoice.irn) return local;

    try {
      const found = await transport.getEinvoiceByIrn({
        user_gstin: config.userGstin,
        irn: invoice.irn as string,
      });
      const remote = messageOf(found);
      local.remoteChecked = true;
      local.remoteMatches = String(remote.Irn ?? "") === (invoice.irn as string);
      local.remoteMessage = typeof remote.Status === "string" ? remote.Status : null;
    } catch (e) {
      local.remoteChecked = true;
      local.remoteMatches = false;
      local.remoteMessage = e instanceof Error ? e.message : "Status check failed";
    }
    return local;
  });

export type ComplianceStatus = {
  mode: "mock" | "sandbox" | "production";
  invoiceNo: string;
  irn: string | null;
  ackNo: string | null;
  einvoiceStatus: string | null;
  ewayStatus: string | null;
  ewbNo: string | null;
  remoteChecked: boolean;
  remoteMatches: boolean | null;
  remoteMessage: string | null;
};

// ── 5. Runtime info for the mode badge (no secrets) ─────────────────────────

export const getGspRuntimeInfo = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async () => {
    const config = getGspConfig();
    return {
      mode: config.mode,
      // Host only — never the full URL with embedded credentials.
      host: config.baseUrl.replace(/^https?:\/\//, ""),
      isMock: config.mode === "mock",
    };
  });

// ── 6. GSTIN lookup (read-only) ─────────────────────────────────────────────

const zGstin = z.object({
  gstin: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{15}$/, "GSTIN must be 15 characters"),
  action: z.string().trim().max(32).optional(),
});

/**
 * Look up a counterparty GSTIN against the GSP.
 *
 * Read-only, so it gates on `sales · read` (the same permission the compliance
 * status check uses) rather than `edit`. This is a convenience lookup — it does
 * not write anything and is not a statutory action.
 */
export const verifyGstin = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => zGstin.parse(input))
  .handler(async ({ data, context }) => {
    await assertModulePermission(context.userId, "sales", "read");
    const config = getGspConfig();
    const transport = transportForMode(config.mode, config);

    const envelope = await transport.getGstinDetails({
      gstin: data.gstin,
      action: data.action,
    });
    const message = messageOf(envelope);
    return normalizeGstinDetails(message);
  });

// ── 7. Connection test (token-auth only, creates nothing) ───────────────────

export type GspConnectionResult =
  { ok: true; mode: GspMode } | { ok: false; mode: GspMode; code: number | null; error: string };
/**
 * Probe the GSP by authenticating and nothing else.
 *
 * Split out of the server function so it is unit-testable: a `createServerFn`
 * handler cannot be invoked outside the TanStack Start runtime (there is no
 * Start context in AsyncLocalStorage), so keeping the body here is what lets
 * `gspConnection.test.ts` run the real code path.
 *
 * The safety property: this calls `transport.authenticate()` and nothing else.
 * No IRN, no e-way bill, no cancellation, no business-table write. It is the
 * one affordance an operator can use without risking a statutory document.
 *
 * `getGspConfig()` is deliberately OUTSIDE the try. A misconfigured
 * sandbox/production throws and propagates, because degrading a config error
 * into `ok: false` would let the UI read as a connection problem and send the
 * operator chasing the wrong fault.
 */
export async function runGspConnectionTest(): Promise<GspConnectionResult> {
  const config = getGspConfig();
  const transport = transportForMode(config.mode, config);
  try {
    await transport.authenticate();
    return { ok: true, mode: config.mode };
  } catch (e) {
    return {
      ok: false,
      mode: config.mode,
      code: e instanceof GspError ? e.code : null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Operator-facing "Test GSP connection" button.
 *
 * Gates on `sales · read` (same as `verifyGstin`): it is a diagnostic read, not
 * a statutory action, so it must not demand `edit`.
 */
export const testGspConnection = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((d: void) => d)
  .handler(async ({ data: _d, context }) => {
    await assertModulePermission(context.userId, "sales", "read");

    const result = await runGspConnectionTest();

    // No invoice is involved, so `invoice_id` stays null. Credential probing is
    // worth an audit row; `logCall` swallows its own failures, so a logging
    // problem can never mask or break the probe result.
    await logCall({
      invoiceId: null,
      operation: "token_auth",
      endpoint: "/api/v1/token-auth/",
      ok: result.ok,
      errorMessage: result.ok ? null : result.error,
      userId: context.userId,
    });

    return result;
  });
