// TDD (written FIRST, before src/lib/engineersAdmin.ts): real behavior
// assertions for the seven pure admin-payable helpers — no mocks, no
// Supabase, no DOM. Convention mirrors documentFlow.writers.test.ts
// (vitest `describe/it/expect`, plain object literals as inputs).

import { describe, it, expect } from "vitest";
import {
  rateInForce,
  payableForPeriod,
  perEngineerSummary,
  resolveAdjustment,
  kmFlags,
  docCompliance,
  buildAttentionItems,
  groupExpensesByType,
  dedupeWarnings,
  rosterNameMap,
  partitionOrphans,
  type AdminEngineer,
} from "@/lib/engineersAdmin";
import { PROFILE_DOC_TYPES } from "@/lib/engineer-conveyance";

// ── doc-type drift guard (B0.1) ────────────────────────────────────────
// docCompliance mirrors PROFILE_DOC_TYPES as a local const (the module file
// takes no value imports beyond @/lib/time). This test fails loudly if the
// two lists ever diverge, instead of silently mis-grading compliance.

describe("engineersAdmin/docTypes", () => {
  it("grades exactly the PROFILE_DOC_TYPES blocks", () => {
    const all = [...PROFILE_DOC_TYPES].map((t) => ({ name: t, path: `/docs/${t}.pdf` }));
    const { present, missing } = docCompliance(all);
    expect(missing).toEqual([]);
    expect([...present].sort()).toEqual([...PROFILE_DOC_TYPES].sort());
    const { present: nonePresent, missing: allMissing } = docCompliance([]);
    expect(nonePresent).toEqual([]);
    expect([...allMissing].sort()).toEqual([...PROFILE_DOC_TYPES].sort());
  });
});

// ── rateInForce (6) ────────────────────────────────────────────────────

describe("engineersAdmin/rateInForce", () => {
  const rates = [
    { employee_id: "e1", rate_per_km: 5, effective_from: "2026-08-01" },
    { employee_id: "e1", rate_per_km: 7, effective_from: "2026-09-01" },
    { employee_id: "e2", rate_per_km: 9, effective_from: "2026-01-01" },
  ];

  it("picks the latest effective_from on or before the date", () => {
    expect(rateInForce(rates, "e1", "2026-09-10")).toBe(7);
    expect(rateInForce(rates, "e1", "2026-08-15")).toBe(5);
  });

  it("counts an exact effective_from match", () => {
    expect(rateInForce(rates, "e1", "2026-09-01")).toBe(7);
  });

  it("returns null when only future rates exist", () => {
    expect(rateInForce(rates, "e1", "2026-07-31")).toBeNull();
  });

  it("ignores other employees' rates", () => {
    expect(rateInForce(rates, "e2", "2026-09-10")).toBe(9);
    expect(rateInForce(rates, "nobody", "2026-09-10")).toBeNull();
  });

  it("returns null on bad input instead of throwing", () => {
    expect(rateInForce([], "e1", "2026-09-10")).toBeNull();
    expect(rateInForce(null, "e1", "2026-09-10")).toBeNull();
    expect(rateInForce(rates, "", "2026-09-10")).toBeNull();
    expect(rateInForce(rates, "e1", "not-a-date")).toBeNull();
    expect(rateInForce(rates, "e1", null)).toBeNull();
  });

  it("coerces string rates and skips invalid rows", () => {
    const mixed = [
      { employee_id: "e1", rate_per_km: "6.5", effective_from: "2026-09-01" },
      { employee_id: "e1", rate_per_km: -3, effective_from: "2026-09-05" },
      { employee_id: "e1", rate_per_km: "junk", effective_from: "2026-09-06" },
    ];
    expect(rateInForce(mixed, "e1", "2026-09-10")).toBe(6.5);
  });
});

// ── payableForPeriod (5) ───────────────────────────────────────────────

