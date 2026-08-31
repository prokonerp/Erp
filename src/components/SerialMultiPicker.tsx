import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

type SerialRow = {
  id: string;
  part_serial_no: string;
  part_model_no: string | null;
  part_name: string;
  warehouse_id: string | null;
  stock_status: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  qty: number;
  warehouseId: string | null;
  partModelNo?: string | null;
  partName?: string | null;
  value: string[];
  onConfirm: (serials: string[]) => void;
  /** Serials already picked by other lines in the same invoice — filter these out */
  excludeSerials?: string[];
};

export function SerialMultiPicker({
  open, onOpenChange, qty, warehouseId, partModelNo, partName, value, onConfirm, excludeSerials = [],
}: Props) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<string[]>(value);

  useEffect(() => { setPicked(value); }, [value, open]);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 150); return () => clearTimeout(t); }, [q]);

  const COLS = "id,part_serial_no,part_model_no,part_name,warehouse_id,stock_status";
  const { data: rowsData, isLoading: loading } = useQuery({
    queryKey: ["ims-serials-multi", warehouseId, partModelNo, partName, open, debounced] as const,
    queryFn: async () => {
      const term = debounced.trim();
      let qb = supabase.from("ims_stock_items").select(COLS).eq("stock_status", "available").not("part_serial_no", "is", null);
      if (warehouseId) qb = (qb as any).eq("warehouse_id", warehouseId);
      if (partModelNo) qb = (qb as any).eq("part_model_no", partModelNo);
      else if (partName) qb = (qb as any).eq("part_name", partName);
      if (term) {
        const p = `%${term}%`;
        qb = (qb as any).or(`part_serial_no.ilike.${p},part_model_no.ilike.${p},part_name.ilike.${p}`);
        const { data, error } = await (qb as any).order("part_serial_no").limit(30);
        if (error) throw error;
        const all = (data || []) as unknown as SerialRow[];
        return all.filter((r) => !excludeSerials.includes(r.part_serial_no) || value.includes(r.part_serial_no));
      }
      const { data, error } = await (qb as any).order("part_serial_no").limit(25);
      if (error) throw error;
      const all = (data || []) as unknown as SerialRow[];
      return all.filter((r) => !excludeSerials.includes(r.part_serial_no) || value.includes(r.part_serial_no));
    },
    enabled: open,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => (rowsData as SerialRow[] | undefined) ?? [], [rowsData]);

  // Server already filters by debounced term (25/30 window); filtered mirrors rows for instant render
  const filtered = rows;

  const toggle = useCallback((sn: string) => {
    setPicked((p) => {
      if (p.includes(sn)) return p.filter((x) => x !== sn);
      if (p.length >= qty) return p; // cap at qty
      return [...p, sn];
    });
  }, [qty]);

  const canSave = picked.length === qty;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Select Serial Numbers
            <Badge variant={canSave ? "default" : "secondary"} className="ml-2">
              {picked.length} / {qty}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        {!warehouseId && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            Select a warehouse for this line first.
          </p>
        )}
        <Input placeholder="Search serial…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No available serials for this product in the selected warehouse.
            </div>
          ) : (
            filtered.map((r) => {
              const isPicked = picked.includes(r.part_serial_no);
              const atCap = !isPicked && picked.length >= qty;
              return (
                <label key={r.id} className={"flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted " + (atCap ? "opacity-50" : "")}>
                  <Checkbox checked={isPicked} onCheckedChange={() => toggle(r.part_serial_no)} disabled={atCap} />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs">{r.part_serial_no}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{r.part_model_no || r.part_name}</div>
                  </div>
                </label>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSave} onClick={() => { onConfirm(picked); onOpenChange(false); }}>
            Save Selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}