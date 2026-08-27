import { describe, it, expect } from "vitest";
import { parseCSV, buildCSV } from "@/lib/csv";

describe("csv/parseCSV — M21 BOM + quoting", () => {
  it("strips a leading UTF-8 BOM", () => {
    const raw = "﻿name,age\nAlice,30\nBob,40";
    const rows = parseCSV(raw);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Alice");
    expect(Object.keys(rows[0])[0]).toBe("name"); // not "﻿name"
  });

  it("escapes carriage returns in buildCSV", () => {
    const out = buildCSV(["note"], [{ note: "line1\rline2" }]);
    expect(out).toBe('note\n"line1\rline2"');
  });

  it("escapes embedded commas and newlines", () => {
    expect(buildCSV(["a"], [{ a: "x,y" }])).toBe('a\n"x,y"');
    expect(buildCSV(["a"], [{ a: "x\ny" }])).toBe('a\n"x\ny"');
  });
});
