import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Check, Flag } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignedFileLink } from "@/components/engineer/SignedFileLink";
import { setEngineerDayReview } from "@/lib/engineer-day-review.functions";
import { reportDbError } from "@/lib/format-error";
import type { ConveyanceDayRow, DayAdminStatus } from "@/lib/engineersAdmin";

// Single source of truth lives in @/lib/conveyance-export (pure, tested);
// re-exported here so existing table consumers keep working.
export { DAY_EXPORT_COLUMNS } from "@/lib/conveyance-export";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function ReviewTone(status: DayAdminStatus): "success" | "danger" | "neutral" {
  if (status === "Paid") return "success";
  if (status === "Flagged") return "danger";
  return "neutral";
}

function ReadingCell({
  value,
  photo,
  kind,
  date,
}: {
  value: number | null;
  photo: string | null;
  kind: "morning" | "evening";
  date: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      <span>{value == null ? "—" : value}</span>
      {photo && (
        <SignedFileLink
          path={photo}
          label="view"
          title={`Open ${kind} reading photo for ${date}`}
        />
      )}
    </span>
  );
}

type PendingReview = { row: ConveyanceDayRow; action: "Paid" | "Flagged" };

function DayReviewDialog({
  pending,
  remarks,
  setRemarks,
  busy,
  onClose,
  onConfirm,
}: {
  pending: PendingReview | null;
  remarks: string;
  setRemarks: (v: string) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isFlag = pending?.action === "Flagged";
  return (
    <Dialog open={pending !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isFlag ? "Flag" : "Pay"} {pending?.row.date}
          </DialogTitle>
          <DialogDescription>
            {isFlag
              ? `Flag ${pending?.row.date} for ${inr(pending?.row.total ?? 0)} — a remark is required.`
              : `Mark ${pending?.row.date} (${inr(pending?.row.total ?? 0)}) as paid. Remarks are optional.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="day-review-remarks" className="text-xs">
            Remarks{isFlag ? " (required)" : " (optional)"}
          </Label>
          <Textarea
            id="day-review-remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            placeholder={isFlag ? "Why is this day flagged…" : "Optional note…"}
            className="text-sm"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={busy || (isFlag && remarks.trim() === "")}
            className={isFlag ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
          >
            {busy ? "Saving…" : isFlag ? "Save flag" : "Mark paid"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConveyanceDayTable({
  engineerId,
  rows,
  isLoading,
  onReviewChanged,
}: {
  engineerId: string | null;
  rows: ConveyanceDayRow[];
  isLoading: boolean;
  onReviewChanged: () => void;
}) {
  const callReview = useServerFn(setEngineerDayReview);
  const [pending, setPending] = useState<PendingReview | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  function openReview(row: ConveyanceDayRow, action: "Paid" | "Flagged") {
    setPending({ row, action });
    setRemarks(row.adminRemarks ?? "");
  }

  async function confirm() {
    if (!pending || !engineerId) return;
    if (pending.action === "Flagged" && remarks.trim() === "") {
      toast.error("Flagging a day needs a remark.");
      return;
    }
    setBusy(true);
    try {
      await callReview({
        data: {
          employee_id: engineerId,
          log_date: pending.row.date,
          status: pending.action,
          remarks: remarks.trim() === "" ? undefined : remarks.trim(),
        },
      });
      toast.success(
        pending.action === "Paid"
          ? `Paid ${pending.row.date}.`
          : `Flagged ${pending.row.date}.`,
      );
      setPending(null);
      setRemarks("");
      onReviewChanged();
    } catch (e) {
      toast.error(reportDbError("day review", e, "Could not save the review"));
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnDef<ConveyanceDayRow>[] = [
    {
      key: "date",
      header: "Date",
      sortable: true,
      render: (r) => <span className="font-mono text-xs">{r.date}</span>,
    },
    {
      key: "morning",
      header: "Morning",
      align: "right",
      render: (r) => (
        <ReadingCell value={r.morning} photo={r.morningPhoto} kind="morning" date={r.date} />
      ),
    },
    {
      key: "evening",
      header: "Evening",
      align: "right",
      render: (r) => (
        <ReadingCell value={r.evening} photo={r.eveningPhoto} kind="evening" date={r.date} />
      ),
    },
    {
      key: "km",
      header: "Km",
      align: "right",
      sortable: true,
      render: (r) => (
        <span className="tabular-nums">{r.km == null ? "—" : r.km.toFixed(1)}</span>
      ),
    },
    {
      key: "places",
      header: "Places visited",
      render: (r) =>
        r.places.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="block max-w-44 truncate text-xs" title={r.places.join(", ")}>
            {r.places.join(", ")}
          </span>
        ),
    },
    {
      key: "conveyance",
      header: "Conveyance",
      align: "right",
      render: (r) => (
        <span className="inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums">
          <span>{inr(r.conveyanceAmount)}</span>
          <span className="text-[11px] font-normal text-muted-foreground">
            {r.rate == null ? "no rate" : `@₹${r.rate}`}
          </span>
        </span>
      ),
    },
    {
      key: "charges",
      header: "Charges",
      align: "right",
      render: (r) => <span className="tabular-nums">{inr(r.charges)}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortable: true,
      render: (r) => <span className="font-semibold tabular-nums">{inr(r.total)}</span>,
    },
    {
      key: "review",
      header: "Review",
      render: (r) => (
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap"
          title={r.adminRemarks ?? undefined}
        >
          <StatusBadge tone={ReviewTone(r.adminStatus)}>{r.adminStatus}</StatusBadge>
          {r.flags.includes("negative-km") && <StatusBadge tone="danger">Reversal</StatusBadge>}
          {r.flags.includes("km-outlier") && <StatusBadge tone="warning">Outlier</StatusBadge>}
          {r.flags.includes("missing-reading") && r.hasLog && (
            <StatusBadge tone="warning">Missing</StatusBadge>
          )}
        </span>
      ),
    },
    {
      key: "action",
      header: "Pay / Flag",
      align: "right",
      render: (r) =>
        !r.hasLog ? (
          <span className="text-[11px] text-muted-foreground" title="No log row for this date">
            —
          </span>
        ) : (
          <span className="inline-flex gap-1">
            <button
              type="button"
              onClick={() => openReview(r, "Paid")}
              title={`Mark ${r.date} paid`}
              aria-label={`Mark ${r.date} paid`}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-emerald-300 px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              Pay
            </button>
            <button
              type="button"
              onClick={() => openReview(r, "Flagged")}
              title={`Flag ${r.date} with a remark`}
              aria-label={`Flag ${r.date} with a remark`}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-amber-300 px-2 text-xs font-medium text-amber-700 hover:bg-amber-50"
            >
              <Flag className="h-3.5 w-3.5" aria-hidden />
              Flag
            </button>
          </span>
        ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowKey="date"
        // table-auto (overrides table-fixed via tailwind-merge) so columns
        // size to content and every day stays on one line; wrapper scrolls.
        className="table-auto min-w-[1100px]"
        emptyIcon={CalendarDays}
        emptyTitle="No conveyance days in this window"
        emptyHint="Pick an engineer or a different period."
      />
      <DayReviewDialog
        pending={pending}
        remarks={remarks}
        setRemarks={setRemarks}
        busy={busy}
        onClose={() => {
          setPending(null);
          setRemarks("");
        }}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
