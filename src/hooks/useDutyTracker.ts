import { useContext } from "react";
import { DutyTrackerCtx, type DutyTrackerValue } from "@/hooks/dutyTrackerContext";

export type { DutyFailure, DutyPerm, DutyTrackerValue } from "@/hooks/dutyTrackerContext";

export function useDutyTracker(): DutyTrackerValue {
  const v = useContext(DutyTrackerCtx);
  if (!v) throw new Error("useDutyTracker must be used inside <DutyTrackerProvider>");
  return v;
}