describe("engineersAdmin/payableForPeriod", () => {
  const rates = [{ employee_id: "e1", rate_per_km: 10, effective_from: "2026-09-01" }];

  it("computes km×rate per day and totals", () => {
    const out = payableForPeriod({
      employeeId: "e1",
      rates,
      days: [
        { log_date: "2026-09-02", morning_odometer: 100, evening_odometer: 150 },
        { log_date: "2026-09-03", morning_odometer: 150, evening_odometer: 170 },
      ],
      expenses: [
        { expense_date: "2026-09-02", charge_type: "Toll", amount: 50, receipt_path: "r1" },
      ],
    });
    expect(out.perDay).toEqual([
      { date: "2026-09-02", km: 50, rate: 10, amount: 500 },
      { date: "2026-09-03", km: 20, rate: 10, amount: 200 },
    ]);
    expect(out.amountTotal).toBe(700);
    expect(out.flatTotal).toBe(50);
    expect(out.grandTotal).toBe(750);
  });

  it("flags days with no rate: amount 0 and rate null", () => {
    const out = payableForPeriod({
      employeeId: "e1",
      rates: [],
      days: [{ log_date: "2026-09-02", morning_odometer: 100, evening_odometer: 120 }],
      expenses: [],
    });
    expect(out.perDay).toEqual([{ date: "2026-09-02", km: 20, rate: null, amount: 0 }]);
    expect(out.grandTotal).toBe(0);
  });

  it("treats unreadable days as 0 km and still sums flat expenses", () => {
    const out = payableForPeriod({
      employeeId: "e1",
      rates,
      days: [{ log_date: "2026-09-02", morning_odometer: 100, evening_odometer: null }],
      expenses: [
        { expense_date: "2026-09-02", charge_type: "Parking", amount: 30, receipt_path: "r1" },
        { expense_date: "2026-09-03", charge_type: "Toll", amount: "20", receipt_path: "r2" },
      ],
    });
    expect(out.perDay[0].km).toBe(0);
    expect(out.perDay[0].amount).toBe(0);
    expect(out.flatTotal).toBe(50);
  });

  it("pays 0 km / 0 amount for odometer-reversal days (no wrap math)", () => {
    const out = payableForPeriod({
      employeeId: "e1",
      rates,
      days: [{ log_date: "2026-09-02", morning_odometer: 200, evening_odometer: 150 }],
      expenses: [],
    });
    expect(out.perDay).toEqual([{ date: "2026-09-02", km: 0, rate: 10, amount: 0 }]);
    expect(out.grandTotal).toBe(0);
  });

  it("returns zeros for empty input without throwing", () => {
    const out = payableForPeriod({ employeeId: "e1", rates: null, days: null, expenses: null });
    expect(out).toEqual({ perDay: [], flatTotal: 0, amountTotal: 0, grandTotal: 0 });
  });

  it("sorts perDay by date ascending", () => {
    const out = payableForPeriod({
      employeeId: "e1",
      rates,
      days: [
        { log_date: "2026-09-05", morning_odometer: 0, evening_odometer: 10 },
        { log_date: "2026-09-01", morning_odometer: 0, evening_odometer: 5 },
      ],
      expenses: [],
    });
    expect(out.perDay.map((d) => d.date)).toEqual(["2026-09-01", "2026-09-05"]);
  });

  it("clamps per-row negative expense amounts to 0 in flatTotal", () => {
    const out = payableForPeriod({
      employeeId: "e1",
      rates,
      days: [],
      expenses: [
        { expense_date: "2026-09-02", charge_type: "Toll", amount: -50, receipt_path: "r1" },
        { expense_date: "2026-09-03", charge_type: "Toll", amount: "-20", receipt_path: "r2" },
        { expense_date: "2026-09-04", charge_type: "Parking", amount: 30, receipt_path: "r3" },
      ],
    });
    expect(out.flatTotal).toBe(30);
    expect(out.grandTotal).toBe(30);
  });
});

// ── resolveAdjustment (4) ──────────────────────────────────────────────

