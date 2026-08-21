# Database Schema

**Source of truth:** `supabase/migrations/` (138 SQL files) + `src/integrations/supabase/types.ts` (generated, 5758 lines — includes live-DB drift not in migrations, see "Drift" note).

## Table inventory by domain

### A. ERP Core / Masters / Finance
| Table | Stores |
|---|---|
| `companies` | Legal company masters (name, GSTIN, address, phone) |
| `branches` | Company branches = seller identities (GSTIN, PAN, CIN, bank, UPI, logo, invoice footer, is_default) |
| `company_profile` | Singleton operating-company profile (regd/factory address, GSTIN, logo, bank, accent color) |
| `vendors` | Supplier masters (GSTIN, contact, payment terms) |
| `customers` | Shared customer master (company, contact, phone, GST, billing/shipping split, state codes, sector, PAN, customer_code, dup_exempt, gst_status, contacts JSONB) |
| `customer_sites` | *(types.ts only, not in migrations)* site locations |
| `accounts_ledger` | Chart-of-accounts style ledger (name, type, opening_balance, gst) |
| `invoice_settings` / `po_settings` / `sales_order_settings` | Per-branch numbering (prefix, FY reset, next_seq, terms defaults, letterhead/theme info) |
| `invoices` | GST sales invoices (seller/buyer snapshots, CGST/SGST/IGST/cess, e-Invoice IRN fields, e-Way Bill fields, status draft/issued/partial/paid/cancelled, linked quote/SO/DC, skip_stock_posting, source_general_dc_id, soft-delete) |
| `invoice_items` | Invoice lines (product, HSN, qty, rate, tax splits, warehouse_id, serial_numbers TEXT[]) |
| `payments_received` | Customer payments (`PHS/RCPT/YYYY/NNNN`, mode, amount, unallocated) |
| `payment_allocations` | Payment↔Invoice many-to-many |
| `eway_bills` | e-Way bill records (transporter, vehicle, distance, ewb_no, status) |
| `purchase_orders` / `purchase_order_items` | POs (vendor snapshots, GST totals, status draft/approved/sent/partial/completed/cancelled, received_qty on items) |
| `sales_orders` | SOs (snapshots, items JSONB, linked_quote_id, status draft/confirmed/partial/delivered/invoiced/cancelled) |
| `quotations` | Quotes `PHS/FY/NNNN` (items JSONB, Zoho-style fields: reference_no, discount, TCS, taxes, attachments, terms, converted_to_so_id) |
| `quote_terms_templates` | Reusable terms templates (Standard, AMC) |
| `crm_settings` | Singleton CRM config (business_state, GSTIN, default terms) |
| `letterhead_settings` | Per-document-type letterhead toggles |
| `gatepasses` | Gate passes `PHS/YYYY/NNNN` (person/company/vehicle/destination, items JSONB, return_type Returnable/Non-Returnable, branch_id) |
| `document_deletion_audit` | Admin deletion audit (document_type, no, reason, snapshot JSONB, who/when) |

### B. IMS (Inventory)
| Table | Stores |
|---|---|
| `products` | Catalog (name, unit, category, brand, model unique-lower, HSN, SKU, tax rates, GST rate, serial tracking config, warranty config, item_type product/service, parent_tagging_required) |
| `product_categories` | Categories (Accessories, CCTV, Inverter/Battery, Offline/Online UPS, Solar Panel, UPS Battery, Spare Parts...) |
| `product_bundles` | Parent→child bundles (default_qty, mandatory, editable_qty) |
| `product_spare_parts` | Parent → spare-part product links |
| `serials` | Serialized units (product, serial unique, purchase/sale invoice, supplier/customer, installation, warranty start/end, status, warehouse) |
| `warehouses` | Warehouses (code unique, type, address, city/state/pincode, contact, asp_code, branch_id) |
| `inventory` | Legacy simple inventory (superseded by ims_*) |
| `ims_stock_items` | **Core stock ledger** — one row per physical unit/batch: oem, category, part_name, part_model_no, part_serial_no (unique), warehouse_id, warehouse_type, stock_type (good/defective), stock_status, ticket/indent/oem_case/customer links, transaction_ref, qty (pooled; serial rows forced qty=1 by CHECK), opening_stock |
| `ims_transactions` | **Movement ledger** — txn_no `PHS/IMS/...`, txn_type, stock_item_id, from/to warehouse/party, qty, ticket/indent link, transfer_id, reference ("DC DC-0001", "GRN ...", "Invoice ..."), txn_date |
| `ims_transfers` | Inter-warehouse transfers (draft→submitted→approved→in_transit→completed/rejected/cancelled) |
| `ims_reservations` | Stock reservations (reserved/issued/released) |
| `ims_audit_log` | Trigger-based audit (old/new JSONB, user) |
| `ims_txn_sequence`, `ims_transfer_sequence` | Singleton counters (service_role only) |
| `stock_negative_overrides` | Admin-approved negative-stock overrides (document, model, qty, reason) |
| `ups_bundles` | Smart-sales UPS bundle master (parent product, ups_load_watts, items JSONB) |
| `battery_catalog` | Battery sizing catalog (brand, model, voltage, Ah, tier, price) |
| `charger_ah_limits` | Charger current → max battery Ah |
| `defective_tags` | Tag labels `DT/FY/NNNNN` (txn_id, stock_item_id, model/serial, customer, asp_code, engineer, print count) |
| `defective_tag_sequence` | FY-keyed tag sequence |

