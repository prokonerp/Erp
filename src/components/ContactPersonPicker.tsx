import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Users, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ContactChoice = {
  name: string;
  phone: string;
  email: string;
  designation?: string;
  department?: string;
  is_primary?: boolean;
};

type Raw = {
  salutation?: string;
  first_name?: string;
  last_name?: string;
  designation?: string;
  department?: string;
  email?: string;
  area_code?: string;
  phone?: string;
};

function joinName(r: Raw): string {
  return [r.salutation, r.first_name, r.last_name].filter((x) => x && String(x).trim()).join(" ").trim();
}
function joinPhone(r: Raw): string {
  const p = (r.phone || "").trim();
  if (!p) return "";
  const a = (r.area_code || "").trim();
  return a ? `${a} ${p}` : p;
}

type Props = {
  customerId: string | null;
  onPick: (c: ContactChoice) => void;
  placeholder?: string;
  className?: string;
};

/**
 * Picks a contact person from a Customer master record. Loads the customer's
 * primary contact (top-level fields) plus any additional contacts stored in
 * the JSON `contacts` array. Selecting a row fires onPick with normalised
 * name/phone/email so the caller can auto-fill its form fields.
 */
export function ContactPersonPicker({ customerId, onPick, placeholder = "Pick contact person…", className }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ContactChoice[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!customerId) { setRows([]); return; }
    setLoading(true);
    supabase
      .from("customers")
      .select("contact_name, phone, email, salutation, first_name, last_name, contacts")
      .eq("id", customerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const out: ContactChoice[] = [];
        if (data) {
          const primaryName = (data.contact_name && String(data.contact_name).trim())
            || joinName({ salutation: data.salutation as string, first_name: data.first_name as string, last_name: data.last_name as string });
          if (primaryName || data.phone || data.email) {
            out.push({
              name: primaryName || "Primary Contact",
              phone: (data.phone as string) || "",
              email: (data.email as string) || "",
              is_primary: true,
            });
          }
          const list = Array.isArray(data.contacts) ? (data.contacts as Raw[]) : [];
          for (const r of list) {
            const nm = joinName(r);
            if (!nm && !r.phone && !r.email) continue;
            out.push({
              name: nm || "(Unnamed)",
              phone: joinPhone(r),
              email: r.email || "",
              designation: r.designation,
              department: r.department,
            });
          }
        }
        setRows(out);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [customerId]);

  const disabled = !customerId;
  const label = useMemo(() => {
    if (disabled) return "Select customer first";
    if (loading) return "Loading…";
    if (rows.length === 0) return "No contacts on master";
    return placeholder;
  }, [disabled, loading, rows.length, placeholder]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || rows.length === 0}
          className={cn("w-full justify-between font-normal h-9 text-xs", className)}
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            <Users className="h-3.5 w-3.5 opacity-60" /> {label}
          </span>
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
        <Command filter={(val, search) => (val.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Search contact…" />
          <CommandList>
            <CommandEmpty>No matching contact.</CommandEmpty>
            <CommandGroup heading={`${rows.length} contact${rows.length === 1 ? "" : "s"} on file`}>
              {rows.map((c, i) => {
                const blob = [c.name, c.phone, c.email, c.designation, c.department].filter(Boolean).join(" ").toLowerCase();
                return (
                  <CommandItem
                    key={i}
                    value={`${i} ${blob}`}
                    onSelect={() => { onPick(c); setOpen(false); }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {c.name}
                        {c.is_primary && <span className="ml-2 text-[10px] uppercase tracking-wide text-primary">Primary</span>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[c.designation, c.department, c.phone, c.email].filter(Boolean).join(" · ")}
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