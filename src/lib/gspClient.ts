/**
 * src/lib/gspClient.ts — Masters India GSP HTTP transport.
 *
 * Server-only. No Supabase import, no invoice math: this module knows how to
 * talk to the GSP and how to interpret what comes back. It deliberately does
 * not know what an invoice is.
 *
 * ## Facts pinned from the source documents
 * (see `docs/gsp-einvoice-api-reference.md` and
 * `docs/GSP_INTEGRATION_AND_TALLY_EXPORT.md` §3.2, §3.5, §3.6)
 *
 * 1. Auth is `POST /api/v1/token-auth/` and returns `{ "token": "..." }`
 *    **unwrapped** — it is the one endpoint that does NOT use the `results`
 *    envelope. Every other call does.
 * 2. The header scheme is `Authorization: JWT <token>`. It is **never**
 *    `Bearer`. `Bearer` returns an opaque auth failure.
 * 3. Token lifetime is undocumented (only the sample JWT's `exp` hints at
 *    ~20-24h), so the TTL is deliberately conservative and the client also
 *    re-authenticates reactively on HTTP 401. Never trust a hard-coded TTL.
 * 4. There is no numeric error-code field. The code is the **leading integer
 *    of the `errorMessage` string** (`"3038: ..."`).
 * 5. Never branch on `results.status`: a successful payload can carry
 *    `status: "Success"` while an embedded sub-operation (EWB) has failed.
 *    For EWB the only reliable signal is `message.EwbNo == null`.
 * 6. Key sets differ per endpoint; there is deliberately no single shared
 *    response interface.
 *
 * ## The retry rule that prevents duplicate IRNs
 *
 * Generate-IRN is not idempotent by accident: a blind retry after a timeout
 * can mint a second IRN for one invoice. So `idempotent: false` operations
 * are attempted **once** and a transport-level failure surfaces as
 * `GspTimeoutError` with `isOutcomeUnknown`, leaving the caller to confirm
 * the outcome via `getEinvoiceByDoc` before deciding to try again.
 */

import type { GspInvoiceRequest } from "./gspPayload";

// ── config ──────────────────────────────────────────────────────────────────

export type GspMode = "mock" | "sandbox" | "production";

export type GspConfig = {
  mode: GspMode;
  baseUrl: string;
  username: string;
  password: string;
  userGstin: string;
};

const MODES: GspMode[] = ["mock", "sandbox", "production"];

export const SANDBOX_BASE_URL = "https://sandb-api.mastersindia.co";

/**
 * Read GSP configuration from the environment.
 *
 * `mock` deliberately needs no credentials: it is the mode this project ships
 * in until Masters India issues sandbox credentials. `sandbox` and
 * `production` fail closed rather than silently degrading to mock.
 */
export function getGspConfig(env: NodeJS.ProcessEnv = process.env): GspConfig {
  const rawMode = (env.GSP_MODE ?? "mock").trim() || "mock";
  if (!MODES.includes(rawMode as GspMode)) {
    throw new Error(
      `GSP_MODE must be one of ${MODES.join(" | ")} — got "${rawMode}". Refusing to guess.`,
    );
  }
  const mode = rawMode as GspMode;

  const baseUrl = (env.GSP_BASE_URL ?? "").trim();
  const username = (env.GSP_USERNAME ?? "").trim();
  const password = (env.GSP_PASSWORD ?? "").trim();
  const userGstin = (env.GSP_USER_GSTIN ?? "").trim();

  if (mode === "mock") {
    return { mode, baseUrl: baseUrl || "mock://local", username, password, userGstin };
  }

  const missing: string[] = [];
  if (!baseUrl) missing.push("GSP_BASE_URL");
  if (!username) missing.push("GSP_USERNAME");
  if (!password) missing.push("GSP_PASSWORD");
  if (!userGstin) missing.push("GSP_USER_GSTIN");
  if (missing.length) {
    throw new Error(
      `GSP ${mode} mode is misconfigured — missing ${missing.join(", ")}. ` +
        `Set these in the server environment (never commit them).`,
    );
  }
  return { mode, baseUrl: baseUrl.replace(/\/+$/, ""), username, password, userGstin };
}

// ── response shapes ─────────────────────────────────────────────────────────

/**
 * The `results.message` object. Keys vary per endpoint (see note 6 above), so
 * everything is optional and consumers must check what they need.
 */
