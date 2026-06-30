import * as React from "react";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DateTimePickerProps {
  /** Accepts either ISO string or `YYYY-MM-DDTHH:mm` (datetime-local) */
  value?: string | null;
  onChange: (value: string) => void; // emits `YYYY-MM-DDTHH:mm` (local)
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  /** Minute step for the minutes dropdown (default 5) */
  minuteStep?: number;
}

function parseValue(v: string | null | undefined): Date | undefined {
  if (!v) return undefined;
  // Accept "YYYY-MM-DDTHH:mm" or full ISO; fall back to native Date parsing
  try {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const [d, t] = v.split("T");
      const [y, m, day] = d.split("-").map(Number);
      const [hh, mm] = t.split(":").map(Number);
      return new Date(y, (m || 1) - 1, day || 1, hh || 0, mm || 0);
    }
    return parseISO(v);
  } catch {
    return undefined;
  }
}

function toLocalString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick date & time",
  disabled,
  className,
  required,
  minuteStep = 5,
}: DateTimePickerProps) {
  const current = parseValue(value);
  const [open, setOpen] = React.useState(false);

  const hour24 = current ? current.getHours() : 9;
  const minute = current ? current.getMinutes() : 0;
  const hour12 = ((hour24 + 11) % 12) + 1;
  const ampm: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";

  const updateParts = (next: {
    date?: Date;
    hour12?: number;
    minute?: number;
    ampm?: "AM" | "PM";
  }) => {
    const base = current ? new Date(current) : new Date();
    // Default seconds/ms to 0 for stable values
    base.setSeconds(0, 0);
    if (next.date) {
      base.setFullYear(next.date.getFullYear(), next.date.getMonth(), next.date.getDate());
    } else if (!current) {
      // first interaction picks today
      const t = new Date();
      base.setFullYear(t.getFullYear(), t.getMonth(), t.getDate());
    }
    const h12 = next.hour12 ?? hour12;
    const m = next.minute ?? minute;
    const ap = next.ampm ?? ampm;
    let h24 = h12 % 12;
    if (ap === "PM") h24 += 12;
    base.setHours(h24, m, 0, 0);
    onChange(toLocalString(base));
  };

  const minutes = React.useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i < 60; i += minuteStep) arr.push(i);
    if (current && !arr.includes(minute)) arr.push(minute);
    return arr.sort((a, b) => a - b);
  }, [minuteStep, current, minute]);

  const displayLabel = current
    ? format(current, "dd MMM yyyy, hh:mm a")
    : placeholder;

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !current && "text-muted-foreground",
            required && !current && "border-destructive/40",
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">{displayLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={current}
          onSelect={(d) => d && updateParts({ date: d })}
          initialFocus
          className="pointer-events-auto"
        />
        <div className="border-t p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Time
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(hour12)} onValueChange={(v) => updateParts({ hour12: Number(v) })}>
              <SelectTrigger className="w-[72px]"><SelectValue placeholder="HH" /></SelectTrigger>
              <SelectContent searchable={false}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm font-medium">:</span>
            <Select value={String(minute)} onValueChange={(v) => updateParts({ minute: Number(v) })}>
              <SelectTrigger className="w-[72px]"><SelectValue placeholder="MM" /></SelectTrigger>
              <SelectContent searchable={false}>
                {minutes.map((m) => (
                  <SelectItem key={m} value={String(m)}>{String(m).padStart(2, "0")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={ampm} onValueChange={(v) => updateParts({ ampm: v as "AM" | "PM" })}>
              <SelectTrigger className="w-[72px]"><SelectValue /></SelectTrigger>
              <SelectContent searchable={false}>
                <SelectItem value="AM">AM</SelectItem>
                <SelectItem value="PM">PM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-between pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { onChange(""); setOpen(false); }}
            >
              Clear
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}