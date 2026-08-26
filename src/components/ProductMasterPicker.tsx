import { useEffect, useMemo, useState } from "react";
import { useProductsForPicker } from "@/hooks/useMasters";
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
import { Check, ChevronsUpDown, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { productShortName, productSearchBlob } from "@/lib/productNames";

export type ProductMaster = {
  id: string;
  sku: string | null;
  name: string;
  short_name?: string | null;
  display_name?: string | null;
  model: string | null;
  brand: string | null;
  category: string | null;
  hsn: string | null;
  unit: string | null;
  description: string | null;
  active: boolean | null;
  item_type?: string | null;
  serial_tracking?: boolean | null;
  is_serialized?: boolean | null;
  default_price?: number | null;
  weight_kg?: number | null;
  warranty_applicable?: boolean | null;
  warranty_duration?: number | null;
  warranty_unit?: string | null;
  warranty_start_from?: string | null;
};

type Props = {
  value?: string | null;
  onPick: (product: ProductMaster) => void;
  placeholder?: string;
  className?: string;
  /** Stock-related forms (GRN, DC, Transfers) must not offer Service items. */
  excludeServices?: boolean;
};

/**
 * Inline searchable product picker designed to live inside a row in an item table.
 * Calls onPick with the full product master record when a row is selected.
 */
export function ProductMasterPicker({
  value,
  onPick,
  placeholder = "Pick product…",
  className,
  excludeServices = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const { data: rowsData, isLoading } = useProductsForPicker(debounced);
  const rowsAll = (rowsData as any) ?? [];
  const rows = rowsAll.filter(
    (p: any) =>
      p.active !== false && (!excludeServices || (p.item_type ?? "product") !== "service"),
  ) as ProductMaster[];

  const [selectedFallback, setSelectedFallback] = useState<ProductMaster | null>(null);
  const selected = useMemo(
    () => rows.find((r) => r.id === value) || selectedFallback,
    [rows, value, selectedFallback],
  );
  useEffect(() => {
    if (!value || rows.find((r) => r.id === value) || selectedFallback?.id === value) return;
    let active = true;
    supabase
      .from("products")
      .select("id, name, model, short_name, display_name, brand, category, is_serialized, serial_tracking")
      .eq("id", value)
      .single()
      .then(({ data }) => {
        if (active && data) setSelectedFallback(data as unknown as ProductMaster);
      });
    return () => {
      active = false;
    };
  }, [value, rows, selectedFallback]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal h-9",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate text-xs">
            {selected ? productShortName(selected) : isLoading ? "Loading…" : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[360px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search part no, name, category…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
            ) : (
              <CommandEmpty>
                <div className="py-4 px-3 text-sm space-y-2">
                  <p className="text-muted-foreground">No matching product.</p>
                  <a
                    href="/masters/products"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Product{" "}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </CommandEmpty>
            )}
            <CommandGroup
              heading={debounced ? `${rows.length} matches` : `${rows.length} products`}
            >
              {rows.map((p) => {
                const blob = productSearchBlob(p);
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.id} ${blob}`}
                    onSelect={() => {
                      onPick(p);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{productShortName(p)}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {p.description || <span className="font-mono">{p.sku || "—"}</span>}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
