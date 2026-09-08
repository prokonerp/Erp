# PO Warranty Fix + Editable Address + Print (Letterhead/Logo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On purchase-order creation, the delivery address and per-line warranty auto-populate but stay editable; add a per-branch **Print Settings** section to PO Settings that defines the letterhead (logo + selected office address) used on the PO PDF.

**Architecture:** Three independent workstreams that merge in the PO PDF:
1. **Data/DB** — extend the branch-scoped `po_settings` table with print columns (logo path, letterhead address source) and create a private `po-logos` Supabase storage bucket.
2. **Warranty fix** — make `useProductsForPicker` select the warranty columns so `productWarrantyMonths()` returns the real value instead of always 0 → default 12.
3. **Editable address** — remove the `readOnly`/`bg-muted/50` gating on the delivery address textarea so it can always be edited directly.
4. **Print Settings UI** — a "Print Settings" card in `po.settings.tsx`: preloaded `prokon-logo.jpeg` default thumbnail, file upload → private storage, and a dropdown of office addresses from `company_profile` (Registered / Factory / Sales Office) plus the branch address.
5. **PDF letterhead** — `purchaseOrderPdf.ts` renders logo + the selected office address (falling back to branch address), read from `po_settings` (via `po.$id.tsx`).

**Tech Stack:** TanStack Start (Vite, React Router), React 19, TypeScript (strict), Supabase (PostgREST + Storage), jsPDF + jspdf-autotable, Vitest.

**Spec:** `docs/superpowers/plans/2026-09-08-po-warranty-fix.md` (this file).

## Global Constraints
- **No Vercel / GitHub remote writes.** All work is local commits only. Provide `.env`/SQL for the user to apply manually.
- **Strict project isolation:** only `/Users/jai/Desktop/Prokon Erp`. Do not touch `sewadar-attendance` or `sewadar-deployment-portal`.
- Migrations follow the existing pattern in `supabase/migrations/` (numbered `YYYYMMDDHHMMSS_*.sql`, idempotent `IF NOT EXISTS` / `ON CONFLICT`).
- Use `(supabase as any).from(...)` for tables/columns not yet in generated types; keep generated types untouched unless editing is required (DB-first; generated types are NOT regenerated in this plan).
- PDF `₹` renders as `¹` in jsPDF Helvetica → use `"Rs. "` prefix (existing `inrPdf` convention in `purchaseOrderPdf.ts`).
- Follow existing component/UI conventions (Card + CardHeader/CardTitle/CardContent, `@/components/ui/*`, `toast` from sonner, lucide icons).
- Storage uploads: PNG/JPG only, max 2 MB, private bucket, store path like `po-logos/{branch_id}.{ext}`, mirror `SignatureSettings.tsx` storage pattern.

---

## File Map

| Responsibility | File | Action |
|---|---|---|
| DB schema | `supabase/migrations/20260909000000_po_print_settings.sql` | Create (new) |
| Warranty select fix | `src/hooks/useMasters.ts:183-220` | Modify |
| Editable address (new) | `src/routes/_app/po.new.tsx` (~L278-292) | Modify |
| Editable address (edit) | `src/routes/_app/po.$id_.edit.tsx` (~L390-405) | Modify |
| Print Settings UI | `src/routes/_app/po.settings.tsx` | Modify (security-sensitive: read user confirmation for upload) |
| Print helper types | `src/lib/poPrint.ts` | Create|
| PDF letterhead | `src/lib/purchaseOrderPdf.ts` | Modify |
| PDF wiring | `src/routes/_app/po.$id.tsx` (load ~L69-81 + print calls L163/174) | Modify |
| Tests | `src/lib/__tests__/poPrint.test.ts` | Create |

---

## Task 1: DB — po_settings print columns + logo bucket

**Files:**
- Create: `supabase/migrations/20260909000000_po_print_settings.sql`
- Test: `src/lib/__tests__/poPrint.test.ts` (modeled, see Task 2 — uses `resolvePoLetterhead`)

**Interfaces:**
- Produces: new `po_settings` columns `logo_url TEXT NULL`, `letterhead_address_source TEXT NULL` (values `'company_registered' | 'company_factory' | 'company_sales' | 'branch'`, default `'branch'`). Creates storage bucket `po-logos` (private, PNG/JPG, 2 MB).

- [ ] **Step 1: Write the migration**

