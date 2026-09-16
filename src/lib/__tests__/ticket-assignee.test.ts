import { describe, it, expect } from "vitest";
import { assertTicketAssignee } from "@/lib/engineer-identity";
import type { SupabaseClient } from "@supabase/supabase-js";

type Emp = {
  id: string;
  name: string | null;
  auth_user_id?: string | null;
  email?: string | null;
  active?: boolean;
};

// Minimal chainable fake for the employees queries + rpc + GoTrue lookup.
function fakeAdmin(opts: { employees: Emp[]; isAdmin?: boolean; authEmail?: string | null }) {
  const chain = (rows: Emp[]) => {
    const state = {
      rows,
      select() {
        return state;
      },
      eq(k: string, v: unknown) {
        state.rows = state.rows.filter((r) => (r as Record<string, unknown>)[k] === v);
        return state;
      },
      limit(n: number) {
        state.rows = state.rows.slice(0, n);
        return state;
      },
      // Thenable so `await builder` resolves like postgrest-js { data, error }.
      then(
        resolve: (v: { data: Emp[]; error: null }) => void,
        _reject?: (e: unknown) => void,
      ) {
        resolve({ data: state.rows, error: null });
      },
      async maybeSingle() {
        if (state.rows.length > 1) return { data: null, error: { message: "duplicate" } };
        return { data: state.rows[0] ?? null, error: null };
      },
    };
    return state;
  };
  return {
    from: (t: string) => chain(t === "employees" ? [...opts.employees] : []),
    rpc: async () => ({ data: !!opts.isAdmin, error: null }),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: opts.authEmail ?? null } } }),
      },
    },
  } as unknown as SupabaseClient;
}

const asha = { id: "emp-asha", name: "Asha", auth_user_id: "uid-asha", email: "a@x.com", active: true };
const bala = { id: "emp-bala", name: "Bala", auth_user_id: "uid-bala", email: "b@x.com", active: true };

describe("assertTicketAssignee", () => {
  it("returns null for admins without needing an employee row", async () => {
    const admin = fakeAdmin({ employees: [], isAdmin: true });
    await expect(
      assertTicketAssignee(admin, {
        userId: "uid-admin",
        ticket: { assigned_employee_id: "emp-x", assigned_engineer_name: "X" },
        action: "finalize",
      }),
    ).resolves.toBeNull();
  });

  it("returns the caller on FK match", async () => {
    const admin = fakeAdmin({ employees: [asha, bala] });
    await expect(
      assertTicketAssignee(admin, {
        userId: "uid-asha",
        ticket: { assigned_employee_id: "emp-asha", assigned_engineer_name: "Someone Else" },
        action: "finalize",
      }),
    ).resolves.toMatchObject({ id: "emp-asha" });
  });

  it("returns the caller on unique name match (legacy rows)", async () => {
    const admin = fakeAdmin({ employees: [{ ...asha, auth_user_id: null }] });
    await expect(
      assertTicketAssignee(admin, {
        userId: "uid-stranger",
        emailHint: "a@x.com",
        ticket: { assigned_employee_id: null, assigned_engineer_name: "Asha" },
        action: "sync",
      }),
    ).resolves.toMatchObject({ id: "emp-asha" });
  });

  it("denies on duplicate names even when one matches", async () => {
    const asha2 = { ...asha, id: "emp-asha-2", auth_user_id: null, email: "a2@x.com" };
    const admin = fakeAdmin({ employees: [{ ...asha, auth_user_id: null }, asha2] });
    await expect(
      assertTicketAssignee(admin, {
        userId: "uid-stranger",
        emailHint: "a@x.com",
        ticket: { assigned_employee_id: null, assigned_engineer_name: "Asha" },
        action: "sync",
      }),
    ).rejects.toThrow(/assigned engineer may sync/);
  });

  it("denies engineers assigned to a different ticket", async () => {
    const admin = fakeAdmin({ employees: [asha, bala] });
    await expect(
      assertTicketAssignee(admin, {
        userId: "uid-bala",
        ticket: { assigned_employee_id: "emp-asha", assigned_engineer_name: "Asha" },
        action: "delete",
      }),
    ).rejects.toThrow(/assigned engineer may delete/);
  });

  it("denies unlinked logins", async () => {
    const admin = fakeAdmin({ employees: [asha] });
    await expect(
      assertTicketAssignee(admin, {
        userId: "uid-stranger",
        ticket: { assigned_employee_id: "emp-asha", assigned_engineer_name: "Asha" },
        action: "finalize",
      }),
    ).rejects.toThrow(/assigned engineer may finalize/);
  });

  it("denies ambiguous identity fail-loud", async () => {
    const dup = { ...asha, id: "emp-asha-2", auth_user_id: null };
    const admin = fakeAdmin({ employees: [{ ...asha, auth_user_id: null }, dup], authEmail: "a@x.com" });
    await expect(
      assertTicketAssignee(admin, {
        userId: "uid-stranger",
        ticket: { assigned_employee_id: "emp-asha", assigned_engineer_name: "Asha" },
        action: "finalize",
      }),
    ).rejects.toThrow(/multiple employee rows/);
  });
});
