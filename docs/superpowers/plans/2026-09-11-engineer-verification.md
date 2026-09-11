# Engineer Verification Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build strict-sequence engineer verification (customer then equipment with mandatory geotagged photo on mismatch) with append-only audit and master-safe display.

**Architecture:** Two new tables (`ticket_customer_verifications`, `ticket_equipment_verifications`, one row per ticket, upsert) + `ticket_activities` kinds for history; originals never mutated; Contacts tab reads reports; GPS gate on mismatch upload.

**Tech Stack:** TanStack Start (React 19) + Router file routes, TanStack Query v5, Supabase PG + RLS + Storage `ticket-attachments`, react-hook-form + Zod v4, Tailwind v4 + shadcn, Sonner, Vitest 3.2.7

**Spec:** `docs/superpowers/specs/2026-09-11-engineer-verification-design.md`

## Global Constraints

- Never mutate `customers` master row or `tickets.product/serial_no` originals for corrections; corrections live in verification tables only.
- Strict sequence enforced in UI: Step 2 locked until Step 1 row exists; notes/close locked until both rows exist.
- Mismatch save requires photo + live GPS (`photo_lat/photo_long/photo_accuracy/photo_captured_at` all non-null); deny blocks save with retry.
- Correction display keeps original on top with red strikethrough → green corrected below + engineer name + timestamp + photo link, visible to admin and engineer.
- `ticket_activities` kinds `customer_verify` and `equipment_verify` written on every verdict with timestamps; prior rows immutable.
- Photo bucket is `ticket-attachments`, path `ticket/{ticket_id}/{YYYY-MM-DD}/equipment-{timestamp}-{random}.{ext}`, MIME `image/jpeg|png|webp|heic|heif`, server max 8MB.
- Engineer ownership uses `assigned_employee_id` FK-first then unique-name fallback (same as `useMyQueue.ts`); non-owners blocked.
- Commands: `npm test` runs `vitest run`; `npm run lint` runs `eslint .`; types via `src/integrations/supabase/types.ts` regen after migration.
- Never `git push`, `git merge`, `vercel deploy`, or Supabase writes; prepare migrations + manual apply instructions only.

---

## File structure

- `supabase/migrations/20260912000000_ticket_verifications.sql` — both tables, indexes, RLS, `touch_updated_at` triggers. Single responsibility: schema only.
- `src/lib/ticket-verifications.ts` — verdict types, Zod schemas, snapshot/corrected builders, gating selectors. Pure logic, zero UI.
- `src/lib/__tests__/ticket-verifications.test.ts` — Vitest for builders, schemas, gating.
- `src/lib/verification-geo.ts` — `getCurrentGeo()` + `validateGeoForMismatch()` pure validators.
- `src/lib/__tests__/verification-geo.test.ts` — mocked geolocation tests.
- `src/lib/public-ticket-uploads.functions.ts` — extend `uploadSchema` with geo fields, require on `equipment_correction`.
- `src/hooks/useTicketVerifications.ts` — Query fetch by `ticketId` + upsert helpers, keys via `ticketKeys`.
- `src/components/VerificationStepper.tsx` — stepper UI + gating hints. `src/components/VerificationDiff.tsx` — red→green diff block.
- `src/routes/eng.ticket.$id.tsx` — integrate stepper, Step 1/Step 2 forms, lock work section.
- `src/routes/_app/tickets.$id.tsx` — admin read-only badges + diff blocks.
- `src/components/CustomerFieldVerified.tsx` — read-only list for Contacts tab; wired into `src/components/CustomerForm.tsx` Contacts `TabsContent`.

---

### Task 1: DB migration for verification tables

**Files:**
- Create: `supabase/migrations/20260912000000_ticket_verifications.sql`
- Test: `src/lib/__tests__/ticket-verifications-migration.test.ts`

