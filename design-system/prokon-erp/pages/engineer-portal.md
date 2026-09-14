# Engineer Portal — Page-Level Design Brief

> **Precedence:** this page brief **overrides** `design-system/prokon-erp/MASTER.md` where they conflict.
> **Token anchor:** this doc anchors to the **LIVE** app tokens in `src/styles.css`, not to MASTER.md.
> **Known divergence (stated once):** MASTER.md specifies an aspirational Outfit/Work Sans pairing and a blue `#2563EB` primary; neither was implemented. The live app uses **Navy `#1E3A5F` primary + Inter**, glacier canvas, `oklch` values, light-first theming, and `--radius: 0.625rem` (10px base). Follow the live values below.

---

## 1. Scope + Mode + Audience

- **Scope:** mobile-first field-service portal: ticket queue → ticket workspace → FSR (field service report) form → profile.
- **Mode: Operate.** A field engineer completes service tickets on a phone, often one-handed. Every surface optimizes for task completion speed, not browsing.
- **Audience:** UPS field engineers with gloved hands, flaky 4G, 360–430px phones, direct sunlight. Design for fat-finger taps, offline-tolerant flows (skeleton loaders, retryable errors), and high-contrast legibility outdoors.
- **Viewport contract:** 360px minimum. Phone-first single column; `fk-grid` collapses to one field per row ≤540px (per `styles.css`). Cap fixed-width utilities (`w-56/60/72`) to 100% ≤375px.

## 2. Brand Tokens (LIVE — from `src/styles.css`)

| Role | Live value | Token |
|------|-----------|-------|
| Primary (Navy) | `#1E3A5F` → `oklch(0.32 0.08 250)` | `--primary` / `--ring` |
| Canvas | `#F1F5F9` glacier → `oklch(0.968 0.008 260)` | `--background` |
| Card | white → `oklch(1 0 0)` | `--card` |
| Secondary (blue) | `#2563EB` → `oklch(0.54 0.19 260)` | `--secondary` |
| Success accent (emerald) | `#059669` → `oklch(0.60 0.12 164)` | `--accent` |
| Destructive (red) | `oklch(0.58 0.22 27)` | `--destructive` |
| Foreground | `#0F172A` | `--foreground` |
| Muted fg | `#475569` | `--muted-foreground` |
| Border / input | `#E2E8F0` | `--border` / `--input` |

- **Type:** Inter (`ui-sans-serif, system-ui…` stack), `font-size: 15px` root, `line-height: 1.5`.
- **Radius:** base 10px (`--radius: 0.625rem`); inputs 8px (`--radius-sm`); cards 12px (fk-section); bottom sheets 16px top. Derived scale (`sm/md/lg/xl…`) only — never hardcoded px outside tokens.
- **Color discipline:** all colors in `oklch`; light-first with `.dark` overrides. Reference semantic tokens (`bg-card`, `text-muted-foreground`, `border-border`), never raw hexes.
- **Chrome:** white header (`--header`), dark navy sidebar `#0F2340` (desktop only — hidden on the portal), 5%-opacity watermark behind all UI (keep clear of primary actions).

## 3. Mobile Type Scale

| Use | Spec |
|-----|------|
| Eyebrow / section kicker | 11px, uppercase, `tracking-wide` |
| Meta (timestamps, ticket IDs, helper) | 12px, `text-muted-foreground` |
| Labels | 13px, medium |
| Body | 14–15px |
| Card titles | 14px, semibold |
| Section titles | 15px, semibold |
| Display (ticket no., key figures) | 18px+ |
| Table headers | `all-small-caps`, `letter-spacing: 0.06em` |

**Floor: never below 11px for functional text.** At 11–12px use `muted-foreground` only where contrast still passes 4.5:1; critical values stay `foreground`.

## 4. Touch Floor — 44px Minimum

