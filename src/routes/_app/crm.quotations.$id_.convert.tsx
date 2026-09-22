import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/shared/skeletons";
import { QuoteToSoConversionForm } from "@/components/QuoteToSoConversionForm";
import { supabase } from "@/integrations/supabase/client";
import type { Quotation } from "@/lib/crm";

/**
 * Full-window Quotation → Sales Order conversion (route `/crm/quotations/$id/convert`).
 *
 * Mirrors `sales.orders.$id_.convert.tsx`: load → error/retry → loader →
 * already-converted guard → editable conversion form. The form is only rendered
 * while the quotation has no `converted_to_so_id`, so a converted quotation can
 * never be converted twice from this page.
 *
 * UI-SYNC NOTE: `converted_to_so_id` is not part of the `Quotation` type
 * (the column exists in the DB), so it is read through a narrow cast — the same
 * idiom the writer uses (`documentFlow.writers.ts`).
 */
export const Route = createFileRoute("/_app/crm/quotations/$id_/convert")({
  head: () => ({ meta: [{ title: "Convert Quotation to Sales Order — Prokon" }] }),
  component: QuoteConvertPage,
});

type CreatedSo = { id: string; so_no: string | null };

function QuoteConvertPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [q, setQ] = useState<Quotation | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [created, setCreated] = useState<CreatedSo | null>(null);
  // Legacy safety net: a quotation whose `converted_to_so_id` marker was lost
  // can still have a Sales Order linked by `linked_quote_id`. The writer's own
  // idempotency check matches on that column too, so it would silently return
  // the EXISTING order and discard the user's edits. Detect it up front.
  const [linkedSoId, setLinkedSoId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setFailed(null);
    setNotFound(false);
    setQ(null);
    setCreated(null);
    setLinkedSoId(null);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("quotations")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (!alive) return;
        if (error) {
          // PGRST116 = genuine no-row (mirrors crm.quotations.$id).
          if ((error as { code?: string }).code === "PGRST116") {
            setNotFound(true);
            return;
          }
          setFailed(error.message || "Could not load quotation");
          return;
        }
        if (!data) {
          setNotFound(true);
          return;
        }
        const marker = (data as unknown as { converted_to_so_id?: string | null })
          .converted_to_so_id;
        if (!marker) {
          const { data: so } = await supabase
            .from("sales_orders" as never)
            .select("id")
            .eq("linked_quote_id", id)
            .limit(1)
            .maybeSingle();
          if (!alive) return;
          if (so) setLinkedSoId((so as unknown as { id: string }).id);
        }
        setQ(data as unknown as Quotation);
      } catch (e: unknown) {
        if (alive) setFailed((e as Error)?.message || "Could not load quotation");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, retryKey]);

  const closeWindow = () => {
    window.close();
    // Browsers ignore window.close() for tabs they did not open — don't leave a
    // dead button in a normal tab.
    window.setTimeout(() => {
      if (!window.closed) nav({ to: "/crm/quotations/$id", params: { id } });
    }, 200);
  };

  const handleSuccess = (so: CreatedSo) => {
    setCreated(so);
    toast.success(`Sales Order ${so.so_no || so.id.slice(0, 8)} created`);
    nav({ to: "/sales/orders/$id", params: { id: so.id } });
  };

  // Compact popup bar. This page runs inside a dedicated popup window with no
  // app chrome, so it shows only what identifies the document plus the one way
  // out. `-mx-3` cancels the page's horizontal padding so the border spans the
  // full popup width while the contents stay inset.
  const popupBar = (
    <div className="sticky top-0 z-20 -mx-3 flex h-11 items-center justify-between gap-3 border-b bg-card/95 px-3 backdrop-blur">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-semibold">
          {q?.quote_no || (q ? q.id.slice(0, 8) : "Quotation")}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">Quotation → Sales Order</span>
      </div>
      <Button variant="ghost" size="sm" className="shrink-0 cursor-pointer" onClick={closeWindow}>
        <X className="mr-1 h-3.5 w-3.5" /> Close
      </Button>
    </div>
  );

  if (failed) {
    return (
      <div className="w-full max-w-full space-y-2.5 px-3 pb-3">
        {popupBar}
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
          {failed}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          onClick={() => setRetryKey((k) => k + 1)}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="w-full max-w-full space-y-2.5 px-3 pb-3">
        {popupBar}
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Quotation not found — it may have been deleted, or the link is stale.</span>
        </div>
      </div>
    );
  }

  if (!q) return <PageLoader label="Loading quotation…" />;

  const convertedSoId =
    (q as unknown as { converted_to_so_id?: string | null }).converted_to_so_id ??
    linkedSoId ??
    null;

  return (
    <div className="w-full max-w-full space-y-2.5 px-3 pb-3">
      {popupBar}

      <div className="rounded-md border bg-card px-3 py-2">
        <h1 className="text-sm font-semibold">
          Convert Quotation {q.quote_no || q.id.slice(0, 8)} to Sales Order
        </h1>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Items, prices, charges and terms can be edited here. PO Number and PO Date are compulsory.
        </p>
      </div>

      {created ? (
        <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-5 text-sm text-emerald-900">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Sales Order {created.so_no || created.id.slice(0, 8)} created from{" "}
            {q.quote_no || q.id.slice(0, 8)}.
          </div>
          <p className="text-xs opacity-90">
            The quotation is now marked as converted, so this form is not offered again — that
            prevents a duplicate Sales Order.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link to="/sales/orders/$id" params={{ id: created.id }}>
              <Button size="sm">Open Sales Order</Button>
            </Link>
            <Button variant="outline" size="sm" onClick={closeWindow}>
              Close window
            </Button>
          </div>
        </div>
      ) : convertedSoId ? (
        <div className="space-y-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-5 text-sm text-sky-900">
          <div className="flex items-center gap-2 font-medium">
            <Info className="h-4 w-4 shrink-0" />
            This quotation is already converted
          </div>
          <p className="text-xs opacity-90">
            {q.quote_no || q.id.slice(0, 8)} is already linked to Sales Order{" "}
            <span className="font-mono">{convertedSoId.slice(0, 8)}</span>. A second Sales Order
            cannot be created from the same quotation.
          </p>
          <Link to="/sales/orders/$id" params={{ id: convertedSoId }}>
            <Button size="sm">Open Sales Order</Button>
          </Link>
        </div>
      ) : (
        <QuoteToSoConversionForm key={q.id} quotation={q} onSuccess={handleSuccess} />
      )}
    </div>
  );
}
