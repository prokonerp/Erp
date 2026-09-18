import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/skeletons";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import {
  formatLastSeen,
  type LiveEngineer,
  type MovementWarning,
} from "@/hooks/useEngineerMovement";
import { isFixFresh, LOCATION_GRACE_MS } from "@/lib/field-location";
import { formatISTTime } from "@/lib/time";
import { supabase } from "@/integrations/supabase/client";
import { grantGateOverride, revokeGateOverride } from "@/lib/field-location.functions";

type OverrideRow = {
  id: string;
  employee_id: string;
  reason: string;
  expires_at: string;
};

const OVERRIDE_MINUTES = [15, 30, 60, 120] as const;

function isFreshLive(e: LiveEngineer, nowMs: number): boolean {
  return e.on_duty && isFixFresh(e.last_seen_at, nowMs, LOCATION_GRACE_MS);
}

/**
 * On-duty roster + the accessible list counterpart of the map (G6). Freshness
 * is always "last seen X ago" — a green pin never implies a live feed.
 * Includes the time-boxed manager override control (grant/revoke, audited).
 */
export function LiveRoster({
  roster,
  loading,
  warnings,
  selectedId,
  onSelect,
  nowMs,
  onChanged,
}: {
  roster: LiveEngineer[];
  loading: boolean;
  warnings: MovementWarning[];
  selectedId: string | null;
  onSelect: (employeeId: string | null) => void;
  nowMs: number;
  onChanged: () => void;
}) {
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [grantFor, setGrantFor] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number>(30);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOverrides = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- location tables pending generated types
      const { data, error } = await (supabase as any)
        .from("engineer_gate_overrides")
        .select("id, employee_id, reason, expires_at")
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString());
      if (error) throw error;
      setOverrides((data ?? []) as OverrideRow[]);
    } catch {
      // Overrides are auxiliary — the roster stays usable without them.
    }
  };

  useEffect(() => {
    void loadOverrides();
  }, []);

  const doGrant = async (employeeId: string) => {
    if (!reason.trim()) {
      toast.error("A reason is required for the override");
      return;
    }
    setBusy(true);
    try {
      const res = await grantGateOverride({
        data: { employee_id: employeeId, minutes, reason: reason.trim() },
      });
      toast.success(`Override granted until ${formatISTTime(res.expires_at)}`);
      setGrantFor(null);
      setReason("");
      await loadOverrides();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Grant failed");
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async (id: string) => {
    setBusy(true);
    try {
      await revokeGateOverride({ data: { id } });
      toast.success("Override revoked");
      await loadOverrides();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <TableSkeleton rows={6} colCount={3} />;
  if (roster.length === 0) {
    return (
      <>
        <AdminWarnings lists={[warnings]} />
        <EmptyState
          title="No engineers on duty"
          hint="Duty sessions appear here once engineers start duty in the portal."
        />
      </>
    );
  }

  return (
    <div className="space-y-2">
      <AdminWarnings lists={[warnings]} />
      <ul className="space-y-2" aria-label="Engineers on duty">
        {roster.map((e) => {
          const fresh = isFreshLive(e, nowMs);
          const active = selectedId === e.employee_id;
          const ov = overrides.find((o) => o.employee_id === e.employee_id);
          return (
            <li key={e.employee_id} className="rounded-xl border border-border bg-card">
              <button
                type="button"
                onClick={() => onSelect(active ? null : e.employee_id)}
                aria-pressed={active}
                aria-current={active ? "true" : undefined}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${fresh ? "bg-green-500" : "bg-muted-foreground/40"}`}
                  title={fresh ? "Fix inside the grace window" : "Stale or off duty"}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {e.name ?? "Unknown engineer"}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {e.on_duty ? "On duty" : "Off duty"} · last seen{" "}
                    {formatLastSeen(e.last_seen_at, nowMs)}
                    {e.last_accuracy_m != null && Number.isFinite(e.last_accuracy_m) && (
                      <> · ±{Math.round(e.last_accuracy_m)}m</>
                    )}
                  </span>
                </span>
                {e.on_duty ? (
                  fresh ? (
                    <StatusBadge tone="success">On duty</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Stale</StatusBadge>
                  )
                ) : (
                  <StatusBadge tone="neutral">Off</StatusBadge>
                )}
              </button>
              <div className="flex items-center gap-2 border-t border-border/60 px-3 py-1.5">
                {ov ? (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                    <span className="flex-1 truncate text-xs text-muted-foreground">
                      Override until {formatISTTime(ov.expires_at)} — {ov.reason}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void doRevoke(ov.id)}
                    >
                      Revoke
                    </Button>
                  </>
                ) : grantFor === e.employee_id ? (
                  <span className="flex flex-1 flex-wrap items-center gap-1.5 py-1">
                    <label className="sr-only" htmlFor={`ov-min-${e.employee_id}`}>
                      Override minutes
                    </label>
                    <select
                      id={`ov-min-${e.employee_id}`}
                      value={minutes}
                      onChange={(ev) => setMinutes(Number(ev.target.value))}
                      className="h-9 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {OVERRIDE_MINUTES.map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                    <label className="sr-only" htmlFor={`ov-why-${e.employee_id}`}>
                      Override reason
                    </label>
                    <input
                      id={`ov-why-${e.employee_id}`}
                      value={reason}
                      onChange={(ev) => setReason(ev.target.value)}
                      placeholder="Reason (required)"
                      maxLength={280}
                      className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                    />
                    <Button size="sm" disabled={busy} onClick={() => void doGrant(e.employee_id)}>
                      Grant
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setGrantFor(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <>
                    <span className="flex-1 text-xs text-muted-foreground">
                      {e.on_duty ? "Dead zone? Grant a time-boxed pass." : "Override control"}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setGrantFor(e.employee_id)}>
                      Override…
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
