# Controlled GRN Edit + Oracle Reopen

Both flows are admin-only, require a reason, reverse stock before re-posting, and write to `document_deletion_audit` (repurposed as a general document action audit — no schema change).

## Part 1 — Controlled GRN Edit

### Backend (single migration)
- `admin_edit_grn_reverse(_id uuid, _reason text)` — SECURITY DEFINER. Verifies admin + reason. Refuses if the GRN's stock has been consumed downstream (any `ims_stock_items` with `transaction_ref = 'GRN <no>'` in status other than `available`/`scrapped`) — same guard as `admin_delete_grn`. Refuses if any `invoice_items.serial_numbers` overlaps the GRN's serials. Then: deletes `ims_stock_items` + `ims_transactions` where `reference = 'GRN <no>'`, snapshots the row into `document_deletion_audit` with `document_type = 'grn_edit_reverse'`, and flips GRN back to `Draft` (records `submitted_at=null`, keeps history in audit).
- Re-posting on next Submit already happens via existing `grn_post_inventory` trigger.

### Frontend
- `src/routes/_app/grn.$id.tsx`: add **Edit GRN** button (admin only, status = Submitted, no linked invoice). Opens a reason dialog → calls the RPC → navigates to `/grn/:id/edit`. Shows warning copy. If invoice linked (detected via `invoice_items.serial_numbers` overlap query), disable and show "Create correction entry instead".
- Add **Edited** badge when `document_deletion_audit` has a `grn_edit_reverse` row for this GRN.
- `src/components/GrnForm.tsx`: when editing a GRN whose indent link is set, keep existing `sourceLocked` behaviour so Item / Model / Indent link can't change. Serial No, Qty, Warehouse, QC fields remain editable (already the case).

## Part 2 — Controlled Oracle Reopen

Oracle = a block inside `indents.oracles_data`. "Closed" = `_oracle_block_complete = true` (auto-closed logic). "Reopen" = mark a block as manually reopened and reverse its documents.

### Backend (same migration)
- `admin_reopen_oracle(_indent_id uuid, _oracle_no text, _reason text, _scope text)` — SECURITY DEFINER, admin-only.
  - `_scope in ('grn','dc','full')`.
  - Refuse if any invoice references serials from GRNs tied to this indent (block with "Invoice exists…").
  - GRN scope: for each Submitted GRN on the indent, run the same reverse logic as Part 1 and flip status to `Draft` (audit type `grn_reopen`).
  - DC scope: for each Challan-Generated DC on the indent, mark stock items back to `available`, delete `ims_transactions` where `reference = 'DC <no>'`, flip DC to `Draft` (audit type `dc_reopen`).
  - Full scope: both.
  - Sets a flag on the oracle block: `oracles_data[i].reopened = { at, by, reason, scope }` (jsonb patch in-place; no schema change).
  - Recomputes indent status via existing `recalc_indent_status`.

### Frontend
- `src/routes/_app/indent.$id.tsx`: in each Oracle block header, if the block is complete AND user is admin, show **Reopen Oracle** button. Dialog captures reason + scope radio (GRN / DC / Full). Confirm → RPC → refresh.
- Show **Reopened** badge in the block header when `reopened` flag is present. Also list on `indent.index.tsx` grid.
- Block button when invoice guard triggers (RPC returns a known error string).

## Audit Trail
Both RPCs write to `document_deletion_audit` with:
- `document_type` = `grn_edit_reverse` | `grn_reopen` | `dc_reopen`
- `document_no`, `document_id`, `reason`, `deleted_by = auth.uid()`, `snapshot = to_jsonb(row)`

Existing `AdminDeleteDialog` view of audit already surfaces these.

## Files touched
- 1 new migration (functions only, no schema change).
- `src/routes/_app/grn.$id.tsx` — Edit GRN button, invoice-lock guard, Edited badge, reason dialog.
- `src/components/GrnForm.tsx` — no logic change; already supports the constrained edit surface.
- `src/routes/_app/indent.$id.tsx` — Reopen Oracle button + dialog per block.
- `src/routes/_app/indent.index.tsx` — Reopened badge.
- `src/lib/indent.ts` — small helper `isOracleReopened(block)`.

## Out of scope
- No changes to `grn_post_inventory` / `dc_post_inventory` triggers — they already handle the re-submit path correctly once status flips back.
- No new tables, no column additions.
