# AMC & PM Schedule Enhancements

## 1. AMC Agreement Number (auto-generated)

**Format:** `{PREFIX}{ddMMyyHHmm}{SEQ}` (e.g. `PHS/AMC/1306261430/0001`)

- Add `amc_settings.prefix` text column (admin-editable, default `PHS/AMC/`).
- Add `amc_sequence` table (single row, `last_seq bigint`) + `next_amc_seq()` SECURITY DEFINER.
- DB trigger `set_amc_agreement_no` on `amcs` BEFORE INSERT: if `agreement_no` empty, build from prefix + IST timestamp + seq (padded 4).
- Update `src/routes/_app/amc.new.tsx`: remove client-side `nextAgreementNo`, display field as read-only/disabled placeholder ("Auto-generated on save").
- Update `src/routes/_app/amc.settings.tsx`: add "AMC Prefix" input (admin only) saved into `amc_settings`.
- Backward compatibility: existing agreements untouched; trigger only fires when value is empty.

## 2. Date filters (AMC + PM Schedule)

Add a small filter bar with chips: **Current Week | Current Month (default) | Custom Range** (Popover with two date pickers).

- `src/routes/_app/amc.index.tsx`: filter `end_date` within range (configurable: filter applies to `start_date`/`end_date` overlap with selected range so active AMCs in window show up).
- `src/routes/_app/amc.pm.tsx`: filter `scheduled_date` within range.
- Default = current month. Range computed via small helper `src/lib/dateRange.ts`.

## 3. Product structure update on AMC

Replace free-text "UPS Units (Model + Serial)" with structured **Product Details** rows:

- **Category** (Select, from `product_categories`)
- **Model** (Select, from `products` filtered by chosen category)
- **Serial Number** (Combobox: serials from `serials` for chosen product + free-text fallback)

Repeatable rows. Stored shape (backward compatible) — extend `amcs.units` JSON entries to include `category`, `product_id`, `model`, `serial_no`. Old rows continue to render via existing `model`/`serial_no` keys.

Update `amc.new.tsx` and `amc.$id.tsx` (edit) to use the new picker. Add a small `<ProductRow>` inline component.

## 4. New tab: **AMC OEM Data**

New route `src/routes/_app/amc.oem.tsx`, linked from AMC dashboard header.

**Source:** union of `tickets` + `amcs` + `pm_visits` where `oem_call = true` (we already have `oem_brand`, `oem_ref_id`, `oem_purchase_date` on `tickets`; add the same columns to `amcs` + `pm_visits` for parity — null-safe, optional).

**Product-level exclusion:**
- Build set of `(customer_id, product_id|serial_no)` covered under an **active** AMC (today between `start_date` and `end_date`).
- Exclude only matching products. Same customer's other products still appear.

**Display columns:**
OEM Brand · Ref ID · Purchase Date · **OEM Expiry Date** (purchase + 1y if no explicit field — derivable rule, configurable later) · **Status** (Expiring ≤30d / Expired / Active) · Customer (name, phone, city, sector) · Product (category, model, serial).

**Action:** `Create AMC` button → navigates to `/amc/new?oem_ref={ref_id}&customer={id}&product={id}&serial=...` with prefill logic added to `amc.new.tsx`.

## 5. Validation & perf

- Frontend: required category+model for each product row.
- Backend: trigger uniqueness on `agreement_no` (already unique via index — confirm).
- Add indexes: `tickets(oem_call) WHERE oem_call`, `amcs(end_date)`, `pm_visits(scheduled_date)`.

## Technical changes

**Migrations:**
1. `amc_settings.prefix text default 'PHS/AMC/'`
2. `amc_sequence` table + `next_amc_seq()` + `set_amc_agreement_no()` trigger
3. `amcs.oem_call/oem_brand/oem_ref_id/oem_purchase_date` (nullable)
4. `pm_visits.oem_call/oem_brand/oem_ref_id/oem_purchase_date` (nullable)
5. Supporting indexes

**Files edited/created:**
- `src/lib/dateRange.ts` (new)
- `src/lib/amc.ts` (extend `AmcUnit` type, remove `nextAgreementNo` usage; keep export for back-compat)
- `src/routes/_app/amc.index.tsx` (date filter bar)
- `src/routes/_app/amc.pm.tsx` (date filter bar)
- `src/routes/_app/amc.new.tsx` (read-only agreement no, new product rows, OEM prefill from query)
- `src/routes/_app/amc.$id.tsx` (new product rows in edit)
- `src/routes/_app/amc.settings.tsx` (prefix input, admin only)
- `src/routes/_app/amc.oem.tsx` (new tab)
- `src/routeTree.gen.ts` (register new route)

## Out of scope (confirm if needed)
- Migrating existing `amcs.units` rows to the new shape — left as-is; UI tolerates both.
- OEM expiry rule beyond `purchase_date + 1y` — current heuristic; configurable later.
