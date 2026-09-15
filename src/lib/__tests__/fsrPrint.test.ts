import { describe, it, expect } from "vitest";
import {
  boolYesNo,
  buildFsrPrintModel,
  displayOrDash,
  formatDurationMin,
  mapCallStatus,
  readingsGrid,
  statusLabel,
  typeOfCall,
} from "@/lib/fsrPrint";
import type { FsrPrintInput } from "@/lib/fsrPrint";

describe("mapCallStatus", () => {
  it('maps "Closed" to "Complete"', () => {
    // Catches: printout feedback checkbox ticking "Complete" for closed tickets.
    expect(mapCallStatus("Closed")).toBe("Complete");
  });

  it('maps "Under Observation" to "Under Observation"', () => {
    // Catches: observation-state tickets printing the wrong feedback status.
    expect(mapCallStatus("Under Observation")).toBe("Under Observation");
  });

  it('maps any other status to "Incomplete"', () => {
    // Catches: open tickets (e.g. "In Progress") printing as complete.
    expect(mapCallStatus("In Progress")).toBe("Incomplete");
    expect(mapCallStatus(null)).toBe("Incomplete");
    expect(mapCallStatus(undefined)).toBe("Incomplete");
  });
});

describe("statusLabel", () => {
  it('maps "Warranty" to "Warranty"', () => {
    // Catches: warranty calls printing as billable/contract.
    expect(statusLabel("Warranty")).toBe("Warranty");
  });

  it('maps "AMC" to "Contract"', () => {
    // Catches: AMC calls printing under the wrong service-head label.
    expect(statusLabel("AMC")).toBe("Contract");
  });

  it('maps anything else to "Billable"', () => {
    // Catches: OOW/unknown call types escaping the billable bucket.
    expect(statusLabel("OOW")).toBe("Billable");
    expect(statusLabel(null)).toBe("Billable");
    expect(statusLabel(undefined)).toBe("Billable");
  });
});

describe("typeOfCall", () => {
  it('maps call types containing "PM" to "PM"', () => {
    // Catches: "PM Call" tickets missing the PM checkbox on the printout.
    expect(typeOfCall("PM Call")).toBe("PM");
  });

  it('maps call types containing "Installation" to "Installation"', () => {
    // Catches: installation calls missing the Installation checkbox.
    expect(typeOfCall("Installation")).toBe("Installation");
  });

  it('returns "" for other call types (view renders checkboxes + Other blank)', () => {
    // Catches: warranty/OOW calls wrongly pre-ticking PM or Installation.
    expect(typeOfCall("Warranty")).toBe("");
    expect(typeOfCall(null)).toBe("");
    expect(typeOfCall(undefined)).toBe("");
  });
});

describe("formatDurationMin", () => {
  it('formats 90 minutes as "1h 30m"', () => {
    // Catches: on-site duration rendering raw minutes instead of h/m parts.
    expect(formatDurationMin("2026-09-14T04:00:00.000Z", "2026-09-14T05:30:00.000Z")).toBe(
      "1h 30m",
    );
  });

  it('formats sub-hour spans as "45m"', () => {
    // Catches: short visits gaining a spurious "0h" prefix.
    expect(formatDurationMin("2026-09-14T04:00:00.000Z", "2026-09-14T04:45:00.000Z")).toBe("45m");
  });

  it('returns "—" when the end time is missing', () => {
    // Catches: ongoing visits (no departure yet) crashing or showing "NaN".
    expect(formatDurationMin("2026-09-14T04:00:00.000Z", null)).toBe("—");
  });

  it('returns "—" when the start time is missing', () => {
    // Catches: visits without an arrival stamp crashing the timing block.
    expect(formatDurationMin(null, "2026-09-14T05:30:00.000Z")).toBe("—");
    expect(formatDurationMin(undefined, undefined)).toBe("—");
  });
});