### C. Service / CRM / AMC
| Table | Stores |
|---|---|
| `tickets` | Service calls: case_id `TKT`+timestamp+seq, call_type, product/serial_no, customer snapshot, location, complaint, status, assigned engineer, parts (JSONB), OOW quotation_id, OEM fields (oem_call/brand/ref_id/purchase_date), sector, priority P1-P3, soft-delete, special_instruction + acknowledgement, preferred_visit_datetime, defective/good parts received/used JSONB, attachments, source, amc_id, pm_visit_id |
| `ticket_activities` | Ticket timeline (kind, from/to status, notes, actor) |
| `ticket_settings` (prefix), `ticket_sequence` | Ticket numbering |
| `call_type_master` | Call types (OOW, Installation, Warranty, AMC, PM Call, New Sale Delivery, CCTV) |
| `complaint_master` | Standardized complaints (Backup Issue, Battery Faulty...) |
| `amcs` | AMC contracts: agreement_no `PHS/AMC/...`, units JSONB, start/end, duration_years, amc_value, terms, pm_dates JSONB, prev_amc_id (renewal chain), OEM fields, agreement_doc_path, soft-delete |
| `amc_settings`, `amc_sequence` | AMC numbering + terms |
| `pm_visits` | PM visits generated from amcs.pm_dates (unique per amc+date) |
| `oem_brand_master` | OEM brands (APC, Luminous, Microtek, Eaton, Exide, Quanta) |
| `oem_logos` | Logo catalog for documents |
| `installed_equipment` | Customer installed base (model, serial, invoice ref, warranty_months, AMC dates) |
| `leads` | Sales leads (owner_id, title, source, status new/follow_up/quoted/won/lost, expected/closed value, next_followup, closed_remarks, lost_reason) |
| `lead_activities` | Follow-up notes (note/call/meeting/email/whatsapp) |
| `lead_assignments` | *(types.ts only)* assignment/acknowledgement workflow |
| `incentive_rules` | Commission slabs (Tier 1–4 seeded: 2–5%) |
| `incentives` | Payout records per lead/owner/period |
| `wa_templates` | WhatsApp templates (engineer_assign, oow_quotation, ticket_closed) |
| `whatsapp_launch_logs` | Logs of WhatsApp launches (module, record, URL, success) |
| `notifications` | *(types.ts only)* generic notifications |
| `assignable_engineers` | Read-only mirror of safe employee fields (synced by triggers) |

### D. RMA / Indent
| Table | Stores |
|---|---|
| `indents` | OEM service indent/RMA: indent_no `PHS/IND/...`, ticket_id (must be OEM ticket via trigger), indent_city, case_id/oem_case_id, defective model/serial, problem, indent_type (rma_advance_exchange/rma_exchange/rma_service_ship), oracles text, exchange/recv model+serial+date, oracles_data JSONB (per-OEM blocks), status (draft/open/in_progress/partially_completed/completed/closed), oracle_number, soft-delete |
| `indent_sequence` | Counter |
| `indent_oracle_map` | Denormalized (indent_id, ticket_id, oracle_no) rebuilt from oracles_data by trigger |

