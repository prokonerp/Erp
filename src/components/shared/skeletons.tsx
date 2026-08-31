import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Centered, branded full-page loading state.
 * Drop-in replacement for the old `<div>Loading…</div>` guards so every
 * page gates on a consistent, accessible spinner instead of bare text.
 */
export function PageLoader({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[40vh] w-full flex-col items-center justify-center gap-3",
        className,
      )}
      aria-busy="true"
      aria-label={label}
      role="status"
    >
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/** Row-shaped skeleton matching a data table's visual rhythm. */
export function TableSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("w-full", className)} aria-busy="true" aria-label="Loading">
      <div className="border-b bg-muted/40 px-4 py-2.5">
        <div className="flex gap-6">
          {[64, 96, 80, 72].map((w, i) => (
            <Skeleton key={i} className="h-3" style={{ width: w }} />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-6 border-b px-4 py-3 last:border-0">
          {[120, 88, 104, 64].map((w, i) => (
            <Skeleton key={i} className="h-3.5" style={{ width: w }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Card-grid skeleton for dashboard/stat sections. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  );
}

/** Form skeleton: labelled fields in the form-kit grid rhythm. */
export function FormSkeleton({ fields = 8, className }: { fields?: number; className?: string }) {
  return (
    <div className={cn("fk-shell", className)} aria-busy="true" aria-label="Loading">
      <div className="fk-section p-5">
        <Skeleton className="h-4 w-40" />
        <div className="fk-grid mt-5">
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i} className="fk-col-md space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
