/**
 * scripts/tally-export.ts — Prokon ERP → TallyPrime export CLI.
 *
 * Reads issued invoices (+ their line items and branches) from Supabase and
 * writes a Tally import file you can load into TallyPrime.
 *
 * USAGE
 *   npx vite-node scripts/tally-export.ts -- --from 2026-04-01 --to 2027-03-31
 *   npx vite-node scripts/tally-export.ts -- --from 2026-09-01 --to 2026-09-30 --branch "Jaipur"
 *   npx vite-node scripts/tally-export.ts -- --fy 2026-27 --format both
 *
 * FLAGS
 *   --from  YYYY-MM-DD   range start (inclusive). Default: start of current FY.
 *   --to    YYYY-MM-DD   range end   (inclusive). Default: today.
 *   --fy    2026-27      Indian financial year shorthand (Apr 1 → Mar 31).
 *   --branch <name>      only invoices of branches whose name matches (case-insensitive substring).
 *   --out   <dir>        output directory. Default: ./data/tally-export
 *   --format xml|csv|both   Default: both
 *
 * SAFETY
 *   - Read-only against Supabase. Writes files only under --out.
 *   - Refuses to write anything if any voucher fails the balance check.
 *   - Reports line/header GST drift; drift does NOT block the export (the stored
 *     header is what the IRN and the customer's paper say) but is printed loudly.
 *
 * ENV (from .env)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  buildSalesExport,
  salesCsv,
  type TallyInvoiceRow,
  type TallyInvoiceItemRow,
  type TallyBranchRow,
} from "@/lib/tallyExport";

// ── env loading (minimal .env parser — avoids a dotenv dependency) ──────────
function loadEnv(): void {
  try {
    const txt = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (process.env[m[1]] !== undefined) continue; // real env wins
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  } catch {
    // no .env — rely on the real environment
  }
}

// ── arg parsing ─────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

/** Start/end of an Indian FY shorthand like `2026-27` → Apr 1 2026 … Mar 31 2027. */
function fyRange(fy: string): { from: string; to: string } {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new Error(`--fy must look like 2026-27 (got "${fy}")`);
  const startYear = Number(m[1]);
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Start of the FY that contains `today`. */
function currentFyStart(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() + 1 >= 4 ? y : y - 1;
  return `${startYear}-04-01`;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  loadEnv();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Set them in .env (they are already present for this project) or export them.",
    );
  }

  const fy = arg("fy");
  const range = fy
    ? fyRange(fy)
    : { from: arg("from") ?? currentFyStart(), to: arg("to") ?? todayIso() };
  const branchFilter = arg("branch");
  const outDir = resolve(process.cwd(), arg("out") ?? "data/tally-export");
  const format = (arg("format") ?? "both").toLowerCase();
  if (!["xml", "csv", "both"].includes(format)) {
    throw new Error(`--format must be xml, csv or both (got "${format}")`);
  }

  console.log(`\nProkon → Tally export`);
  console.log(`  range    : ${range.from} → ${range.to}`);
  console.log(`  branch   : ${branchFilter ?? "(all)"}`);
  console.log(`  output   : ${outDir}`);
  console.log(`  format   : ${format}\n`);

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── branches ──────────────────────────────────────────────────────────────
  const { data: branchRows, error: bErr } = await sb.from("branches").select("id,name,gstin");
  if (bErr) throw new Error(`branches: ${bErr.message}`);
  const branches = (branchRows ?? []) as TallyBranchRow[];
  const branchesById = new Map(branches.map((b) => [b.id, b]));

  let branchIds: string[] | null = null;
  if (branchFilter) {
    const needle = branchFilter.toLowerCase();
    const matched = branches.filter((b) => (b.name ?? "").toLowerCase().includes(needle));
    if (matched.length === 0) {
      throw new Error(
        `--branch "${branchFilter}" matched no branch. Known branches:\n  ` +
          branches.map((b) => b.name).join("\n  "),
      );
    }
    branchIds = matched.map((b) => b.id);
    console.log(`  matched branches: ${matched.map((b) => b.name).join(", ")}\n`);
  }

  // ── invoices (paged past the PostgREST 1000-row cap) ───────────────────────
  const PAGE = 1000;
  const invoices: TallyInvoiceRow[] = [];
  for (let page = 0; page < 200; page++) {
    let q = sb
      .from("invoices")
      .select(
        "id,invoice_no,invoice_date,branch_id,customer_id,buyer_name,buyer_gstin,buyer_state_code," +
          "seller_gstin,seller_state_code,place_of_supply_code,is_interstate,sales_type,reverse_charge," +
          "subtotal,discount,taxable_value,cgst,sgst,igst,cess,round_off,total,status,notes," +
          "irn,ack_no,ack_date,ewaybill_no,ewaybill_date,ewaybill_valid_till",
      )
      .gte("invoice_date", range.from)
      .lte("invoice_date", range.to)
      .order("invoice_date", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (branchIds) q = q.in("branch_id", branchIds);
    const { data, error } = await q;
    if (error) throw new Error(`invoices: ${error.message}`);
    const batch = (data ?? []) as TallyInvoiceRow[];
    invoices.push(...batch);
    if (batch.length < PAGE) break;
  }

  if (invoices.length === 0) {
    console.log("No invoices in range — nothing to export.");
    return;
  }
  console.log(`Fetched ${invoices.length} invoice(s).`);

  // ── items for those invoices (chunked .in() to keep URLs sane) ─────────────
  const ids = invoices.map((i) => i.id);
  const itemsByInvoice = new Map<string, TallyInvoiceItemRow[]>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from("invoice_items")
      .select(
        "invoice_id,sr_no,product_id,description,hsn,qty,unit,rate,discount_pct," +
          "taxable_value,gst_rate,cgst,sgst,igst,cess,line_total",
      )
      .in("invoice_id", slice)
      .order("sr_no", { ascending: true });
    if (error) throw new Error(`invoice_items: ${error.message}`);
    for (const row of (data ?? []) as Array<TallyInvoiceItemRow & { invoice_id: string }>) {
      const list = itemsByInvoice.get(row.invoice_id) ?? [];
      list.push(row);
      itemsByInvoice.set(row.invoice_id, list);
    }
  }

  // ── build ─────────────────────────────────────────────────────────────────
  const allowFake = process.argv.includes("--allow-fake-references");
  const result = buildSalesExport({
    invoices,
    itemsByInvoice,
    branchesById,
    // With the override, emit the vouchers but STRIP the untrustworthy statutory
    // fields rather than writing fabricated identifiers into Tally.
    stripBadReferences: allowFake,
  });

  console.log(`\nVouchers built : ${result.voucherCount}`);
  console.log(`Cancelled skipped : ${result.skippedCancelled}`);

  if (result.drift.length > 0) {
    console.log(`\n⚠ GST drift: ${result.drift.length} line/header disagreement(s).`);
    console.log(`  The export posts the STORED header (what the IRN and the customer hold).`);
    console.log(`  Investigate these — do NOT "fix" them during export.`);
    const byVoucher = new Map<string, typeof result.drift>();
    for (const d of result.drift) {
      const l = byVoucher.get(d.voucherNumber) ?? [];
      l.push(d);
      byVoucher.set(d.voucherNumber, l);
    }
    let shown = 0;
    for (const [vno, list] of byVoucher) {
      if (shown++ >= 10) {
        console.log(`  … and ${byVoucher.size - 10} more voucher(s)`);
        break;
      }
      console.log(
        `  ${vno}: ` +
          list
            .map((d) => `${d.field} stored=${d.stored} recomputed=${d.recomputed} (Δ${d.delta})`)
            .join("; "),
      );
    }
  }

  if (result.referenceWarnings.length > 0) {
    const allow = allowFake;
    const label = allow ? "⚠ WARNING" : "✖ BLOCKED";
    console.error(
      `\n${label}: ${result.referenceWarnings.length} suspicious statutory reference(s) found.`,
    );
    for (const w of result.referenceWarnings.slice(0, 20)) {
      console.error(`  ${w.voucherNumber} [${w.field}]: ${w.reason}`);
      console.error(`      value: ${w.value}`);
    }
    if (!allow) {
      console.error(
        `\nThese are NOT real IRN / E-Way Bill numbers. Importing them into Tally would\n` +
          `write fabricated statutory identifiers into your accounting books.\n\n` +
          `Fix the source rows (null out the fake irn/ewaybill_no and reset\n` +
          `einvoice_status) and re-run the export.\n\n` +
          `If you deliberately want the vouchers WITHOUT the statutory fields, re-run\n` +
          `with --allow-fake-references. Nothing was written.`,
      );
      process.exitCode = 1;
      return;
    }
    console.error(
      `\n  --allow-fake-references set — continuing, but see docs/GSP_INTEGRATION_AND_TALLY_EXPORT.md §12.\n`,
    );
  }

  if (result.unbalanced.length > 0) {
    console.error(
      `\n✖ ${result.unbalanced.length} voucher(s) DO NOT BALANCE — refusing to write output.`,
    );
    for (const u of result.unbalanced.slice(0, 20)) {
      console.error(
        `  ${u.voucherNumber}: sum=${u.check.sum} expected=${u.check.expected} diff=${u.check.diff}`,
      );
    }
    console.error(
      `\nThis means invoice headers disagree with their line items beyond rounding.\n` +
        `Fix the data (or the ledger map) and re-run. Nothing was written.`,
    );
    process.exitCode = 1;
    return;
  }

  // ── write ─────────────────────────────────────────────────────────────────
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const base = `tally-sales-${range.from}_to_${range.to}-${stamp}`;
  const written: string[] = [];

  if (format === "xml" || format === "both") {
    const p = resolve(outDir, `${base}.xml`);
    writeFileSync(p, result.xml, "utf8");
    written.push(p);
  }
  if (format === "csv" || format === "both") {
    const p = resolve(outDir, `${base}.csv`);
    writeFileSync(p, salesCsv(result), "utf8");
    written.push(p);
  }

  console.log(`\n✅ Wrote ${written.length} file(s):`);
  for (const p of written) console.log(`   ${p}`);

  console.log(
    `\nNext steps:\n` +
      `  1. TallyPrime → Gateway of Tally → Import Data → Vouchers, OR POST the XML to\n` +
      `     http://localhost:9000 with the Import Data envelope (already embedded).\n` +
      `  2. Import into a TRIAL company first and tie the Trial Balance to the invoice register.\n` +
      `  3. Ledger names must exist in your Tally company — unknown names surface as LINEERROR\n` +
      `     in the import response (see parseTallyResponse).\n`,
  );
}

main().catch((e: unknown) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
