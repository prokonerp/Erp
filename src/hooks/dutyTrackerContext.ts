import { createContext } from "react";

export type DutyPerm = "checking" | "granted" | "prompt" | "denied" | "revoked" | "unsupported";
export type DutyFailure = "unavailable" | "timeout" | null;

export type DutyTrackerValue = {
  onDuty: boolean;
  sessionId: string | null;
  consented: boolean;
  loading: boolean;
  queued: number;
  lastError: string | null;
  lastSeenAt: string | null;
  lastAccuracy: number | null;
  trackingEnabled: boolean;
  overrideActive: boolean;
  permission: DutyPerm;
  failure: DutyFailure;
  start: (deviceLabel?: string) => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
};

/** Shared by the provider (useDutyTracker.tsx) and the hook (useDutyTracker.ts). */
export const DutyTrackerCtx = createContext<DutyTrackerValue | null>(null);
