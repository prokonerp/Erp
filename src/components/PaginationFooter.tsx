import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  page: number;
  pageSize: number;
  total: number | null;
  onPage: (p: number) => void;
  isFetching?: boolean;
};

export function PaginationFooter({ page, pageSize, total, onPage, isFetching }: Props) {
  const known = typeof total === "number";
  const totalPages = known ? Math.max(1, Math.ceil((total || 0) / pageSize)) : null;
  const from = page * pageSize + 1;
  const to = known ? Math.min((page + 1) * pageSize, total || 0) : (page + 1) * pageSize;
  const canPrev = page > 0;
  const canNext = known ? page + 1 < (totalPages || 1) : true;

  return (
    <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-3 py-1.5 text-xs">
      <div className="text-muted-foreground">
        {known && (total || 0) === 0 ? "No results" : (
          <>Showing <b>{from}</b>–<b>{to}</b>{known ? <> of <b>{total}</b></> : null}</>
        )}
        {isFetching ? <span className="ml-2 text-primary">Loading…</span> : null}
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" className="h-7" disabled={!canPrev} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="px-2 tabular-nums">
          {page + 1}{totalPages ? <span className="text-muted-foreground"> / {totalPages}</span> : null}
        </span>
        <Button size="sm" variant="outline" className="h-7" disabled={!canNext} onClick={() => onPage(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}