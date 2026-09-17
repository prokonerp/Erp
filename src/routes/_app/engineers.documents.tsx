import { Link, createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useEmployeeDocuments, useEngineerRoster } from "@/hooks/useEngineerAdmin";

export const Route = createFileRoute("/_app/engineers/documents")({
  component: EngineerDocumentsPage,
  head: () => ({ meta: [{ title: "Documents — Prokon" }] }),
});

/** Per-engineer document blocks. Own hook call per row — never in a loop. */
function EngineerDocBlocks({ employeeId }: { employeeId: string }) {
  const docsQuery = useEmployeeDocuments(employeeId);

  if (docsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const compliance = docsQuery.data?.compliance ?? { present: [], missing: [] };
  const blocks = [
    ...compliance.present.map((name) => ({ name, present: true })),
    ...compliance.missing.map((name) => ({ name, present: false })),
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {blocks.map((b) => (
          <StatusBadge key={b.name} tone={b.present ? "success" : "danger"}>
            {b.name}
          </StatusBadge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{compliance.present.length}/6 on file</p>
      {docsQuery.warnings.length > 0 && (
        <div className="space-y-1">
          {docsQuery.warnings.map((w) => (
            <p key={`${w.section}::${w.message}`} className="text-xs text-muted-foreground">
              <span className="font-medium">{w.section}:</span> {w.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function EngineerDocumentsPage() {
  const rosterQuery = useEngineerRoster();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documents"
        description="Profile document compliance — 6 required blocks per engineer."
      />

      {rosterQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {rosterQuery.warnings.length > 0 && (
            <ul role="status" aria-live="polite" className="space-y-1 rounded-lg border p-3 text-sm text-muted-foreground">
              {rosterQuery.warnings.map((w) => (
                <li key={`${w.section}::${w.message}`}>
                  <span className="font-medium text-foreground">{w.section}:</span> {w.message}
                </li>
              ))}
            </ul>
          )}

          {rosterQuery.roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">No engineers in roster.</p>
          ) : (
            <section aria-label="Engineer document compliance" className="space-y-3">
              {rosterQuery.roster.map((e) => (
                <div key={e.employee_id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to="/engineers/directory/$employeeId"
                      params={{ employeeId: e.employee_id }}
                      className="text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {e.name && e.name !== "" ? e.name : e.employee_id}
                    </Link>
                    <StatusBadge tone={e.active ? "success" : "neutral"}>
                      {e.active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </div>
                  <div className="mt-3">
                    <EngineerDocBlocks employeeId={e.employee_id} />
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
