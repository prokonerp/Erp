import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createHttpTransport,
  getGspConfig,
  GspError,
  GspTimeoutError,
  parseBusinessError,
  resetGspTokenCache,
  type GspConfig,
  type GspEnvelope,
} from "@/lib/gspClient";
import { createMockTransport } from "@/lib/gspMock";
import type { GspInvoiceRequest } from "@/lib/gspPayload";

// ── helpers ─────────────────────────────────────────────────────────────────

const CFG: GspConfig = {
  mode: "sandbox",
  baseUrl: "https://sandb-api.mastersindia.co",
  username: "u",
  password: "p",
  userGstin: "06AEHPA2697G1ZL",
};

function ok(message: Record<string, unknown>): GspEnvelope {
  return {
    results: {
      message,
      errorMessage: "",
      InfoDtls: "",
      status: "Success",
      code: 200,
      requestId: "req-1",
    },
  };
}

function failed(errorMessage: string): GspEnvelope {
  return {
    results: {
      message: "",
      errorMessage,
      InfoDtls: "",
      status: "Failed",
      code: 204,
      requestId: "req-1",
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeReq(): GspInvoiceRequest {
  return {
    user_gstin: "06AEHPA2697G1ZL",
    data_source: "erp",
    transaction_details: {
      supply_type: "B2B",
      charge_type: "N",
      igst_on_intra: "N",
      ecommerce_gstin: "",
    },
    document_details: {
      document_type: "INV",
      document_number: "PHS/1",
      document_date: "01/09/2026",
    },
    seller_details: {} as GspInvoiceRequest["seller_details"],
    buyer_details: {} as GspInvoiceRequest["buyer_details"],
    dispatch_details: null,
    ship_details: null,
    export_details: null,
    payment_details: null,
    reference_details: {
      invoice_remarks: null,
      document_period_details: null,
      preceding_document_details: null,
      contract_details: null,
    },
    additional_document_details: null,
    ewaybill_details: null,
    value_details: {} as GspInvoiceRequest["value_details"],
    item_list: [],
  };
}

beforeEach(() => {
  resetGspTokenCache();
});

// ── config ──────────────────────────────────────────────────────────────────

describe("getGspConfig", () => {
  it("defaults to mock mode and needs no credentials", () => {
    const cfg = getGspConfig({} as NodeJS.ProcessEnv);
    expect(cfg.mode).toBe("mock");
  });

  it("throws in sandbox mode when the base URL is missing", () => {
    expect(() =>
      getGspConfig({
        GSP_MODE: "sandbox",
        GSP_USERNAME: "u",
        GSP_PASSWORD: "p",
      } as NodeJS.ProcessEnv),
    ).toThrow(/GSP_BASE_URL/);
  });

  it("throws in sandbox mode when credentials are missing", () => {
    expect(() =>
      getGspConfig({ GSP_MODE: "sandbox", GSP_BASE_URL: "https://x" } as NodeJS.ProcessEnv),
    ).toThrow(/GSP_USERNAME/);
  });

  it("rejects an unknown mode instead of guessing", () => {
    expect(() => getGspConfig({ GSP_MODE: "live" } as NodeJS.ProcessEnv)).toThrow(/GSP_MODE/);
  });
});

// ── error mapping ───────────────────────────────────────────────────────────

describe("parseBusinessError", () => {
  it("extracts the numeric code from the leading integer of errorMessage", () => {
    const err = parseBusinessError(
      failed("3038: Seller details Details:Pincode-101301 does not exists"),
      "gen",
      200,
    );
    expect(err).toBeInstanceOf(GspError);
    expect(err?.code).toBe(3038);
    expect(err?.isBusiness).toBe(true);
    expect(err?.message).toContain("3038");
  });

  it("returns null on a success envelope", () => {
    expect(parseBusinessError(ok({ Irn: "a".repeat(64) }), "gen", 200)).toBeNull();
  });

  it("treats a missing errorMessage with a non-Success status as a failure with a null code", () => {
    const err = parseBusinessError(
      { results: { message: "", status: "Failed", code: 204 } },
      "gen",
      200,
    );
    expect(err).toBeInstanceOf(GspError);
    expect(err?.code).toBeNull();
  });
});

// ── auth ────────────────────────────────────────────────────────────────────

describe("HTTP transport — authentication", () => {
  it("reads the unwrapped token from /token-auth/ and sends it as `JWT`, never `Bearer`", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes("token-auth")) return jsonResponse({ token: "T1" });
      return jsonResponse(ok({ Irn: "b".repeat(64) }));
    });
    const t = createHttpTransport({ config: CFG, fetchImpl, sleep: async () => {}, now: () => 0 });

    await t.generateIrn(makeReq());

    const dataCall = fetchImpl.mock.calls.find((c) => String(c[0]).includes("/einvoice/"))!;
    const headers = (dataCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("JWT T1");
    expect(headers.Authorization).not.toMatch(/^Bearer/);
  });

  it("caches the token across calls instead of re-authenticating each time", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("token-auth")
        ? jsonResponse({ token: "T1" })
        : jsonResponse(ok({ Irn: "c".repeat(64) })),
    );
    const t = createHttpTransport({ config: CFG, fetchImpl, sleep: async () => {}, now: () => 0 });

    await t.generateIrn(makeReq());
    await t.generateIrn(makeReq());

    const authCalls = fetchImpl.mock.calls.filter((c) => String(c[0]).includes("token-auth"));
    expect(authCalls).toHaveLength(1);
  });

  it("maps a flat credential error to a GspError", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "Unable to login with provided credential" }, 200),
    );
    const t = createHttpTransport({ config: CFG, fetchImpl, sleep: async () => {}, now: () => 0 });
    await expect(t.generateIrn(makeReq())).rejects.toThrow(/Unable to login/);
  });
});

