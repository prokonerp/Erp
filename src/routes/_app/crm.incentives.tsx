import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Save, CheckCircle2, Trophy, Clock } from "lucide-react";
import { toast } from "sonner";
import { type IncentiveRule, type Incentive, fmtMoney, fmtDate, computeIncentive } from "@/lib/crm";
import { istTodayIso } from "@/lib/dateRange";
import { ExportButtons } from "@/components/ExportButtons";
import { useConfirm } from "@/hooks/useConfirm";
import { PageHeader } from "@/components/crm/PageHeader";
import { StatCard } from "@/components/crm/StatCard";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { PageLoader } from "@/components/shared/skeletons";

export const Route = createFileRoute("/_app/crm/incentives")({ component: IncentivesPage });

function IncentivesPage() {
  const confirm = useConfirm();
  const [rules, setRules] = useState<IncentiveRule[]>([]);
  const [payouts, setPayouts] = useState<Incentive[]>([]);
  const [preview, setPreview] = useState<string>("1000000");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [r, p] = await Promise.all([
      supabase.from("incentive_rules").select("*").order("sort_order"),
      supabase.from("incentives").select("*").order("created_at", { ascending: false }),
    ]);
    setRules((r.data || []) as unknown as IncentiveRule[]);
    setPayouts((p.data || []) as unknown as Incentive[]);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const setRule = (i: number, patch: Partial<IncentiveRule>) => {
    const next = [...rules];
    next[i] = { ...next[i], ...patch };
    setRules(next);
  };
  const addRule = () =>
    setRules([
      ...rules,
      {
        id: crypto.randomUUID(),
        label: "New tier",
        min_value: 0,
        max_value: null,
        percent: 0,
        active: true,
        sort_order: rules.length + 1,
      } as IncentiveRule,
    ]);
  const delRule = async (id: string) => {
    const ok = await confirm({
      title: "Delete this tier?",
      description: "Payouts already recorded are not affected.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("incentive_rules").delete().eq("id", id);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    load();
  };

  const saveRules = async () => {
    for (const r of rules) {
      const { error } = await supabase.from("incentive_rules").upsert({
        id: r.id,
        label: r.label,
        min_value: Number(r.min_value || 0),
        max_value: r.max_value == null ? null : Number(r.max_value),
        percent: Number(r.percent || 0),
        active: r.active,
        sort_order: Number(r.sort_order || 0),
      });
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    toast.success("Rules saved");
    load();
  };

  const markPaid = useCallback(async (id: string) => {
    await supabase
      .from("incentives")
      .update({ status: "paid", paid_at: istTodayIso() })
      .eq("id", id);
    toast.success("Marked paid");
    load();
  }, []);

  const previewCalc = useMemo(
    () => computeIncentive(rules, Number(preview || 0)),
    [rules, preview],
  );
  const totals = useMemo(
    () => ({
      pending: payouts
        .filter((p) => p.status === "pending")
        .reduce((s, p) => s + Number(p.payout || 0), 0),
      paid: payouts
        .filter((p) => p.status === "paid")
        .reduce((s, p) => s + Number(p.payout || 0), 0),
    }),
    [payouts],
  );

  const payoutColumns: ColumnDef<Incentive>[] = useMemo(
    () => [
      {
        key: "period",
        header: "Period",
        sortable: true,
        render: (p) => p.period || "—",
      },
      {
        key: "closed_value",
        header: "Closed value",
        sortable: true,
        align: "right",
        render: (p) => fmtMoney(p.closed_value),
      },
      {
        key: "applied_percent",
        header: "Applied %",
        sortable: true,
        align: "right",
        render: (p) => `${Number(p.applied_percent).toFixed(2)}%`,
      },
      {
        key: "payout",
        header: "Payout",
        sortable: true,
        align: "right",
        render: (p) => <span className="font-semibold tabular-nums">{fmtMoney(p.payout)}</span>,
      },
      {
        key: "status",
        header: "Status",
        sortable: true,
        render: (p) => <StatusBadge kind="payout" value={p.status} />,
      },
      {
        key: "paid_at",
        header: "Paid on",
        sortable: true,
        render: (p) => fmtDate(p.paid_at),
      },
      {
        key: "_action",
        header: "",
        align: "right",
        render: (p) =>
          p.status === "pending" ? (
            <Button size="sm" variant="outline" onClick={() => markPaid(p.id)}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Mark paid
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [markPaid],
  );

  if (loading) return <PageLoader label="Loading incentives…" />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Incentives"
        description="Configure marginal-slab commission tiers and track payouts."
        group="Customers (Sales & CRM)"
        icon={Trophy}
        primary={{ label: "Save Rules", onClick: saveRules, icon: Save }}
        secondary={[{ label: "Add Tier", onClick: addRule, icon: Plus, variant: "outline" }]}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatCard
          label="Pending payout"
          value={fmtMoney(totals.pending)}
          tone="warning"
          icon={Clock}
        />
        <StatCard
          label="Paid to date"
          value={fmtMoney(totals.paid)}
          tone="success"
          icon={CheckCircle2}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Incentive tiers (marginal slabs)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Marginal slab model: each tier's % applies only to the portion of closed value within
            its band (industry-standard B2B tiered commission).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left uppercase tracking-wide text-[11px] text-muted-foreground">
                  <th className="pb-2">Label</th>
                  <th className="pb-2">Min ₹</th>
                  <th className="pb-2">Max ₹ (blank = ∞)</th>
                  <th className="pb-2">%</th>
                  <th className="pb-2 text-center">Active</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0 align-top">
                    <td className="py-2 pr-2">
                      <Input
                        value={r.label}
                        onChange={(e) => setRule(i, { label: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        value={r.min_value}
                        onChange={(e) => setRule(i, { min_value: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        value={r.max_value ?? ""}
                        onChange={(e) =>
                          setRule(i, {
                            max_value: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        step="0.1"
                        value={r.percent}
                        onChange={(e) => setRule(i, { percent: Number(e.target.value) })}
                      />
                    </td>
                    <td className="py-2 pr-2 text-center">
                      <Switch
                        checked={r.active}
                        onCheckedChange={(v) => setRule(i, { active: v })}
                      />
                    </td>
                    <td className="py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => delRule(r.id)}
                        aria-label={`Delete tier ${r.label}`}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-end gap-3 border-t pt-3">
            <div>
              <Label>Preview closed value</Label>
              <Input
                type="number"
                value={preview}
                onChange={(e) => setPreview(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="text-sm">
              → Payout:{" "}
              <span className="font-bold text-green-700">{fmtMoney(previewCalc.payout)}</span> ·
              Effective rate: {previewCalc.applied_percent.toFixed(2)}%
            </div>
          </div>
        </CardContent>
      </Card>

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
          <DataTable
            columns={payoutColumns}
            data={payouts}
            isLoading={loading}
            rowKey="id"
            emptyIcon={Clock}
            emptyTitle="No payouts yet"
            emptyHint="Payouts are created when a lead is marked Won."
          />
        </CardContent>
      </Card>
    </div>
  );
}
