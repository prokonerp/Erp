import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMyQueue } from "@/hooks/useMyQueue";
import { STATUS_COLOR, PRIORITY_COLOR } from "@/lib/tickets";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export const Route = createFileRoute("/eng/queue")({
  component: EngQueue,
});

function EngQueue() {
  const { data: tickets = [], isLoading } = useMyQueue();
  const [search, setSearch] = useState("");

  const term = search.trim().toLowerCase();
  const filtered = term
    ? tickets.filter(
        (t) =>
          t.case_id.toLowerCase().includes(term) ||
          (t.customer_name || "").toLowerCase().includes(term) ||
          (t.product || "").toLowerCase().includes(term) ||
          (t.serial_no || "").toLowerCase().includes(term) ||
          (t.location || "").toLowerCase().includes(term),
      )
    : tickets;

  const sections = [
    {
      label: "Today",
      filter: (t: (typeof tickets)[0]) => {
        const created = new Date(t.created_at);
        const now = new Date();
        return (
          created.toDateString() === now.toDateString() ||
          (t.assigned_at && new Date(t.assigned_at).toDateString() === now.toDateString())
        );
      },
    },
    {
      label: "Carry Forward",
      filter: (t: (typeof tickets)[0]) => {
        const created = new Date(t.created_at);
        const now = new Date();
        return (
          created.toDateString() !== now.toDateString() &&
          (!t.assigned_at || new Date(t.assigned_at).toDateString() !== now.toDateString()) &&
          t.status !== "Waiting for Parts"
        );
      },
    },
    {
      label: "Waiting for Parts",
      filter: (t: (typeof tickets)[0]) => t.status === "Waiting for Parts",
    },
  ];

  const priorityOrder = (p: string | null) => {
    const map: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
    return map[(p || "").toUpperCase()] ?? 99;
  };

  const sortTickets = (list: typeof tickets) =>
    [...list].sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Loading your queue…
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

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hrs = ms / 3_600_000;
  if (hrs < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  return `${Math.round(hrs / 24)}d`;
}
