# Engineer Module — Roadmap (Product Decisions)

Source: `docs/ENGINEER_PORTAL.md` (product rules + Changed Sep 2026), `docs/ENGINEER_VERIFICATION.md` (§3–§4). Ruling R2: open product calls default **Deferred** — code only on explicit product approval.

## 1. Battery readings vs bank-qty enforcement
- **Current state:** No blocking rule enforced; flagged as known open product question (`ENGINEER_PORTAL.md` Changed Sep 2026) and §4 left-open item.
- **Options:** (a) block save when readings count ≠ bank qty; (b) warn-only banner, allow save; (c) no check.
- **Recommendation:** (b) warn-only first, then graduate to (a) after field feedback.
- **Status:** Deferred — explicit product decision pending; code only on approval.

## 2. Stale verification snapshots after admin edits
- **Current state:** Originals never replaced; corrections sit beside originals (product rule 2). Stale snapshots persist after admin edits — pre-existing v1 limit (product doc §12, verification §4).
- **Options:** (a) snapshot-refresh on admin edit; (b) staleness banner on workspace; (c) leave as-is.
- **Recommendation:** (b) banner as minimal safe step; (a) only if product wants rewrite semantics.
- **Status:** Deferred — explicit product decision pending; code only on approval.

## 3. Old verdict visible after reassignment
- **Current state:** One verification row per ticket; re-verify overwrites verdict, timeline keeps both notes (product rule 6). Old verdict remains visible after reassignment — pre-existing v1 limit (§4).
- **Options:** (a) clear/hide verdict on reassignment; (b) show prior verdict with "previous assignee" label; (c) leave as-is.
- **Recommendation:** (b) label prior verdict; never silently delete (rule 2).
- **Status:** Deferred — explicit product decision pending; code only on approval.

## 4. Mismatch alerts
- **Current state:** Equipment mismatch needs serial-plate photo + live GPS or save blocks (product rule 3), but no mismatch alerting exists — pre-existing v1 limit (§4).
- **Options:** (a) admin/push alert on mismatch verdict; (b) timeline-only flag; (c) leave as-is.
- **Recommendation:** (a) alert on mismatch verdict once channel is decided.
- **Status:** Deferred — explicit product decision pending; code only on approval.

## 5. GPS spoofability
- **Current state:** Matched verdicts carry best-effort GPS (§3); spoofability acknowledged as pre-existing v1 limit (product doc §12, portal Changed Sep 2026 → verification §4).
- **Options:** (a) spoof-detection heuristics (mock-location flag, accuracy threshold); (b) require photo+GPS cross-check only (current); (c) hardware attestation.
- **Recommendation:** (a) lightweight accuracy/mock-location gate; (c) out of scope for v1.
- **Status:** Deferred — explicit product decision pending; code only on approval.

## 6. `useTicketsTable` per-page activities lookup (perf)
- **Current state:** Per-page activities lookup pattern on admin side; flagged §4 as perf pattern, not a bug.
- **Options:** (a) batch/join fetch per page; (b) lazy-load on expand; (c) leave as-is.
- **Recommendation:** (a) batch fetch when admin side is next touched.
- **Status:** Deferred — explicit product decision pending; code only on approval.

## 7. Legacy permissive-era exposure window
- **Current state:** Closed in-file-order per §4; no action required.
- **Options:** None — already resolved by migration ordering.
- **Recommendation:** None.
- **Status:** Closed — resolved in-file-order; no action.

## 8. `front_indication` column removal
- **Current state:** Dropped by `20260919000001` per product decision; user confirmed leave deleted; `rating` and related columns untouched (§4).
- **Options:** None — decision already taken.
- **Recommendation:** None.
- **Status:** Closed — user-confirmed product decision; leave deleted.

## 9. Admin Assistant classification
- **Current state:** Exact-match-first admin check shipped (§3); `Admin Assistant` no longer reads as admin; 11 classification tests green.
- **Options:** None — already implemented and verified.
- **Recommendation:** None.
- **Status:** Closed — implemented and verified.
