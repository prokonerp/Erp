import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarRange } from "lucide-react";
import type { DateRange, RangeMode } from "@/lib/dateRange";
import { currentMonth, currentWeek, resolveRange } from "@/lib/dateRange";

type Props = {
  mode: RangeMode;
  setMode: (m: RangeMode) => void;
  range: DateRange;
  setRange: (r: DateRange) => void;
};

export function DateFilterBar({ mode, setMode, range, setRange }: Props) {
  const effective = resolveRange(mode, range);
  const Chip = ({ m, label }: { m: RangeMode; label: string }) => (
    <Button
      type="button"
      size="sm"
      variant={mode === m ? "default" : "outline"}
      onClick={() => {
        setMode(m);
        if (m === "week") setRange(currentWeek());
        if (m === "month") setRange(currentMonth());
      }}
    >
      {label}
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2">
      <CalendarRange className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Date filter</span>
      <Chip m="all" label="All" />
      <Chip m="week" label="Current Week" />
      <Chip m="month" label="Current Month" />
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant={mode === "custom" ? "default" : "outline"} onClick={() => setMode("custom")}>
            Custom Range
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3 space-y-2" align="start">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-8 w-44" />
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-8 w-44" />
          </div>
        </PopoverContent>
      </Popover>
      <span className="ml-auto text-xs text-muted-foreground font-mono">{effective.from} → {effective.to}</span>
    </div>
  );
}