```sql
-- PO Print Settings — letterhead logo + selected office address (per branch).
-- Extends the existing branch-scoped po_settings table. All idempotent.

ALTER TABLE public.po_settings
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE public.po_settings
  ADD COLUMN IF NOT EXISTS letterhead_address_source TEXT NOT NULL DEFAULT 'branch';

-- Create a private PO-logo storage bucket (PNG/JPG only, 2 MB cap).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'po-logos', 'po-logos', false, 2097152,
  ARRAY['image/png', 'image/jpeg']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS: any authenticated user may read (so print views can fetch signed URLs);
-- only admins may insert/update/delete.
DROP POLICY IF EXISTS "Authenticated can read po-logos" ON storage.objects;
CREATE POLICY "Authenticated can read po-logos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'po-logos');

DROP POLICY IF EXISTS "Admins can write po-logos" ON storage.objects;
CREATE POLICY "Admins can write po-logos" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'po-logos' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'po-logos' AND public.has_role(auth.uid(), 'admin'));
```

- [ ] **Step 2: Note test intent** — this column shape is consumed by Task 2's `resolvePoLetterhead`. No DB unit test runs here (schema applied by user manually); Task 2 covers the resolver logic in Vitest.

- [ ] **Step 3: Commit** (local only)
```bash
git add supabase/migrations/20260909000000_po_print_settings.sql
git commit -m "feat(po): add print settings columns + po-logos storage bucket"
```

---

## Task 2: PO print helper + editable address + warranty select fix (pure logic + select)

> Split into two focused pieces so each is independently testable. The resolver is pure → unit-testable; the select fix changes the query the warranty default path relies on.

**Files:**
- Create: `src/lib/poPrint.ts`
- Test: `src/lib/__tests__/poPrint.test.ts`
- Modify: `src/hooks/useMasters.ts` (add warranty cols to picker selects)

**Interfaces:**
- Produces: `type PoAddressSource`, `PO_ADDRESS_OPTIONS`, `resolvePoLetterhead({ source, branch, company }) → { address, officialLabel }`, `DEFAULT_PO_LOGO = "/prokon-logo.jpeg"`, `signPoLogoUrl(path)`.
- Consumes: `CompanyProfile` from `@/lib/companyProfile` (fields `regd_address`, `factory_address`, `sales_office_address`), `BranchRow.from @/lib/sales` (field `address`).

- [ ] **Step 1: Write failing tests** — `src/lib/__tests__/poPrint.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { resolvePoLetterhead, DEFAULT_PO_LOGO } from "@/lib/poPrint";
import { DEFAULT_COMPANY_PROFILE } from "@/lib/companyProfile";

const company = {
  ...DEFAULT_COMPANY_PROFILE,
  regd_address: "Regd: B-505, Sector-61, Gurgaon",
  factory_address: "Factory: Plot 12, Ind Area",
  sales_office_address: "Sales: MG Road, New Delhi",
};
const branch = { id: "b1", name: "Delhi", address: "Branch: Nehru Place, Delhi", is_default: true } as any;

describe("resolvePoLetterhead", () => {
  it("defaults to branch address", () => {
    const r = resolvePoLetterhead({ source: "branch", branch, company });
    expect(r.address).toBe("Branch: Nehru Place, Delhi");
    expect(r.officialLabel).toBe("Branch");
  });
  it("resolves registered office from company profile", () => {
    const r = resolvePoLetterhead({ source: "company_registered", branch, company });
    expect(r.address).toBe("Regd: B-505, Sector-61, Gurgaon");
  });
  it("falls back to branch when company office is empty", () => {
    const r = resolvePoLetterhead({ source: "company_sales", branch, company: { ...company, sales_office_address: null } });
    expect(r.address).toBe("Branch: Nehru Place, Delhi");
  });
  it("falls back to branch when branch missing", () => {
    const r = resolvePoLetterhead({ source: "company_factory", branch: null, company: { ...company, factory_address: null } });
    expect(r.address).toBe("");
  });
});

describe("DEFAULT_PO_LOGO", () => {
  it("is the preloaded prokon logo", () => {
    expect(DEFAULT_PO_LOGO).toBe("/prokon-logo.jpeg");
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `npx vitest run src/lib/__tests__/poPrint.test.ts`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/lib/poPrint.ts`

