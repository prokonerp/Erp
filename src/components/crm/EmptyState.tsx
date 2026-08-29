import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type EmptyStateAction = {
  label: string;
  onClick?: () => void;
  to?: string;
  icon?: LucideIcon;
};

export type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  const ActionIcon = action?.icon;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg bg-muted/30 px-4 py-10 text-center",
        className,
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border"
        >
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <p className="text-base font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-4">
          {action.to ? (
            <Button asChild>
              <Link to={action.to as never}>
                {ActionIcon ? <ActionIcon aria-hidden="true" /> : null}
                <span>{action.label}</span>
              </Link>
            </Button>
          ) : (
            <Button onClick={action.onClick}>
              {ActionIcon ? <ActionIcon aria-hidden="true" /> : null}
              <span>{action.label}</span>
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default EmptyState;
