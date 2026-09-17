// Friendly sign-in failure messages (B1.8 robustness).
//
// Supabase Auth rejects bad password grants with HTTP 400 and terse codes.
// The raw text confuses users ("invalid grant"), so map the known failures
// to guided next steps. Unknown errors pass through verbatim — never swallow.

/** Map a signInWithPassword failure message to guided user-facing text. */
export function friendlySignInError(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  const low = m.toLowerCase();
  if (low.includes("invalid login credentials") || low.includes("invalid_grant")) {
    return "Invalid email or password. Check for typos (and Caps Lock) and try again.";
  }
  if (low.includes("email not confirmed") || low.includes("email_not_confirmed")) {
    return "Email not confirmed — check your inbox for the confirmation link, or ask your admin to confirm you.";
  }
  if (low.includes("too many requests") || low.includes("rate limit")) {
    return "Too many attempts — wait a minute and try again.";
  }
  if (low.includes("network") || low.includes("fetch failed") || low.includes("failed to fetch")) {
    return "Could not reach the server — check your connection and retry.";
  }
  return m !== "" ? m : "Sign-in failed. Please try again.";
}