```ts
import type { CompanyProfile } from "@/lib/companyProfile";
import type { BranchRow } from "@/lib/sales";
import { supabase } from "@/integrations/supabase/client";

export type PoAddressSource =
  | "branch"
  | "company_registered"
  | "company_factory"
  | "company_sales";

export const PO_ADDRESS_OPTIONS: { value: PoAddressSource; label: string }[] = [
  { value: "branch", label: "Branch Address" },
  { value: "company_registered", label: "Registered Office (company)" },
  { value: "company_factory", label: "Factory Address (company)" },
  { value: "company_sales", label: "Sales Office (company)" },
];

/** Preloaded default PO letterhead logo. */
export const DEFAULT_PO_LOGO = "/prokon-logo.jpeg";

export function resolvePoLetterhead(args: {
  source?: PoAddressSource | null;
  branch: BranchRow | null;
  company: CompanyProfile | null | undefined;
}): { address: string; officialLabel: string; source: PoAddressSource } {
  const src: PoAddressSource = args.source ?? "branch";
  const company = args.company;
  const branch = args.branch;
  const pick: Record<PoAddressSource, string | null | undefined> = {
    branch: branch?.address,
    company_registered: company?.regd_address,
    company_factory: company?.factory_address,
    company_sales: company?.sales_office_address,
  };
  const label: Record<PoAddressSource, string> = {
    branch: "Branch",
    company_registered: "Registered Office",
    company_factory: "Factory",
    company_sales: "Sales Office",
  };
  // Prefer the requested source; fall back to branch address; then empty.
  if (pick[src]) return { address: pick[src]!, officialLabel: label[src], source: src };
  if (src !== "branch" && branch?.address) return { address: branch.address, officialLabel: label[src], source: src };
  return { address: "", officialLabel: label[src], source: src };
}

/** Signed URL for the PO logo stored in the private po-logos bucket. */
export async function signPoLogoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const { data } = await supabase.storage.from("po-logos").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Fix warranty select** — in `src/hooks/useMasters.ts:183-220`, add the six warranty columns to BOTH `.select(...)` calls in `useProductsForPicker` (empty-search and searched variants):

Current: `"id, name, model, short_name, display_name, brand, category, hsn, unit, is_serialized, serial_tracking"`
New: `"id, name, model, short_name, display_name, brand, category, hsn, unit, is_serialized, serial_tracking, warranty_applicable, warranty_duration, warranty_unit, warranty_start_from, warranty_manual_override"`

This makes `productWarrantyMonths()` (in `src/lib/sales.ts`) return the real product warranty when a PO line is picked.

- [ ] **Step 5: Run tests to pass** — `npx vitest run src/lib/__tests__/poPrint.test.ts` → PASS.
- [ ] **Step 6: Commit**
```bash
git add src/lib/poPrint.ts src/lib/__tests__/poPrint.test.ts src/hooks/useMasters.ts
git commit -m "feat(po): warranty auto-populate fix + print address resolver + default logo"
```

---

## Task 3: Make delivery address editable inline (new + edit)

**Files:**
- Modify: `src/routes/_app/po.new.tsx` (delivery textarea ~L278-292)
- Modify: `src/routes/_app/po.$id_.edit.tsx` (delivery textarea ~L390-405)

**Interfaces:**
- Consumes: no new deps; keeps existing `deliveryAddress`, `customAddress`, `deliveryType` state.

**Behavior change:** The "Deliver To" textarea is ALWAYS editable regardless of `deliveryType`. When the user types, it overrides the auto-populated value for the session and persists to `delivery_address` on save. The radio `org|customer|custom` still controls what auto-populates when the field is first shown / not manually edited, but the textarea is never `readOnly` and never dimmed.

- [ ] **Step 1: Apply to `po.new.tsx`** — replace the delivery textarea block:
```tsx
<div>
  <Label className="text-xs">Delivery Address *</Label>
  <Textarea
    rows={3}
    value={deliveryAddress}
    onChange={(e) => {
      setDeliveryAddressManual(e.target.value);
      // mark that address was manually overridden
      setDeliveryAddressTouched(true);
    }}
    placeholder="Delivery address… auto-populated from " + (deliveryType === "org" ? "branch" : deliveryType === "customer" ? "customer" : "custom") + " master — editable."
  />
  <p className="text-xs text-muted-foreground mt-1">
    Auto-populated from {deliveryType === "org" ? "branch" : deliveryType === "customer" ? "customer" : "custom"} master. You can edit this address for this PO.
  </p>
