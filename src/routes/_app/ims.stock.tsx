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
import { Plus, Search } from "lucide-react";
import {
  listStock, createStock, listWarehouses,
  STOCK_STATUS_LABEL, STOCK_TYPE_LABEL,
  type StockItem, type WarehouseLite,
} from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/stock")({
  component: StockLedger,
});

function StockLedger() {
  const [rows, setRows] = useState<StockItem[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([listStock(), listWarehouses()]);
      setRows(s); setWarehouses(w);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    return rows.filter((r) => {
      if (type !== "all" && r.stock_type !== type) return false;
      if (status !== "all" && r.stock_status !== status) return false;
      if (!s) return true;
      return [r.part_name, r.part_model_no, r.part_serial_no, r.oem, r.oem_case_id, r.customer_name]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [rows, q, type, status]);

  const whName = (id: string | null) => warehouses.find((w) => w.id === id)?.name || "—";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2"><Search className="h-4 w-4" /> Stock Ledger</span>
            <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> New Stock Entry</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input placeholder="Serial / Model / Part / OEM / Case ID / Customer…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="defective">Defective</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STOCK_STATUS_LABEL).map(([k, l]) => (
                  <SelectItem key={k} value={k}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-sm text-muted-foreground self-center">{filtered.length} of {rows.length}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">OEM</th>
                <th className="p-2">Part</th>
                <th className="p-2">Model</th>
                <th className="p-2">Serial</th>
                <th className="p-2">Warehouse</th>
                <th className="p-2">Type</th>
                <th className="p-2">Status</th>
                <th className="p-2">Ticket / Indent</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={8}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={8}>No stock items.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.oem || "—"}</td>
                  <td className="p-2">{r.part_name}</td>
                  <td className="p-2">{r.part_model_no || "—"}</td>
                  <td className="p-2 font-mono">{r.part_serial_no || "—"}</td>
                  <td className="p-2">{whName(r.warehouse_id)}</td>
                  <td className="p-2"><Badge variant={r.stock_type === "good" ? "default" : "secondary"}>{STOCK_TYPE_LABEL[r.stock_type]}</Badge></td>
                  <td className="p-2"><Badge variant="outline">{STOCK_STATUS_LABEL[r.stock_status]}</Badge></td>
                  <td className="p-2 font-mono text-xs">{r.ticket_id || r.indent_id || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <NewStockDialog open={openNew} onOpenChange={setOpenNew} warehouses={warehouses} onSaved={load} />
    </div>
  );
}

function NewStockDialog({ open, onOpenChange, warehouses, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; warehouses: WarehouseLite[]; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    oem: "", category: "", part_name: "", part_model_no: "", part_serial_no: "",
    warehouse_id: "", stock_type: "good", oem_case_id: "", customer_name: "", notes: "",
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.part_name.trim()) { toast.error("Part Name is required"); return; }
    setSaving(true);
    try {
      await createStock({
        oem: form.oem || null,
        category: form.category || null,
        part_name: form.part_name.trim(),
        part_model_no: form.part_model_no || null,
        part_serial_no: form.part_serial_no || null,
        warehouse_id: form.warehouse_id || null,
        stock_type: form.stock_type as "good" | "defective",
        oem_case_id: form.oem_case_id || null,
        customer_name: form.customer_name || null,
        notes: form.notes || null,
      });
      toast.success("Stock item created");
      onOpenChange(false);
      setForm({ oem: "", category: "", part_name: "", part_model_no: "", part_serial_no: "",
        warehouse_id: "", stock_type: "good", oem_case_id: "", customer_name: "", notes: "" });
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>New Stock Entry</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>OEM</Label><Input value={form.oem} onChange={(e) => set("oem", e.target.value)} /></div>
          <div><Label>Category</Label><Input value={form.category} onChange={(e) => set("category", e.target.value)} /></div>
          <div className="col-span-2"><Label>Part Name *</Label><Input value={form.part_name} onChange={(e) => set("part_name", e.target.value)} /></div>
          <div><Label>Part Model No</Label><Input value={form.part_model_no} onChange={(e) => set("part_model_no", e.target.value)} /></div>
          <div><Label>Part Serial No (unique)</Label><Input value={form.part_serial_no} onChange={(e) => set("part_serial_no", e.target.value)} /></div>
          <div>
            <Label>Warehouse</Label>
            <Select value={form.warehouse_id} onValueChange={(v) => set("warehouse_id", v)}>
              <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}{w.type ? ` (${w.type})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Stock Type</Label>
            <Select value={form.stock_type} onValueChange={(v) => set("stock_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="defective">Defective</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>OEM Case ID</Label><Input value={form.oem_case_id} onChange={(e) => set("oem_case_id", e.target.value)} /></div>
          <div><Label>Customer Name</Label><Input value={form.customer_name} onChange={(e) => set("customer_name", e.target.value)} /></div>
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