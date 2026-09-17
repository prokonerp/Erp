export const UPLOAD_NAME_KINDS = [
  "CONVEYANCE",
  "PROFILE",
  "SERIAL",
  "ISSUE",
  "MISMATCH",
  "SIGNATURE",
] as const;

export type UploadNameKind = (typeof UPLOAD_NAME_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(UPLOAD_NAME_KINDS);

function firstAlnumChar(word: string): string | null {
  const m = word.match(/[A-Za-z0-9]/);
  return m ? m[0].toUpperCase() : null;
}

function firstTwoAlnumChars(word: string): string | null {
  const chars = word.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!chars) return null;
  return chars.slice(0, 2);
}

export function initialsFromName(name: string | null | undefined): string {
  if (name == null) return "ENG";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "ENG";
  if (words.length === 1) {
    return firstTwoAlnumChars(words[0]) ?? "ENG";
  }
  const a = firstAlnumChar(words[0]);
  const b = firstAlnumChar(words[1]);
  const out = `${a ?? ""}${b ?? ""}`.slice(0, 4);
  if (!out) return "ENG";
  if (out.length === 1 && a !== null) {
    const second = firstTwoAlnumChars(words[0]);
    if (second && second.length === 2) return (out + second[1]).slice(0, 4);
  }
  return out;
}

export function sanitizeNameLabel(label: string | null | undefined): string | null {
  if (label == null) return null;
  const upper = label.toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  const collapsed = upper.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (!collapsed) return null;
  const trimmed = collapsed.slice(0, 24).replace(/^-+|-+$/g, "");
  return trimmed ? trimmed : null;
}

const TOKEN_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function fallbackToken(): string {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)];
  }
  return out;
}

export function makeNameToken(): string {
  try {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    const fn = g.crypto?.randomUUID;
    if (typeof fn === "function") {
      const raw = fn
        .call(g.crypto)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (raw.length >= 8) return raw.slice(0, 8);
    }
  } catch {
    // fall through to Math.random fallback
  }
  return fallbackToken();
}

export function buildUploadFilename(input: {
  initials: string;
  kind: UploadNameKind;
  date: string;
  label?: string | null;
  token: string;
  ext: string;
}): string {
  const { initials, kind, date, label, token } = input;
  if (!/^[A-Z0-9]{1,4}$/.test(initials)) {
    throw new Error(`Invalid initials: ${JSON.stringify(initials)}`);
  }
  if (!KIND_SET.has(kind)) {
    throw new Error(`Invalid kind: ${JSON.stringify(kind)}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date: ${JSON.stringify(input.date)}`);
  }
  if (!/^[a-z0-9]{4,12}$/.test(token)) {
    throw new Error(`Invalid token: ${JSON.stringify(token)}`);
  }

  let ext = (input.ext ?? "").toLowerCase().replace(/^\.+/, "");
  ext = ext.replace(/[^a-z0-9]/g, "").slice(0, 5);
  if (!ext) ext = "jpg";

  const cleanLabel = sanitizeNameLabel(label ?? null);
  const labelPart = cleanLabel ? `_${cleanLabel}` : "";
  return `${initials}_${kind}_${date}${labelPart}-${token}.${ext}`;
}

export type ParsedUploadName =
  | { kind: UploadNameKind; legacy: false }
  | { legacy: true; legacyKind: string };

const NEW_SCHEME_RE =
  /^[A-Z0-9]{1,4}_(CONVEYANCE|PROFILE|SERIAL|ISSUE|MISMATCH|SIGNATURE)_\d{4}-\d{2}-\d{2}(?:_[A-Z0-9-]{1,24})?-[a-z0-9]{4,12}\.[a-z0-9]{1,5}$/;

const LEGACY_PREFIXES = [
  "serial_photo",
  "equipment_correction",
  "issue_photo",
  "customer_signature",
  "signature",
  "other",
] as const;

export function parseUploadFilename(filename: string): ParsedUploadName | null {
  if (!filename || typeof filename !== "string") return null;
  const base = filename.split("/").pop() ?? filename;
  const name = base.trim();
  if (!name) return null;

  const m = NEW_SCHEME_RE.exec(name);
  if (m) {
    return { kind: m[1] as UploadNameKind, legacy: false };
  }

  const lower = name.toLowerCase();
  for (const prefix of LEGACY_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}-`)) {
      // Require an extension for bare/legacy forms to avoid matching garbage.
      if (!/\.[a-z0-9]{1,5}$/.test(lower)) return null;
      return { legacy: true, legacyKind: prefix };
    }
  }
  return null;
}
