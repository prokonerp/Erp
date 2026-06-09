import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Save, X, Upload } from "lucide-react";
import { toast } from "sonner";
import { ExportButtons } from "@/components/ExportButtons";
import { toTitleCaseSmart, upperTrim } from "@/lib/text";
import { parseCSV } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type { ProductMaster } from "@/components/ProductPicker";

export const Route = createFileRoute("/_app/masters/products")({
  component: ProductMasterPage,
  head: () => ({ meta: [{ title: "Product Master — Prokon" }] }),
});

const UNITS = ["Nos", "Pcs", "Set", "Box", "Mtr", "Kg", "Ltr", "Pkt"] as const;

type FormState = {
  name: string;
  category: string;
  brand: string;
  model: string;
  unit: string;
  hsn: string;
  default_price: string;
  description: string;
  active: boolean;
};

const empty: FormState = {
  name: "", category: "", brand: "", model: "", unit: "Nos",
  hsn: "", default_price: "", description: "", active: true,
};

export function ProductMasterPage() {
  const [rows, setRows] = useState<ProductMaster[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const { data } = await supabase.from("products").select("*").order("name");
    setRows((data || []) as unknown as ProductMaster[]);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((p) => {
    const s = q.toLowerCase();
    return !s || [p.name, p.brand, p.model, p.category, p.hsn].some((v) => (v || "").toLowerCase().includes(s));
  }), [rows, q]);

  function resetForm() { setForm(empty); setEditingId(null); }
  function startNew() { resetForm(); setOpen(true); }
  function startEdit(p: ProductMaster) {
    setForm({
      name: p.name || "",
      category: p.category || "",
      brand: p.brand || "",
      model: p.model || "",
      unit: p.unit || "Nos",
      hsn: p.hsn || "",
      default_price: p.default_price != null ? String(p.default_price) : "",
      description: p.description || "",
      active: p.active !== false,
    });
    setEditingId(p.id);
    setOpen(true);
  }

  async function save(addAnother = false) {
    if (!form.name.trim()) { toast.error("Product name is required"); return; }
    const payload = {
      name: toTitleCaseSmart(form.name),
      category: form.category ? toTitleCaseSmart(form.category) : null,
      brand: form.brand ? toTitleCaseSmart(form.brand) : null,
      model: form.model ? upperTrim(form.model) : null,
      unit: form.unit || "Nos",
      hsn: form.hsn ? upperTrim(form.hsn) : null,
      default_price: form.default_price ? Number(form.default_price) : null,
      description: form.description || null,
      active: form.active,
    };
    if (editingId) {
      const { error } = await supabase.from("products").update(payload as any).eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success("Product updated");
    } else {
      const { error } = await supabase.from("products").insert(payload as any);
      if (error) return toast.error(error.message);
      toast.success("Product added");
    }
    await load();
    if (addAnother) resetForm();
    else { setOpen(false); resetForm(); }
  }

  async function del(id: string) {
    if (!confirm("Delete this product?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
  }

  async function onImport(file: File) {
    try {
      const text = await file.text();
      const rowsCsv = parseCSV(text);
      if (!rowsCsv.length) return toast.error("Empty CSV");
      const payload = rowsCsv.map((r) => ({
        name: toTitleCaseSmart(r["Name"] || r["Product"] || r["Product Name"] || ""),
        category: toTitleCaseSmart(r["Category"] || "") || null,
        brand: toTitleCaseSmart(r["Brand"] || "") || null,
        model: upperTrim(r["Model"] || "") || null,
        unit: r["Unit"] || "Nos",
        hsn: upperTrim(r["HSN"] || "") || null,
        default_price: r["Price"] || r["Default Price"] ? Number(r["Price"] || r["Default Price"]) : null,
        description: r["Description"] || null,
        active: true,
      })).filter((p) => p.name);
      if (!payload.length) return toast.error("No valid rows. Required: Name");
      const { error } = await supabase.from("products").insert(payload as any);
      if (error) return toast.error(error.message);
      toast.success(`Imported ${payload.length} product(s)`);
      load();
    } catch (e: any) { toast.error(e?.message || "Import failed"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Product Master</h1>
          <p className="text-sm text-muted-foreground">Single source of truth for products used across Gatepass, Sales, AMC, Service, Inventory and Reports.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1" />Import CSV</Button>
          <ExportButtons
            name="Prokon_Products"
            title="Product Master"
            rows={filtered}
            columns={[
              { header: "Name", get: (p) => p.name },
              { header: "Category", get: (p) => p.category || "" },
              { header: "Brand", get: (p) => p.brand || "" },
              { header: "Model", get: (p) => p.model || "" },
              { header: "Unit", get: (p) => p.unit },
              { header: "HSN", get: (p) => p.hsn || "" },
              { header: "Price", get: (p) => p.default_price ?? "" },
              { header: "Active", get: (p) => p.active === false ? "No" : "Yes" },
              { header: "Description", get: (p) => p.description || "" },
            ]}
          />
          <Button size="sm" onClick={startNew}><Plus className="h-4 w-4 mr-1" />New Product</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">All Products ({rows.length})</CardTitle>
          <Input placeholder="Search by name, brand, model, HSN…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Brand / Model</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>HSN</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className={cn(p.active === false && "opacity-50")}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.category || "—"}</TableCell>
                  <TableCell className="text-xs">{[p.brand, p.model].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell>{p.unit}</TableCell>
                  <TableCell className="text-xs">{p.hsn || "—"}</TableCell>
                  <TableCell className="text-right">{p.default_price != null ? `₹${Number(p.default_price).toLocaleString("en-IN")}` : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No products. Click <b>New Product</b> or <b>Import CSV</b>.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b">
            <DialogTitle className="text-xl">{editingId ? "Edit Product" : "New Product"}</DialogTitle>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label>Product Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. APC Smart-UPS 1500VA" />
              </div>
              <div>
                <Label>Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="UPS / Battery / Accessory" />
              </div>
              <div>
                <Label>Brand</Label>
                <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="APC / Schneider / Luminous" />
              </div>
              <div>
                <Label>Model</Label>
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="SMT1500I" className="font-mono" />
              </div>
              <div>
                <Label>Unit</Label>
                <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>HSN / SAC Code</Label>
                <Input value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} placeholder="8504" className="font-mono" />
              </div>
              <div>
                <Label>Default Price (₹)</Label>
                <Input type="number" min="0" step="0.01" value={form.default_price} onChange={(e) => setForm({ ...form, default_price: e.target.value })} placeholder="Optional" />
              </div>
              <div className="md:col-span-2">
                <Label>Description</Label>
                <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Specs / line-item description used on quotations" />
              </div>
              <div className="md:col-span-2 flex items-center gap-2">
                <Checkbox id="active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: !!v })} />
                <Label htmlFor="active" className="text-sm font-normal cursor-pointer">Active (available in transaction dropdowns)</Label>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-6 py-4 border-t bg-muted/30 sticky bottom-0">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
            <div className="flex gap-2">
              {!editingId && <Button variant="outline" onClick={() => save(true)}><Plus className="h-4 w-4 mr-1" />Save & New</Button>}
              <Button onClick={() => save(false)}><Save className="h-4 w-4 mr-1" />{editingId ? "Update" : "Save"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}