- Every text input / select / combobox trigger: `h-11` (44px).
- Every button: `min-h-11`. Full-width primary actions in sticky bars.
- Every tappable row (queue cards, timeline entries, tab items): minimum 44px hit area.
- Icon-buttons: 44×44 hit area (visual icon may be 20px, padding makes up the rest).
- Checkboxes / radios: wrapped in `min-h-11` label rows so the whole row toggles.
- Why: gloved hands on 360px screens. Dense desktop heights (30–36px form-kit `compact`) are **forbidden** on portal surfaces.

## 5. Spacing Rhythm

- `space-y-3` between cards in a scroll column.
- `p-4` card padding on mobile.
- **One nested scale only:** a card may contain one inner spacing group (e.g. a field stack), never cards-in-cards-in-rows. Depth comes from dividers and section headers, not nesting.
- Section gaps ≥20px (`--form-section-gap`); field gaps 10px.
- Sticky bars get their own padding layer — content never touches a fixed edge.

## 6. Safe-Area + Fixed Bars

- Bottom tab nav **and** every sticky submit bar: `padding-bottom: env(safe-area-inset-bottom)`.
- Scroll content gets bottom padding ≥ (sticky bar height + safe-area) so the last action is never covered.
- No content hidden behind fixed navbars; no horizontal scroll at 360px.

## 7. Status + Feedback

