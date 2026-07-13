import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProductMaster = {
  id: string;
  sku: string | null;
  name: string;
  model: string | null;
  brand: string | null;
  category: string | null;
  hsn: string | null;
  unit: string | null;
  description: string | null;
  active: boolean | null;
  serial_tracking?: boolean | null;
  default_price?: number | null;
  weight_kg?: number | null;
};

type Props = {
  value?: string | null;
  onPick: (product: ProductMaster) => void;
  placeholder?: string;
  className?: string;
};

/**
 * Inline searchable product picker designed to live inside a row in an item table.
 * Calls onPick with the full product master record when a row is selected.
 */
export function ProductMasterPicker({ value, onPick, placeholder = "Pick product…", className }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProductMaster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchAll<ProductMaster>("products", (q) =>
      q.select("id,sku,name,model,brand,category,hsn,unit,description,active,serial_tracking,default_price,weight_kg").order("name"),
    )
      .then((data) => {
        if (!alive) return;
        setRows(data.filter((p) => p.active !== false));
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const selected = useMemo(() => rows.find((r) => r.id === value) || null, [rows, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal h-9", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate text-xs">
            {selected
              ? `${selected.sku || selected.model || "—"} · ${selected.name}`
              : (loading ? "Loading…" : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[360px]" align="start">
        <Command filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search part no, name, category…" />
          <CommandList>
            <CommandEmpty>
              <div className="py-4 px-3 text-sm space-y-2">
                <p className="text-muted-foreground">No matching product.</p>
                <a href="/masters/products" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add Product <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CommandEmpty>
            <CommandGroup heading={`${rows.length} products`}>
              {rows.map((p) => {
                const blob = [p.sku, p.model, p.name, p.category, p.brand].filter(Boolean).join(" ").toLowerCase();
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.id} ${blob}`}
                    onSelect={() => { onPick(p); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        <span className="font-mono">{p.sku || p.model || "—"}</span>
                        <span className="ml-2">{p.name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[p.category, p.brand, p.hsn ? `HSN ${p.hsn}` : null, p.unit].filter(Boolean).join(" · ")}
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