describe("displayOrDash", () => {
  it('renders null/undefined/blank as "—"', () => {
    // Catches: empty DB cells printing as blank instead of the "—" placeholder.
    expect(displayOrDash(null)).toBe("—");
    expect(displayOrDash(undefined)).toBe("—");
    expect(displayOrDash("")).toBe("—");
    expect(displayOrDash("   ")).toBe("—");
  });

  it('passes through 0 as "0" and keeps real values intact', () => {
    // Catches: zero readings/quantities being swallowed as empty.
    expect(displayOrDash(0)).toBe("0");
    expect(displayOrDash("x")).toBe("x");
    expect(displayOrDash(12.6)).toBe("12.6");
  });
});

describe("boolYesNo", () => {
  it('renders booleans as "Yes"/"No"', () => {
    // Catches: raw true/false leaking into the printed Yes/No boxes.
    expect(boolYesNo(true)).toBe("Yes");
    expect(boolYesNo(false)).toBe("No");
    expect(boolYesNo(null)).toBe("No");
    expect(boolYesNo(undefined)).toBe("No");
  });
});

describe("readingsGrid", () => {
  it("chunks 5 readings into rows of 4 + 1", () => {
    // Catches: battery voltage tables losing their 4-column layout.
    const grid = readingsGrid(
      [{ volts: 12.6 }, { volts: 12.5 }, { volts: 12.7 }, { volts: 12.6 }, { volts: 12.4 }],
      4,
    );
    expect(grid).toEqual([["12.6", "12.5", "12.7", "12.6"], ["12.4"]]);
  });

  it("returns [] for empty input", () => {
    // Catches: FSRs with no readings rendering a stray empty table row.
    expect(readingsGrid([])).toEqual([]);
    expect(readingsGrid(null)).toEqual([]);
    expect(readingsGrid(undefined)).toEqual([]);
  });

  it('renders null volts as "—"', () => {
    // Catches: missing cell readings printing as blank instead of "—".
    expect(readingsGrid([{ volts: null }, {}])).toEqual([["—", "—"]]);
  });
});

describe("rating", () => {
  it("prints the numeric rating, dashes when missing", () => {
    // Catches: the 1-10 rating going missing from the printed feedback section.
    const rated = buildFsrPrintModel({
      fsr: { rating: 8 },
      ticket: {},
      customer: null,
      visits: null,
    });
    expect(rated.feedback.rating).toBe("8");
    const sparse = buildFsrPrintModel({ fsr: {}, ticket: {}, customer: null, visits: null });
    expect(sparse.feedback.rating).toBe("—");
  });
});

const fullInput: FsrPrintInput = {
  fsr: {
    id: "abcdefgh-1234-5678-90ab-cdef12345678",
    ticket_id: "ticket-1",
    submitted_at: "2026-09-14T10:00:00.000Z",
    created_at: "2026-09-14T09:00:00.000Z",
    mains_voltage_ln: 230,
    mains_voltage_ne: 2.1,
    battery_bank_make: "EXIDE",
    battery_bank_ah: "42",
    battery_bank_qty: 16,
    charging_readings: [
      { volts: 12.6 },
      { volts: 12.5 },
      { volts: null },
      { volts: 12.7 },
      { volts: 12.4 },
    ],
    discharging_readings: [{ volts: 12.1 }],
    rating: 8,
    ac_provided: true,
    dg_provided: false,
    environment_duty: true,
    ups_location: "Computer Room",
    pc_details: [{ monitor_size_in: 21.5, qty: 4 }],
    printer_details: [{ rating_w: 500, qty: 1 }],
    scanner_details: [],
    power_failures_count: 3,
    power_failures_duration_min: 90,
    load_on_dg_percent: 60,
    dg_set: true,
    dg_set_capacity_kva: 15,
    amf_panel: true,
    operate_non_business_hours: false,
    operate_holidays: true,
    part_replacements: [
      { item: "PCB", old_sr_no: "OLD1", new_sr_no: "NEW1", charges: 1500, qty: 1 },
    ],
    engineer_name: "Ravi Kumar",
    engineer_phone: "9876543210",
  },
  ticket: {
    case_id: "CASE-001",
    call_type: "PM Call",
    product: "3KVA UPS",
    serial_no: "SN123",
    customer_name: "Acme Ltd",
    complaint: "UPS beeping",
    status: "Closed",
    remarks: "Routine PM done",
    assigned_engineer_name: "Ravi Kumar",
    assigned_engineer_phone: "9876543210",
  },
  customer: {
    company: "Acme Ltd",
    contact_name: "John",
    phone: "9999999999",
    email: "a@b.com",
    billing_address: "Tower B, Sector 62",
    city: "Gurugram",
    state: "Haryana",
    country: "India",
    gst: "06ABCDE1234F1Z5",
  },
  visits: {
    arrival_at: "2026-09-14T04:00:00.000Z",
    departure_at: "2026-09-14T05:30:00.000Z",
  },
};

