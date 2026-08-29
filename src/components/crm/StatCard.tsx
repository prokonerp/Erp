import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Tone = "default" | "success" | "warning" | "danger" | "info";

const TONE_CLASSES: Record<Tone, { icon: string; value: string }> = {
  default: { icon: "bg-muted text-muted-foreground", value: "text-foreground" },
  success: { icon: "bg-emerald-50 text-emerald-700", value: "text-emerald-700" },
  warning: { icon: "bg-amber-50 text-amber-700", value: "text-amber-700" },
  danger: { icon: "bg-red-50 text-red-600", value: "text-red-600" },
  info: { icon: "bg-sky-50 text-sky-700", value: "text-sky-700" },
};

const TREND_CLASSES: Record<"up" | "down" | "flat", string> = {
  up: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20",
  down: "bg-red-50 text-red-600 ring-1 ring-red-600/20",
  flat: "bg-slate-50 text-slate-600 ring-1 ring-slate-500/20",
};

export type StatCardProps = {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: Tone;
  hint?: string;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  loading?: boolean;
  onClick?: () => void;
  className?: string;
};

function TrendPill({ trend }: { trend: { direction: "up" | "down" | "flat"; label: string } }) {
  const Icon = trend.direction === "up" ? ArrowUp : trend.direction === "down" ? ArrowDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        TREND_CLASSES[trend.direction],
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {trend.label}
    </span>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  hint,
  trend,
  loading = false,
  onClick,
  className,
}: StatCardProps) {
  const toneClasses = TONE_CLASSES[tone];

  const body = (
    <CardContent className="p-4 md:p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {Icon ? (
          loading ? (
            <Skeleton className="h-8 w-8 rounded-md" />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                toneClasses.icon,
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
          )
        ) : null}
      </div>

      <div className="mt-3">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div
            className={cn(
              "text-[1.5rem] font-semibold leading-tight tabular-nums tracking-tight md:text-[1.85rem]",
              toneClasses.value,
            )}
          >
            {value}
          </div>
        )}
      </div>

      {hint || trend ? (
        <div className="mt-3 flex items-end justify-between gap-2">
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : <span />}
          {trend ? <TrendPill trend={trend} /> : null}
        </div>
      ) : null}
    </CardContent>
  );

  if (onClick) {
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          "cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          className,
        )}
      >
        {body}
      </Card>
    );
  }

  return <Card className={className}>{body}</Card>;
}

export default StatCard;
