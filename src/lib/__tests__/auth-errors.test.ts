import { describe, it, expect } from "vitest";
import { friendlySignInError } from "@/lib/auth-errors";

describe("friendlySignInError", () => {
  it("guides on invalid credentials", () => {
    expect(friendlySignInError("Invalid login credentials")).toContain("Invalid email or password");
    expect(friendlySignInError("invalid_grant: nope")).toContain("Invalid email or password");
  });

  it("guides on unconfirmed email", () => {
    expect(friendlySignInError("Email not confirmed")).toContain("confirmation link");
  });

  it("guides on rate limits and network failures", () => {
    expect(friendlySignInError("too many requests")).toContain("wait a minute");
    expect(friendlySignInError("TypeError: fetch failed")).toContain("connection");
  });

  it("passes unknown errors through, never blank", () => {
    expect(friendlySignInError("Something exotic broke")).toBe("Something exotic broke");
    expect(friendlySignInError("")).toBe("Sign-in failed. Please try again.");
    expect(friendlySignInError(null)).toBe("Sign-in failed. Please try again.");
  });
});
