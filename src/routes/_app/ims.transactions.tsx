import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  listTransactions, createTransaction, listWarehouses,
  TXN_TYPE_LABEL, type Transaction, type WarehouseLite, type TxnType,
} from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/transactions")({
  component: TransactionsList,
});

function TransactionsList() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [t, w] = await Promise.all([listTransactions(), listWarehouses()]);
      setRows(t); setWarehouses(w);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    return rows.filter((r) => {
      if (type !== "all" && r.txn_type !== type) return false;
      if (!s) return true;
      return [r.txn_no, r.part_name, r.part_model_no, r.part_serial_no, r.oem, r.reference, r.notes, r.indent_id, r.ticket_id, r.oem_case_id]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [rows, q, type]);

  const wh = (id: string | null) => {
    const w = warehouses.find((x) => x.id === id);
    return w ? (w.type ? `${w.name} (${w.type})` : w.name) : "—";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Inventory Transactions</span>
            <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> New Transaction</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Input placeholder="Txn no / part / serial / indent / case / ticket…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(TXN_TYPE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground self-center">{filtered.length} of {rows.length}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Txn No</th>
                <th className="p-2">Date</th>
                <th className="p-2">Type</th>
                <th className="p-2">Part / Serial</th>
                <th className="p-2">From</th>
                <th className="p-2">To</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Indent / Case</th>
                <th className="p-2">Ref</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={9}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={9}>No transactions.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-mono">{r.txn_no}</td>
                  <td className="p-2">{new Date(r.txn_date).toLocaleString()}</td>
                  <td className="p-2"><Badge variant="outline">{TXN_TYPE_LABEL[r.txn_type]}</Badge></td>
                  <td className="p-2">{r.part_name || "—"}{r.part_serial_no ? ` / ${r.part_serial_no}` : ""}</td>
                  <td className="p-2">{wh(r.from_warehouse_id)}{r.from_party ? ` (${r.from_party})` : ""}</td>
                  <td className="p-2">{wh(r.to_warehouse_id)}{r.to_party ? ` (${r.to_party})` : ""}</td>
                  <td className="p-2">{r.qty}</td>
                  <td className="p-2 text-xs font-mono">
                    {r.indent_id ? <div>IND: {r.indent_id.slice(0, 8)}…</div> : null}
                    {r.oem_case_id ? <div>Case: {r.oem_case_id}</div> : null}
                    {!r.indent_id && !r.oem_case_id ? "—" : null}
                  </td>
                  <td className="p-2 text-xs">{r.reference || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <NewTxnDialog open={openNew} onOpenChange={setOpenNew} warehouses={warehouses} onSaved={load} />
    </div>
  );
}

function NewTxnDialog({ open, onOpenChange, warehouses, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; warehouses: WarehouseLite[]; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    txn_type: "good_in" as TxnType, part_name: "", part_model_no: "", part_serial_no: "",
    oem: "", from_warehouse_id: "", to_warehouse_id: "", from_party: "", to_party: "",
    qty: 1, reference: "", notes: "",
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: any) { setForm((f) => ({ ...f, [k]: v })); }

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
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New Inventory Transaction</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Type</Label>
            <Select value={form.txn_type} onValueChange={(v) => set("txn_type", v as TxnType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TXN_TYPE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>OEM</Label><Input value={form.oem} onChange={(e) => set("oem", e.target.value)} /></div>
          <div><Label>Part Name</Label><Input value={form.part_name} onChange={(e) => set("part_name", e.target.value)} /></div>
          <div><Label>Model</Label><Input value={form.part_model_no} onChange={(e) => set("part_model_no", e.target.value)} /></div>
          <div><Label>Serial</Label><Input value={form.part_serial_no} onChange={(e) => set("part_serial_no", e.target.value)} /></div>
          <div>
            <Label>From Warehouse</Label>
            <Select value={form.from_warehouse_id} onValueChange={(v) => set("from_warehouse_id", v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>To Warehouse</Label>
            <Select value={form.to_warehouse_id} onValueChange={(v) => set("to_warehouse_id", v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>From Party</Label><Input value={form.from_party} onChange={(e) => set("from_party", e.target.value)} /></div>
          <div><Label>To Party</Label><Input value={form.to_party} onChange={(e) => set("to_party", e.target.value)} /></div>
          <div><Label>Qty</Label><Input type="number" value={form.qty} onChange={(e) => set("qty", e.target.value)} /></div>
          <div><Label>Reference</Label><Input value={form.reference} onChange={(e) => set("reference", e.target.value)} /></div>
          <div className="col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}