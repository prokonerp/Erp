import { describe, it, expect } from "vitest";
import {
  buildResetScope,
  collectResetCustodySerials,
  normalizeResetSerial,
  recomputeResetPartFlags,
  stripFsrPartLines,
  RESET_ACTIVITY_KINDS,
  RESET_FORBIDDEN_KINDS,
  RESET_FORBIDDEN_TABLES,
  RESET_STORAGE_KIND_ALLOWLIST,
  isResetStoragePathAllowed,
  RESET_MODULE_SOURCE,
} from "@/lib/reset-ticket-engineer.functions";
import { PART_SOURCE_FSR } from "@/lib/sync-fsr-parts";
import type { PartLine } from "@/lib/tickets";

const TICKET_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("reset-ticket-engineer scoping (pure)", () => {
  it("allowlist is exactly the approved engineer-work kinds", () => {
    expect([...RESET_ACTIVITY_KINDS].sort()).toEqual(
      [
        "acknowledge",
        "arrival",
        "customer_verify",
        "departure",
        "equipment_verify",
        "note",
        "photo",
        "signature",
      ].sort(),
    );
  });

  it("forbidden kinds (created/status) are never in the delete allowlist", () => {
    for (const k of RESET_FORBIDDEN_KINDS) {
      expect(RESET_ACTIVITY_KINDS).not.toContain(k);
    }
    expect(RESET_FORBIDDEN_KINDS).toContain("created");
    expect(RESET_FORBIDDEN_KINDS).toContain("status");
  });

  it("forbidden tables are never referenced by the reset scope", () => {
    expect(RESET_FORBIDDEN_TABLES).toContain("ticket_assignment_history");
    expect(RESET_FORBIDDEN_TABLES).toContain("tickets");
    expect(RESET_FORBIDDEN_TABLES).toContain("ims_stock_items");
    const scope = buildResetScope(TICKET_ID);
    const hay = JSON.stringify(scope) + RESET_MODULE_SOURCE;
    for (const t of RESET_FORBIDDEN_TABLES) {
      expect(hay).not.toContain(t);
    }
  });

  it("every delete builder includes ticket_id equality", () => {
    const scope = buildResetScope(TICKET_ID);
    expect(scope.customerFilter).toEqual({ ticket_id: TICKET_ID });
    expect(scope.equipmentFilter).toEqual({ ticket_id: TICKET_ID });
    expect(scope.activityFilter.ticket_id).toBe(TICKET_ID);
    expect(scope.activityFilter.kindIn).toEqual([...RESET_ACTIVITY_KINDS]);
    expect(scope.visitFilter).toEqual({ ticket_id: TICKET_ID });
    expect(scope.fsrFilter).toEqual({ ticket_id: TICKET_ID });
    expect(scope.ticketId).toBe(TICKET_ID);
  });

  it("reset scope covers makeover data (visits + FSR) without touching forbidden tables", () => {
    const scope = buildResetScope(TICKET_ID);
    expect(scope.activityFilter.kindIn).toContain("arrival");
    expect(scope.activityFilter.kindIn).toContain("departure");
    expect(scope.activityFilter.kindIn).toContain("signature");
    // Forbidden kinds stay out even as makeover coverage grows.
    for (const k of RESET_FORBIDDEN_KINDS) {
      expect(scope.activityFilter.kindIn).not.toContain(k);
    }
  });

  it("storage filter allows equipment_correction / issue_photo / customer_signature / serial_photo filenames", () => {
    expect([...RESET_STORAGE_KIND_ALLOWLIST].sort()).toEqual(
      ["customer_signature", "equipment_correction", "issue_photo", "serial_photo"].sort(),
    );
    const scope = buildResetScope(TICKET_ID);
    expect(scope.storagePrefix).toBe(`ticket/${TICKET_ID}/`);
    // allowed exact photo paths
    expect(
      isResetStoragePathAllowed(
        `ticket/${TICKET_ID}/2026-09-12/equipment_correction-abc.jpg`,
        TICKET_ID,
      ),
    ).toBe(true);
    expect(
      isResetStoragePathAllowed(`ticket/${TICKET_ID}/2026-09-12/issue_photo-xyz.jpg`, TICKET_ID),
    ).toBe(true);
    expect(
      isResetStoragePathAllowed(
        `ticket/${TICKET_ID}/2026-09-12/customer_signature-1758028800000-a1b2c3d4.png`,
        TICKET_ID,
      ),
    ).toBe(true);
    // rejected: wrong prefix, other, signature, prefix wipe
    expect(
      isResetStoragePathAllowed(`ticket/other-id/2026-09-12/issue_photo-x.jpg`, TICKET_ID),
    ).toBe(false);
    expect(
      isResetStoragePathAllowed(`ticket/other-id/2026-09-12/customer_signature-x.png`, TICKET_ID),
    ).toBe(false);
    // grandfathered legacy serial photos now delete too
    expect(
      isResetStoragePathAllowed(`ticket/${TICKET_ID}/2026-09-12/serial_photo-a.jpg`, TICKET_ID),
    ).toBe(true);
    expect(isResetStoragePathAllowed(`ticket/${TICKET_ID}/2026-09-12/other-a.jpg`, TICKET_ID)).toBe(
      false,
    );
    expect(
      isResetStoragePathAllowed(`ticket/${TICKET_ID}/2026-09-12/signature-a.jpg`, TICKET_ID),
    ).toBe(false);
    expect(isResetStoragePathAllowed(`ticket/${TICKET_ID}/`, TICKET_ID)).toBe(false);
    // new-scheme deletable kinds allowed
    expect(
      isResetStoragePathAllowed(
        `ticket/${TICKET_ID}/2026-09-17/JD_SERIAL_2026-09-17-4f2a9c1d.jpg`,
        TICKET_ID,
      ),
    ).toBe(true);
    expect(
      isResetStoragePathAllowed(
        `ticket/${TICKET_ID}/2026-09-17/AB_MISMATCH_2026-09-17-ab12cd34.jpg`,
        TICKET_ID,
      ),
    ).toBe(true);
    expect(
      isResetStoragePathAllowed(
        `ticket/${TICKET_ID}/2026-09-17/XX_ISSUE_2026-09-17-ef567890.jpg`,
        TICKET_ID,
      ),
    ).toBe(true);
    expect(
      isResetStoragePathAllowed(
        `ticket/${TICKET_ID}/2026-09-17/YY_SIGNATURE_2026-09-17-1234abcd.png`,
        TICKET_ID,
      ),
    ).toBe(true);
    // new-scheme non-deletable kinds rejected
    expect(
      isResetStoragePathAllowed(
        `ticket/${TICKET_ID}/2026-09-17/ZZ_PROFILE_2026-09-17-4f2a9c1d.jpg`,
        TICKET_ID,
      ),
    ).toBe(false);
    expect(
      isResetStoragePathAllowed(
        `ticket/${TICKET_ID}/2026-09-17/ZZ_CONVEYANCE_2026-09-17-4f2a9c1d.jpg`,
        TICKET_ID,
      ),
    ).toBe(false);
    // new-scheme under wrong ticket rejected
    expect(
      isResetStoragePathAllowed(
        `ticket/other-id/2026-09-17/JD_SERIAL_2026-09-17-4f2a9c1d.jpg`,
        TICKET_ID,
      ),
    ).toBe(false);
  });
});

