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
  name: string;
  unit: string;
  category?: string | null;
  brand?: string | null;
  model?: string | null;
  hsn?: string | null;
  default_price?: number | null;
  description?: string | null;
  active?: boolean | null;
};

type Props = {
  value: string | null | undefined; // product_id
  onChange: (id: string | null, product: ProductMaster | null) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
};

export function ProductPicker({ value, onChange, required, placeholder = "Search by model name…", className }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProductMaster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchAll<ProductMaster>("products", (q) => q.select("*").order("name"))
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
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", required && !selected && "border-destructive/40", className)}
        >
          <span className="truncate">
            {selected ? (
              <span className="font-medium">{selected.description || selected.name}</span>
            ) : (loading ? "Loading models…" : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
        <Command
          filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder="Search model name…" />
          <CommandList>
            <CommandEmpty>
              <div className="py-4 px-3 text-sm space-y-2">
                <p className="text-muted-foreground">No matching product.</p>
                <a
                  href="/masters/products"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Add New Product
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CommandEmpty>
            <CommandGroup heading={`${rows.length} models`}>
              {rows.map((p) => {
                const blob = `${p.model || ""} ${p.name}`.toLowerCase();
                return (
                  <CommandItem
                    key={p.id}
                    value={`${p.id} ${blob}`}
                    onSelect={() => { onChange(p.id, p); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.description || p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[p.model, p.name].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          <div className="border-t p-2">
            <a
              href="/masters/products"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline px-2 py-1"
            >
              <Plus className="h-3.5 w-3.5" /> Add New Product in Masters
              <ExternalLink className="h-3 w-3 ml-auto" />
            </a>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}