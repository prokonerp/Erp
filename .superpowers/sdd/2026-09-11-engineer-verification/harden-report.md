# Engineer Verification Hardening Report

**Date:** 2026-09-11
**Branch:** engineers-parts (HEAD 2e81fbe → commit below)
**Files touched:** `src/lib/verification-geo.ts`, `src/routes/eng.ticket.$id.tsx`, `src/lib/__tests__/verification-geo.test.ts`

---

## Changes Applied

### 1. Old-photo orphan cleanup on overwrite (`eng.ticket.$id.tsx:432-443, 467-473`)
Before upserting new `ticket_equipment_verifications` row, reads existing `photo_path` via `maybeSingle()`. After successful upsert, if old path exists and differs from the new upload path, deletes old photo from `ticket-attachments` storage. Warn-swallowing try/catch matches existing orphan-cleanup pattern. No change to existing upload-failure cleanup.

### 2. iOS cold-start GPS (`verification-geo.ts:17-29, 44`)
- Default timeout raised: 15000 → 25000 ms
- Extracted pure function `geoErrorMessage(code: number): string` mapping:
  - `1` (PERMISSION_DENIED) → "Location permission denied. Enable location for this site in Settings and retry."
  - `2` (POSITION_UNAVAILABLE) → "Phone could not get a fix. Move outdoors and retry."
  - `3` (TIMEOUT) → "Location timed out. Try again."
  - Unknown → fallback to `e.message` or generic permission message
- `getCurrentGeo` now uses `typeof e.code === "number"` check before calling `geoErrorMessage`

### 3. Offline guard (`eng.ticket.$id.tsx:382-385, 549-553`)
- `handleEquipmentMismatch`: `if (!navigator.onLine)` → toast.error + return before GPS/compression/upload
- `handlePhotoUpload`: same guard, also resets file input before returning
- No offline queue added — message only, per spec

### 4. Double-submit guards (verified as-is)
- `mismatchBusy` (line 119) disables mismatch submit button (line 1020)
- `photoBusy` (line 107) disables photo upload button (line 1080)
- `verdictBusy`/`verdictBusy2` disable customer verdict buttons
- All existing guards intact; no missing guards found

---

## Tests

- **544 tests pass** (34 test files, all green)
- **4 new vitest cases** for `geoErrorMessage` pure function:
  - Code 1 → permission denied message
  - Code 2 → position unavailable message
  - Code 3 → timeout message
  - Unknown code → fallback match

## Lint

- **0 new eslint errors** introduced
- 5 pre-existing prettier/formatting errors in touched files (lines 9, 19, 20, 23 in test; line 9 in verification-geo.ts; line 91 in route file) — all present before this changeset

## Residuals

- Pre-existing lint noise (5 prettier line-length/formatting errors) unchanged — out of scope per "no whole-file reformats" constraint
- No changes to compression, validation schemas, RLS, or other systems

---

**Commit:** `fix(verify): harden photo paths — old-photo cleanup, GPS timeout+messages, offline guard`
