import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Save, X, Pencil, Upload, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { upperTrim } from "@/lib/text";

type Product = {
  id: string;
  name: string;
  serial_tracking?: boolean;
  serial_mode?: string;
  serial_format?: string | null;
  warranty_applicable?: boolean;
  warranty_duration?: number | null;
  warranty_unit?: string | null;
  warranty_start_from?: string | null;
  warranty_manual_override?: boolean;
};

type Serial = {
  id: string;
  product_id: string;
  serial_number: string;
  purchase_invoice_no: string | null;
  purchase_date: string | null;
  supplier_id: string | null;
  sale_invoice_no: string | null;
  customer_id: string | null;
  installation_date: string | null;
  warranty_start_date: string | null;
  warranty_end_date: string | null;
  status: string;
  notes: string | null;
  warehouse_id?: string | null;
};

const STATUSES = ["In Stock", "Sold", "Installed", "Under Service", "Replaced", "Scrapped"] as const;

const empty = (product_id: string): Partial<Serial> => ({
  product_id, serial_number: "", purchase_invoice_no: "", purchase_date: null,
  supplier_id: null, sale_invoice_no: "", customer_id: null, installation_date: null,
  warranty_start_date: null, warranty_end_date: null, status: "In Stock", notes: "",
  warehouse_id: null,
});

