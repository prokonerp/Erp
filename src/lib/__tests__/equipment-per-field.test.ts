import { describe, expect, it } from "vitest";
import {
  resolveEquipmentCorrection,
  equipmentPerFieldSchema,
} from "@/lib/ticket-verifications";

describe("equipment per-field correction (RED)", () => {
  it("single-serial fix keeps model, verdict mismatch", () => {
    const out = resolveEquipmentCorrection(
      { model: "MODEL-A", serial: "SER-001" },
      { modelIncorrect: false, serialIncorrect: true, serialInput: "SER-002" },
    );
    expect(out.corrected_model).toBe("MODEL-A");
    expect(out.corrected_serial).toBe("SER-002");
    expect(out.verdict).toBe("mismatch");
  });

  it("single-model fix symmetric", () => {
    const out = resolveEquipmentCorrection(
      { model: "MODEL-A", serial: "SER-001" },
      { modelIncorrect: true, serialIncorrect: false, modelInput: "MODEL-B" },
    );
    expect(out.corrected_model).toBe("MODEL-B");
    expect(out.corrected_serial).toBe("SER-001");
    expect(out.verdict).toBe("mismatch");
  });

  it("both-correct via mismatch path blocked", () => {
    expect(() =>
      equipmentPerFieldSchema.parse({
        modelIncorrect: false,
        serialIncorrect: false,
      }),
    ).toThrow();
    expect(() =>
      resolveEquipmentCorrection(
        { model: "MODEL-A", serial: "SER-001" },
        { modelIncorrect: false, serialIncorrect: false },
      ),
    ).toThrow();
  });

  it("non-empty required when marked incorrect", () => {
    expect(() =>
      equipmentPerFieldSchema.parse({
        modelIncorrect: true,
        serialIncorrect: false,
        modelInput: "   ",
      }),
    ).toThrow();
    expect(() =>
      equipmentPerFieldSchema.parse({
        modelIncorrect: false,
        serialIncorrect: true,
        serialInput: "",
      }),
    ).toThrow();
  });
});
