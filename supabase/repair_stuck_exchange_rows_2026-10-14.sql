-- =============================================================================
-- One-time repair: unstick oracles with blank Section-B (exchange) fields.
-- DATE: 2026-10-14. DBA runs it; read the audit before touching anything.
--
-- HOW IT WORKS: the UPDATEs below are deliberate no-ops (SET status = status).
-- They exist only to fire the backfill triggers for rows that predate them:
--   - settled LINKED DCs  -> trg_dc_backfill_exchange_rows (new, Part 1 of
--                            20261014000000_oracle_close_hardening.sql)
--   - settled LINKED GRNs -> trg_grn_backfill_oracle_rows (existing)
-- The triggers fill ONLY blank fields, never overwrite, then the existing
-- trg_indents_autoclose_oracles chain closes blocks that are now complete.
--
-- PREREQUISITE: apply 20261014000000_oracle_close_hardening.sql FIRST
-- (supabase db push), otherwise the DC touch does nothing.
--
-- IDEMPOTENT: re-running is safe. Step 3 must return zero rows when done.
-- ROLLBACK: restore oracles_data / DC / GRN rows from a pre-run backup.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 0 — AUDIT (read-only). Run first; proceed only if you agree with it.
-- Open blocks with blank Section-B model/serial that have a LINKED settled DC.
-- -----------------------------------------------------------------------------
SELECT i.id AS indent_id, i.indent_no, i.case_id,
       blk->>'oracle_no' AS oracle_no,
       (SELECT count(*)
          FROM jsonb_array_elements(COALESCE(blk->'exchange_rows', '[]')) r
         WHERE COALESCE(btrim(r->>'model_no'), '') = ''
            OR COALESCE(btrim(r->>'serial_no'), '') = '') AS blank_b_rows,
       (SELECT string_agg(DISTINCT d.challan_no, ', ')
          FROM public.delivery_challans d,
               LATERAL jsonb_array_elements(COALESCE(d.items, '[]')) it
         WHERE d.indent_id = i.id
           AND COALESCE(d.status, '') IN ('Submitted', 'Closed', 'Challan Generated')
           AND lower(COALESCE(d.status, '')) <> 'cancelled'
           AND upper(btrim(COALESCE(it->>'oracle_no', '')))
             = upper(btrim(COALESCE(blk->>'oracle_no', '')))) AS linked_settled_dcs
  FROM public.indents i,
       LATERAL jsonb_array_elements(COALESCE(i.oracles_data, '[]')) AS blk
 WHERE COALESCE(blk->>'status', 'open') NOT IN ('closed', 'force_closed')
   AND EXISTS (SELECT 1
                 FROM jsonb_array_elements(COALESCE(blk->'exchange_rows', '[]')) r
                WHERE COALESCE(btrim(r->>'model_no'), '') = ''
                   OR COALESCE(btrim(r->>'serial_no'), '') = '');

-- -----------------------------------------------------------------------------
-- STEP 0b — AUDIT legacy/unlinked DCs (informational; NOT auto-touched).
-- These reference oracles by reference_no/items only (indent_id IS NULL) and
-- are deliberately ignored by the closer. Link them manually if legit.
-- -----------------------------------------------------------------------------
SELECT d.id AS dc_id, d.challan_no, d.status, d.reference_no,
       it->>'oracle_no' AS oracle_no
  FROM public.delivery_challans d,
       LATERAL jsonb_array_elements(COALESCE(d.items, '[]')) it
 WHERE d.indent_id IS NULL
   AND lower(COALESCE(d.status, '')) <> 'cancelled'
   AND COALESCE(d.status, '') IN ('Submitted', 'Closed', 'Challan Generated');

-- -----------------------------------------------------------------------------
-- STEP 1 — Touch linked settled DCs for blocks with blank Section B.
-- No-op assignment; fires trg_dc_backfill_exchange_rows per row.
-- -----------------------------------------------------------------------------
UPDATE public.delivery_challans d
   SET status = d.status
 WHERE d.indent_id IS NOT NULL
   AND COALESCE(d.status, '') IN ('Submitted', 'Closed', 'Challan Generated')
   AND lower(COALESCE(d.status, '')) <> 'cancelled'
   AND EXISTS (SELECT 1
                 FROM public.indents i,
                      LATERAL jsonb_array_elements(COALESCE(i.oracles_data, '[]')) blk,
                      LATERAL jsonb_array_elements(COALESCE(d.items, '[]')) it
                WHERE i.id = d.indent_id
                  AND COALESCE(blk->>'status', 'open') NOT IN ('closed', 'force_closed')
                  AND upper(btrim(COALESCE(it->>'oracle_no', '')))
                    = upper(btrim(COALESCE(blk->>'oracle_no', '')))
                  AND EXISTS (SELECT 1
                                FROM jsonb_array_elements(COALESCE(blk->'exchange_rows', '[]')) r
                               WHERE COALESCE(btrim(r->>'model_no'), '') = ''
                                  OR COALESCE(btrim(r->>'serial_no'), '') = ''));

-- -----------------------------------------------------------------------------
-- STEP 2 — Touch settled linked GRNs for blocks with blank Section C/D
-- backfillable fields. No-op assignment; fires trg_grn_backfill_oracle_rows.
-- -----------------------------------------------------------------------------
UPDATE public.grns g
   SET status = g.status
 WHERE g.indent_id IS NOT NULL
   AND COALESCE(g.status, '') IN ('Submitted', 'Closed')
   AND lower(COALESCE(g.status, '')) <> 'cancelled'
   AND EXISTS (SELECT 1
                 FROM public.indents i,
                      LATERAL jsonb_array_elements(COALESCE(i.oracles_data, '[]')) blk,
                      LATERAL jsonb_array_elements(COALESCE(g.items, '[]')) it
                WHERE i.id = g.indent_id
                  AND COALESCE(blk->>'status', 'open') NOT IN ('closed', 'force_closed')
                  AND upper(btrim(COALESCE(it->>'oracle_no', '')))
                    = upper(btrim(COALESCE(blk->>'oracle_no', '')))
                  AND (EXISTS (SELECT 1
                                 FROM jsonb_array_elements(COALESCE(blk->'received_rows', '[]')) r
                                WHERE COALESCE(btrim(r->>'warehouse_id'), '') = ''
                                   OR COALESCE(btrim(r->>'received_date'), '') = '')
                    OR EXISTS (SELECT 1
                                 FROM jsonb_array_elements(COALESCE(blk->'customer_received_rows', '[]')) r
                                WHERE COALESCE(btrim(r->>'warehouse_id'), '') = ''
                                   OR COALESCE(btrim(r->>'received_date'), '') = ''
                                   OR COALESCE(btrim(r->>'product_tag'), '') = '')));

-- -----------------------------------------------------------------------------
-- STEP 3 — Re-run the STEP 0 audit. Expect zero rows.
-- Any remaining rows have NO linked settled document: they need genuine
-- manual entry in Section B/C/D (or a manually linked legacy DC, see 0b).
-- -----------------------------------------------------------------------------
