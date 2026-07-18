import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Calculator, Zap, ShieldCheck, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/crm/ai-recommend")({
  component: UpsBackupCalculatorPage,
  head: () => ({
    meta: [
      { title: "UPS Backup Calculator — Prokon" },
      { name: "description", content: "Dynamic UPS backup engine — solve for backup time, battery, or load." },
    ],
  }),
});

const BATTERY_RATINGS = [7, 9, 12, 26, 42, 65, 75, 80, 100, 120, 150, 200];

type ChargerLimit = { charger_current: number; max_battery_ah: number };

function lookupMaxAh(limits: ChargerLimit[], chargerA: number): number | null {
  if (!chargerA) return null;
  const match = limits.find((l) => Number(l.charger_current) === chargerA);
  if (match) return Number(match.max_battery_ah);
  return chargerA * 12.5;
}

function fmtMinutes(m: number): string {
  if (!isFinite(m) || m <= 0) return "—";
  if (m < 60) return `${m.toFixed(1)} min`;
  const hh = Math.floor(m / 60);
  const mm = m - hh * 60;
  return `${hh}h ${mm.toFixed(1).padStart(4, "0")}m`;
}

function UpsBackupCalculatorPage() {
  const [kva, setKva] = useState("10");
  const [dcBus, setDcBus] = useState("192");
  const [efficiency, setEfficiency] = useState("0.9");
  const [pf, setPf] = useState("0.9");
  const [batteryAh, setBatteryAh] = useState("100");
  const [targetBackupMin, setTargetBackupMin] = useState("60");
  const [includeCharger, setIncludeCharger] = useState(false);
  const [chargerAmp, setChargerAmp] = useState("0");
  const [validateCharger, setValidateCharger] = useState(false);
  const [strictMode, setStrictMode] = useState(false);
  const [limits, setLimits] = useState<ChargerLimit[]>([]);

  useEffect(() => {
    supabase.from("charger_ah_limits" as any).select("charger_current,max_battery_ah").eq("active", true)
      .then(({ data }) => setLimits(((data as any[]) || []).map((r) => ({ charger_current: Number(r.charger_current), max_battery_ah: Number(r.max_battery_ah) }))));
  }, []);

  const nKva = parseFloat(kva) || 0;
  const nDc = parseFloat(dcBus) || 0;
  const nEff = parseFloat(efficiency) || 0.9;
  const nPf = parseFloat(pf) || 0.9;
  const nCharger = parseFloat(chargerAmp) || 0;
  const nBatteryAh = parseFloat(batteryAh) || 0;
  const nTargetMin = parseFloat(targetBackupMin) || 0;

  const va = nKva * 1000;
  const loadW = nKva * nPf * 1000;
  const dcCurrent = nDc > 0 && nEff > 0 ? loadW / (nDc * nEff) : 0;
  const effectiveDc = includeCharger ? Math.max(0, dcCurrent - nCharger) : dcCurrent;
  const strings = nDc > 0 ? Math.max(1, Math.ceil(nDc / 12)) : 0;

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!nKva) errors.push("KVA is required");
  if (!nDc) errors.push("DC BUS Voltage is required");
  if (nDc > 0 && nDc % 12 !== 0) warnings.push("DC BUS Voltage is not divisible by 12");

  const maxAllowedAh = validateCharger ? lookupMaxAh(limits, nCharger) : null;

  // Core: Backup(min) = (AH × V × Eff × 60) / Load; with charger: (AH × 60) / (DC_I - Charger)
  const calcBackupMin = (ah: number): number => {
    if (ah <= 0 || loadW <= 0 || nDc <= 0) return 0;
    if (includeCharger) {
      if (effectiveDc <= 0) return 0;
      return (ah * 60) / effectiveDc;
    }
    return (ah * nDc * nEff * 60) / loadW;
  };
  const calcRequiredAh = (targetMin: number): number => {
    if (targetMin <= 0 || loadW <= 0 || nDc <= 0) return 0;
    if (includeCharger) {
      if (effectiveDc <= 0) return 0;
      return (targetMin * effectiveDc) / 60;
    }
    return (targetMin * loadW) / (nDc * nEff * 60);
  };

  const actualBackupMin = useMemo(() => calcBackupMin(nBatteryAh), [nBatteryAh, loadW, nDc, nEff, includeCharger, effectiveDc]);
  const parallel = nBatteryAh > 0 && strings > 0 ? Math.max(1, Math.ceil(calcRequiredAh(nTargetMin) / nBatteryAh)) : 0;

  const rows = useMemo(() => {
    if (loadW <= 0 || nDc <= 0) return [];
    return BATTERY_RATINGS.map((ah) => ({
      ah,
      backupMin: calcBackupMin(ah),
      overLimit: validateCharger && maxAllowedAh != null && ah > maxAllowedAh,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadW, nDc, nEff, strings, validateCharger, maxAllowedAh, includeCharger, effectiveDc]);

  if (validateCharger && !nCharger) warnings.push("Enter Charger Current to validate battery AH.");
  if (validateCharger && maxAllowedAh != null && nBatteryAh > maxAllowedAh) {
    warnings.push(`Battery AH exceeds recommended limit for selected charger (max ${maxAllowedAh} Ah).`);
  }

  const suggestions: string[] = [];
  if (nTargetMin > 0 && loadW > 0) {
    const reqAh = calcRequiredAh(nTargetMin);
    if (reqAh > 0) {
      const nearest = BATTERY_RATINGS.find((r) => r >= reqAh) ?? BATTERY_RATINGS[BATTERY_RATINGS.length - 1];
      suggestions.push(`Required AH for ${nTargetMin} min target: ${reqAh.toFixed(1)} Ah — nearest standard rating: ${nearest} Ah.`);
      if (validateCharger && maxAllowedAh != null && reqAh > maxAllowedAh) {
        const neededCharger = Math.ceil(reqAh / 12.5);
        suggestions.push(`Increase charger to ≥ ${neededCharger} A to support ${reqAh.toFixed(1)} Ah battery.`);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calculator className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight uppercase">Dynamic UPS Backup Engine</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">Inputs</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">KVA</Label>
              <Input type="number" value={kva} onChange={(e) => setKva(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">DC BUS Voltage</Label>
              <Input type="number" value={dcBus} onChange={(e) => setDcBus(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Inverter Efficiency</Label>
              <Input type="number" step="0.01" value={efficiency} onChange={(e) => setEfficiency(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Power Factor</Label>
              <Input type="number" step="0.01" value={pf} onChange={(e) => setPf(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Battery AH (per unit)</Label>
              <Input type="number" value={batteryAh} onChange={(e) => setBatteryAh(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Target Backup (minutes)</Label>
              <Input type="number" step="1" value={targetBackupMin} onChange={(e) => setTargetBackupMin(e.target.value)} />
            </div>

            <div className="col-span-2 md:col-span-4 flex items-center justify-between rounded border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Include Charger Effect</span>
              </div>
              <Switch checked={includeCharger} onCheckedChange={setIncludeCharger} />
            </div>
            {includeCharger && (
              <div className="col-span-2 md:col-span-2">
                <Label className="text-xs">Charger Amp</Label>
                <Input type="number" value={chargerAmp} onChange={(e) => setChargerAmp(e.target.value)} />
              </div>
            )}

            <div className="col-span-2 md:col-span-4 flex items-center justify-between rounded border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Charger Impact Validation</span>
              </div>
              <Switch checked={validateCharger} onCheckedChange={setValidateCharger} />
            </div>
            {validateCharger && (
              <>
                {!includeCharger && (
                  <div className="col-span-2 md:col-span-2">
                    <Label className="text-xs">Charger Amp</Label>
                    <Input type="number" value={chargerAmp} onChange={(e) => setChargerAmp(e.target.value)} />
                  </div>
                )}
                <div className="col-span-2 md:col-span-2 flex items-center justify-between rounded border bg-background px-3 py-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Strict Mode</div>
                    <div className="text-xs">Block invalid selections</div>
                  </div>
                  <Switch checked={strictMode} onCheckedChange={setStrictMode} />
                </div>
                {nCharger > 0 && maxAllowedAh != null && (
                  <div className="col-span-2 md:col-span-4 text-xs text-muted-foreground">
                    Max Battery AH allowed for {nCharger} A charger: <span className="font-bold text-foreground">{maxAllowedAh} Ah</span>
                    {limits.some((l) => l.charger_current === nCharger) ? " (from master)" : " (rule: Charger × 12.5)"}
                  </div>
                )}
              </>
            )}

            <div className="col-span-2 md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 text-sm">
              <Stat label="VA" value={va.toLocaleString()} />
              <Stat label="Load (W)" value={loadW.toFixed(0)} />
              <Stat label="DC Current (A)" value={dcCurrent.toFixed(2)} />
              <Stat label="Strings (Series)" value={String(strings)} highlight />
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <SummaryRow label="Load (W)" value={loadW.toFixed(0)} />
            <SummaryRow label="Batteries / String" value={String(strings)} />
            <SummaryRow label="Total Batteries" value={String(strings * (parallel || 1))} />
            <SummaryRow label="Actual Backup" value={fmtMinutes(actualBackupMin)} />
          </CardContent>
        </Card>
      </div>

      {errors.length > 0 && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {errors.join(" • ")}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {warnings.join(" • ")}
        </div>
      )}
      {suggestions.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" /> Smart Suggestions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                <span>{s}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">Dynamic Backup Table (per Battery AH)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/60 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2 border-b font-bold">Battery (Ah)</th>
                  <th className="text-right px-3 py-2 border-b font-bold">Backup Time (min)</th>
                  <th className="text-right px-3 py-2 border-b font-bold">Total Batteries</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={3} className="text-center py-6 text-muted-foreground">Enter KVA and DC BUS Voltage to see results.</td></tr>
                )}
                {rows.map((r) => {
                  const bad = r.overLimit;
                  const blocked = bad && strictMode;
                  return (
                    <tr key={r.ah} className={`border-b hover:bg-muted/30 ${bad ? "bg-amber-500/5" : ""} ${blocked ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 font-medium">{r.ah} Ah</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{blocked ? "—" : fmtMinutes(r.backupMin)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{blocked ? "—" : strings}</td>
                    </tr>
                  );
                })}
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-primary/20 pb-1 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}
