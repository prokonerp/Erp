-- 20260902000004_print_audit_rpc.sql
-- Prokon ERP — S4 print audit race fix (atomic RPC) + L6 correctness
-- Branch: invoicing-module | Non-destructive: DDL only (function), zero rows deleted/modified
-- Idempotent: CREATE OR REPLACE, no DELETE/TRUNCATE, no data migration
-- Scope: atomic increment_invoice_print() to fix concurrent print_count race + audit log
-- Verify: cat supabase/migrations/20260902000004_print_audit_rpc.sql | head -n 120
-- Do NOT run supabase db push from this task — file creation only (local)

-- =============================================================================
-- S4: Atomic RPC increment_invoice_print
--   p_invoice_id uuid, p_copies text[], p_theme_color text, p_copy_labels text, p_pdf_hash text
--   Steps (single transaction, atomic):
--     1) UPDATE invoices SET print_count=coalesce(print_count,0)+1,
--          last_printed_at=now(), last_printed_by=auth.uid(),
--          first_printed_at=coalesce(first_printed_at, now())
--        WHERE id=p_invoice_id RETURNING print_count
--     2) INSERT invoice_print_log with is_reprint = (new_count > 1)
--   No DELETE. SECURITY DEFINER. Grants to authenticated.
-- =============================================================================

create or replace function public.increment_invoice_print(
  p_invoice_id uuid,
  p_copies text[],
  p_theme_color text,
  p_copy_labels text,
  p_pdf_hash text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_count integer;
  v_is_reprint boolean;
begin
  -- Atomic increment + timestamp update; returns new print_count
  update public.invoices
    set print_count = coalesce(print_count, 0) + 1,
        last_printed_at = now(),
        last_printed_by = auth.uid(),
        first_printed_at = coalesce(first_printed_at, now())
    where id = p_invoice_id
    returning print_count into v_new_count;

  if v_new_count is null then
    raise exception 'Invoice % not found', p_invoice_id;
  end if;

  v_is_reprint := v_new_count > 1;

  -- Append-only audit insert (no update/delete)
  insert into public.invoice_print_log (
    invoice_id,
    copies,
    theme_color_snapshot,
    copy_labels_snapshot,
    pdf_hash,
    is_reprint,
    printed_by
  ) values (
    p_invoice_id,
    coalesce(p_copies, array[]::text[]),
    p_theme_color,
    p_copy_labels,
    p_pdf_hash,
    v_is_reprint,
    auth.uid()
  );

  return v_new_count;
end;
$$;

-- Grants: allow authenticated to execute; RLS on invoice_print_log still enforced via SECURITY DEFINER insert
grant execute on function public.increment_invoice_print(uuid, text[], text, text, text) to authenticated;
grant execute on function public.increment_invoice_print(uuid, text[], text, text, text) to service_role;

-- Optional: comment for discoverability
comment on function public.increment_invoice_print(uuid, text[], text, text, text) is 'S4 atomic print audit — increments invoices.print_count and inserts invoice_print_log with is_reprint=(new_count>1) in one transaction. No delete.';

-- Safety assertion: this file must contain zero DELETE FROM / TRUNCATE
-- Verify: ! grep -qi "delete from" supabase/migrations/20260902000004_print_audit_rpc.sql
-- Verify: ! grep -qi "truncate" supabase/migrations/20260902000004_print_audit_rpc.sql