</div>
```
State additions near the existing `customAddress`:
```tsx
const [deliveryAddressManual, setDeliveryAddressManual] = useState<string>("");
const [deliveryAddressTouched, setDeliveryAddressTouched] = useState(false);
```
Change the `deliveryAddress` memo so manual edits take precedence once touched:
```tsx
const deliveryAddress = useMemo(() => {
  if (deliveryAddressTouched && deliveryAddressManual) return deliveryAddressManual;
  if (deliveryType === "org") return branch?.address || "";
  if (deliveryType === "customer") {
    return customer?.shipping_address || customer?.billing_address || (customer as any)?.address || "";
  }
  return customAddress;
}, [deliveryType, branch, customer, customAddress, deliveryAddressManual, deliveryAddressTouched]);
```
Wire the three delivery-address state pieces to `delivery_address` on save (already saved via `delivery_address: deliveryAddress`). When switching `deliveryType` via the radio, reset `deliveryAddressTouched=false` and `deliveryAddressManual=""` (add to the radio `onChange`).

- [ ] **Step 2: Apply the same to `po.$id_.edit.tsx`** — mirror the exact state + memo + textarea changes above (same pattern, using the file's existing `deliveryAddress`/`customAddress`/`deliveryType`). Remove `readOnly` and `bg-muted/50`.

- [ ] **Step 3: Manual verification** — start `bun run dev`, open PO new + edit, confirm: branch/customer auto-fills, text stays editable, edits persist on save. (No automated UI test in repo for this; rely on typecheck + manual.)
- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 5: Commit**
```bash
git add src/routes/_app/po.new.tsx "src/routes/_app/po.$id_.edit.tsx"
git commit -m "feat(po): make delivery address always editable (auto-populated default)"
```

---

## Task 4: PO Settings — Print Settings card (logo upload + office dropdown)

**Files:**
- Modify: `src/routes/_app/po.settings.tsx`
- Consumes: `po_settings` new columns; `supabase.storage.from("po-logos")`; `PO_ADDRESS_OPTIONS`, `resolvePoLetterhead`, `DEFAULT_PO_LOGO`, `signPoLogoUrl` from `@/lib/poPrint`; `fetchCompanyProfile` + `DEFAULT_COMPANY_PROFILE` from `@/lib/companyProfile`.

- [ ] **Step 1: Extend `POSettingsRow` type**
```ts
type POSettingsRow = {
  id?: string;
  branch_id: string;
  prefix: string;
  fy_reset: boolean;
  next_seq: number;
  terms_default: string | null;
  notes_default: string | null;
  logo_url: string | null;
  letterhead_address_source: string | null;
};
```

- [ ] **Step 2: Add state + load** — load `company_profile` (`fetchCompanyProfile`, fall to `DEFAULT_COMPANY_PROFILE`); load signed logo URL via `signPoLogoUrl(settings.logo_url)`. Add `previewLogo`.

- [ ] **Step 3: Build the Print Settings Card** (below the PO Numbering card). Includes:
  - **Logo** — preview image (default `DEFAULT_PO_LOGO` shown as "Default (preloaded)" when no `logo_url`); an `<input type="file" accept="image/png,image/jpeg">` + Upload button that uploads to `po-logos/{branch_id}.{ext}` (PNG/JPG, ≤2MB, `upsert:true`) then saves `logo_url` on the settings row; a "Reset to default" button that clears `logo_url` back to the preloaded logo and removes the stored file.
  - **Letterhead address** — a `<select>` bound to `letterhead_address_source` using `PO_ADDRESS_OPTIONS`, with a live `<preview>` of `resolvePoLetterhead({ source, branch, company }).address`.
  - Persist `logo_url` + `letterhead_address_source` in the existing `save()` (settings.id ? update : insert). Guard file type/size like `SignatureSettings.tsx`.

**Upload flow (mirror `SignatureSettings.upload`):**
```ts
const file = e.target.files?.[0];
if (!file) return;
if (!/^image\/(png|jpe?g)$/i.test(file.type)) return toast.error("Only PNG or JPG images are allowed");
if (file.size > 2 * 1024 * 1024) return toast.error("Max file size is 2 MB");
const ext = (file.name.split(".").pop() || "png").toLowerCase();
const path = `po-logos/${branchId}.${ext}`;
const { error: upErr } = await supabase.storage
  .from("po-logos")
  .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: true });
