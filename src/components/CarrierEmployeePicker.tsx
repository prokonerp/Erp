import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Truck, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CarrierEmployeeChoice } from "@/lib/carrierEmployee";

type Props = {
  value: string | null;
  onSelect: (emp: CarrierEmployeeChoice) => void;
  onClear: () => void;
  placeholder?: string;
  label?: string;
};

/**
 * Carrier picker — FK-first with text fallback.
 * Lists assignable_engineers view (id,name,phone,department,role,active),
 * active first. Selecting fires onSelect (caller sets carrier_employee_id +
 * auto-fills driver text); clearing fires onClear (FK NULL, text stays editable
 * so the server trigger can resolve FK from text).
 * Keyboard-accessible via shadcn Command (type-to-filter, arrows + enter).
 */
export function CarrierEmployeePicker({
  value,
  onSelect,
  onClear,
  placeholder = "Pick carrier / driver…",
  label = "Carrier (employee link)",
}: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CarrierEmployeeChoice[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from("assignable_engineers")
          .select("id,name,phone,department,role,active")
          .order("name");
        if (!alive) return;
        const list = ((data as CarrierEmployeeChoice[] | null) || []).filter(
          (r) => r?.id && r?.name,
        );
        setRows(list);
      } catch {
        /* noop — picker stays empty, text fallback remains usable */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Reflect the currently-linked FK as a label (resolved on load / select).
  useEffect(() => {
    if (!value) {
      setSelectedName(null);
      return;
    }
    const hit = rows.find((r) => r.id === value);
    if (hit) setSelectedName(hit.name);
  }, [value, rows]);

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className={cn("flex-1 justify-between font-normal h-9 text-xs")}
          >
            <span className="inline-flex items-center gap-1.5 truncate">
              <Truck className="h-3.5 w-3.5 opacity-60" />
              {loading ? "Loading…" : selectedName || placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]"
          align="start"
        >
          <Command
            filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
          >
            <CommandInput
              placeholder="Search carrier by name or phone…"
              aria-label="Search carrier"
            />
            <CommandList>
              <CommandEmpty>No matching carrier.</CommandEmpty>
              <CommandGroup heading={`${rows.length} carrier${rows.length === 1 ? "" : "s"}`}>
                {rows.map((c) => {
                  const blob = [c.name, c.phone].filter(Boolean).join(" ").toLowerCase();
                  return (
                    <CommandItem
                      key={c.id}
                      value={`${c.id} ${blob}`}
                      onSelect={() => {
                        onSelect(c);
                        setSelectedName(c.name);
                        setOpen(false);
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        {c.phone && (
                          <div className="text-xs text-muted-foreground truncate">{c.phone}</div>
                        )}
                      </div>
                      {value === c.id && (
                        <span className="text-[10px] uppercase tracking-wide text-primary">
                          Linked
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onClear();
            setSelectedName(null);
          }}
          aria-label="Clear linked carrier (keep driver text)"
          title="Clear linked carrier (keep driver text)"
          className="h-9 px-2"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
