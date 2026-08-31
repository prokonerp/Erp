import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProductsForPicker } from "@/hooks/useMasters";
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
  description?: string | null;
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

const TicketPartRow = memo(function TicketPartRow({ part, selectedId, onSelect }: { part: TicketPart; selectedId: string | null; onSelect: (p: TicketPart) => void }) {
  const blob = `${part.model || ""} ${part.name} ${part.brand || ""} ${part.productType}`.toLowerCase();
  return (
    <CommandItem value={`${part.id} ${blob}`} onSelect={() => onSelect(part)}>
      <Check className={cn("mr-2 h-4 w-4", selectedId === part.id ? "opacity-100" : "opacity-0")} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{part.model || "—"}</div>
        <div className="text-xs text-muted-foreground truncate">{part.description || "—"}</div>
      </div>
      <Badge variant={part.productType === "Spare Part" ? "secondary" : "default"} className="ml-2 text-[10px]">{part.productType}</Badge>
    </CommandItem>
  );
});

/**
 * Parts Used picker: limits options to the ticket's parent product (Product
 * Master) PLUS all spare parts linked to that parent via product_spare_parts.
 * Falls back to all active products + spare parts when the ticket's product
 * cannot be resolved to a Product Master entry.
 */
export function TicketPartPicker({ ticketProduct, value, onSelect, className, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search), 150); return () => clearTimeout(t); }, [search]);

  // Server-filtered picker window (25/30, explicit cols) — replaces fetchAll 235 full scan
  const { data: pickerData, isLoading: pickerLoading } = useProductsForPicker(debounced);
  const pickerAll = useMemo(() => ((pickerData as any) ?? []) as any[], [pickerData]);

  const [parent, setParent] = useState<any>(null);
  const [spareIds, setSpareIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false);

  // Resolve parent product for ticketProduct via targeted server query (bounded 1 row) + fetch its spare links with explicit cols + limit 500
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      let resolved: any = null;
      if (ticketProduct) {
        const tp = ticketProduct.trim();
        if (tp) {
          const { data: d2 } = await supabase.from("products").select("id,name,model,brand,category,description,active").eq("active", true).ilike("model", tp).limit(1) as any;
          resolved = (d2 && d2[0]) || null;
          if (!resolved) {
            const { data: d3 } = await supabase.from("products").select("id,name,model,brand,category,description,active").eq("active", true).ilike("name", tp).limit(1) as any;
            resolved = (d3 && d3[0]) || null;
          }
        }
      }
      if (!alive) return;
      if (!resolved) {
        setParent(null);
        setSpareIds(new Set());
        setFallback(true);
        setLoading(false);
        return;
      }
      setParent(resolved);
      // Fetch spare parts links with explicit cols + limit 500 (not select "*")
      const { data: links } = await (supabase as any).from("product_spare_parts").select("product_id,spare_product_id").eq("parent_product_id", resolved.id).limit(500) as any;
      // Fallback to legacy spare_part_id col if new cols not present
      const ids = new Set<string>((links || []).map((l: any) => l.spare_product_id || l.spare_part_id).filter(Boolean));
      // If schema uses spare_part_id only, try alternate column
      if (ids.size === 0) {
        const { data: legacy } = await (supabase as any).from("product_spare_parts").select("spare_part_id").eq("parent_product_id", resolved.id).limit(500) as any;
        (legacy || []).forEach((l: any) => { if (l.spare_part_id) ids.add(l.spare_part_id); });
      }
      if (!alive) return;
      setSpareIds(ids);
      setFallback(false);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [ticketProduct]);

  const [extraSpares, setExtraSpares] = useState<any[]>([]);
  useEffect(() => {
    if (!parent || spareIds.size === 0) { setExtraSpares([]); return; }
    const missing = Array.from(spareIds).filter((id) => !pickerAll.some((p: any) => p.id === id));
    if (!missing.length) { setExtraSpares([]); return; }
    supabase.from("products").select("id,name,model,brand,category,description").in("id", missing).limit(30).then(({ data }) => setExtraSpares((data || []) as any[]));
  }, [parent, spareIds, pickerAll]);

  const rows: TicketPart[] = useMemo(() => {
    const toPart = (p: any): TicketPart => ({
      id: p.id, name: p.name, model: p.model, brand: p.brand, category: p.category, description: p.description,
      productType: (p.category || "").toLowerCase().includes("spare") ? "Spare Part" : "Product",
    });
    if (!parent) {
      // Fallback: show picker window (25/30) — fallback flag indicates ticket product not in Master
      return pickerAll.map(toPart);
    }
    const out: TicketPart[] = [toPart(parent)];
    for (const p of pickerAll) if (spareIds.has(p.id)) out.push(toPart(p));
    for (const p of extraSpares) if (spareIds.has((p as any).id)) out.push(toPart(p as any));
    // De-dupe by id
    const seen = new Set<string>();
    return out.filter((r) => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  }, [pickerAll, parent, spareIds, extraSpares]);

  const selected = useMemo(
    () => rows.find((r) => r.model === value || r.name === value) || extraSpares.map((p: any) => ({ id: p.id, model: p.model, name: p.name } as any)).find((r: any) => r.model === value || r.name === value) || null,
    [rows, extraSpares, value],
  );
  const isLoading = pickerLoading || loading;

  const handleSelect = useCallback((p: TicketPart) => { onSelect(p); setOpen(false); }, [onSelect]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate flex items-center gap-2">
            {selected ? (
              <>
                <span className="font-medium">{selected.model || (selected as any).description || "—"}</span>
                <Badge variant="outline" className="text-[10px]">{(selected as any).productType || "—"}</Badge>
              </>
            ) : (isLoading ? "Loading…" : (value || "Select Part / Item…"))}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search compatible parts…" value={search} onValueChange={setSearch} />
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
              {rows.map((p) => (
                <TicketPartRow key={p.id} part={p} selectedId={selected?.id ?? null} onSelect={handleSelect} />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}