import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  Calculator,
  FileText,
  Loader2,
  MapPin,
  Plus,
  Receipt,
  StickyNote,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { quoteToSalesOrder, type NewSalesOrder } from "@/lib/documentFlow";
import { createSalesOrderFromQuote } from "@/lib/documentFlow.writers";
import type { SoItem } from "@/lib/salesOrders";
import { INDIAN_STATES, type Customer, type Quotation } from "@/lib/crm";
import {
  amountInWords,
  computeTotals,
  stateCodeFromGSTIN,
  stateCodeFromStateName,
} from "@/lib/gst";
import { r2 } from "@/lib/money";
import { fetchBranches, inr, type BranchRow } from "@/lib/sales";
import { istTodayIso } from "@/lib/dateRange";
import { cn } from "@/lib/utils";

/**
 * Full-window Quotation → Sales Order conversion form.
 *
 * Every field that ends up on the Sales Order is editable here. The draft is
 * initialised from {@link quoteToSalesOrder} — the same pure mapping the writer
 * uses — so this form can never drift from the default conversion.
 *
 * GST accuracy contract: the on-screen totals are produced by the SAME
 * `computeTotals` call the writer makes (same seller/buyer state-code
 * derivation, same header-discount handling, same shipping/adjustment/TCS
 * "extra" folds), and the derived `tcs_amount` is passed back in `overrides`.
 * The writer trusts `payload.tcs_amount` verbatim, so showing a value we do not
 * send would silently disagree with the stored Sales Order.
 */
type Props = {
  quotation: Quotation;
  onSuccess: (so: { id: string; so_no: string | null }) => void;
};

/** Editable line — numbers are held as strings so partial/invalid input is
 *  typeable and can be reported inline instead of silently coerced to 0. */
type DraftItem = {
  /** Original mapped line. Preserved fields (product_id, warranty, warehouse,
   *  serials, part_model_no…) ride along on submit and are re-overwritten by
   *  the writer's own GST breakup. */
  src: SoItem | null;
  /** Stable per-row identity for React keys. Index keys mis-bind inputs when a
   *  row above is deleted, so rows carry their own id. */
  id: string;
  description: string;
  hsn: string;
  qty: string;
  unit: string;
  rate: string;
  discount_pct: string;
  gst_rate: string;
  cess_rate: string;
};

type HeaderDraft = {
  so_date: string;
  valid_until: string;
  expected_delivery: string;
  po_number: string;
  po_date: string;
  payment_terms: string;
  delivery_timeline: string;
  salesperson: string;
  place_of_supply: string;
  contact_person: string;
  contact_email: string;
  contact_mobile: string;
  billing_address: string;
  shipping_address: string;
  notes: string;
  terms: string;
};

type ChargesDraft = {
  shipping_charges: string;
  adjustment: string;
  tcs_percent: string;
  discount_amount: string;
  discount_label: string;
};

type Draft = { header: HeaderDraft; charges: ChargesDraft; items: DraftItem[] };

type RowError = Partial<
  Record<"description" | "qty" | "rate" | "discount_pct" | "gst_rate" | "cess_rate", string>
>;

type FormErrors = {
  so_date?: string;
  po_number?: string;
  po_date?: string;
  items?: string;
  party?: string;
  totals?: string;
  rows: Record<number, RowError>;
};

const EMPTY_ERRORS: FormErrors = { rows: {} };

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

/** Lenient parse — used for previews/storage of optional fields (empty ⇒ 0). */
const n = (v: string): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Strict parse — a rate/qty a user must actually type. Empty ⇒ null (invalid). */
const typedNumber = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};

let rowSeq = 0;
/** Monotonic row id — stable across add/delete so React keys never rebind inputs. */
const nextRowId = () => `row-${++rowSeq}`;

const isBlankRow = (it: DraftItem): boolean =>
  !it.description.trim() &&
  !it.hsn.trim() &&
  !it.qty.trim() &&
  !it.unit.trim() &&
  !it.rate.trim() &&
  !it.discount_pct.trim() &&
  !it.gst_rate.trim() &&
  !it.cess_rate.trim();

const emptyRow = (): DraftItem => ({
  src: null,
  id: nextRowId(),
  description: "",
  hsn: "",
  qty: "",
  unit: "",
  rate: "",
  discount_pct: "",
  gst_rate: "",
  cess_rate: "",
});

const buildDraft = (q: Quotation): Draft => {
  const base = quoteToSalesOrder(q);
  return {
    header: {
      so_date: base.so_date || istTodayIso(),
      valid_until: s(base.valid_until),
      expected_delivery: s(base.expected_delivery),
      po_number: s(base.po_number),
      po_date: s(base.po_date),
      payment_terms: s(base.payment_terms),
      delivery_timeline: s(base.delivery_timeline),
      salesperson: s(base.salesperson),
      place_of_supply: s(base.place_of_supply),
      contact_person: s(base.contact_person),
      contact_email: s(base.contact_email),
      contact_mobile: s(base.contact_mobile),
      billing_address: s(base.billing_address),
      shipping_address: s(base.shipping_address),
      notes: s(base.notes),
      terms: s(base.terms),
    },
    charges: {
      shipping_charges: s(base.shipping_charges),
      adjustment: s(base.adjustment),
      tcs_percent: s(base.tcs_percent),
      discount_amount: s(base.discount_amount),
      discount_label: s(base.discount_label) || "Discount",
    },
    items: (base.items ?? []).map((it) => ({
      src: it,
      description: s(it.description),
      hsn: s(it.hsn),
      qty: s(it.qty),
      unit: s(it.unit),
      rate: s(it.rate),
      discount_pct: s(it.discount_pct),
      gst_rate: s(it.gst_rate),
      cess_rate: s(it.cess_rate),
      id: nextRowId(),
    })),
  };
};

