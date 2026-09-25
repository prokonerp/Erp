-- 20260930000001_create_invoice_with_items.sql
-- Prokon ERP — atomic invoice creation (header + line items in ONE transaction)
-- Branch: invoicing-module | Non-destructive: DDL only (function), zero rows deleted/modified
-- Idempotent: CREATE OR REPLACE, no DELETE/TRUNCATE, no data migration
--
-- WHY THIS EXISTS
--   The "New Invoice" route used to INSERT the `invoices` header, then INSERT
--   `invoice_items` in a SECOND round-trip. If the item insert failed, the app
--   issued a compensating `DELETE FROM invoices` — which still leaves a real
--   orphan window (the header is committed and visible to every other reader
--   before the delete lands, so a concurrent read/report can see a
--   line-item-less invoice, and a failed cleanup leaves a permanent orphan
--   header that a retry would then treat as "already done").
--   This RPC removes both the window and the compensating delete: a Postgres
--   function body runs inside a single transaction, so ANY failure (header or
--   items) rolls the whole thing back and leaves nothing behind.
--
-- HOW THE APP CALLS IT
--   supabase.rpc("create_invoice_with_items", {
--     p_header: <the invoices row as a jsonb object>,
--     p_items:  <array of invoice_items rows, WITHOUT invoice_id>,
--   })
--   Returns [{ id, invoice_no }]. `invoice_id` on every item row is assigned by
--   this function from the inserted header's id — callers must NOT send it.
--
-- RUN ONCE, BY A HUMAN
--   Authored only — the agent that wrote this file does not execute SQL, run
--   migrations, or push to Supabase. The app calls supabase.rpc(...) against a
--   live DB and will error with "function create_invoice_with_items does not
--   exist" until a human applies this migration.
--
-- AUTHORIZATION
--   SECURITY DEFINER means the insert runs with the function owner's rights and
--   therefore BYPASSES the `invoices_insert` / `invoice_items` RLS policies. That
--   policy currently requires admin OR has_permission('sales','create'), so the
--   guard below re-asserts exactly that condition — otherwise this RPC would
--   silently LOWER the bar and let any authenticated user create invoices.
--   Follows the same idiom as 20260923000005_guard_stock_rpcs.sql.
--
-- Verify: cat supabase/migrations/20260930000001_create_invoice_with_items.sql
-- Do NOT run supabase db push from this task — file creation only (local)

-- =============================================================================
-- public.create_invoice_with_items(p_header jsonb, p_items jsonb)
--   returns table (id uuid, invoice_no text)
--
--   Steps (single transaction — this IS the atomicity guarantee):
--     1) guard: direct authenticated callers need admin OR sales:create
--     2) validate p_header / p_items shape and reject unknown column names
--     3) INSERT the header, column list derived from p_header's own keys
--        (so every NOT NULL column the caller omits still gets its DEFAULT,
--         and adding a column to `invoices` needs no change here)
--     4) INSERT every item in one statement, stamping invoice_id from step 3
--
--   Any raise below aborts the surrounding transaction, which UNDOES the
--   header insert. There is no partial-write state and no compensating delete.
-- =============================================================================

