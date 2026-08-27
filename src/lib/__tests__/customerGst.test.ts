import { describe, it, expect } from "vitest";
import {
  buildCustomerPayload,
  emptyCustomerForm,
  validateCustomerForm,
  type CustomerFormState,
} from "@/components/CustomerForm";

function form(overrides: Partial<CustomerFormState>): CustomerFormState {
  return { ...emptyCustomerForm, ...overrides } as CustomerFormState;
}

describe("buildCustomerPayload - GSTIN for Individuals (M9)", () => {
  it("populates gst when an Individual is Regular with a valid GSTIN", () => {
    const f = form({
      customer_type: "Individual",
      first_name: "Ravi",
      last_name: "Sharma",
      phone: "9999999999",
      email: "ravi@example.com",
      gst: "29ABCDE1234F1Z5",
      gst_status: "Regular",
    });
    const payload = buildCustomerPayload(f);
    expect(payload.gst_status).toBe("Regular");
    expect(payload.gst).toBe("29ABCDE1234F1Z5");
  });

  it("populates gst when an Individual is Composition with a valid GSTIN", () => {
    const f = form({
      customer_type: "Individual",
      first_name: "Ravi",
      phone: "9999999999",
      email: "ravi@example.com",
      gst: "29ABCDE1234F1Z5",
      gst_status: "Composition",
    });
    expect(buildCustomerPayload(f).gst).toBe("29ABCDE1234F1Z5");
  });

  it("nulls gst for an Individual with Unregistered treatment", () => {
    const f = form({
      customer_type: "Individual",
      first_name: "Ravi",
      phone: "9999999999",
      email: "ravi@example.com",
      gst_status: "Unregistered",
    });
    expect(buildCustomerPayload(f).gst).toBeNull();
  });

  it("keeps the legacy URP placeholder for a Business with Unregistered treatment", () => {
    const f = form({
      customer_type: "Business",
      company: "Acme Pvt Ltd",
      phone: "9999999999",
      email: "a@acme.com",
      gst_status: "Unregistered",
    });
    expect(buildCustomerPayload(f).gst).toBe("URP");
  });

  it("fails validation when an Individual is Regular but leaves GST empty", () => {
    const f = form({
      customer_type: "Individual",
      first_name: "Ravi",
      phone: "9999999999",
      email: "ravi@example.com",
      gst_status: "Regular",
    });
    const err = validateCustomerForm(f);
    expect(err).not.toBeNull();
    expect(err?.tab).toBe("gst");
  });

  it("fails validation when an Individual is Composition but leaves GST empty", () => {
    const f = form({
      customer_type: "Individual",
      first_name: "Ravi",
      phone: "9999999999",
      email: "ravi@example.com",
      gst_status: "Composition",
    });
    expect(validateCustomerForm(f)).not.toBeNull();
  });

  it("fails validation when an Individual is Regular with a garbage GSTIN", () => {
    const f = form({
      customer_type: "Individual",
      first_name: "Ravi",
      phone: "9999999999",
      email: "ravi@example.com",
      gst: "BADGST",
      gst_status: "Regular",
    });
    expect(validateCustomerForm(f)).not.toBeNull();
  });

  it("fails validation when an Individual is Composition with a garbage GSTIN", () => {
    const f = form({
      customer_type: "Individual",
      first_name: "Ravi",
      phone: "9999999999",
      email: "ravi@example.com",
      gst: "BADGST",
      gst_status: "Composition",
    });
    expect(validateCustomerForm(f)).not.toBeNull();
  });

  it("passes validation when an Individual is Regular with a valid GSTIN", () => {
    const f = form({
      customer_type: "Individual",
      first_name: "Ravi",
      last_name: "Sharma",
      phone: "9999999999",
      email: "ravi@example.com",
      gst: "29ABCDE1234F1Z5",
      gst_status: "Regular",
    });
    expect(validateCustomerForm(f)).toBeNull();
  });

  it("clears a business GSTIN when switched to Individual (no stale leak)", () => {
    const business = form({
      customer_type: "Business",
      company: "Acme",
      phone: "9999999999",
      email: "a@acme.com",
      gst: "29ABCDE1234F1Z5",
      gst_status: "Regular",
    });
    // Simulate the type-change reset applied in the form handler.
    const switched: CustomerFormState = {
      ...business,
      customer_type: "Individual",
      gst: "",
      gst_status: "Unregistered",
    };
    expect(switched.gst).toBe("");
    expect(buildCustomerPayload(switched).gst).toBeNull();
  });

});