describe("engineersAdmin/resolveAdjustment", () => {
  it("override wins with a non-blank reason", () => {
    expect(resolveAdjustment(100, 120, "Rate corrected")).toEqual({ value: 120, overridden: true });
  });

  it("blank reason keeps current", () => {
    expect(resolveAdjustment(100, 120, "")).toEqual({ value: 100, overridden: false });
    expect(resolveAdjustment(100, 120, null)).toEqual({ value: 100, overridden: false });
  });

  it("whitespace-only reason keeps current", () => {
    expect(resolveAdjustment(100, 120, "   ")).toEqual({ value: 100, overridden: false });
  });

  it("missing override keeps current; null current stays null", () => {
    expect(resolveAdjustment(100, null, "reason")).toEqual({ value: 100, overridden: false });
    expect(resolveAdjustment(null, null, "reason")).toEqual({ value: null, overridden: false });
  });
});

// ── kmFlags (6) ────────────────────────────────────────────────────────

describe("engineersAdmin/kmFlags", () => {
  it("returns [] for a normal day", () => {
    expect(kmFlags(100, 150)).toEqual([]);
  });

  it("flags evening below morning", () => {
    expect(kmFlags(150, 100)).toEqual(["negative-km"]);
  });

  it("flags a missing evening reading", () => {
    expect(kmFlags(100, null)).toEqual(["missing-reading"]);
    expect(kmFlags(100, undefined)).toEqual(["missing-reading"]);
  });

  it("flags a missing morning reading", () => {
    expect(kmFlags(null, 150)).toEqual(["missing-reading"]);
  });

  it("flags an outlier above 300 km", () => {
    expect(kmFlags(0, 301)).toEqual(["km-outlier"]);
  });

  it("accepts exactly 300 km and non-numbers fail soft", () => {
    expect(kmFlags(0, 300)).toEqual([]);
    expect(kmFlags("x" as unknown as number, 150)).toEqual(["missing-reading"]);
  });
});

// ── docCompliance (4) ──────────────────────────────────────────────────

describe("engineersAdmin/docCompliance", () => {
  const allSix = ["Aadhaar", "PAN", "Driving Licence", "Bank Passbook", "Photo", "Other"].map(
    (name) => ({ name, path: `docs/${name}.pdf` }),
  );

  it("marks all six present when uploaded", () => {
    const out = docCompliance(allSix);
    expect(out.present).toHaveLength(6);
    expect(out.missing).toEqual([]);
  });

  it("lists exactly the missing blocks", () => {
    const out = docCompliance([{ name: "PAN", path: "docs/pan.pdf" }]);
    expect(out.present).toEqual(["PAN"]);
    expect(out.missing).toEqual(["Aadhaar", "Driving Licence", "Bank Passbook", "Photo", "Other"]);
  });

  it("treats empty input as all missing without throwing", () => {
    expect(docCompliance([]).missing).toHaveLength(6);
    expect(docCompliance(null).missing).toHaveLength(6);
  });

  it("matches names case-insensitively and ignores blank paths", () => {
    const out = docCompliance([
      { name: "  aadhaar ", path: "docs/a.pdf" },
      { name: "PAN", path: "   " },
    ]);
    expect(out.present).toEqual(["Aadhaar"]);
    expect(out.missing).toContain("PAN");
  });
});

// ── buildAttentionItems (9) ────────────────────────────────────────────

