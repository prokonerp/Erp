// Server-only secrets for the public (unauthenticated) surfaces.
//
// These used to reuse SUPABASE_SERVICE_ROLE_KEY as the HMAC key for captchas
// and staged-upload delete tokens. That couples two very different trust
// domains: rotating the service-role key (a routine ops action) silently
// invalidates every outstanding captcha/token, and any leak of a token HMAC
// key would not be distinguishable from a service-role leak.
//
// PUBLIC_TOKEN_HMAC_SECRET is the dedicated key. The service-role key is kept
// as a fallback so existing deployments keep working until the env var is set
// (set it — see the runbook note in the PR).

const MIN_SECRET_LENGTH = 32;

let warnedAboutFallback = false;

/** HMAC key for public captcha challenges + staged-upload delete tokens. */
export function publicTokenSecret(): string {
  const dedicated = (process.env.PUBLIC_TOKEN_HMAC_SECRET || "").trim();
  if (dedicated.length >= MIN_SECRET_LENGTH) return dedicated;

  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!fallback) {
    throw new Error(
      "Server misconfigured: set PUBLIC_TOKEN_HMAC_SECRET (or SUPABASE_SERVICE_ROLE_KEY)",
    );
  }
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      "[secrets] PUBLIC_TOKEN_HMAC_SECRET is not set — falling back to SUPABASE_SERVICE_ROLE_KEY " +
        "for public-token HMACs. Set a dedicated 32+ char secret.",
    );
  }
  return fallback;
}

/** Test/reset hook so the fallback warning fires at most once per process. */
export function resetSecretWarningForTests(): void {
  warnedAboutFallback = false;
}