describe("normalizeResetSerial (pure)", () => {
  it("uppercases and trims string serials", () => {
    expect(normalizeResetSerial("  abc123 ")).toBe("ABC123");
    expect(normalizeResetSerial("ABC123")).toBe("ABC123");
    expect(normalizeResetSerial("aBc-9/x")).toBe("ABC-9/X");
  });

  it('returns "" for blank and non-string inputs', () => {
    expect(normalizeResetSerial("")).toBe("");
    expect(normalizeResetSerial("   ")).toBe("");
    expect(normalizeResetSerial(null)).toBe("");
    expect(normalizeResetSerial(undefined)).toBe("");
    expect(normalizeResetSerial(123)).toBe("");
    expect(normalizeResetSerial({})).toBe("");
    expect(normalizeResetSerial(["A1"])).toBe("");
  });
});

describe("collectResetCustodySerials (pure)", () => {
  it("covers old+new serials in snake_case", () => {
    expect(
      collectResetCustodySerials([{ part_replacements: [{ old_sr_no: "a1", new_sr_no: "b2" }] }]),
    ).toEqual(["A1", "B2"]);
  });

  it("tolerates camelCase keys and upper(trims) values", () => {
    expect(
      collectResetCustodySerials([{ part_replacements: [{ oldSrNo: "  c3 ", newSrNo: "d4" }] }]),
    ).toEqual(["C3", "D4"]);
  });

  it("skips blanks and de-duplicates in first-seen order", () => {
    expect(
      collectResetCustodySerials([
        {
          part_replacements: [
            { old_sr_no: "A1", new_sr_no: "a1 " },
            { old_sr_no: "  ", new_sr_no: null },
            { item: "PCB" },
          ],
        },
        { part_replacements: [{ oldSrNo: " a1" }, { new_sr_no: "B2" }] },
      ]),
    ).toEqual(["A1", "B2"]);
  });

  it("tolerates null input, missing lists, and non-object entries", () => {
    expect(collectResetCustodySerials(null)).toEqual([]);
    expect(collectResetCustodySerials(undefined)).toEqual([]);
    expect(collectResetCustodySerials([])).toEqual([]);
    expect(collectResetCustodySerials([{}, { part_replacements: null }])).toEqual([]);
    expect(
      collectResetCustodySerials([{ part_replacements: [null, "A1", 42, { old_sr_no: "z9" }] }]),
    ).toEqual(["Z9"]);
  });
});