/** Mirrors the writer's private `fetchCustomer` (documentFlow.writers.ts). */
async function loadCustomer(id: string | null): Promise<Customer | null> {
  if (!id) return null;
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as Customer) || null;
}

/** Swiss/minimal section card: uppercase micro-header with an icon, dense body. */
function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h3 className="truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {title}
          </h3>
        </div>
        {action}
      </div>
      <div className="px-2.5 py-2.5">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  error,
  errorId,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  /** id of the error paragraph, so the input can `aria-describedby` it. */
  errorId?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // scroll-mt-14 keeps a focused field clear of the sticky popup header / rail.
    <div className={cn("scroll-mt-14", className)}>
      <Label
        htmlFor={htmlFor}
        className="mb-1 block text-[11px] font-medium leading-none text-muted-foreground"
      >
        {label}
        {required ? <span className="ml-0.5 text-rose-600">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="mt-1 text-[11px] font-medium text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Read-only key/value pair for the party strip — deliberately not an input. */
function PartyPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium" title={value}>
        {value}
      </span>
    </div>
  );
}

function TotalsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-xs">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}

export function QuoteToSoConversionForm({ quotation, onSuccess }: Props) {
  const [draft, setDraft] = useState<Draft>(() => buildDraft(quotation));
  const [errors, setErrors] = useState<FormErrors>(EMPTY_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  /** Synchronous latch: a state flag alone cannot block a same-tick double click
   *  (setSubmitting only lands on the next render). The writer is idempotent, so
   *  a duplicate could not create two SOs — but it would double-fire toasts and
   *  navigation, so block it here too. */
  const submitLatch = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [party, setParty] = useState<{
    status: "loading" | "ready" | "error";
    customer: Customer | null;
    branch: BranchRow | null;
    message: string | null;
  }>({ status: "loading", customer: null, branch: null, message: null });
  const [partyRetryKey, setPartyRetryKey] = useState(0);
  /** Focus target for the error summary at the top of the form. */
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  /** Bumped on every failed submit. Calling `.focus()` inside the handler cannot
   *  work on the FIRST failure — the summary is mounted by the state update on
   *  that same commit — so the effect below focuses it after React has flushed.
   *  Keyed on a submit counter rather than on the message list so fixing a field
   *  never yanks focus away from the input being typed in. */
  const [errorFocusTick, setErrorFocusTick] = useState(0);

  // Re-seed the whole draft when a different quotation is handed to the form.
  useEffect(() => {
    setDraft(buildDraft(quotation));
    setErrors(EMPTY_ERRORS);
    setSubmitError(null);
  }, [quotation]);

  // Branch + customer are fetched only to mirror the writer's
  // sellerStateCode / buyerStateCode derivation so the previewed GST split
  // equals the stored one. They are never editable here.
  useEffect(() => {
    let alive = true;
    setParty({ status: "loading", customer: null, branch: null, message: null });
    (async () => {
      try {
        const [branches, customer] = await Promise.all([
          fetchBranches(),
          loadCustomer(quotation.customer_id),
        ]);
        if (!alive) return;
        const branch = branches.find((b) => b.id === quotation.branch_id) ?? null;
        setParty({
          status: "ready",
          customer,
          branch,
          message: branch
            ? null
            : "Branch could not be resolved — the Sales Order writer refuses to create documents without a branch (Sales → Settings).",
        });
      } catch (e: unknown) {
        if (!alive) return;
        setParty({
          status: "error",
          customer: null,
          branch: null,
          message: (e as Error)?.message || "Could not load customer / branch details",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [quotation, partyRetryKey]);

  // Same derivation order as createSalesOrderFromQuote (documentFlow.writers.ts).
  const sellerCode = party.branch?.state_code || stateCodeFromGSTIN(party.branch?.gstin) || null;
  const buyerCode =
    (party.customer as unknown as { state_code?: string | null } | null)?.state_code ||
    stateCodeFromGSTIN(party.customer?.gst) ||
    stateCodeFromStateName(party.customer?.state) ||
    null;

  const liveItems = useMemo(() => draft.items.filter((it) => !isBlankRow(it)), [draft.items]);

  const previewItems = useMemo(
    () =>
      liveItems.map((it) => ({
        qty: n(it.qty),
        rate: n(it.rate),
        discount_pct: n(it.discount_pct),
        gst_rate: n(it.gst_rate),
        cess_rate: n(it.cess_rate),
      })),
    [liveItems],
  );

  const headerDiscount = n(draft.charges.discount_amount);
  const shipping = n(draft.charges.shipping_charges);
  const adjustment = n(draft.charges.adjustment);
  const tcsPercent = n(draft.charges.tcs_percent);

  /** Mirrors the writer: computeTotals(...) then fold shipping + adjustment +
   *  tcs_amount on top and round the grand total (round_off is re-derived). */
  const totals = useMemo(() => {
    if (party.status === "loading") return null;
    try {
      const base = computeTotals({
        sellerStateCode: sellerCode,
        buyerStateCode: buyerCode,
        items: previewItems,
        headerDiscount,
        roundOff: true,
      });
      // The writer stores payload.tcs_amount verbatim, so derive it here and
      // send it back — never display a TCS the writer would not compute.
      const tcsAmount = r2(base.taxable_value * (tcsPercent / 100));
      // `extra` is deliberately NOT rounded before the fold: the writer adds the
      // raw shipping/adjustment/tcs_amount and applies a single r2, so rounding
      // here first could disagree by one paisa on half-paise inputs.
      const gross = r2(
        base.taxable_value +
          base.cgst +
          base.sgst +
          base.igst +
          base.cess +
          shipping +
          adjustment +
          tcsAmount,
      );
      const total = r2(Math.round(gross));
      return { base, tcsAmount, gross, total, roundOff: r2(total - gross) };
    } catch {
      return null;
    }
  }, [
    party.status,
    sellerCode,
    buyerCode,
    previewItems,
    headerDiscount,
    shipping,
    adjustment,
    tcsPercent,
  ]);

  /** Messages for the focusable error summary. Derived from the same `errors`
   *  object `validate()` already produced, so the summary never duplicates a
   *  message string and clears itself as fields are fixed. */
  const errorMessages = useMemo(() => {
    const out: string[] = [];
    if (errors.so_date) out.push(errors.so_date);
    if (errors.po_number) out.push(errors.po_number);
    if (errors.po_date) out.push(errors.po_date);
    for (const row of Object.values(errors.rows)) {
      for (const msg of Object.values(row)) if (msg) out.push(msg);
    }
    if (errors.items) out.push(errors.items);
    if (errors.party) out.push(errors.party);
    if (errors.totals) out.push(errors.totals);
    return out;
  }, [errors]);

  useEffect(() => {
    if (errorFocusTick > 0) errorSummaryRef.current?.focus();
  }, [errorFocusTick]);

  const patchHeader = (key: keyof HeaderDraft, value: string) => {
    setDraft((d) => ({ ...d, header: { ...d.header, [key]: value } }));
    setErrors((e) => (e[key as keyof FormErrors] ? { ...e, [key]: undefined } : e));
  };

  const patchCharges = (key: keyof ChargesDraft, value: string) => {
    setDraft((d) => ({ ...d, charges: { ...d.charges, [key]: value } }));
  };

  const patchItem = (idx: number, key: keyof Omit<DraftItem, "src">, value: string) => {
    setDraft((d) => ({
      ...d,
      items: d.items.map((it, i) => (i === idx ? { ...it, [key]: value } : it)),
    }));
    setErrors((e) => {
      if (!e.rows[idx]?.[key as keyof RowError]) return e;
      const row = { ...e.rows[idx] };
      delete row[key as keyof RowError];
      const rows = { ...e.rows };
      if (Object.keys(row).length) rows[idx] = row;
      else delete rows[idx];
      return { ...e, rows };
    });
  };

  const addItem = () => {
    setDraft((d) => ({ ...d, items: [...d.items, emptyRow()] }));
    // Row errors are index-keyed — drop them rather than let them point at the wrong line.
    setErrors((e) => ({ ...e, rows: {} }));
  };

  const removeItem = (idx: number) => {
    setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
    setErrors((e) => ({ ...e, rows: {} }));
  };

  /** Fallback only — the Amount column is sourced from the real breakup
   *  (`totals.base.items`) whenever it is available. Kept identical to
   *  `computeLine`'s taxable_value so it can never drift from the stored value. */
  const lineAmount = (it: DraftItem): number => {
    const gross = n(it.qty) * n(it.rate);
    return r2(gross - (gross * n(it.discount_pct)) / 100);
  };

  const validate = (): { errors: FormErrors; messages: string[] } => {
    const next: FormErrors = { rows: {} };
    const messages: string[] = [];

    if (!draft.header.so_date.trim()) {
      next.so_date = "SO Date is required";
      messages.push(next.so_date);
    }
    if (!draft.header.po_number.trim()) {
      next.po_number = "PO Number is required";
      messages.push(next.po_number);
    }
    if (!draft.header.po_date.trim()) {
      next.po_date = "PO Date is required";
      messages.push(next.po_date);
    }

    draft.items.forEach((it, idx) => {
      if (isBlankRow(it)) return;
      const label = `Line ${idx + 1}`;
      const row: RowError = {};
      if (!it.description.trim()) row.description = `${label} description is required`;
      const qty = typedNumber(it.qty);
      if (qty === null || qty <= 0) row.qty = `${label} quantity must be greater than 0`;
      const rate = typedNumber(it.rate);
      if (rate === null || rate < 0) row.rate = `${label} rate is invalid`;
      const pctFields: [keyof RowError, string, string][] = [
        ["discount_pct", it.discount_pct, "discount %"],
        ["gst_rate", it.gst_rate, "GST %"],
        ["cess_rate", it.cess_rate, "cess %"],
      ];
      for (const [key, raw, pctLabel] of pctFields) {
        if (!raw.trim()) continue;
        const v = typedNumber(raw);
        if (v === null) row[key] = `${label} ${pctLabel} is invalid`;
        else if (v < 0 || v > 100) row[key] = `${label} ${pctLabel} must be between 0 and 100`;
      }
      if (Object.keys(row).length) {
        next.rows[idx] = row;
        messages.push(...Object.values(row).filter((m): m is string => !!m));
      }
    });

    const hasRealLine = draft.items.some(
      (it) => !!it.description.trim() && (typedNumber(it.qty) ?? 0) > 0,
    );
    if (!hasRealLine) {
      next.items = "Add at least one item";
      messages.push(next.items);
    }

    if (party.status === "error") {
      next.party =
        "Customer / branch details failed to load — retry before creating the Sales Order (its GST split cannot be verified).";
      messages.push(party.message || next.party);
    } else if (party.status === "ready") {
      // Loading finished but the party is incomplete. The writer's
      // hydrateParties throws for a missing branch only AFTER a network
      // round-trip, which surfaced as a generic submit error — block here.
      if (!party.branch) {
        next.party =
          "Branch could not be resolved — set a branch in Sales → Settings before creating the Sales Order.";
        messages.push(next.party);
      }
      if (!party.customer) {
        next.party =
          "Customer could not be resolved — check the quotation's customer before creating the Sales Order.";
        messages.push(next.party);
      }
    }
    if (!totals) {
      // `totals` is null in two very different situations — distinguish them so
      // the user is not told to fix a discount when the form is simply loading.
      next.totals =
        party.status === "loading"
          ? "Customer / branch details are still loading — wait a moment and submit again."
          : "Totals could not be computed — check that the header discount is not larger than the subtotal, and that no line has a discount over 100%.";
      messages.push(next.totals);
    }

    return { errors: next, messages };
  };

  const submit = async () => {
    if (submitLatch.current) return;
    const { errors: nextErrors, messages } = validate();
    if (messages.length) {
      setErrors(nextErrors);
      // Focus the (linked) error summary before the toast, so a keyboard user
      // lands on the list of problems instead of staying at the bottom rail.
      setErrorFocusTick((t) => t + 1);
      errorSummaryRef.current?.focus();
      toast.error(
        messages.length > 3
          ? `${messages.slice(0, 3).join(" · ")} (+${messages.length - 3} more)`
          : messages.join(" · "),
      );
      return;
    }
    if (!totals) return;

    const items: SoItem[] = liveItems.map((it) => ({
      ...(it.src ?? {
        product_id: null,
        description: "",
        hsn: null,
        qty: 0,
        unit: null,
        rate: 0,
        discount_pct: 0,
        gst_rate: 0,
      }),
      description: it.description.trim(),
      hsn: it.hsn.trim() || null,
      qty: n(it.qty),
      unit: it.unit.trim() || null,
      rate: n(it.rate),
      discount_pct: n(it.discount_pct),
      gst_rate: n(it.gst_rate),
      cess_rate: n(it.cess_rate),
    }));

    const overrides: Partial<NewSalesOrder> = {
      so_date: draft.header.so_date,
      valid_until: draft.header.valid_until || null,
      expected_delivery: draft.header.expected_delivery || null,
      po_number: draft.header.po_number.trim(),
      po_date: draft.header.po_date,
      payment_terms: draft.header.payment_terms || null,
      delivery_timeline: draft.header.delivery_timeline || null,
      salesperson: draft.header.salesperson || null,
      place_of_supply: draft.header.place_of_supply || null,
      contact_person: draft.header.contact_person || null,
      contact_email: draft.header.contact_email || null,
      contact_mobile: draft.header.contact_mobile || null,
      billing_address: draft.header.billing_address || null,
      shipping_address: draft.header.shipping_address || null,
      notes: draft.header.notes || null,
      terms: draft.header.terms || null,
      items,
      shipping_charges: shipping,
      adjustment,
      tcs_percent: tcsPercent,
      tcs_amount: totals.tcsAmount,
      discount_amount: headerDiscount,
      // The writer prefers discount_amount; keep the legacy column in step so
      // the two can never disagree.
      discount: headerDiscount,
      discount_label: draft.charges.discount_label.trim() || null,
    };

    submitLatch.current = true;
    setSubmitting(true);
    setSubmitError(null);
    let so: { id: string; so_no: string | null };
    try {
      so = await createSalesOrderFromQuote(quotation, overrides);
    } catch (e: unknown) {
      const msg = (e as Error)?.message || "Could not create the Sales Order";
      setSubmitError(msg);
      toast.error(msg);
      return;
    } finally {
      submitLatch.current = false;
      setSubmitting(false);
    }
    // Success feedback + navigation are owned by the route — no double toast.
    // Deliberately OUTSIDE the try/catch: the Sales Order already exists, so a
    // thrown onSuccess (e.g. a navigation error) must not be reported as a
    // failed create.
    onSuccess(so);
  };

  const inputSize = "h-7 text-xs";
  /** Items-table inputs read as dense grid cells, not as a wall of boxed
   *  inputs: transparent until hovered/focused, no shadow, minimal padding. */
  const cellInput = "h-7 text-xs border-transparent bg-transparent px-1 shadow-none";

  /** Cancel & close — `window.close()` is a no-op for tabs the browser did not
   *  open, so fall back to history (same intent as the route's closeWindow). */
  const cancelAndClose = () => {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.history.back();
    }, 200);
  };

  const customerName = party.customer?.company || quotation.customer_id?.slice(0, 8) || "—";
  const customerLine = party.customer?.gst
    ? `${customerName} · GSTIN ${party.customer.gst}`
    : customerName;
  const branchLine = [
    party.branch?.name || quotation.branch_id?.slice(0, 8) || "—",
    party.branch?.state_name,
    party.branch?.gstin,
  ]
    .filter(Boolean)
    .join(" · ");
  const quoteLine = [quotation.quote_no || quotation.id.slice(0, 8), quotation.quote_date]
    .filter(Boolean)
    .join(" · ");

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex w-full max-w-full flex-col gap-2.5"
    >
      {errorMessages.length ? (
        <div
          ref={errorSummaryRef}
          role="alert"
          tabIndex={-1}
          className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs text-rose-700"
        >
          <ul className="list-disc space-y-0.5 pl-4">
            {errorMessages.map((msg, i) => (
              <li key={`${i}-${msg}`}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
        {/* ── LEFT: the editing surface ──────────────────────────────────── */}
        <div className="min-w-0 flex-1 space-y-2.5">
          <Section title="Sales Order details" icon={FileText}>
            {/* PO Number / PO Date lead: they are the reason this popup exists. */}
            <div className="rounded border-l-2 border-l-primary/60 bg-muted/40 px-2.5 py-2">
              <div className="mb-1 text-[10px] tracking-wide text-muted-foreground uppercase">
                Required
              </div>
              <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
                <Field
                  label="PO Number"
                  htmlFor="po_number"
                  required
                  error={errors.po_number}
                  errorId="po_number-error"
                >
                  <Input
                    id="po_number"
                    className={cn(inputSize, errors.po_number && "border-rose-400")}
                    value={draft.header.po_number}
                    placeholder="PO-..."
                    aria-invalid={!!errors.po_number}
                    aria-describedby={errors.po_number ? "po_number-error" : undefined}
                    onChange={(e) => patchHeader("po_number", e.target.value)}
                  />
                </Field>
                <Field
                  label="PO Date"
                  htmlFor="po_date"
                  required
                  error={errors.po_date}
                  errorId="po_date-error"
                >
                  <Input
                    id="po_date"
                    type="date"
                    className={cn(inputSize, errors.po_date && "border-rose-400")}
                    value={draft.header.po_date}
                    aria-invalid={!!errors.po_date}
                    aria-describedby={errors.po_date ? "po_date-error" : undefined}
                    onChange={(e) => patchHeader("po_date", e.target.value)}
                  />
                </Field>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-2.5 gap-y-2 md:grid-cols-4">
              <Field
                label="SO Date"
                htmlFor="so_date"
                required
                error={errors.so_date}
                errorId="so_date-error"
              >
                <Input
                  id="so_date"
                  type="date"
                  className={cn(inputSize, errors.so_date && "border-rose-400")}
                  value={draft.header.so_date}
                  aria-invalid={!!errors.so_date}
                  aria-describedby={errors.so_date ? "so_date-error" : undefined}
                  onChange={(e) => patchHeader("so_date", e.target.value)}
                />
              </Field>
              <Field label="Valid Until" htmlFor="valid_until">
                <Input
                  id="valid_until"
                  type="date"
                  className={inputSize}
                  value={draft.header.valid_until}
                  onChange={(e) => patchHeader("valid_until", e.target.value)}
                />
              </Field>
              <Field label="Expected Delivery" htmlFor="expected_delivery">
                <Input
                  id="expected_delivery"
                  type="date"
                  className={inputSize}
                  value={draft.header.expected_delivery}
                  onChange={(e) => patchHeader("expected_delivery", e.target.value)}
                />
              </Field>
              <Field label="Payment Terms" htmlFor="payment_terms">
                <Input
                  id="payment_terms"
                  className={inputSize}
                  value={draft.header.payment_terms}
                  onChange={(e) => patchHeader("payment_terms", e.target.value)}
                />
              </Field>
              <Field label="Delivery Timeline" htmlFor="delivery_timeline">
                <Input
                  id="delivery_timeline"
                  className={inputSize}
                  value={draft.header.delivery_timeline}
                  onChange={(e) => patchHeader("delivery_timeline", e.target.value)}
                />
              </Field>
              <Field label="Salesperson" htmlFor="salesperson">
                <Input
                  id="salesperson"
                  className={inputSize}
                  value={draft.header.salesperson}
                  onChange={(e) => patchHeader("salesperson", e.target.value)}
                />
              </Field>
              <Field
                label="Place of Supply"
                htmlFor="place_of_supply"
                hint="GST split follows the customer's state, exactly as the writer stores it."
              >
                <select
                  id="place_of_supply"
                  className={cn(
                    inputSize,
                    "w-full cursor-pointer rounded-md border border-input bg-background px-2 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                  value={draft.header.place_of_supply}
                  onChange={(e) => patchHeader("place_of_supply", e.target.value)}
                >
                  <option value="">— select —</option>
                  {INDIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Parties" icon={Building2}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <PartyPair label="Customer" value={customerLine} />
              <PartyPair label="Branch" value={branchLine} />
              <PartyPair label="Place of supply" value={draft.header.place_of_supply || "—"} />
              <PartyPair label="Quotation" value={quoteLine} />
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              Customer and branch come from the quotation.
            </p>
            {party.status === "error" ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-medium text-rose-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  {party.message || "Customer / branch details failed to load"} — totals cannot be
                  verified against the saved Sales Order.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 border-rose-300 text-xs"
                  onClick={() => setPartyRetryKey((k) => k + 1)}
                >
                  Retry
                </Button>
              </div>
            ) : party.status === "ready" && party.message ? (
              <div className="mt-1.5 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{party.message}</span>
              </div>
            ) : null}
          </Section>

          <Section
            title="Items"
            icon={Table2}
            action={
              <Button type="button" variant="outline" size="sm" className="h-7" onClick={addItem}>
                <Plus className="h-3.5 w-3.5" /> Add item
              </Button>
            }
          >
            {errors.items ? (
              <div
                id="items-error"
                className="mb-1.5 flex items-start gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-medium text-rose-700"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{errors.items}</span>
              </div>
            ) : null}

            {/* Bounded scroll box so the sticky header row is live and the rail
                stays in reach while a long item list scrolls. */}
            <div className="max-h-[min(70vh,640px)] overflow-auto">
              <table className="w-full min-w-[880px] table-fixed text-xs">
                <colgroup>
                  <col className="w-[3%]" />
                  <col className="w-[26%]" />
                  <col className="w-[8%]" />
                  <col className="w-[7%]" />
                  <col className="w-[7%]" />
                  <col className="w-[9%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[10%]" />
                  {/* Brief asked for a 2% delete track — ~18px cannot hold the
                      24px icon button, so this one track is a fixed 34px. */}
                  <col className="w-[34px]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-muted/80 text-[10px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-1.5 py-1 text-left font-medium">#</th>
                    <th className="px-1.5 py-1 text-left font-medium">Description</th>
                    <th className="px-1.5 py-1 text-left font-medium">HSN</th>
                    <th className="px-1.5 py-1 text-right font-medium">Qty</th>
                    <th className="px-1.5 py-1 text-left font-medium">Unit</th>
                    <th className="px-1.5 py-1 text-right font-medium">Rate</th>
                    <th className="px-1.5 py-1 text-right font-medium">Disc %</th>
                    <th className="px-1.5 py-1 text-right font-medium">GST %</th>
                    <th className="px-1.5 py-1 text-right font-medium">Cess %</th>
                    <th className="px-1.5 py-1 text-right font-medium">Amount</th>
                    <th className="px-1.5 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {draft.items.map((it, idx) => {
                    const row = errors.rows[idx];
                    // The Amount cell shows the value the writer will actually store:
                    // `totals.base.items` is positionally aligned with `liveItems`, but
                    // this map iterates EVERY draft row (blank ones included), so the
                    // non-blank index is translated by row identity.
                    const liveIdx = liveItems.indexOf(it);
                    const amount =
                      liveIdx >= 0
                        ? (totals?.base.items[liveIdx]?.taxable_value ?? lineAmount(it))
                        : lineAmount(it);
                    const cell = (msg: string | undefined, id: string) =>
                      msg ? (
                        <p
                          id={id}
                          className="mt-0.5 text-[10px] leading-tight font-medium text-rose-600"
                        >
                          {msg}
                        </p>
                      ) : null;
                    return (
                      <tr key={it.id} className="border-t align-top">
                        <td className="px-1 py-0.5 text-xs text-muted-foreground">{idx + 1}</td>
                        <td className="px-1 py-0.5">
                          <Input
                            className={cn(cellInput, row?.description && "border-rose-400")}
                            value={it.description}
                            aria-label={`Line ${idx + 1} description`}
                            aria-invalid={!!row?.description}
                            aria-describedby={
                              row?.description ? `${it.id}-description-error` : undefined
                            }
                            onChange={(e) => patchItem(idx, "description", e.target.value)}
                          />
                          {cell(row?.description, `${it.id}-description-error`)}
                        </td>
                        <td className="px-1 py-0.5">
                          <Input
                            className={cn(cellInput, "font-mono")}
                            value={it.hsn}
                            aria-label={`Line ${idx + 1} HSN`}
                            onChange={(e) => patchItem(idx, "hsn", e.target.value)}
                          />
                        </td>
                        <td className="px-1 py-0.5">
                          <Input
                            type="number"
                            min={1}
                            step="any"
                            inputMode="decimal"
                            className={cn(
                              cellInput,
                              "text-right tabular-nums",
                              row?.qty && "border-rose-400",
                            )}
                            value={it.qty}
                            aria-label={`Line ${idx + 1} quantity`}
                            aria-invalid={!!row?.qty}
                            aria-describedby={row?.qty ? `${it.id}-qty-error` : undefined}
                            onChange={(e) => patchItem(idx, "qty", e.target.value)}
                          />
                          {cell(row?.qty, `${it.id}-qty-error`)}
                        </td>
                        <td className="px-1 py-0.5">
                          <Input
                            className={cellInput}
                            value={it.unit}
                            aria-label={`Line ${idx + 1} unit`}
                            onChange={(e) => patchItem(idx, "unit", e.target.value)}
                          />
                        </td>
                        <td className="px-1 py-0.5">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className={cn(
                              cellInput,
                              "text-right tabular-nums",
                              row?.rate && "border-rose-400",
                            )}
                            value={it.rate}
                            aria-label={`Line ${idx + 1} rate`}
                            aria-invalid={!!row?.rate}
                            aria-describedby={row?.rate ? `${it.id}-rate-error` : undefined}
                            onChange={(e) => patchItem(idx, "rate", e.target.value)}
                          />
                          {cell(row?.rate, `${it.id}-rate-error`)}
                        </td>
                        <td className="px-1 py-0.5">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className={cn(
                              cellInput,
                              "text-right tabular-nums",
                              row?.discount_pct && "border-rose-400",
                            )}
                            value={it.discount_pct}
                            aria-label={`Line ${idx + 1} discount percent`}
                            aria-invalid={!!row?.discount_pct}
                            aria-describedby={
                              row?.discount_pct ? `${it.id}-discount_pct-error` : undefined
                            }
                            onChange={(e) => patchItem(idx, "discount_pct", e.target.value)}
                          />
                          {cell(row?.discount_pct, `${it.id}-discount_pct-error`)}
                        </td>
                        <td className="px-1 py-0.5">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className={cn(
                              cellInput,
                              "text-right tabular-nums",
                              row?.gst_rate && "border-rose-400",
                            )}
                            value={it.gst_rate}
                            aria-label={`Line ${idx + 1} GST percent`}
                            aria-invalid={!!row?.gst_rate}
                            aria-describedby={row?.gst_rate ? `${it.id}-gst_rate-error` : undefined}
                            onChange={(e) => patchItem(idx, "gst_rate", e.target.value)}
                          />
                          {cell(row?.gst_rate, `${it.id}-gst_rate-error`)}
                        </td>
                        <td className="px-1 py-0.5">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            className={cn(
                              cellInput,
                              "text-right tabular-nums",
                              row?.cess_rate && "border-rose-400",
                            )}
                            value={it.cess_rate}
                            aria-label={`Line ${idx + 1} cess percent`}
                            aria-invalid={!!row?.cess_rate}
                            aria-describedby={
                              row?.cess_rate ? `${it.id}-cess_rate-error` : undefined
                            }
                            onChange={(e) => patchItem(idx, "cess_rate", e.target.value)}
                          />
                          {cell(row?.cess_rate, `${it.id}-cess_rate-error`)}
                        </td>
                        <td className="px-1 py-0.5 text-right text-xs tabular-nums">
                          {inr(amount)}
                        </td>
                        <td className="px-1 py-0.5 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-rose-600"
                            aria-label={`Remove line ${idx + 1}`}
                            onClick={() => removeItem(idx)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {draft.items.length === 0 ? (
                    <tr className="border-t">
                      <td
                        colSpan={11}
                        className="px-1.5 py-6 text-center text-xs text-muted-foreground"
                      >
                        No items — add at least one.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              Rate and Qty are required per line (Qty must be greater than 0). Fully blank rows are
              ignored.
            </p>
          </Section>

          <Section title="Charges" icon={Receipt}>
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 md:grid-cols-5">
              <Field label="Shipping Charges" htmlFor="shipping_charges">
                <Input
                  id="shipping_charges"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  className={cn(inputSize, "text-right tabular-nums")}
                  value={draft.charges.shipping_charges}
                  onChange={(e) => patchCharges("shipping_charges", e.target.value)}
                />
              </Field>
              <Field label="Adjustment" htmlFor="adjustment">
                <Input
                  id="adjustment"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  className={cn(inputSize, "text-right tabular-nums")}
                  value={draft.charges.adjustment}
                  onChange={(e) => patchCharges("adjustment", e.target.value)}
                />
              </Field>
              <Field label="TCS %" htmlFor="tcs_percent" hint="Applied on the taxable value.">
                <Input
                  id="tcs_percent"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  className={cn(inputSize, "text-right tabular-nums")}
                  value={draft.charges.tcs_percent}
                  onChange={(e) => patchCharges("tcs_percent", e.target.value)}
                />
              </Field>
              <Field label="Discount Label" htmlFor="discount_label">
                <Input
                  id="discount_label"
                  className={inputSize}
                  value={draft.charges.discount_label}
                  onChange={(e) => patchCharges("discount_label", e.target.value)}
                />
              </Field>
              <Field
                label="Discount Amount"
                htmlFor="discount_amount"
                hint="Spread across lines by the GST engine."
              >
                <Input
                  id="discount_amount"
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  className={cn(inputSize, "text-right tabular-nums")}
                  value={draft.charges.discount_amount}
                  onChange={(e) => patchCharges("discount_amount", e.target.value)}
                />
              </Field>
            </div>
          </Section>

          <Section title="Contact & Addresses" icon={MapPin}>
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 md:grid-cols-3">
              <Field label="Contact Person" htmlFor="contact_person">
                <Input
                  id="contact_person"
                  className={inputSize}
                  value={draft.header.contact_person}
                  onChange={(e) => patchHeader("contact_person", e.target.value)}
                />
              </Field>
              <Field label="Contact Email" htmlFor="contact_email">
                <Input
                  id="contact_email"
                  type="email"
                  className={inputSize}
                  value={draft.header.contact_email}
                  onChange={(e) => patchHeader("contact_email", e.target.value)}
                />
              </Field>
              <Field label="Contact Mobile" htmlFor="contact_mobile">
                <Input
                  id="contact_mobile"
                  className={inputSize}
                  value={draft.header.contact_mobile}
                  onChange={(e) => patchHeader("contact_mobile", e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2.5 md:grid-cols-2">
              <Field label="Billing Address" htmlFor="billing_address">
                <Textarea
                  id="billing_address"
                  rows={2}
                  className="text-xs"
                  value={draft.header.billing_address}
                  onChange={(e) => patchHeader("billing_address", e.target.value)}
                />
              </Field>
              <Field label="Shipping Address" htmlFor="shipping_address">
                <Textarea
                  id="shipping_address"
                  rows={2}
                  className="text-xs"
                  value={draft.header.shipping_address}
                  onChange={(e) => patchHeader("shipping_address", e.target.value)}
                />
              </Field>
            </div>
          </Section>

          <Section title="Notes & Terms" icon={StickyNote}>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              <Field label="Notes" htmlFor="notes">
                <Textarea
                  id="notes"
                  rows={3}
                  className="text-xs"
                  value={draft.header.notes}
                  onChange={(e) => patchHeader("notes", e.target.value)}
                />
              </Field>
              <Field label="Terms" htmlFor="terms">
                <Textarea
                  id="terms"
                  rows={3}
                  className="text-xs"
                  value={draft.header.terms}
                  onChange={(e) => patchHeader("terms", e.target.value)}
                />
              </Field>
            </div>
          </Section>
        </div>

        {/* ── RIGHT: the rail — totals + actions stay reachable ──────────── */}
        <aside className="w-full shrink-0 space-y-2.5 lg:sticky lg:top-14 lg:w-[300px]">
          <Section title="Summary" icon={Calculator}>
            {totals ? (
              <>
                {totals.base.gstWarning ? (
                  <div className="mb-1.5 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{totals.base.gstWarning}</span>
                  </div>
                ) : null}
                <dl>
                  <TotalsRow label="Subtotal" value={inr(totals.base.subtotal)} />
                  <TotalsRow label="Discount" value={inr(totals.base.discount)} />
                  <TotalsRow label="Taxable Value" value={inr(totals.base.taxable_value)} />
                  <TotalsRow label="CGST" value={inr(totals.base.cgst)} />
                  <TotalsRow label="SGST" value={inr(totals.base.sgst)} />
                  <TotalsRow label="IGST" value={inr(totals.base.igst)} />
                  <TotalsRow label="Cess" value={inr(totals.base.cess)} />
                  {/* Shipping / adjustment / TCS are folded into the total, so
                      they stay listed — hiding them would make the rail stop
                      reconciling against the Total below. */}
                  <TotalsRow label="Shipping Charges" value={inr(shipping)} />
                  <TotalsRow label="Adjustment" value={inr(adjustment)} />
                  <TotalsRow label="TCS Amount" value={inr(totals.tcsAmount)} />
                  <TotalsRow label="Round Off" value={inr(totals.roundOff)} />
                </dl>
                <div className="mt-1 flex items-center justify-between gap-2 border-t pt-1">
                  <span className="text-sm font-semibold">Total</span>
                  <span className="text-sm font-semibold tabular-nums">{inr(totals.total)}</span>
                </div>
                {totals.total > 0 ? (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground italic">
                    {amountInWords(totals.total)}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {party.status === "loading"
                  ? "Resolving GST state…"
                  : "Totals unavailable — check the lines and charges."}
              </p>
            )}
          </Section>

          <section className="rounded-md border bg-card px-2.5 py-2.5">
            {submitError ? (
              <div
                role="alert"
                className="mb-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs font-medium text-rose-700"
              >
                {submitError}
              </div>
            ) : null}
            <Button type="submit" disabled={submitting} className="h-8 w-full">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create Sales Order
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="mt-1.5 h-8 w-full"
              onClick={cancelAndClose}
            >
              Cancel & close
            </Button>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              PO Number and PO Date are compulsory.
            </p>
          </section>
        </aside>
      </div>
    </form>
  );
}
