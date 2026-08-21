# Routes & UI Structure

Router: TanStack Router file-based (`src/routes/` → `src/routeTree.gen.ts` auto-generated — do NOT hand-edit the gen file).

## Root-level routes (public / infra)

| Path | File | Purpose |
|---|---|---|
| `/` | `src/routes/index.tsx` | Redirect: logged-in → `/dashboard`, else → `/auth` |
| `/auth` | `src/routes/auth.tsx` | Sign-in (email+password), idle-expiry notice, `?next=` redirect |
| `/raise-ticket` | `src/routes/raise-ticket.tsx` | **Public** customer ticket form (no login; name, phone, product, serial, complaint, up to 5 photos) |
| `/mcp` | `src/routes/mcp.ts` | MCP server endpoint (AI tools) |
| `/.mcp/list-tools`, `/.mcp/invoke-tool/$tool` | `src/routes/[.mcp]/...` | MCP plumbing |
| `/.well-known/oauth-protected-resource` | `src/routes/[.well-known]/oauth-protected-resource.ts` | MCP OAuth metadata |
| `/.lovable/oauth/consent` | `src/routes/[.]lovable.oauth.consent.tsx` | Lovable OAuth consent screen |

## App shell (`/_app` — all require login)

| Path | Purpose |
|---|---|
| `/_app` | Main layout: sidebar nav + header + content; auth guard; permission-filtered nav |
| `/dashboard` | Home: quick actions, KPI widgets per module, exec sections, activity feed |
| `/masters` | Masters hub — tabs: Company, Branches, Warehouses, Customers, Vendors, Products, Employees, Inventory, Accounts, Complaints, Users & Roles |
| `/masters/customers` | Customer master CRUD + CSV import |
| `/masters/products` | Product master CRUD, serials manager, bundles, opening stock |
| `/installed-equipment` | Customer-site equipment register (warranty/AMC chips, CSV import, quick ticket) |
| `/payroll` | Salary & attendance: monthly grid, auto salary calc, advances/EMI, locks, audit |
| `/tickets` (+ tabs) | Tickets hub: Dashboard, All Tickets, New Ticket, WhatsApp Templates, Settings |
| `/tickets/` | All tickets list — search, filters (engineer/status/priority/scope/OEM/parts/age), inline actions, WhatsApp, export |
| `/tickets/dashboard` | Ticket analytics (KPIs over day/week/month/year, charts) |
| `/tickets/new` | Create service ticket (call type, OEM info, defective/good parts, AMC/PM prefill) |
| `/tickets/$id` | Ticket detail/workbench — status flow, engineer assignment, parts, indent linking, print/PDF, closing remarks |
| `/tickets/templates` | WhatsApp message template editor (placeholder tokens) |
| `/tickets/settings` | Case-id prefix, call-type master |
| `/amc` (+ outlet) | AMC hub |
| `/amc/` | AMC dashboard/list — active/expiring/expired, PM reminders ≤14 days, filters, export |
| `/amc/new` | Create AMC (multi-unit, PM schedule generation, agreement doc upload) |
| `/amc/$id` | AMC detail — edit, units, PM visits, tickets link, print/WhatsApp |
| `/amc/pm` | PM schedule — calendar, mark complete, Excel export |
| `/amc/oem` | OEM warranty data consolidated (Tickets/AMC/PM) — brand, ref, purchase date, warranty status |
| `/amc/oem/$source/$id` | OEM product detail — source record, warranty status, create ticket |
| `/amc/settings` | AMC terms template + agreement prefix |
| `/crm` (+ tabs) | CRM hub: Dashboard, Leads, Quotations, Incentives, Bundles, UPS Backup Calculator, Settings |
| `/crm/leads`, `/crm/leads/$id` | Leads list + detail (activity log, follow-ups, convert Won/Lost w/ reason, incentive calc) |
| `/crm/quotations` (+ /new, /$id) | Quotation workspace: GST-compliant builder, statuses, duplicate, convert to SO, print/PDF, WhatsApp, UPS Smart Panel |
| `/crm/incentives` | Incentive tiers/rules editor, payouts, preview calculator |
| `/crm/bundles` | UPS bundles + battery catalog |
| `/crm/ai-recommend` | UPS backup-time calculator (kVA, power factor, DC bus, battery sizes, charger) |
| `/crm/settings` | Business state/GSTIN, default terms, quote-terms templates, OEM logos |
| `/crm/customers` | Redirect → `/masters/customers` |
| `/sales` (+ tabs) | Sales hub: Head Sales, Sales Orders, Invoices, General DC, Payments, e-Way Bills, Quotations, Settings |
| `/sales/` | Head Sales dashboard — KPIs, monthly trend, branch/salesperson/region filters, outstanding |
| `/sales/orders` (+ /$id) | SO list + detail (create DC, create Invoice) |
| `/sales/invoices/` (+ /new, /$id) | Invoices: list, GST invoice creation (serial picking, negative-stock guard, GDC prefill), view (print/PDF, e-Way, payments, cancel) |
| `/sales/general-dc/` (+ /new, /$id, /$id/edit) | General DC: dispatch challans w/ stock posting & invoice conversion, issue, cancel, return GRN prefill |
| `/sales/payments/` (+ /new) | Payments received + allocation to invoices |
| `/sales/eway/` | e-Way bills list |
| `/sales/quotations` | Redirect → `/crm/quotations` |
| `/sales/settings` | Per-branch invoice prefix/sequence, terms, place-of-supply, letterhead, company profile |
| `/indent` (+ outlet) | Indent hub |
| `/indent/` | Purchase Request (Indent) list — KPIs, oracle status, filters |
| `/indent/new` | New indent — defective parts → Oracle blocks, ticket link |
| `/indent/$id` | Indent detail — Oracle blocks, A→D pipeline (DC, GRN-OEM, GRN-Customer), auto-close |
| `/po` (+ tabs) | PO hub: All POs, New PO, Settings |
| `/po/` , `/po/new`, `/po/$id`, `/po/settings` | PO list/create/detail (print/PDF)/per-branch settings |
| `/ims` (+ 13 tabs) | IMS hub |
| `/ims/` | IMS dashboard — stock by warehouse/OEM, transfers, reservations, transactions charts |
| `/ims/stock-management` | Stock workbench — stock/txn overview, received-by-GRN analysis, low stock |
| `/ims/ledger` | Warehouse ledger — running balances, in/out/adj, defective-tag printing |
| `/ims/stock` | Stock items ledger — CRUD per serialized item |
| `/ims/transactions` | Stock transactions ledger — CRUD |
| `/ims/transfers` (+ /new, /$id) | Inter-warehouse transfers — approve/reject/cancel/receive workflow |
| `/ims/reservations` | Stock reservations — release/delete |
| `/ims/oem-returns` | Defective → OEM return tracking |
| `/ims/defective-tags` | Defective tag generation/printing, dispatch tracking |
| `/ims/indent-history` | Transactions grouped by indent lifecycle |
| `/ims/serial-track` | Global serial number tracking |
| *(remaining IMS tabs)* | e.g., stock views by warehouse, category, etc. — see `src/routes/_app/ims.*.tsx` |

## Layout & nav
- `_app.tsx` renders sidebar with module links filtered by `usePermissions().can(module, 'access')` + admin links.
- Header includes user profile menu (`UserProfileMenu.tsx`) with sign-out, `IdleTimeout` component mounted app-wide.

## Note
Route files are the source of truth; `routeTree.gen.ts` is generated. When adding routes, create files under `src/routes/` and let the build regenerate the tree.