- **StatusBadge tones:** `neutral` (draft/queued) · `info` (assigned/in-progress, blue) · `success` (completed/verified, emerald) · `warning` (overdue/attention, amber) · `danger` (failed/cancelled, red). Tone comes from ticket state, never decoration.
- **Toasts:** sonner for all transient confirmations (saved, submitted, photo uploaded, note added). Errors that block progress also get inline/persistent treatment — toasts alone are not enough for failures.
- **Inline field errors:** red message + `aria-describedby` under the offending field on FSR validation; sticky submit stays enabled so the engineer can re-attempt (or disabled **only** with helper text saying why — see anti-patterns).
- **Loading:** skeleton loaders for queue, workspace, and timeline fetches. Never blank flashes, never layout-jumping spinners.
- **Empty:** `EmptyState` (icon + line + CTA) for empty queue/filter-no-result.
- **Hard errors:** real error cards with message + **Retry** button. Never fake "not found" for fetch failures; distinguish empty (no tickets) from failed (couldn't load).

## 8. Motion

- 150–250ms transitions only (`transition-all 200ms ease` baseline).
- `prefers-reduced-motion`: disable parallax/transforms, render static final state.
- **No scroll-triggered animation on tool surfaces.** Queue, workspace, and FSR are tools — content appears immediately; motion is limited to state feedback (button press, toast in/out, drawer slide).

## 9. Component Patterns

- **Sticky step progress:** stepper pinned under the workspace header; current step highlighted, completed steps checkmarked; tappable to revisit completed steps.
- **Verification decisions as 44px segmented Yes/No:** two equal `min-h-11` segments, single-select. Negative ("No / mismatch") uses the **warning** tone — NOT destructive red (red implies deletion; a failed check is information, not destruction).
- **Corrections + mismatch flows in bottom Drawer sheets** (`vaul` `ui/drawer`, 16px top radius): serial/model correction, photo-mismatch resolution, note add. Sheets keep workspace context visible behind the scrim and are thumb-reachable. Full modals reserved for destructive confirms.
- **Phase sections as numbered section cards:** FSR phases render as `fk-section` cards (12px radius, white on glacier) with numbered headers (Phase 1/2/3), single scroll — no per-phase routing.
- **Sticky full-width submit bar:** primary action (Save progress / Submit FSR) pinned above the safe-area with full-width `min-h-11` button; secondary actions as ghost/link beside or above it.
- **Timeline with icons + formatted times:** vertical timeline, lucide icon per event type, human-formatted timestamps (`14:32`, not ISO), most-recent-first; loading → skeleton rows, failure → error card + Retry.

## 10. Anti-Patterns (from the audit — all forbidden)

1. **No nested Cards** — one card level per surface; use dividers/sections inside.
2. **No text under 11px** for any functional text.
3. **No ASCII glyphs** (`→`, `✓`, `×`, `*`) as iconography — lucide only.
4. **No destructive-red for non-destructive choices** — e.g. "No" on a verification check is `warning`, never `destructive`.
5. **No dead disabled buttons without helper text** — a disabled submit must say why and how to unblock.
6. **No hardcoded `gray-500` / emerald / red hexes** — use semantic tokens (`muted-foreground`, `accent`, `destructive`).
7. **No unstyled native file inputs** — photo capture uses the styled upload control (44px trigger, preview thumb, progress state).
8. **No silent note-drops** — every note add gets explicit confirmation (toast + timeline entry); failed saves surface an error with Retry, never vanish.

(Plus inherited MASTER.md bans: no emojis as icons, no layout-shifting hovers, visible focus states, 4.5:1 contrast, `cursor-pointer` on clickables.)

## 11. Per-Surface Notes

- **Eng shell (header + bottom tabs):** white compact header — back affordance, ticket/context title (14 semibold), overflow actions only. Bottom tab bar (Tickets / Scan / Profile or equivalent) with 44px targets, active tab in Navy, `env(safe-area-inset-bottom)` padding. Desktop sidebar/nav hidden; shell is phone-only chrome.
- **Queue (search + sections + cards):** sticky search (h-11) under header; list grouped into sections (Today / Upcoming / Completed) with 11px uppercase kickers; one ticket per white `p-4` card — ticket no. (display 18), customer/site (body 14), time-window + StatusBadge (meta 12), full-card 44px+ tap target to workspace. Empty filter → EmptyState; fetch fail → error card + Retry; loading → skeleton cards.
- **Ticket workspace (header/call/back, stepper, steps, notes, photo, timeline):** header with back, ticket display title, and tap-to-call customer action (44px). Sticky stepper (To-verify → Service → FSR). Step 1: asset/serial verification with segmented Yes/No + correction Drawer on mismatch. Step 2: service checklist with `min-h-11` check rows. Step 3: FSR summary entry leading into the full form. Notes via bottom Drawer with save confirmation. Photo capture via styled control (never native). Timeline (icons + formatted times) closes the page; sticky bottom bar carries the primary next action.
- **FSR form (3 phases single scroll + sticky progress + sticky submit):** all three phases as numbered `fk-section` cards in one scroll; sticky mini-progress (Phase 1/2/3 dots or bar) under the header; one nested spacing scale; inline field errors with `aria-describedby`; sticky full-width submit bar (safe-area padded) with Save-draft secondary. No per-phase navigation, no nested cards, no sub-11px text.
- **Profile:** single-column settings surface — engineer identity card (name, role, contact), then `min-h-11` tappable rows (shift, territory, notifications, sign-out). Destructive (sign-out) isolated at the bottom in red with a confirm modal; everything else neutral rows. Skeleton on load, error card + Retry on failure.

---

## Pre-Delivery Checklist (portal additions to MASTER.md)

- [ ] Anchored to LIVE tokens (`styles.css`), not MASTER.md aspirational values
- [ ] 44px floor on every input, button, row, icon-button (`h-11` / `min-h-11`)
- [ ] No text under 11px; eyebrows 11 uppercase tracking-wide
- [ ] `space-y-3` / `p-4` rhythm, one nested scale, no nested Cards
- [ ] Safe-area padding on bottom nav + sticky bars; last action never covered
- [ ] Skeletons (never blank), EmptyState, real error cards + Retry
- [ ] Verification "No" is warning tone, never destructive
- [ ] Corrections/mismatch in `vaul` Drawer sheets, not full modals
- [ ] 150–250ms motion only, `prefers-reduced-motion` respected, no scroll animation
- [ ] Lucide icons only; semantic tokens only (no hardcoded hexes)
- [ ] 360px: single column, no horizontal scroll
