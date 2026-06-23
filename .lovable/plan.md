# Compact Enterprise Form Redesign

## Goal
Replace today's long single-column forms with a dense, Linear/Jira-style layout: responsive grid, collapsible sections, sticky header actions, editable line-item grids, and a Comfortable/Compact density toggle. All existing fields, validations, and business logic stay intact.

## 1. Reusable form primitives (new)
Create `src/components/form-kit/` with:
- `FormShell.tsx` — page wrapper: sticky title bar with title, subtitle, action slot (Save Draft / Submit / Cancel), density toggle, breadcrumbs slot.
- `FormSection.tsx` — collapsible card (shadcn Collapsible + Card). Props: `title`, `description`, `defaultOpen`, `icon`. First section open by default.
- `FormGrid.tsx` — 12-col responsive grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3`).
- `FormField.tsx` — wraps label + control; `size="sm" | "md" | "lg" | "full"` maps to `col-span` (sm=3, md=6, lg=8, full=12 on lg; collapses on smaller breakpoints per spec).
- `LineItemGrid.tsx` — editable data grid with sticky header, inline inputs, add-row button, row delete, optional row totals, search box.
- `useFormDensity.ts` + `DensityProvider` — context storing `comfortable | compact` in `localStorage`; injects CSS var `--field-h` (40px / 32px) and `--field-px`.

## 2. Design tokens
Add to `src/styles.css`:
- `--form-field-gap: 12px; --form-section-gap: 20px; --form-card-pad: 16px;`
- `.form-input { height: var(--field-h, 40px); }` applied via a `compact-form` class wrapper.
- Subtle border util `border-border/60` + `shadow-sm rounded-xl` baseline for section cards.

## 3. Apply to existing forms
Refactor (layout only — no field/logic changes):
- `src/components/ChallanForm.tsx`
- `src/components/GrnForm.tsx`
- `src/routes/_app/new.tsx` (Gatepass)
- `src/routes/_app/indent.new.tsx`
- `src/routes/_app/tickets.new.tsx`
- `src/routes/_app/amc.new.tsx`

Each becomes:
```
<FormShell title="..." actions={...}>
  <FormSection title="Basic Information" defaultOpen>
    <FormGrid>
      <FormField size="sm">Status</FormField>
      <FormField size="md">Customer</FormField>
      <FormField size="full">Description</FormField>
    </FormGrid>
  </FormSection>
  <FormSection title="Items"><LineItemGrid .../></FormSection>
</FormShell>
```

Field width assignments follow the spec: Status/Priority/Qty/UOM/Tax/Date = sm; Customer/Vendor/PO/Ref = md; Description/Remarks/Notes = full.

## 4. Line items
Convert stacked item rows in Challan/GRN/Indent forms to `LineItemGrid` with sticky header, inline `ProductMasterPicker`, qty/uom/desc inline. Add-row + delete + totals row.

## 5. Density & responsive
- Density toggle in `FormShell` header (right side).
- Mobile: grid collapses to single column; action bar becomes sticky bottom (`fixed bottom-0` on `<sm`).
- Sections remain collapsible on all breakpoints.

## 6. Out of scope
- No schema or API changes.
- No new fields or removed fields.
- Print/PDF templates untouched.
- Master pickers (Customer/Vendor/Product) reused as-is.

## Technical notes
- Pure presentation refactor; state shapes in each form stay the same.
- shadcn `Collapsible`, `Card`, existing `Input`/`Select` reused.
- Wizard mode (>15 fields) deferred — current forms fit in 3–4 collapsible sections, which already meets the "reduce scrolling 50%" goal without route changes.

## Rollout order
1. Build `form-kit/` + tokens.
2. Migrate ChallanForm + GrnForm (highest traffic).
3. Migrate Indent, Ticket, Gatepass, AMC new forms.
4. Visual QA on desktop + mobile viewport.
