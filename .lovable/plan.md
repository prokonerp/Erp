# Sales Module — Incremental Hardening

Scope: `crm.*` and `sales.*` routes plus `src/lib/{crm,sales,gst,documentFlow,salesOrders,invoicePdf}.ts`.

Guardrails (unchanged): GST engine (`gst.ts`), invoice/quote/SO numbering triggers, Invoice PDF renderer, Customer + Product masters. Business rules stay identical.

## Findings

1. **No server-side pagination.** Every list uses `.limit(500 – 5000)` and filters in JS (`sales.invoices.index`, `sales.payments.index`, `crm.quotations`, `sales.orders`).
2. **No debounce.** Search inputs re-render immediately; big lists re-filter on every keystroke.
3. **No query cache.** Sales pages don't use TanStack Query — every mount refetches. `usePermissions()` is called per page and refetches on every mount.
4. **Weak validation.** Payment amount, quotation totals, and quote/invoice metadata are inserted without zod parsing. No cap on notes/subject length.
5. **Role checks missing on Sales routes.** New Invoice, Record Payment, Convert to SO rely on RLS alone; UI shows the buttons regardless of `can("Sales","create")`.
6. **Duplicate submissions possible.** `Save`, `Create quote`, and `Convert to SO` don't lock during in-flight calls in a few places (`crm.quotations.tsx#create`, `crm.quotations.$id.tsx#convertToSo` locks partly, `sales.payments.new` locks OK).
7. **No audit trail** for status transitions (quote sent → accepted, invoice cancelled, payment recorded).
8. **Duplicate customer fetch.** `crm.quotations.tsx` prefetches every customer just to render the picker inside its own dialog; `CustomerPicker` already exists.
9. **Optimistic UI absent** for status changes (safe places: quote status, invoice status change with rollback on error).

## Deliverables (incremental, ship-in-order)

### 1. Shared primitives (`src/lib/sales.hooks.ts`, `src/lib/sales.schemas.ts`)
- `useDebounced(value, ms)` hook.
- `usePagedQuery<T>({ table, select, order, filters, page, pageSize, search })` — thin wrapper over Supabase `.range()` returning `{ rows, count, isLoading }`, keyed and cached via TanStack Query with `keepPreviousData`.
- Zod schemas: `paymentInputSchema`, `quotationCreateSchema`, `invoiceHeaderSchema` — bounded strings (`.max(...)`), amounts non-negative, dates ISO. Import at insert/update sites only; do not touch existing computed totals.

### 2. Server-side pagination + debounced search
Wire `usePagedQuery` into:
- `sales.invoices.index.tsx` — server-side status filter (already there) + `ilike` on `invoice_no`/`buyer_name` + `.range()`. Add page controls at footer.
- `sales.payments.index.tsx` — same shape.
- `crm.quotations.tsx` — server-side search + status filter; stop prefetching all customers (dialog uses existing `CustomerPicker`).
- `sales.orders.tsx` — server-side pagination.

No visible UX change beyond a pagination footer and instant "Loading…" hint.

### 3. Permission gates
Read `usePermissions()` once via a lightweight `PermGate` component; keep existing hook. Add `can("Sales","create")` / `"edit"` / `"delete"` gating on:
- New Invoice, New Quote, Record Payment, Convert to SO, Delete/Cancel buttons.
Buttons render disabled with tooltip when denied. RLS remains the source of truth.

Cache `usePermissions()` result in a module-level promise so it fetches once per session instead of per-mount (backwards compatible — same public API).

### 4. Duplicate submission guard
Introduce `useSubmitOnce()` (returns `[submit, submitting]`) and apply to:
- `crm.quotations.tsx#create` and `#duplicate`
- `crm.quotations.$id.tsx#save`, `#convertToSo`, `#setStatus`
- `sales.invoices.new.tsx#save`
- `sales.payments.new.tsx#save` (already guarded — align pattern).

Buttons disable + show a spinner while in-flight.

### 5. Optimistic status updates (safe places only)
`crm.quotations.$id.tsx#setStatus` and invoice status transitions in `sales.invoices.$id.tsx`: update local state immediately, rollback on server error. Cache-side invalidations use `queryClient.invalidateQueries(["quotations"])` etc.

### 6. Audit logging
Add table `public.sales_audit_log` (id, entity, entity_id, action, before, after, actor, created_at) with:
- INSERT-only RLS: `authenticated` can insert their own rows; `admin` / users with `Sales.export` (report) can SELECT.
- Server function `logSalesEvent(entity, entity_id, action, before, after)` using `requireSupabaseAuth`, called from status transitions and payment recording.
- No triggers on existing tables — pure application-side logs, safe additive change.

### 7. Client hardening
- All external strings that go into `mailto:` / `wa.me` / share dialogs run through `encodeURIComponent` (already the case for mail; verify WhatsApp helpers).
- Enforce `.max(...)` on subject/notes at the schema layer before insert.
- Trim + normalize phone/GSTIN at insert.

### 8. Small refactors (code hygiene, no logic change)
- Extract `PaginationFooter` and `SalesFilterBar` reusable components (used by the four lists).
- Move `usePermissions` result into a `QueryClient` cache under key `["auth","perm"]` with 5-min staleTime.

## What we won't touch

- `src/lib/gst.ts` (GST engine) — no signature/logic changes.
- `src/lib/invoicePdf.ts` and `purchaseOrderPdf.ts` — renderer untouched.
- DB triggers `set_invoice_no`, `set_quote_no`, `set_so_no`, `set_payment_no`, and serial-sync triggers — untouched.
- Customer & Product master schemas — pickers stay canonical.

## Technical Details

- **Files added:** `src/lib/sales.hooks.ts`, `src/lib/sales.schemas.ts`, `src/components/PaginationFooter.tsx`, `src/components/PermGate.tsx`, `src/lib/salesAudit.functions.ts`.
- **Files edited (list only):** the four list routes, three detail routes, `crm.quotations.tsx`, `usePermissions.ts` (cache-only), `sales.payments.new.tsx` (schema).
- **DB migrations:** one migration creating `sales_audit_log` with GRANTs, RLS enabled, insert/select policies, plus `updated_at` skipped (append-only).
- **Query keys:** `["invoices", {page,status,q}]`, `["quotations", {...}]`, `["sales-orders", {...}]`, `["payments", {...}]`, `["auth","perm"]`.
- **Backward compatibility:** every existing call site keeps its exports. New hooks are additive.

## Rollout order

Ship in five patches — each one buildable and testable independently:
1. Schemas + `useDebounced` + `useSubmitOnce` + `PaginationFooter` + `PermGate`.
2. `sales.invoices.index` migration to server-side paged query.
3. `sales.payments.index`, `sales.orders`, `crm.quotations` list migrations.
4. Permission gating + duplicate-submit guards on detail pages.
5. `sales_audit_log` migration + status-change audit calls + optimistic UI.
