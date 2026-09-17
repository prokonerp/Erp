import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { IndianRupee, Printer, ReceiptIndianRupee } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { adminEngKeys } from "@/lib/queryKeys";
import { markSettlementPaid } from "@/lib/engineer-settlement.functions";
import {
  useEngineerLedger,
  useEngineerPayables,
  useEngineerRoster,
} from "@/hooks/useEngineerAdmin";
import { payableForPeriod, type AdminEngineer } from "@/lib/engineersAdmin";
import { DateFilterBar } from "@/components/DateFilterBar";
import { ExportButtons } from "@/components/ExportButtons";
import { ControlledActionDialog } from "@/components/ControlledActionDialog";
import { SettlementSlipPrint } from "@/components/engineer/SettlementSlipPrint";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import type { ExportColumn } from "@/lib/exports";
import type { DateRange, RangeMode } from "@/lib/dateRange";
import { currentMonth, resolveRange } from "@/lib/dateRange";
import {
  DEFAULT_COMPANY_PROFILE,
  fetchCompanyProfile,
  type CompanyProfile,
} from "@/lib/companyProfile";

export const Route = createFileRoute("/_app/engineers/reconcile")({
  component: EngineerReconcilePage,
  head: () => ({ meta: [{ title: "Reconcile — Prokon" }] }),
});

type LedgerRow = {
  id: string;
  employee_id: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string | null;
  locked_at: string | null;
  paid_at: string | null;
  payment_ref: string | null;
  computed_amount: number | string | null;
  flat_expenses: number | string | null;
  adjusted_amount: number | string | null;
};

