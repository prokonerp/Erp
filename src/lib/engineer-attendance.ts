// Pure attendance decisions for the engineer "Start duty" action.
//
// Dependency-free (no React, no Supabase, no DOM) so it is unit-testable in
// plain node. All I/O — reading the existing attendance row, checking the
// payroll lock, writing the row — lives in the server fn; this module only
// decides *what* that write should be, if any.
//
// Product decisions encoded here (do not "improve" these away):
//  - Presence only. No work_hours, no duration, no time-worked is ever
//    recorded or surfaced — the engineer must never learn how long they
//    worked. `work_hours` stays null.
//  - Insert-only. An existing attendance row is never overwritten, so an
//    admin's payroll entry (leave, half-day, absent) survives a duty start.
//  - Locked payroll periods are left untouched.

import { istDayKeyFromMs } from "@/lib/field-location";

/** Attendance code for a plain present day (matches the table default). */
export const ATTENDANCE_PRESENT_CODE = "P";

/**
 * IST calendar date (YYYY-MM-DD) for a unix-ms instant. Delegates to the
 * shared field-location day key so duty presence and the duty session agree
 * on what "today" means.
 */
export function istWorkDate(ms: number = Date.now()): string {
  return istDayKeyFromMs(ms);
}

/**
 * True when the IST calendar weekday is Sunday. IST is a fixed UTC+5:30 with
 * no DST, so the day key is already the shifted UTC day — derive the weekday
 * from that key, never from the device's local timezone (a device on any
 * other zone would otherwise disagree with payroll).
 */
export function isSundayIst(ms: number = Date.now()): boolean {
  return new Date(`${istWorkDate(ms)}T00:00:00Z`).getUTCDay() === 0;
}

export type DutyAttendancePlan =
  | { write: false; reason: "month_locked" | "already_recorded" }
  | {
      write: true;
      row: {
        employee_id: string;
        work_date: string;
        code: "P";
        day_value: 1;
        is_sunday: boolean;
        work_hours: null;
      };
    };

/**
 * Decide the attendance write for a duty start. Order is load-bearing:
 * 1. a locked payroll period wins outright — nothing is written even if the
 *    day is unrecorded;
 * 2. any existing row (leave, half-day, absent, or an early presence mark)
 *    is authoritative — duty start never clobbers an admin's payroll entry;
 * 3. otherwise a plain present row is written, with no hours.
 */
export function planDutyAttendance(input: {
  employeeId: string;
  workDate: string;
  isSunday: boolean;
  existingCode: string | null;
  monthLocked: boolean;
}): DutyAttendancePlan {
  if (input.monthLocked) return { write: false, reason: "month_locked" };
  if (input.existingCode !== null) return { write: false, reason: "already_recorded" };
  return {
    write: true,
    row: {
      employee_id: input.employeeId,
      work_date: input.workDate,
      code: "P",
      day_value: 1,
      is_sunday: input.isSunday,
      work_hours: null,
    },
  };
}
