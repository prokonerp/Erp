import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const SQL_PATH = "supabase/migrations/20260912000000_ticket_verifications.sql";
// Renamed from 20260912000001_... (duplicate version) — see migration header.
const POLICIES_PATH = "supabase/migrations/20260912000002_ticket_verifications_policies.sql";
describe("verification migration exists", () => {
  it("creates both tables with RLS and unique ticket", () => {
    const sql = readFileSync(SQL_PATH, "utf8");
    // IF NOT EXISTS — the file must be re-runnable (supabase db reset pass 2).
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ticket_customer_verifications");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ticket_equipment_verifications");
    expect(sql).toContain("ticket_id uuid NOT NULL UNIQUE");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("photo_lat");
  });
  it("is idempotent: tables and indexes use IF NOT EXISTS", () => {
    const sql = readFileSync(SQL_PATH, "utf8");
    expect(sql).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)public\./);
    expect(sql).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)idx_/);
  });
  it("creates RLS policies for both tables", () => {
    const sql = readFileSync(POLICIES_PATH, "utf8");
    expect(sql).toContain("CREATE POLICY");
    expect(sql).toContain("ticket_customer_verifications");
    expect(sql).toContain("ticket_equipment_verifications");
    expect(sql).toContain("TO authenticated");
  });
  it("is idempotent: policies are created only when missing", () => {
    const sql = readFileSync(POLICIES_PATH, "utf8");
    // Re-applying must never fail nor re-open the permissive era once the
    // hardened successor (20260916000003, same policy names) has run.
    expect(sql).toContain("IF NOT EXISTS (SELECT 1 FROM pg_policies");
  });
  it("has no duplicate migration versions", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
    const versions = files.map((f) => f.split("_")[0]);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
