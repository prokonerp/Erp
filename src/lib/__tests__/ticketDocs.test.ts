import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTicketDcPrefill,
  buildTicketGrnPrefill,
  stageableTicketLines,
  stageTicketDcPrefill,
  stageTicketGrnPrefill,
} from "@/lib/ticketDocs";
import { GRN_CUSTOMER_PREFILL_KEY } from "@/lib/generalDc";
import type { PartLine } from "@/lib/tickets";

const input = { ticketId: "t-1", caseId: "SR-101", customerId: "c-1" };

const line = (over: Partial<PartLine> = {}): PartLine => ({
  name: "PCB",
  qty: "1",
  ...over,
});

// sessionStorage does not exist in the node test env — stub an in-memory one.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal(
    "sessionStorage",
    {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    } as unknown as Storage,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildTicketGrnPrefill", () => {
  it("builds the customer-GRN header GrnForm consumes", () => {
    const payload = buildTicketGrnPrefill(input, []);
    expect(payload).toMatchObject({
      source: "ticket",
      ticket_id: "t-1",
      customer_id: "c-1",
      reference_no: "Ticket SR-101",
      source_doc_type: "Field Service Report",
      source_doc_no: "Ticket SR-101",
      ticket_no: "SR-101",
      internal_remarks: "Defective parts received from customer against ticket SR-101",
      items: [],
    });
  });

  it("maps a serial line to one qty-1 row with serial_no + serials, condition Defective", () => {
    const payload = buildTicketGrnPrefill(input, [
      line({ name: "PCB", qty: "5", model_no: "M-100", serial: "SN1", remarks: "burnt" }),
    ]);
    expect(payload.items).toEqual([
      {
        part_no: "M-100",
        part_name: "PCB",
        description: "",
        uom: "Nos",
        batch_no: "",
        model_no: "M-100",
        condition: "Defective",
        remarks: "burnt",
        serial_no: "SN1",
        serials: ["SN1"],
        qty_received: "1",
        qty_accepted: "1",
        qty_rejected: "0",
      },
    ]);
  });

  it("maps a non-serial line to one row carrying the floored line qty", () => {
    const payload = buildTicketGrnPrefill(input, [line({ qty: "2.7" })]);
    expect(payload.items[0]).toMatchObject({
      serial_no: "",
      qty_received: "2",
      qty_accepted: "2",
      qty_rejected: "0",
    });
    expect(payload.items[0]).not.toHaveProperty("serials");
  });

  it("normalizes bad qty to 1 (zero, negative, blank, non-numeric)", () => {
    for (const qty of ["0", "-3", "", "  ", "abc"]) {
      const payload = buildTicketGrnPrefill(input, [line({ qty, serial: "" })]);
      expect(payload.items[0].qty_received).toBe("1");
      expect(payload.items[0].qty_accepted).toBe("1");
    }
  });

  it("falls back to name for part_no when model_no is blank, remarks default to empty", () => {
    const payload = buildTicketGrnPrefill(input, [line({ model_no: "  " })]);
    expect(payload.items[0].part_no).toBe("PCB");
    expect(payload.items[0].model_no).toBeUndefined();
    expect(payload.items[0].remarks).toBe("");
  });

  it("skips blank-name lines", () => {
    const payload = buildTicketGrnPrefill(input, [
      line({ name: "  " }),
      line({ name: "Fan", qty: "2" }),
    ]);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].part_name).toBe("Fan");
  });

  it("carries the assigned engineer (FK + name) into the GRN payload", () => {
    const payload = buildTicketGrnPrefill(
      { ...input, assignedEmployeeId: "emp-1", assignedEngineerName: "Asha" },
      [],
    );
    expect(payload.assigned_employee_id).toBe("emp-1");
    expect(payload.assigned_engineer_name).toBe("Asha");
  });

  it("defaults engineer keys to null when the ticket carries no engineer", () => {
    const payload = buildTicketGrnPrefill(input, []);
    expect(payload.assigned_employee_id).toBeNull();
    expect(payload.assigned_engineer_name).toBeNull();
  });
});

