import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calculator, Clock, AlertTriangle, CheckCircle2, Zap } from "lucide-react";

export const Route = createFileRoute("/_app/crm/ai-recommend")({
  component: UpsBackupCalculatorPage,
  head: () => ({
    meta: [
      { title: "UPS Backup Time Calculator — Prokon" },
      { name: "description", content: "Calculate UPS backup time across load scenarios for predefined battery sizes." },
    ],
  }),
});

const BATTERY_RATINGS = [7, 9, 12, 26, 42, 65, 76, 80, 100, 120, 150, 200];
const LOAD_LEVELS = [25, 50, 75, 100] as const;
type LoadLevel = typeof LOAD_LEVELS[number];

type Row = {
  ah: number;
  backup: Record<LoadLevel, number>;   // minutes (rounded); -1 = charger supports load
  recommended: boolean;
};

function UpsBackupCalculatorPage() {
  const [kva, setKva] = useState("10");
  const [pf, setPf] = useState("0.9");
  const [dcBus, setDcBus] = useState("192");
  const [efficiency, setEfficiency] = useState("0.9");
  const [utilization, setUtilization] = useState("0.70");
  const [requiredMin, setRequiredMin] = useState("");
  const [includeCharger, setIncludeCharger] = useState(false);
  const [chargerAmp, setChargerAmp] = useState("10");

  const nKva = parseFloat(kva) || 0;
  const nPf = parseFloat(pf) || 0;
  const nDc = parseFloat(dcBus) || 0;
  const nEff = parseFloat(efficiency) || 0;
  const nUf = parseFloat(utilization) || 0;
  const nRequiredMin = parseFloat(requiredMin) || 0;
  const nCharger = parseFloat(chargerAmp) || 0;

  const load100 = nKva * 1000 * nPf;
  const loadFor = (lvl: LoadLevel) => load100 * (lvl / 100);

  const rows: Row[] = useMemo(() => {
    if (load100 <= 0 || nDc <= 0 || nEff <= 0 || nUf <= 0) return [];

    const calc = (ah: number, lvl: LoadLevel): number => {
      const load = loadFor(lvl);
      if (load <= 0) return 0;
      if (includeCharger) {
        const dcCurrent = load / (nDc * nEff);
        const effCurrent = dcCurrent - nCharger;
        if (effCurrent <= 0) return -1;
        return Math.round((ah * nUf * 60) / effCurrent);
      }
      return Math.round((ah * nUf * nDc * nEff * 60) / load);
    };

    const calculated = BATTERY_RATINGS.map((ah) => {
      const backup = {} as Record<LoadLevel, number>;
      for (const lvl of LOAD_LEVELS) backup[lvl] = calc(ah, lvl);
      return { ah, backup };
    });

    let recommendedAh: number | null = null;
    if (nRequiredMin > 0) {
      const match = calculated.find((r) => r.backup[100] >= nRequiredMin);
      if (match) recommendedAh = match.ah;
    }

    return calculated.map((r) => ({
      ...r,
      recommended: r.ah === recommendedAh,
    }));
  }, [load100, nDc, nEff, nUf, nRequiredMin, includeCharger, nCharger]);

  const errors: string[] = [];
  if (!nKva) errors.push("UPS Capacity (KVA) is required");
  if (!nDc) errors.push("DC Bus Voltage is required");
  if (nDc > 0 && nDc % 12 !== 0) errors.push("DC Bus Voltage should be a multiple of 12");
  if (nUf <= 0 || nUf > 1) errors.push("Utilization factor should be between 0 and 1");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calculator className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight uppercase">UPS Backup Time Calculator</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">Inputs</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">UPS Capacity (KVA)</Label>
              <Input type="number" step="0.1" value={kva} onChange={(e) => setKva(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Power Factor (PF)</Label>
              <Input type="number" step="0.01" value={pf} onChange={(e) => setPf(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">DC Bus Voltage (V)</Label>
              <Input type="number" step="1" value={dcBus} onChange={(e) => setDcBus(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Efficiency</Label>
              <Input type="number" step="0.01" value={efficiency} onChange={(e) => setEfficiency(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Utilization Factor</Label>
              <Input type="number" step="0.01" value={utilization} onChange={(e) => setUtilization(e.target.value)} />
            </div>
            <div className="col-span-2 md:col-span-4">
              <Label className="text-xs">Required Minimum Backup (minutes) — optional</Label>
              <Input type="number" step="1" value={requiredMin} onChange={(e) => setRequiredMin(e.target.value)} placeholder="e.g. 60" />
            </div>

            <div className="col-span-2 md:col-span-4 border-t pt-3 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch id="charger-toggle" checked={includeCharger} onCheckedChange={setIncludeCharger} />
                <Label htmlFor="charger-toggle" className="text-xs cursor-pointer flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5" /> Include Charger Impact
                </Label>
              </div>
              {includeCharger && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Charger Current (A)</Label>
                  <Input type="number" step="0.1" value={chargerAmp} onChange={(e) => setChargerAmp(e.target.value)} className="w-28 h-8" />
                </div>
              )}
            </div>

            <div className="col-span-2 md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 text-sm">
              <Stat label="Load 100% (W)" value={load100 > 0 ? load100.toFixed(0) : "—"} />
              <Stat label="Load 75% (W)" value={load100 > 0 ? loadFor(75).toFixed(0) : "—"} />
              <Stat label="Load 50% (W)" value={load100 > 0 ? loadFor(50).toFixed(0) : "—"} />
              <Stat label="Load 25% (W)" value={load100 > 0 ? loadFor(25).toFixed(0) : "—"} highlight />
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
              <Clock className="h-4 w-4" /> Formula
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="text-xs text-muted-foreground">
              Load (W) = KVA × 1000 × PF
            </div>
            <div className="text-xs text-muted-foreground">
              Backup (min) = (AH × UF × DC V × Eff × 60) / Load
            </div>
            {includeCharger && (
              <div className="text-xs text-muted-foreground pt-1 border-t">
                Charger mode: DC Current = Load / (DC V × Eff); Effective = DC Current − Charger A;
                Backup = (AH × UF × 60) / Effective
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {errors.length > 0 && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {errors.join(" • ")}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">
            Backup Time (Minutes) — by Load Level
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/60 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2 border-b font-bold">Battery AH</th>
                  <th className="text-right px-3 py-2 border-b font-bold">25% Load</th>
                  <th className="text-right px-3 py-2 border-b font-bold">50% Load</th>
                  <th className="text-right px-3 py-2 border-b font-bold">75% Load</th>
                  <th className="text-right px-3 py-2 border-b font-bold">100% Load</th>
                  <th className="text-center px-3 py-2 border-b font-bold">Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-muted-foreground">
                      Enter KVA, DC Bus Voltage, and Efficiency to see results.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr
                    key={r.ah}
                    className={`border-b hover:bg-muted/30 ${r.recommended ? "bg-primary/10" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium">{r.ah} Ah</td>
                    {LOAD_LEVELS.map((lvl) => (
                      <td
                        key={lvl}
                        className={`px-3 py-2 text-right tabular-nums ${lvl === 100 ? "font-semibold" : ""}`}
                      >
                        {r.backup[lvl] === -1 ? (
                          <span className="text-[11px] text-emerald-600">charger supports load</span>
                        ) : (
                          `${r.backup[lvl]} min`
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center">
                      {r.recommended && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Recommended
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded border px-3 py-2 ${highlight ? "bg-primary/10 border-primary/40" : "bg-background"}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-bold tabular-nums ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}
