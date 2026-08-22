import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCustomers, masterKeys } from "@/hooks/useMasters";
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
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Customer } from "@/lib/crm";
import { CustomerFormDialog } from "@/components/CustomerForm";

type Props = {
  value: string | null | undefined;
  onChange: (id: string | null, customer: Customer | null) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
};

export function CustomerPicker({
  value,
  onChange,
  required,
  placeholder = "Search by name, mobile or GST…",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [seedCompany, setSeedCompany] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useCustomers();
  const rows = data?.rows ?? [];

  const selected = useMemo(() => rows.find((r) => r.id === value) || null, [rows, value]);

  function openQuickAdd() {
    setSeedCompany(search.trim());
    setAddOpen(true);
    setOpen(false);
  }

  function handleSaved(created: Customer) {
    queryClient.invalidateQueries({ queryKey: masterKeys.customers() });
    onChange(created.id, created);
    setSearch("");
    setAddOpen(false);
    setOpen(false);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
              required && !selected && "border-destructive/40",
              className,
            )}
          >
            <span className="truncate">
              {selected ? (
                <>
                  <span className="font-medium">{selected.company}</span>
                  {selected.phone ? (
                    <span className="text-muted-foreground ml-2">· {selected.phone}</span>
                  ) : null}
                </>
              ) : isLoading ? (
                "Loading customers…"
              ) : (
                placeholder
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]"
          align="start"
        >
          <Command filter={(val, s) => (val.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
            <CommandInput
              placeholder="Search by name, mobile, GST…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                <div className="py-4 px-3 text-sm space-y-2">
                  <p className="text-muted-foreground">No matching customer.</p>
                  <Button type="button" size="sm" variant="secondary" onClick={openQuickAdd}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add New Customer
                  </Button>
                </div>
              </CommandEmpty>
              <CommandGroup heading={`${rows.length} customers`}>
                {rows.map((c) => {
                  const cAny = c as Customer & { city?: string };
                  const searchBlob = [c.company, c.contact_name, c.phone, c.gst, cAny.city, c.state]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                  return (
                    <CommandItem
                      key={c.id}
                      value={`${c.id} ${searchBlob}`}
                      onSelect={() => {
                        onChange(c.id, c);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{c.company}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {[c.phone, c.gst, c.state].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-2">
              <button
                type="button"
                onClick={openQuickAdd}
                className="flex w-full items-center gap-1.5 text-sm text-primary hover:underline px-2 py-1"
              >
                <Plus className="h-3.5 w-3.5" /> Add New Customer
              </button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <CustomerFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialCompany={seedCompany}
        onSaved={(created) => handleSaved(created)}
      />
    </>
  );
}
