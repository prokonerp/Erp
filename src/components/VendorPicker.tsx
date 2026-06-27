import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, Plus, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Vendor = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
};

type Props = {
  value: string | null | undefined;
  onChange: (id: string | null, vendor: Vendor | null) => void;
  required?: boolean;
  placeholder?: string;
  label?: string;
  className?: string;
};

export function VendorPicker({ value, onChange, required, placeholder = "Search vendors / OEMs…", label = "Vendor", className }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchAll<Vendor>("vendors", (q) =>
      q.select("id,name,contact_name,phone,email,address,gstin").order("name"),
    )
      .then((data) => {
        if (!alive) return;
        setRows(data);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const selected = useMemo(() => rows.find((r) => r.id === value) || null, [rows, value]);
  const shortCode = (id: string) => `VEND-${id.slice(0, 6).toUpperCase()}`;

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
              <>
                <span className="font-medium">{selected.name}</span>
                <span className="text-muted-foreground ml-2 text-xs">({shortCode(selected.id)})</span>
              </>
            ) : (loading ? `Loading ${label.toLowerCase()}s…` : placeholder)}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[340px]" align="start">
        <Command filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder={`Search ${label.toLowerCase()} name, code, GSTIN…`} />
          <CommandList>
            <CommandEmpty>
              <div className="py-4 px-3 text-sm space-y-2">
                <p className="text-muted-foreground">No matching {label.toLowerCase()}.</p>
                <a href="/masters" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add in Masters <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CommandEmpty>
            {selected && (
              <CommandGroup>
                <CommandItem value="__clear" onSelect={() => { onChange(null, null); setOpen(false); }}>
                  <X className="mr-2 h-4 w-4" /> Clear selection
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading={`${rows.length} ${label.toLowerCase()}s`}>
              {rows.map((v) => {
                const blob = [v.name, v.contact_name, v.phone, v.gstin].filter(Boolean).join(" ").toLowerCase();
                return (
                  <CommandItem
                    key={v.id}
                    value={`${v.id} ${blob}`}
                    onSelect={() => { onChange(v.id, v); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === v.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{v.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[shortCode(v.id), v.phone, v.gstin].filter(Boolean).join(" · ")}
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

export const vendorShortCode = (id: string) => `VEND-${id.slice(0, 6).toUpperCase()}`;