### E. HR / Payroll
| Table | Stores |
|---|---|
| `employees` | HR master (name, role, department, phone, email, joining_date, active, monthly_salary, increment cycle, exit_date) |
| `attendance` | Daily attendance (employee_id, work_date, code P/H/A, work_hours, day_value 1/0.5/0, is_sunday; unique employee+date) |
| `attendance_audit` | Batch-change audit |
| `attendance_locks` | Period locks (year/month, locked) |
| `employee_advances` | Salary advances (amount, period, EMI config, status active/closed) |
| `advance_payments` | Per-month EMI payments (unique advance+period) |
| `salary_records` | Monthly payroll (period, days, present_days, paid_leave_benefit, gross, advance, emi_deduction, carry_forward, deductions, net, overrides, status draft/paid; unique employee+period) |

### F. Security / Permissions
| Table | Stores |
|---|---|
| `user_roles` | user_id → app_role enum (admin/user); unique per user+role |
| `app_roles` | Named roles (Admin, User seeded, is_system) |
| `role_module_permissions` | Role × module matrix (enable_access, can_read, can_create, can_edit, can_delete, can_export, can_import) |
| `app_users` | App user profile (name/email/phone, role_id, status, custom_permissions JSONB, password_changed_at, must_change_password, last_login/activity/logout, login_count) |
| `app_modules` | Dynamic module registry (customers, products, tickets, indent, amc, gatepass, quotations, reports, ims, sales, po, accounts, general_dc...) |
| `password_history` | Hashed passwords (no-reuse rule, last 5; service_role only) |

## Key relationships

- `branches.company_id → companies`; `warehouses.branch_id → branches`
- `invoices.branch_id/customer_id`; `invoice_settings/po_settings/sales_order_settings.branch_id` (unique)
- `serials.product_id/supplier_id/customer_id/warehouse_id`
- `quotations.lead_id/customer_id/branch_id/converted_to_so_id → sales_orders.id`
- `sales_orders.linked_quote_id → quotations`
- `delivery_challans.sales_order_id/quotation_id/indent_id/branch_id`
- `invoices.linked_dc_ids UUID[]`, `invoices.source_general_dc_id`
- `invoice_items.invoice_id (CASCADE)/product_id/warehouse_id`
- `payments_received.customer_id`; `payment_allocations.payment_id (CASCADE) + invoice_id (CASCADE)`
- `eway_bills.invoice_id (CASCADE)`
- `purchase_orders.vendor_id (required)/branch_id/customer_id (drop-ship)`
- `tickets.customer_id (SET NULL)/quotation_id/amc_id/pm_visit_id`
- `amcs.customer_id (RESTRICT)/prev_amc_id (renewal chain)`
- `pm_visits.amc_id (CASCADE)`
- `indents.ticket_id (CASCADE)`; `indent_oracle_map.indent_id + ticket_id (CASCADE)`
- `ims_stock_items.warehouse_id/ticket_id/indent_id/customer_id`; `ims_transactions.stock_item_id/from-to warehouses/ticket_id/indent_id`
- `ims_transfers.source/destination_warehouse_id/stock_item_id/requested/approved/received_by`
- `ims_reservations.stock_item_id (CASCADE)/ticket_id/indent_id/customer_id`
- `defective_tags.txn_id/stock_item_id/warehouse_id`
- Attendance/advances/salary → `employees` (CASCADE)
- `user_roles.user_id → auth.users`; `app_users.user_id → auth.users (PK)`; `role_module_permissions.role_id → app_roles`

## RPC functions (key ones)

**Permission helpers (SECURITY DEFINER):** `has_role(user_id, app_role)`, `has_permission(user_id, module, action)` (custom_permissions overrides first, admin bypass), `is_designated_owner()` (email allow-list: `gaurav@prokonhitech.com`, `prokonerp@gmail.com` — updated from original `gauravarora97@gmail.com`), `claim_admin()` (first-admin bootstrap).

**Numbering/sequence triggers:** set_challan_no (gatepass), set_quote_no (FY-aware, advisory lock + collision skip), set_ticket_case_id, set_amc_agreement_no, set_indent_no, set_ims_txn_no/set_ims_transfer_no, set_dc_challan_no (`DC-CUST`/`DC-OEM`), set_grn_no (`GRN-CUST/OEM/GEN`), set_po_no, set_so_no, set_invoice_no (auto-creates invoice_settings), set_payment_no, set_defective_tag_no, set_gdc_no. All backed by atomic singleton counters (SECURITY DEFINER).

