/**
 * src/lib/tallyExport.ts — Prokon ERP → TallyPrime OUTBOUND export (accounting).
 *
 * ## What this is (and is not)
 *
 * This is the **write** counterpart to `tallyLedger.ts` (which is a read-only,
 * stock-only *display* ledger). This module turns Prokon invoices / receipts
 * into TallyPrime import XML so the accounting books can be driven from Prokon
 * without re-typing.
 *
 * Structural parity with the existing Tally code:
 *  - envelope + voucher shape follow `TALLY_BRIDGE_PLAN.md` §8.1–8.3
 *  - GST split comes from the SAME engine the invoice uses (`computeTotals` in
 *    `gst.ts`) so Tally can never disagree with the printed invoice / NIC JSON
 *
 * ## Purity
 *
 * Everything in this file is **pure**: no Supabase, no `fetch`, no DOM. It takes
 * plain row shapes and returns strings. That keeps it unit-testable and lets the
 * server-side runner (`scripts/tally-export.ts`) own all I/O.
 *
 * ## Tally amount convention (the #1 source of wrong exports)
 *
 * Tally signs ledger amounts by *deemed positivity*, using a NEGATIVE amount for
 * any entry whose `ISDEEMEDPOSITIVE` is `Yes`:
 *   - Party (debtor) is deemed positive  → AMOUNT is negative
 *   - Sales / GST output ledgers are deemed negative → AMOUNT is positive
 * Getting this backwards produces a voucher that balances but posts backwards.
 * `assertVoucherBalances()` checks the arithmetic before you ever send it.
 *
 * @module src/lib/tallyExport
 */

import { computeTotals, type GstTotals } from "./gst";
import { r2 } from "./money";

// ─────────────────────────────────────────────────────────────────────────────
// Types — row shapes (structurally compatible with the Supabase rows)
// ─────────────────────────────────────────────────────────────────────────────

export type TallyInvoiceRow = {
  id: string;
  invoice_no: string | null;
  invoice_date: string; // ISO YYYY-MM-DD
  branch_id: string | null;
  customer_id: string | null;
  buyer_name?: string | null;
  buyer_gstin?: string | null;
  buyer_state_code?: string | null;
  seller_gstin?: string | null;
  seller_state_code?: string | null;
  place_of_supply_code?: string | null;
  is_interstate?: boolean | null;
  sales_type?: string | null;
  reverse_charge?: boolean | null;
  subtotal?: number | null;
  discount?: number | null;
  taxable_value?: number | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  cess?: number | null;
  round_off?: number | null;
  total?: number | null;
  status?: string | null;
  notes?: string | null;
  irn?: string | null;
  ack_no?: string | null;
  ack_date?: string | null;
  ewaybill_no?: string | null;
  ewaybill_date?: string | null;
  ewaybill_valid_till?: string | null;
};

export type TallyInvoiceItemRow = {
  sr_no?: number | null;
  product_id?: string | null;
  /** Tally stock item name. Set to the Tally item name; falls back to description. */
  item_name?: string | null;
  description: string;
  hsn?: string | null;
  qty: number;
  unit?: string | null;
  rate: number;
  discount_pct?: number | null;
  taxable_value?: number | null;
  gst_rate: number;
  cess_rate?: number | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  cess?: number | null;
  line_total?: number | null;
};

export type TallyPaymentRow = {
  id: string;
  payment_no: string | null;
  payment_date: string; // ISO
  customer_id: string | null;
  party_ledger?: string | null;
  mode: string; // bank | cash | upi | cheque | neft | rtgs | card
  reference?: string | null;
  amount: number;
  notes?: string | null;
};

export type TallyBranchRow = {
  id: string;
  name: string;
  code?: string | null;
  gstin?: string | null;
};

/**
 * Ledger name mapping. Tally ledger names MUST match the company's actual chart
 * of accounts; this resolver centralises that so a mismatch is a config change
 * rather than a code change.
 */