describe("engineersAdmin/buildAttentionItems", () => {
  const rates = [{ employee_id: "e1", rate_per_km: 10, effective_from: "2026-09-01" }];
  const fullDocs = ["Aadhaar", "PAN", "Driving Licence", "Bank Passbook", "Photo", "Other"].map(
    (name) => ({ name, path: `docs/${name}.pdf` }),
  );
  const cleanDay = { log_date: "2026-09-05", morning_odometer: 100, evening_odometer: 150 };
  const cleanExpense = {
    expense_date: "2026-09-05",
    charge_type: "Toll",
    amount: 40,
    receipt_path: "r1",
  };

  function clean() {
    return {
      employeeId: "e1",
      rates,
      days: [cleanDay],
      expenses: [cleanExpense],
      docs: fullDocs,
      settlement: null,
      pendingParts: [],
      todayISO: "2026-09-17",
    };
  }

  it("returns [] for clean input", () => {
    expect(buildAttentionItems(clean())).toEqual([]);
  });

  it("raises one high missing-rate item", () => {
    const out = buildAttentionItems({ ...clean(), rates: [] });
    expect(out.filter((i) => i.key === "missing-rate")).toHaveLength(1);
    expect(out.find((i) => i.key === "missing-rate")?.severity).toBe("high");
  });

  it("raises missing-evening", () => {
    const out = buildAttentionItems({
      ...clean(),
      days: [{ log_date: "2026-09-05", morning_odometer: 100, evening_odometer: null }],
    });
    expect(out.map((i) => i.key)).toContain("missing-evening");
  });

  it("raises missing-receipt", () => {
    const out = buildAttentionItems({
      ...clean(),
      expenses: [
        { expense_date: "2026-09-05", charge_type: "Parking", amount: 20, receipt_path: "" },
      ],
    });
    expect(out.map((i) => i.key)).toContain("missing-receipt");
  });

  it("raises a single missing-doc even when several blocks are absent", () => {
    const out = buildAttentionItems({ ...clean(), docs: [{ name: "PAN", path: "docs/pan.pdf" }] });
    const docItems = out.filter((i) => i.key === "missing-doc");
    expect(docItems).toHaveLength(1);
    expect(docItems[0].label).toContain("Aadhaar");
  });

  it("raises km-outlier", () => {
    const out = buildAttentionItems({
      ...clean(),
      days: [{ log_date: "2026-09-05", morning_odometer: 0, evening_odometer: 500 }],
    });
    expect(out.map((i) => i.key)).toContain("km-outlier");
  });

  it("raises one medium negative-km item naming the affected-day count", () => {
    const out = buildAttentionItems({
      ...clean(),
      days: [{ log_date: "2026-09-05", morning_odometer: 200, evening_odometer: 150 }],
    });
    const items = out.filter((i) => i.key === "negative-km");
    expect(items).toHaveLength(1);
    expect(items[0].severity).toBe("medium");
    expect(items[0].label).toBe(
      "Odometer reversal on 1 day(s) — evening reading below morning, verify readings.",
    );
  });

  it("dedups negative-km: many reversed days still yield exactly one item with the count", () => {
    const out = buildAttentionItems({
      ...clean(),
      days: [
        { log_date: "2026-09-05", morning_odometer: 200, evening_odometer: 150 },
        { log_date: "2026-09-06", morning_odometer: 300, evening_odometer: 250 },
        { log_date: "2026-09-07", morning_odometer: 100, evening_odometer: 160 },
      ],
    });
    const items = out.filter((i) => i.key === "negative-km");
    expect(items).toHaveLength(1);
    expect(items[0].label).toContain("2 day(s)");
  });

  it("raises no negative-km for clean or missing-reading days", () => {
    expect(buildAttentionItems(clean()).map((i) => i.key)).not.toContain("negative-km");
    const out = buildAttentionItems({
      ...clean(),
      days: [{ log_date: "2026-09-05", morning_odometer: 100, evening_odometer: null }],
    });
    expect(out.map((i) => i.key)).not.toContain("negative-km");
    expect(out.map((i) => i.key)).toContain("missing-evening");
  });

  it("raises unapproved-past-cutoff only when past and not Approved", () => {
    const past = { period_start: "2026-08-01", period_end: "2026-08-31", status: "Pending" };
    const out = buildAttentionItems({ ...clean(), settlement: past });
    expect(out.find((i) => i.key === "unapproved-past-cutoff")?.severity).toBe("high");
    const approved = buildAttentionItems({
      ...clean(),
      settlement: { ...past, status: "Approved" },
    });
    expect(approved.map((i) => i.key)).not.toContain("unapproved-past-cutoff");
    const future = buildAttentionItems({
      ...clean(),
      settlement: { period_start: "2026-09-01", period_end: "2026-09-30", status: "Pending" },
    });
    expect(future.map((i) => i.key)).not.toContain("unapproved-past-cutoff");
  });

  it("raises unreturned-parts and ignores blank serials", () => {
    const out = buildAttentionItems({
      ...clean(),
      pendingParts: [{ serial: "SN-1" }, { serial: "" }],
    });
    expect(out.filter((i) => i.key === "unreturned-parts")).toHaveLength(1);
    expect(buildAttentionItems({ ...clean(), pendingParts: [{ serial: "  " }] })).toEqual([]);
  });

  it("dedups: many bad days still yield one item per kind", () => {
    const out = buildAttentionItems({
      ...clean(),
      rates: [],
      days: [
        { log_date: "2026-09-05", morning_odometer: 100, evening_odometer: null },
        { log_date: "2026-09-06", morning_odometer: 100, evening_odometer: null },
      ],
    });
    expect(out.filter((i) => i.key === "missing-rate")).toHaveLength(1);
    expect(out.filter((i) => i.key === "missing-evening")).toHaveLength(1);
  });
});

