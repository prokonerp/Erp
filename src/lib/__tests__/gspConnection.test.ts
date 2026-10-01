/**
 * `testGspConnection` — token-auth-only connectivity probe.
 *
 * The safety property under test is that this endpoint can NEVER create a
 * document: it only calls `authenticate()` on the transport, never
 * `generateIrn` / `genEwbByIrn` / `cancelIrn`, and never touches a business
 * table. So there is no invoice fixture anywhere in this file — by design.
 *
 * The second property is fail-closed: a misconfigured sandbox/production must
 * throw rather than degrade to a cheerful `ok: true`, otherwise an operator
 * would read "Connected" while every real document silently fails.
 *
 * These exercise `runGspConnectionTest` (the exported body of the server fn)
 * because a `createServerFn` handler cannot be invoked outside the TanStack
 * Start runtime — there is no Start context in AsyncLocalStorage under vitest.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { runGspConnectionTest } from "@/lib/gsp.functions";
import { createMockTransport } from "@/lib/gspMock";
import {
  createHttpTransport,
  getGspConfig,
  resetGspTokenCache,
  GspError,
  type FetchLike,
} from "@/lib/gspClient";

const CREDENTIAL_ENV = [
  "GSP_MODE",
  "GSP_BASE_URL",
  "GSP_USERNAME",
  "GSP_PASSWORD",
  "GSP_USER_GSTIN",
  "GSP_MOCK_ERROR",
] as const;

beforeEach(() => {
  resetGspTokenCache();
  for (const k of CREDENTIAL_ENV) vi.stubEnv(k, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetGspTokenCache();
});

describe("runGspConnectionTest", () => {
  it("reports success in mock mode without touching the network", async () => {
    vi.stubEnv("GSP_MODE", "mock");
    // A base URL that would fail loudly if a real fetch were ever attempted.
    vi.stubEnv("GSP_BASE_URL", "http://127.0.0.1:1/unreachable");

    await expect(runGspConnectionTest()).resolves.toEqual({ ok: true, mode: "mock" });
  });

  it("propagates the fail-closed misconfiguration error for sandbox mode", async () => {
    vi.stubEnv("GSP_MODE", "sandbox");
    vi.stubEnv("GSP_BASE_URL", "https://sandb-api.mastersindia.co");
    vi.stubEnv("GSP_USERNAME", ""); // the one credential we deliberately drop
    vi.stubEnv("GSP_PASSWORD", "s3cret");
    vi.stubEnv("GSP_USER_GSTIN", "27AAAAA1234A1Z5");

    await expect(runGspConnectionTest()).rejects.toThrow(/misconfigured/);
  });

  it("surfaces an injected mock failure as ok:false with a non-empty error", async () => {
    vi.stubEnv("GSP_MODE", "mock");
    vi.stubEnv("GSP_MOCK_ERROR", "3038: Pincode does not exist");

    const res = await runGspConnectionTest();

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable narrowing guard");
    expect(res.mode).toBe("mock");
    expect(res.error).toBeTruthy();
    expect(res.error.length).toBeGreaterThan(0);
    // The leading integer of the GSP errorMessage is the code (gspClient note 4).
    expect(res.code).toBe(3038);
  });

  it("never reports ok:false for a healthy mock transport", async () => {
    vi.stubEnv("GSP_MODE", "mock");
    const res = await runGspConnectionTest();
    expect(res).toEqual({ ok: true, mode: "mock" });
  });
});

describe("mock transport authenticate()", () => {
  it("returns a deterministic token so the mock is reproducible", async () => {
    const a = await createMockTransport().authenticate();
    const b = await createMockTransport().authenticate();

    expect(a.token).toBeTruthy();
    expect(a.token).toBe(b.token);
  });

  it("honours GSP_MOCK_ERROR so the failure path is exercisable offline", async () => {
    vi.stubEnv("GSP_MOCK_ERROR", "3038: Pincode does not exist");

    await expect(createMockTransport().authenticate()).rejects.toBeInstanceOf(GspError);
  });
});

describe("http transport authenticate()", () => {
  const config = {
    mode: "sandbox" as const,
    baseUrl: "https://sandb-api.mastersindia.co",
    username: "gspuser",
    password: "gsppass",
    userGstin: "27AAAAA1234A1Z5",
  };

  it("returns the unwrapped token from POST /api/v1/token-auth/", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      return { ok: true, status: 200, json: async () => ({ token: "jwt-abc-123" }) };
    };

    const res = await createHttpTransport({ config, fetchImpl }).authenticate();

    expect(res).toEqual({ token: "jwt-abc-123" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://sandb-api.mastersindia.co/api/v1/token-auth/");
    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      username: "gspuser",
      password: "gsppass",
    });
  });

  it("sends the username/password body but never a Bearer/JWT header", async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      seenHeaders = init?.headers as Record<string, string>;
      return { ok: true, status: 200, json: async () => ({ token: "jwt-abc-123" }) };
    };

    await createHttpTransport({ config, fetchImpl }).authenticate();

    // Auth is the ONLY endpoint that must not send an Authorization header —
    // it is what mints the token. `Bearer` would be rejected by the GSP.
    expect(seenHeaders?.Authorization).toBeUndefined();
  });

  it("rejects bad credentials from the flat { error } shape", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid credentials" }),
    });

    await expect(createHttpTransport({ config, fetchImpl }).authenticate()).rejects.toThrow(
      /Invalid credentials/,
    );
  });

  it("rejects a 200 response that carries no token", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "Success" }),
    });

    await expect(createHttpTransport({ config, fetchImpl }).authenticate()).rejects.toBeInstanceOf(
      GspError,
    );
  });

  it("serves a second authenticate() from the token cache instead of re-fetching", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ token: "jwt-cached" }) };
    };
    const transport = createHttpTransport({ config, fetchImpl });

    await transport.authenticate();
    await transport.authenticate();

    expect(calls).toBe(1);
  });
});

describe("getGspConfig remains fail-closed", () => {
  it("rejects sandbox mode when any single credential is missing", () => {
    const env = {
      GSP_MODE: "sandbox",
      GSP_BASE_URL: "https://sandb-api.mastersindia.co",
      GSP_USERNAME: "gspuser",
      GSP_PASSWORD: "",
      GSP_USER_GSTIN: "27AAAAA1234A1Z5",
    };
    expect(() => getGspConfig(env as NodeJS.ProcessEnv)).toThrow(/misconfigured/);
  });

  it("still allows mock mode with no credentials at all", () => {
    expect(getGspConfig({ GSP_MODE: "mock" } as NodeJS.ProcessEnv).mode).toBe("mock");
  });
});
