import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export type ImsModelPart = {
  id: string;
  name: string;
  model: string | null;
  brand: string | null;       // OEM
  category: string | null;
  productType: "Product" | "Spare Part";
};

type Props = {
  value?: string | null;            // product id
  onSelect: (item: ImsModelPart) => void;
  className?: string;
  placeholder?: string;
};

/**
 * Unified Model / Part selector for IMS. Lists all ACTIVE products and
 * spare parts from Product Master. Categorises items by category name —
 * "Spare Parts" → Spare Part, everything else → Product.
 */
export function ImsModelPartPicker({ value, onSelect, className, placeholder = "Search Model / Part…" }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImsModelPart[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchAll<any>("products", (q) =>
      q.select("id,name,model,brand,category,description,active").order("name"),
    )
      .then((data) => {
        if (!alive) return;
        const mapped: (ImsModelPart & { description?: string | null })[] = data
          .filter((p) => p.active !== false)
          .map((p) => ({
            id: p.id,
            name: p.name || p.model || "(unnamed)",
            model: p.model || null,
            brand: p.brand || null,
            category: p.category || null,
            description: p.description || null,
            productType: (p.category || "").toLowerCase().includes("spare") ? "Spare Part" : "Product",
          }));
        setRows(mapped as ImsModelPart[]);
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
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate flex items-center gap-2">
            {selected ? (
              <>
                <span className="font-medium">{selected.model || selected.name}</span>
                <Badge variant="outline" className="text-[10px]">{selected.productType}</Badge>
              </>
            ) : (loading ? "Loading…" : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[340px]" align="start">
        <Command filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search by model, name, OEM, category…" />
          <CommandList>
            <CommandEmpty>
              <div className="py-4 px-3 text-sm space-y-2">
                <p className="text-muted-foreground">No matching Model / Part.</p>
                <a href="/masters/products" target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add in Product Master
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CommandEmpty>
            <CommandGroup heading={`${rows.length} items (Products + Spare Parts)`}>
              {rows.map((p) => {
                const blob = `${p.model || ""} ${p.name} ${p.brand || ""} ${p.category || ""} ${p.productType}`.toLowerCase();
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.id} ${blob}`}
                    onSelect={() => { onSelect(p); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.model || p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {(p as any).description || "—"}
                      </div>
                    </div>
                    <Badge variant={p.productType === "Spare Part" ? "secondary" : "default"} className="ml-2 text-[10px]">
                      {p.productType}
                    </Badge>
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