import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { IndianRupee } from "lucide-react";
import { toast } from "sonner";
import { StatCard } from "@/components/crm/StatCard";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { istDateKey } from "@/lib/time";
import { rateInForce, validateRateAppend, type AdminEngineer, type AdminRate } from "@/lib/engineersAdmin";
import { reportDbError } from "@/lib/format-error";
import { backfillEngineerRates, upsertEngineerRate } from "@/lib/engineer-admin.functions";

type RateRow = AdminRate & { effective_from: string; rate_per_km: number | string };

const TIMELINE_COLUMNS: ColumnDef<RateRow>[] = [
  { key: "effective_from", header: "Effective from", sortable: true },
  {
    key: "rate_per_km",
    header: "Rate / km",
    align: "right",
    sortable: true,
    render: (row) => <span className="tabular-nums">₹{Number(row.rate_per_km)}/km</span>,
  },
];

export function RateEditor({
  engineers,
  selectedEmployeeId,
  onSelectEmployee,
  rates,
  isLoading,
  onSaved,
}: {
  engineers: AdminEngineer[];
  selectedEmployeeId: string | null;
  onSelectEmployee: (id: string) => void;
  rates: AdminRate[];
  isLoading: boolean;
  onSaved: () => void;
}) {
  const callAppend = useServerFn(upsertEngineerRate);
  const callBackfill = useServerFn(backfillEngineerRates);

  const today = istDateKey();
  const selected = engineers.find((e) => e.employee_id === selectedEmployeeId) ?? null;
  const todayRate = selectedEmployeeId ? rateInForce(rates, selectedEmployeeId, today) : null;

  const timeline = useMemo<RateRow[]>(
    () =>
      [...rates]
        .filter((r) => typeof r.effective_from === "string")
        .sort((a, b) => (b.effective_from as string < (a.effective_from as string) ? -1 : 1))
        .map((r) => ({
          ...r,
          effective_from: (r.effective_from as string).slice(0, 10),
          rate_per_km: r.rate_per_km as number | string,
        })),
    [rates],
  );

  const [appendRate, setAppendRate] = useState("");
  const [appendDate, setAppendDate] = useState(today);
  const [appendNotes, setAppendNotes] = useState("");
  const [appending, setAppending] = useState(false);

  const [backfillRate, setBackfillRate] = useState("");
  const [backfillFrom, setBackfillFrom] = useState("");
  const [backfillTo, setBackfillTo] = useState("");
  const [backfillOpen, setBackfillOpen] = useState(false);

  async function handleAppend() {
    if (!selectedEmployeeId) {
      toast.error("Select an engineer first.");
      return;
    }
    const rate = Number(appendRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error("Rate must be a positive number.");
      return;
    }
    const day = appendDate.slice(0, 10);
    const check = validateRateAppend(rates, selectedEmployeeId, day);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    try {
      setAppending(true);
      await callAppend({
        data: {
          employee_id: selectedEmployeeId,
          rate_per_km: Math.round(rate * 100) / 100,
          effective_from: day,
          ...(appendNotes.trim() ? { notes: appendNotes.trim() } : {}),
        },
      });
      toast.success(`Rate ₹${rate}/km in force from ${day}.`);
      setAppendRate("");
      setAppendNotes("");
      onSaved();
    } catch (e) {
      toast.error(reportDbError("rate append", e, "Could not save rate"));
    } finally {
      setAppending(false);
    }
  }

  async function handleBackfill() {
    const rate = Number(backfillRate);
    await callBackfill({
      data: {
        employee_id: selectedEmployeeId as string,
        rate_per_km: Math.round(rate * 100) / 100,
        from: backfillFrom.slice(0, 10),
        to: backfillTo.slice(0, 10),
      },
    });
    onSaved();
    setBackfillOpen(false);
  }

  function openBackfill() {
    if (!selectedEmployeeId) {
      toast.error("Select an engineer first.");
      return;
    }
    const rate = Number(backfillRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error("Backfill rate must be a positive number.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(backfillFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(backfillTo)) {
      toast.error("Backfill needs a start and end date.");
      return;
    }
    if (backfillFrom > backfillTo) {
      toast.error("Backfill start must be on or before end.");
      return;
    }
    setBackfillOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_320px]">
        <div className="space-y-1.5">
          <Label htmlFor="rate-engineer">Engineer</Label>
          <Select
            value={selectedEmployeeId ?? ""}
            onValueChange={onSelectEmployee}
          >
            <SelectTrigger id="rate-engineer" className="max-w-md">
              <SelectValue placeholder="Select an engineer" />
            </SelectTrigger>
            <SelectContent>
              {engineers.map((e) => (
                <SelectItem key={e.employee_id} value={e.employee_id}>
                  {e.name ?? e.employee_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <StatCard
          label="Rate in force today"
          value={todayRate !== null ? `₹${todayRate}/km` : "No rate"}
          icon={IndianRupee}
          tone={todayRate !== null ? "success" : "warning"}
          hint={selected ? `${selected.name ?? selected.employee_id} · ${today}` : today}
          loading={isLoading}
        />
      </div>

      <DataTable
        columns={TIMELINE_COLUMNS}
        data={timeline}
        isLoading={isLoading}
        rowKey={(row) => `${row.effective_from}`}
        emptyIcon={IndianRupee}
        emptyTitle="No rates yet"
        emptyHint="Append the first rate below — history is append-only."
      />

      <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Append rate</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="append-rate">Rate / km (₹)</Label>
              <Input
                id="append-rate"
                inputMode="decimal"
                placeholder="e.g. 7.5"
                value={appendRate}
                onChange={(e) => setAppendRate(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="append-date">Effective from</Label>
              <Input
                id="append-date"
                type="date"
                value={appendDate}
                max={today}
                onChange={(e) => setAppendDate(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="append-notes">Notes (optional)</Label>
            <Input
              id="append-notes"
              placeholder="Reason for change"
              value={appendNotes}
              maxLength={500}
              onChange={(e) => setAppendNotes(e.target.value)}
            />
          </div>
          <Button onClick={handleAppend} disabled={appending || !selectedEmployeeId}>
            {appending ? "Appending…" : "Append rate"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Append-only: existing rows are never edited. One rate per day.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Bulk backfill</h2>
          <div className="space-y-1.5">
            <Label htmlFor="backfill-rate">Rate / km (₹)</Label>
            <Input
              id="backfill-rate"
              inputMode="decimal"
              placeholder="e.g. 7.5"
              value={backfillRate}
              onChange={(e) => setBackfillRate(e.target.value)}
              className="max-w-40 tabular-nums"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="backfill-from">From</Label>
              <Input
                id="backfill-from"
                type="date"
                value={backfillFrom}
                max={today}
                onChange={(e) => setBackfillFrom(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="backfill-to">To</Label>
              <Input
                id="backfill-to"
                type="date"
                value={backfillTo}
                max={today}
                onChange={(e) => setBackfillTo(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>
          <Button variant="secondary" onClick={openBackfill} disabled={!selectedEmployeeId}>
            Review backfill…
          </Button>
          <p className="text-xs text-muted-foreground">
            Fills every missing day in range. Days with a rate are skipped, never overwritten.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
        title="Confirm bulk backfill"
        description={
          selected
            ? `Insert ₹${backfillRate}/km for every missing day from ${backfillFrom} to ${backfillTo} for ${selected.name ?? selected.employee_id}? Days that already have a rate are skipped. This cannot be undone — rates are append-only.`
            : undefined
        }
        confirmLabel="Backfill rates"
        onConfirm={handleBackfill}
      />
    </div>
  );
}