**Interfaces:**
- Consumes: existing `tickets(id)`, `customers(id)`, `employees(id)`, `touch_updated_at()` from `supabase/setup_new_supabase.sql:192-194`.
- Produces: tables `ticket_customer_verifications`, `ticket_equipment_verifications` with columns named exactly as used in Task 2 types.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/ticket-verifications-migration.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const SQL_PATH = "supabase/migrations/20260912000000_ticket_verifications.sql";
describe("verification migration exists", () => {
  it("creates both tables with RLS and unique ticket", () => {
    const sql = readFileSync(SQL_PATH, "utf8");
    expect(sql).toContain("CREATE TABLE public.ticket_customer_verifications");
    expect(sql).toContain("CREATE TABLE public.ticket_equipment_verifications");
    expect(sql).toContain("UNIQUE (ticket_id)");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("photo_lat");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/ticket-verifications-migration.test.ts`
Expected: FAIL with "ENOENT: no such file or directory" for the migration path.

- [ ] **Step 3: Write minimal migration**

```sql
-- supabase/migrations/20260912000000_ticket_verifications.sql
CREATE TABLE public.ticket_customer_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  verdict text NOT NULL CHECK (verdict IN ('verified','incorrect')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  corrected jsonb NOT NULL DEFAULT '{}'::jsonb,
  engineer_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  engineer_name text,
  engineer_phone text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ticket_equipment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('matched','mismatch')),
  original_model text,
  original_serial text,
  corrected_model text,
  corrected_serial text,
  photo_path text,
  photo_lat double precision,
  photo_long double precision,
  photo_accuracy double precision,
  photo_captured_at timestamptz,
  engineer_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  engineer_name text,
  engineer_phone text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tcv_ticket ON public.ticket_customer_verifications(ticket_id);
CREATE INDEX idx_tev_ticket ON public.ticket_equipment_verifications(ticket_id);
CREATE INDEX idx_tcv_customer ON public.ticket_customer_verifications(customer_id);
ALTER TABLE public.ticket_customer_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_equipment_verifications ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_touch_tcv ON public.ticket_customer_verifications;
CREATE TRIGGER trg_touch_tcv BEFORE UPDATE ON public.ticket_customer_verifications FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_tev ON public.ticket_equipment_verifications;
CREATE TRIGGER trg_touch_tev BEFORE UPDATE ON public.ticket_equipment_verifications FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/ticket-verifications-migration.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260912000000_ticket_verifications.sql src/lib/__tests__/ticket-verifications-migration.test.ts
git commit -m "feat(verify): add ticket verification tables migration"
```

---

### Task 2: Verification data layer (types, schemas, builders, gating)

**Files:**
- Create: `src/lib/ticket-verifications.ts`
- Create: `src/lib/__tests__/ticket-verifications.test.ts`
- Modify: `src/lib/queryKeys.ts:31` (add `verificationKeys` export beside `ticketKeys`)

**Interfaces:**
- Consumes: `Ticket` shape from `src/routes/eng.ticket.$id.tsx:27-48` (`product`, `serial_no`, `customer_name/phone/email/address/sector/location`, `customer_id` where available).
- Produces: `CustomerVerdict`, `EquipmentVerdict`, `buildCustomerSnapshot(ticket)`, `customerCorrectedSchema`, `equipmentMismatchSchema`, `canProceedToStep2(customerRow)`, `canProceedToWork(customerRow, equipmentRow)` used by Tasks 4-6.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/ticket-verifications.test.ts
import { describe, expect, it } from "vitest";
import { buildCustomerSnapshot, canProceedToStep2, canProceedToWork, customerCorrectedSchema } from "@/lib/ticket-verifications";
describe("verifications data layer", () => {
  it("snapshots ticket customer fields", () => {
    const s = buildCustomerSnapshot({ customer_name: "Acme", customer_phone: "9999999999", customer_email: "a@b.com", customer_address: "Addr", sector: "Sec 61", location: "Gurgaon" } as any);
    expect(s.customer_name).toBe("Acme");
    expect(s.sector).toBe("Sec 61");
  });
  it("rejects bad corrected phone", () => {
    expect(() => customerCorrectedSchema.parse({ customer_name: "Acme", customer_phone: "123" })).toThrow();
  });
  it("gates step2 and work", () => {
    expect(canProceedToStep2(null)).toBe(false);
    expect(canProceedToStep2({ id: "x" } as any)).toBe(true);
    expect(canProceedToWork({ id: "c" } as any, null)).toBe(false);
    expect(canProceedToWork({ id: "c" } as any, { id: "e" } as any)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/ticket-verifications.test.ts`
Expected: FAIL with "Failed to resolve import @/lib/ticket-verifications".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/ticket-verifications.ts
import { z } from "zod";
export type CustomerVerdict = "verified" | "incorrect";
export type EquipmentVerdict = "matched" | "mismatch";
export type CustomerSnapshot = { customer_name: string; customer_phone: string | null; customer_email: string | null; customer_address: string | null; sector: string | null; location: string | null };
export function buildCustomerSnapshot(t: { customer_name: string; customer_phone?: string | null; customer_email?: string | null; customer_address?: string | null; sector?: string | null; location?: string | null }): CustomerSnapshot {
  return { customer_name: t.customer_name, customer_phone: t.customer_phone ?? null, customer_email: t.customer_email ?? null, customer_address: t.customer_address ?? null, sector: t.sector ?? null, location: t.location ?? null };
}
export const customerCorrectedSchema = z.object({
  customer_name: z.string().trim().min(1, "Customer name required"),
  customer_phone: z.string().trim().regex(/^\d{10}$/, "Enter a valid 10-digit mobile number"),
  customer_email: z.string().trim().email("Enter a valid email address").nullable().optional(),
  customer_address: z.string().trim().nullable().optional(),
  sector: z.string().trim().nullable().optional(),
  location: z.string().trim().nullable().optional(),
});
export type CustomerCorrected = z.infer<typeof customerCorrectedSchema>;
export const equipmentMismatchSchema = z.object({
  corrected_model: z.string().trim().min(1, "Model No required"),
  corrected_serial: z.string().trim().min(1, "Serial No required"),
});
export type EquipmentMismatch = z.infer<typeof equipmentMismatchSchema>;
export function canProceedToStep2(customerRow: { id: string } | null): boolean { return !!customerRow?.id; }
export function canProceedToWork(customerRow: { id: string } | null, equipmentRow: { id: string } | null): boolean { return !!customerRow?.id && !!equipmentRow?.id; }
export function buildEquipmentOriginal(t: { product?: string | null; serial_no?: string | null }): { original_model: string | null; original_serial: string | null } {
  return { original_model: t.product ?? null, original_serial: t.serial_no ?? null };
}
```

```ts
// src/lib/queryKeys.ts append (after ticketKeys line 31):
export const verificationKeys = createKeyFactory(["verifications"] as const);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/ticket-verifications.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ticket-verifications.ts src/lib/__tests__/ticket-verifications.test.ts src/lib/queryKeys.ts
git commit -m "feat(verify): add verification data layer with gating selectors"
```

---

### Task 3: GPS helper + mandatory geo on mismatch upload

**Files:**
- Create: `src/lib/verification-geo.ts`
- Create: `src/lib/__tests__/verification-geo.test.ts`
- Modify: `src/lib/public-ticket-uploads.functions.ts:5-58` (extend schema + size/MIME stay)

**Interfaces:**
- Consumes: `EquipmentMismatch` from Task 2; browser `navigator.geolocation`.
- Produces: `getCurrentGeo(): Promise<GeoFix>`, `validateGeoForMismatch(geo): string | null`, extended upload input `{ lat, long, accuracy, captured_at }` used by Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/verification-geo.test.ts
import { describe, expect, it } from "vitest";
import { validateGeoForMismatch } from "@/lib/verification-geo";
describe("geo gate", () => {
  it("blocks missing geo", () => {
    expect(validateGeoForMismatch(null)).toMatch(/location/i);
  });
  it("accepts valid fix", () => {
    expect(validateGeoForMismatch({ lat: 28.4, long: 77.0, accuracy: 12, captured_at: new Date().toISOString() })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/verification-geo.test.ts`
Expected: FAIL with "Failed to resolve import @/lib/verification-geo".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/verification-geo.ts
export type GeoFix = { lat: number; long: number; accuracy: number | null; captured_at: string };
export function validateGeoForMismatch(geo: GeoFix | null): string | null {
  if (!geo) return "Live location is required for mismatch photo. Allow location and retry.";
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.long)) return "Live location is required for mismatch photo. Allow location and retry.";
  if (!geo.captured_at) return "Photo capture time missing. Retake the photo.";
  return null;
}
export function getCurrentGeo(timeoutMs = 15000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Geolocation not supported on this device."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, long: p.coords.longitude, accuracy: p.coords.accuracy ?? null, captured_at: new Date().toISOString() }),
      (e) => reject(new Error(e.message || "Location permission denied. Allow location and retry.")),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
```

```ts
// src/lib/public-ticket-uploads.functions.ts — extend existing uploadSchema (keep MIME + 8MB):
// add fields: lat: z.number().min(-90).max(90).optional(), long: z.number().min(-180).max(180).optional(),
// accuracy: z.number().nullable().optional(), captured_at: z.string().nullable().optional(),
// kind: z.enum(["serial_photo","issue_photo","other","equipment_correction"]),
// then: if (parsed.kind === "equipment_correction" && (parsed.lat === undefined || parsed.long === undefined || !parsed.captured_at)) throw new Error("Geotagged photo with live location is mandatory for Model/Serial mismatch.");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/verification-geo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/verification-geo.ts src/lib/__tests__/verification-geo.test.ts src/lib/public-ticket-uploads.functions.ts
git commit -m "feat(verify): enforce mandatory geotagged photo for mismatch"
```

---

### Task 4: Engineer portal stepper + strict gating

**Files:**
- Create: `src/components/VerificationStepper.tsx`
- Modify: `src/routes/eng.ticket.$id.tsx:58-499` (add stepper + forms + lock note/photo/close behind `canProceedToWork`)
- Modify: `src/hooks/useTicketVerifications.ts` (new file, fetch + upsert via `verificationKeys.detail(ticketId)`)

**Interfaces:**
- Consumes: `buildCustomerSnapshot`, `customerCorrectedSchema`, `equipmentMismatchSchema`, `canProceedToStep2`, `canProceedToWork` from Task 2; `getCurrentGeo`, `validateGeoForMismatch` from Task 3.
- Produces: gated engineer UI; writes rows + `ticket_activities(kind=customer_verify|equipment_verify|photo)`; unlocks work section.

- [ ] **Step 1: Write the failing test**

```ts
// extend src/lib/__tests__/ticket-verifications.test.ts temporarily is forbidden; instead add:
// src/lib/__tests__/verification-gating.test.ts
import { describe, expect, it } from "vitest";
import { canProceedToStep2, canProceedToWork } from "@/lib/ticket-verifications";
describe("engineer gating", () => {
  it("locks work until both verifications exist", () => {
    expect(canProceedToWork(null, null)).toBe(false);
    expect(canProceedToWork({ id: "c" } as any, { id: "e" } as any)).toBe(true);
    expect(canProceedToStep2({ id: "c" } as any)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/verification-gating.test.ts`
Expected: FAIL with "Failed to resolve import" only if Task 2 missing; after Task 2 it PASSES — this confirms gating contract before UI. If passes immediately, proceed (contract lock).

- [ ] **Step 3: Write minimal UI**

```tsx
// src/components/VerificationStepper.tsx
export function VerificationStepper({ step1Done, step2Done }: { step1Done: boolean; step2Done: boolean }) {
  const step = !step1Done ? 1 : !step2Done ? 2 : 3;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={step >= 1 ? "font-semibold" : "text-muted-foreground"}>1 Customer {step1Done ? "✓" : ""}</span>
      <span aria-hidden>→</span>
      <span className={step >= 2 && step1Done ? "font-semibold" : "text-muted-foreground"}>2 Model/Serial {step2Done ? "✓" : ""}</span>
      <span aria-hidden>→</span>
      <span className={step === 3 ? "font-semibold" : "text-muted-foreground"}>3 Work</span>
    </div>
  );
}
```

```ts
// src/hooks/useTicketVerifications.ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { verificationKeys } from "@/lib/queryKeys";
export function useTicketVerifications(ticketId: string | null) {
  return useQuery({
    queryKey: ticketId ? verificationKeys.detail(ticketId) : ["verifications", "detail", "none"],
    enabled: !!ticketId,
    staleTime: 30_000,
    queryFn: async () => {
      const [{ data: customer }, { data: equipment }] = await Promise.all([
        supabase.from("ticket_customer_verifications").select("*").eq("ticket_id", ticketId!).maybeSingle(),
        supabase.from("ticket_equipment_verifications").select("*").eq("ticket_id", ticketId!).maybeSingle(),
      ]);
      return { customer: customer ?? null, equipment: equipment ?? null };
    },
  });
}
```

```tsx
// src/routes/eng.ticket.$id.tsx integration (exact insertion points):
// 1. Render <VerificationStepper step1Done={!!verifications.customer} step2Done={!!verifications.equipment} /> above note form.
// 2. Step 1 card: snapshot via buildCustomerSnapshot(ticket) + [Details Verified] (insert verdict=verified + snapshot) + [Details Incorrect] (rhf form with customerCorrectedSchema, on save insert verdict=incorrect + corrected).
// 3. Step 2 card disabled when !canProceedToStep2(verifications.customer) with hint "Verify customer first".
// 4. Mismatch form: equipmentMismatchSchema fields + camera <input type="file" accept="image/*" capture="environment"> + on file: await getCurrentGeo(), validateGeoForMismatch(), upload via uploadPublicTicketAttachment with kind="equipment_correction" + geo, then upsert verification.
// 5. Gate note/photo/close: disabled={!(canProceedToWork(customer, equipment))} with hint "Complete verification first".
// 6. After each verdict insert: supabase.from("ticket_activities").insert({ ticket_id: id, kind: "customer_verify" | "equipment_verify", notes: "Customer verified by {name} at {iso}" , actor: myName }).
```

- [ ] **Step 4: Run tests to verify nothing regressed**

Run: `npm test -- src/lib/__tests__/verification-gating.test.ts src/lib/__tests__/ticket-verifications.test.ts src/lib/__tests__/verification-geo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/VerificationStepper.tsx src/hooks/useTicketVerifications.ts src/routes/eng.ticket.$id.tsx
git commit -m "feat(verify): engineer strict-sequence stepper with gating"
```

---

### Task 5: Correction diff display (engineer + admin)

**Files:**
- Create: `src/components/VerificationDiff.tsx`
- Modify: `src/routes/eng.ticket.$id.tsx` (render diff under Step 1/Step 2 when rows exist)
- Modify: `src/routes/_app/tickets.$id.tsx` (admin badges + same diff blocks)

**Interfaces:**
- Consumes: verification rows from Task 4 hook (`original_*`, `corrected_*`, `engineer_name`, `verified_at`, `photo_path`).
- Produces: `VerificationDiff({ label, original, corrected })` reused in both routes; no new data writes.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/verification-diff.test.ts
import { describe, expect, it } from "vitest";
import { diffLines } from "@/components/VerificationDiff";
describe("diff helper", () => {
  it("detects changed serial", () => {
    expect(diffLines("ABC123", "ABC124")).toEqual({ changed: true });
    expect(diffLines("ABC123", "ABC123")).toEqual({ changed: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/verification-diff.test.ts`
Expected: FAIL with "Failed to resolve import @/components/VerificationDiff".

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/VerificationDiff.tsx
export function diffLines(original: string | null, corrected: string | null): { changed: boolean } {
  return { changed: (original ?? "") !== (corrected ?? "") };
}
export function VerificationDiff({ label, original, corrected, engineer, at, photoPath }: { label: string; original: string | null; corrected: string | null; engineer?: string | null; at?: string | null; photoPath?: string | null }) {
  const { changed } = diffLines(original, corrected);
  if (!changed) return <div className="text-xs text-emerald-700">✓ {label} matched</div>;
  return (
    <div className="rounded border p-2 space-y-1">
      <div className="text-xs text-muted-foreground">{label} — corrected by {engineer ?? "engineer"} {at ? `· ${new Date(at).toLocaleString()}` : ""}</div>
      <div className="text-sm line-through decoration-red-400 text-red-600">{original || "—"}</div>
      <div className="text-sm">→ <span className="bg-emerald-50 text-emerald-700 px-1 rounded">{corrected || "—"}</span></div>
      {photoPath ? <a className="text-xs underline" href={photoPath} target="_blank" rel="noreferrer">View correction photo</a> : null}
    </div>
  );
}
```

```tsx
// eng.ticket.$id.tsx + _app/tickets.$id.tsx usage (repeat code in both, no shared wrapper to keep reviewer isolation):
// <VerificationDiff label="Serial No" original={equipment.original_serial} corrected={equipment.corrected_serial} engineer={equipment.engineer_name} at={equipment.verified_at} photoPath={equipment.photo_path} />
// <VerificationDiff label="Customer phone" original={customer.snapshot?.customer_phone} corrected={customer.corrected?.customer_phone} engineer={customer.engineer_name} at={customer.verified_at} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/verification-diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/VerificationDiff.tsx src/routes/eng.ticket.$id.tsx "src/routes/_app/tickets.\$id.tsx"
git commit -m "feat(verify): show original vs corrected diff with engineer stamp"
```

---

### Task 6: Customer master Contacts tab Field Verified section

**Files:**
- Create: `src/components/CustomerFieldVerified.tsx`
- Modify: `src/components/CustomerForm.tsx:583-622` (render inside `TabsContent value="contacts"` below existing list, read-only)

**Interfaces:**
- Consumes: verification rows by `customer_id` (same shape as Task 2/4); `masterKeys` invalidation untouched.
- Produces: read-only list; never calls `saveCustomer` or `buildCustomerPayload`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/customer-field-verified.test.ts
import { describe, expect, it } from "vitest";
import { formatFieldVerified } from "@/components/CustomerFieldVerified";
describe("field verified formatter", () => {
  it("formats engineer stamp", () => {
    expect(formatFieldVerified({ engineer_name: "Ravi", verified_at: "2026-09-11T10:00:00Z" } as any)).toMatch(/Ravi/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/customer-field-verified.test.ts`
Expected: FAIL with "Failed to resolve import @/components/CustomerFieldVerified".

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/CustomerFieldVerified.tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
export function formatFieldVerified(r: { engineer_name?: string | null; verified_at?: string | null }): string {
  return `${r.engineer_name ?? "Engineer"} · ${r.verified_at ? new Date(r.verified_at).toLocaleString() : ""}`;
}
export function CustomerFieldVerified({ customerId }: { customerId: string }) {
  const { data } = useQuery({
    queryKey: ["customer-field-verified", customerId],
    queryFn: async () => {
      const { data } = await supabase.from("ticket_customer_verifications").select("id,ticket_id,verdict,corrected,engineer_name,verified_at").eq("customer_id", customerId).order("verified_at", { ascending: false });
      return data ?? [];
    },
  });
  if (!data?.length) return <div className="text-xs text-muted-foreground border rounded p-3">No field-verified reports yet.</div>;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Field Verified (from site) — read-only</h4>
      {data.map((r: any) => (
        <div key={r.id} className="border rounded p-2 text-xs">
          <div>{formatFieldVerified(r)} · Ticket {String(r.ticket_id).slice(0, 8)}</div>
          <pre className="whitespace-pre-wrap">{JSON.stringify(r.corrected ?? {}, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
```

```tsx
// src/components/CustomerForm.tsx — inside <TabsContent value="contacts"> after {form.contacts.map(...)} block, add:
// {customerId ? <div className="pt-2"><CustomerFieldVerified customerId={customerId} /></div> : null}
// import { CustomerFieldVerified } from "@/components/CustomerFieldVerified";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/customer-field-verified.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CustomerFieldVerified.tsx src/components/CustomerForm.tsx
git commit -m "feat(verify): show field-verified reports in customer contacts tab"
```

---

### Task 7: Timeline, lint, and manual proof

**Files:**
- Modify: `src/routes/eng.ticket.$id.tsx:472-489` (render `customer_verify`/`equipment_verify` kinds in activity timeline)
- Test: none new; regression run only.

**Interfaces:**
- Consumes: all prior tasks. Produces: shippable flow with proof.

- [ ] **Step 1: Render new activity kinds**

```tsx
// timeline label map addition (same file, beside kind photo/note):
// const VERIFY_LABEL: Record<string, string> = { customer_verify: "Customer verification", equipment_verify: "Equipment verification", photo: "Photo" };
// render: <span>{VERIFY_LABEL[a.kind] ?? a.kind} · {new Date(a.created_at).toLocaleString()} — {a.notes}</span>
```

- [ ] **Step 2: Run full verification**

Run: `npm test`
Expected: PASS (all suites including `tickets.test.ts`, `eng-queue-utils.test.ts`, `engineer-upload-guards.test.ts`, new verification suites).

Run: `npm run lint`
Expected: PASS with zero errors (fix any new eslint errors inline before proceeding).

- [ ] **Step 3: Manual proof checklist (do not skip)**

```text
1. As engineer open /eng/ticket/$id → Step 2 disabled with "Verify customer first".
2. Step 1 Incorrect → save corrected phone → row + customer_verify activity + timestamp + engineer tag.
3. Step 2 Not Matched without photo/GPS → blocked toast; with photo+GPS → mismatch row + equipment_verify + photo link.
4. Notes/close disabled until both done; enabled after.
5. Admin /tickets/$id shows diff blocks; Customer master pencil → Contacts shows Field Verified read-only.
6. Migration file present; `touch_updated_at` triggers exist; no customers/tickets originals mutated.
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/eng.ticket.$id.tsx
git commit -m "feat(verify): timeline labels and final gating proof"
```