describe("stripFsrPartLines (pure)", () => {
  const fsr = PART_SOURCE_FSR as PartLine["source"];

  it("drops fsr lines only, keeping admin hand-added lines of every other source", () => {
    const adminManual: PartLine = { name: "PCB", qty: "1", serial: "A1", source: "manual" };
    const adminOracle: PartLine = {
      name: "Fan",
      qty: "2",
      serial: "F1",
      source: "oracle_exchange",
    };
    const adminUnset: PartLine = { name: "Relay", qty: "1", serial: "R1" };
    const fsrLine: PartLine = { name: "PCB", qty: "1", serial: "OLD1", source: fsr };
    expect(stripFsrPartLines([adminManual, fsrLine, adminOracle, adminUnset])).toEqual([
      adminManual,
      adminOracle,
      adminUnset,
    ]);
  });

  it("returns [] for null, undefined, and empty input", () => {
    expect(stripFsrPartLines(null)).toEqual([]);
    expect(stripFsrPartLines(undefined)).toEqual([]);
    expect(stripFsrPartLines([])).toEqual([]);
  });

  it("empties an all-fsr array while leaving a no-fsr array untouched", () => {
    const onlyFsr: PartLine[] = [
      { name: "PCB", qty: "1", serial: "OLD1", source: fsr },
      { name: "Fan", qty: "1", serial: "OLD2", source: fsr },
    ];
    expect(stripFsrPartLines(onlyFsr)).toEqual([]);
    const noFsr: PartLine[] = [{ name: "PCB", qty: "1", serial: "A1", source: "manual" }];
    expect(stripFsrPartLines(noFsr)).toEqual(noFsr);
  });
});

describe("recomputeResetPartFlags (pure)", () => {
  const line: PartLine = { name: "PCB", qty: "1", serial: "A1", source: "manual" };

  it("sets all flags true when both remainders are non-empty", () => {
    expect(recomputeResetPartFlags([line], [line])).toEqual({
      defective_parts_received: true,
      good_parts_used: true,
      parts_used: true,
    });
  });

  it("clears all flags to false on empty remainders (post-strip reset)", () => {
    expect(recomputeResetPartFlags([], [])).toEqual({
      defective_parts_received: false,
      good_parts_used: false,
      parts_used: false,
    });
    expect(recomputeResetPartFlags(null, undefined)).toEqual({
      defective_parts_received: false,
      good_parts_used: false,
      parts_used: false,
    });
  });

  it("tracks each side independently", () => {
    expect(recomputeResetPartFlags([line], [])).toEqual({
      defective_parts_received: true,
      good_parts_used: false,
      parts_used: false,
    });
    expect(recomputeResetPartFlags([], [line])).toEqual({
      defective_parts_received: false,
      good_parts_used: true,
      parts_used: true,
    });
  });
});
