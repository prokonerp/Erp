## Goal
Introduce a single landing **Dashboard** that renders dynamically from the existing **Users & Roles → Module Permissions** system. Admins get full enterprise view; users see only widgets for modules they can `read`.

## Scope of this change
Only the dashboard surface, landing route, and a few small shared bits. Existing modules, permissions schema, role-based menu (already in `_app.tsx`), and all module pages stay as-is.

## 1. Landing route
- `src/routes/index.tsx` → after login, redirect to `/dashboard` (instead of `/new`).
- New route `src/routes/_app/dashboard.tsx` becomes the default home for all signed-in users.
- Add a "Dashboard" item at the top of the sidebar in `src/routes/_app.tsx` (visible to everyone — gating happens inside the dashboard itself).

## 2. Permission model reuse
Use the existing `usePermissions()` hook unchanged:
- `isAdmin === true` → Admin Dashboard variant.
- Otherwise → User Dashboard renders only widgets where `can(module, "read")` is true.

Module → widget mapping:

| Module key | Widget |
|---|---|
| `tickets` | Tickets KPIs (assigned to me, open, in-progress, closed, overdue/SLA) |
| `amc` | AMC KPIs (active contracts, upcoming renewals 30d, expiring, PM due) |
| `indent` | Indent KPIs (my indents, pending, approved, rejected) |
| `quotations` | Sales CRM (assigned leads, open opportunities, follow-ups due, pipeline value) |
| `ims` | Inventory (total stock, low stock alerts, pending GRNs, recent transactions) |
| `gatepass` | Material Movement (open gatepasses, DCs this week, GRNs received, in/out summary) |

If a user has zero accessible modules → friendly empty state explaining no modules are assigned.

## 3. Admin Dashboard
- Header strip: "Admin Overview" with quarterly range selector (Q1/Q2/Q3/Q4/YTD).
- Top row: cross-module KPIs (total tickets open, AMC expiring 30d, indents pending, pipeline value, low-stock count, gatepasses open).
- Quarterly comparison card: tickets created this quarter vs previous quarter (mini bar).
- Team performance card: top 5 engineers by tickets closed in selected range.
- Recent activity feed: latest 15 events across tickets/AMC/indent.
- Quick actions: New Ticket, New AMC, New Indent, New Gatepass, New GRN, Reports.

## 4. User Dashboard
- Personal header: "Welcome, <name>" + role label.
- Dynamic responsive grid (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`) — auto-fits the number of allowed module widgets.
- Each widget = compact ERP-style card with:
  - Module name + icon
  - 3–4 KPI tiles (Total / Open / Completed / Overdue) with consistent colors (green=positive, red=alert, blue=active, gray=neutral)
  - "View All" link to module index
- Activity Feed (right column on xl): only items in accessible modules and where user is assignee/owner where applicable (engineer name match for tickets, created_by for indent).
- Quick Actions strip: shows only actions the user has `create` permission for (filtered using `can(module, "create")`).

## 5. Data fetching
- Single dashboard route, parallel `supabase` queries fired inside `useEffect` per enabled module (skipped entirely if module not accessible — keeps payload small).
- Tickets: filter by `assigned_engineer_name === profile.name` for the user view; admin sees all.
- AMC renewals/PM: 30-day forward window.
- Reuse helpers already in `@/lib/tickets`, `@/lib/indent`, etc.
- No new DB tables, no migrations, no edge functions.

## 6. UX details
- Clean compact cards, `border rounded-md`, consistent KPI tile pattern (icon + label + count, colored accent bar).
- Loading skeletons per widget so the grid stays stable.
- All widget queries fail-soft (a single module error doesn't blank the page).

## 7. Files touched
- `src/routes/index.tsx` — redirect to `/dashboard`.
- `src/routes/_app.tsx` — add Dashboard nav entry.
- `src/routes/_app/dashboard.tsx` — new, contains both variants.
- `src/components/dashboard/` — new folder with `KpiTile.tsx`, `ModuleCard.tsx`, `TicketsWidget.tsx`, `AmcWidget.tsx`, `IndentWidget.tsx`, `CrmWidget.tsx`, `ImsWidget.tsx`, `MaterialMovementWidget.tsx`, `AdminOverview.tsx`, `ActivityFeed.tsx`, `QuickActions.tsx`.

## Out of scope (call out)
- No changes to the Users & Roles config UI — it already drives permissions.
- No new permission flags; if you later want a separate "dashboard" module toggle we can add it, but per your spec the dashboard is just a renderer of existing module permissions.
- SLA logic for tickets will use the existing `hoursExcludingSundays` + priority thresholds already in `@/lib/tickets`; if you want different SLA windows say so and I'll wire them.

Confirm and I'll build it.
