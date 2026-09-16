# Engineering Module — Risk/Challenge/Improvement Strategy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Wave0–3 (engineer portal hardening) ko live pe safe apply karna, identity-link gap band karna, aur documented improvements execute karna.

**Architecture:** Phase A (go-live safety) → Phase B (hardening) → Phase C (roadmap ADR, doc-only). Migrations additive + idempotent; Supabase writes sirf user manual.

**Tech Stack:** Supabase Postgres RLS, TanStack Start, bun test, tsc.

**Spec:** `docs/ENGINEER_PORTAL.md`, `docs/ENGINEER_VERIFICATION.md` (runbook §0, gates §1–§3, open items §4).

## Global Constraints

- Supabase writes (SQL apply, dumps, dashboard edits) sirf user manually karega — automation se kabhi nahi.
- `git push` / `git merge` kabhi nahi — local commits only, diff user ko dikhega.
- Applied migrations edit nahi honge — har RLS/policy change naye migration me (DROP+CREATE same names).
- Har migration additive + idempotent + guarded (`IF NOT EXISTS` / `to_regclass` / `NOT VALID`); zero destructive statements.
- Local Homebrew PG15.19 UPDATE-RLS write paths prove nahi kar sakta (MEM-035) — UPDATE policies sirf live DB ya FOR ALL twins se verify honge.

## Execution order

C1 → A2 (user) → A3 → A5 (gated on A3 report) → A6 → A4 → B4 → B3 → B2 → B1 → B5 → final review.

---

### Task C1: Roadmap ADR

**Files:** Create `docs/ENGINEER_ROADMAP.md`. Read-only: `docs/ENGINEER_PORTAL.md`, `docs/ENGINEER_VERIFICATION.md` (§4 + §Changed Sep 2026).

**Interfaces:** Consumes: §4 open items (battery bank-qty rule, stale verification snapshots, old verdict after reassignment, mismatch alerts, GPS spoofability, per-page activities lookup perf) + already-decided items (`front_indication` deleted per user confirm). Produces: per-item status.

- [ ] §4 ke har item ke liye entry: current state (docs se), options, recommendation, status — already-decided → terminal status (Closed/Rejected); open product calls → **Deferred** (reason: explicit product decision pending; code sirf approval pe).
- [ ] Doc save; koi aur file touch nahi; **commit mat karo** (review ke baad coordinator karega).

**Verify:** Har §4 item covered hai, har status ke saath reason hai.

### Task A2: Apply runbook + smoke (USER MANUAL)

**Files:** none (live DB).

- [ ] Supabase SQL editor me order se apply: `22000001 → 22000002 → 22000003 → 12000002 → 22000004 → 22000005 → 22000006 → 22000007`. 22000007 ke NOTICEs capture karo.
- [ ] Ledger §0 post-apply queries + §1–§2 smoke matrix (engineer login: assigned-only, own update OK / other's 0 rows; GRN cancel; FSR retry = 1 row).

**Verify:** Ledger ke saare expectations pass.

### Task A3: Assignee backfill migration

**Files:** Create `supabase/migrations/20260923000001_backfill_assignee_links.sql`.

- [ ] `tickets.assigned_employee_id` backfill from `assigned_engineer_name` → `employees.name` exact match; WHERE-guarded + idempotent.
- [ ] Unmatched count `RAISE NOTICE` (diagnostic — A5 ka gate).
- [ ] `fk_tickets_assigned_employee` re-VALIDATE attempt (guarded).
- [ ] Scratch PG pe 2× apply, 0 errors. **Commit mat karo.**

**Verify:** Backfill query se 0 unmatched (ya NOTICE me exact count).

### Task A4: Constraint VALIDATE migration

**Files:** Create `supabase/migrations/20260923000002_validate_integrity_constraints.sql`.

- [ ] A2 ke NOTICE report queries ke bad rows fix (user data task), phir guarded re-check + `VALIDATE` saare NOT VALID constraints pe; idempotent, kabhi fail nahi.
- [ ] Scratch PG clean + dirty dono paths pe test. **Commit mat karo.**

**Verify:** `pg_constraint` me sab `convalidated = true`.

### Task A5: RLS name-fallback removal

**Files:** Create `supabase/migrations/20260923000003_remove_name_fallback_rls.sql`.

- [ ] 22000004 ki 4 policies (tickets SELECT, tvis/tcv/tev UPDATE, assignment_history SELECT, engineer-uploads SELECT) DROP+CREATE **bina** name-equality leg — FK + admin path only.
- [ ] **GATE:** sirf tab dispatch jab A3 report me unmatched = 0; warna user se confirm.
- [ ] **Commit mat karo.**

**Verify:** Engineer A (FK) full access; name-only engineer → 0 rows (expected).

### Task A6: Code fallback removal

**Files:** Modify `src/lib/engineer-identity.ts`; tests `src/lib/__tests__/ticket-assignee.test.ts` (+ jahan name-fallback ho).

- [ ] `resolveEngineerIdentity` / `assertTicketAssignee` se name-match leg hatao; tests FK-only.
- [ ] `bun run test`, `bunx tsc --noEmit` green. **Commit mat karo.**

**Verify:** 804 baseline green, tsc clean.

### Task B1: grn_id/dc_id FK (big feature)

**Files:** Create `supabase/migrations/20260923000004_ticket_grn_dc_fk.sql` (+ types B2 me).

- [ ] `tickets.grn_id/dc_id` uuid + FKs NOT VALID; backfill from `grn_no`/`challan_no`; `tickets_clear_grn/dc_on_cancel` ID-based (stamp-equality hatao).
- [ ] Scratch PG 2×; old-vs-new cancel semantics; multi-ticket GRN behavior preserved.
- [ ] **Commit mat karo.**

**Verify:** GRN cancel → sirf us ticket ka stamp clears.

### Task B2: Regenerate types

**Files:** Modify `src/integrations/supabase/types.ts`. **Blocked: project token.**

- [ ] Access milte hi gen-types → diff review → `tsc` clean. **Commit mat karo.**

### Task B3: setup.sql trap removal

**Files:** Modify (ya delete) `supabase/setup_new_supabase.sql`.

- [ ] Migrated DB se regenerate (user dump) ya delete; docs sirf migrations point karein.

### Task B4: Verify harness

**Files:** Create `scripts/verify-eng-live.sql`; Modify `docs/ENGINEER_VERIFICATION.md`.

- [ ] A2 ke post-apply checks parameterized read-only SQL me; docs me one-command runbook.

**Verify:** Live DB pe clean (reads only).

### Task B5: Fresh-reset CI script

**Files:** Create `scripts/verify-migrations.sh`.

- [ ] Local docker `supabase db reset` + har migration 2× apply + zero-error assert. **Local env only — remote kabhi nahi.**

**Verify:** Exits 0 locally.

## Rulings

- R1: A1 pre-flight audit user ne defer kiya — A3 ka backfill NOTICE diagnostic banega; A5/A6 A3 clean report pe gated.
- R2: Open product-call items default **Deferred** — code sirf user approval pe.
- R3: Implementers commit nahi karenge — coordinator review ke baad atomic commit karega.