create or replace function public.create_invoice_with_items(
  p_header jsonb,
  p_items  jsonb
) returns table (id uuid, invoice_no text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id         uuid;
  v_invoice_no text;
  v_cols       text;
  v_vals       text;
  v_bad        text;
  v_item_keys  constant text[] := array[
    'sr_no', 'product_id', 'description', 'hsn', 'qty', 'unit', 'rate',
    'discount_pct', 'taxable_value', 'gst_rate', 'cgst', 'sgst', 'igst',
    'cess', 'line_total', 'warehouse_id', 'serial_numbers'
  ];
begin
  -- ── 1) Authorization ──────────────────────────────────────────────────────
  -- Mirrors the invoices_insert RLS policy that SECURITY DEFINER bypasses.
  -- pg_trigger_depth() guard matches 20260923000005_guard_stock_rpcs.sql so a
  -- future trigger-internal call is not blocked; auth.uid() IS NULL (e.g.
  -- service_role server code) keeps working.
  if pg_trigger_depth() = 0
     and auth.uid() is not null
     and not (
       public.has_role(auth.uid(), 'admin'::app_role)
       or public.has_permission(auth.uid(), 'sales', 'create')
     ) then
    raise exception 'Only sales creators may call create_invoice_with_items directly';
  end if;

  -- ── 2) Shape checks (fail loud, never write a half-formed invoice) ─────────
  if p_header is null or jsonb_typeof(p_header) <> 'object'
     or p_header = '{}'::jsonb then
    raise exception 'create_invoice_with_items: p_header must be a non-empty JSON object';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'create_invoice_with_items: p_items must be a JSON array';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'create_invoice_with_items: p_items must contain at least one line item';
  end if;

  -- Unknown header key => typo or a payload field with no column. Silently
  -- dropping it would write a wrong (or defaulted) invoice, so reject instead.
  select string_agg(k, ', ' order by k) into v_bad
    from jsonb_object_keys(p_header) as k
   where not exists (
           select 1
             from pg_attribute a
            where a.attrelid = 'public.invoices'::regclass
              and a.attnum > 0
              and not a.attisdropped
              and a.attname = k
         );
  if v_bad is not null then
    raise exception 'create_invoice_with_items: unknown invoices column(s): %', v_bad;
  end if;

  -- Same guard for items. Note `invoice_id` is deliberately NOT accepted:
  -- it is assigned here, so a caller sending it is a bug worth failing on.
  select string_agg(distinct k, ', ' order by k) into v_bad
    from jsonb_array_elements(p_items) as it,
         lateral jsonb_object_keys(it) as k
   where k <> all (v_item_keys);
  if v_bad is not null then
    raise exception 'create_invoice_with_items: unknown invoice_items column(s): %', v_bad;
  end if;

  -- ── 3) Header insert ──────────────────────────────────────────────────────
  -- Build the column list from p_header's own keys. jsonb_populate_record does
  -- the jsonb -> column type casts (including the invoice_sales_type enum and
  -- the transport_details/compliance_json jsonb columns).
  select string_agg(format('%I', k), ', ' order by k),
         string_agg(format('(r).%I', k), ', ' order by k)
    into v_cols, v_vals
    from jsonb_object_keys(p_header) as k;

  execute format(
           'insert into public.invoices (%s) select %s from jsonb_populate_record(null::public.invoices, $1) as r returning id, invoice_no',
           v_cols, v_vals
         )
    into v_id, v_invoice_no
    using p_header;

  if v_id is null then
    raise exception 'create_invoice_with_items: header insert returned no id';
  end if;

  -- ── 4) Line items — one statement, invoice_id stamped from the header ──────
  insert into public.invoice_items (
    invoice_id, sr_no, product_id, description, hsn, qty, unit, rate,
    discount_pct, taxable_value, gst_rate, cgst, sgst, igst, cess,
    line_total, warehouse_id, serial_numbers
  )
  select
    v_id,
    coalesce(nullif(r.sr_no, 0), r.ord)::int,
    r.product_id, r.description, r.hsn, r.qty, r.unit, r.rate,
    r.discount_pct, r.taxable_value, r.gst_rate, r.cgst, r.sgst, r.igst,
    r.cess, r.line_total, r.warehouse_id, r.serial_numbers
  from jsonb_to_recordset(p_items)
         with ordinality
         as r(
           sr_no            int,
           product_id       uuid,
           description      text,
           hsn              text,
           qty              numeric,
           unit             text,
           rate             numeric,
           discount_pct     numeric,
           taxable_value    numeric,
           gst_rate         numeric,
           cgst             numeric,
           sgst             numeric,
           igst             numeric,
           cess             numeric,
           line_total       numeric,
           warehouse_id     uuid,
           serial_numbers   text[],
           ord              bigint
         );

  return query select v_id, v_invoice_no;
end;
$$;

-- Grants: same roles as the other invoicing RPC (increment_invoice_print).
grant execute on function public.create_invoice_with_items(jsonb, jsonb) to authenticated;
grant execute on function public.create_invoice_with_items(jsonb, jsonb) to service_role;

comment on function public.create_invoice_with_items(jsonb, jsonb) is 'Atomic invoice creation — inserts the invoices header and all invoice_items in a single transaction, returning {id, invoice_no}. Replaces the two-step insert + compensating DELETE and closes the orphan-header window. SECURITY DEFINER with an explicit admin-or-sales:create guard to match the invoices_insert RLS policy. Item rows must not carry invoice_id.';

-- Safety assertion: this file must contain zero DELETE FROM / TRUNCATE / DROP TABLE
-- Verify: ! grep -qiE "delete from|truncate|drop table" supabase/migrations/20260930000001_create_invoice_with_items.sql
