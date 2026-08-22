import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, Zap, Battery as BatteryIcon } from "lucide-react";
import { ProductPicker, type ProductMaster } from "@/components/ProductPicker";
import { fetchAll } from "@/lib/fetchAll";
import type { UpsBundle, Battery, BatteryTier, BundleItem } from "@/lib/upsBundle";
import { TIER_LABEL } from "@/lib/upsBundle";

export const Route = createFileRoute("/_app/crm/bundles")({
  component: BundlesSettings,
  head: () => ({ meta: [{ title: "UPS Bundles & Battery Catalog — Prokon" }] }),
});

function BundlesSettings() {
  const confirm = useConfirm();
  const [bundles, setBundles] = useState<UpsBundle[]>([]);
  const [batteries, setBatteries] = useState<Battery[]>([]);
  const [products, setProducts] = useState<ProductMaster[]>([]);
  const [loading, setLoading] = useState(true);

  const productMap = new Map(products.map((p) => [p.id, p] as const));

  async function load() {
    setLoading(true);
    const [b, bat, p] = await Promise.all([
      supabase.from("ups_bundles" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("battery_catalog" as any).select("*").order("tier").order("ah"),
      fetchAll<ProductMaster>("products", (q) => q.select("*").order("name")),
    ]);
    setBundles(((b.data as any[]) || []).map((r) => ({ ...r, items: Array.isArray(r.items) ? r.items : [] })));
    setBatteries((bat.data as any[]) || []);
    setProducts(p);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  // ---- Bundle CRUD ----
  function addBundle() {
    // Local draft — inserted on Save once a parent product is picked (NOT NULL column).
    const draft: UpsBundle = {
      id: `draft-${Date.now()}`,
      parent_product_id: "",
      label: "",
      ups_load_watts: null,
      items: [],
      active: true,
    } as any;
    setBundles([draft, ...bundles]);
  }
  const updBundle = (id: string, patch: Partial<UpsBundle>) =>
    setBundles((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  async function saveBundle(b: UpsBundle) {
    if (!b.parent_product_id) return toast.error("Select the UPS product first");
    const isDraft = String(b.id).startsWith("draft-");
    if (isDraft) {
      const { data, error } = await supabase
        .from("ups_bundles" as any)
        .insert({
          parent_product_id: b.parent_product_id,
          label: b.label,
          ups_load_watts: b.ups_load_watts,
          items: b.items as any,
          active: b.active,
        } as any)
        .select("*")
        .single();
      if (error) return toast.error(error.message);
      setBundles((prev) => prev.map((x) => (x.id === b.id ? { ...(data as any), items: Array.isArray((data as any).items) ? (data as any).items : [] } : x)));
      toast.success("Bundle saved");
      return;
    }
    const { error } = await supabase
      .from("ups_bundles" as any)
      .update({
        parent_product_id: b.parent_product_id,
        label: b.label,
        ups_load_watts: b.ups_load_watts,
        items: b.items as any,
        active: b.active,
      } as any)
      .eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success("Bundle saved");
  }
  async function delBundle(id: string) {
    const ok = await confirm({
      title: "Delete this bundle?",
      description: "The bundle definition is removed. Products already in it are unaffected.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    if (String(id).startsWith("draft-")) {
      setBundles((prev) => prev.filter((b) => b.id !== id));
      return;
    }
    const { error } = await supabase.from("ups_bundles" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    setBundles((prev) => prev.filter((b) => b.id !== id));
  }
  const addBundleItem = (bid: string) => {
    const b = bundles.find((x) => x.id === bid);
    if (!b) return;
    updBundle(bid, { items: [...(b.items || []), { product_id: "", qty: 1 } as BundleItem] });
  };
  const setBundleItem = (bid: string, idx: number, patch: Partial<BundleItem>) => {
    const b = bundles.find((x) => x.id === bid);
    if (!b) return;
    const items = [...b.items];
    items[idx] = { ...items[idx], ...patch };
    updBundle(bid, { items });
  };
  const delBundleItem = (bid: string, idx: number) => {
    const b = bundles.find((x) => x.id === bid);
    if (!b) return;
    updBundle(bid, { items: b.items.filter((_, i) => i !== idx) });
  };

  // ---- Battery CRUD ----
  async function addBattery() {
    const { data, error } = await supabase
      .from("battery_catalog" as any)
      .insert({ voltage: 12, ah: 100, tier: "standard", price: 0, active: true } as any)
      .select("*")
      .single();
    if (error) return toast.error(error.message);
    setBatteries([data as any, ...batteries]);
  }
  const updBattery = (id: string, patch: Partial<Battery>) =>
    setBatteries((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  async function saveBattery(b: Battery) {
    const { error } = await supabase
      .from("battery_catalog" as any)
      .update({
        product_id: b.product_id,
        brand: b.brand,
        model: b.model,
        voltage: b.voltage,
        ah: b.ah,
        tier: b.tier,
        price: b.price,
        active: b.active,
      } as any)
      .eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success("Battery saved");
  }
  async function delBattery(id: string) {
    const ok = await confirm({
      title: "Delete this battery?",
      description: "The battery is removed from the catalog.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("battery_catalog" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    setBatteries((prev) => prev.filter((b) => b.id !== id));
  }

  if (loading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  const tiers: BatteryTier[] = ["economy", "standard", "premium"];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Smart Sales — Bundles & Battery Catalog</h1>
        <p className="text-sm text-muted-foreground">
          Define what accessories auto-suggest when a UPS is added to a quote, and manage the battery catalog used by the recommendation engine.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-600" /> UPS Bundles
          </CardTitle>
          <Button size="sm" onClick={addBundle}>
            <Plus className="h-4 w-4 mr-1" />New bundle
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {bundles.length === 0 && <div className="text-sm text-muted-foreground">No bundles yet.</div>}
          {bundles.map((b) => (
            <div key={b.id} className="rounded-md border p-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                <div className="md:col-span-5">
                  <Label className="text-xs">UPS (parent product)</Label>
                  <ProductPicker
                    value={b.parent_product_id || null}
                    onChange={(id, p) =>
                      updBundle(b.id, { parent_product_id: id || "", label: b.label || p?.name || "" })
                    }
                  />
                </div>
                <div className="md:col-span-4">
                  <Label className="text-xs">Label</Label>
                  <Input value={b.label || ""} onChange={(e) => updBundle(b.id, { label: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">Default load (W)</Label>
                  <Input
                    type="number"
                    value={b.ups_load_watts ?? ""}
                    onChange={(e) => updBundle(b.id, { ups_load_watts: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div className="md:col-span-1 flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => delBundle(b.id)}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>

              <div className="rounded border bg-slate-50/50 p-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Bundle items</div>
                  <Button size="sm" variant="outline" onClick={() => addBundleItem(b.id)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Add item
                  </Button>
                </div>
                {b.items.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic px-1">No items — add batteries, rack, interlinks, installation, delivery…</div>
                ) : (
                  <div className="space-y-2">
                    {b.items.map((it, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-12 md:col-span-6">
                          <Label className="text-[11px]">Item</Label>
                          <ProductPicker
                            value={it.product_id || null}
                            onChange={(id, p) => setBundleItem(b.id, i, { product_id: id || "", description: p?.name || it.description })}
                          />
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <Label className="text-[11px]">Qty (× UPS qty)</Label>
                          <Input type="number" value={it.qty} onChange={(e) => setBundleItem(b.id, i, { qty: Number(e.target.value) })} />
                        </div>
                        <div className="col-span-8 md:col-span-3">
                          <Label className="text-[11px]">Note (optional)</Label>
                          <Input value={it.note || ""} onChange={(e) => setBundleItem(b.id, i, { note: e.target.value })} />
                        </div>
                        <div className="col-span-1 text-right">
                          <Button size="sm" variant="ghost" onClick={() => delBundleItem(b.id, i)}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <Button size="sm" onClick={() => saveBundle(b)}>
                  <Save className="h-4 w-4 mr-1" />Save bundle
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BatteryIcon className="h-4 w-4 text-emerald-600" /> Battery Catalog
          </CardTitle>
          <Button size="sm" onClick={addBattery}>
            <Plus className="h-4 w-4 mr-1" />New battery
          </Button>
        </CardHeader>
        <CardContent>
          {batteries.length === 0 && <div className="text-sm text-muted-foreground">No batteries yet.</div>}
          <div className="space-y-2">
            {batteries.map((b) => (
              <div key={b.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end rounded border p-2 bg-white">
                <div className="md:col-span-3">
                  <Label className="text-[11px]">Linked product (optional)</Label>
                  <ProductPicker
                    value={b.product_id || null}
                    onChange={(id, p) =>
                      updBattery(b.id, {
                        product_id: id || null,
                        brand: b.brand || p?.brand || null,
                        model: b.model || p?.model || null,
                        price: b.price || (p?.default_price != null ? Number(p.default_price) : 0),
                      })
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-[11px]">Brand</Label>
                  <Input value={b.brand || ""} onChange={(e) => updBattery(b.id, { brand: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-[11px]">Model</Label>
                  <Input value={b.model || ""} onChange={(e) => updBattery(b.id, { model: e.target.value })} />
                </div>
                <div className="md:col-span-1">
                  <Label className="text-[11px]">V</Label>
                  <Input type="number" value={b.voltage} onChange={(e) => updBattery(b.id, { voltage: Number(e.target.value) })} />
                </div>
                <div className="md:col-span-1">
                  <Label className="text-[11px]">Ah</Label>
                  <Input type="number" value={b.ah} onChange={(e) => updBattery(b.id, { ah: Number(e.target.value) })} />
                </div>
                <div className="md:col-span-1">
                  <Label className="text-[11px]">Tier</Label>
                  <select
                    className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                    value={b.tier}
                    onChange={(e) => updBattery(b.id, { tier: e.target.value as BatteryTier })}
                  >
                    {tiers.map((t) => (
                      <option key={t} value={t}>{TIER_LABEL[t]}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-1">
                  <Label className="text-[11px]">Price</Label>
                  <Input type="number" value={b.price} onChange={(e) => updBattery(b.id, { price: Number(e.target.value) })} />
                </div>
                <div className="md:col-span-1 flex items-center gap-1 justify-end">
                  <label className="text-[11px] flex items-center gap-1">
                    <input type="checkbox" checked={b.active} onChange={(e) => updBattery(b.id, { active: e.target.checked })} />
                    <span>On</span>
                  </label>
                </div>
                <div className="md:col-span-12 flex justify-end gap-2">
                  {b.product_id && productMap.get(b.product_id) && (
                    <Badge variant="outline" className="text-[10px]">
                      Linked: {productMap.get(b.product_id)!.name}
                    </Badge>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => delBattery(b.id)}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                  <Button size="sm" onClick={() => saveBattery(b)}>
                    <Save className="h-4 w-4 mr-1" />Save
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Backup formula: <span className="font-mono">(V × Ah × Qty × 0.8) ÷ Load(W)</span>. Recommendations pick the cheapest option per tier meeting the desired backup.
      </p>
    </div>
  );
}