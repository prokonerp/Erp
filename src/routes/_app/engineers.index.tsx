import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/engineers/")({
  component: EngineersIndex,
  head: () => ({ meta: [{ title: "Engineers Overview — Prokon" }] }),
});

/** Placeholder until B4 (Overview/Directory/detail). Keeps /engineers
 *  rendering while Rates/Payable (B2) and oversight tabs (B3) land. */
function EngineersIndex() {
  return (
    <div className="rounded-lg border p-6 text-sm text-muted-foreground">
      <h1 className="text-lg font-semibold text-foreground mb-1">Engineers</h1>
      <p>
        Field-ops admin module is under construction. Rates &amp; payable land
        in B2; tickets, conveyance, documents, custody and attention tabs in B3.
      </p>
    </div>
  );
}
