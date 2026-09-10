import { describe, it, expect } from "vitest";
import { validateProvisionInput } from "@/lib/admin-users.functions";

const goodEmp = {
  id: "emp-1",
  name: "Rahul Kumar",
  email: "  Rahul@Test.Com  ",
  phone: "9876543210",
  active: true,
  auth_user_id: null,
};

const weakPw = "short";
const strongPw = "Str0ng!Pass";

describe("validateProvisionInput", () => {
  it("returns normalized email and employee data for valid input", () => {
    const result = validateProvisionInput(goodEmp, strongPw);
    expect(result).toEqual({
      email: "rahul@test.com",
      name: "Rahul Kumar",
      phone: "9876543210",
    });
  });

  it("throws on weak password (validateStrong message)", () => {
    expect(() => validateProvisionInput(goodEmp, weakPw)).toThrow("at least 8 characters");
  });

  it("throws if employee is inactive", () => {
    const inactive = { ...goodEmp, active: false };
    expect(() => validateProvisionInput(inactive, strongPw)).toThrow(
      "Only active employees can receive portal logins",
    );
  });

  it("throws if employee has no email", () => {
    const noEmail = { ...goodEmp, email: null };
    expect(() => validateProvisionInput(noEmail, strongPw)).toThrow(
      "Employee needs an email address first",
    );
  });

  it("throws if employee already has an auth_user_id", () => {
    const alreadyLinked = { ...goodEmp, auth_user_id: "auth-uid-123" };
    expect(() => validateProvisionInput(alreadyLinked, strongPw)).toThrow(
      "already has a portal login",
    );
  });

  it("rejects password missing uppercase", () => {
    expect(() => validateProvisionInput(goodEmp, "no1upper!pass")).toThrow("uppercase letter");
  });

  it("rejects password missing lowercase", () => {
    expect(() => validateProvisionInput(goodEmp, "NO1UPPER!PASS")).toThrow("lowercase letter");
  });

  it("rejects password missing number", () => {
    expect(() => validateProvisionInput(goodEmp, "NoNumber!Pass")).toThrow("contain a number");
  });

  it("rejects password missing special character", () => {
    expect(() => validateProvisionInput(goodEmp, "NoSpecial1Pass")).toThrow("special character");
  });

  it("trims and lowercases email whitespace", () => {
    const emp = { ...goodEmp, email: "  Test@Email.COM  " };
    const result = validateProvisionInput(emp, strongPw);
    expect(result.email).toBe("test@email.com");
  });

  it("allows null phone", () => {
    const emp = { ...goodEmp, phone: null };
    const result = validateProvisionInput(emp, strongPw);
    expect(result.phone).toBeNull();
  });
});
