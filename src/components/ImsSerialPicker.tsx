import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SerialItem = {
  id: string;
  part_serial_no: string;
  part_model_no: string | null;
  part_name: string;
  warehouse_id: string | null;
  stock_type: "good" | "defective";
  stock_status: string;
};

type Props = {
  value?: string | null; // serial number
  onSelect: (item: SerialItem | null, serial: string) => void;
  /** Filter by part_model_no first; falls back to part_name */
  partModelNo?: string | null;
  partName?: string | null;
  stockType?: "good" | "defective";
  warehouseId?: string | null;
  /** Allow free-text entry when no inventory match exists (default false) */
  allowManual?: boolean;
  placeholder?: string;
  className?: string;
  /** When true, show empty option if no items */
  disabled?: boolean;
};

/**
 * Picker of available inventory serial numbers filtered to a model/part.
 * Only lists ims_stock_items where stock_status = 'available'.
 */
export function ImsSerialPicker({
  value, onSelect, partModelNo, partName, stockType, warehouseId,
  allowManual = false, placeholder = "Select available serial…", className, disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 150); return () => clearTimeout(t); }, [search]);

  // Bounded picker window: 25 on empty, 30 on search with server-side ilike — 6 cols, shouldFilter=false
  const COLS = "id,part_serial_no,part_model_no,part_name,warehouse_id,stock_type,stock_status";
  const enabled = !!partModelNo || !!partName;
  const { data: rowsData, isLoading: loading } = useQuery({
    queryKey: ["ims-serials", partModelNo, partName, stockType, warehouseId, debounced] as const,
    queryFn: async () => {
      const term = debounced.trim();
      let q = supabase
        .from("ims_stock_items")
        .select(COLS)
        .eq("stock_status", "available")
        .not("part_serial_no", "is", null);
      if (partModelNo) q = (q as any).eq("part_model_no", partModelNo);
      else if (partName) q = (q as any).eq("part_name", partName);
      if (stockType) q = (q as any).eq("stock_type", stockType);
      if (warehouseId) q = (q as any).eq("warehouse_id", warehouseId);
      if (term) {
        const p = `%${term}%`;
        q = (q as any).or(`part_serial_no.ilike.${p},part_model_no.ilike.${p},part_name.ilike.${p}`);
        const { data, error } = await (q as any).order("part_serial_no").limit(30);
        if (error) throw error;
        return (data || []) as unknown as SerialItem[];
      }
      const { data, error } = await (q as any).order("part_serial_no").limit(25);
      if (error) throw error;
      return (data || []) as unknown as SerialItem[];
    },
    enabled,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (rowsData as SerialItem[] | undefined) ?? [], [rowsData]);

  const handleSelect = useCallback((r: SerialItem) => {
    onSelect(r, r.part_serial_no);
    setOpen(false);
  }, [onSelect]);

  const selected = useMemo(() => rows.find((r) => r.part_serial_no === value) || null, [rows, value]);

  if (manual && allowManual) {
    return (
      <div className={cn("flex gap-2", className)}>
        <Input
          value={value || ""}
          onChange={(e) => onSelect(null, e.target.value)}
          placeholder="Serial number"
          className="font-mono"
        />
        <Button type="button" size="sm" variant="ghost" onClick={() => setManual(false)}>Pick</Button>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" disabled={disabled}
            className={cn("w-full justify-between font-mono", !selected && "text-muted-foreground font-normal")}
          >
            <span className="truncate">
              {value || (loading ? "Loading…" : (rows.length === 0 ? "No available serials" : placeholder))}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search serial…" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>
                <div className="py-4 px-3 text-sm text-muted-foreground">
                  No available inventory serial for this Model / Part.
                </div>
              </CommandEmpty>
              <CommandGroup heading={`${rows.length} available`}>
                {rows.map((r) => (
                  <CommandItem key={r.id} value={r.part_serial_no}
                    onSelect={() => handleSelect(r)}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === r.part_serial_no ? "opacity-100" : "opacity-0")} />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs truncate">{r.part_serial_no}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {r.stock_type} · {r.part_model_no || r.part_name}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {allowManual && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setManual(true)}>Type</Button>
      )}
    </div>
  );
}