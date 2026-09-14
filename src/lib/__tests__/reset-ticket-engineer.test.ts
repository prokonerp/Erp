import { describe, it, expect } from "vitest";
import {
  buildResetScope,
  RESET_ACTIVITY_KINDS,
  RESET_FORBIDDEN_KINDS,
  RESET_FORBIDDEN_TABLES,
  RESET_STORAGE_KIND_ALLOWLIST,
  isResetStoragePathAllowed,
  RESET_MODULE_SOURCE,
} from "@/lib/reset-ticket-engineer.functions";

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

  it("storage filter allows equipment_correction / issue_photo / customer_signature filenames", () => {
    expect([...RESET_STORAGE_KIND_ALLOWLIST].sort()).toEqual(
      ["customer_signature", "equipment_correction", "issue_photo"].sort(),
    );
    const scope = buildResetScope(TICKET_ID);
    expect(scope.storagePrefix).toBe(`ticket/${TICKET_ID}/`);
    // allowed exact photo paths
    expect(
      isResetStoragePathAllowed(`ticket/${TICKET_ID}/2026-09-12/equipment_correction-abc.jpg`, TICKET_ID),
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
    // rejected: wrong prefix, serial_photo, other, prefix wipe
    expect(isResetStoragePathAllowed(`ticket/other-id/2026-09-12/issue_photo-x.jpg`, TICKET_ID)).toBe(
      false,
    );
    expect(
      isResetStoragePathAllowed(`ticket/other-id/2026-09-12/customer_signature-x.png`, TICKET_ID),
    ).toBe(false);
    expect(
      isResetStoragePathAllowed(`ticket/${TICKET_ID}/2026-09-12/serial_photo-a.jpg`, TICKET_ID),
    ).toBe(false);
    expect(
      isResetStoragePathAllowed(`ticket/${TICKET_ID}/2026-09-12/other-a.jpg`, TICKET_ID),
    ).toBe(false);
    expect(isResetStoragePathAllowed(`ticket/${TICKET_ID}/`, TICKET_ID)).toBe(false);
  });
});