function addDuration(start: string, qty: number, unit: string): string {
  const d = new Date(start);
  if (unit === "Years") d.setFullYear(d.getFullYear() + qty);
  else d.setMonth(d.getMonth() + qty);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function SerialsManager({ product }: { product: Product }) {
  const [rows, setRows] = useState<Serial[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; company: string | null; contact_name: string | null }[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string; code: string }[]>([]);
  const [editing, setEditing] = useState<Partial<Serial> | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("__all");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkQty, setBulkQty] = useState(10);
  const [bulkWarehouse, setBulkWarehouse] = useState<string>("__none");
  const [bulkStatus, setBulkStatus] = useState("In Stock");
  const [bulkInvoice, setBulkInvoice] = useState("");
  const [bulkDate, setBulkDate] = useState<string>("");

  const load = async () => {
    const [{ data: ser }, { data: ven }, { data: cust }, { data: wh }] = await Promise.all([
      supabase.from("serials").select("*").eq("product_id", product.id).order("created_at", { ascending: false }),
      supabase.from("vendors").select("id,name").order("name"),
      supabase.from("customers").select("id,company,contact_name").order("company"),
      supabase.from("warehouses").select("id,name,code").eq("status", "Active").order("name"),
    ]);
    setRows((ser || []) as Serial[]);
    setVendors((ven || []) as any);
    setCustomers((cust || []) as any);
    setWarehouses((wh || []) as any);
  };
  useEffect(() => { load(); }, [product.id]);

  const filtered = useMemo(() => rows.filter((r) => {
    const s = q.toLowerCase();
    const matchQ = !s || [r.serial_number, r.purchase_invoice_no, r.sale_invoice_no].some((v) => (v || "").toLowerCase().includes(s));
    const matchS = statusFilter === "__all" || r.status === statusFilter;
    return matchQ && matchS;
  }), [rows, q, statusFilter]);

  function recalcWarranty(s: Partial<Serial>): Partial<Serial> {
    if (!product.warranty_applicable || !product.warranty_duration) return s;
    const startFrom = product.warranty_start_from || "Invoice Date";
    let base: string | null | undefined;
    if (startFrom === "Invoice Date") base = s.purchase_date;
    else if (startFrom === "Installation Date") base = s.installation_date;
    else base = s.warranty_start_date;
    if (!base) return s;
    const end = addDuration(base, product.warranty_duration, product.warranty_unit || "Months");
    return { ...s, warranty_start_date: base, warranty_end_date: end };
  }

  async function save() {
    if (!editing) return;
    const sn = (editing.serial_number || "").trim();
    if (!sn) { toast.error("Serial number is required"); return; }
    const calc = recalcWarranty({ ...editing, serial_number: upperTrim(sn) });
    const payload: any = {
      product_id: product.id,
      serial_number: calc.serial_number,
      purchase_invoice_no: calc.purchase_invoice_no || null,
      purchase_date: calc.purchase_date || null,
      supplier_id: calc.supplier_id || null,
      sale_invoice_no: calc.sale_invoice_no || null,
      customer_id: calc.customer_id || null,
      installation_date: calc.installation_date || null,
      warranty_start_date: calc.warranty_start_date || null,
      warranty_end_date: calc.warranty_end_date || null,
      status: calc.status || "In Stock",
      notes: calc.notes || null,
      warehouse_id: calc.warehouse_id || null,
    };
    const op = editing.id
      ? supabase.from("serials").update(payload).eq("id", editing.id)
      : supabase.from("serials").insert(payload);
    const { error } = await op;
    if (error) return toast.error(error.message.includes("serials_serial_number_unique") ? "Serial number already exists" : error.message);
    toast.success(editing.id ? "Updated" : "Added");
    setEditing(null); load();
  }

  async function del(id: string) {
    if (!confirm("Delete this serial?")) return;
    const { error } = await supabase.from("serials").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  }

  async function bulkSave() {
    const lines = bulkText.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) { toast.error("Enter or paste at least one serial number"); return; }
    const unique = Array.from(new Set(lines.map((l) => l.toUpperCase())));
    if (unique.length !== lines.length) toast.warning(`Removed ${lines.length - unique.length} duplicate(s) in your list`);
    const payload = unique.map((sn) => {
      const base: Partial<Serial> = {
        product_id: product.id,
        serial_number: sn,
        purchase_invoice_no: bulkInvoice || null,
        purchase_date: bulkDate || null,
        status: bulkStatus,
        warehouse_id: bulkWarehouse === "__none" ? null : bulkWarehouse,
      };
      return recalcWarranty(base);
    });
    const { error, data } = await supabase.from("serials").insert(payload as any).select("id");
    if (error) return toast.error(error.message.includes("serials_serial_number_unique") ? "Some serial(s) already exist. Remove duplicates and retry." : error.message);
    toast.success(`Added ${data?.length || 0} serials`);
    setBulkOpen(false); setBulkText(""); setBulkInvoice(""); setBulkDate(""); load();
  }

  async function onCsvUpload(file: File) {
    const text = await file.text();
    setBulkText(text);
    setBulkOpen(true);
  }

  function statusBadge(s: string) {
    const map: Record<string, string> = {
      "In Stock": "bg-blue-100 text-blue-800",
      "Sold": "bg-green-100 text-green-800",
      "Installed": "bg-emerald-100 text-emerald-800",
      "Under Service": "bg-amber-100 text-amber-800",
      "Replaced": "bg-purple-100 text-purple-800",
      "Scrapped": "bg-red-100 text-red-800",
    };
    return <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs ${map[s] || "bg-muted"}`}>{s}</span>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Input placeholder="Search serial / invoice…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <label className="inline-flex">
            <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => e.target.files?.[0] && onCsvUpload(e.target.files[0])} />
            <Button size="sm" variant="outline" asChild><span><Upload className="h-4 w-4 mr-1" />Import</span></Button>
          </label>
          <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}><LayoutGrid className="h-4 w-4 mr-1" />Bulk Add</Button>
          <Button size="sm" onClick={() => setEditing(empty(product.id))}><Plus className="h-4 w-4 mr-1" />Add Serial</Button>
        </div>
      </div>

      {product.serial_format && (
        <p className="text-xs text-muted-foreground">Expected format: <span className="font-mono">{product.serial_format}</span></p>
      )}

      <div className="text-xs text-muted-foreground">
        {rows.length} total · In Stock: {rows.filter((r) => r.status === "In Stock").length} · Sold: {rows.filter((r) => r.status === "Sold").length} · Installed: {rows.filter((r) => r.status === "Installed").length}
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Serial #</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Warehouse</TableHead>
            <TableHead>Purchase</TableHead>
            <TableHead>Sale / Customer</TableHead>
            <TableHead>Warranty</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const cust = customers.find((c) => c.id === r.customer_id);
              const wh = warehouses.find((w) => w.id === r.warehouse_id);
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.serial_number}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-xs">{wh ? `${wh.code} — ${wh.name}` : "—"}</TableCell>
                  <TableCell className="text-xs">{r.purchase_invoice_no || "—"}<br /><span className="text-muted-foreground">{r.purchase_date || ""}</span></TableCell>
                  <TableCell className="text-xs">{r.sale_invoice_no || "—"}<br /><span className="text-muted-foreground">{cust?.company || cust?.contact_name || ""}</span></TableCell>
                  <TableCell className="text-xs">
                    {r.warranty_start_date ? <>{r.warranty_start_date}<br /><span className="text-muted-foreground">→ {r.warranty_end_date}</span></> : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No serials. Click <b>Add Serial</b> or <b>Bulk Add</b>.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      {bulkOpen && (
        <div className="border rounded-md p-4 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Bulk Add Serials</h4>
            <Button size="sm" variant="ghost" onClick={() => setBulkOpen(false)}><X className="h-4 w-4" /></Button>
          </div>
          <div className="grid md:grid-cols-4 gap-3">
            <div>
              <Label>Status</Label>
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Warehouse</Label>
              <Select value={bulkWarehouse} onValueChange={setBulkWarehouse}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Purchase Invoice #</Label>
              <Input value={bulkInvoice} onChange={(e) => setBulkInvoice(e.target.value)} />
            </div>
            <div>
              <Label>Purchase Date</Label>
              <Input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} />
            </div>
          </div>
          <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <Label>Serial Numbers (one per line, comma, or tab — paste from Excel)</Label>
              <textarea
                className="w-full min-h-[140px] rounded-md border bg-background p-2 text-sm font-mono"
                placeholder={"SN0001\nSN0002\nSN0003"}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Quick generate</Label>
              <div className="flex gap-2">
                <Input type="number" min={1} max={500} value={bulkQty} onChange={(e) => setBulkQty(Number(e.target.value) || 0)} className="w-24" />
                <Button variant="outline" size="sm" onClick={() => {
                  const prefix = product.serial_format || (product.name.replace(/\s+/g, "").slice(0, 4).toUpperCase() + "-");
                  const stamp = Date.now().toString().slice(-4);
                  const list = Array.from({ length: bulkQty }, (_, i) => `${prefix}${stamp}${String(i + 1).padStart(3, "0")}`);
                  setBulkText((t) => (t ? t + "\n" : "") + list.join("\n"));
                }}>Fill rows</Button>
              </div>
              <p className="text-xs text-muted-foreground">Generates {bulkQty} placeholder serials. Edit before saving.</p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {bulkText.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean).length} serials ready
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={bulkSave}><Save className="h-4 w-4 mr-1" />Save All</Button>
          </div>
        </div>
      )}

      {editing && (
        <div className="border rounded-md p-4 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">{editing.id ? "Edit Serial" : "New Serial"}</h4>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <Label>Serial Number *</Label>
              <Input value={editing.serial_number || ""} onChange={(e) => setEditing({ ...editing, serial_number: e.target.value })} className="font-mono" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={editing.status || "In Stock"} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Warehouse</Label>
              <Select value={editing.warehouse_id || "__none"} onValueChange={(v) => setEditing({ ...editing, warehouse_id: v === "__none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Purchase Invoice #</Label>
              <Input value={editing.purchase_invoice_no || ""} onChange={(e) => setEditing({ ...editing, purchase_invoice_no: e.target.value })} />
            </div>
            <div>
              <Label>Purchase Date</Label>
              <Input type="date" value={editing.purchase_date || ""} onChange={(e) => setEditing({ ...editing, purchase_date: e.target.value })} />
            </div>
            <div>
              <Label>Supplier</Label>
              <Select value={editing.supplier_id || "__none"} onValueChange={(v) => setEditing({ ...editing, supplier_id: v === "__none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Sale Invoice #</Label>
              <Input value={editing.sale_invoice_no || ""} onChange={(e) => setEditing({ ...editing, sale_invoice_no: e.target.value })} />
            </div>
            <div>
              <Label>Customer</Label>
              <Select value={editing.customer_id || "__none"} onValueChange={(v) => setEditing({ ...editing, customer_id: v === "__none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.company || c.contact_name || c.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Installation Date</Label>
              <Input type="date" value={editing.installation_date || ""} onChange={(e) => setEditing({ ...editing, installation_date: e.target.value })} />
            </div>
            {product.warranty_applicable && (
              <>
                <div>
                  <Label>Warranty Start {!product.warranty_manual_override && <span className="text-xs text-muted-foreground">(auto)</span>}</Label>
                  <Input type="date" value={editing.warranty_start_date || ""} disabled={!product.warranty_manual_override} onChange={(e) => setEditing({ ...editing, warranty_start_date: e.target.value })} />
                </div>
                <div>
                  <Label>Warranty End {!product.warranty_manual_override && <span className="text-xs text-muted-foreground">(auto)</span>}</Label>
                  <Input type="date" value={editing.warranty_end_date || ""} disabled={!product.warranty_manual_override} onChange={(e) => setEditing({ ...editing, warranty_end_date: e.target.value })} />
                </div>
              </>
            )}
            <div className="md:col-span-3">
              <Label>Notes</Label>
              <Input value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
          </div>
          {product.warranty_applicable && (
            <p className="text-xs text-muted-foreground">
              Warranty auto-calculates from <b>{product.warranty_start_from}</b> + <b>{product.warranty_duration} {product.warranty_unit}</b>.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save}><Save className="h-4 w-4 mr-1" />Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}