export type GspMessage = {
  Irn?: string;
  AckNo?: string;
  AckDt?: string;
  SignedInvoice?: string;
  SignedQRCode?: string;
  Status?: string;
  EwbNo?: number | string | null;
  EwbDt?: string;
  EwbValidTill?: string;
  QRCodeUrl?: string;
  EinvoicePdf?: string;
  EwaybillPdf?: string;
  CancelDate?: string;
  GenGstin?: string;
  error?: boolean;
  alert?: unknown;
  Alert?: unknown;
  [key: string]: unknown;
};

export type GspResults = {
  message?: GspMessage | string;
  errorMessage?: string;
  InfoDtls?: string;
  status?: string;
  code?: number;
  requestId?: string;
  request_id?: string;
};

export type GspEnvelope = {
  results?: GspResults;
  [key: string]: unknown;
};

// ── errors ──────────────────────────────────────────────────────────────────

export class GspError extends Error {
  readonly code: number | null;
  readonly endpoint: string;
  readonly httpStatus: number | null;
  /** True when the GSP accepted the call and rejected the *business*. */
  readonly isBusiness: boolean;
  readonly infoDtls: string | null;

  constructor(
    message: string,
    opts: {
      code?: number | null;
      endpoint: string;
      httpStatus?: number | null;
      isBusiness?: boolean;
      infoDtls?: string | null;
    },
  ) {
    super(message);
    this.name = "GspError";
    this.code = opts.code ?? null;
    this.endpoint = opts.endpoint;
    this.httpStatus = opts.httpStatus ?? null;
    this.isBusiness = opts.isBusiness ?? false;
    this.infoDtls = opts.infoDtls ?? null;
  }
}

/**
 * The request failed in a way where we do not know whether the GSP applied it.
 *
 * For generate-IRN this is the dangerous case: the IRN may exist even though
 * we never saw the response. Callers MUST resolve the outcome (e.g. via
 * `getEinvoiceByDoc`) before retrying.
 */
export class GspTimeoutError extends Error {
  readonly endpoint: string;
  readonly isOutcomeUnknown = true as const;

