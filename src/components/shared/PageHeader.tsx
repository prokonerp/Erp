import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; to?: string };

/**
 * Standard page header: optional back link, breadcrumb trail, title,
 * description and a right-aligned action area. One spacing rhythm for
 * every page — content below starts with `mt-4` (or `space-y-4` parent).
 */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  backTo,
  backLabel = "Back",
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Trail rendered above the title, e.g. Sales / Invoices / INV-0042. */
  crumbs?: Crumb[];
  /** Buttons/menus aligned right. Keep to ≤3 primary actions. */
  actions?: React.ReactNode;
  /** Optional router path for a subtle back control on detail pages. */
  backTo?: string;
  backLabel?: string;
  className?: string;
}) {
  return (
    <header className={cn("space-y-1", className)}>
      {backTo && (
        <div>
          <Link
            to={backTo}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5 rotate-180" />
            {backLabel}
          </Link>
        </div>
      )}
      {crumbs && crumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-0.5 text-xs text-muted-foreground"
        >
          {crumbs.map((c, i) => (
            <Fragment key={`${c.label}-${i}`}>
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
              {c.to ? (
                <Link to={c.to} className="rounded px-0.5 transition-colors hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span aria-current="page" className="px-0.5 font-medium text-foreground/70">
                  {c.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && (
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
