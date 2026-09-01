import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  createTransaction,
  deleteTransaction,
  listWarehouses,
  TXN_TYPE_LABEL,
  type Transaction,
  type WarehouseLite,
  type TxnType,
  useTransactionsPaginated,
} from "@/lib/ims";
import { TableSkeleton } from "@/components/shared/skeletons";
import { PaginationFooter } from "@/components/PaginationFooter";
import { ImsModelPartPicker } from "@/components/ImsModelPartPicker";
import { ImsSerialPicker } from "@/components/ImsSerialPicker";
import { useQuery } from "@tanstack/react-query";
import { useIsAdmin } from "@/lib/useRole";

export const Route = createFileRoute("/_app/ims/transactions")({
  component: TransactionsList,
});

function TransactionsList() {
  const { isAdmin } = useIsAdmin();
  const [q, setQ] = useRouteState<string>("q", "");
  const [type, setType] = useRouteState<string>("type", "all");
  const [page, setPage] = useRouteState<number>("page", 0);
  const pageSize = 25;
  const [openNew, setOpenNew] = useState(false);
  const [deleting, setDeleting] = useState<Transaction | null>(null);

  const txnQ = useTransactionsPaginated({
    page,
    pageSize,
    search: q.trim() || null,
    txnType: type !== "all" ? (type as TxnType) : null,
  });
  const whQ = useQuery({
    queryKey: ["warehouses", "list"],
    queryFn: listWarehouses,
    staleTime: 30_000,
  });
  const rows: Transaction[] = (txnQ.data?.data ?? []) as Transaction[];
  const totalCount = txnQ.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const warehouses: WarehouseLite[] = (whQ.data ?? []) as WarehouseLite[];
  const loading = txnQ.isLoading || whQ.isLoading;

  // Client-side filter already handled server-side via search/type; keep memo for display count
  const filtered = rows;

  async function load() {
    await txnQ.refetch();
  }

  const wh = (id: string | null) => {
    const w = warehouses.find((x) => x.id === id);
    return w ? (w.type ? `${w.name} (${w.type})` : w.name) : "—";
  };

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteTransaction(deleting.id);
      toast.success("Transaction deleted");
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
            <span>Inventory Transactions</span>
            <Button size="sm" onClick={() => setOpenNew(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Transaction
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input
            placeholder="Txn no / Model / Part / Serial / OEM / Indent / Case / Ticket…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v);
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(TXN_TYPE_LABEL).map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground self-center">
            {filtered.length} of {totalCount} · page {page + 1}/{totalPages}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-hidden">
          {txnQ.isLoading ? (
            <TableSkeleton rows={6} />
          ) : (
            <div
              className="max-h-[60vh] overflow-auto overscroll-contain scroll-pt-0"
              style={{ contain: "content" }}
            >
              <table className="w-full text-sm table-fixed">
                <thead className="bg-muted sticky top-0 z-10">
                  <tr className="text-left">
                    <th className="p-2">Txn No</th>
                    <th className="p-2">Date</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Model / Part · Serial</th>
                    <th className="p-2">From</th>
                    <th className="p-2">To</th>
                    <th className="p-2">Qty</th>
                    <th className="p-2">Indent / Case</th>
                    <th className="p-2">Ref</th>
                    {isAdmin && <th className="p-2 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={isAdmin ? 10 : 9}>
                        Loading…
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={isAdmin ? 10 : 9}>
                        No transactions.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 font-mono">{r.txn_no}</td>
                        <td className="p-2">{new Date(r.txn_date).toLocaleString()}</td>
                        <td className="p-2">
                          <Badge variant="outline">{TXN_TYPE_LABEL[r.txn_type]}</Badge>
                        </td>
                        <td className="p-2">
                          {r.part_name || "—"}
                          {r.part_serial_no ? ` / ${r.part_serial_no}` : ""}
                        </td>
                        <td className="p-2">
                          {wh(r.from_warehouse_id)}
                          {r.from_party ? ` (${r.from_party})` : ""}
                        </td>
                        <td className="p-2">
                          {wh(r.to_warehouse_id)}
                          {r.to_party ? ` (${r.to_party})` : ""}
                        </td>
                        <td className="p-2">{r.qty}</td>
                        <td className="p-2 text-xs font-mono">
                          {r.indent_id ? <div>IND: {r.indent_id.slice(0, 8)}…</div> : null}
                          {r.oem_case_id ? <div>Case: {r.oem_case_id}</div> : null}
                          {!r.indent_id && !r.oem_case_id ? "—" : null}
                        </td>
                        <td className="p-2 text-xs">{r.reference || "—"}</td>
                        {isAdmin && (
                          <td className="p-2 text-right whitespace-nowrap">
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
            total={totalCount}
            onPage={setPage}
            isFetching={txnQ.isFetching && !txnQ.isLoading}
          />
        </CardContent>
      </Card>

      <NewTxnDialog
        open={openNew}
        onOpenChange={setOpenNew}
        warehouses={warehouses}
        onSaved={load}
      />
      <AlertDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove transaction{" "}
              <span className="font-mono">{deleting?.txn_no}</span>. This cannot be undone.
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

function NewTxnDialog({
  open,
  onOpenChange,
  warehouses,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  warehouses: WarehouseLite[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    txn_type: "good_in" as TxnType,
    product_id: "",
    product_type: "",
    part_name: "",
    part_model_no: "",
    part_serial_no: "",
    oem: "",
    from_warehouse_id: "",
    to_warehouse_id: "",
    from_party: "",
    to_party: "",
    qty: 1,
    reference: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      await createTransaction({
        txn_type: form.txn_type,
        part_name: form.part_name || null,
        part_model_no: form.part_model_no || null,
        part_serial_no: form.part_serial_no || null,
        oem: form.oem || null,
        from_warehouse_id: form.from_warehouse_id || null,
        to_warehouse_id: form.to_warehouse_id || null,
        from_party: form.from_party || null,
        to_party: form.to_party || null,
        qty: Number(form.qty) || 1,
        reference: form.reference || null,
        notes: form.notes || null,
      });
      toast.success("Transaction recorded");
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Inventory Transaction</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Type</Label>
            <Select value={form.txn_type} onValueChange={(v) => set("txn_type", v as TxnType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TXN_TYPE_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Model / Part</Label>
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
              </div>
            )}
          </div>
          <div>
            <Label>OEM</Label>
            <Input value={form.oem} onChange={(e) => set("oem", e.target.value)} />
          </div>
          <div>
            <Label>Model / Part Name</Label>
            <Input value={form.part_name} onChange={(e) => set("part_name", e.target.value)} />
          </div>
          <div>
            <Label>Model / Part No</Label>
            <Input
              value={form.part_model_no}
              onChange={(e) => set("part_model_no", e.target.value)}
            />
          </div>
          <div>
            <Label>Model / Part Serial No</Label>
            <ImsSerialPicker
              value={form.part_serial_no || null}
              partModelNo={form.part_model_no || null}
              partName={form.part_name || null}
              warehouseId={form.from_warehouse_id || null}
              allowManual
              onSelect={(item, serial) =>
                setForm((f) => ({
                  ...f,
                  part_serial_no: serial,
                  ...(item
                    ? {
                        part_model_no: item.part_model_no || f.part_model_no,
                        part_name: item.part_name || f.part_name,
                        from_warehouse_id: f.from_warehouse_id || item.warehouse_id || "",
                      }
                    : {}),
                }))
              }
            />
          </div>
          <div>
            <Label>From Warehouse</Label>
            <Select
              value={form.from_warehouse_id}
              onValueChange={(v) => set("from_warehouse_id", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>To Warehouse</Label>
            <Select value={form.to_warehouse_id} onValueChange={(v) => set("to_warehouse_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>From Party</Label>
            <Input value={form.from_party} onChange={(e) => set("from_party", e.target.value)} />
          </div>
          <div>
            <Label>To Party</Label>
            <Input value={form.to_party} onChange={(e) => set("to_party", e.target.value)} />
          </div>
          <div>
            <Label>Qty</Label>
            <Input type="number" value={form.qty} onChange={(e) => set("qty", e.target.value)} />
          </div>
          <div>
            <Label>Reference</Label>
            <Input value={form.reference} onChange={(e) => set("reference", e.target.value)} />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
