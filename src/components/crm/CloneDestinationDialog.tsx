import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtMoney } from "@/lib/crm";
import { History, Copy, ArrowRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type CloneChoice = "same-lead" | "new-lead";

export type CloneDestinationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: {
    quote_no: string;
    total: number;
    customer_name?: string | null;
    lead_id?: string | null;
  };
  onChoose: (choice: CloneChoice) => void;
  onConfirmRevise?: () => void;
  className?: string;
};

export default function CloneDestinationDialog({
  open,
  onOpenChange,
  source,
  onChoose,
  onConfirmRevise,
  className,
}: CloneDestinationDialogProps) {
  const totalFmt = fmtMoney(Number(source.total || 0));

  const handleChoose = (choice: CloneChoice) => {
    onChoose(choice);
    if (choice === "same-lead" && onConfirmRevise) onConfirmRevise();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-w-[560px] rounded-xl border border-border bg-card p-0 overflow-hidden gap-0",
          className
        )}
      >
        <DialogHeader className="px-6 pt-6 pb-4 text-left space-y-2">
          <DialogTitle className="text-base font-semibold leading-none tracking-tight flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Copy className="h-4 w-4" />
            </span>
            Clone quotation?
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            This quotation is linked to a lead. Choose how the pipeline should be affected.
          </DialogDescription>
        </DialogHeader>

        {/* Source info */}
        <div className="mx-6 rounded-xl border bg-muted/30 px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="bg-white border-slate-200 text-slate-700 font-mono text-xs">
                {source.quote_no}
              </Badge>
              {source.customer_name && (
                <span className="text-sm text-slate-700 truncate max-w-[180px]">{source.customer_name}</span>
              )}
            </div>
            {source.lead_id && (
              <div className="mt-1 font-mono text-[11px] text-muted-foreground truncate">Lead {source.lead_id.slice(0, 8)}…</div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-base font-semibold tabular-nums">{totalFmt}</div>
          </div>
        </div>

        {/* Options */}
        <div className="px-6 py-4 space-y-3">
          {/* Revise — Same Deal */}
          <button
            type="button"
            onClick={() => handleChoose("same-lead")}
            className="group w-full text-left rounded-xl border-2 border-border bg-card p-4 hover:border-primary/30 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white group-hover:bg-primary transition-colors">
                <History className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Revise — Same Deal</span>
                  <Badge className="bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-50 text-[11px]">
                    No pipeline +
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Updates same lead — pipeline stays same ({totalFmt}). Full history trail kept.
                  <span className="font-medium text-slate-700"> Recommended for corrections.</span>
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  Continue on same lead <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </button>

          {/* Clone — New Deal */}
          <button
            type="button"
            onClick={() => handleChoose("new-lead")}
            className="group w-full text-left rounded-xl border-2 border-border bg-card p-4 hover:border-secondary/30 hover:bg-secondary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground group-hover:bg-secondary/90 transition-colors">
                <Copy className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Clone — New Deal</span>
                  <Badge className="bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-50 text-[11px]">
                    New opportunity
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Creates NEW lead + NEW opportunity — pipeline adds {totalFmt}.
                  <span className="font-medium text-slate-700"> Use for a separate deal.</span>
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-secondary">
                  Create new lead &amp; clone <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </div>
          </button>

          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>Pipeline impact:</strong> Same-deal revision keeps the lead&apos;s expected value in sync without
              duplicating the opportunity. New-deal clone adds a fresh pipeline entry.
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-6 py-3">
          <span className="text-xs text-muted-foreground">Choose an option above — you can cancel with Esc.</span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="rounded-md">
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { CloneDestinationDialog };
