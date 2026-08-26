import * as React from "react";

import { cn } from "@/lib/utils";
import { statusLabel } from "@/lib/crm";
import type { LeadStatus, QuoteStatus } from "@/lib/crm";

type Kind = "lead" | "quote" | "payout";

const PAYOUT_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20",
  paid: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20",
};

const PAYOUT_LABEL: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
};

const LEAD_TONE: Record<LeadStatus, string> = {
  new: "bg-sky-50 text-sky-700 ring-1 ring-sky-600/20",
  follow_up: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20",
  quoted: "bg-violet-50 text-violet-700 ring-1 ring-violet-600/20",
  won: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20",
  lost: "bg-red-50 text-red-600 ring-1 ring-red-600/20",
};

const QUOTE_TONE: Record<QuoteStatus, string> = {
  draft: "bg-slate-50 text-slate-600 ring-1 ring-slate-500/20",
  sent: "bg-sky-50 text-sky-700 ring-1 ring-sky-600/20",
  accepted: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20",
  declined: "bg-red-50 text-red-600 ring-1 ring-red-600/20",
  expired: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20",
  invoiced: "bg-violet-50 text-violet-700 ring-1 ring-violet-600/20",
};

const QUOTE_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  invoiced: "Invoiced",
};

const FALLBACK_TONE = "bg-muted text-muted-foreground ring-1 ring-border";

function humanize(value: string): string {
  if (!value) return "";
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export type StatusBadgeProps = {
  kind: Kind;
  value: string;
  size?: "sm" | "md";
  className?: string;
};

export function StatusBadge({ kind, value, size = "sm", className }: StatusBadgeProps) {
  let tone = FALLBACK_TONE;
  let label = humanize(value);

  if (kind === "lead") {
    const known = (statusLabel as Record<string, string>)[value];
    if (known) {
      tone = LEAD_TONE[value as LeadStatus] ?? FALLBACK_TONE;
      label = known;
    }
  } else if (kind === "payout") {
    const known = (PAYOUT_LABEL as Record<string, string>)[value];
    if (known) {
      tone = PAYOUT_TONE[value] ?? FALLBACK_TONE;
      label = known;
    }
  } else {
    const known = (QUOTE_LABEL as Record<string, string>)[value];
    if (known) {
      tone = QUOTE_TONE[value as QuoteStatus] ?? FALLBACK_TONE;
      label = known;
    }
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        size === "md" && "px-2.5 py-1 text-sm",
        tone,
        className,
      )}
    >
      {label || "—"}
    </span>
  );
}

export default StatusBadge;