// ── groupExpensesByType (4) ────────────────────────────────────────────

describe("engineersAdmin/groupExpensesByType", () => {
  it("groups counts and totals by charge type", () => {
    expect(
      groupExpensesByType([
        { expense_date: "2026-09-01", charge_type: "Toll", amount: 50, receipt_path: "r1" },
        { expense_date: "2026-09-02", charge_type: "Toll", amount: 30, receipt_path: "r2" },
        { expense_date: "2026-09-03", charge_type: "Parking", amount: 20, receipt_path: "r3" },
      ]),
    ).toEqual({
      Toll: { count: 2, total: 80 },
      Parking: { count: 1, total: 20 },
    });
  });

  it("buckets blank charge types as Unknown", () => {
    const out = groupExpensesByType([
      { expense_date: "2026-09-01", charge_type: "", amount: 10, receipt_path: "r1" },
    ]);
    expect(out).toEqual({ Unknown: { count: 1, total: 10 } });
  });

  it("returns {} for empty input without throwing", () => {
    expect(groupExpensesByType([])).toEqual({});
    expect(groupExpensesByType(null)).toEqual({});
  });

  it("counts rows with bad amounts as 0", () => {
    const out = groupExpensesByType([
      { expense_date: "2026-09-01", charge_type: "Toll", amount: "junk", receipt_path: "r1" },
    ]);
    expect(out).toEqual({ Toll: { count: 1, total: 0 } });
  });
});

// ── dedupeWarnings (4) ─────────────────────────────────────────────────

describe("engineersAdmin/dedupeWarnings", () => {
  it("collapses exact dupes by section::message", () => {
    const out = dedupeWarnings([
      [{ section: "rates", message: "No rate in force" }],
      [{ section: "rates", message: "No rate in force" }],
    ]);
    expect(out).toEqual([{ section: "rates", message: "No rate in force" }]);
  });

  it("keeps first-seen order across lists", () => {
    const out = dedupeWarnings([
      [
        { section: "b", message: "two" },
        { section: "a", message: "one" },
      ],
      [
        { section: "b", message: "two" },
        { section: "c", message: "three" },
      ],
    ]);
    expect(out).toEqual([
      { section: "b", message: "two" },
      { section: "a", message: "one" },
      { section: "c", message: "three" },
    ]);
  });

  it("treats the same message in different sections as distinct", () => {
    const out = dedupeWarnings([
      [
        { section: "rates", message: "Missing" },
        { section: "docs", message: "Missing" },
      ],
    ]);
    expect(out).toHaveLength(2);
  });

  it("returns [] for empty input and tolerates null lists/entries", () => {
    expect(dedupeWarnings([])).toEqual([]);
    expect(dedupeWarnings(null)).toEqual([]);
    expect(dedupeWarnings(undefined)).toEqual([]);
    expect(dedupeWarnings([null, undefined] as never)).toEqual([]);
    expect(dedupeWarnings([[null, undefined] as never, [{ section: "a", message: "m" }]])).toEqual([
      { section: "a", message: "m" },
    ]);
  });
});

// ── rosterNameMap (4) ──────────────────────────────────────────────────

