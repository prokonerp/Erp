// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function isPerfNoiseError(err: unknown): boolean {
  const stack = String((err as any)?.stack || "").toLowerCase();
  return stack.includes("reportallchanges");
}

function record(error: unknown) {
  if (isPerfNoiseError(error)) return;
  lastCapturedError = { error, at: Date.now() };
}

// Prefer window (browser) with a globalThis fallback (workers / SSR).
type NoiseListenerTarget = {
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "unhandledrejection", listener: (event: PromiseRejectionEvent) => void): void;
};

function resolveListenerTarget(): NoiseListenerTarget | null {
  const w = typeof window !== "undefined"
    ? (window as unknown as { addEventListener?: unknown }).addEventListener
    : undefined;
  if (typeof w === "function") return window as unknown as NoiseListenerTarget;
  const g = (globalThis as unknown as { addEventListener?: unknown }).addEventListener;
  if (typeof g === "function") return globalThis as unknown as NoiseListenerTarget;
  return null;
}

const listenerTarget = resolveListenerTarget();

if (listenerTarget) {
  listenerTarget.addEventListener("error", (event) => {
    const err: unknown = event.error ?? event;
    if (isPerfNoiseError(err)) {
      try { event.preventDefault(); } catch { /* noop */ }
      try { console.debug("[error-capture] swallowed perf-noise error", err); } catch { /* noop */ }
      return;
    }
    record(err);
  });
  listenerTarget.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    if (isPerfNoiseError(reason)) {
      try { event.preventDefault(); } catch { /* noop */ }
      try { console.debug("[error-capture] swallowed perf-noise rejection", reason); } catch { /* noop */ }
      return;
    }
    record(reason);
  });
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
