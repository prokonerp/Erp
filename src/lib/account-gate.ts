// Pure decision logic for the server-side account gate enforced by
// `requireActiveUser` (src/integrations/supabase/auth-middleware.ts).
// Kept dependency-free so it is unit-testable without the server runtime.

export const PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED";
export const ACCOUNT_NOT_ACTIVE = "ACCOUNT_NOT_ACTIVE";

/**
 * app_users.status values that revoke application access. Deliberately an
 * explicit deny-list (not `status !== "active"`): unknown/legacy/empty statuses
 * must never lock a real user out of the app.
 */
export const BLOCKED_STATUSES: ReadonlySet<string> = new Set([
  "inactive",
  "disabled",
  "suspended",
  "blocked",
  "terminated",
  "archived",
]);

export type AccountGateInput = {
  mustChangePassword?: boolean | null;
  status?: string | null;
};

export type AccountGateDenial = { code: string; message: string };

/**
 * Returns the reason the request must be rejected with a 401, or `null` when the
 * account may proceed. A pending forced password change wins over status so the
 * user gets the actionable message.
 */
export function evaluateAccountGate(input: AccountGateInput): AccountGateDenial | null {
  // A pending forced password change wins over status so the user gets the
  // actionable message (the change-password dialog stays reachable).
  if (input.mustChangePassword) {
    return {
      code: PASSWORD_CHANGE_REQUIRED,
      message: "Password change required: set a new password before continuing.",
    };
  }
  // No app_users profile row (status === null/undefined) means the account has
  // no provisioned profile. Deny access so externally-created auth users (e.g.
  // added directly in the Supabase dashboard) cannot reach the app. A present
  // but empty/unknown status still fails OPEN by design — only a missing
  // profile is treated as a denial.
  if (input.status == null) {
    return {
      code: ACCOUNT_NOT_ACTIVE,
      message: "No account profile found. Contact your administrator.",
    };
  }
  const status = input.status.trim().toLowerCase();
  if (status && BLOCKED_STATUSES.has(status)) {
    return {
      code: ACCOUNT_NOT_ACTIVE,
      message: `Account is ${status}. Contact your administrator.`,
    };
  }
  return null;
}
