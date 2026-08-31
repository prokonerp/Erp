import { useCallback, useEffect, useMemo, useState } from "react";
import { useProductsForPicker } from "@/hooks/useMasters";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

type Product = {
  id: string;
  name: string;
  model: string | null;
  brand: string | null;
  category?: string | null;
  hsn?: string | null;
  active?: boolean | null;
};

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
  const [pOpen, setPOpen] = useState(false);
  const [mOpen, setMOpen] = useState(false);
  const [pSearch, setPSearch] = useState("");
  const [mSearch, setMSearch] = useState("");
  const [pDebounced, setPDebounced] = useState("");
  const [mDebounced, setMDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setPDebounced(pSearch), 150); return () => clearTimeout(t); }, [pSearch]);
  useEffect(() => { const t = setTimeout(() => setMDebounced(mSearch), 150); return () => clearTimeout(t); }, [mSearch]);

  // Product picker: server-filtered 25/30 window, 6 cols, shouldFilter=false
  const { data: pickerRows } = useProductsForPicker(pDebounced);
  const rows = useMemo(() => (pickerRows as unknown as Product[] | undefined) ?? [], [pickerRows]);

  // Model picker: server-filtered by selected product name + debounced model search, explicit 6 cols, limit 30
  const MODEL_COLS = "id,name,model,brand,category,hsn";
  const { data: modelRowsData } = useQuery({
    queryKey: ["indent-models", productValue, mDebounced],
    queryFn: async () => {
      if (!productValue) return [] as Product[];
      let q = supabase.from("products").select(MODEL_COLS).eq("name", productValue).eq("active", true).order("model").limit(30);
      const term = mDebounced.trim();
      if (term) q = q.ilike("model", `%${term}%`);
      const { data, error } = await q as any;
      if (error) throw error;
      return (data || []) as Product[];
    },
    enabled: !!productValue,
    staleTime: 60 * 1000,
  });
  const modelRows = useMemo(() => (modelRowsData as Product[] | undefined) ?? [], [modelRowsData]);

  const handleProductPick = useCallback((name: string) => {
    const nextModel = name.toLowerCase() === productValue.toLowerCase() ? modelValue : "";
    onPick({ name, model: nextModel });
    setPOpen(false);
  }, [productValue, modelValue, onPick]);
  const handleModelPick = useCallback((m: string) => {
    onPick({ name: productValue, model: m });
    setMOpen(false);
  }, [productValue, onPick]);

  const productNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const n = (r.name || "").trim();
      if (!n || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      out.push(n);
    }
    // Ensure the currently-saved name renders even if not in 25-window
    if (productValue && !seen.has(productValue.toLowerCase())) out.unshift(productValue);
    return out;
  }, [rows, productValue]);

  const modelsForProduct = useMemo(() => {
    if (!productValue) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of modelRows) {
      const m = (r.model || "").trim();
      if (!m || seen.has(m.toLowerCase())) continue;
      seen.add(m.toLowerCase());
      out.push(m);
    }
    // Fallback: also surface models from the 25-window that match productValue when modelRows is filtered narrowly
    if (out.length === 0) {
      for (const r of rows) {
        if ((r.name || "").toLowerCase() !== productValue.toLowerCase()) continue;
        const m = (r.model || "").trim();
        if (!m || seen.has(m.toLowerCase())) continue;
        seen.add(m.toLowerCase());
        out.push(m);
      }
    }
    if (modelValue && !seen.has(modelValue.toLowerCase())) out.unshift(modelValue);
    return out;
  }, [rows, modelRows, productValue, modelValue]);

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
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search product…" value={pSearch} onValueChange={setPSearch} />
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
                    onSelect={() => handleProductPick(name)}
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
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search model…" value={mSearch} onValueChange={setMSearch} />
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
                    onSelect={() => handleModelPick(m)}
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