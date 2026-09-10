# SO Manual Verification — QA Checklist (UI)

> Project root: `/Users/jai/Desktop/Prokon Erp`
> Related pure logic: `src/lib/documentFlow.ts`, `src/lib/salesOrders.ts`
> Pure E2E tests: `src/lib/__tests__/soE2E.test.ts`, `src/lib/__tests__/soCancellation.test.ts`

## Pre-conditions
- [ ] Logged in as sales/admin role
- [ ] Branch `b1` exists, warehouse `w1` exists
- [ ] Product `UPS-1KVA` has stock on hand (verify in Stock Ledger)
- [ ] Product `SER-UPS` is marked `is_serialized=true` with serials `S1,S2,...`
- [ ] Open browser console + Network tab to observe conversions and stock postings

---

## 1) Create Quotation → Sales Order (20 units)
1. Create Quotation for `Acme Corp`, item `UPS-1KVA` qty `20`, rate `5000`, GST `18%`, warehouse `w1`, place of supply `Karnataka`.
2. Convert Quote → Sales Order. Verify:
   - [ ] SO shows `Qty 20`, `linked_quote_id` set, status `draft`/`confirmed`
   - [ ] Fulfillment preview shows `Ordered 20, Fulfilled 0, Balance 20, This Qty 20`
   - [ ] `orderedVsFulfilled` badge shows `20 ordered / 0 fulfilled / 20 balance`
   - [ ] `isSoFullyDelivered` is `false`

## 2) Partial Convert: Tax Invoice 17
1. From SO, use **Convert → Tax Invoice**, adjust this_qty to `17`.
2. Verify:
   - [ ] `validateThisQty` passes (no warehouse/serial error)
   - [ ] Invoice created has 1 line qty `17`, header `sales_order_id` matches SO, totals recomputed
   - [ ] After post, SO fulfillment summary shows `fulfilled_stock 17, balance 3, is_complete false`
   - [ ] SO status becomes `partial` (derived)
   - [ ] Network: `so_conversions` + `so_fulfillments` inserted, stock ledger decremented by 17

## 3) Partial Convert: General DC 3 (remainder)
1. From same SO, Convert → General DC, preview should show `balance 3`.
2. Verify:
   - [ ] `this_qty` defaults to `3`, no over-fulfillment
   - [ ] GDC created qty `3`
   - [ ] After both, `ordered 20, fulfilled 20, balance 0`, `isSoFullyDelivered true`, derived status `invoiced` (since tax_invoice exists) or `delivered` if only GDC
   - [ ] Preview now shows `balance 0` and convert button disabled or warns `fully delivered`

## 4) Over-fulfillment guard (Flow 6)
1. Fresh SO qty `20`, fulfilled `0`.
2. Try to create invoice with `25` (or edit this_qty to exceed balance).
3. Verify:
   - [ ] UI shows error containing `exceeds balance` or `balance 20`, blocks submit
   - [ ] Same for fractional `20.001` exceeds
   - [ ] String qty `"20"` behaves same as number `20`

## 5) Split 20 → 10 + 7 + 3
1. Create SO `20`.
2. Convert 3 times: `10`, then `7`, then `3` (tax_invoice or GDC).
3. Verify after each:
   - [ ] Balances `10` → `3` → `0`, cumulative fulfilled `10` → `17` → `20`
   - [ ] `isSoFullyDelivered` false until last, then true
   - [ ] SO derived status `partial` until last, then `invoiced`/`delivered`

## 6) Proforma does NOT affect stock (Flow 5)
1. SO `20`, Convert → Proforma `5`.
2. Verify:
   - [ ] Proforma created, `skip_stock_posting=true` (inspect payload or DB)
   - [ ] Fulfillment summary shows `fulfilled_proforma 5` but `fulfilled_stock 0`, `balance 20` unchanged
   - [ ] `orderedVsFulfilled` shows `fulfilledProforma 5`, balance still `20`
   - [ ] `getReverseEffect('proforma_invoice') === false`
   - [ ] Convert again: balance still allows `20`

