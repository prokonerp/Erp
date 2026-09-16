import { describe, it, expect } from "vitest";
import { conveyanceLoadMessage } from "@/lib/engineer-conveyance";

const MIGRATION_MSG =
  "Conveyance storage isn't set up yet — ask your admin to run the latest migration, then retry.";
const DENIED_MSG =
  "Access denied loading conveyance — ask your admin to check your permissions, then retry.";
const NETWORK_MSG = "Couldn't load conveyance — check your connection and retry.";

describe("conveyanceLoadMessage", () => {
  it("keeps the migration message for missing-table errors only", () => {
    expect(conveyanceLoadMessage(new Error('relation "engineer_daily_logs" does not exist'))).toBe(
      MIGRATION_MSG,
    );
    expect(conveyanceLoadMessage(new Error("42P01: relation does not exist"))).toBe(MIGRATION_MSG);
    expect(
      conveyanceLoadMessage(new Error("Could not find the table 'public.x' in the schema cache")),
    ).toBe(MIGRATION_MSG);
  });

  it("reports access denied for RLS/permission failures", () => {
    expect(
      conveyanceLoadMessage(new Error('permission denied for table "engineer_daily_logs"')),
    ).toBe(DENIED_MSG);
    expect(
      conveyanceLoadMessage(new Error('new row violates row-level security policy for table "x"')),
    ).toBe(DENIED_MSG);
    expect(conveyanceLoadMessage(new Error("JWT expired"))).toBe(DENIED_MSG);
  });

  it("reports connection trouble for network failures", () => {
    expect(conveyanceLoadMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_MSG);
    expect(conveyanceLoadMessage(new Error("Load failed"))).toBe(NETWORK_MSG);
    expect(conveyanceLoadMessage(new Error("timeout of 10000ms exceeded"))).toBe(NETWORK_MSG);
  });

  it("passes through unknown messages instead of blaming the migration", () => {
    expect(conveyanceLoadMessage(new Error("column foo does not exist"))).toBe(
      "column foo does not exist",
    );
  });

  it("handles empty and non-Error inputs", () => {
    expect(conveyanceLoadMessage(new Error(""))).toBe("Couldn't load conveyance — retry.");
    expect(conveyanceLoadMessage(null)).toBe("Couldn't load conveyance — retry.");
    expect(conveyanceLoadMessage("plain string failure")).toBe("plain string failure");
  });
});
