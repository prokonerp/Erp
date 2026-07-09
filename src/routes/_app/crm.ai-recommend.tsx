import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sparkles, Zap, Battery as BatteryIcon, Clock, AlertTriangle } from "lucide-react";
import { ProductPicker, type ProductMaster } from "@/components/ProductPicker";
import { fetchBatteryCatalog, type Battery } from "@/lib/upsBundle";
import { supabase } from "@/integrations/supabase/client";
import {
  recommend,
  DEFAULT_RULES,
  fmtINR,
  type RecommendationResult,
  type RecommendationRules,
} from "@/lib/aiRecommendation";
import { formatBackup } from "@/lib/backupEngine";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/crm/ai-recommend")({
  component: AiRecommendPage,
  head: () => ({
    meta: [
      { title: "AI Battery Recommendation — Prokon" },
      { name: "description", content: "Rule-based battery sizing engine for UPS configurations." },
    ],
  }),
});

function AiRecommendPage() {
  const [upsProduct, setUpsProduct] = useState<ProductMaster | null>(null);
  const [loadW, setLoadW] = useState<string>("");
  const [targetHours, setTargetHours] = useState<string>("2");
  const [catalog, setCatalog] = useState<Battery[]>([]);
  const [rules] = useState<RecommendationRules>(DEFAULT_RULES);
  const [upsLoadFromBundle, setUpsLoadFromBundle] = useState<number | null>(null);

  useEffect(() => {
    fetchBatteryCatalog().then(setCatalog).catch(() => {});
  }, []);

  // When UPS product is picked, try to pull its default load from ups_bundles.
  useEffect(() => {
    if (!upsProduct) { setUpsLoadFromBundle(null); return; }
    let alive = true;
    supabase
      .from("ups_bundles" as any)
      .select("ups_load_watts")
      .eq("parent_product_id", upsProduct.id)
      .eq("active", true)
      .maybeSingle()
      .then(({ data }: any) => {
        if (!alive) return;
        const w = Number(data?.ups_load_watts) || null;
        setUpsLoadFromBundle(w);
        if (w && !loadW) setLoadW(String(w));
      });
    return () => { alive = false; };
  }, [upsProduct]);

  const result: RecommendationResult | null = useMemo(() => {
    const load = Number(loadW);
    const hrs = Number(targetHours);
    if (!load || !hrs) return null;
    return recommend({ loadW: load, targetHours: hrs, rules, catalog });
  }, [loadW, targetHours, rules, catalog]);

  function useCalculatedLoad() {
    if (upsLoadFromBundle) {
      setLoadW(String(upsLoadFromBundle));
      toast.success(`Using ${upsLoadFromBundle} W from bundle configuration`);
    } else {
      toast.info("No UPS bundle load configured for this product.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Battery Recommendation
          </h1>
          <p className="text-sm text-muted-foreground">
            Rule-based sizing engine. Recommendations use the current configurable rule set — no external AI service.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Inputs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5 md:col-span-1">
            <Label>UPS Product (optional)</Label>
            <ProductPicker
              value={upsProduct?.id ?? null}
              onChange={(_id, p) => setUpsProduct(p)}
              placeholder="Pick UPS from Product Master…"
            />
            {upsLoadFromBundle ? (
              <p className="text-xs text-muted-foreground">
                Bundle load: <strong>{upsLoadFromBundle} W</strong>
                <Button variant="link" size="sm" className="h-auto px-1" onClick={useCalculatedLoad}>
                  use calculated load
                </Button>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Or enter load manually below.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>UPS Load (Watts)</Label>
            <div className="relative">
              <Zap className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                className="pl-8"
                value={loadW}
                onChange={(e) => setLoadW(e.target.value)}
                placeholder="e.g. 3000"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Required Backup Time (hours)</Label>
            <div className="relative">
              <Clock className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                min={0}
                step="0.5"
                inputMode="decimal"
                className="pl-8"
                value={targetHours}
                onChange={(e) => setTargetHours(e.target.value)}
                placeholder="e.g. 2"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
            <span>Load: <strong>{result.loadW} W</strong></span>
            <span>Target: <strong>{result.targetHours} h</strong></span>
            <span>Efficiency: <strong>{Math.round(result.efficiency * 100)}%</strong></span>
            <span>Required capacity: <strong>{Math.round(result.requiredVAh)} VAh</strong></span>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {result.tiers.map((t) => (
              <Card key={t.level} className="relative overflow-hidden">
                <div
                  className={
                    "absolute inset-x-0 top-0 h-1 " +
                    (t.level === "premium"
                      ? "bg-amber-500"
                      : t.level === "standard"
                        ? "bg-primary"
                        : "bg-emerald-500")
                  }
                />
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{t.label}</CardTitle>
                    <Badge variant="outline" className="capitalize">{t.level}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.blurb}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {t.pick ? (
                    <>
                      <div className="flex items-center gap-2">
                        <BatteryIcon className="h-5 w-5 text-primary" />
                        <div className="text-lg font-semibold">{t.pick.configuration}</div>
                      </div>
                      <Separator />
                      <dl className="grid grid-cols-2 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">Battery</dt>
                        <dd className="text-right">{t.pick.voltage}V {t.pick.ah}Ah</dd>
                        <dt className="text-muted-foreground">Quantity</dt>
                        <dd className="text-right">{t.pick.qty}</dd>
                        <dt className="text-muted-foreground">Bank capacity</dt>
                        <dd className="text-right">{t.pick.totalAh} Ah</dd>
                        <dt className="text-muted-foreground">Achieved backup</dt>
                        <dd className="text-right">{formatBackup(t.pick.achievedBackupH)}</dd>
                        {t.pick.battery?.brand ? (
                          <>
                            <dt className="text-muted-foreground">Catalog match</dt>
                            <dd className="text-right">
                              {t.pick.battery.brand} {t.pick.battery.model ?? ""}
                            </dd>
                          </>
                        ) : null}
                        {t.pick.totalPrice != null ? (
                          <>
                            <dt className="text-muted-foreground">Est. price</dt>
                            <dd className="text-right font-semibold">{fmtINR(t.pick.totalPrice)}</dd>
                          </>
                        ) : null}
                      </dl>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No configuration within tier constraints.</p>
                  )}

                  {t.notes.length > 0 && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <ul className="space-y-1">
                        {t.notes.map((n, i) => <li key={i}>{n}</li>)}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Rules are configurable via <code>DEFAULT_RULES</code> in <code>src/lib/aiRecommendation.ts</code>.
            The engine is extensible — the <code>recommend()</code> signature is stable, so a future ML model can
            replace the rule-based logic without changing callers.
          </p>
        </>
      )}

      {!result && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Enter UPS load and required backup time to see Economy / Standard / Premium recommendations.
          </CardContent>
        </Card>
      )}
    </div>
  );
}