export type TallyLedgerMap = {
  sales: string;
  salesReturn: string;
  roundOff: string;
  discount: string;
  freight: string;
  /** Bank/cash ledgers by payment mode. */
  byMode: Record<string, string>;
  /** Cost-centre name; when set, branch allocation is emitted. */
  costCentreByBranch?: Record<string, string>;
  /** Overrides for tax ledgers keyed by `${kind}${rate}` e.g. `CGST9`, `IGST18`. */
  taxOverrides?: Record<string, string>;
};

export const DEFAULT_LEDGER_MAP: TallyLedgerMap = {
  sales: "Sales Accounts",
  salesReturn: "Sales Return",
  roundOff: "Round Off",
  discount: "Discount Allowed",
  freight: "Freight & Transport",
  byMode: {
    bank: "Bank Account",
    cash: "Cash",
    upi: "Bank Account",
    cheque: "Bank Account",
    neft: "Bank Account",
    rtgs: "Bank Account",
    card: "Bank Account",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

/** First argument that is a finite number, else `fallback`. */
function finiteOr(...args: Array<number | null | undefined>): number {
  for (const a of args) {
    if (a !== null && a !== undefined && Number.isFinite(Number(a))) return Number(a);
  }
  return 0;
}

/** XML-escape a value for Tally import. */
export function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * ISO date (YYYY-MM-DD, or a Date) → Tally `YYYYMMDD`.
 * Tally silently mis-posts on any other shape, so invalid input throws rather
 * than emitting a plausible-looking wrong date.
 */
export function tallyDate(iso: string | Date | null | undefined): string {
  if (!iso) throw new Error("tallyDate: date is required (Tally cannot post an empty date)");
  const d = iso instanceof Date ? iso : new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`tallyDate: unparseable date "${iso}"`);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Tally wants 2-decimal fixed; never exponential notation. */
export function tallyAmount(n: number | null | undefined): string {
  const v = r2(Number(n) || 0);
  return v.toFixed(2);
}

/**
 * Quantity string. Tally expects `<n> <UNIT>` (e.g. `2 NOS`); a bare number is
 * also accepted but loses the unit, so we always emit the unit.
 */
export function tallyQty(qty: number, unit?: string | null): string {
  const u = (unit || "NOS").trim() || "NOS";
  return `${Number(qty) || 0} ${u}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger mapping + GST buckets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tax ledger name for a kind+rate.
 * Matches Tally's conventional naming (`CGST 9%`) so a stock Tally company works
 * out of the box; override via `TallyLedgerMap.taxOverrides`.
 */
export function taxLedgerName(
  kind: "CGST" | "SGST" | "IGST" | "CESS" | "STATE CESS",
  rate: number,
  map: TallyLedgerMap = DEFAULT_LEDGER_MAP,
): string {
  const key = `${kind.replace(/\s+/g, "")}${rate}`;
  const override = map.taxOverrides?.[key];
  if (override) return override;
  return `${kind} ${rate}%`;
}

/**
 * Per-rate GST buckets for the voucher, derived from the SAME per-line breakups
 * that produced the invoice totals. One ledger entry per non-zero bucket.
 *
 * Tally requires a separate ledger line per tax rate, so 5% + 18% CGST cannot be
 * collapsed into one entry.
 */
export type GstBucket = { ledger: string; amount: number };

export function gstBuckets(
  items: TallyInvoiceItemRow[],
  isInterstate: boolean,
  map: TallyLedgerMap = DEFAULT_LEDGER_MAP,
): GstBucket[] {
  const acc = new Map<string, number>();
  for (const it of items) {
    const rate = Number(it.gst_rate) || 0;
    const cessRate = Number(it.cess_rate) || 0;
    if (isInterstate) {
      const igst = r2(Number(it.igst) || 0);
      if (igst !== 0)
        acc.set(
          taxLedgerName("IGST", rate, map),
          r2((acc.get(taxLedgerName("IGST", rate, map)) || 0) + igst),
        );
    } else {
      const cgst = r2(Number(it.cgst) || 0);
      const sgst = r2(Number(it.sgst) || 0);
      if (cgst !== 0)
        acc.set(
          taxLedgerName("CGST", rate, map),
          r2((acc.get(taxLedgerName("CGST", rate, map)) || 0) + cgst),
        );
      if (sgst !== 0)
        acc.set(
          taxLedgerName("SGST", rate, map),
          r2((acc.get(taxLedgerName("SGST", rate, map)) || 0) + sgst),
        );
    }
    const cess = r2(Number(it.cess) || 0);
    if (cess !== 0) {
      const name = taxLedgerName("CESS", cessRate, map);
      acc.set(name, r2((acc.get(name) || 0) + cess));
    }
  }
  return [...acc.entries()]
    .map(([ledger, amount]) => ({ ledger, amount }))
    .filter((b) => b.amount !== 0)
    .sort((a, b) => a.ledger.localeCompare(b.ledger));
}

// ─────────────────────────────────────────────────────────────────────────────
// Voucher builders
// ─────────────────────────────────────────────────────────────────────────────

export type LedgerEntry = {
  ledger: string;
  amount: number; // SIGNED (already in Tally deemed-positive convention)
  isDeemedPositive: boolean;
  isPartyLedger?: boolean;
};

export type InventoryEntry = {
  itemName: string;
  qty: number;
  unit?: string | null;
  rate: number;
  amount: number;
  hsn?: string | null;
  gstRate: number;
};

export type TallyVoucher = {
  vchType: string;
  date: string; // YYYYMMDD
  voucherNumber: string;
  partyLedger: string;
  narration: string;
  reference: string;
  guid?: string;
  irn?: string | null;
  irnDate?: string | null;
  ewayBillNo?: string | null;
  ledgerEntries: LedgerEntry[];
  inventoryEntries: InventoryEntry[];
};

/**
 * Build the accounting structure for a sales invoice.
 *
 * Debit = party (negative). Credit = sales + each GST bucket + round-off
 * (positive). `assertVoucherBalances` must be run before emitting XML.
 *
 * ## Header discount — why sales is credited GROSS
 *
 * `invoices.taxable_value` is stored **net of discount** (see `computeLine` /
 * `apportionHeaderDiscount` in `gst.ts`: the taxable value is summed from
 * post-discount line breakups). To show discount as a visible contra line in
 * Tally we must therefore credit Sales with the **gross** figure
 * `taxable_value + discount` and then debit `Discount Allowed` by the discount.
 * Crediting only the net value and *also* debiting the discount double-counts it
 * and leaves the voucher short by exactly the discount amount.
 */
export function buildSalesVoucher(args: {
  invoice: TallyInvoiceRow;
  items: TallyInvoiceItemRow[];
  branch?: TallyBranchRow | null;
  map?: TallyLedgerMap;
}): TallyVoucher {
  const map = args.map ?? DEFAULT_LEDGER_MAP;
  const inv = args.invoice;
  const items = args.items ?? [];

  const isInterstate = Boolean(inv.is_interstate);
  const party = (inv.buyer_name || "Suspense").trim();

  const taxable = r2(Number(inv.taxable_value) || 0);
  const roundOff = r2(Number(inv.round_off) || 0);
  const discount = r2(Number(inv.discount) || 0);
  const total = r2(Number(inv.total) || 0);

  const ledgerEntries: LedgerEntry[] = [];

  // 1) Party — debit, therefore NEGATIVE in Tally's convention.
  ledgerEntries.push({
    ledger: party,
    amount: r2(-total),
    isDeemedPositive: true,
    isPartyLedger: true,
  });

  // 2) Sales — credit, positive. Credited GROSS when a header discount exists,
  //    because `taxable_value` is stored net of discount (see the doc comment).
  const salesCredit = r2(taxable + discount);
  if (salesCredit !== 0) {
    ledgerEntries.push({
      ledger: map.sales,
      amount: salesCredit,
      isDeemedPositive: false,
    });
  }

  // 3) GST buckets — credit, positive.
  for (const b of gstBuckets(items, isInterstate, map)) {
    ledgerEntries.push({ ledger: b.ledger, amount: b.amount, isDeemedPositive: false });
  }

  // 4) Header discount — debit-side contra (negative). Offsets the gross credit
  //    above so the net sales posting still equals the stored taxable value.
  if (discount !== 0) {
    ledgerEntries.push({ ledger: map.discount, amount: r2(-discount), isDeemedPositive: true });
  }

  // 5) Round-off — sign follows the stored value.
  if (roundOff !== 0) {
    ledgerEntries.push({
      ledger: map.roundOff,
      amount: roundOff,
      isDeemedPositive: roundOff < 0,
    });
  }

  const inventoryEntries: InventoryEntry[] = items.map((it) => ({
    itemName: (it.item_name || it.description || "Unknown Item").trim(),
    qty: Number(it.qty) || 0,
    unit: it.unit,
    rate: r2(Number(it.rate) || 0),
    // NB: `Number(x) ?? y` would never fall through — Number() returns NaN (not
    // nullish) for missing input. Use an explicit finite check so a line with no
    // stored taxable_value still falls back to line_total.
    amount: r2(finiteOr(it.taxable_value, finiteOr(it.line_total, 0))),
    hsn: it.hsn ?? null,
    gstRate: Number(it.gst_rate) || 0,
  }));

  return {
    vchType: "Sales",
    date: tallyDate(inv.invoice_date),
    voucherNumber: inv.invoice_no || inv.id,
    partyLedger: party,
    narration: `[${args.branch?.name ?? "Main"}] ${inv.invoice_no ?? inv.id} — Prokon`,
    reference: inv.invoice_no || inv.id,
    guid: inv.id,
    irn: inv.irn ?? null,
    irnDate: inv.ack_date ?? null,
    ewayBillNo: inv.ewaybill_no ?? null,
    ledgerEntries,
    inventoryEntries,
  };
}

/** Build a Receipt voucher for a payment received (party credited, bank/cash debited). */
export function buildReceiptVoucher(args: {
  payment: TallyPaymentRow;
  partyLedger: string;
  map?: TallyLedgerMap;
}): TallyVoucher {
  const map = args.map ?? DEFAULT_LEDGER_MAP;
  const p = args.payment;
  const amount = r2(Number(p.amount) || 0);
  const bankLedger = map.byMode[p.mode] ?? map.byMode.bank;

  return {
    vchType: "Receipt",
    date: tallyDate(p.payment_date),
    voucherNumber: p.payment_no || p.id,
    partyLedger: args.partyLedger,
    narration: `Receipt ${p.payment_no ?? p.id}${p.reference ? ` (${p.reference})` : ""} — Prokon`,
    reference: p.payment_no || p.id,
    guid: p.id,
    ledgerEntries: [
      // Bank/cash — debit → negative.
      { ledger: bankLedger, amount: r2(-amount), isDeemedPositive: true },
      // Party — credit → positive.
      { ledger: args.partyLedger, amount, isDeemedPositive: false, isPartyLedger: true },
    ],
    inventoryEntries: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Balance check — never emit an unbalanced voucher
// ─────────────────────────────────────────────────────────────────────────────

export type BalanceCheck = { balanced: boolean; sum: number; expected: number; diff: number };

/**
 * Verify Σ(signed amounts) === 0 (voucher must balance) and, when
 * `expectedTotal` is supplied, that the party debit equals the invoice total.
 * This is the guard that turns a silent wrong-posting bug into a loud error
 * before import.
 */
export function assertVoucherBalances(
  v: TallyVoucher,
  expectedTotal?: number | null,
): BalanceCheck {
  const raw = r2(v.ledgerEntries.reduce((s, e) => s + e.amount, 0));
  // `r2` uses an EPSILON nudge, which can return -0 for a tiny negative result.
  // Normalise so callers never see negative zero.
  const sum = Object.is(raw, -0) ? 0 : raw;
  const party = v.ledgerEntries.find((e) => e.isPartyLedger);
  const expected =
    expectedTotal !== null && expectedTotal !== undefined
      ? r2(expectedTotal)
      : party
        ? r2(Math.abs(party.amount))
        : 0;
  const diff = r2(Math.abs(sum));
  return { balanced: diff < 0.01, sum, expected, diff };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tally XML emission
// ─────────────────────────────────────────────────────────────────────────────

function ledgerEntryXml(e: LedgerEntry): string {
  const parts = [
    "<ALLLEDGERENTRIES.LIST>",
    `<LEDGERNAME>${esc(e.ledger)}</LEDGERNAME>`,
    `<ISDEEMEDPOSITIVE>${e.isDeemedPositive ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
  ];
  if (e.isPartyLedger) parts.push("<ISPARTYLEDGER>Yes</ISPARTYLEDGER>");
  parts.push(`<AMOUNT>${tallyAmount(e.amount)}</AMOUNT>`);
  parts.push("</ALLLEDGERENTRIES.LIST>");
  return parts.join("");
}

function inventoryEntryXml(e: InventoryEntry, salesLedger: string): string {
  return [
    "<INVENTORYENTRIES.LIST>",
    `<STOCKITEMNAME>${esc(e.itemName)}</STOCKITEMNAME>`,
    `<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>`,
    `<RATE>${tallyAmount(e.rate)}</RATE>`,
    `<AMOUNT>${tallyAmount(e.amount)}</AMOUNT>`,
    `<ACTUALQTY>${esc(tallyQty(e.qty, e.unit))}</ACTUALQTY>`,
    `<BILLEDQTY>${esc(tallyQty(e.qty, e.unit))}</BILLEDQTY>`,
    "<ACCOUNTINGALLOCATIONS.LIST>",
    `<LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>`,
    "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
    `<AMOUNT>${tallyAmount(e.amount)}</AMOUNT>`,
    "</ACCOUNTINGALLOCATIONS.LIST>",
    "</INVENTORYENTRIES.LIST>",
  ].join("");
}

/**
 * Render one voucher. `ACTION="Create"` keeps the import idempotent-safe at the
 * Tally end; dedup is done by the caller via GUID/voucher number tracking.
 */
export function voucherXml(v: TallyVoucher, map: TallyLedgerMap = DEFAULT_LEDGER_MAP): string {
  const parts: string[] = [];
  parts.push(
    `<VOUCHER VCHTYPE="${esc(v.vchType)}" ACTION="Create" OBJVIEW="Invoice Voucher View">`,
  );
  parts.push(`<DATE>${esc(v.date)}</DATE>`);
  parts.push(`<VOUCHERTYPENAME>${esc(v.vchType)}</VOUCHERTYPENAME>`);
  parts.push(`<VOUCHERNUMBER>${esc(v.voucherNumber)}</VOUCHERNUMBER>`);
  parts.push(`<PARTYLEDGERNAME>${esc(v.partyLedger)}</PARTYLEDGERNAME>`);
  parts.push(`<NARRATION>${esc(v.narration)}</NARRATION>`);
  parts.push(`<REFERENCE>${esc(v.reference)}</REFERENCE>`);
  if (v.guid) parts.push(`<GUID>${esc(v.guid)}</GUID>`);
  // E-invoice fields — only meaningful when the IRP actually returned them.
  if (v.irn) parts.push(`<IRNNO>${esc(v.irn)}</IRNNO>`);
  if (v.irnDate) {
    try {
      parts.push(`<IRNDATE>${esc(tallyDate(v.irnDate))}</IRNDATE>`);
    } catch {
      /* ack_date not parseable — omit rather than post a wrong date */
    }
  }
  if (v.ewayBillNo) parts.push(`<EWAYBILLNO>${esc(v.ewayBillNo)}</EWAYBILLNO>`);
  for (const e of v.ledgerEntries) parts.push(ledgerEntryXml(e));
  for (const ie of v.inventoryEntries) parts.push(inventoryEntryXml(ie, map.sales));
  parts.push("</VOUCHER>");
  return parts.join("");
}

/** Wrap vouchers in the Tally import envelope (PLAN §8.1). */
export function tallyImportEnvelope(vouchers: string[]): string {
  return [
    "<ENVELOPE>",
    "<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
    "<BODY>",
    "<IMPORTDATA>",
    "<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>",
    "<REQUESTDATA>",
    ...vouchers.map((v) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${v}</TALLYMESSAGE>`),
    "</REQUESTDATA>",
    "</IMPORTDATA>",
    "</BODY>",
    "</ENVELOPE>",
  ].join("");
}

/** Ledger master creation (`LEDGER ACTION="Create"`), for the auto-create path. */
export function ledgerMasterXml(name: string, parent: string, gstin?: string | null): string {
  const parts = [
    `<LEDGER NAME="${esc(name)}" ACTION="Create">`,
    `<NAME>${esc(name)}</NAME>`,
    `<PARENT>${esc(parent)}</PARENT>`,
  ];
  if (gstin) {
    parts.push("<GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>");
    parts.push(`<PARTYGSTIN>${esc(gstin)}</PARTYGSTIN>`);
  }
  parts.push("</LEDGER>");
  return parts.join("");
}

/**
 * Parse the Tally import response. Tally reports failures in `LINEERROR` while
 * still returning HTTP 200 — never treat HTTP 200 as success.
 */
export type TallyImportResult = {
  created: number;
  altered: number;
  errors: number;
  ignored: number;
  lineError: string | null;
  raw: string;
};

export function parseTallyResponse(xml: string): TallyImportResult {
  const num = (tag: string): number => {
    const m = xml.match(new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`, "i"));
    return m ? Number(m[1]) : 0;
  };
  const err = xml.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i);
  return {
    created: num("CREATED"),
    altered: num("ALTERED"),
    errors: num("ERRORS"),
    ignored: num("IGNORED"),
    lineError: err ? err[1].trim() : null,
    raw: xml,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch orchestration + CSV fallback
// ─────────────────────────────────────────────────────────────────────────────

export type ExportDrift = {
  voucherNumber: string;
  field: string;
  stored: number;
  recomputed: number;
  delta: number;
};

/**
 * True when a 64-hex IRN looks like the deprecated `mockIrnPayload()` output,
 * which built `hash.repeat(8)` from an 8-char hash (see `gst.ts`).
 *
 * This matters because such a value PASSES the 64-hex `IRN_REGEX`, so nothing
 * else in the pipeline rejects it — yet it is not a legal IRN and must never be
 * carried into Tally. Real SHA-256 output does not repeat an 8-char block 8×.
 */
export function looksFabricatedIrn(irn: string | null | undefined): boolean {
  const s = String(irn ?? "")
    .trim()
    .toLowerCase();
  if (s.length !== 64) return false;
  return s.slice(0, 8).repeat(8) === s;
}

/** Advisory finding about a reference number carried into Tally. */
export type ReferenceWarning = {
  voucherNumber: string;
  field: "irn" | "ewaybill_no";
  value: string;
  reason: string;
};

export type SalesExportResult = {
  xml: string;
  voucherCount: number;
  vouchers: TallyVoucher[];
  /** Vouchers that failed the balance check — MUST be empty before sending. */
  unbalanced: Array<{ voucherNumber: string; check: BalanceCheck }>;
  /**
   * Stored invoice headers that disagree with a recompute from their own lines.
   * The export deliberately posts the STORED header (that is what the IRN was
   * generated against and what the customer holds), so drift here is a data
   * warning to investigate — not something to silently "fix" during export.
   */
  drift: ExportDrift[];
  /**
   * Suspicious IRN / E-Way Bill numbers about to be written into Tally as
   * statutory fields. Non-empty output means: stop and clean the data first.
   */
  referenceWarnings: ReferenceWarning[];
  skippedCancelled: number;
};

/** Flag reference numbers that must not be imported as statutory values. */
function detectReferenceWarnings(inv: TallyInvoiceRow, voucherNumber: string): ReferenceWarning[] {
  const out: ReferenceWarning[] = [];
  if (looksFabricatedIrn(inv.irn)) {
    out.push({
      voucherNumber,
      field: "irn",
      value: String(inv.irn),
      reason: "IRN is an 8-hex block repeated 8× — this is mockIrnPayload() output, not a real IRN",
    });
  }
  if (inv.ewaybill_no) {
    const ewb = String(inv.ewaybill_no).trim();
    // Real EWBs are 12 digits; mock output was `String(1e12 + h).slice(0, 15)`.
    if (!/^\d{12}$/.test(ewb)) {
      out.push({
        voucherNumber,
        field: "ewaybill_no",
        value: ewb,
        reason: `E-Way Bill number is not 12 digits (got ${ewb.length})`,
      });
    }
  }
  return out;
}

/** Tolerate half a paisa before calling stored vs recomputed a disagreement. */
const DRIFT_TOLERANCE = 0.005;

function detectDrift(
  inv: TallyInvoiceRow,
  items: TallyInvoiceItemRow[],
  voucherNumber: string,
): ExportDrift[] {
  const out: ExportDrift[] = [];
  const rec = recomputeInvoiceTotals({
    sellerStateCode: inv.seller_state_code,
    buyerStateCode: inv.buyer_state_code,
    placeOfSupplyStateCode: inv.place_of_supply_code,
    salesType: inv.sales_type,
    items,
    headerDiscount: Number(inv.discount) || 0,
  });
  const pairs: Array<[string, number | null | undefined, number]> = [
    ["taxable_value", inv.taxable_value, rec.taxable_value],
    ["cgst", inv.cgst, rec.cgst],
    ["sgst", inv.sgst, rec.sgst],
    ["igst", inv.igst, rec.igst],
    ["cess", inv.cess, rec.cess],
    ["round_off", inv.round_off, rec.round_off],
    ["total", inv.total, rec.total],
  ];
  for (const [field, storedRaw, recomputed] of pairs) {
    const stored = r2(Number(storedRaw) || 0);
    const delta = r2(recomputed - stored);
    if (Math.abs(delta) > DRIFT_TOLERANCE) {
      out.push({ voucherNumber, field, stored, recomputed, delta });
    }
  }
  return out;
}

/**
 * Build a Tally import file for a set of invoices.
 *
 * Cancelled invoices are skipped. Any voucher that does not balance is reported
 * in `unbalanced` instead of being exported — the caller must refuse to import
 * when that array is non-empty.
 *
 * `stripBadReferences` (recommended when you have decided to proceed) removes
 * fabricated IRN / malformed E-Way Bill values from the emitted vouchers while
 * still reporting them in `referenceWarnings`. Without it, a fabricated value
 * would be written into Tally as a statutory identifier.
 */
export function buildSalesExport(args: {
  invoices: TallyInvoiceRow[];
  itemsByInvoice: Map<string, TallyInvoiceItemRow[]>;
  branchesById?: Map<string, TallyBranchRow>;
  map?: TallyLedgerMap;
  stripBadReferences?: boolean;
}): SalesExportResult {
  const map = args.map ?? DEFAULT_LEDGER_MAP;
  const vouchers: TallyVoucher[] = [];
  const unbalanced: Array<{ voucherNumber: string; check: BalanceCheck }> = [];
  const drift: ExportDrift[] = [];
  const referenceWarnings: ReferenceWarning[] = [];
  let skippedCancelled = 0;

  for (const inv of args.invoices) {
    if (String(inv.status || "").toLowerCase() === "cancelled") {
      skippedCancelled++;
      continue;
    }
    const items = args.itemsByInvoice.get(inv.id) ?? [];
    const v = buildSalesVoucher({
      invoice: inv,
      items,
      branch: inv.branch_id ? (args.branchesById?.get(inv.branch_id) ?? null) : null,
      map,
    });
    const check = assertVoucherBalances(v, inv.total ?? undefined);
    if (!check.balanced) unbalanced.push({ voucherNumber: v.voucherNumber, check });
    drift.push(...detectDrift(inv, items, v.voucherNumber));
    const warnings = detectReferenceWarnings(inv, v.voucherNumber);
    referenceWarnings.push(...warnings);
    if (warnings.length > 0 && args.stripBadReferences) {
      // Never carry a fabricated statutory identifier into Tally.
      if (warnings.some((w) => w.field === "irn")) {
        v.irn = null;
        v.irnDate = null;
      }
      if (warnings.some((w) => w.field === "ewaybill_no")) v.ewayBillNo = null;
    }
    vouchers.push(v);
  }

  return {
    xml: tallyImportEnvelope(vouchers.map((v) => voucherXml(v, map))),
    voucherCount: vouchers.length,
    vouchers,
    unbalanced,
    drift,
    referenceWarnings,
    skippedCancelled,
  };
}

/**
 * CSV fallback for accountants who prefer bulk-import spreadsheets or when the
 * Tally HTTP gateway is not reachable. One row per ledger entry so it can be
 * pivoted into any template.
 */
export function salesCsv(exportResult: SalesExportResult): string {
  const head = [
    "voucher_type",
    "voucher_date",
    "voucher_number",
    "party_ledger",
    "ledger_name",
    "amount",
    "is_deemed_positive",
    "narration",
    "irn",
    "ewaybill_no",
  ];
  const rows: string[] = [head.join(",")];
  const cell = (v: unknown): string => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  for (const v of exportResult.vouchers) {
    for (const e of v.ledgerEntries) {
      rows.push(
        [
          v.vchType,
          // human-readable DD-MM-YYYY for accountants
          `${v.date.slice(6, 8)}-${v.date.slice(4, 6)}-${v.date.slice(0, 4)}`,
          v.voucherNumber,
          v.partyLedger,
          e.ledger,
          tallyAmount(e.amount),
          e.isDeemedPositive ? "Yes" : "No",
          v.narration,
          v.irn ?? "",
          v.ewayBillNo ?? "",
        ]
          .map(cell)
          .join(","),
      );
    }
  }
  return rows.join("\n");
}

/**
 * Recompute totals from lines using the shared GST engine — use this to detect
 * drift between stored invoice headers and their items before exporting.
 */
export function recomputeInvoiceTotals(args: {
  sellerStateCode?: string | null;
  buyerStateCode?: string | null;
  placeOfSupplyStateCode?: string | null;
  salesType?: string | null;
  items: TallyInvoiceItemRow[];
  headerDiscount?: number;
}): GstTotals {
  return computeTotals({
    sellerStateCode: args.sellerStateCode ?? null,
    buyerStateCode: args.buyerStateCode ?? null,
    placeOfSupplyStateCode: args.placeOfSupplyStateCode ?? null,
    salesType: args.salesType ?? null,
    headerDiscount: args.headerDiscount ?? 0,
    items: (args.items ?? []).map((it) => ({
      qty: Number(it.qty) || 0,
      rate: Number(it.rate) || 0,
      discount_pct: Number(it.discount_pct) || 0,
      gst_rate: Number(it.gst_rate) || 0,
      cess_rate: Number(it.cess_rate) || 0,
    })),
  });
}
