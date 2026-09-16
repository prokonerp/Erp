import { describe, it, expect } from "vitest";
import { resolveEngineerIdentity } from "@/lib/engineer-identity";

const asha = { id: "emp-asha", name: "Asha" };
const bala = { id: "emp-bala", name: "Bala" };

describe("resolveEngineerIdentity", () => {
  it("prefers the exact auth_user_id match", () => {
    expect(resolveEngineerIdentity(asha, [bala])).toEqual({ status: "ok", employee: asha });
  });

  it("falls back to a unique email match", () => {
    expect(resolveEngineerIdentity(null, [asha])).toEqual({ status: "ok", employee: asha });
  });

  it("fails loud on duplicate email matches instead of picking row[0]", () => {
    expect(resolveEngineerIdentity(null, [asha, bala])).toEqual({
      status: "ambiguous",
      count: 2,
    });
  });

  it("reports not_linked when nothing matches", () => {
    expect(resolveEngineerIdentity(null, [])).toEqual({ status: "not_linked" });
  });

  it("ignores the email fallback once auth_user_id hits", () => {
    // Auth link wins even if the email row belongs to someone else.
    expect(resolveEngineerIdentity(asha, [bala])).toEqual({ status: "ok", employee: asha });
  });

  it("carries extra selected columns through untouched", () => {
    const full = { ...asha, phone: "999", photo_path: "p.jpg" };
    const res = resolveEngineerIdentity(full, []);
    expect(res.status).toBe("ok");
    if (res.status === "ok") expect(res.employee).toEqual(full);
  });
});
