import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Package, TriangleAlert, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/crm/StatCard";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { EngineerSelect } from "@/components/engineer/EngineerSelect";
import { CustodyLedgerTable } from "@/components/engineer/CustodyLedgerTable";
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

  // Orphans: custodian ids with no roster entry. Partitioned into their own
  // section below so they are counted and visible, never silently dropped.
  const { roster, orphans } = useMemo(
    () => partitionOrphans(filtered, nameById, (r) => r.custodian_employee_id),
    [filtered, nameById],
  );

  const engineersHolding = useMemo(() => {
    const ids = new Set<string>();
    for (const r of filtered) {
      if (r.custodian_employee_id) ids.add(r.custodian_employee_id);
    }
    return ids.size;
  }, [filtered]);

  const loading = rosterQuery.isLoading || custodyQuery.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Custody"
        description="Parts checked out to engineers — read-only ledger."
      />

      <AdminWarnings lists={[rosterQuery.warnings, custodyQuery.warnings]} />

      <div className="grid gap-3 sm:grid-cols-3">
        <EngineerSelect
          id="custody-engineer"
          value={engineerId}
          onChange={setEngineerId}
          engineers={rosterQuery.roster}
          allowAll
          allLabel="All engineers"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Items held"
          value={filtered.length}
          icon={Package}
          loading={loading}
          hint="Matching this filter"
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
