import {
  Camera,
  Check,
  CheckCircle2,
  LogOut,
  MapPin,
  MessageCircle,
  PenLine,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatISTDate, formatISTTime } from "@/lib/time";

export type TicketTimelineKind =
  | "note"
  | "photo"
  | "issue_photo"
  | "customer_verify"
  | "equipment_verify"
  | "verify"
  | "equipment_correction"
  | "mismatch"
  | "match"
  | "acknowledge"
  | "reset"
  | "arrival"
  | "departure"
  | "signature";

export type TicketTimelineActivity = {
  id: string;
  kind: string;
  createdAt: string;
  message: string | null;
  actor?: string | null;
};

export type TicketTimelineProps = {
  activities: TicketTimelineActivity[];
  isLoading?: boolean;
  /**
   * Auth uid of the viewing engineer. Matching actors render as "You";
   * anyone else renders as a short id — engineers cannot resolve other
   * users' names (employees RLS exposes only their own row), so a raw
   * UUID would be noise either way.
   */
  currentUserId?: string | null;
};

function displayActor(actor: string | null | undefined, currentUserId?: string | null): string | null {
  if (!actor) return null;
  if (currentUserId && actor === currentUserId) return "You";
  return actor.length > 12 ? `${actor.slice(0, 8)}…` : actor;
}

const KIND_LABEL: Record<string, string> = {
  customer_verify: "Customer verification",
  equipment_verify: "Equipment verification",
  verify: "Verification",
  photo: "Photo",
  issue_photo: "Photo",
  note: "Note",
  acknowledge: "Instruction acknowledged",
  equipment_correction: "Equipment correction",
  mismatch: "Mismatch",
  match: "Match",
  reset: "Reset",
  arrival: "Arrival",
  departure: "Departure",
  signature: "Signature",
};

function TimelineIcon({ kind }: { kind: string }) {
  const cls = "h-3 w-3 shrink-0";
  switch (kind) {
    case "note":
      return <MessageCircle className={cls} aria-hidden />;
    case "photo":
    case "issue_photo":
      return <Camera className={cls} aria-hidden />;
    case "customer_verify":
    case "equipment_verify":
    case "verify":
      return <ShieldCheck className={cls} aria-hidden />;
    case "equipment_correction":
    case "mismatch":
      return <ShieldAlert className={cls} aria-hidden />;
    case "match":
      return <Check className={cls} aria-hidden />;
    case "acknowledge":
      return <CheckCircle2 className={cls} aria-hidden />;
    case "reset":
      return <RotateCcw className={cls} aria-hidden />;
    case "arrival":
      return <MapPin className={cls} aria-hidden />;
    case "departure":
      return <LogOut className={cls} aria-hidden />;
    case "signature":
      return <PenLine className={cls} aria-hidden />;
    default:
      return <MessageCircle className={cls} aria-hidden />;
  }
}

function formatNoteBody(body: string): string {
  // Keep the calendar date: bare HH:mm is ambiguous across multi-day visits.
  // Unparseable matches are left untouched (same fallback as before).
  return body.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g,
    (m) => {
      const d = formatISTDate(m, "");
      const t = formatISTTime(m, "");
      return d && t ? `${d} ${t}` : m;
    },
  );
}

export function formatTime(iso: string): string {
  // "" convention preserved (empty = unparseable); clocks render in IST.
  return formatISTTime(iso, "");
}

export function TicketTimeline({ activities, isLoading = false, currentUserId = null }: TicketTimelineProps) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="text-sm font-semibold">Activity</h3>
          {[0, 1, 2].map((i) => (
            <div key={i} className="border-l-2 border-border py-1 pl-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="mt-2 h-4 w-3/4" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const sorted = [...activities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <Card>
        <CardContent className="flex min-h-11 flex-col items-center justify-center gap-1 p-4 text-center">
          <MessageCircle className="h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No activity yet</p>
          <p className="text-xs text-muted-foreground">
            Notes, photos, and verifications will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">Activity</h3>
        {sorted.map((a) => {
          const isAlert = a.kind === "equipment_correction" || a.kind === "mismatch";
          return (
            <div key={a.id} className="border-l-2 border-border py-1 pl-3">
              <div className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground sm:min-h-0">
                <span className={cn("flex items-center gap-1.5", isAlert && "text-amber-700")}>
                  <TimelineIcon kind={a.kind} />
                </span>
                <span className="font-medium">{KIND_LABEL[a.kind] ?? a.kind}</span>
                <span>
                  <time dateTime={a.createdAt}>{formatTime(a.createdAt)}</time>
                </span>
                {a.actor ? (
                  <span aria-label="actor">{displayActor(a.actor, currentUserId)}</span>
                ) : null}
              </div>
              {a.message ? (
                <p className="mt-1 whitespace-pre-wrap text-sm">{formatNoteBody(a.message)}</p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
