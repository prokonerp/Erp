import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Battery as BatteryIcon, Zap, Sparkles, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { QuoteItem } from "@/lib/crm";
import { fmtMoney } from "@/lib/crm";
import {
  type UpsBundle,
  type Battery,
  type Recommendation,
  backupHours,
  fmtBackup,
  recommendBatteries,
  fetchUpsBundles,
  fetchBatteryCatalog,
  TIER_LABEL,
} from "@/lib/upsBundle";
import type { ProductMaster } from "@/components/ProductPicker";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

type Props = {
  items: QuoteItem[];
  onAddItems: (rows: QuoteItem[]) => void;
};

const RecoCard = memo(function RecoCard({ r, onAdd }: { r: Recommendation; onAdd: (r: Recommendation) => void }) {
  return (
    <div className="rounded-md border p-2 bg-white space-y-1">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-[10px]">{TIER_LABEL[r.tier]}</Badge>
        <span className="text-xs font-semibold">{fmtMoney(r.total_price)}</span>
      </div>
      <div className="text-xs font-medium">{r.battery.voltage}V \u00d7 {r.battery.ah}Ah \u00d7 {r.qty} nos</div>
      <div className="text-[10px] text-muted-foreground">{r.battery.brand} {r.battery.model} \u2014 backup \u2248 {fmtBackup(r.achieved_backup_h)}</div>
      <Button size="sm" variant="outline" className="w-full h-7 text-[11px]" onClick={() => onAdd(r)}>Add to quote</Button>
    </div>
  );
});

