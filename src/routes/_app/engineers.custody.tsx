import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Package, TriangleAlert, Users } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/crm/StatCard";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEngineerCustody, useEngineerRoster } from "@/hooks/useEngineerAdmin";
import type { CustodyLedgerRow } from "@/lib/engineersAdmin";

export const Route = createFileRoute("/_app/engineers/custody")({
  component: EngineerCustodyPage,
  head: () => ({ meta: [{ title: "Custody — Prokon" }] }),
});

function custodianLabel(
  row: CustodyLedgerRow,
  nameById: Map<string, string>,
): string {
  if (row.custodian_name && row.custodian_name !== "") return row.custodian_name;
  if (row.custodian_employee_id) {
    const rosterName = nameById.get(row.custodian_employee_id);
    if (rosterName) return rosterName;
    return row.custodian_employee_id.slice(0, 8);
  }
  return "—";
}

const CUSTODY_COLUMNS: ColumnDef<CustodyLedgerRow>[] = [
  {
    key: "custodian_employee_id",
    header: "Custodian",
    sortable: true,
    render: (r) => <span>{r.custodian_name ?? "—"}</span>,
  },
  {
    key: "part_serial_no",
    header: "Part serial",
    sortable: true,
    render: (r) => (
      <span className="font-mono text-xs">{r.part_serial_no ?? "—"}</span>
    ),
  },
  {
    key: "stock_item_id",
    header: "Item",
    render: (r) => (
      <span className="font-mono text-xs">
        {r.stock_item_id ? r.stock_item_id.slice(0, 8) : "—"}
      </span>
    ),
  },
  {
    key: "ticket_id",
    header: "Ticket",
    render: (r) =>
      r.ticket_id ? (
        <Link
          to="/tickets/$id"
          params={{ id: r.ticket_id }}
          className="font-mono text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {r.ticket_id.slice(0, 8)}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "set_at",
    header: "Since",
    sortable: true,
    align: "right",
    render: (r) => (
      <span className="tabular-nums">{(r.set_at ?? "").slice(0, 10) || "—"}</span>
    ),
  },
];

/** Read-only custody ledger: parts checked out to engineers. Orphan rows
 *  (custodian_employee_id outside the roster) render under an
 *  "Unknown custodian" section — never dropped. */
function EngineerCustodyPage() {
  const rosterQuery = useEngineerRoster();
  const [engineerId, setEngineerId] = useState<string>("all");

  const custodyQuery = useEngineerCustody(engineerId === "all" ? null : engineerId);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of rosterQuery.roster) {
      if (e && typeof e.employee_id === "string" && e.employee_id !== "") {
        map.set(e.employee_id, e.name && e.name !== "" ? e.name : e.employee_id);
      }
    }
    return map;
  }, [rosterQuery.roster]);

  const labelled = useMemo<CustodyLedgerRow[]>(() => {
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
  const { rosterRows, orphanRows } = useMemo(() => {
    const roster: CustodyLedgerRow[] = [];
    const orphans: CustodyLedgerRow[] = [];
    for (const r of labelled) {
      if (r.custodian_employee_id && !nameById.has(r.custodian_employee_id)) orphans.push(r);
      else roster.push(r);
    }
    return { rosterRows: roster, orphanRows: orphans };
  }, [labelled, nameById]);

  // Fix up the rendered custodian column to use the roster-resolved label.
  const columns = useMemo<ColumnDef<CustodyLedgerRow>[]>(
    () =>
      CUSTODY_COLUMNS.map((c) =>
        c.key === "custodian_employee_id"
          ? { ...c, render: (r: CustodyLedgerRow) => <span>{custodianLabel(r, nameById)}</span> }
          : c,
      ),
    [nameById],
  );

  const engineersHolding = useMemo(() => {
    const ids = new Set<string>();
    for (const r of labelled) {
      if (r.custodian_employee_id) ids.add(r.custodian_employee_id);
    }
    return ids.size;
  }, [labelled]);

  const warnings = useMemo(
    () => [...rosterQuery.warnings, ...custodyQuery.warnings],
    [rosterQuery.warnings, custodyQuery.warnings],
  );
  const loading = rosterQuery.isLoading || custodyQuery.isLoading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Custody"
        description="Parts checked out to engineers — read-only ledger."
      />

      {warnings.length > 0 && (
        <ul role="status" aria-live="polite" className="space-y-1 rounded-lg border p-3 text-sm text-muted-foreground">
          {warnings.map((w) => (
            <li key={`${w.section}::${w.message}`}>
              <span className="font-medium text-foreground">{w.section}:</span> {w.message}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="custody-engineer">Engineer</Label>
          <Select value={engineerId} onValueChange={setEngineerId}>
            <SelectTrigger id="custody-engineer">
              <SelectValue placeholder="All engineers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All engineers</SelectItem>
              {rosterQuery.roster.map((e) => (
                <SelectItem key={e.employee_id} value={e.employee_id}>
                  {nameById.get(e.employee_id) ?? e.employee_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Items held"
          value={labelled.length}
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
          value={orphanRows.length}
          icon={TriangleAlert}
          tone={orphanRows.length > 0 ? "warning" : "default"}
          loading={loading}
          hint="Outside the roster"
        />
      </div>

      <section aria-label="Custody ledger">
        <DataTable
          columns={columns}
          data={rosterRows}
          isLoading={loading}
          rowKey={(r) =>
            `${r.stock_item_id ?? "item"}::${r.custodian_employee_id ?? "none"}::${r.part_serial_no ?? "noserial"}::${r.ticket_id ?? "noticket"}`
          }
          emptyIcon={Package}
          emptyTitle="No custody records"
          emptyHint="Nothing is currently checked out to engineers."
        />
      </section>

      {orphanRows.length > 0 && (
        <section aria-label="Unknown custodian" className="space-y-2">
          <h2 className="text-sm font-semibold">
            Unknown custodian{" "}
            <span className="font-normal tabular-nums text-muted-foreground">
              ({orphanRows.length} item{orphanRows.length === 1 ? "" : "s"} held outside the roster)
            </span>
          </h2>
          <DataTable
            columns={columns}
            data={orphanRows}
            isLoading={loading}
            rowKey={(r) =>
              `${r.stock_item_id ?? "item"}::${r.custodian_employee_id ?? "none"}::${r.part_serial_no ?? "noserial"}::${r.ticket_id ?? "noticket"}`
            }
            emptyIcon={Package}
            emptyTitle="No custody records"
            emptyHint="Nothing is currently checked out to engineers."
          />
        </section>
      )}
    </div>
  );
}