## 7) Cancel GDC / Invoice restores balance
1. With SO `20 -> 17 (invoice) + 3 (GDC)` fully delivered, cancel the GDC document (status → `cancelled`).
2. Verify:
   - [ ] VIEW `so_fulfillment_summary` now shows `fulfilled_stock 17, balance 3` (cancelled excluded)
   - [ ] `orderedVsFulfilled` updates immediately after refetch
   - [ ] Preview allows `3` again, `isSoFullyDelivered false`
   - [ ] Stock ledger: `3` units reversed (check `stock_ledger` / `inventory` expected qty)
3. Cancel tax invoice `17` → balance `17` (if GDC still cancelled) or `3` remains if GDC still active. Repeat for both cancelled → `balance 20`.

## 8) SO Cancellation guard
1. SO `partial` with non-cancelled `tax_invoice` → try Cancel SO:
   - [ ] Blocked: `Cannot cancel: non-cancelled stock conversion(s) exist (tax_invoice)`
   - [ ] `canCancelSalesOrder` / `isSoCancellable` returns `{allowed:false}`
2. Cancel the invoice/GDC first, then Cancel SO:
   - [ ] Allowed: `Sales Order can be cancelled`
3. Try cancel already `cancelled` / `delivered` / `invoiced` SO:
   - [ ] Blocked with `already cancelled/delivered/invoiced`

## 9) Negative stock & allow_negative_stock
1. Set stock for `UPS-1KVA` at `w1` to `10` (via stock adjustment or initial).
2. Create SO `100` units, Convert → Invoice `100` with `allow_negative_stock = false`:
   - [ ] UI shows shortfall banner: `UPS-1KVA short 90` / `Insufficient stock`
   - [ ] Submit blocked, `findShortfalls` returns `shortfall 90`
3. Toggle `Allow negative stock` / override checkbox (if present):
   - [ ] Allowed with audit flag `wasNegative=true` or confirmation modal
   - [ ] Stock ledger shows negative available (or audit entry)
4. With exactly `10` requested → no shortfall, allowed

## 10) Serialized 2 units ["S1","S2"]
1. Create SO with serialized item qty `2`, serials `["S1","S2"]`, warehouse `w1`.
2. Convert → Invoice `1` with `["S1"]`:
   - [ ] Passes `validateThisQty` (whole-number, serial count matches)
   - [ ] Payload slices `serial_numbers` to `["S1"]`
3. Convert second invoice `1` with `["S2"]`:
   - [ ] Passes, balance now `0`
4. Attempt third conversion with duplicate `["S1"]`:
   - [ ] Fails `duplicate serial number "S1" already used` (when two lines with same serial in same payload, `validateThisQty` detects cross-line duplicate)
   - [ ] Also test within-line duplicate `["S1","S1"]` fails `duplicate within line`
   - [ ] Fractional `1.5` serialized fails `whole-number quantity`
5. After cancellation of first invoice, `S1` should be reusable (balance restores, ledger reverses) — verify in stock ledger serial availability

## 11) Stock ledger after cancellation
1. After any stock-affecting conversion, check Stock Ledger / `so_fulfillments`:
   - [ ] `fulfilled_stock` increments atomically, `balance` decrements
2. After cancelling that conversion:
   - [ ] `fulfilled_stock` decrements (view excludes cancelled), `balance` restores
   - [ ] Next conversion with restored qty passes `validateThisQty` again (no stale cache)

## 12) General regressions to run
- [ ] `npm test` passes (includes `soE2E.test.ts` + `soCancellation.test.ts`)
- [ ] `r3` string vs number: qty `"20"` vs `20` yields same balances
- [ ] `isSoFullyDelivered` false when any line `balance >0` (multi-line SO)
- [ ] Warehouseless stock line blocked: `warehouse required` when `product_id` present and `this_qty>0`
- [ ] `getReverseEffect` mapping: `tax_invoice/general_dc/delivery_challan` true, `proforma_invoice` false

---

## Evidence to capture (for release note)
- [ ] Screenshots: SO fulfillment bar, preview modal, shortfall banner, serial picker, cancel confirmation
- [ ] DB snippets: `SELECT * FROM so_fulfillment_summary WHERE sales_order_id = '<so_id>'` before/after cancel
- [ ] Console: no unhandled errors, deterministic totals (no 1-paise drift)