export function UpsSmartPanel({ items, onAddItems }: Props) {
  const [bundles, setBundles] = useState<UpsBundle[]>([]);
  const [batteries, setBatteries] = useState<Battery[]>([]);
  const [overrides, setOverrides] = useState<Record<string, { loadW: number; desiredH: number }>>({});
  const [recos, setRecos] = useState<Record<string, Recommendation[]>>({});

  // Bundles + batteries still via their own fetchers; products now bounded server query (100 max, explicit 8 cols)
  const PRODUCT_COLS = "id,name,model,brand,hsn,unit,default_price,description";
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["ups-smart-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select(PRODUCT_COLS).eq("active", true).order("name").limit(100);
      if (error) throw error;
      return (data || []) as unknown as ProductMaster[];
    },
    staleTime: 5 * 60 * 1000,
  });
  const products = useMemo(() => (productsData as unknown as ProductMaster[] | undefined) ?? [], [productsData]);

  const [catalogLoading, setCatalogLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchUpsBundles(), fetchBatteryCatalog()])
      .then(([b, bat]) => {
        if (!alive) return;
        setBundles(b);
        setBatteries(bat);
      })
      .catch(() => {})
      .finally(() => alive && setCatalogLoading(false));
    return () => { alive = false; };
  }, []);

  const loading = catalogLoading || productsLoading;

  const productMap = useMemo(() => {
    const m = new Map<string, ProductMaster>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  // Find quote lines that match a UPS bundle parent
  const upsLines = useMemo(() => {
    return items
      .map((it, idx) => {
        const pid = (it as any).product_id as string | undefined;
        const bundle = pid ? bundles.find((b) => b.parent_product_id === pid) : undefined;
        if (!pid || !bundle) return null;
        return { idx, item: it, bundle, productId: pid };
      })
      .filter(Boolean) as { idx: number; item: QuoteItem; bundle: UpsBundle; productId: string }[];
  }, [items, bundles]);

  const addBundle = useCallback((u: { bundle: UpsBundle; item: QuoteItem }) => {
    const existingPids = new Set(items.map((it) => (it as any).product_id).filter(Boolean));
    const rows: QuoteItem[] = [];
    for (const bi of u.bundle.items) {
      if (existingPids.has(bi.product_id)) continue;
      const p = productMap.get(bi.product_id);
      if (!p) continue;
      const qty = Number(bi.qty || 1) * Math.max(1, Number(u.item.qty || 1));
      rows.push({
        description: p.name,
        hsn: p.hsn || "",
        qty,
        unit: p.unit || "Nos",
        rate: p.default_price != null ? Number(p.default_price) : 0,
        discount_percent: 0,
        tax_percent: 18,
        amount: 0,
        item_details: bi.note || bi.description || "",
        // pass product_id for future matching
        product_id: p.id,
      } as any);
    }
    if (rows.length === 0) {
      toast.info("All bundle items are already added.");
      return;
    }
    onAddItems(rows);
    toast.success(`Added ${rows.length} bundle item(s)`);
  }, [items, productMap, onAddItems]);

  const getState = useCallback((key: string, bundle: UpsBundle) =>
    overrides[key] ?? { loadW: Number(bundle.ups_load_watts || 0), desiredH: 4 }, [overrides]);

  // Memoized battery lookup — stable reference vs per-row findQuoteBattery()
  const currentBattery = useMemo(() => {
    for (const it of items) {
      const pid = (it as any).product_id as string | undefined;
      if (!pid) continue;
      const bat = batteries.find((b) => b.product_id === pid);
      if (bat) return { battery: bat, qty: Number(it.qty || 0) };
    }
    return null;
  }, [items, batteries]);

  const handleRecommend = useCallback((key: string, loadW: number, desiredH: number) => {
    const r = recommendBatteries(batteries, loadW, desiredH);
    setRecos((prev) => ({ ...prev, [key]: r }));
    if (r.length === 0) toast.info("No batteries found for these inputs. Configure Battery Catalog in Settings.");
  }, [batteries]);

  const handleApplyReco = useCallback((r: Recommendation) => {
    const bp = r.battery.product_id ? productMap.get(r.battery.product_id) : undefined;
    const desc = bp?.name || `${r.battery.brand || ""} ${r.battery.model || ""} ${r.battery.voltage}V ${r.battery.ah}Ah`.trim();
    const row: QuoteItem = {
      description: desc || "Battery",
      hsn: bp?.hsn || "",
      qty: r.qty,
      unit: bp?.unit || "Nos",
      rate: r.battery.price || (bp?.default_price != null ? Number(bp.default_price) : 0),
      discount_percent: 0,
      tax_percent: 18,
      amount: 0,
      item_details: `${r.battery.voltage}V \u00d7 ${r.battery.ah}Ah \u2014 ${TIER_LABEL[r.tier]} tier`,
    } as any;
    if (bp) (row as any).product_id = bp.id;
    onAddItems([row]);
    toast.success(`Added ${r.qty} \u00d7 ${desc}`);
  }, [productMap, onAddItems]);


  if (loading) return null;
  if (upsLines.length === 0) return null;


  return (
    <Card className="print:hidden border-blue-200 bg-blue-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-blue-600" /> Smart UPS Panel
          <Badge variant="outline" className="ml-2 text-[10px]">Live calc</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {upsLines.map((u) => {
          const key = `${u.productId}-${u.idx}`;
          const s = getState(key, u.bundle);
          const currentBat = currentBattery;
          const liveH = currentBat
            ? backupHours({
                voltage: currentBat.battery.voltage,
                ah: currentBat.battery.ah,
                qty: currentBat.qty,
                loadW: s.loadW,
              })
            : 0;
          const halfLoadH = liveH * 2;
          const isLow = liveH > 0 && liveH < 1;



          return (
            <div key={key} className="rounded-md border bg-white p-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="text-sm font-semibold flex items-center gap-2">
                  <BatteryIcon className="h-4 w-4 text-emerald-600" />
                  {u.item.description || "UPS"} {u.item.qty > 1 && <span className="text-xs text-muted-foreground">× {u.item.qty}</span>}
                </div>
                <Button size="sm" variant="outline" onClick={() => addBundle(u)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add bundle items
                  <span className="ml-1 text-[10px] text-muted-foreground">({u.bundle.items.length})</span>
                </Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
                <div>
                  <Label className="text-[11px]">Load (Watts)</Label>
                  <Input
                    type="number"
                    value={s.loadW || ""}
                    onChange={(e) =>
                      setOverrides((p) => ({ ...p, [key]: { ...s, loadW: Number(e.target.value) } }))
                    }
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Desired backup (h)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={s.desiredH}
                    onChange={(e) =>
                      setOverrides((p) => ({ ...p, [key]: { ...s, desiredH: Number(e.target.value) } }))
                    }
                  />
                </div>
                <div className="rounded-md bg-emerald-50 border border-emerald-200 p-2">
                  <div className="text-[10px] text-emerald-800 uppercase">Full load backup</div>
                  <div className="text-sm font-bold text-emerald-900">{fmtBackup(liveH)}</div>
                </div>
                <div className="rounded-md bg-amber-50 border border-amber-200 p-2">
                  <div className="text-[10px] text-amber-800 uppercase">50% load backup</div>
                  <div className="text-sm font-bold text-amber-900">{fmtBackup(halfLoadH)}</div>
                </div>
              </div>

              {currentBat ? (
                <div className="text-[11px] text-muted-foreground">
                  Using: {currentBat.battery.voltage}V × {currentBat.battery.ah}Ah × {currentBat.qty} nos
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground italic">
                  Add a battery from the catalog (or use "Recommend batteries") to see live backup.
                </div>
              )}

              {isLow && (
                <div className="flex items-center gap-1 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  <AlertTriangle className="h-3.5 w-3.5" /> Backup is low (&lt; 1 hour). Consider adding more batteries.
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-2">
                <div className="text-[11px] text-muted-foreground">
                  Formula: (V × Ah × Qty × 0.8) / Load
                </div>
                <Button size="sm" variant="secondary" onClick={() => handleRecommend(key, s.loadW, s.desiredH)}>
                  <Sparkles className="h-3.5 w-3.5 mr-1" /> Recommend batteries
                </Button>
              </div>

              {recos[key] && recos[key].length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {recos[key].map((r) => (
                    <RecoCard key={r.tier} r={r} onAdd={handleApplyReco} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}