describe("buildTicketDcPrefill", () => {
  it("builds the customer-DC header ChallanForm consumes", () => {
    const payload = buildTicketDcPrefill(input, []);
    expect(payload).toMatchObject({
      source: "ticket",
      ticket_id: "t-1",
      customer_id: "c-1",
      reference_no: "Ticket SR-101",
      internal_remarks: "Good parts issued to customer against ticket SR-101",
      items: [],
    });
  });

  it("maps a serial line to one qty-1 row using the emptyItem keys", () => {
    const payload = buildTicketDcPrefill(input, [
      line({ name: "PCB", qty: "5", model_no: "M-100", serial: "NEW1" }),
    ]);
    expect(payload.items).toEqual([
      {
        part_no: "M-100",
        part_name: "PCB",
        description: "",
        uom: "Nos",
        qty: "1",
        model_no: "M-100",
        serial_no: "NEW1",
      },
    ]);
  });

  it("maps a non-serial line carrying the floored line qty, with no remarks key", () => {
    const payload = buildTicketDcPrefill(input, [
      line({ name: "Fan", qty: "3", remarks: "Challan: CH5" }),
    ]);
    expect(payload.items).toEqual([
      {
        part_no: "Fan",
        part_name: "Fan",
        description: "",
        uom: "Nos",
        qty: "3",
        model_no: "",
        serial_no: "",
      },
    ]);
    expect(payload.items[0]).not.toHaveProperty("remarks");
  });

  it("normalizes bad qty to 1 and skips blank-name lines", () => {
    const payload = buildTicketDcPrefill(input, [
      line({ name: "  " }),
      line({ name: "Fan", qty: "abc" }),
    ]);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].qty).toBe("1");
  });

  it("carries the assigned engineer (FK + name) into the DC payload", () => {
    const payload = buildTicketDcPrefill(
      { ...input, assignedEmployeeId: "emp-1", assignedEngineerName: "Asha" },
      [],
    );
    expect(payload.assigned_employee_id).toBe("emp-1");
    expect(payload.assigned_engineer_name).toBe("Asha");
  });

  it("defaults engineer keys to null when the ticket carries no engineer", () => {
    const payload = buildTicketDcPrefill(input, []);
    expect(payload.assigned_employee_id).toBeNull();
    expect(payload.assigned_engineer_name).toBeNull();
  });
});

describe("stageableTicketLines", () => {
  it("passes through all-confirmed lines", () => {
    const lines = [
      line({ name: "A", source: "fsr", confirmed: true }),
      line({ name: "B", source: "fsr", confirmed: true }),
    ];
    const { included, excludedUnconfirmed } = stageableTicketLines(lines);
    expect(included).toEqual(lines);
    expect(excludedUnconfirmed).toBe(0);
  });

  it("excludes unconfirmed fsr lines and counts them", () => {
    const lines = [
      line({ name: "A", source: "fsr", confirmed: true }),
      line({ name: "B", source: "fsr", confirmed: false }),
      line({ name: "C", source: "fsr" }),
    ];
    const { included, excludedUnconfirmed } = stageableTicketLines(lines);
    expect(included).toHaveLength(1);
    expect(included[0].name).toBe("A");
    expect(excludedUnconfirmed).toBe(2);
  });

  it("always includes manual lines regardless of confirmed flag", () => {
    const lines = [
      line({ name: "M1", source: "manual" }),
      line({ name: "M2" }),
      line({ name: "O1", source: "oracle_exchange" }),
    ];
    const { included, excludedUnconfirmed } = stageableTicketLines(lines);
    expect(included).toHaveLength(3);
    expect(excludedUnconfirmed).toBe(0);
  });

  it("handles empty input", () => {
    expect(stageableTicketLines([])).toEqual({ included: [], excludedUnconfirmed: 0 });
  });
});

describe("stage helpers", () => {
  it("stageTicketGrnPrefill writes the built payload under the shared GRN customer key", () => {
    stageTicketGrnPrefill(input, [line({ serial: "SN1" })]);
    expect(GRN_CUSTOMER_PREFILL_KEY).toBe("grn:prefill:new-customer");
    const raw = store.get("grn:prefill:new-customer")!;
    expect(JSON.parse(raw)).toEqual(buildTicketGrnPrefill(input, [line({ serial: "SN1" })]));
  });

  it("stageTicketDcPrefill writes the built payload under challan:prefill:new-customer", () => {
    stageTicketDcPrefill(input, [line({ name: "Fan", qty: "2" })]);
    const raw = store.get("challan:prefill:new-customer")!;
    expect(JSON.parse(raw)).toEqual(buildTicketDcPrefill(input, [line({ name: "Fan", qty: "2" })]));
  });

  it("stage helpers noop when sessionStorage throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    } as unknown as Storage);
    expect(() => stageTicketGrnPrefill(input, [line()])).not.toThrow();
    expect(() => stageTicketDcPrefill(input, [line()])).not.toThrow();
  });
});
