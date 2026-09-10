import type { StockItem, Transaction } from "@/lib/ims";

export type GrnSource = "oem" | "customer" | "general" | "other";

export function grnSourceOf(ref: string | null | undefined): GrnSource | null {
  if (!ref) return null;
  const r = ref.toUpperCase();
  if (!r.startsWith("GRN ")) return null;
  if (r.includes("GRN-OEM")) return "oem";
  if (r.includes("GRN-CUST")) return "customer";
  if (r.includes("GRN-GEN")) return "general";
  return "other";
}

export type ReceivedAgg = {
  total: number;
  oem: number;
  customer: number;
  general: number;
  latestGrn: string | null;
  latestDate: string | null;
  txns: Transaction[];
};

export const emptyReceived = (): ReceivedAgg => ({
  total: 0,
  oem: 0,
  customer: 0,
  general: 0,
  latestGrn: null,
  latestDate: null,
  txns: [],
});

export function accumulateReceived(agg: ReceivedAgg, t: Transaction) {
  const src = grnSourceOf(t.reference);
  if (!src) return;
  if (t.txn_type !== "good_in" && t.txn_type !== "defective_in") return;
  const q = Number(t.qty) || 0;
  agg.total += q;
  if (src === "oem") agg.oem += q;
  else if (src === "customer") agg.customer += q;
  else if (src === "general") agg.general += q;
  agg.txns.push(t);
  const d = t.txn_date;
  if (!agg.latestDate || d > agg.latestDate) {
    agg.latestDate = d;
    agg.latestGrn = (t.reference || "").replace(/^GRN\s+/i, "") || null;
  }
}

export type BetaProductRow = {
  key: string;
  part_name: string;
  part_model_no: string | null;
  oem: string | null;
  category: string | null;
  total: number;
  available: number;
  reserved: number;
  issued: number;
  good: number;
  defective: number;
  scrapped: number;
  returnedToOem: number;
  warehouses: Set<string>;
  items: StockItem[];
  received: ReceivedAgg;
  pooledQty: number;
  serializedQty: number;
  serialCount: number;
};

function normalizeModel(v: string | null | undefined) {
  return (v || "").trim().toLowerCase();
}
function normalizeName(v: string | null | undefined) {
  return (v || "").trim().toLowerCase();
}

function betaKeyOf(s: StockItem) {
  // BETA: 1 model = 1 row — group by normalized model only.
  // Falls back to normalized name when model missing, but ignores OEM/category
  // to merge drift like "RBC2|RBC2" vs "RBC2|APC RBC2".
  const m = normalizeModel(s.part_model_no);
  if (m) return m;
  return `__name__${normalizeName(s.part_name)}`;
}
function betaTxnKey(t: Transaction) {
  const m = normalizeModel(t.part_model_no);
  if (m) return m;
  return `__name__${normalizeName(t.part_name)}`;
}

// Legacy aliases for any caller expecting old names
const keyOf = betaKeyOf;
const txnKey = betaTxnKey;

export function aggregateBeta(items: StockItem[], txns: Transaction[]): BetaProductRow[] {
  const map = new Map<string, BetaProductRow>();
  // First pass — group stock
  for (const s of items) {
    const k = betaKeyOf(s);
    let r = map.get(k);
    if (!r) {
      r = {
        key: k,
        part_name: s.part_name,
        part_model_no: s.part_model_no,
        oem: s.oem,
        category: s.category,
        total: 0,
        available: 0,
        reserved: 0,
        issued: 0,
        good: 0,
        defective: 0,
        scrapped: 0,
        returnedToOem: 0,
        warehouses: new Set(),
        items: [],
        received: emptyReceived(),
        pooledQty: 0,
        serializedQty: 0,
        serialCount: 0,
      };
      map.set(k, r);
    }
    const q = s.qty ?? 1;
    r.total += q;
    if (s.stock_status === "available") r.available += q;
    if (s.stock_status === "reserved") r.reserved += q;
    if (s.stock_status === "issued") r.issued += q;
    if (s.stock_status === "scrapped") r.scrapped += q;
    if (s.stock_status === "returned_to_oem") r.returnedToOem += q;
    if (s.stock_type === "good") r.good += q;
    if (s.stock_type === "defective") r.defective += q;
    if (s.warehouse_id) r.warehouses.add(s.warehouse_id);
    if (s.part_serial_no) {
      r.serializedQty += q;
      r.serialCount += 1;
    } else {
      r.pooledQty += q;
    }
    r.items.push(s);
  }
  // Resolve display fields to most frequent within group (fixes drift)
  for (const r of map.values()) {
    const names = r.items.map((i) => i.part_name).filter(Boolean) as string[];
    const oems = r.items.map((i) => i.oem).filter(Boolean) as string[];
    const cats = r.items.map((i) => i.category).filter(Boolean) as string[];
    const freq = (arr: string[]) => {
      const c = new Map<string, number>();
      for (const v of arr) c.set(v, (c.get(v) || 0) + 1);
      let best: string | null = null;
      let max = 0;
      for (const [k, v] of c) if (v > max) { max = v; best = k; }
      return best;
    };
    const bestName = freq(names);
    const bestOem = freq(oems);
    const bestCat = freq(cats);
    if (bestName) r.part_name = bestName;
    if (bestOem) r.oem = bestOem;
    if (bestCat) r.category = bestCat;
    // Canonical model is already the key, keep first non-empty trimmed
    if (!r.part_model_no) {
      const m = r.items.find((i) => (i.part_model_no || "").trim())?.part_model_no || null;
      if (m) r.part_model_no = m.trim();
    } else {
      r.part_model_no = r.part_model_no.trim();
    }
  }
  for (const t of txns) {
    const k = betaTxnKey(t);
    const r = map.get(k);
    if (!r) continue;
    accumulateReceived(r.received, t);
  }
  return Array.from(map.values()).sort((a, b) => a.part_name.localeCompare(b.part_name));
}