describe("engineersAdmin/rosterNameMap", () => {
  const row = (employee_id: string, name: string | null): AdminEngineer => ({
    employee_id,
    name,
    phone: null,
    email: null,
    active: true,
    auth_user_id: null,
    photo_path: null,
  });

  it("maps ids to names", () => {
    const m = rosterNameMap([row("e1", "Asha"), row("e2", "Ravi")]);
    expect(m.get("e1")).toBe("Asha");
    expect(m.get("e2")).toBe("Ravi");
  });

  it("skips missing/blank employee_ids", () => {
    const m = rosterNameMap([row("", "Nope"), row("   ", "Blank"), row("e1", "Asha")]);
    expect(m.has("")).toBe(false);
    expect(m.size).toBe(1);
    expect(m.get("e1")).toBe("Asha");
  });

  it("falls back to the id when the name is blank or null", () => {
    const m = rosterNameMap([row("e1", ""), row("e2", "   "), row("e3", null)]);
    expect(m.get("e1")).toBe("e1");
    expect(m.get("e2")).toBe("e2");
    expect(m.get("e3")).toBe("e3");
  });

  it("returns an empty map for empty/null input", () => {
    expect(rosterNameMap([]).size).toBe(0);
    expect(rosterNameMap(null).size).toBe(0);
    expect(rosterNameMap(undefined).size).toBe(0);
  });
});

// ── partitionOrphans (4) ───────────────────────────────────────────────

describe("engineersAdmin/partitionOrphans", () => {
  type Row = { id: string | null; v: number };
  const idOf = (r: Row) => r.id;
  const nameById = new Map([["e1", "Asha"]]);

  it("sends unknown ids to orphans and known ids to roster", () => {
    const out = partitionOrphans(
      [
        { id: "e1", v: 1 },
        { id: "zx", v: 2 },
      ],
      nameById,
      idOf,
    );
    expect(out.roster).toEqual([{ id: "e1", v: 1 }]);
    expect(out.orphans).toEqual([{ id: "zx", v: 2 }]);
  });

  it("sends null-id rows to orphans, never roster", () => {
    const out = partitionOrphans([{ id: null, v: 1 }], nameById, idOf);
    expect(out.roster).toEqual([]);
    expect(out.orphans).toEqual([{ id: null, v: 1 }]);
  });

  it("sends blank-id rows to orphans", () => {
    const out = partitionOrphans(
      [
        { id: "", v: 1 },
        { id: "   ", v: 2 },
      ],
      nameById,
      idOf,
    );
    expect(out.roster).toEqual([]);
    expect(out.orphans).toEqual([
      { id: "", v: 1 },
      { id: "   ", v: 2 },
    ]);
  });

  it("returns empty lists for empty input", () => {
    expect(partitionOrphans([], nameById, idOf)).toEqual({ roster: [], orphans: [] });
  });

  it("tolerates null rows without dropping or throwing", () => {
    const rows = [null, { id: "zx", v: 2 }] as unknown as Row[];
    const out = partitionOrphans(rows, nameById, idOf);
    expect(out.roster).toEqual([]);
    expect(out.orphans).toHaveLength(2);
    expect(out.roster.length + out.orphans.length).toBe(2);
  });
});

// ── perEngineerSummary/closed30d upper bound ─────────────────────────────

describe("engineersAdmin/perEngineerSummary-closed30d", () => {
  const engineer: AdminEngineer = {
    employee_id: "e1",
    name: "Asha",
    phone: null,
    email: null,
    active: true,
    auth_user_id: null,
    photo_path: null,
  };

  it("excludes future-dated Closed rows from closed30d", () => {
    const out = perEngineerSummary({
      engineer,
      todayISO: "2026-09-17",
      tickets: [
        { status: "Closed", closed_at: "2026-09-10" },
        { status: "Closed", closed_at: "2026-09-20" },
        { status: "Closed", closed_at: "2026-10-05" },
      ],
    });
    expect(out.closed30d).toBe(1);
  });

  it("counts a Closed row stamped exactly today", () => {
    const out = perEngineerSummary({
      engineer,
      todayISO: "2026-09-17",
      tickets: [{ status: "Closed", closed_at: "2026-09-17" }],
    });
    expect(out.closed30d).toBe(1);
  });
});
