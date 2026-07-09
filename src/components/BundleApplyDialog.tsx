import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Package } from "lucide-react";
import type { ProductMaster } from "@/components/ProductPicker";
import {
  type BundleChildRow,
  type BundleSelection,
  fetchBundleChildren,
  initialSelections,
  scaleSelections,
} from "@/lib/productBundles";

type Props = {
  parent: ProductMaster | null;
  parentQty?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (picks: Array<{ product: ProductMaster; qty: number; note: string | null }>) => void;
};

// Reusable, modular dialog. Any sales/procurement form can call this after
// a parent product is picked. Children flow back as {product, qty, note}
// so the caller maps them into its own row shape and lets the existing
// GST engine compute totals.
export function BundleApplyDialog({ parent, parentQty = 1, open, onOpenChange, onConfirm }: Props) {
  const [rows, setRows] = useState<BundleChildRow[]>([]);
  const [sels, setSels] = useState<BundleSelection[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !parent) return;
    setLoading(true);
    fetchBundleChildren(parent.id)
      .then((r) => {
        setRows(r);
        setSels(scaleSelections(initialSelections(r), parentQty));
      })
      .catch(() => { setRows([]); setSels([]); })
      .finally(() => setLoading(false));
  }, [open, parent?.id, parentQty]);

  const anyOptional = useMemo(() => rows.some((r) => !r.mandatory), [rows]);

  const confirm = () => {
    const picks = sels
      .filter((s) => s.include && s.row.child)
      .map((s) => ({
        product: s.row.child as ProductMaster,
        qty: Math.max(0.001, Number(s.qty) || 0),
        note: s.row.note,
      }));
    onConfirm(picks);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Bundle suggestions
            {parent && <span className="text-sm text-muted-foreground font-normal">— {parent.name}</span>}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Configured in Product Master. Mandatory items are always included; adjust quantities as needed.
          </p>
        </DialogHeader>
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading bundle…</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">No bundle configured for this product.</div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-24 text-right">Qty</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sels.map((s, i) => {
                  const c = s.row.child;
                  const disabledToggle = s.row.mandatory;
                  return (
                    <TableRow key={s.row.id} className={!s.include ? "opacity-60" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={s.include}
                          disabled={disabledToggle}
                          onCheckedChange={(v) => {
                            const next = [...sels];
                            next[i] = { ...next[i], include: !!v };
                            setSels(next);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{c?.model || c?.name || "—"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {[c?.brand, c?.category, c?.unit].filter(Boolean).join(" · ")}
                          {s.row.note ? <> · <span className="italic">{s.row.note}</span></> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          className="h-8 text-right"
                          value={s.qty}
                          disabled={!s.row.editable_qty || !s.include}
                          onChange={(e) => {
                            const next = [...sels];
                            next[i] = { ...next[i], qty: Number(e.target.value) };
                            setSels(next);
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        {s.row.mandatory
                          ? <Badge variant="secondary">Mandatory</Badge>
                          : <Badge variant="outline">Optional</Badge>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Skip</Button>
          <Button onClick={confirm} disabled={rows.length === 0}>
            Add {sels.filter((s) => s.include).length} item{sels.filter((s) => s.include).length === 1 ? "" : "s"}
            {anyOptional ? "" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}