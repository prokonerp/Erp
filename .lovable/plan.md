# IMS Module — Implementation Plan

A new top-level **IMS (Inventory Management System)** module that manages Good/Defective stock, warehouse-wise inventory, transfers, reservations, OEM returns, and full serial-number traceability — wired into existing Tickets, Indents, Products, OEM, and Warehouse masters.

## Scope

Reuse existing `warehouses`, `products`, `oem_brand_master`, `tickets`, `indents`. No new warehouse module.

## Database (single migration)

New tables (all with RLS + GRANTs, audit timestamps):

1. **`ims_stock_items`** — one row per uniquely traceable stock unit
   - oem, category, part_name, part_model_no, **part_serial_no (UNIQUE)**
   - warehouse_id (FK), warehouse_type (denormalized)
   - stock_type: `good` | `defective`
   - stock_status: `available` | `reserved` | `issued` | `in_transit` | `returned_to_oem` | `scrapped`
   - ref fields: ticket_id, indent_id, oem_case_id, customer_id, customer_name, transaction_ref
   - created_by, modified_by, timestamps

2. **`ims_transactions`** — every stock movement
   - txn_no (auto: `PHS/IMS/...`), txn_date
   - txn_type enum: `good_in`, `good_out`, `defective_in`, `defective_out`, `transfer_out`, `transfer_in`, `oem_return`, `oem_replacement_receipt`, `stock_adjustment`, `scrap_adjustment`
   - stock_item_id, from_warehouse_id, to_warehouse_id, from_party, to_party
   - qty (default 1, serialized items = 1), reference (ticket/indent/transfer id), notes, created_by

3. **`ims_transfers`** — warehouse-to-warehouse transfer header
   - transfer_no (auto), request_date, source_warehouse_id, destination_warehouse_id
   - oem, part_name, part_model_no, part_serial_no, stock_type, qty, reason, remarks
   - status: `draft` | `submitted` | `approved` | `rejected` | `in_transit` | `received` | `completed`
   - requested_by, approved_by, approved_at, rejected_reason
   - received_by, received_at, receipt_remarks

4. **`ims_reservations`**
   - stock_item_id, ticket_id, indent_id, customer_id, reserved_by, reserved_at, released_at, status: `reserved` | `issued` | `released`

5. **`ims_audit_log`**
   - entity (`stock_item`|`transaction`|`transfer`|`reservation`), entity_id, action, old_value (jsonb), new_value (jsonb), user_id, role, created_at

6. **`ims_transaction_sequence`**, **`ims_transfer_sequence`** + trigger functions (mirror existing `set_indent_no` pattern)

7. **Triggers**
   - Auto-numbering for txns and transfers
   - Audit log triggers on insert/update/delete for all four tables
   - Prevent duplicate serial (unique constraint + friendly RAISE)
   - On transfer status `approved` → set linked stock_item status `in_transit`
   - On transfer `completed` → move stock_item warehouse + status back to `available`

8. **RLS**: authenticated users read; create/edit per `has_permission('ims', ...)`; admin override; reservation/transfer approval gated by `has_role(admin)`.

9. **App-modules row**: insert `ims` into `app_modules` so role permissions can be assigned.

## Library helpers (`src/lib/ims.ts`)

- Types for stock item, transaction, transfer, reservation
- Queries: `listStock`, `getStockBySerial`, `searchStock({serial, model, ticket, indent, oem_case})`, `getStockHistory(stockId)`
- Mutations: `createStockItem`, `createTransaction`, `createTransfer`, `submitTransfer`, `approveTransfer`, `rejectTransfer`, `markInTransit`, `confirmReceipt`, `reserveStock`, `releaseReservation`, `issueReservation`, `scrapStock`, `adjustStock`
- Workflow helpers: `runAdvanceExchange`, `runExchange`, `runServiceShip` — auto-create the chain of transactions based on indent type

## Indent integration

When an indent is created/updated, derive workflow from existing `indent_type` and auto-create the appropriate IMS transactions:
- **Advance Exchange**: good_in (OEM→WH) → good_out (WH→Cust) → defective_in (Cust→WH) → defective_out (WH→OEM)
- **Exchange**: good_out → defective_in → defective_out → good_in
- **Service Ship**: good_in only

Each step is triggered from the indent detail page (action buttons), not automatically — to match physical movement timing. Defective vs Replacement part attributes are kept separate (already supported in indents).

## Routes (`src/routes/_app/ims.*`)

```
ims.tsx              -> layout with sub-nav
ims.index.tsx        -> Dashboard
ims.stock.tsx        -> Stock Ledger (filters, search)
ims.stock.$id.tsx    -> Stock item detail + history
ims.transactions.tsx -> Inventory Transactions list + new
ims.transfers.tsx    -> Stock Transfer list
ims.transfers.new.tsx
ims.transfers.$id.tsx -> Detail + approve/receipt actions
ims.reservations.tsx
ims.oem-returns.tsx
ims.reports.tsx      -> Stock/Movement/Traceability reports + CSV export
ims.audit.tsx        -> Audit trail viewer
```

## Dashboard cards

- Good stock totals (overall, by warehouse, by OEM)
- Defective stock (overall, pending OEM return, by warehouse)
- Transfers (pending approval, approved, in-transit, completed, rejected)
- Reservations (reserved, available, issued)

## Reports

CSV export via existing `src/lib/exports.ts` for: Good Stock, Defective Stock, Warehouse-wise, OEM-wise, Inward, Outward, OEM Returns, Transfers, Reservations, and a Traceability search.

## Permissions / Roles

- **Standard User**: create stock entry, create transfer request, reserve, view
- **Warehouse User**: process inward/outward, confirm transfer receipt
- **Admin**: approve transfers, modify inventory, stock adjustments, unlock, view audit

Enforced via `has_permission('ims', <action>)` + `has_role('admin')` for approvals.

## Navigation

Add IMS entry to the app sidebar (`src/routes/_app.tsx`) gated by `has_permission('ims','access')`.

## Out of scope (for this turn)

- Barcode scanning hardware integration
- Email/WhatsApp notifications on approval (can be added later)
- Bulk import of opening stock (separate ticket)

## Deliverable order

1. Migration (tables, sequences, triggers, RLS, GRANTs, `app_modules` row)
2. `src/lib/ims.ts` helpers + types
3. Routes + UI (dashboard → stock → transactions → transfers → reservations → reports → audit)
4. Sidebar nav entry
5. Light hooks from indent detail page to trigger workflow transactions

Approve to proceed, or tell me which sections to trim/expand.