import { describe, it, expect } from "vitest";
import {
  boolYesNo,
  buildFsrPrintModel,
  displayOrDash,
  formatDurationMin,
  formatINR,
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
  it('renders booleans as "Yes"/"No" and unknown as a dash', () => {
    // Catches: raw true/false leaking into the printed Yes/No boxes.
    // Unknown must NEVER pose as "No" on a customer-facing report.
    expect(boolYesNo(true)).toBe("Yes");
    expect(boolYesNo(false)).toBe("No");
    expect(boolYesNo(null)).toBe("—");
    expect(boolYesNo(undefined)).toBe("—");
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

describe("formatINR", () => {
  it('formats 12500 as "₹ 12,500" (en-IN grouping)', () => {
    // Catches: parts charges printing raw (12500) instead of grouped INR.
    expect(formatINR(12500)).toBe("₹ 12,500");
    expect(formatINR(1500)).toBe("₹ 1,500");
    expect(formatINR(0)).toBe("₹ 0");
  });

  it('renders null/undefined/non-finite as "—"', () => {
    // Catches: missing charges printing "₹ 0" or "NaN" instead of a dash.
    expect(formatINR(null)).toBe("—");
    expect(formatINR(undefined)).toBe("—");
    expect(formatINR(NaN)).toBe("—");
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
  // NOTE: inputs are UTC ISO strings; display expectations below are IST
  // (+5:30) per src/lib/time.ts — screen and paper share one wall-clock.
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
    created_at: "2026-09-13T10:00:00Z",
    preferred_visit_datetime: "2026-09-14T16:30:00Z",
    closed_at: "2026-09-15T12:00:00Z",
    oem_call: true,
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
    expect(m.header.formalReportNo).toBe("ABCDEFGH");
    expect(m.header.engineerName).toBe("Ravi Kumar");
    expect(m.customer.name).toBe("Acme Ltd");
    expect(m.customer.addressLines).toEqual(["Tower B, Sector 62", "Gurugram, Haryana, India"]);
    expect(m.customer.gstin).toBe("06ABCDE1234F1Z5");
    expect(m.product.model).toBe("3KVA UPS");
    expect(m.product.upsSerial).toBe("SN123");
    expect(Object.keys(m.product)).not.toContain("batteryPack");
    expect(m.product.oemCall).toBe("Yes");
    expect(m.product.statusLabel).toBe("Billable");
    expect(m.product.typeOfCall).toBe("PM");
    expect(m.product.callType).toBe("PM Call");
    expect(m.problem.reported).toBe("UPS beeping");
    expect(m.problem.reason).toBe("PM Call — Routine PM done");
    expect(m.timing.onSite).toBe("1h 30m");
    expect(m.timing.preferredVisit).toBe("14/09/2026 22:00");
    expect(m.lifecycle).toEqual({
      createdAt: "13/09/2026 15:30",
      preferredVisit: "14/09/2026 22:00",
      closedAt: "15/09/2026 17:30",
    });
    expect(m.observation.mainsLn).toBe("230");
    expect(m.observation.mainsNe).toBe("2.1");
    expect(m.load.ac).toBe("Yes");
    expect(m.load.dg).toBe("No");
    expect(m.load.location).toBe("Computer Room");
    expect(m.load.pcs).toEqual([{ size: "21.5", qty: "4" }]);
    expect(m.power.failures).toBe("3");
    expect(m.power.dgSet).toBe("Yes");
    expect(m.battery.make).toBe("EXIDE");
    expect(m.battery.voltage).toBe("—");
    expect(m.battery.ah).toBe("42");
    expect(m.battery.chargingStatus).toBeUndefined();
    expect(m.battery.dischargingStatus).toBeUndefined();
    expect(m.battery.chargingGrid).toEqual([["12.6", "12.5", "—", "12.7"], ["12.4"]]);
    expect(m.parts).toEqual([
      { n: 1, item: "PCB", oldSr: "OLD1", newSr: "NEW1", charges: "₹ 1,500", qty: "1" },
    ]);
    expect(m.feedback.status).toBe("Complete");
    expect(m.feedback.rating).toBe("8");
    expect(m.feedback.fseFeedback).toBe("—");
    expect(m.feedback.customerFeedback).toBe("—");
    expect(m.feedback.verdict).toBe("—");
    expect(m.signatures.fseName).toBe("Ravi Kumar");
    expect(m.signatures.fsePhone).toBe("9876543210");
    expect(m.signatures.engineerSignaturePath).toBeNull();
  });

  it("never throws on sparse input and falls back to dashes/empties", () => {
    // Catches: print crashes on draft/sparse FSR rows (nulls, empty arrays).
    const m = buildFsrPrintModel({ fsr: {}, ticket: {}, customer: null, visits: null });
    expect(m.header.caseId).toBe("—");
    expect(m.header.reportNo).toBe("—");
    expect(m.header.formalReportNo).toBe("—");
    expect(m.customer.addressLines).toEqual([]);
    expect(m.customer.phones).toEqual([]);
    expect(m.customer.gstin).toBe("—");
    expect(m.product.typeOfCall).toBe("");
    expect(m.product.oemCall).toBe("—");
    expect(m.timing.onSite).toBe("—");
    expect(m.timing.preferredVisit).toBe("—");
    expect(m.timing.blanks).toBe(true);
    expect(m.lifecycle).toEqual({ createdAt: "—", preferredVisit: "—", closedAt: "—" });
    expect(m.observation.mainsLn).toBe("—");
    expect(m.battery.voltage).toBe("—");
    expect(m.battery.ah).toBe("—");
    expect(m.battery.chargingGrid).toEqual([]);
    expect(m.battery.dischargingGrid).toEqual([]);
    expect(m.battery.chargingStatus).toBeUndefined();
    expect(m.battery.dischargingStatus).toBeUndefined();
    expect(m.parts).toEqual([]);
    expect(m.feedback.status).toBe("Incomplete");
    expect(m.feedback.rating).toBe("—");
    expect(m.feedback.fseFeedback).toBe("—");
    expect(m.feedback.customerFeedback).toBe("—");
    expect(m.feedback.verdict).toBe("—");
    expect(m.signatures.engineerSignaturePath).toBeNull();
  });

  it("ignores frontIndication keys — the removed Front Indication grid never prints", () => {
    // Catches: the deleted Front Indication grid leaking back into the model.
    const withFront = {
      fsr: {
        frontIndication: [{ led: "MAINS", status: "ON" }],
        front_indication: "Mains ON, UPS ON",
      },
      ticket: {},
      customer: null,
      visits: null,
    } as unknown as FsrPrintInput;
    const m = buildFsrPrintModel(withFront);
    expect(JSON.stringify(m)).not.toContain("front");
    expect(JSON.stringify(m)).not.toContain("Front Indication");
  });

  it("never emits front/frontIndication/batteryPack keys anywhere in the model", () => {
    // Catches: removed dead fields resurfacing under any key or nesting.
    const m = buildFsrPrintModel(fullInput);
    const json = JSON.stringify(m);
    expect(json).not.toContain("frontIndication");
    expect(json).not.toContain("batteryPack");
    expect(json).not.toContain("front");
  });

  it("passes customer gst through as gstin, dashes when missing", () => {
    // Catches: GSTIN row going blank instead of showing the "—" placeholder.
    expect(buildFsrPrintModel(fullInput).customer.gstin).toBe("06ABCDE1234F1Z5");
    const noGst = buildFsrPrintModel({
      fsr: {},
      ticket: {},
      customer: { company: "Acme Ltd" },
      visits: null,
    });
    expect(noGst.customer.gstin).toBe("—");
  });

  it("maps oem_call to Yes/No/— (unknown never poses as No)", () => {
    // Catches: a missing oem_call printing "No" on a customer-facing report.
    expect(buildFsrPrintModel(fullInput).product.oemCall).toBe("Yes");
    const no = buildFsrPrintModel({
      fsr: {},
      ticket: { oem_call: false },
      customer: null,
      visits: null,
    });
    expect(no.product.oemCall).toBe("No");
    const missing = buildFsrPrintModel({ fsr: {}, ticket: {}, customer: null, visits: null });
    expect(missing.product.oemCall).toBe("—");
  });

  it("formats timing.preferredVisit as DD/MM/YYYY HH:mm, dashes when missing", () => {
    // Catches: the Preferred Visit row rendering raw ISO or crashing.
    expect(buildFsrPrintModel(fullInput).timing.preferredVisit).toBe("14/09/2026 22:00");
    const missing = buildFsrPrintModel({ fsr: {}, ticket: {}, customer: null, visits: null });
    expect(missing.timing.preferredVisit).toBe("—");
  });

  it("builds lifecycle dates from the ticket, dashes per missing timestamp", () => {
    // Catches: lifecycle row mixing up created/preferred/closed sources.
    const m = buildFsrPrintModel(fullInput);
    expect(m.lifecycle.createdAt).toBe("13/09/2026 15:30");
    expect(m.lifecycle.preferredVisit).toBe("14/09/2026 22:00");
    expect(m.lifecycle.closedAt).toBe("15/09/2026 17:30");
    const partial = buildFsrPrintModel({
      fsr: {},
      ticket: { closed_at: "2026-09-15T12:00:00Z" },
      customer: null,
      visits: null,
    });
    expect(partial.lifecycle.createdAt).toBe("—");
    expect(partial.lifecycle.preferredVisit).toBe("—");
    expect(partial.lifecycle.closedAt).toBe("15/09/2026 17:30");
  });

  it("uses formal_report_no when present, else falls back to the id slice", () => {
    // Catches: future formal numbering being ignored once the column exists.
    const explicit = buildFsrPrintModel({
      fsr: { id: "abcdefgh-1234-5678-90ab-cdef12345678", formal_report_no: "FSR-2026-000042" },
      ticket: {},
      customer: null,
      visits: null,
    });
    expect(explicit.header.formalReportNo).toBe("FSR-2026-000042");
    expect(explicit.header.reportNo).toBe("ABCDEFGH");
    expect(buildFsrPrintModel(fullInput).header.formalReportNo).toBe("ABCDEFGH");
  });

  it("defaults verdict and feedback texts to dashes (verdict never derives from status)", () => {
    // Catches: a fabricated verdict leaking in from ticket.status or blanks.
    const m = buildFsrPrintModel(fullInput);
    expect(m.feedback.verdict).toBe("—");
    expect(m.feedback.fseFeedback).toBe("—");
    expect(m.feedback.customerFeedback).toBe("—");
    const withText = buildFsrPrintModel({
      fsr: { fse_feedback: "Bank healthy", customer_feedback: "Satisfied", verdict: "Healthy" },
      ticket: { status: "Closed" },
      customer: null,
      visits: null,
    });
    expect(withText.feedback.fseFeedback).toBe("Bank healthy");
    expect(withText.feedback.customerFeedback).toBe("Satisfied");
    expect(withText.feedback.verdict).toBe("Healthy");
  });

  it("prints the raw ticket call type (header/panel), dashes when missing", () => {
    // Catches: header "Call Type" rendering the PM/Installation enum instead —
    // every Warranty/AMC call printed "—".
    expect(buildFsrPrintModel(fullInput).product.callType).toBe("PM Call");
    const warranty = buildFsrPrintModel({
      fsr: {},
      ticket: { call_type: "Warranty" },
      customer: null,
      visits: null,
    });
    expect(warranty.product.callType).toBe("Warranty");
    const missing = buildFsrPrintModel({ fsr: {}, ticket: {}, customer: null, visits: null });
    expect(missing.product.callType).toBe("—");
  });

  it("drops city/state parts already embedded in the street line", () => {
    // Catches: "…Haryana - 122011, Gurugram, Haryana" duplication on the report.
    const m = buildFsrPrintModel({
      fsr: {},
      ticket: {},
      customer: {
        billing_address: "WDWFEFWGRG, Tower B, 9th Floor, Sector 62, Gurugram, Haryana - 122011",
        city: "Gurugram",
        state: "Haryana",
      },
      visits: null,
    });
    expect(m.customer.addressLines).toEqual([
      "WDWFEFWGRG, Tower B, 9th Floor, Sector 62, Gurugram, Haryana - 122011",
    ]);
  });

  it("prints short report ids in full, slices only long UUIDs", () => {
    // Catches: "SMPL-FSR-0001" printing as the broken fragment "SMPL-FSR".
    const short = buildFsrPrintModel({
      fsr: { id: "SMPL-FSR-0001" },
      ticket: {},
      customer: null,
      visits: null,
    });
    expect(short.header.reportNo).toBe("SMPL-FSR-0001");
    expect(short.header.formalReportNo).toBe("SMPL-FSR-0001");
  });

  it("parses battery voltage from bank text, dashes when unparseable", () => {
    // Catches: "12V 100Ah" printing as a single blob instead of split fields.
    const parsed = buildFsrPrintModel({
      fsr: { battery_bank_ah: "12V 100Ah" },
      ticket: {},
      customer: null,
      visits: null,
    });
    expect(parsed.battery.voltage).toBe("12V");
    expect(parsed.battery.ah).toBe("100Ah");
    const legacy = buildFsrPrintModel({
      fsr: { battery_bank_ah: "42" },
      ticket: {},
      customer: null,
      visits: null,
    });
    expect(legacy.battery.voltage).toBe("—");
    expect(legacy.battery.ah).toBe("42");
  });
});
