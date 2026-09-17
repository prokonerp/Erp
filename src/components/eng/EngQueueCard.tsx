import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { formatAge } from "@/lib/eng-queue-utils";

/** Minimal ticket shape for the engineer queue card. Aliases tolerate source naming. */
export interface EngQueueTicket {
  id: string;
  caseId: string;
  /** Alias for caseId (display / case_id from query rows). */
  display?: string;
  status: string;
  priority?: string | null;
  customer: string;
  /** Site alias (location from query rows). */
  site?: string | null;
  sector?: string | null;
  location?: string | null;
  createdAt: string;
  assignedAt?: string | null;
  /** Precomputed age label; falls back to formatAge(createdAt). */
  age?: string;
}

export interface EngQueueCardProps {
  ticket: EngQueueTicket;
  /** Destination path for the full-card link. */
  to: string;
}

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

/** Priority edge accent — oklch only, no raw hex. */
const PRIORITY_EDGE: Record<string, string> = {
  P1: "border-l-[oklch(0.58_0.22_27)]",
  P2: "border-l-[oklch(0.7_0.15_75)]",
  P3: "border-l-[oklch(0.54_0.19_260)]",
  P4: "border-l-[oklch(0.7_0.02_260)]",
  P5: "border-l-[oklch(0.7_0.02_260)]",
};

export function EngQueueCard({ ticket, to }: EngQueueCardProps) {
  const rawCaseId = ticket.caseId ?? ticket.display ?? ticket.id;
  // A missing case id falls back to the raw row uuid — truncate UUID-shaped
  // values so the headline never renders 36 hex chars.
  const caseId = /^[0-9a-f-]{36}$/i.test(rawCaseId) ? `${rawCaseId.slice(0, 8)}…` : rawCaseId;
  const site = ticket.site ?? ticket.location ?? null;
  const sectorLine = [ticket.sector, site].filter(Boolean).join(" · ");
  const age = ticket.age ?? formatAge(ticket.createdAt);
  const edge =
    PRIORITY_EDGE[(ticket.priority || "").toUpperCase()] ?? "border-l-[oklch(0.7_0.02_260)]";

  return (
    // `to` arrives as a runtime string (the queue builds destinations
    // dynamically); the cast keeps TanStack's literal-path typing quiet.
    <Link
      to={to as never}
      className={`block min-h-11 rounded-xl border border-l-4 bg-card p-4 transition-colors hover:bg-muted/50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${edge}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[15px] font-semibold">{caseId}</span>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge tone={statusTone(ticket.status)}>{ticket.status}</StatusBadge>
          {ticket.priority && (
            <StatusBadge
              tone={PRIORITY_TONE[String(ticket.priority ?? "").toUpperCase()] ?? "neutral"}
            >
              {ticket.priority}
            </StatusBadge>
          )}
        </div>
      </div>
      <p className="mt-1 text-sm text-foreground line-clamp-2">{ticket.customer}</p>
      {sectorLine && (
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{sectorLine}</p>
      )}
      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {age}
      </p>
    </Link>
  );
}
