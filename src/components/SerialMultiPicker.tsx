import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { fetchAll } from "@/lib/fetchAll";

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
  const [rows, setRows] = useState<SerialRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>(value);

  useEffect(() => { setPicked(value); }, [value, open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchAll<SerialRow>("ims_stock_items", (qq) => {
      let x = qq
        .select("id,part_serial_no,part_model_no,part_name,warehouse_id,stock_status")
        .eq("stock_status", "available")
        .not("part_serial_no", "is", null);
      if (warehouseId) x = x.eq("warehouse_id", warehouseId);
      if (partModelNo) x = x.eq("part_model_no", partModelNo);
      else if (partName) x = x.eq("part_name", partName);
      return x.order("part_serial_no").limit(100);
    })
      .then((data) => setRows(data.filter((r) => !excludeSerials.includes(r.part_serial_no) || value.includes(r.part_serial_no))))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, warehouseId, partModelNo, partName]);

  const filtered = useMemo(
    () => rows.filter((r) => !q || r.part_serial_no.toLowerCase().includes(q.toLowerCase())),
    [rows, q],
  );

  const toggle = (sn: string) => {
    setPicked((p) => {
      if (p.includes(sn)) return p.filter((x) => x !== sn);
      if (p.length >= qty) return p; // cap at qty
      return [...p, sn];
    });
  };

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