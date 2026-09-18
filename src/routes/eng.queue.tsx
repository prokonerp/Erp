import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMyCompletedQueue, useMyQueue, type CompletedQueueTicket } from "@/hooks/useMyQueue";
import type { QueueTicket } from "@/hooks/useMyQueue";
import {
  priorityWeight,
  isToday,
  isCarryForward,
  matchesSearch,
  formatAge,
} from "@/lib/eng-queue-utils";
import { EngQueueCard } from "@/components/eng/EngQueueCard";
import { ShareFsrDialog } from "@/components/engineer/ShareFsrDialog";
import { Input } from "@/components/ui/input";
import { CardSkeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/EmptyState";
import { Search, Inbox, MessageCircle, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/eng/queue")({
  component: EngQueue,
});

function renderCard(t: QueueTicket | CompletedQueueTicket) {
  return (
    <EngQueueCard
      key={t.id}
      to={`/eng/ticket/${t.id}`}
      ticket={{
        id: t.id,
        caseId: t.case_id,
        status: t.status,
        priority: t.priority,
        customer: t.customer_name,
        site: t.location ?? null,
        sector: t.sector,
        createdAt: t.created_at,
        assignedAt: t.assigned_at,
        age: formatAge(t.created_at),
      }}
    />
  );
}

function EngQueue() {
  const { data: tickets = [], isLoading, isFetching, isError, error, refetch } = useMyQueue();
  const done = useMyCompletedQueue();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"open" | "done">("open");
  const [shareTicket, setShareTicket] = useState<CompletedQueueTicket | null>(null);

  const errMsg = error instanceof Error ? error.message : "";
  const linkHint =
    errMsg === "ACCOUNT_NOT_LINKED"
      ? "Your login isn't linked to an employee record. Please contact admin."
      : errMsg === "AMBIGUOUS_EMPLOYEE_MATCH"
        ? "Multiple employee records share your login. Please contact admin."
        : null;

  const term = search.trim();
  const searchFields = (t: QueueTicket | CompletedQueueTicket) => [
    t.case_id,
    t.customer_name,
    t.product,
    t.serial_no,
    t.location,
    t.sector,
  ];
  const filtered = term ? tickets.filter((t) => matchesSearch(term, searchFields(t))) : tickets;
  const completed = done.data ?? [];
  const doneFiltered = term
    ? completed.filter((t) => matchesSearch(term, searchFields(t)))
    : completed;

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

  const refreshing = isFetching || done.isFetching;
  const handleRefresh = () => {
    void refetch();
    void done.refetch();
  };

  if ((tab === "open" && isLoading) || (tab === "done" && done.isLoading)) {
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

  if (tab === "open" && isError) {
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

  if (tab === "done" && done.isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-sm gap-3 px-4 text-center">
        <p>Failed to load your completed visits.</p>
        <button
          onClick={() => done.refetch()}
          className="text-primary underline text-sm hover:text-primary/80"
        >
          Retry
        </button>
      </div>
    );
  }

  // Sections are mutually exclusive by construction except Today ∩ Waiting
  // for Parts (a today ticket awaiting parts). Dedup sequentially in display
  // order so each ticket renders exactly once (Today wins).
  const seen = new Set<string>();
  const sectionItems = sections.map((section) => {
    const items = sortTickets(filtered.filter((t) => !seen.has(t.id) && section.filter(t)));
    items.forEach((t) => seen.add(t.id));
    return { label: section.label, items };
  });
  // "Carry Forward" (not-today AND status != "Waiting for Parts") already
  // catches every non-today non-WFP ticket, and the queue query excludes
  // Closed/Cancelled, so no "Other assigned" bucket can ever be non-empty.
  // Date-null edge cases land in Carry Forward: isToday(null) is false.
  const visibleSections = sectionItems.filter((s) => s.items.length > 0);

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by case ID, customer, product…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-11 min-h-[44px]"
            />
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label={refreshing ? "Refreshing queue" : "Refresh queue"}
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4${refreshing ? " animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
        <div
          className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/40 p-1"
          role="tablist"
          aria-label="Queue view"
        >
          {(
            [
              { value: "open", label: `Open (${tickets.length})` },
              { value: "done", label: `Completed (${completed.length})` },
            ] as const
          ).map((v) => (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={tab === v.value}
              onClick={() => setTab(v.value)}
              className={`min-h-[44px] rounded-lg text-sm font-medium ${
                tab === v.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "open" ? (
        <>
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
              <div className="space-y-3">{section.items.map((t) => renderCard(t))}</div>
            </div>
          ))}
        </>
      ) : (
        <>
          {doneFiltered.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No completed visits"
              hint={
                term
                  ? `No results for "${term}". Try a different case ID, customer, or product.`
                  : "Tickets you finish stay open until an admin closes them — closed ones appear here, newest first."
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
          ) : (
            <div className="space-y-3">
              {completed.length >= 50 && (
                <p className="px-1 text-[11px] text-muted-foreground">
                  Showing the 50 most recently closed.
                </p>
              )}
              {doneFiltered.map((t) => (
                <div key={t.id} className="flex items-stretch gap-2">
                  <div className="min-w-0 flex-1">{renderCard(t)}</div>
                  <button
                    type="button"
                    onClick={() => setShareTicket(t)}
                    title={`Share FSR for ${t.case_id} on WhatsApp`}
                    aria-label={`Share FSR for ${t.case_id} on WhatsApp`}
                    className="inline-flex w-[48px] shrink-0 items-center justify-center rounded-xl border border-border bg-card text-emerald-700 active:bg-muted/50"
                  >
                    <MessageCircle className="h-5 w-5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <ShareFsrDialog
        open={shareTicket !== null}
        onOpenChange={(v) => {
          if (!v) setShareTicket(null);
        }}
        ticketId={shareTicket?.id ?? ""}
        caseId={shareTicket?.case_id ?? ""}
        customerName={shareTicket?.customer_name ?? ""}
        customerPhone={shareTicket?.customer_phone ?? null}
      />
    </div>
  );
}
