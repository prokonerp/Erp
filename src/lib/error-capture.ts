// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function isPerfNoiseError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "").toLowerCase();
  const stack = String((err as any)?.stack || "").toLowerCase();
  return (
    (msg.includes("starttime") && msg.includes("undefined")) ||
    stack.includes("reportallchanges")
  );
}

function record(error: unknown) {
  if (isPerfNoiseError(error)) return;
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => {
    const err: any = (event as ErrorEvent).error ?? event;
    if (isPerfNoiseError(err)) {
      try { (event as ErrorEvent).preventDefault?.(); } catch {}
      return;
    }
    record(err);
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason: any = (event as PromiseRejectionEvent).reason;
    if (isPerfNoiseError(reason)) {
      try { (event as PromiseRejectionEvent).preventDefault?.(); } catch {}
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
