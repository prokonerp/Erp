import { describe, expect, it } from "vitest";
import { shouldSkipNavigation } from "../safe-navigation";

// Regression coverage for the TanStack Router #3110 self-loop:
// a render-time redirect guard must never re-commit when the router is
// already at its target, or commitLocation's same-url load() branch
// re-fires on every render until React throws "Maximum update depth
// exceeded" (Transitioner -> load -> commitLocation -> buildAndCommitLocation).
describe("shouldSkipNavigation", () => {
  it("skips when already at the identical href", () => {
    expect(shouldSkipNavigation("/auth", "/auth")).toBe(true);
    expect(shouldSkipNavigation("/eng/queue", "/eng/queue")).toBe(true);
    expect(shouldSkipNavigation("/dashboard", "/dashboard")).toBe(true);
  });

  it("skips trailing-slash variants (same comparison commitLocation uses)", () => {
    expect(shouldSkipNavigation("/eng/queue/", "/eng/queue")).toBe(true);
    expect(shouldSkipNavigation("/eng/queue", "/eng/queue/")).toBe(true);
  });

  it("navigates to a genuinely different destination", () => {
    expect(shouldSkipNavigation("/eng", "/dashboard")).toBe(false);
    expect(shouldSkipNavigation("/dashboard", "/eng")).toBe(false);
    expect(shouldSkipNavigation("/eng/queue", "/eng")).toBe(false);
    expect(shouldSkipNavigation("/auth", "/dashboard")).toBe(false);
  });

  it("treats differing search strings as different destinations", () => {
    expect(shouldSkipNavigation("/eng/queue", "/eng/queue?tab=open")).toBe(false);
    expect(shouldSkipNavigation("/eng/queue?tab=open", "/eng/queue?tab=open")).toBe(true);
  });

  it("treats differing hashes as different destinations", () => {
    expect(shouldSkipNavigation("/eng", "/eng#top")).toBe(false);
  });

  it("preserves root '/' and strips repeated trailing slashes (router-core port parity)", () => {
    expect(shouldSkipNavigation("/", "/")).toBe(true);
    expect(shouldSkipNavigation("/eng///", "/eng")).toBe(true);
    expect(shouldSkipNavigation("/", "/dashboard")).toBe(false);
  });
});
