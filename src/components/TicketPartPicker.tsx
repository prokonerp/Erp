import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export type TicketPart = {
  id: string;
  name: string;
  model: string | null;
  brand: string | null;
  category: string | null;
  productType: "Product" | "Spare Part";
};

type Props = {
  /** Ticket's product name/model (free text from tickets.product) */
  ticketProduct?: string | null;
  value?: string | null; // model_no | name currently displayed
  onSelect: (item: TicketPart) => void;
  className?: string;
  disabled?: boolean;
};

/**
 * Parts Used picker: limits options to the ticket's parent product (Product
 * Master) PLUS all spare parts linked to that parent via product_spare_parts.
 * Falls back to all active products + spare parts when the ticket's product
 * cannot be resolved to a Product Master entry.
 */
export function TicketPartPicker({ ticketProduct, value, onSelect, className, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<TicketPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const sb = supabase as any;
      const { data: prods } = await sb.from("products")
        .select("id,name,model,brand,category,active").eq("active", true);
      const all = (prods || []) as any[];
      const toPart = (p: any): TicketPart => ({
        id: p.id, name: p.name, model: p.model, brand: p.brand, category: p.category,
        productType: (p.category || "").toLowerCase().includes("spare") ? "Spare Part" : "Product",
      });

      let parent: any = null;
      if (ticketProduct) {
        const tp = ticketProduct.trim().toLowerCase();
        parent = all.find((p) => (p.model || "").toLowerCase() === tp)
          || all.find((p) => (p.name || "").toLowerCase() === tp);
      }

      if (!parent) {
        if (!alive) return;
        setRows(all.map(toPart));
        setFallback(true);
        setLoading(false);
        return;
      }

      const { data: links } = await sb.from("product_spare_parts")
        .select("spare_part_id").eq("parent_product_id", parent.id);
      const spareIds = new Set(((links || []) as any[]).map((l) => l.spare_part_id));
      const out: TicketPart[] = [toPart(parent), ...all.filter((p) => spareIds.has(p.id)).map(toPart)];
      if (!alive) return;
      setRows(out);
      setFallback(false);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [ticketProduct]);

  const selected = useMemo(
    () => rows.find((r) => r.model === value || r.name === value) || null,
    [rows, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate flex items-center gap-2">
            {selected ? (
              <>
                <span className="font-medium">{selected.model || selected.name}</span>
                <Badge variant="outline" className="text-[10px]">{selected.productType}</Badge>
              </>
            ) : (loading ? "Loading…" : (value || "Select Part / Item…"))}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
        <Command filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search compatible parts…" />
          <CommandList>
            <CommandEmpty>
              <div className="py-3 px-3 text-sm text-muted-foreground">
                No compatible parts found for this ticket's product.
                <a href="/masters/products" target="_blank" rel="noopener noreferrer"
                   className="ml-1 inline-flex items-center gap-1 text-primary hover:underline">
                  Link spare parts <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CommandEmpty>
            <CommandGroup heading={fallback
              ? `All Products & Spare Parts (${rows.length}) — ticket product not in Master`
              : `Compatible (${rows.length})`}>
              {rows.map((p) => {
                const blob = `${p.model || ""} ${p.name} ${p.brand || ""} ${p.productType}`.toLowerCase();
                return (
                  <CommandItem key={p.id} value={`${p.id} ${blob}`}
                    onSelect={() => { onSelect(p); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selected?.id === p.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.model || p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[p.brand, p.category].filter(Boolean).join(" · ") || "—"}
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