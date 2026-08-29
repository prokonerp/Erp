import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type PageHeaderAction = {
  label: string;
  onClick?: () => void;
  to?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  variant?: "outline" | "ghost" | "default";
};

export type PageHeaderProps = {
  title: string;
  description?: string;
  group?: string;
  icon?: LucideIcon;
  primary?: PageHeaderAction;
  secondary?: PageHeaderAction[];
  right?: React.ReactNode;
  className?: string;
};

function ActionButton({ action }: { action: PageHeaderAction }) {
  const Icon = action.icon;

  if (action.to) {
    return (
      <Button asChild variant={action.variant ?? "default"} disabled={action.disabled}>
        <Link to={action.to as never}>
          {Icon ? <Icon aria-hidden="true" /> : null}
          <span>{action.label}</span>
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={action.variant ?? "default"}
      onClick={action.onClick}
      disabled={action.disabled}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{action.label}</span>
    </Button>
  );
}

export function PageHeader({
  title,
  description,
  group,
  icon: Icon,
  primary,
  secondary,
  right,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between md:mb-6 print:hidden",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {group ? (
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {group}
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          {Icon ? (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <Icon className="h-5 w-5" />
            </span>
          ) : null}
          <h1 className="truncate text-[1.4rem] font-semibold leading-tight tracking-tight text-foreground md:text-[1.65rem]">
            {title}
          </h1>
        </div>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>

      {primary || (secondary && secondary.length) || right ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {right}
          {secondary?.map((action, i) => (
            <ActionButton key={`${action.label}-${i}`} action={action} />
          ))}
          {primary ? <ActionButton action={primary} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export default PageHeader;