describe("buildFsrPrintModel", () => {
  it("builds every print section from a full sample", () => {
    // Catches: section wiring regressions (header/customer/product/problem/
    // timing/observation/load/power/battery/parts/feedback/signatures).
    const m = buildFsrPrintModel(fullInput);
    expect(m.header.caseId).toBe("CASE-001");
    expect(m.header.reportNo).toBe("ABCDEFGH");
    expect(m.header.engineerName).toBe("Ravi Kumar");
    expect(m.customer.name).toBe("Acme Ltd");
    expect(m.customer.addressLines).toEqual(["Tower B, Sector 62", "Gurugram, Haryana, India"]);
    expect(m.product.model).toBe("3KVA UPS");
    expect(m.product.upsSerial).toBe("SN123");
    expect(m.product.batteryPack).toBe("—");
    expect(m.product.statusLabel).toBe("Billable");
    expect(m.product.typeOfCall).toBe("PM");
    expect(m.problem.reported).toBe("UPS beeping");
    expect(m.problem.reason).toBe("PM Call — Routine PM done");
    expect(m.timing.onSite).toBe("1h 30m");
    expect(m.observation.mainsLn).toBe("230");
    expect(m.observation.mainsNe).toBe("2.1");
    expect(m.load.ac).toBe("Yes");
    expect(m.load.dg).toBe("No");
    expect(m.load.location).toBe("Computer Room");
    expect(m.load.pcs).toEqual([{ size: "21.5", qty: "4" }]);
    expect(m.power.failures).toBe("3");
    expect(m.power.dgSet).toBe("Yes");
    expect(m.battery.make).toBe("EXIDE");
    expect(m.battery.chargingGrid).toEqual([["12.6", "12.5", "—", "12.7"], ["12.4"]]);
    expect(m.parts).toEqual([
      { n: 1, item: "PCB", oldSr: "OLD1", newSr: "NEW1", charges: "1500", qty: "1" },
    ]);
    expect(m.feedback.status).toBe("Complete");
    expect(m.feedback.rating).toBe("8");
    expect(m.signatures.fseName).toBe("Ravi Kumar");
    expect(m.signatures.fsePhone).toBe("9876543210");
  });

  it("never throws on sparse input and falls back to dashes/empties", () => {
    // Catches: print crashes on draft/sparse FSR rows (nulls, empty arrays).
    const m = buildFsrPrintModel({ fsr: {}, ticket: {}, customer: null, visits: null });
    expect(m.header.caseId).toBe("—");
    expect(m.header.reportNo).toBe("—");
    expect(m.customer.addressLines).toEqual([]);
    expect(m.customer.phones).toEqual([]);
    expect(m.product.batteryPack).toBe("—");
    expect(m.product.typeOfCall).toBe("");
    expect(m.timing.onSite).toBe("—");
    expect(m.timing.blanks).toBe(true);
    expect(m.observation.mainsLn).toBe("—");
    expect(m.battery.chargingGrid).toEqual([]);
    expect(m.battery.dischargingGrid).toEqual([]);
    expect(m.parts).toEqual([]);
    expect(m.feedback.status).toBe("Incomplete");
    expect(m.feedback.rating).toBe("—");
  });
});
