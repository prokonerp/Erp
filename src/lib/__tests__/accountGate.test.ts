import { describe, it, expect } from "vitest";
import {
  ACCOUNT_NOT_ACTIVE,
  PASSWORD_CHANGE_REQUIRED,
  evaluateAccountGate,
} from "@/lib/account-gate";

describe("evaluateAccountGate", () => {
  it("blocks a pending forced password change", () => {
    const denial = evaluateAccountGate({ mustChangePassword: true, status: "active" });
    expect(denial?.code).toBe(PASSWORD_CHANGE_REQUIRED);
  });

  it("lets an active user through", () => {
    expect(evaluateAccountGate({ mustChangePassword: false, status: "active" })).toBeNull();
  });

  it("blocks deactivated accounts regardless of case/whitespace", () => {
    for (const status of ["inactive", " Inactive ", "DISABLED", "suspended", "blocked"]) {
      expect(evaluateAccountGate({ status })?.code).toBe(ACCOUNT_NOT_ACTIVE);
    }
  });

  it("fails open for unknown (but present) statuses so nobody is locked out by data drift", () => {
    for (const status of ["", "   ", "active", "pending", "onboarding"]) {
      expect(evaluateAccountGate({ status })).toBeNull();
    }
  });

  it("denies when no app_users profile row exists (status is null/undefined)", () => {
    for (const status of [null, undefined]) {
      const denial = evaluateAccountGate({ status });
      expect(denial?.code).toBe(ACCOUNT_NOT_ACTIVE);
    }
  });

  it("reports the password change first when both conditions apply", () => {
    const denial = evaluateAccountGate({ mustChangePassword: true, status: "inactive" });
    expect(denial?.code).toBe(PASSWORD_CHANGE_REQUIRED);
  });
});
