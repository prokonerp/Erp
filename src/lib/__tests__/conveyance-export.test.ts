// Export-column getter contract: Review always carries a status (never
// blank), empty Places/Remarks render "—" (never a blank that reads as
// missing). Guards the payables/conveyance export against blank-cell drift.

import { describe, it, expect } from "vitest";
import { DAY_EXPORT_COLUMNS } from "@/lib/conveyance-export";
import { conveyanceDayRows } from "@/lib/engineersAdmin";

const get = (header: string, row: Parameters<(typeof DAY_EXPORT_COLUMNS)[number]["get"]>[0]) => {
  const col = DAY_EXPORT_COLUMNS.find((c) => c.header === header);
  if (!col) throw new Error(`missing export column: ${header}`);
  return col.get(row);
};

describe("conveyance-export/DAY_EXPORT_COLUMNS", () => {
  const rates = [{ employee_id: "e1", rate_per_km: 10, effective_from: "2026-09-01" }];

  it("emits all 11 headers in table order", () => {
    expect(DAY_EXPORT_COLUMNS.map((c) => c.header)).toEqual([
      "Date",
      "Morning",
      "Evening",
      "Km",
      "Rate",
      "Conveyance",
      "Charges",
      "Total",
      "Places",
      "Review",
      "Remarks",
    ]);
  });

  it("emits full values for a complete row, Review never blank", () => {
    const [row] = conveyanceDayRows({
      employeeId: "e1",
      rates,
      days: [
        {
          log_date: "2026-09-17",
          morning_odometer: 5565,
          evening_odometer: 5576,
          admin_status: "Paid",
          admin_remarks: "ok",
        },
      ],
      expenses: [{ expense_date: "2026-09-17", charge_type: "Toll", amount: 0, receipt_path: null }],
      placeVisits: [
        { visited_at: "2026-09-17T05:30:00.000Z", note: "ABC Motors" },
        { visited_at: "2026-09-17T06:00:00.000Z", note: "XYZ Plant" },
      ],
    });
    expect(get("Date", row)).toBe("2026-09-17");
    expect(get("Morning", row)).toBe(5565);
    expect(get("Km", row)).toBe(11);
    expect(get("Conveyance", row)).toBe(110);
    expect(get("Total", row)).toBe(110);
    expect(get("Places", row)).toBe("ABC Motors; XYZ Plant");
    expect(get("Review", row)).toBe("Paid");
    expect(get("Remarks", row)).toBe("ok");
  });

  it("renders em dashes (never blanks) for empty Places/Remarks, Review still set", () => {
    const [row] = conveyanceDayRows({
      employeeId: "e1",
      rates,
      days: [{ log_date: "2026-09-17", morning_odometer: 5565, evening_odometer: 5576 }],
      expenses: [],
      placeVisits: [],
    });
    expect(get("Places", row)).toBe("—");
    expect(get("Review", row)).toBe("Pending");
    expect(get("Remarks", row)).toBe("—");
  });
});
