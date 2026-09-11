import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const SQL_PATH = "supabase/migrations/20260912000000_ticket_verifications.sql";
describe("verification migration exists", () => {
  it("creates both tables with RLS and unique ticket", () => {
    const sql = readFileSync(SQL_PATH, "utf8");
    expect(sql).toContain("CREATE TABLE public.ticket_customer_verifications");
    expect(sql).toContain("CREATE TABLE public.ticket_equipment_verifications");
    expect(sql).toContain("ticket_id uuid NOT NULL UNIQUE");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("photo_lat");
  });
  it("creates RLS policies for both tables", () => {
    const sql = readFileSync("supabase/migrations/20260912000001_ticket_verifications_policies.sql", "utf8");
    expect(sql).toContain("CREATE POLICY");
    expect(sql).toContain("ticket_customer_verifications");
    expect(sql).toContain("ticket_equipment_verifications");
    expect(sql).toContain("TO authenticated");
  });
});
