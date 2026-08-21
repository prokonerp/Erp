# Business Modules (deep dive)

## 1. Tickets (Service)
- Lifecycle: New → assigned engineer (name/phone, assigned_at) → status flow in ticket workbench → closing remarks → closed.
- Priority P1–P3; sectors; OEM fields (oem_call, brand, ref_id, purchase_date); special_instruction + acknowledgement flag.
- Parts: `parts_details` JSONB (defective received / good used), links to IMS reservations + indent.
- WhatsApp templates (engineer_assign, oow_quotation, ticket_closed) with placeholder tokens; `whatsapp_launch_logs` records launches.
- Public form: `/raise-ticket` → `submitPublicTicket` serverFn (Zod-validated, title-case normalization, soft captcha, max 5 attachments via HMAC-signed upload endpoints).
- OOW quotations linked via `tickets.quotation_id`.

## 2. AMC (Annual Maintenance Contracts)
- Agreement numbers auto-generated; units JSONB; PM schedule auto-generated from `pm_dates` (sync_pm_visits).
- PM visits: calendar view, mark complete; PM reminders ≤14 days on AMC dashboard.
- OEM warranty consolidated view from tickets/AMC/PM (`/amc/oem`) — brand, ref, purchase date, warranty expiry status.
- Renewal chain via `prev_amc_id`; soft-delete + purge cron.

## 3. CRM
- Leads: statuses new → follow_up → quoted → won/lost; follow-up scheduling (next_followup), activity log kinds (note/call/meeting/email/whatsapp), assignment/acknowledgement workflow (lead_assignments in live DB).
- Quotations: GST-compliant builder (items, discounts, taxes, TCS, validity), statuses draft→sent→accepted..., duplicate/clone, print/PDF, share via WhatsApp, convert to Sales Order (converted_to_so_id).
- Incentives: slab rules (Tier 1–4, 2–5%), payout records per lead/owner/period, preview calculator.
- UPS Smart Panel: bundles + battery catalog; `ups_bundles` with ups_load_watts + items JSONB; battery sizing (battery_catalog + charger_ah_limits).
- AI recommend: UPS backup-time calculator (kVA, power factor, DC bus voltage, battery sizes, charger current).

## 4. Sales
- Pipeline: **Quotation → Sales Order → Delivery Challan → Invoice** via `documentFlow.ts` (deterministic snapshot mapping).
- SO: items JSONB; statuses draft→confirmed→partial→delivered→invoiced→cancelled.
- DC (delivery challans): doc_type customer/OEM, DC-CUST/DC-OEM numbering; posts inventory on Challan Generated/Submitted.
- GRN (goods received): GRN-CUST/OEM/GEN; creates stock items, classifies good/defective/scrap.
- GDC (General DC): standalone dispatch challans, stock posting on Issued, convert to invoice, return-GRN prefill.
- Invoices: GST full stack (CGST/SGST/IGST/cess, round-off), per-branch numbering (invoice_settings, FY-aware), serial picking, negative-stock guard (stock_negative_overrides), skip_stock_posting for GDC-sourced, e-Invoice IRN fields (currently `mockIrnPayload` — deterministic fake, real GSP later), e-Way bills (eway_bills, >₹50k), payments with allocation (payments_received + payment_allocations), cancel with reason.
- Branch settings: invoice/PO/SO prefix+sequence, terms, place-of-supply, letterhead per document type.

## 5. IMS (Inventory)
- **Two-layer model:** `ims_stock_items` (physical units/batches) + `ims_transactions` (movement ledger). Serial rows forced qty=1; pooled batches by (model, warehouse, stock_type).
- Stock types: good/defective; statuses: available/reserved/issued/in_transit/returned_to_oem/scrapped.
- Movements flow through trigger functions: DC/GRN/GDC posting, transfers (approval workflow), reservations, invoice serial sync, cancellations reverse everything.
- FIFO deduction via `ims_deduct_qty`; negative-stock only with admin override.
- Defective workflow: defective tags (`DT/FY/NNNNN`) printing, OEM returns tracking.
- Audit: `ims_audit_log` trigger-based for all 4 IMS tables.
- Ledger view with running balances; warehouse ledger; serial track.

## 6. Indent / RMA (OEM exchange)
- Created from OEM tickets only (trigger validates `oem_call`).
- Oracle blocks in `oracles_data` JSONB: Section A (defective rows), B (exchange rows), C (OEM-received rows), D (customer-received rows).
- Pipeline: DC (dispatch defective) → GRN-OEM (receive from OEM) → GRN-Customer (customer receives exchange) — docs linked to indent+oracle, auto-close when all satisfied (`oracles_autoclose`).
- Status: draft/open/in_progress/partially_completed/completed/closed; auto-recalc from linked DC/GRN submission counts.
- `indent_oracle_map` denormalized for quick per-ticket lookups (`indent.functions.ts`).

## 7. PO (Purchase)
- Vendor POs with GST, per-branch numbering (po_settings), statuses, items with received_qty, print/PDF.

## 8. Payroll / HR
- Employees master; monthly attendance grid (P/H/A, work_hours, day_value 1/0.5/0, Sunday flag), unique employee+date, batch edit with audit (attendance_audit), period locks (attendance_locks).
- Salary auto-calc: days_in_month, per_day salary, working/present days, paid-leave benefit, advances + EMI deduction (employee_advances, advance_payments), carry-forward, overrides (paid_days/emi/net), draft→paid with approved_at/paid_at.
- Salary records unique per employee+period.

## 9. Gatepass
- Challan numbering `PHS/YYYY/NNNN` (set_challan_no), return_type Returnable/Non-Returnable, items JSONB, prepared_by/authorised_by, branch.

## 10. Masters
- Tabs: Company (company_profile), Branches, Warehouses, Customers (+CSV import), Vendors, Products (+serials, bundles, opening stock), Employees, Inventory, Accounts (accounts_ledger), Complaints (complaint_master), Users & Roles (admin user management).
- Products: name normalization trigger (short_name/display_name from brand+model), serial_tracking/is_serialized sync, spare-parts links, bundle children.

## 11. Admin / Users
- `admin-users.functions.ts`: listAuthUsers, createAppUser, updateAppUser, setUserPassword, deleteAppUser, changeOwnPassword, getMyProfile — all admin-gated (assertAdmin → has_role RPC), service-role client.
- Password policy: ≥8 chars + upper + lower + digit + special; 30-day expiry (PASSWORD_EXPIRY_DAYS); last-5 history (SHA-256 of `userId:pw`), prune beyond 5; must_change_password flag; self-change verifies current password via re-signin.
- Users & Roles UI in Masters: role matrix editor (role_module_permissions), custom_permissions JSONB overrides.

## 12. MCP tools (read-only, OAuth)
`list_tickets`, `get_ticket`, `list_invoices`, `search_customers`, `stock_lookup` — defined in `src/lib/mcp/index.ts`, executed with user-scoped RLS client (`src/lib/mcp/supabase.ts`).