  constructor(endpoint: string, cause?: unknown) {
    super(`GSP ${endpoint}: request failed before a response was received (outcome unknown)`);
    this.name = "GspTimeoutError";
    this.endpoint = endpoint;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** `"3038: ..."` → `3038`. Returns null when there is no leading integer. */
export function parseGspErrorCode(errorMessage: string | null | undefined): number | null {
  if (!errorMessage) return null;
  const m = /^\s*(\d+)\s*:/.exec(String(errorMessage));
  if (m) return Number(m[1]);
  const loose = /^\s*(\d+)/.exec(String(errorMessage));
  return loose ? Number(loose[1]) : null;
}

/**
 * Decide whether an envelope represents a business failure.
 *
 * Per note 5 we do not branch on `status` alone — a Success envelope can still
 * carry a failed sub-operation. We treat it as a failure when the GSP gave us
 * a non-empty `errorMessage`, or when there is no `message` payload at all.
 */
export function parseBusinessError(
  envelope: GspEnvelope | null | undefined,
  endpoint: string,
  httpStatus: number | null,
): GspError | null {
  // The flat `{"error": "..."}` shape is auth-only, but treat it uniformly.
  if (envelope && typeof envelope.error === "string" && envelope.error) {
    return new GspError(envelope.error, { endpoint, httpStatus, isBusiness: false });
  }

  const results = envelope?.results;
  if (!results) {
    if (envelope && Object.keys(envelope).length === 0) return null;
    return new GspError("GSP response had no `results` envelope", { endpoint, httpStatus });
  }

  const errorMessage = typeof results.errorMessage === "string" ? results.errorMessage.trim() : "";
  if (errorMessage) {
    return new GspError(errorMessage, {
      code: parseGspErrorCode(errorMessage),
      endpoint,
      httpStatus,
      isBusiness: true,
      infoDtls: typeof results.InfoDtls === "string" ? results.InfoDtls : null,
    });
  }

  // No errorMessage: a usable success must carry a message object. A string
  // or absent message means the GSP gave us nothing actionable.
  if (typeof results.message !== "object" || results.message === null) {
    return new GspError(
      `GSP ${endpoint} returned no message payload (status: ${results.status ?? "unknown"})`,
      {
        endpoint,
        httpStatus,
        infoDtls: typeof results.InfoDtls === "string" ? results.InfoDtls : null,
      },
    );
  }

  return null;
}

// ── transport interface ─────────────────────────────────────────────────────

export type CancelIrnRequest = { user_gstin: string; irn: string; reason: string; remark?: string };
export type GenEwbByIrnRequest = {
  user_gstin: string;
  irn: string;
  distance: number;
  transporter_id?: string | null;
  transporter_name?: string | null;
  vehicle_number?: string | null;
};
export type ByIrnQuery = { user_gstin?: string; irn: string };
export type ByDocQuery = { user_gstin: string; document_number: string; document_date?: string };
export type GstinQuery = { gstin: string; action?: string };

/**
 * One transport, two implementations (`http` for real GSP, `mock` for local
 * work). The server functions depend on this interface only, which is what
 * makes the mock/live switch a config change rather than a code change.
 */
export type GspTransport = {
  /**
   * Mint (or serve from cache) a GSP token — nothing else.
   *
   * This is the ONLY method on the interface that is guaranteed side-effect
   * free: it creates no IRN, no e-way bill, and touches no business table. It
   * exists so an operator can prove credentials and connectivity before risking
   * a real statutory document. Callers that need "did the GSP accept us?" must
   * never substitute a document-generating call for it.
   */
  authenticate(): Promise<{ token: string }>;
  generateIrn(body: GspInvoiceRequest): Promise<GspEnvelope>;
  cancelIrn(body: CancelIrnRequest): Promise<GspEnvelope>;
  genEwbByIrn(body: GenEwbByIrnRequest): Promise<GspEnvelope>;
  getEinvoiceByDoc(q: ByDocQuery): Promise<GspEnvelope>;
  getEinvoiceByIrn(q: ByIrnQuery): Promise<GspEnvelope>;
  getEwbByIrn(q: ByIrnQuery): Promise<GspEnvelope>;
  getGstinDetails(q: GstinQuery): Promise<GspEnvelope>;
};

// ── token cache (module scope, per process) ─────────────────────────────────

const TOKEN_MAX_AGE_MS = 15 * 60 * 1000;

let cachedToken: { token: string; at: number } | null = null;
let inflightToken: Promise<string> | null = null;

export function resetGspTokenCache(): void {
  cachedToken = null;
  inflightToken = null;
}

// ── HTTP transport ──────────────────────────────────────────────────────────

/**
 * The slice of `Response` this client actually uses.
 *
 * Declaring it structurally (rather than `typeof fetch`) keeps the transport
 * testable with a plain function, and keeps the contract explicit: the client
 * only ever needs the status and a JSON body.
 */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{ ok?: boolean; status: number; json: () => Promise<unknown> }>;

export type HttpTransportDeps = {
  config: GspConfig;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
};

const BACKOFF_MS = [250, 1000, 4000];
const MAX_ATTEMPTS = 3;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isAbortLike(e: unknown): boolean {
  if (e instanceof GspTimeoutError) return true;
  const n = (e as { name?: string } | null)?.name;
  return n === "AbortError" || n === "TimeoutError";
}

export function createHttpTransport(deps: HttpTransportDeps): GspTransport {
  const { config } = deps;
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? 20_000;

  async function authHeader(): Promise<string> {
    if (cachedToken && now() - cachedToken.at < TOKEN_MAX_AGE_MS) return cachedToken.token;
    if (!inflightToken) {
      inflightToken = (async () => {
        const res = await doFetch(`${config.baseUrl}/api/v1/token-auth/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: config.username, password: config.password }),
        });
        const body = (await res.json()) as { token?: string; error?: string; errors?: unknown };
        const flat = body?.error;
        if (flat) throw new GspError(flat, { endpoint: "token-auth", httpStatus: res.status });
        if (!body?.token) {
          throw new GspError("GSP token response had no `token`", {
            endpoint: "token-auth",
            httpStatus: res.status,
          });
        }
        cachedToken = { token: body.token, at: now() };
        return body.token;
      })().finally(() => {
        inflightToken = null;
      });
    }
    return inflightToken;
  }

  async function once(
    endpoint: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<GspEnvelope> {
    const token = await authHeader();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${config.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          // Scheme is JWT, never Bearer.
          Authorization: `JWT ${token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (res.status === 401) {
        resetGspTokenCache();
        throw new GspError(`GSP ${endpoint}: unauthorized (401)`, {
          endpoint,
          httpStatus: 401,
        });
      }

      let parsed: GspEnvelope;
      try {
        parsed = (await res.json()) as GspEnvelope;
      } catch {
        throw new GspError(`GSP ${endpoint}: response was not JSON`, {
          endpoint,
          httpStatus: res.status,
        });
      }

      if (res.status >= 500) {
        throw new GspError(`GSP ${endpoint}: upstream ${res.status}`, {
          endpoint,
          httpStatus: res.status,
        });
      }

      const business = parseBusinessError(parsed, endpoint, res.status);
      if (business) throw business;

      return parsed;
    } catch (e) {
      if (e instanceof GspError && e.httpStatus === 401) throw e;
      if (isAbortLike(e)) throw new GspTimeoutError(endpoint, e);
      if (e instanceof GspError) throw e;
      throw new GspTimeoutError(endpoint, e);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A 401 is a *definitive* "the GSP did not process this" signal, so exactly
   * one re-auth + retry is safe even for non-idempotent writes.
   *
   * Everything else is ambiguous: a timeout or 5xx may have registered the IRN
   * server-side. Those are retried only for idempotent reads; a write stops
   * and surfaces `GspTimeoutError` for the caller to resolve.
   */
  async function call(
    endpoint: string,
    method: "GET" | "POST",
    path: string,
    body: unknown,
    idempotent: boolean,
  ): Promise<GspEnvelope> {
    const maxAttempts = idempotent ? MAX_ATTEMPTS : 2; // 2 = initial + one 401 re-auth
    let reauthed = false;
    let last: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await once(endpoint, method, path, body);
      } catch (e) {
        last = e;
        const is401 = e instanceof GspError && e.httpStatus === 401;
        if (is401) {
          if (reauthed) throw e;
          reauthed = true;
          continue;
        }
        // Business failures are deterministic — never retry them.
        if (e instanceof GspError && e.isBusiness) throw e;
        // Ambiguous transport failure on a write: stop. Retrying could mint a
        // duplicate IRN, so the caller must confirm the outcome first.
        if (!idempotent) throw e;
        if (attempt < maxAttempts - 1) {
          await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
        }
      }
    }
    throw last instanceof Error ? last : new GspTimeoutError(endpoint, last);
  }

  const qs = (params: Record<string, string | number | null | undefined>) => {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === undefined || v === "") continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
  };

  return {
    // Reuses the one existing token-auth path (`authHeader`), so there is no
    // second request/auth/error implementation to drift out of sync.
    authenticate: () => authHeader().then((token) => ({ token })),

    // Generate/cancel are NOT idempotent → single attempt.
    generateIrn: (b) => call("generate_irn", "POST", "/api/v1/einvoice/", b, false),
    cancelIrn: (b) => call("cancel_irn", "POST", "/api/v1/einvoice/cancel-einvoice/", b, false),
    genEwbByIrn: (b) =>
      call("gen_ewb_by_irn", "POST", "/api/v1/einvoice/gen-ewb-by-irn/", b, false),

    // Reads are idempotent → retry safe. Note the deliberate query-param
    // inconsistency from the source docs: by-IRN uses `gstin=`, by-doc uses
    // `user_gstin=`. These are quirks of the API, not typos here.
    getEinvoiceByDoc: (q) =>
      call(
        "get_einvoice_by_doc",
        "GET",
        `/api/v1/einvoice/get-einvoice-details-by-doc${qs({ user_gstin: q.user_gstin, document_number: q.document_number, document_date: q.document_date })}`,
        undefined,
        true,
      ),
    getEinvoiceByIrn: (q) =>
      call(
        "get_einvoice_by_irn",
        "GET",
        `/api/v1/einvoice/get-einvoice-details${qs({ gstin: q.user_gstin, irn: q.irn })}`,
        undefined,
        true,
      ),
    getEwbByIrn: (q) =>
      call(
        "get_ewb_by_irn",
        "GET",
        `/api/v1/einvoice/get-ewb-details-by-irn${qs({ irn: q.irn })}`,
        undefined,
        true,
      ),
    getGstinDetails: (q) =>
      call(
        "get_gstin_details",
        "GET",
        `/api/v1/einvoice/get-gstin-details${qs({ gstin: q.gstin, action: q.action })}`,
        undefined,
        true,
      ),
  };
}
