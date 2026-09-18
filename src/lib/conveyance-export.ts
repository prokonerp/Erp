import type { ExportColumn } from "@/lib/exports";
import type { ConveyanceDayRow } from "@/lib/engineersAdmin";

/**
 * Export columns mirror the on-screen Eng-Ops day table (shared by the
 * conveyance page and the payables all-engineers view). Pure module — no
 * React — so the getters are unit-testable. Empty Places/Remarks render an
 * em dash (matching the table's "—"), never a blank that reads as missing;
 * Review always carries the Pending/Paid/Flagged status.
 */
export const DAY_EXPORT_COLUMNS: ExportColumn<ConveyanceDayRow>[] = [
  { header: "Date", get: (r) => r.date },
  { header: "Morning", get: (r) => r.morning ?? "" },
  { header: "Evening", get: (r) => r.evening ?? "" },
  { header: "Km", get: (r) => r.km ?? "" },
  { header: "Rate", get: (r) => r.rate ?? "" },
  { header: "Conveyance", get: (r) => r.conveyanceAmount },
  { header: "Charges", get: (r) => r.charges },
  { header: "Total", get: (r) => r.total },
  { header: "Places", get: (r) => (r.places.length > 0 ? r.places.join("; ") : "—") },
  { header: "Review", get: (r) => r.adminStatus },
  {
    header: "Remarks",
    get: (r) => (r.adminRemarks && r.adminRemarks.trim() !== "" ? r.adminRemarks : "—"),
  },
];