function num(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function netOf(r: LedgerRow): number {
  if (r.adjusted_amount != null && String(r.adjusted_amount).trim() !== "") {
    return num(r.adjusted_amount);
  }
  return Math.round((num(r.computed_amount) + num(r.flat_expenses)) * 100) / 100;
}

function isPaid(r: LedgerRow): boolean {
  return typeof r.paid_at === "string" ? r.paid_at.trim() !== "" : r.paid_at != null;
}

function statusTone(r: LedgerRow): { tone: StatusTone; label: string } {
  if (isPaid(r)) return { tone: "success", label: "Paid" };
  if (r.status === "Approved") return { tone: "info", label: "Approved" };
  if (r.status === "Rejected") return { tone: "danger", label: "Rejected" };
  return { tone: "warning", label: r.status ?? "Pending" };
}

/** Cross-engineer settlement ledger: payslip print + mark-paid per row. */
function EngineerReconcilePage() {
  const queryClient = useQueryClient();
  const callMarkPaid = useServerFn(markSettlementPaid);
  const [mode, setMode] = useState<RangeMode>("month");
  const [range, setRange] = useState<DateRange>(() => currentMonth());
  const [slipId, setSlipId] = useState<string | null>(null);
  const [payDialog, setPayDialog] = useState<LedgerRow | null>(null);
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);

  useEffect(() => {
    fetchCompanyProfile().then(setCompany).catch(() => {});
  }, []);

  const effective = resolveRange(mode, range);
  const ledger = useEngineerLedger({ from: effective.from, to: effective.to });
  const { roster, warnings: rosterWarnings } = useEngineerRoster();
  const names = useMemo(() => {
    const m = new Map<string, AdminEngineer>();
    for (const e of roster) m.set(e.employee_id, e);
    return m;
  }, [roster]);

  // Full settlement rows for the window (amounts + paid columns the
  // useEngineerLedger spine doesn't select). Fail-soft: errors warn.
  const { data: ledgerData, refetch: refetchRows } = useQuery({
    queryKey: [...adminEngKeys.ledger(ledger.window.from, ledger.window.to), "reconcile"],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<{ rows: LedgerRow[]; warning: string | null }> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- money tables pending generated types
        const { data, error } = await (supabase as any)
          .from("engineer_conveyance_settlements")
          .select(
            "id, employee_id, period_start, period_end, status, locked_at, paid_at, payment_ref, computed_amount, flat_expenses, adjusted_amount",
          )
          .lte("period_start", ledger.window.to)
          .gte("period_end", ledger.window.from)
          .order("period_start", { ascending: false });
        if (error) throw error;
        return { rows: Array.isArray(data) ? (data as LedgerRow[]) : [], warning: null };
      } catch (e) {
        return { rows: [], warning: (e as { message?: string })?.message ?? "failed" };
      }
    },
  });
  const rows = ledgerData?.rows ?? [];
  const rowsWarning = ledgerData?.warning ?? null;

  const slipRow = rows.find((r) => r.id === slipId) ?? null;
  const slipEmployee = (slipRow?.employee_id && names.get(slipRow.employee_id)) ?? null;
  const slipPayables = useEngineerPayables({
    employeeId: slipRow?.employee_id ?? null,
    from: (slipRow?.period_start ?? "").slice(0, 10) || ledger.window.from,
    to: (slipRow?.period_end ?? "").slice(0, 10) || ledger.window.to,
  });
  const slipPerDay = useMemo(
    () =>
      payableForPeriod({
        employeeId: slipRow?.employee_id ?? null,
        rates: slipPayables.rates,
        days: slipPayables.days,
        expenses: slipPayables.expenses,
      }).perDay,
    [slipRow?.employee_id, slipPayables.rates, slipPayables.days, slipPayables.expenses],
  );
  const slipReady = !!slipRow && !!slipEmployee && !slipPayables.isLoading;

  function handleChanged() {
    void queryClient.invalidateQueries({ queryKey: adminEngKeys.settlementsPrefix });
    void queryClient.invalidateQueries({
      queryKey: adminEngKeys.ledger(ledger.window.from, ledger.window.to),
    });
    void ledger.refetch();
    void refetchRows();
  }

  async function confirmMarkPaid({ reason }: { reason: string }) {
    if (!payDialog) return { error: "Select a settlement first." };
    try {
      await callMarkPaid({
        data: { settlement_id: payDialog.id, payment_ref: reason },
      });
      toast.success(`Marked paid — ${reason}.`);
      setPayDialog(null);
      handleChanged();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Mark paid failed.";
      toast.error(message);
      return { error: message };
    }
  }

  const columns: ColumnDef<LedgerRow>[] = [
    {
      key: "period",
      header: "Period",
      sortable: true,
      render: (r) => (
        <span className="font-mono text-xs">
          {(r.period_start ?? "—").slice(0, 10)} → {(r.period_end ?? "—").slice(0, 10)}
        </span>
      ),
    },
    {
      key: "engineer",
      header: "Engineer",
      render: (r) => (
        <span className="text-sm">
          {names.get(r.employee_id ?? "")?.name ?? r.employee_id ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const s = statusTone(r);
        return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
      },
    },
    {
      key: "net",
      header: "Net",
      align: "right",
      render: (r) => (
        <span className="tabular-nums">₹{netOf(r).toLocaleString("en-IN")}</span>
      ),
    },
    {
      key: "payment",
      header: "Payment ref",
      render: (r) =>
        r.payment_ref && r.payment_ref.trim() !== "" ? (
          <span className="font-mono text-xs">{r.payment_ref}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "_actions",
      header: "Actions",
      align: "right",
      render: (r) => (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSlipId(r.id)}
            title={`Payslip ${r.id.slice(0, 8)}`}
          >
            <Printer className="h-4 w-4 mr-1" />Slip
          </Button>
          {!isPaid(r) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSlipId(r.id);
                setPayDialog(r);
              }}
              title={`Mark paid ${r.id.slice(0, 8)}`}
            >
              <IndianRupee className="h-4 w-4 mr-1" />Mark paid
            </Button>
          )}
        </span>
      ),
    },
  ];

  const exportCols: ExportColumn<LedgerRow>[] = [
    { header: "Period start", get: (r) => (r.period_start ?? "").slice(0, 10) },
    { header: "Period end", get: (r) => (r.period_end ?? "").slice(0, 10) },
    { header: "Engineer", get: (r) => names.get(r.employee_id ?? "")?.name ?? r.employee_id ?? "" },
    { header: "Status", get: (r) => statusTone(r).label },
    { header: "Computed", get: (r) => num(r.computed_amount) },
    { header: "Flat", get: (r) => num(r.flat_expenses) },
    { header: "Net", get: (r) => netOf(r) },
    { header: "Payment ref", get: (r) => r.payment_ref ?? "" },
    { header: "Paid at", get: (r) => (r.paid_at ?? "").slice(0, 10) },
  ];

  const allWarnings = [
    ...rosterWarnings.map((w) => `Roster: ${w.message}`),
    ...ledger.warnings.map((w) => `${w.section}: ${w.message}`),
    ...(rowsWarning ? [`settlements: ${rowsWarning}`] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reconcile"
        description="Settlement ledger — payslip per period, mark paid with a payment reference."
        crumbs={[{ label: "Engineers", to: "/engineers" }, { label: "Reconcile" }]}
        actions={
          <>
            <ExportButtons
              name={`Reconcile_${ledger.window.from}_${ledger.window.to}`}
              title={`Settlement ledger ${ledger.window.from} → ${ledger.window.to}`}
              rows={rows}
              columns={exportCols}
            />
            <Button variant="outline" size="sm" disabled={!slipReady} onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" />Print A4
            </Button>
          </>
        }
      />

      {allWarnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          {allWarnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      <DateFilterBar mode={mode} setMode={setMode} range={range} setRange={setRange} />

      <DataTable
        columns={columns}
        data={rows}
        isLoading={ledger.isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSlipId(r.id)}
        emptyIcon={ReceiptIndianRupee}
        emptyTitle="No settlements"
        emptyHint="No settlement periods overlap this window — save one from Payable & Expenses first."
      />

      {slipRow && slipEmployee ? (
        <p className="text-xs text-muted-foreground">
          Slip selected:{" "}
          <span className="font-mono">
            {(slipRow.period_start ?? "").slice(0, 10)} → {(slipRow.period_end ?? "").slice(0, 10)}
          </span>{" "}
          · {slipEmployee.name ?? slipRow.employee_id} ·{" "}
          <span className="tabular-nums">₹{netOf(slipRow).toLocaleString("en-IN")}</span>
          {slipPayables.isLoading ? " — loading days…" : " — Print A4 to print."}
        </p>
      ) : (
        <EmptyState
          icon={ReceiptIndianRupee}
          title="No payslip selected"
          hint="Select a settlement row above to preview its payslip, print it, or mark it paid."
        />
      )}

      {/* A4 payslip — visible only in print (mirrors po.$id print shell). */}
      <div className="hidden print:block" aria-hidden="true">
        {slipReady && slipRow && slipEmployee && (
          <SettlementSlipPrint
            employee={slipEmployee}
            company={company}
            settlement={{
              period_start: slipRow.period_start,
              period_end: slipRow.period_end,
              status: isPaid(slipRow) ? "Paid" : (slipRow.status ?? "Pending"),
              computed_amount: slipRow.computed_amount,
              flat_expenses: slipRow.flat_expenses,
              adjusted_amount: slipRow.adjusted_amount,
              payment_ref: slipRow.payment_ref,
              paid_at: slipRow.paid_at,
            }}
            perDay={slipPerDay}
          />
        )}
      </div>

      <ControlledActionDialog
        open={payDialog !== null}
        onOpenChange={(v) => {
          if (!v) setPayDialog(null);
        }}
        title="Mark settlement paid"
        description={
          payDialog
            ? `Record payment for ${(payDialog.period_start ?? "").slice(0, 10)} → ${(payDialog.period_end ?? "").slice(0, 10)} · ₹${netOf(payDialog).toLocaleString("en-IN")}.`
            : undefined
        }
        reasonPlaceholder="UTR / txn ref…"
        confirmLabel="Mark paid"
        onConfirm={confirmMarkPaid}
      />
    </div>
  );
}
