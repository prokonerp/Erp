import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Package, TriangleAlert, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/crm/StatCard";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { EngineerSelect } from "@/components/engineer/EngineerSelect";
import { CustodyLedgerTable } from "@/components/engineer/CustodyLedgerTable";
import { StagedPartsTable } from "@/components/engineer/StagedPartsTable";
import { useEngineerCustody, useEngineerRoster } from "@/hooks/useEngineerAdmin";
import type { CustodyLedgerRow } from "@/lib/engineersAdmin";
import { partitionOrphans, rosterNameMap } from "@/lib/engineersAdmin";

export const Route = createFileRoute("/_app/engineers/custody")({
  component: EngineerCustodyPage,
  head: () => ({ meta: [{ title: "Custody — Prokon" }] }),
});

/** Read-only custody ledger: parts checked out to engineers. Orphan rows
 *  (custodian_employee_id outside the roster) render under an
 *  "Unknown custodian" section — never dropped. */
function EngineerCustodyPage() {
  const rosterQuery = useEngineerRoster();
  const [engineerId, setEngineerId] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "good" | "defective">("all");

  const custodyQuery = useEngineerCustody(engineerId === "all" ? null : engineerId);

  const nameById = useMemo(
    () => rosterNameMap(rosterQuery.roster),
    [rosterQuery.roster],
  );

  const filtered = useMemo<CustodyLedgerRow[]>(() => {
    const out: CustodyLedgerRow[] = [];
    for (const row of custodyQuery.data) {
      if (!row) continue;
      if (engineerId !== "all" && row.custodian_employee_id !== engineerId) continue;
      out.push({
        ...row,
        custodian_name: row.custodian_name ?? (row.custodian_employee_id ? (nameById.get(row.custodian_employee_id) ?? row.custodian_name) : row.custodian_name),
      });
    }
    return out;
  }, [custodyQuery.data, engineerId, nameById]);

  const goodCount = useMemo(
    () => filtered.filter((r) => (r.stock_type ?? "").toLowerCase() === "good").length,
    [filtered],
  );
  const defectiveCount = useMemo(
    () => filtered.filter((r) => (r.stock_type ?? "").toLowerCase() === "defective").length,
    [filtered],
  );

  const typeFiltered = useMemo(
    () =>
      typeFilter === "all"
        ? filtered
        : filtered.filter((r) => (r.stock_type ?? "").toLowerCase() === typeFilter),
    [filtered, typeFilter],
  );

  // Orphans: custodian ids with no roster entry. Partitioned into their own
  // section below so they are counted and visible, never silently dropped.
  const { roster, orphans } = useMemo(
    () => partitionOrphans(typeFiltered, nameById, (r) => r.custodian_employee_id),
    [typeFiltered, nameById],
  );

  const engineersHolding = useMemo(() => {
    const ids = new Set<string>();
    for (const r of typeFiltered) {
      if (r.custodian_employee_id) ids.add(r.custodian_employee_id);
    }
    return ids.size;
  }, [typeFiltered]);

  const staged = custodyQuery.staged ?? [];
  const stagedFiltered = useMemo(
    () =>
      typeFilter === "all" ? staged : staged.filter((s) => s.kind === typeFilter),
    [staged, typeFilter],
  );

  const loading = rosterQuery.isLoading || custodyQuery.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Custody"
        description="Parts checked out to engineers — read-only ledger."
      />

      <AdminWarnings lists={[rosterQuery.warnings, custodyQuery.warnings]} />

      <div className="grid items-end gap-3 sm:grid-cols-[320px_1fr]">
        <EngineerSelect
          id="custody-engineer"
          value={engineerId}
          onChange={setEngineerId}
          engineers={rosterQuery.roster}
          allowAll
          allLabel="All engineers"
        />
        <div
          className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/40 p-1 sm:max-w-xs"
          role="tablist"
          aria-label="Custody type filter"
        >
          {(
            [
              { value: "all", label: "All" },
              { value: "good", label: "Good" },
              { value: "defective", label: "Defective" },
            ] as const
          ).map((v) => (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={typeFilter === v.value}
              onClick={() => setTypeFilter(v.value)}
              className={`min-h-[40px] rounded-lg text-sm font-medium ${
                typeFilter === v.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Items held"
          value={typeFiltered.length}
          icon={Package}
          loading={loading}
          hint="Matching this filter"
        />
        <StatCard
          label="Good pieces"
          value={goodCount}
          icon={CheckCircle2}
          loading={loading}
          hint="Ready to install"
        />
        <StatCard
          label="Defective pieces"
          value={defectiveCount}
          icon={AlertCircle}
          tone={defectiveCount > 0 ? "warning" : "default"}
          loading={loading}
          hint="Awaiting GRN / OEM"
        />
        <StatCard
          label="Engineers holding"
          value={engineersHolding}
          icon={Users}
          loading={loading}
          hint="Distinct custodians"
        />
        <StatCard
          label="Unknown custodian"
          value={orphans.length}
          icon={TriangleAlert}
          tone={orphans.length > 0 ? "warning" : "default"}
          loading={loading}
          hint="Outside the roster"
        />
      </div>

      <section aria-label="Staged in tickets" className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          Staged in tickets
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {stagedFiltered.length}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Open-ticket lines not yet in custody — confirm them on the ticket. A confirmed line
          moves up once its serial matches a stock row.
        </p>
        <StagedPartsTable
          rows={stagedFiltered}
          nameById={nameById}
          showEngineer={engineerId === "all"}
          isLoading={loading}
        />
      </section>

      <section aria-label="Custody ledger">
        <CustodyLedgerTable rows={roster} nameById={nameById} isLoading={loading} />
      </section>

      {orphans.length > 0 && (
        <section aria-label="Unknown custodian" className="space-y-2">
          <h2 className="text-sm font-semibold">
            Unknown custodian{" "}
            <span className="font-normal tabular-nums text-muted-foreground">
              ({orphans.length} item{orphans.length === 1 ? "" : "s"} held outside the roster)
            </span>
          </h2>
          <CustodyLedgerTable rows={orphans} nameById={nameById} isLoading={loading} />
        </section>
      )}
    </div>
  );
}
