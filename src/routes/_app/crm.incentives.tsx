import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { type IncentiveRule, type Incentive, fmtMoney, fmtDate, computeIncentive } from "@/lib/crm";
import { ExportButtons } from "@/components/ExportButtons";

export const Route = createFileRoute("/_app/crm/incentives")({ component: IncentivesPage });

function IncentivesPage() {
  const [rules, setRules] = useState<IncentiveRule[]>([]);
  const [payouts, setPayouts] = useState<Incentive[]>([]);
  const [preview, setPreview] = useState<string>("1000000");

  const load = async () => {
    const [r, p] = await Promise.all([
      supabase.from("incentive_rules").select("*").order("sort_order"),
      supabase.from("incentives").select("*").order("created_at", { ascending: false }),
    ]);
    setRules((r.data || []) as unknown as IncentiveRule[]);
    setPayouts((p.data || []) as unknown as Incentive[]);
  };
  useEffect(() => { load(); }, []);

  const setRule = (i: number, patch: Partial<IncentiveRule>) => {
    const next = [...rules]; next[i] = { ...next[i], ...patch }; setRules(next);
  };
  const addRule = () => setRules([...rules, { id: crypto.randomUUID(), label: "New tier", min_value: 0, max_value: null, percent: 0, active: true, sort_order: rules.length + 1 } as IncentiveRule]);
  const delRule = async (id: string) => {
    if (!confirm("Delete this tier?")) return;
    await supabase.from("incentive_rules").delete().eq("id", id);
    load();
  };

  const saveRules = async () => {
    for (const r of rules) {
      const payload = { label: r.label, min_value: Number(r.min_value || 0), max_value: r.max_value === null || (r.max_value as any) === "" ? null : Number(r.max_value), percent: Number(r.percent || 0), active: r.active, sort_order: Number(r.sort_order || 0) };
      // upsert by id
      const { error } = await supabase.from("incentive_rules").upsert({ id: r.id, ...payload } as any);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Rules saved"); load();
  };

  const markPaid = async (id: string) => {
    await supabase.from("incentives").update({ status: "paid", paid_at: new Date().toISOString().slice(0, 10) } as any).eq("id", id);
    toast.success("Marked paid"); load();
  };

  const previewCalc = useMemo(() => computeIncentive(rules, Number(preview || 0)), [rules, preview]);
  const totals = useMemo(() => ({
    pending: payouts.filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.payout || 0), 0),
    paid: payouts.filter((p) => p.status === "paid").reduce((s, p) => s + Number(p.payout || 0), 0),
  }), [payouts]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Incentive tiers (marginal slabs)</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addRule}><Plus className="h-4 w-4 mr-1" />Add tier</Button>
            <Button size="sm" onClick={saveRules}><Save className="h-4 w-4 mr-1" />Save</Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Marginal slab model: each tier's % applies only to the portion of closed value within its band (industry-standard B2B tiered commission).</p>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Label</TableHead><TableHead>Min ₹</TableHead><TableHead>Max ₹ (blank = ∞)</TableHead>
              <TableHead>%</TableHead><TableHead>Active</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rules.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell><Input value={r.label} onChange={(e) => setRule(i, { label: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" value={r.min_value} onChange={(e) => setRule(i, { min_value: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" value={r.max_value ?? ""} onChange={(e) => setRule(i, { max_value: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.1" value={r.percent} onChange={(e) => setRule(i, { percent: Number(e.target.value) })} /></TableCell>
                  <TableCell><input type="checkbox" checked={r.active} onChange={(e) => setRule(i, { active: e.target.checked })} /></TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => delRule(r.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-end gap-3 border-t pt-3">
            <div><Label>Preview closed value</Label><Input type="number" value={preview} onChange={(e) => setPreview(e.target.value)} className="w-40" /></div>
            <div className="text-sm">→ Payout: <span className="font-bold text-green-700">{fmtMoney(previewCalc.payout)}</span> · Effective rate: {previewCalc.applied_percent.toFixed(2)}%</div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Pending payout</div><div className="text-2xl font-bold">{fmtMoney(totals.pending)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Paid to date</div><div className="text-2xl font-bold text-green-700">{fmtMoney(totals.paid)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Payout records</CardTitle>
          <ExportButtons
            name="Prokon_Incentives"
            title="Incentive Payouts"
            rows={payouts}
            columns={[
              { header: "Period", get: (p) => p.period || "" },
              { header: "Closed Value", get: (p) => Number(p.closed_value || 0) },
              { header: "Applied %", get: (p) => Number(p.applied_percent || 0) },
              { header: "Payout", get: (p) => Number(p.payout || 0) },
              { header: "Status", get: (p) => p.status },
              { header: "Paid On", get: (p) => p.paid_at || "" },
              { header: "Notes", get: (p) => p.notes || "" },
            ]}
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Period</TableHead><TableHead>Closed value</TableHead><TableHead>Applied %</TableHead>
              <TableHead>Payout</TableHead><TableHead>Status</TableHead><TableHead>Paid on</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {payouts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.period || "—"}</TableCell>
                  <TableCell>{fmtMoney(p.closed_value)}</TableCell>
                  <TableCell>{Number(p.applied_percent).toFixed(2)}%</TableCell>
                  <TableCell className="font-semibold">{fmtMoney(p.payout)}</TableCell>
                  <TableCell><Badge variant={p.status === "paid" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                  <TableCell>{fmtDate(p.paid_at)}</TableCell>
                  <TableCell>{p.status === "pending" && <Button size="sm" variant="outline" onClick={() => markPaid(p.id)}><CheckCircle2 className="h-4 w-4 mr-1" />Paid</Button>}</TableCell>
                </TableRow>
              ))}
              {payouts.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No payouts. Mark a lead "Won" to create one.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}