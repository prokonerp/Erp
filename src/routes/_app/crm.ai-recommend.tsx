import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_app/crm/ai-recommend")({
  component: UpsBackupCalculatorPage,
  head: () => ({
    meta: [
      { title: "UPS Backup Time Calculator — Prokon" },
      { name: "description", content: "Calculate UPS backup time for predefined battery sizes." },
    ],
  }),
});

const BATTERY_RATINGS = [7, 12, 26, 42, 65, 100, 150, 200];
const UTILIZATION_FACTOR = 0.45;

type Row = {
  ah: number;
  backupMin: number;
  backupHours: number;
  recommended: boolean;
};

function UpsBackupCalculatorPage() {
  const [kva, setKva] = useState("10");
  const [pf, setPf] = useState("0.9");
  const [dcBus, setDcBus] = useState("192");
  const [efficiency, setEfficiency] = useState("0.9");
  const [requiredMin, setRequiredMin] = useState("");

  const nKva = parseFloat(kva) || 0;
  const nPf = parseFloat(pf) || 0;
  const nDc = parseFloat(dcBus) || 0;
  const nEff = parseFloat(efficiency) || 0;
  const nRequiredMin = parseFloat(requiredMin) || 0;

  const loadW = nKva * 1000 * nPf;

  const rows: Row[] = useMemo(() => {
    if (loadW <= 0 || nDc <= 0 || nEff <= 0) return [];

    const calculated = BATTERY_RATINGS.map((ah) => {
      const backupMin = (ah * UTILIZATION_FACTOR * nDc * nEff * 60) / loadW;
      return {
        ah,
        backupMin: Math.round(backupMin),
        backupHours: backupMin / 60,
      };
    });

    let recommendedAh: number | null = null;
    if (nRequiredMin > 0) {
      const match = calculated.find((r) => r.backupMin >= nRequiredMin);
      if (match) recommendedAh = match.ah;
    }

    return calculated.map((r) => ({
      ...r,
      recommended: r.ah === recommendedAh,
    }));
  }, [loadW, nDc, nEff, nRequiredMin]);

  const errors: string[] = [];
  if (!nKva) errors.push("UPS Capacity (KVA) is required");
  if (!nDc) errors.push("DC Bus Voltage is required");
  if (nDc > 0 && nDc % 12 !== 0) errors.push("DC Bus Voltage should be a multiple of 12");

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
            <div className="col-span-2 md:col-span-4">
              <Label className="text-xs">Required Minimum Backup (minutes) — optional</Label>
              <Input type="number" step="1" value={requiredMin} onChange={(e) => setRequiredMin(e.target.value)} placeholder="e.g. 60" />
            </div>

            <div className="col-span-2 md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 text-sm">
              <Stat label="Load (W)" value={loadW > 0 ? loadW.toFixed(0) : "—"} />
              <Stat label="DC Bus (V)" value={nDc > 0 ? String(nDc) : "—"} />
              <Stat label="Efficiency" value={nEff > 0 ? nEff.toFixed(2) : "—"} />
              <Stat label="Utilization Factor" value={String(UTILIZATION_FACTOR)} highlight />
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
              Backup (min) = (AH × 0.45 × DC V × Eff × 60) / Load
            </div>
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
          <CardTitle className="text-sm font-semibold uppercase tracking-wide">Backup Time Table</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/60 text-xs uppercase tracking-wide">
                  <th className="text-left px-3 py-2 border-b font-bold">Battery AH</th>
                  <th className="text-right px-3 py-2 border-b font-bold">Backup Time (Minutes)</th>
                  <th className="text-right px-3 py-2 border-b font-bold">Backup Time (Hours)</th>
                  <th className="text-center px-3 py-2 border-b font-bold">Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-muted-foreground">
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
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {r.backupMin} min
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.backupHours.toFixed(2)} h
                    </td>
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
