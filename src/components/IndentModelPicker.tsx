import { useEffect, useMemo, useState } from "react";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type Product = { id: string; name: string; model: string | null; active: boolean | null };

let cache: Product[] | null = null;
const listeners = new Set<(rows: Product[]) => void>();
async function loadProducts(force = false): Promise<Product[]> {
  if (cache && !force) return cache;
  const rows = await fetchAll<Product>("products", (q) =>
    q.select("id,name,model,active").order("model"),
  );
  cache = rows.filter((p) => p.active !== false);
  listeners.forEach((fn) => fn(cache!));
  return cache;
}

type Props = {
  value?: string;
  onPick: (p: { name: string; model: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

/** Model-only searchable picker sourced from the Product Master. Preserves
 *  any existing free-text model value (auto-populated legacy indents) by
 *  surfacing it at the top of the list. */
export function IndentModelPicker({ value = "", onPick, placeholder = "Select model…", disabled, className }: Props) {
  const [rows, setRows] = useState<Product[]>(cache || []);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadProducts().then((r) => { if (alive) setRows(r); }).catch(() => {});
    const fn = (r: Product[]) => setRows(r);
    listeners.add(fn);
    return () => { alive = false; listeners.delete(fn); };
  }, []);

  useEffect(() => {
    const onFocus = () => { loadProducts(true).catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: { model: string; name: string }[] = [];
    for (const r of rows) {
      const m = (r.model || "").trim();
      if (!m || seen.has(m.toLowerCase())) continue;
      seen.add(m.toLowerCase());
      out.push({ model: m, name: r.name || "" });
    }
    if (value && !seen.has(value.toLowerCase())) out.unshift({ model: value, name: "" });
    return out;
  }, [rows, value]);

  const addNewLink = (
    <a href="/masters/products" target="_blank" rel="noopener noreferrer"
       className="inline-flex items-center gap-1 text-primary hover:underline text-sm">
      <Plus className="h-3.5 w-3.5" /> Add New Model in Product Master <ExternalLink className="h-3 w-3" />
    </a>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" role="combobox" disabled={disabled}
          className={cn("w-full justify-between font-normal h-9", !value && "text-muted-foreground", className)}
        >
          <span className="truncate font-mono text-xs">{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[300px]" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search model…" />
          <CommandList>
            <CommandEmpty>
              <div className="py-3 px-3 space-y-2 text-sm">
                <p className="text-muted-foreground">No matching model.</p>
                {addNewLink}
              </div>
            </CommandEmpty>
            <CommandGroup heading={`${items.length} models`}>
              {items.map((it) => (
                <CommandItem
                  key={it.model}
                  value={`${it.model} ${it.name}`}
                  onSelect={() => { onPick({ name: it.name, model: it.model }); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value.toLowerCase() === it.model.toLowerCase() ? "opacity-100" : "opacity-0")} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">{it.model}</div>
                    {it.name && <div className="text-[11px] text-muted-foreground truncate">{it.name}</div>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <div className="border-t p-2">{addNewLink}</div>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}