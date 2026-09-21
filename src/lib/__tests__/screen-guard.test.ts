import { describe, it, expect } from "vitest";
import {
  classifyGuardKey,
  isEditableTarget,
  guardWatermarkLabel,
  watermarkSvgDataUri,
} from "@/lib/screen-guard";

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("classifyGuardKey", () => {
  it("returns printscreen for PrintScreen", () => {
    expect(classifyGuardKey(key("PrintScreen"))).toBe("printscreen");
  });
  it("returns printscreen regardless of modifiers", () => {
    expect(classifyGuardKey(key("PrintScreen", { ctrlKey: true, shiftKey: true }))).toBe(
      "printscreen",
    );
    expect(classifyGuardKey(key("printscreen", { metaKey: true, altKey: true }))).toBe(
      "printscreen",
    );
  });
  it("returns print for ctrl+P", () => {
    expect(classifyGuardKey(key("p", { ctrlKey: true }))).toBe("print");
  });
  it("returns print for meta+P", () => {
    expect(classifyGuardKey(key("p", { metaKey: true }))).toBe("print");
  });
  it("returns save for ctrl+S", () => {
    expect(classifyGuardKey(key("s", { ctrlKey: true }))).toBe("save");
  });
  it("returns save for meta+shift+S", () => {
    expect(classifyGuardKey(key("S", { metaKey: true, shiftKey: true }))).toBe("save");
  });
  it("returns null for ctrl+C", () => {
    expect(classifyGuardKey(key("c", { ctrlKey: true }))).toBeNull();
  });
  it("returns null for plain p", () => {
    expect(classifyGuardKey(key("p"))).toBeNull();
  });
  it("returns null for ctrl+shift+I (devtools)", () => {
    expect(classifyGuardKey(key("i", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
  it("is case-insensitive on the key", () => {
    expect(classifyGuardKey(key("P", { ctrlKey: true }))).toBe("print");
    expect(classifyGuardKey(key("S", { ctrlKey: true }))).toBe("save");
  });
});

describe("isEditableTarget", () => {
  it("returns true for INPUT / TEXTAREA / SELECT (any casing)", () => {
    expect(isEditableTarget("INPUT", false)).toBe(true);
    expect(isEditableTarget("input", false)).toBe(true);
    expect(isEditableTarget("TEXTAREA", false)).toBe(true);
    expect(isEditableTarget("select", false)).toBe(true);
  });
  it("returns true when contentEditable", () => {
    expect(isEditableTarget("DIV", true)).toBe(true);
  });
  it("returns false for DIV / BUTTON without contentEditable", () => {
    expect(isEditableTarget("DIV", false)).toBe(false);
    expect(isEditableTarget("BUTTON", false)).toBe(false);
    expect(isEditableTarget("", false)).toBe(false);
  });
});

describe("guardWatermarkLabel", () => {
  const at = Date.parse("2026-01-01T19:00:00Z");

  it("is deterministic for a fixed instant", () => {
    expect(guardWatermarkLabel("asha@prokon.in", at)).toBe(
      guardWatermarkLabel("asha@prokon.in", at),
    );
  });
  it("contains the identity and stays on one line", () => {
    const label = guardWatermarkLabel("asha@prokon.in", at);
    expect(label).toContain("asha@prokon.in");
    expect(label).not.toContain("\n");
  });
  it("trims the identity", () => {
    expect(guardWatermarkLabel("  asha  ", at)).toContain("asha");
    expect(guardWatermarkLabel("  asha  ", at)).not.toContain("  asha  ");
  });
  it('falls back to "Engineer" for an empty identity', () => {
    expect(guardWatermarkLabel("", at)).toContain("Engineer");
    expect(guardWatermarkLabel("   ", at)).toContain("Engineer");
  });
  it("uses the IST wall clock (UTC+5:30), not UTC", () => {
    // 19:00Z on 2026-01-01 is 00:30 IST on 2026-01-02.
    const label = guardWatermarkLabel("asha", at);
    expect(label).toContain("2026-01-02");
    expect(label).not.toContain("2026-01-01");
    expect(label).toContain("00:30");
    expect(label).toContain("IST");
  });
});

describe("watermarkSvgDataUri", () => {
  const prefix = "data:image/svg+xml,";
  const decode = (uri: string) => decodeURIComponent(uri.slice(prefix.length));

  it("starts with data:image/svg+xml", () => {
    expect(watermarkSvgDataUri("asha 2026-01-02 00:30 IST")).toMatch(/^data:image\/svg\+xml/);
  });
  it("escapes text needing escaping and keeps the URI CSS-safe", () => {
    const uri = watermarkSvgDataUri('a&b<c>"d"');
    expect(uri).not.toMatch(/[<># ]/);
    expect(uri).not.toContain('"');
    const svg = decode(uri);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("a&amp;b&lt;c&gt;&quot;d&quot;");
    // The raw unescaped input must not survive into the document.
    expect(svg).not.toContain("<c>");
  });
  it("renders a repeatable rotated tile with rounded opacity", () => {
    const svg = decode(watermarkSvgDataUri("asha"));
    expect(svg).toContain('width="340"');
    expect(svg).toContain('height="170"');
    expect(svg).toContain("rotate(-24");
    expect(svg).toContain('opacity="0.5"');
  });
  it("honours an explicit opacity and clamps out-of-range values", () => {
    expect(decode(watermarkSvgDataUri("asha", 0.12))).toContain('opacity="0.12"');
    expect(decode(watermarkSvgDataUri("asha", 5))).toContain('opacity="1"');
  });
});
