-- 20260929000002_invoice_compliance_cleanup.sql
-- Remove the fabricated IRN / malformed e-way values found by the 2026-09-21
-- audit, then add constraints so that class of value can never be stored
-- again.
--
--   Docs: docs/GSP_INTEGRATION_AND_TALLY_EXPORT.md §12
--         docs/adr/0003-gsp-mock-first.md
--
-- AUTHOR ONLY — this harness must never push to Supabase. Apply via the
-- Supabase SQL editor. READ STEP 0 FIRST and confirm the row counts match the
-- audit before running step 2.
--
-- ─────────────────────────────────────────────────────────────────────────
-- STEP 0 — INSPECT (run this first, read the output, then continue)
--
--   select
--     count(*) filter (where irn is not null)                                  as invoices_with_irn,
--     count(*) filter (where irn is not null
--                        and lower(irn) = repeat(lower(substr(irn, 1, 8)), 8))  as fabricated_irn,
--     count(*) filter (where ewaybill_no is not null
--                        and ewaybill_no !~ '^[0-9]{12}$')                     as malformed_ewaybill
--   from public.invoices;
--
-- The audit reported fabricated_irn = 4 and malformed_ewaybill = 3.
-- If those numbers have changed, someone has touched the data since —
-- stop and re-audit rather than blindly proceeding.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Why these UPDATEs do not trip the IRN lock trigger:
-- `assert_no_edit_after_irn()` only raises when a *financial* column changes
-- (taxable_value, cgst, sgst, igst, total, gstins, sales_type, transport,
-- discount, round_off, billing_address). We are only clearing the compliance
-- columns, so the trigger correctly permits it.

-- ── 1. Clear fabricated IRNs ───────────────────────────────────────────────
-- `mockIrnPayload()` produced `hash8.repeat(8)`. Real SHA-256 output never
-- repeats an 8-char block 8 times, so this predicate is exact.
update public.invoices
set irn             = null,
    ack_no          = null,
    ack_date        = null,
    qr_payload      = null,
    signed_qr       = null,
    einvoice_status = case when einvoice_status = 'generated' then 'pending'
                           else einvoice_status end,
    einvoice_error  = 'cleared 2026-09-25: fabricated IRN from deprecated mockIrnPayload(); invoice never had a real IRN'
where irn is not null
  and lower(irn) = repeat(lower(substr(irn, 1, 8)), 8);

-- ── 2. Clear malformed e-way bill numbers ───────────────────────────────────
-- The bad values were 'EWB'-prefixed 14-char strings. A real EwbNo is 12 digits.
update public.invoices
set ewaybill_no         = null,
    ewaybill_date       = null,
    ewaybill_valid_till = null,
    eway_status         = case when eway_status = 'generated' then 'pending'
                               else eway_status end
where ewaybill_no is not null
  and ewaybill_no !~ '^[0-9]{12}$';

-- Keep the eway_bills side table consistent with the header.
update public.eway_bills
set ewb_no    = null,
    ewb_date  = null,
    valid_till = null,
    status    = case when status = 'generated' then 'pending' else status end,
    error     = 'cleared 2026-09-25: malformed e-way bill number (not 12 digits)'
where ewb_no is not null
  and ewb_no !~ '^[0-9]{12}$';

-- ── 3. Guard constraints ───────────────────────────────────────────────────
-- A real IRN is a 64-hex SHA-256 digest. Rejecting the repeated-block pattern
-- makes the retired mock's output unstorable, at the database level, even if
-- some future code path tries to write it.
alter table public.invoices
  drop constraint if exists invoices_irn_not_repeated_block;

alter table public.invoices
  add constraint invoices_irn_not_repeated_block
  check (irn is null or lower(irn) <> repeat(lower(substr(irn, 1, 8)), 8));

-- An e-way bill number is exactly 12 digits, stored as text to avoid numeric
-- precision loss and to match the app's EWB_REGEX.
alter table public.invoices
  drop constraint if exists invoices_ewaybill_is_12_digits;

alter table public.invoices
  add constraint invoices_ewaybill_is_12_digits
  check (ewaybill_no is null or ewaybill_no ~ '^[0-9]{12}$');

-- Same guarantee on the side table, so a bad value cannot enter there either.
alter table public.eway_bills
  drop constraint if exists eway_bills_ewb_no_is_12_digits;

alter table public.eway_bills
  add constraint eway_bills_ewb_no_is_12_digits
  check (ewb_no is null or ewb_no ~ '^[0-9]{12}$');

-- ── 4. Verification (run after applying) ───────────────────────────────────
-- Expect fabricated_irn = 0 and malformed_ewaybill = 0.
--
--   select
--     count(*) filter (where irn is not null
--                        and lower(irn) = repeat(lower(substr(irn, 1, 8)), 8))  as fabricated_irn,
--     count(*) filter (where ewaybill_no is not null
--                        and ewaybill_no !~ '^[0-9]{12}$')                     as malformed_ewaybill
--   from public.invoices;
--
-- Expect 2 rows.
--   select conname from pg_constraint
--    where conname in ('invoices_irn_not_repeated_block',
--                      'invoices_ewaybill_is_12_digits',
--                      'eway_bills_ewb_no_is_12_digits');
--
-- IMPORTANT — this is an accounting question, not a software one.
-- If any of the cleared invoices were actually issued to customers as GST
-- invoices, those supplies were non-compliant and may need a real IRN or a
-- revised document. Raise this with the CA/accountant before treating the
-- database as clean. See docs/GSP_INTEGRATION_AND_TALLY_EXPORT.md §12.
