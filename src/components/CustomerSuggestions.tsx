import { useEffect, useState } from "react";
import { Users, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDebounced } from "@/lib/sales.hooks";
import { searchCustomersByName, type CustomerSuggestion } from "@/lib/customerDuplicates";

type Props = {
  /** Live customer-name text being typed. */
  name: string;
  /** Record being edited — excluded from the list. */
  excludeId?: string | null;
  /** Optional: load an existing customer into the form. */
  onSelect?: (c: CustomerSuggestion) => void;
};

/**
 * Soft duplicate detection: shows up to 10 similar existing customers while
 * typing a name. Informational only — never blocks saving.
 */
export function CustomerSuggestions({ name, excludeId, onSelect }: Props) {
  const debounced = useDebounced(name, 300);
  const [rows, setRows] = useState<CustomerSuggestion[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { setDismissed(false); }, [debounced]);

  useEffect(() => {
    let alive = true;
    const q = (debounced || "").trim();
    if (q.length < 3) { setRows([]); return; }
    searchCustomersByName(q).then((r) => {
      if (alive) setRows(r.filter((x) => x.id !== excludeId));
    });
    return () => { alive = false; };
  }, [debounced, excludeId]);

  if (dismissed || rows.length === 0) return null;

  return (
    <div className="mt-1.5 rounded-md border bg-popover shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/50">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Existing customers ({rows.length})
        </span>
        <button type="button" onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto divide-y">
        {rows.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{c.company}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {[c.customer_code, c.gst ? `GSTIN: ${c.gst}` : null, c.phone ? `Mobile: ${c.phone}` : null, c.city]
                  .filter(Boolean).join(" · ")}
              </div>
            </div>
            {onSelect && (
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onSelect(c)}>
                Select
              </Button>
            )}
            <a
              href={`/masters/customers?open=${c.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        ))}
      </ul>
      <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t">
        Not the same customer? Continue creating a new one.
      </div>
    </div>
  );
}
