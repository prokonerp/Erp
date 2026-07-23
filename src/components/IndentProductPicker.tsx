import { useEffect, useMemo, useState } from "react";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type Product = {
  id: string;
  name: string;
  model: string | null;
  brand: string | null;
  active: boolean | null;
};

/** Cache products in-module so multiple pickers on one form share one fetch,
 *  and re-open picks up newly added products after a lightweight refetch. */
let cache: Product[] | null = null;
const listeners = new Set<(rows: Product[]) => void>();
async function loadProducts(force = false): Promise<Product[]> {
  if (cache && !force) return cache;
  const rows = await fetchAll<Product>("products", (q) =>
    q.select("id,name,model,brand,active").order("name"),
  );
  cache = rows.filter((p) => p.active !== false);
  listeners.forEach((fn) => fn(cache!));
  return cache;
}

type Props = {
  /** Currently saved product name (auto-populated from defective row). */
  productValue?: string;
  /** Currently saved model no. */
  modelValue?: string;
  onPick: (p: { name: string; model: string }) => void;
  productPlaceholder?: string;
  modelPlaceholder?: string;
  disabled?: boolean;
  className?: string;
};

/** Two-step Product → Model picker backed by the Product Master.
 *  Step 1: pick a Product (distinct names). Step 2: pick a Model belonging
 *  to that Product. Both dropdowns are searchable; an "+ Add New Product"
 *  link opens the Product Master in a new tab and, on return, refreshes the
 *  list so newly added rows appear immediately. */
export function IndentProductPicker({
  productValue = "",
  modelValue = "",
  onPick,
  productPlaceholder = "Select product…",
  modelPlaceholder = "Select model…",
  disabled,
  className,
}: Props) {
  const [rows, setRows] = useState<Product[]>(cache || []);
  const [pOpen, setPOpen] = useState(false);
  const [mOpen, setMOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadProducts().then((data) => { if (alive) setRows(data); }).catch(() => {});
    const fn = (r: Product[]) => setRows(r);
    listeners.add(fn);
    return () => { alive = false; listeners.delete(fn); };
  }, []);

  // Refresh when the picker regains focus (user returned from Product Master tab).
  useEffect(() => {
    const onFocus = () => { loadProducts(true).catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const productNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const n = (r.name || "").trim();
      if (!n || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      out.push(n);
    }
    // Ensure the currently-saved name renders even if not in master.
    if (productValue && !seen.has(productValue.toLowerCase())) out.unshift(productValue);
    return out;
  }, [rows, productValue]);

  const modelsForProduct = useMemo(() => {
    if (!productValue) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      if ((r.name || "").toLowerCase() !== productValue.toLowerCase()) continue;
      const m = (r.model || "").trim();
      if (!m || seen.has(m.toLowerCase())) continue;
      seen.add(m.toLowerCase());
      out.push(m);
    }
    if (modelValue && !seen.has(modelValue.toLowerCase())) out.unshift(modelValue);
    return out;
  }, [rows, productValue, modelValue]);

  const addNewLink = (
    <a
      href="/masters/products"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
    >
      <Plus className="h-3.5 w-3.5" /> Add in Product Master <ExternalLink className="h-3 w-3" />
    </a>
  );

  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 gap-2", className)}>
      <Popover open={pOpen} onOpenChange={setPOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled}
            className={cn("w-full justify-between font-normal h-9", !productValue && "text-muted-foreground")}
          >
            <span className="truncate text-xs">{productValue || productPlaceholder}</span>
            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]" align="start">
          <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
            <CommandInput placeholder="Search product…" />
            <CommandList>
              <CommandEmpty>
                <div className="py-3 px-3 space-y-2 text-sm">
                  <p className="text-muted-foreground">No matching product.</p>
                  {addNewLink}
                </div>
              </CommandEmpty>
              <CommandGroup heading={`${productNames.length} products`}>
                {productNames.map((name) => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => {
                      // Reset model when product changes.
                      const nextModel = name.toLowerCase() === productValue.toLowerCase() ? modelValue : "";
                      onPick({ name, model: nextModel });
                      setPOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", productValue.toLowerCase() === name.toLowerCase() ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <div className="border-t p-2">{addNewLink}</div>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover open={mOpen} onOpenChange={setMOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            disabled={disabled || !productValue}
            className={cn("w-full justify-between font-normal h-9", !modelValue && "text-muted-foreground")}
          >
            <span className="truncate text-xs">{modelValue || (productValue ? modelPlaceholder : "Pick product first")}</span>
            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]" align="start">
          <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
            <CommandInput placeholder="Search model…" />
            <CommandList>
              <CommandEmpty>
                <div className="py-3 px-3 space-y-2 text-sm">
                  <p className="text-muted-foreground">No model for “{productValue}”.</p>
                  {addNewLink}
                </div>
              </CommandEmpty>
              <CommandGroup heading={`${modelsForProduct.length} models`}>
                {modelsForProduct.map((m) => (
                  <CommandItem
                    key={m}
                    value={m}
                    onSelect={() => {
                      onPick({ name: productValue, model: m });
                      setMOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", modelValue.toLowerCase() === m.toLowerCase() ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono text-xs truncate">{m}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <div className="border-t p-2">{addNewLink}</div>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}