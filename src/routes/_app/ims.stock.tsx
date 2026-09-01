import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
import {
  fetchStockPage,
  createStock,
  updateStock,
  deleteStock,
  listWarehouses,
  STOCK_STATUS_LABEL,
  STOCK_TYPE_LABEL,
  type StockItem,
  type WarehouseLite,
} from "@/lib/ims";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { stockKeys } from "@/lib/queryKeys";
import { ImsModelPartPicker } from "@/components/ImsModelPartPicker";
import { useIsAdmin } from "@/lib/useRole";
import { StockStatusBadge } from "@/components/StockStatusBadge";
import { TableSkeleton } from "@/components/shared/skeletons";
import { PaginationFooter } from "@/components/PaginationFooter";
import { useDebounced } from "@/lib/sales.hooks";

export const Route = createFileRoute("/_app/ims/stock")({
  component: StockLedger,
});

function StockLedger() {
  const { isAdmin } = useIsAdmin();
  const [q, setQ] = useRouteState<string>("q", "");
  const [type, setType] = useRouteState<string>("type", "all");
  const [status, setStatus] = useRouteState<string>("status", "all");
  const [page, setPage] = useRouteState<number>("page", 0);
  const pageSize = 25;
  const qDebounced = useDebounced(q.trim(), 250);
  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [deleting, setDeleting] = useState<StockItem | null>(null);

  useEffect(() => {
    setPage(0);
  }, [qDebounced, type, status]);

  const stockQ = useQuery({
    queryKey: stockKeys.paginated({
      page,
      pageSize,
      search: qDebounced || null,
      stockType: type !== "all" ? type : null,
      stockStatus: status !== "all" ? status : null,
    } as unknown as Record<string, unknown> & { page: number; pageSize: number }),
    queryFn: () =>
      fetchStockPage({
        page,
        pageSize,
        search: qDebounced || null,
        stockType: type !== "all" ? (type as any) : null,
        stockStatus: status !== "all" ? (status as any) : null,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const whQ = useQuery({
    queryKey: ["warehouses", "list"],
    queryFn: listWarehouses,
    staleTime: 30_000,
  });
  const rows: StockItem[] = (stockQ.data?.data ?? []) as StockItem[];
  const total = stockQ.data?.count ?? 0;
  const warehouses: WarehouseLite[] = (whQ.data ?? []) as WarehouseLite[];
  const loading = stockQ.isLoading || whQ.isLoading;

  async function load() {
    await Promise.all([stockQ.refetch(), whQ.refetch()]);
  }

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    return rows.filter((r) => {
      if (type !== "all" && r.stock_type !== type) return false;
      if (status !== "all" && r.stock_status !== status) return false;
      if (!s) return true;
      return [r.part_name, r.part_model_no, r.part_serial_no, r.oem, r.oem_case_id, r.customer_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s));
    });
  }, [rows, q, type, status]);

  const whName = (id: string | null) => warehouses.find((w) => w.id === id)?.name || "—";

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteStock(deleting.id);
      toast.success("Stock item deleted");
      setDeleting(null);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Search className="h-4 w-4" /> Stock Ledger
            </span>
            <Button size="sm" onClick={() => setOpenNew(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Stock Entry
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              placeholder="Model / Part Name / No / Serial No / OEM / Case ID / Customer…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="defective">Defective</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STOCK_STATUS_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-sm text-muted-foreground self-center">
              {filtered.length} of {total}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-hidden">
          {stockQ.isLoading ? (
            <TableSkeleton rows={6} />
          ) : (
            <div
              className="max-h-[60vh] overflow-auto overscroll-contain scroll-pt-0"
              style={{ contain: "content" }}
            >
              <table className="w-full text-sm table-fixed">
                <thead className="bg-muted sticky top-0 z-10">
                  <tr className="text-left">
                    <th className="p-2">OEM</th>
                    <th className="p-2">Model / Part Name</th>
                    <th className="p-2">Model / Part No</th>
                    <th className="p-2">Model / Part Serial No</th>
                    <th className="p-2">Qty</th>
                    <th className="p-2">Warehouse</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Opening</th>
                    <th className="p-2">Ticket / Indent</th>
                    {isAdmin && <th className="p-2 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={isAdmin ? 11 : 10}>
                        <span className="text-primary">Loading…</span>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={isAdmin ? 11 : 10}>
                        No stock items.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2">{r.oem || "—"}</td>
                        <td className="p-2">{r.part_name}</td>
                        <td className="p-2">{r.part_model_no || "—"}</td>
                        <td className="p-2 font-mono">{r.part_serial_no || "—"}</td>
                        <td className="p-2">{r.qty ?? 1}</td>
                        <td className="p-2">{whName(r.warehouse_id)}</td>
                        <td className="p-2">
                          <Badge variant={r.stock_type === "good" ? "default" : "secondary"}>
                            {STOCK_TYPE_LABEL[r.stock_type]}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <StockStatusBadge status={r.stock_status} type={r.stock_type} />
                        </td>
                        <td className="p-2">
                          {r.opening_stock ? (
                            <Badge>Opening</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2 font-mono text-xs">
                          {r.ticket_id || r.indent_id || "—"}
                        </td>
                        {isAdmin && (
                          <td className="p-2 text-right whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditing(r)}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleting(r)}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            onPage={setPage}
            isFetching={stockQ.isFetching && !stockQ.isLoading}
          />
        </CardContent>
      </Card>

      <StockDialog
        open={openNew}
        onOpenChange={setOpenNew}
        warehouses={warehouses}
        onSaved={load}
      />
      <StockDialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
        warehouses={warehouses}
        onSaved={load}
        editItem={editing}
      />
      <AlertDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this stock item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <span className="font-medium">{deleting?.part_name}</span>
              {deleting?.part_serial_no ? ` (SN: ${deleting.part_serial_no})` : ""} from inventory.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StockDialog({
  open,
  onOpenChange,
  warehouses,
  onSaved,
  editItem,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  warehouses: WarehouseLite[];
  onSaved: () => void;
  editItem?: StockItem | null;
}) {
  const emptyForm = {
    product_id: "",
    product_type: "",
    oem: "",
    category: "",
    part_name: "",
    part_model_no: "",
    part_serial_no: "",
    warehouse_id: "",
    stock_type: "good",
    qty: "1",
    opening_stock: false,
  };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const isEdit = !!editItem;

  useEffect(() => {
    if (open) {
      if (editItem) {
        setForm({
          product_id: "",
          product_type: "",
          oem: editItem.oem || "",
          category: editItem.category || "",
          part_name: editItem.part_name || "",
          part_model_no: editItem.part_model_no || "",
          part_serial_no: editItem.part_serial_no || "",
          warehouse_id: editItem.warehouse_id || "",
          stock_type: editItem.stock_type,
          qty: String(editItem.qty ?? 1),
          opening_stock: !!editItem.opening_stock,
        });
      } else {
        setForm(emptyForm);
      }
    }
  }, [open, editItem]);

  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!form.part_name.trim()) {
      toast.error("Model / Part Name is required");
      return;
    }
    const qtyNum = Math.max(1, Math.floor(Number(form.qty) || 1));
    setSaving(true);
    try {
      const payload: Partial<StockItem> = {
        oem: form.oem || null,
        category: form.category || null,
        part_name: form.part_name.trim(),
        part_model_no: form.part_model_no || null,
        part_serial_no: form.part_serial_no || null,
        warehouse_id: form.warehouse_id || null,
        stock_type: form.stock_type as "good" | "defective",
        qty: qtyNum,
        opening_stock: form.opening_stock,
      };
      if (isEdit && editItem) {
        await updateStock(editItem.id, payload);
        toast.success("Stock item updated");
      } else {
        await createStock(payload);
        toast.success("Stock item created");
      }
      onOpenChange(false);
      setForm(emptyForm);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Stock Entry" : "New Stock Entry"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Model / Part *</Label>
            <ImsModelPartPicker
              value={form.product_id || null}
              onSelect={(p) =>
                setForm((f) => ({
                  ...f,
                  product_id: p.id,
                  product_type: p.productType,
                  part_name: p.name,
                  part_model_no: p.model || "",
                  oem: p.brand || "",
                  category: p.category || "",
                }))
              }
            />
            {form.product_type && (
              <div className="text-xs text-muted-foreground mt-1">
                Type: <span className="font-medium">{form.product_type}</span>
                {form.oem ? (
                  <>
                    {" "}
                    · OEM: <span className="font-medium">{form.oem}</span>
                  </>
                ) : null}
                {form.category ? (
                  <>
                    {" "}
                    · Category: <span className="font-medium">{form.category}</span>
                  </>
                ) : null}
              </div>
            )}
          </div>
          <div>
            <Label>Model / Part Name *</Label>
            <Input value={form.part_name} onChange={(e) => set("part_name", e.target.value)} />
          </div>
          <div>
            <Label>Model / Part No</Label>
            <Input
              value={form.part_model_no}
              onChange={(e) => set("part_model_no", e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Label>Model / Part Serial No (unique)</Label>
            <Input
              value={form.part_serial_no}
              onChange={(e) => set("part_serial_no", e.target.value)}
            />
          </div>
          <div>
            <Label>OEM</Label>
            <Input value={form.oem} onChange={(e) => set("oem", e.target.value)} />
          </div>
          <div>
            <Label>Category</Label>
            <Input value={form.category} onChange={(e) => set("category", e.target.value)} />
          </div>
          <div>
            <Label>Warehouse</Label>
            <Select value={form.warehouse_id} onValueChange={(v) => set("warehouse_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                    {w.type ? ` (${w.type})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Stock Type</Label>
            <Select value={form.stock_type} onValueChange={(v) => set("stock_type", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="defective">Defective</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Qty *</Label>
            <Input
              type="number"
              min={1}
              step={1}
              value={form.qty}
              onChange={(e) => set("qty", e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch
              id="opening-stock"
              checked={form.opening_stock}
              onCheckedChange={(v) => set("opening_stock", v)}
            />
            <Label htmlFor="opening-stock" className="cursor-pointer">
              Opening Stock
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
