import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/shared/skeletons";
import { SoConversionForm } from "@/components/SoConversionSheet";
import { fetchSalesOrder, type SalesOrder } from "@/lib/salesOrders";
import { resolveConvertTarget, toUiConversionType } from "@/lib/soConversionUi";

type ConvertSearch = { type?: string };

export const Route = createFileRoute("/_app/sales/orders/$id_/convert")({
  validateSearch: (s: Record<string, unknown>): ConvertSearch => ({
    type: typeof s?.type === "string" ? (s.type as string) : undefined,
  }),
  head: () => ({ meta: [{ title: "Convert Sales Order — Prokon" }] }),
  component: SoConvertPage,
});

function SoConvertPage() {
  const { id } = Route.useParams();
  const { type } = Route.useSearch();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [so, setSo] = useState<SalesOrder | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(null);
    setSo(null);
    fetchSalesOrder(id)
      .then((r) => {
        if (alive) setSo(r);
      })
      .catch((e) => {
        if (alive) setFailed(e?.message || "Could not load Sales Order");
      });
    return () => {
      alive = false;
    };
  }, [id, retryKey]);

  if (failed) {
    return (
      <div className="space-y-4">
        <Link to="/sales/orders/$id" params={{ id }}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to SO
          </Button>
        </Link>
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{failed}</div>
        <div>
          <Button variant="outline" size="sm" onClick={() => setRetryKey((k) => k + 1)}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!so) return <PageLoader />;

  const isCancelled = String((so as any).status || "").trim().toLowerCase() === "cancelled";

  const handleSuccess = (target: { type: string; id: string }) => {
    qc.invalidateQueries({ queryKey: ["so-fulfillment", id] });
    qc.invalidateQueries({ queryKey: ["so-conversions", id] });
    const dest = resolveConvertTarget(target.type, target.id);
    if (dest) nav({ to: dest.to, params: dest.params } as never);
    else {
      toast.error(`Unknown conversion target: ${target.type}`);
      nav({ to: "/sales/orders/$id", params: { id } });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link to="/sales/orders/$id" params={{ id }}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to {so.so_no || "SO"}
          </Button>
        </Link>
        <span className="text-xs text-muted-foreground">Full-window conversion — Tax Invoice / General Challan / Proforma</span>
      </div>

      {isCancelled ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          SO cancelled — no conversions allowed.
        </div>
      ) : (
        <SoConversionForm
          key={`${so.id}-${toUiConversionType(type)}`}
          salesOrder={so}
          defaultType={toUiConversionType(type)}
          onSuccess={handleSuccess}
          onCancel={() => nav({ to: "/sales/orders/$id", params: { id } })}
          mode="page"
        />
      )}
    </div>
  );
}