**Inventory posting (SECURITY DEFINER, complex):**
- `dc_post_inventory()` — DC → flips serial stock issued/returned_to_oem, good_out/defective_out txns; cancel reverses; FIFO `ims_deduct_qty`; honors allow_negative_stock.
- `grn_post_inventory()` — GRN → creates ims_stock_items (per serial, ON CONFLICT upsert), classifies good/defective/scrap, good_in/defective_in txns.
- `gdc_post_inventory()` — same for General DC on Issued.
- `gdc_guard_status()` — blocks illegal GDC transitions.
- `ims_transfer_status_effects()` — in_transit deducts + transfer_out; completed moves + transfer_in; cancelled restores.
- `ims_resv_sync_stock()` — reservation syncs stock status.
- `ims_deduct_qty(...)` — FIFO deduction, returns consumed batches, raises on insufficient unless negative allowed.
- `invoice_item_sync_serials()` / `invoice_cancel_release_serials()` — serial marking + good_out/good_in on invoice lines; honors skip_stock_posting.
- `sync_dc_to_ims(dc_id)` / `sync_grn_to_ims(grn_id)` — idempotent historical backfill.

**Oracle workflow:** `_oracle_row_str`, `_oracle_block_complete`, `oracle_docs_pending`, `oracle_docs_satisfied`, `oracles_autoclose`, `indents_autoclose_oracles`, `validate_indent_oem_ticket`, `sync_indent_oracle_map`, `recalc_indent_status`, `trg_indent_recalc_from_doc`.

**Admin maintenance:** `admin_delete_challan(id, reason)`, `admin_delete_grn(id, reason)`, `admin_edit_grn_reverse(id, reason)`, `admin_reopen_oracle(indent_id, oracle_no, reason, scope)`, `purge_archived_records()` (pg_cron daily 20:30 UTC, soft-deleted records >30 days).

**Activity/misc:** `record_user_login/activity/logout`, `sync_assignable_employee`, `products_normalize_names`, `sync_pm_visits`, `log_ticket_created`, `touch_updated_at` family.

## Enums
- `app_role`: admin | user
- `ims_stock_type`: good | defective
- `ims_stock_status`: available | reserved | issued | in_transit | returned_to_oem | scrapped
- `ims_txn_type`: good_in | good_out | defective_in | defective_out | transfer_out | transfer_in | oem_return | oem_replacement_receipt | stock_adjustment | scrap_adjustment
- `ims_transfer_status`: draft | submitted | approved | rejected | in_transit | received | completed | cancelled
- `ims_reservation_status`: reserved | issued | released
- `indent_type`: rma_advance_exchange | rma_exchange | rma_service_ship

## RLS patterns
- Admin-gated (has_role admin): companies, branches, warehouses, attendance, advances, salary, charger_ah_limits, oem_logos, incentive_rules, crm_settings, amc_settings, defective_tags delete, hard DELETEs everywhere.
- Module-permission-gated (has_permission): IMS tables (`ims`), invoices/payments/SO (`sales`), POs (`po`), customers, tickets/amcs/indents, GDC (`general_dc`), employees (`employees`), payroll (`payroll`), ledger (`accounts`), vendors (`po` read).
- Ownership-scoped: leads/lead_activities/quotations (owner_id = auth.uid()), gatepasses (created_by = auth.uid() OR admin), tickets/amcs/indents (created_by OR module edit OR admin; soft-delete aware).
- Open-but-authenticated: products, serials, quote settings, invoice_items, eway_bills, delivery_challans (`auth.uid() IS NOT NULL`).
- Service-role-only: sequences, password_history.
- Storage buckets: `ticket-attachments` (tickets module), `amc-agreements` (amc module), `oem-logos` (admin).
- Realtime: tickets, indents, amcs on supabase_realtime (REPLICA IDENTITY FULL).

## Drift note
Tables/functions exist in live DB (types.ts) but NOT in migrations: `customer_sites`, `lead_assignments`, `notifications`, RPCs `acknowledge_lead_assignment`, `check_customer_duplicate`, `my_pending_lead_acknowledgements`, `search_customers_by_name`, `show_limit`, `show_trgm`; extra customer/lead columns (customer_code, dup_exempt, gst_status, contacts, leads.acknowledged/assigned_to/priority). Likely added via Lovable outside migration history — migrations alone do not reproduce exact live schema.