if (upErr) return toast.error(upErr.message);
setSettings((s) => ({ ...s!, logo_url: path }));
setPreviewLogo(await signPoLogoUrl(path));
```

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit**
```bash
git add src/routes/_app/po.settings.tsx
git commit -m "feat(po): add print settings (logo + office address) to PO settings"
```

---

## Task 5: PDF letterhead — logo + selected office

**Files:**
- Modify: `src/lib/purchaseOrderPdf.ts`
- Modify: `src/routes/_app/po.$id.tsx` (load + print wiring)

**Interfaces:**
- Consumes: `resolvePoLetterhead`, `signPoLogoUrl`, `DEFAULT_PO_LOGO` from `@/lib/poPrint`; po_settings address source.

- [ ] **Step 1: Extend PDF args** — add optional `logoUrl?: string | null` and `letterheadAddress?: string | null` and `letterheadAddressLabel?: string | null` to `renderPurchaseOrderPdf`'s `args`. Keep backward-compatible (default to current `branch.address`).

- [ ] **Step 2: Render logo in header** — in `purchaseOrderPdf.ts`, after the left company block, if `args.logoUrl` is present: embed it via `fetchSignatureDataUrl`-style helper (reuse the existing signature image helper) right-aligned top-left of the header box, max ~70×36 pt. Wrap in try/catch so a bad URL never crashes the PDF (consistent with the signature embed).

```ts
if (args.logoUrl) {
  try {
    const sig = await fetchSignatureDataUrl(args.logoUrl);
    if (sig?.dataUrl) {
      let iw = 70, ih = 36;
      try {
        const d = await getImageDimensions(sig.dataUrl);
        if (d?.w && d?.h) { const s = Math.min(70 / d.w, 36 / d.h, 1); iw = d.w * s; ih = d.h * s; }
      } catch {}
      doc.addImage(sig.dataUrl, (sig.format === "JPEG" ? "JPEG" : "PNG") as any, margin + cw - 90, y + 18, iw, ih);
    }
  } catch (e) { console.warn("[PO PDF] logo embed failed", e); }
}
```
Place the logo in the header's right area, making room so "PURCHASE ORDER" title shifts left if logo present (or place logo below header-right title). Prefer: title centered; logo top-right corner of the header box (x = margin + cw - 74, y = margin + 8). Adjust so text doesn't overlap.

- [ ] **Step 3: Wire settings into `po.$id.tsx`** — in the `load()` function, instead of reading only `invoice_settings`, also read `po_settings` for the branch:
  - `letterhead_address_source` from `po_settings`.
  - compute `letterhead = resolvePoLetterhead({ source, branch, company })`, passing to PDF as the effective `company_address`.
  - load signed logo: `const sigLogo = settings?.logo_url ? await signPoLogoUrl(settings.logo_url) : null;` → pass as `logoUrl`.
  - Keep the current `pdfSettings.company_name` etc. (invoice_settings) for name/phone/email/udyam.
  In the two calls (`handlePrintPdf`, `handleDownloadPdf`) pass the new `logoUrl` and use the resolved address as `company_address`.

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → 0.
- [ ] **Step 5: Manual print** — create PO in a branch, set a logo + office in PO settings, approve, Print PDF → verify logo + correct office address appear.
- [ ] **Step 6: Commit**
```bash
git add src/lib/purchaseOrderPdf.ts "src/routes/_app/po.$id.tsx"
git commit -m "feat(po): render logo + selected office on PO PDF letterhead"
```

---

## Task 6: Integration verification

- [ ] Run full checks:
```bash
npx vitest run
npx tsc --noEmit
npx eslint src/lib/poPrint.ts src/hooks/useMasters.ts "src/routes/_app/po.new.tsx" "src/routes/_app/po.$id_.edit.tsx" src/routes/_app/po.settings.tsx src/lib/purchaseOrderPdf.ts "src/routes/_app/po.$id.tsx"
```
- [ ] Send the migration SQL (Task 1 file) to the user to apply manually to Supabase (do **not** run `supabase db push`).
- [ ] Manual smoke: create/edit/print a PO.
- [ ] `git log --oneline` to show the 5 feature commits.