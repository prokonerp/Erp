# Ticket Module Overhaul

## A. Configurable Ticket ID

**DB migration:**
- Create `ticket_settings` (singleton row, id=1): `prefix text default 'TKT'`, `updated_at`.
- Create `ticket_sequence` (singleton, id=1): `last_seq bigint default 0`. Function `next_ticket_seq()` does `UPDATE ... RETURNING last_seq+1` atomically.
- Create `call_type_master(id, name unique, created_at)` seeded with existing `CALL_TYPES`.
- Add columns to `customers`: `sector text`, `city text` (already exists? check — if so reuse). Add `sector` only if missing.
- Add columns to `tickets`: `sector text`, `priority text default 'P3'`, `deleted_at timestamptz`, `raised_by_type text` (`internal`/`external`), `raised_by_name text`.
- Replace trigger `set_ticket_case_id`:
  ```
  prefix := (SELECT prefix FROM ticket_settings WHERE id=1);
  ts := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDDHH24MISS');
  seq := next_ticket_seq();
  NEW.case_id := prefix || ts || lpad(seq::text,3,'0');
  ```
- GRANTs + RLS on new tables (admin write via `has_role`, authenticated read).

## B. New Ticket Form (`tickets.new.tsx`)

- Reorder: Customer section first, then Product/Serial.
- Make phone/email/address inputs editable (remove `readOnly`).
- Rename "Location" → "City/Area"; add "Sector/Colony Name" above it.
- CustomerPicker prefills sector + city; both editable.
- Call type Select: load from `call_type_master`; "+ Add new" opens dialog to insert.

## C. Customer Master (`masters.customers.tsx`)

- Add `sector` and ensure `city` field in address editor / basic details.
- Persist to new columns; map back to ticket prefill.

## D. All Tickets Listing (`tickets.index.tsx`)

- Columns: replace Location with City/Area; add Sector/Colony, Priority (inline dropdown P1–P5), Raised By.
- Filter dropdown on City/Area (distinct values).
- Sort: closed tickets to bottom — order by `(status='Closed') asc, created_at desc`.
- Admin-only Delete (soft delete via `deleted_at`), confirmation `AlertDialog`. Filter out `deleted_at is not null` from list.
- Quick actions: Reassign Engineer popover (writes engineer + sends WhatsApp); when status=Closed show "Notify Customer" button.

## E. WhatsApp (`lib/tickets.ts`)

- Fix `waPhone`: strip all non-digits; if 10 digits prepend `91`; require non-empty.
- `waLink` uses `https://wa.me/<digits>?text=<encoded>`; refuse if no digits (toast).
- Ensure `encodeURIComponent` on message (already done).

## F. Ticket Detail (`tickets.$id.tsx`)

- Surface sector + city/area; allow priority change; engineer reassign notification.

## Files Touched

- New migration `supabase/migrations/<ts>_ticket_overhaul.sql`
- `src/lib/tickets.ts` (waPhone fix, helper for call types loader)
- `src/routes/_app/tickets.new.tsx` (reorder, editable, sector/city, dynamic call types)
- `src/routes/_app/tickets.index.tsx` (columns, filter, sort, priority inline, delete, quick actions)
- `src/routes/_app/tickets.$id.tsx` (sector/city fields + priority)
- `src/routes/_app/masters.customers.tsx` (sector field)
- `src/routes/_app/masters.tsx` or new `tickets.settings.tsx` route for admin prefix + call-type management
- `src/integrations/supabase/types.ts` regen after migration

## Technical Notes

- Sequence continuity preserved across prefix changes (single `ticket_sequence` row never reset).
- Soft delete: add `.is('deleted_at', null)` to all ticket queries.
- Backward compat: existing tickets keep old `TKT-####` case_ids; trigger only fires when case_id null/blank.
- Priority default `P3` for legacy rows via column default.

Proceeding to implement after approval.