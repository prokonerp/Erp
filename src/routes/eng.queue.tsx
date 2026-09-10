import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMyQueue } from "@/hooks/useMyQueue";
import { STATUS_COLOR, PRIORITY_COLOR } from "@/lib/tickets";
import {
  priorityWeight,
  isToday,
  isCarryForward,
  matchesSearch,
  formatAge,
} from "@/lib/eng-queue-utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export const Route = createFileRoute("/eng/queue")({
  component: EngQueue,
});

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
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Loading your queue…
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

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by case ID, customer, product…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {tickets.length === 0
            ? "No tickets assigned to you."
            : "No results matching your search."}
        </div>
      )}

      {sections.map((section) => {
        const items = sortTickets(filtered.filter(section.filter));
        if (items.length === 0) return null;
        return (
          <div key={section.label}>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">
              {section.label} ({items.length})
            </h2>
            <div className="space-y-2">
              {items.map((t) => (
                <Link
                  key={t.id}
                  to="/eng/ticket/$id"
                  params={{ id: t.id }}
                  className="block border rounded-lg p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">{t.case_id}</span>
                        {t.priority && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLOR[t.priority] || ""}`}
                          >
                            {t.priority}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${STATUS_COLOR[t.status] || ""}`}
                        >
                          {t.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-foreground mt-1 truncate">{t.customer_name}</p>
                      {t.product && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.product}</p>
                      )}
                      {t.complaint && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {t.complaint}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {formatAge(t.created_at)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