// ── retry policy ────────────────────────────────────────────────────────────

describe("HTTP transport — retry policy", () => {
  it("re-authenticates once on 401 and succeeds on retry", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("token-auth")) {
        n += 1;
        return jsonResponse({ token: `T${n}` });
      }
      if (n === 1) return jsonResponse({ error: "expired" }, 401);
      return jsonResponse(ok({ Irn: "d".repeat(64) }));
    });
    const t = createHttpTransport({ config: CFG, fetchImpl, sleep: async () => {}, now: () => 0 });

    const res = await t.generateIrn(makeReq());
    expect((res.results?.message as { Irn: string }).Irn).toBe("d".repeat(64));
    expect(n).toBe(2);
  });

  it("gives up after a second 401 instead of looping", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("token-auth") ? jsonResponse({ token: "T" }) : jsonResponse({}, 401),
    );
    const t = createHttpTransport({ config: CFG, fetchImpl, sleep: async () => {}, now: () => 0 });
    await expect(t.generateIrn(makeReq())).rejects.toThrow();
  });

  it("retries an idempotent read on 5xx with exponential backoff", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("token-auth")) return jsonResponse({ token: "T" });
      calls += 1;
      if (calls < 3) return jsonResponse({ error: "server" }, 503);
      return jsonResponse(ok({ Irn: "e".repeat(64) }));
    });
    const t = createHttpTransport({
      config: CFG,
      fetchImpl,
      sleep: async (ms: number) => {
        delays.push(ms);
      },
      now: () => 0,
    });

    await t.getEinvoiceByDoc({ user_gstin: "06AEHPA2697G1ZL", document_number: "PHS/1" });
    expect(calls).toBe(3);
    expect(delays).toEqual([250, 1000]);
  });

  it("does NOT retry a business failure — it surfaces the code immediately", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("token-auth")) return jsonResponse({ token: "T" });
      calls += 1;
      return jsonResponse(failed("2143: IRN belongs to another GSTIN"));
    });
    const t = createHttpTransport({ config: CFG, fetchImpl, sleep: async () => {}, now: () => 0 });

    await expect(t.generateIrn(makeReq())).rejects.toMatchObject({ code: 2143 });
    expect(calls).toBe(1);
  });

  it("does NOT blindly retry generateIrn after a timeout — the outcome is unknown", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("token-auth")) return jsonResponse({ token: "T" });
      calls += 1;
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const t = createHttpTransport({ config: CFG, fetchImpl, sleep: async () => {}, now: () => 0 });

    const err = await t.generateIrn(makeReq()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GspTimeoutError);
    expect((err as GspTimeoutError).isOutcomeUnknown).toBe(true);
    // exactly one attempt — a second blind POST could mint a duplicate IRN
    expect(calls).toBe(1);
  });
});

// ── mock transport ──────────────────────────────────────────────────────────

describe("mock transport", () => {
  it("returns a well-formed IRN, AckNo and QR from generateIrn", async () => {
    const t = createMockTransport();
    const res = await t.generateIrn(makeReq());
    const m = res.results?.message as Record<string, unknown>;

    expect(String(m.Irn)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(m.AckNo)).toMatch(/^\d{15}$/);
    expect(String(m.SignedQRCode)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("returns a 12-digit EwbNo from genEwbByIrn, not from generateIrn", async () => {
    // Per the API docs an e-invoice-enabled supplier must raise its E-Way Bill
    // through gen-ewb-by-irn; generateIrn must not mint one inline.
    const t = createMockTransport();
    const irn = ((await t.generateIrn(makeReq())).results?.message as { Irn: string }).Irn;
    expect((await t.generateIrn(makeReq())).results?.message).not.toHaveProperty("EwbNo");

    const ewb = await t.genEwbByIrn({ user_gstin: "06AEHPA2697G1ZL", irn, distance: 1650 });
    expect(String((ewb.results?.message as { EwbNo: string }).EwbNo)).toMatch(/^\d{12}$/);
  });

  it("is deterministic: the same document yields the same IRN on a repeat call", async () => {
    const t = createMockTransport();
    const a = await t.generateIrn(makeReq());
    const b = await t.generateIrn(makeReq());
    expect((a.results?.message as { Irn: string }).Irn).toBe(
      (b.results?.message as { Irn: string }).Irn,
    );
  });

  it("never emits the repeated-8-hex block that mockIrnPayload produced", async () => {
    const t = createMockTransport();
    const res = await t.generateIrn(makeReq());
    const irn = (res.results?.message as { Irn: string }).Irn;
    expect(irn).not.toBe(irn.slice(0, 8).repeat(8));
  });

  it("gives different documents different IRNs", async () => {
    const t = createMockTransport();
    const a = await t.generateIrn(makeReq());
    const req2 = makeReq();
    const b = await t.generateIrn({
      ...req2,
      document_details: { ...req2.document_details, document_number: "PHS/2" },
    });
    expect((a.results?.message as { Irn: string }).Irn).not.toBe(
      (b.results?.message as { Irn: string }).Irn,
    );
  });

  it("injects a business failure when GSP_MOCK_ERROR is set", async () => {
    const t = createMockTransport({ mockError: "3038: bad pincode" });
    const err = await t.generateIrn(makeReq()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GspError);
    expect((err as GspError).code).toBe(3038);
  });

  it("reports an E-Way Bill as null when the EWB endpoint is asked for a missing IRN", async () => {
    const t = createMockTransport();
    const res = await t.getEwbByIrn({ irn: "f".repeat(64) });
    expect((res.results?.message as { EwbNo: unknown }).EwbNo).toBeNull();
  });
});
