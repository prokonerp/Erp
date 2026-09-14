import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMyQueue } from "@/hooks/useMyQueue";
import {
  priorityWeight,
  isToday,
  isCarryForward,
  matchesSearch,
  formatAge,
} from "@/lib/eng-queue-utils";
import { Input } from "@/components/ui/input";
import { CardSkeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { Search, Inbox, Clock } from "lucide-react";

export const Route = createFileRoute("/eng/queue")({
  component: EngQueue,
});

function statusTone(status: string): StatusTone {
  if (status === "Closed") return "success";
  if (status === "Cancelled") return "danger";
  if (status === "Waiting for Parts") return "warning";
  if (status === "New" || status === "Call Log") return "neutral";
  return "info";
}

const PRIORITY_TONE: Record<string, StatusTone> = {
  P1: "danger",
  P2: "warning",
  P3: "info",
  P4: "neutral",
  P5: "neutral",
};

function EngQueue() {
  const { data: tickets = [], isLoading, isError, error, refetch } = useMyQueue();
  const [search, setSearch] = useState("");

  const errMsg = error instanceof Error ? error.message : "";
  const linkHint =
    errMsg === "ACCOUNT_NOT_LINKED"
      ? "Your login isn't linked to an employee record. Please contact admin."
      : errMsg === "AMBIGUOUS_EMPLOYEE_MATCH"
        ? "Multiple employee records share your login. Please contact admin."
        : null;

  const term = search.trim();
  const filtered = term
    ? tickets.filter((t) =>
        matchesSearch(term, [t.case_id, t.customer_name, t.product, t.serial_no, t.location]),
      )
    : tickets;

  const sections = [
    {
      label: "Today",
      filter: (t: (typeof tickets)[0]) => isToday(t.created_at, t.assigned_at),
    },
    {
      label: "Carry Forward",
      filter: (t: (typeof tickets)[0]) => isCarryForward(t.created_at, t.assigned_at, t.status),
    },
    {
      label: "Waiting for Parts",
      filter: (t: (typeof tickets)[0]) => t.status === "Waiting for Parts",
    },
  ];

  const sortTickets = (list: typeof tickets) =>
    [...list].sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority));

  if (isLoading) {
    return (
      <div
        className="mx-auto max-w-2xl space-y-3"
        role="status"
        aria-busy="true"
        aria-label="Loading your queue"
      >
        {[0, 1, 2, 3].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-sm gap-3 px-4 text-center">
        <p>{linkHint ?? "Failed to load your queue."}</p>
        <button
          onClick={() => refetch()}
          className="text-primary underline text-sm hover:text-primary/80"
        >
          Retry
        </button>
      </div>
    );
  }

  const sectionItems = sections.map((section) => ({
    label: section.label,
    items: sortTickets(filtered.filter(section.filter)),
  }));
  const coveredIds = new Set(sectionItems.flatMap((s) => s.items.map((t) => t.id)));
  const otherItems = sortTickets(filtered.filter((t) => !coveredIds.has(t.id)));
  const visibleSections = [...sectionItems, { label: "Other assigned", items: otherItems }].filter(
    (s) => s.items.length > 0,
  );

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by case ID, customer, product…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-11 min-h-[44px]"
        />
      </div>

      {filtered.length === 0 && (
        <EmptyState
          icon={Inbox}
          title="No tickets in your queue"
          hint={
            term
              ? `No results for "${term}". Try a different case ID, customer, or product.`
              : "You're all caught up. New tickets assigned to you will appear here."
          }
          action={
            term ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="min-h-[44px] rounded-md border px-4 text-sm font-medium text-primary"
              >
                Clear search
              </button>
            ) : undefined
          }
        />
      )}

      {visibleSections.map((section) => (
        <div key={section.label}>
          <h2 className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {section.label}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {section.items.length}
            </span>
          </h2>
          <div className="space-y-3">
            {section.items.map((t) => (
              <Link
                key={t.id}
                to="/eng/ticket/$id"
                params={{ id: t.id }}
                className="block min-h-[44px] rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-[15px] font-semibold">{t.case_id}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={statusTone(t.status)}>{t.status}</StatusBadge>
                    {t.priority && (
                      <StatusBadge tone={PRIORITY_TONE[t.priority] ?? "neutral"}>
                        {t.priority}
                      </StatusBadge>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-foreground line-clamp-2">{t.customer_name}</p>
                {t.product && (
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{t.product}</p>
                )}
                {t.location && (
                  <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{t.location}</p>
                )}
                <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatAge(t.created_at)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
