import { useEffect, useMemo, useState } from "react";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type Customer } from "@/lib/crm";
import { INDIAN_STATES } from "@/lib/india";
import { createQuickCustomer } from "@/lib/customers";

type Props = {
  value: string | null | undefined;
  onChange: (id: string | null, customer: Customer | null) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
};

const emptyQuick = { company: "", contact_name: "", phone: "", email: "", gst: "", state: "" };

export function CustomerPicker({ value, onChange, required, placeholder = "Search by name, mobile or GST…", className }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState(emptyQuick);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAll<Customer>("customers", (q) => q.select("*").order("company"))
      .then((data) => {
        if (!alive) return;
        setRows(data);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const selected = useMemo(() => rows.find((r) => r.id === value) || null, [rows, value]);

  function openQuickAdd() {
    setQuick({ ...emptyQuick, company: search.trim() });
    setQuickOpen(true);
  }

  async function saveQuick() {
    if (!quick.company.trim()) { toast.error("Company name is required"); return; }
    setSaving(true);
    try {
      const created = await createQuickCustomer(quick);
      setRows((prev) => [...prev, created].sort((a, b) => (a.company || "").localeCompare(b.company || "")));
      onChange(created.id, created);
      toast.success("Customer added and selected");
      setQuickOpen(false);
      setQuick(emptyQuick);
      setSearch("");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Could not add customer");
    } finally {
      setSaving(false);
    }
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
            className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", required && !selected && "border-destructive/40", className)}
          >
            <span className="truncate">
              {selected ? (
                <>
                  <span className="font-medium">{selected.company}</span>
                  {selected.phone ? <span className="text-muted-foreground ml-2">· {selected.phone}</span> : null}
                </>
              ) : (loading ? "Loading customers…" : placeholder)}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
          <Command
            filter={(val, s) => (val.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}
          >
            <CommandInput placeholder="Search by name, mobile, GST…" value={search} onValueChange={setSearch} />
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
                  const searchBlob = [c.company, c.contact_name, c.phone, c.gst, cAny.city, c.state].filter(Boolean).join(" ").toLowerCase();
                  return (
                    <CommandItem
                      key={c.id}
                      value={`${c.id} ${searchBlob}`}
                      onSelect={() => { onChange(c.id, c); setOpen(false); }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
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

      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Quick Add Customer</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1.5">
              <Label>Company <span className="text-destructive">*</span></Label>
              <Input value={quick.company} autoFocus onChange={(e) => setQuick({ ...quick, company: e.target.value })} placeholder="Customer / company name" />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Name</Label>
              <Input value={quick.contact_name} onChange={(e) => setQuick({ ...quick, contact_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={quick.phone} onChange={(e) => setQuick({ ...quick, phone: e.target.value })} placeholder="10-digit mobile" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={quick.email} onChange={(e) => setQuick({ ...quick, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>GST Number</Label>
              <Input value={quick.gst} onChange={(e) => setQuick({ ...quick, gst: e.target.value.toUpperCase() })} placeholder="15-char GSTIN" />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label>State</Label>
              <Select value={quick.state} onValueChange={(v) => setQuick({ ...quick, state: v })}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>
                  {INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Need to add full address or other details? Complete the profile in Masters later.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setQuickOpen(false)}>Cancel</Button>
            <Button type="button" onClick={saveQuick} disabled={saving}>{saving ? "Saving…" : "Save & Select"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
