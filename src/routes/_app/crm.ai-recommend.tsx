import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Calculator, Zap, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/crm/ai-recommend")({
  component: UpsBackupCalculatorPage,
  head: () => ({
    meta: [
      { title: "UPS Backup Calculator — Prokon" },
      { name: "description", content: "Online UPS backup formula and battery sizing calculator." },
    ],
  }),
});

const BATTERY_RATINGS = [7, 9, 12, 26, 42, 65, 76, 80, 100, 120, 150, 200];
const BACKUP_ROWS: { label: string; hours: number }[] = [
  { label: "15 Minutes", hours: 0.25 },
  { label: "30 Minutes", hours: 0.5 },
  { label: "1 Hour", hours: 1 },
  { label: "2 Hours", hours: 2 },
  { label: "3 Hours", hours: 3 },
  { label: "4 Hours", hours: 4 },
  { label: "5 Hours", hours: 5 },
  { label: "6 Hours", hours: 6 },
  { label: "7 Hours", hours: 7 },
  { label: "8 Hours", hours: 8 },
  { label: "9 Hours", hours: 9 },
  { label: "10 Hours", hours: 10 },
];

function pickBattery(ah: number): number {
  for (const r of BATTERY_RATINGS) if (r >= ah) return r;
  return BATTERY_RATINGS[BATTERY_RATINGS.length - 1];
}

type ChargerLimit = { charger_current: number; max_battery_ah: number };

function lookupMaxAh(limits: ChargerLimit[], chargerA: number): number | null {
  if (!chargerA) return null;
  const match = limits.find((l) => Number(l.charger_current) === chargerA);
  if (match) return Number(match.max_battery_ah);
  return chargerA * 12.5;
}

function UpsBackupCalculatorPage() {
  const [kva, setKva] = useState<string>("10");
  const [dcBus, setDcBus] = useState<string>("192");
  const [efficiency, setEfficiency] = useState<string>("0.9");
  const [pf, setPf] = useState<string>("0.9");
  const [includeCharger, setIncludeCharger] = useState(false);
  const [chargerAmp, setChargerAmp] = useState<string>("0");
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

  const va = nKva * 1000;
  const loadW = nKva * 1000 * nPf;
  const chargerPower = includeCharger ? nCharger * nDc : 0;
  const adjustedLoad = Math.max(0, loadW - chargerPower);
  const dcCurrent = nDc > 0 && nEff > 0 ? adjustedLoad / (nDc * nEff) : 0;
  const seriesBatteries = nDc > 0 ? nDc / 12 : 0;

  const errors: string[] = [];
  const warnings: string[] = [];
  if (!nKva) errors.push("KVA is required");
  if (!nDc) errors.push("DC BUS Voltage is required");
  if (nDc > 0 && nDc % 12 !== 0) warnings.push("DC BUS Voltage is not divisible by 12");

  const rows = useMemo(() => {
    if (!dcCurrent || !seriesBatteries) return [];
    return BACKUP_ROWS.map((r) => {
      const ah = dcCurrent * r.hours;
      const finalAh = ah * 1.25;
      const battery = pickBattery(finalAh);
      const parallel = Math.ceil(finalAh / battery);
      const total = Math.ceil(seriesBatteries) * parallel;
      return { ...r, ah, finalAh, battery, parallel, total };
    });
  }, [dcCurrent, seriesBatteries]);

  const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0);
  if (maxTotal > 300) warnings.push("Large battery bank – consider alternative solution");

  const maxAllowedAh = validateCharger ? lookupMaxAh(limits, nCharger) : null;
  const invalidRows = useMemo(() => {
    if (!validateCharger || !maxAllowedAh) return new Set<string>();
    return new Set(rows.filter((r) => r.battery > maxAllowedAh).map((r) => r.label));
  }, [rows, maxAllowedAh, validateCharger]);
  if (validateCharger && !nCharger) warnings.push("Enter Charger Current to validate battery AH.");
  if (validateCharger && invalidRows.size > 0) {
    warnings.push(`Battery AH exceeds recommended limit for selected charger (max ${maxAllowedAh} Ah).`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Calculator className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight uppercase">Online UPS Backup Formula</h1>
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

            <div className="col-span-2 md:col-span-4 grid grid-cols-2 md:grid-cols-3 gap-2 pt-2 text-sm">
              <Stat label="VA" value={va.toLocaleString()} />
              <Stat label="Load (W)" value={loadW.toFixed(0)} />
              <Stat label="DC Discharge Current per Hour" value={`${dcCurrent.toFixed(2)} A`} highlight />
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <SummaryRow label="Load (W)" value={loadW.toFixed(0)} />
            <SummaryRow label="DC Current (A)" value={dcCurrent.toFixed(2)} />
            <SummaryRow label="Batteries per string" value={String(Math.ceil(seriesBatteries) || 0)} />
            <SummaryRow label="Max Total Batteries" value={String(maxTotal)} />
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">Backup Table</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/60 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2 border-b font-bold">Backup Time</th>
                  <th className="text-right px-3 py-2 border-b font-bold">Ah Required</th>
                  <th className="text-right px-3 py-2 border-b font-bold">Selected Battery (Ah)</th>
                  <th className="text-right px-3 py-2 border-b font-bold">Series</th>
                  <th className="text-right px-3 py-2 border-b font-bold">Parallel Strings</th>
                  <th className="text-right px-3 py-2 border-b font-bold">Total Batteries</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Enter KVA and DC BUS Voltage to see results.</td></tr>
                )}
                {rows.map((r) => (
                  {
                    const bad = invalidRows.has(r.label);
                    const blocked = bad && strictMode;
                    return (
                      <tr key={r.label} className={`border-b hover:bg-muted/30 ${bad ? "bg-amber-500/5" : ""} ${blocked ? "opacity-50" : ""}`}>
                        <td className="px-3 py-2 font-medium">{r.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.ah.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span className={bad ? "text-amber-700 dark:text-amber-400 font-semibold" : ""}>{r.battery} Ah</span>
                          {bad && <span className="ml-1 text-[10px] uppercase">{blocked ? "blocked" : "over limit"}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{Math.ceil(seriesBatteries)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{blocked ? "—" : r.parallel}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold">{blocked ? "—" : r.total}</td>
                      </tr>
                    );
                  }
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