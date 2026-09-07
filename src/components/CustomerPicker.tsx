import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCustomersForPicker, masterKeys } from "@/hooks/useMasters";
import { supabase } from "@/integrations/supabase/client";
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
import { Check, ChevronsUpDown, Plus, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Customer, type CustomerBranch } from "@/lib/crm";
import { CustomerFormDialog } from "@/components/CustomerForm";

type Props = {
  value: string | null | undefined;
  onChange: (id: string | null, customer: Customer | null, branch?: CustomerBranch | null) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
  /**
   * Enable branch-office selection. When a customer with branch offices is
   * selected, the picker shows a nested list of that customer's branch offices
   * and the chosen branch is passed back as the 3rd arg to `onChange`.
   * Default false = single-level (backward compatible).
   */
  branched?: boolean;
  /** Currently selected branch office (for display). */
  branchValue?: string | null;
};

export function CustomerPicker({
  value,
  onChange,
  required,
  placeholder = "Search by name, mobile or GST…",
  className,
  branched = false,
  branchValue,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [seedCompany, setSeedCompany] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  // The customer whose branch offices are currently displayed. Stored as the
  // full object so confirmBranch can always fire onChange even when the
  // customer row is not in the current 25-row search window.
  const [candidateCustomer, setCandidateCustomer] = useState<Customer | null>(null);
  const queryClient = useQueryClient();

  // Debounce search -> server query (150ms) to avoid firing on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useCustomersForPicker(debounced);
  const rows = (data as any)?.rows ?? [];

  // Selected may not be in the current 25-row window; fetch it separately for display
  // Fallback select columns MUST match CUSTOMER_PICKER_COLS so the cached shape is identical
  // and partial selects never return undefined for required display fields.
  const FALLBACK_COLS = "id, company, contact_name, phone, email, gst, state, city, billing_address, shipping_address, address";
  const [selectedFallback, setSelectedFallback] = useState<Customer | null>(null);
  const selected = useMemo(() => rows.find((r: any) => r.id === value) || selectedFallback, [rows, value, selectedFallback]);

  useEffect(() => {
    // Clear stale fallback when selection cleared or now present in the window
    if (!value) {
      if (selectedFallback) setSelectedFallback(null);
      return;
    }
    if (rows.find((r: any) => r.id === value)) {
      if (selectedFallback) setSelectedFallback(null);
      return;
    }
    if (selectedFallback?.id === value) return;
    // Value exists but not in current picker window → fetch by id
    // If value changed while previous fetch was in-flight, discard stale fallback first
    if (selectedFallback && selectedFallback.id !== value) setSelectedFallback(null);
    let active = true;
    supabase
      .from("customers")
      .select(FALLBACK_COLS)
      .eq("id", value)
      .single()
      .then(({ data }) => {
        if (active && data) setSelectedFallback(data as unknown as Customer);
      });
    return () => {
      active = false;
    };
  }, [value, rows, selectedFallback]);

  // Branch offices for the candidate / selected customer (branched mode only).
  const branchTargetId = candidateCustomer?.id ?? selected?.id ?? null;
  const { data: branchRows = [], isLoading: isBranchLoading } = useQuery({
    queryKey: ["customer_branches", branchTargetId ?? "__none"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_branches")
        .select("id, customer_id, name, contact_name, phone, email, state, gstin, is_default, billing_line1, billing_line2, billing_landmark, billing_city, billing_state, billing_country, billing_pincode, shipping_line1, shipping_line2, shipping_landmark, shipping_city, shipping_state, shipping_country, shipping_pincode")
        .eq("customer_id", branchTargetId as string)
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as CustomerBranch[];
    },
    enabled: branched && !!branchTargetId,
    staleTime: 30 * 1000,
  });

  const selectedBranch = useMemo(
    () => (branchRows ?? []).find((b) => b.id === branchValue) || null,
    [branchRows, branchValue],
  );

  function openQuickAdd() {
    setSeedCompany(search.trim());
    setAddOpen(true);
    setOpen(false);
  }

  function handleSaved(created: Customer) {
    queryClient.invalidateQueries({ queryKey: masterKeys.customers() });
    onChange(created.id, created, null);
    setSearch("");
    setAddOpen(false);
    setOpen(false);
  }

  function handleCustomerSelect(c: Customer) {
    if (branched) {
      // Cache the clicked customer so confirmBranch always has the full object
      // (the row may not be in the current 25-row window after a search).
      setCandidateCustomer(c);
      setBranchOpen(true);
      // Fast path: if we ALREADY have exactly one branch loaded for THIS customer
      // (staleTime 30s), apply it immediately and skip the branch sub-list.
      if (!isBranchLoading && branchTargetId === c.id && branchRows.length === 1) {
        onChange(c.id, c, branchRows[0]);
        setOpen(false);
        setBranchOpen(false);
        setCandidateCustomer(null);
        return;
      }
      // Otherwise open the branch sub-list; the form keeps the main address
      // (branch = null) until the user confirms a specific branch.
      onChange(c.id, c, null);
    } else {
      onChange(c.id, c, null);
      setOpen(false);
    }
  }

  function confirmBranch(branch: CustomerBranch | null) {
    if (candidateCustomer) {
      onChange(candidateCustomer.id, candidateCustomer, branch);
    }
    setBranchOpen(false);
    setCandidateCustomer(null);
    setOpen(false);
  }

  return (
    <>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setCandidateCustomer(null); } }}>
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
                  {selectedBranch ? (
                    <span className="text-muted-foreground ml-2">· {selectedBranch.name}</span>
                  ) : selected.phone ? (
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
          {!branchOpen || !candidateCustomer ? (
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search by name, mobile, GST…"
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                {isLoading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
                ) : (
                  <CommandEmpty>
                    <div className="py-4 px-3 text-sm space-y-2">
                      <p className="text-muted-foreground">No matching customer.</p>
                      <Button type="button" size="sm" variant="secondary" onClick={openQuickAdd}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add New Customer
                      </Button>
                    </div>
                  </CommandEmpty>
                )}
                <CommandGroup heading={debounced ? `${rows.length} matches` : `${rows.length} customers — type to search`}>
                  {rows.map((c: any) => {
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
                          handleCustomerSelect(c);
                        }}
                      >
                        <Check
                          className={cn("mr-2 h-4 w-4", value === c.id && !candidateCustomer ? "opacity-100" : "opacity-0")}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{c.company}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {[c.phone, c.gst, c.state].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        {branched && <Building2 className="h-3.5 w-3.5 text-muted-foreground ml-1" />}
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
          ) : (
            <Command shouldFilter={false}>
              <div className="px-3 py-2 border-b flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Select branch office</span>
                <button
                  type="button"
                  onClick={() => { setBranchOpen(false); setCandidateCustomer(null); setSearch(""); }}
                  className="text-xs text-primary hover:underline"
                >
                  Change customer
                </button>
              </div>
              <CommandList>
                {isBranchLoading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">Loading branch offices…</div>
                ) : branchRows.length === 0 ? (
                  <div className="py-4 px-3 text-sm">
                    <p className="text-muted-foreground">No branch offices for this customer.</p>
                    <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => confirmBranch(null)}>
                      Use main address
                    </Button>
                  </div>
                ) : (
                  <>
                    <CommandGroup heading={`${branchRows.length} branch office${branchRows.length === 1 ? "" : "s"}`}>
                      {branchRows.map((b) => (
                        <CommandItem
                          key={b.id}
                          value={b.name}
                          onSelect={() => confirmBranch(b)}
                        >
                          <Check
                            className={cn("mr-2 h-4 w-4", branchValue === b.id ? "opacity-100" : "opacity-0")}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{b.name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {[b.billing_city, b.state, b.gstin].filter(Boolean).map(String).join(" · ")}
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
              <div className="border-t p-2">
                <button
                  type="button"
                  onClick={() => confirmBranch(null)}
                  className="flex w-full items-center gap-1.5 text-sm text-muted-foreground hover:text-primary px-2 py-1"
                >
                  <Check className="h-3.5 w-3.5" /> Use customer&apos;s main address
                </button>
              </div>
            </Command>
          )}
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
