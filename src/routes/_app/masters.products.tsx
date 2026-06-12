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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Save, X, Upload, ListOrdered, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ExportButtons } from "@/components/ExportButtons";
import { toTitleCaseSmart, upperTrim } from "@/lib/text";
import { parseCSV } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type { ProductMaster } from "@/components/ProductPicker";
import { SerialsManager } from "@/components/SerialsManager";

export const Route = createFileRoute("/_app/masters/products")({
  component: ProductMasterPage,
  head: () => ({ meta: [{ title: "Product Master — Prokon" }] }),
});

const UNITS = ["Nos", "Pcs", "Set", "Box", "Mtr", "Kg", "Ltr", "Pkt"] as const;
const WARRANTY_TYPES = ["Manufacturer", "Seller", "AMC Covered"] as const;
const WARRANTY_UNITS = ["Months", "Years"] as const;
const WARRANTY_START = ["Invoice Date", "Installation Date", "Manual"] as const;
const SERIAL_MODES = ["Manual", "Auto Generate"] as const;
const DEFAULT_CATEGORIES = ["Accessories", "CCTV", "General", "Inverter/Battery", "Offline UPS", "Online UPS", "Solar Panel", "UPS Battery"];
const TAX_OPTIONS = [
  { value: "EXEMPT", label: "Exempted" },
  { value: "0", label: "0%" },
  { value: "5", label: "5%" },
  { value: "18", label: "18%" },
  { value: "28", label: "28%" },
];

type FormState = {
  name: string;
  sku: string;
  category: string;
  brand: string;
  model: string;
  unit: string;
  hsn: string;
  central_tax: string; // "EXEMPT" | "0" | "5" | ...
  local_tax: string;
  default_price: string;
  description: string;
  active: boolean;
  serial_tracking: boolean;
  serial_mode: string;
  serial_format: string;
  warranty_applicable: boolean;
  warranty_type: string;
  warranty_duration: string;
  warranty_unit: string;
  warranty_start_from: string;
  warranty_manual_override: boolean;
};

const empty: FormState = {
  name: "", sku: "", category: "", brand: "", model: "", unit: "Nos",
  hsn: "", central_tax: "", local_tax: "", default_price: "", description: "", active: true,
  serial_tracking: false, serial_mode: "Manual", serial_format: "",
  warranty_applicable: false, warranty_type: "Manufacturer",
  warranty_duration: "12", warranty_unit: "Months",
  warranty_start_from: "Invoice Date", warranty_manual_override: true,
};

type ProductFull = ProductMaster & {
  sku?: string | null;
  tax_rate?: number | null;
  central_tax_rate?: number | null;
  local_tax_rate?: number | null;
  central_tax_exempt?: boolean | null;
  local_tax_exempt?: boolean | null;
  serial_tracking?: boolean;
  serial_mode?: string;
  serial_format?: string | null;
  warranty_applicable?: boolean;
  warranty_type?: string | null;
  warranty_duration?: number | null;
  warranty_unit?: string | null;
  warranty_start_from?: string | null;
  warranty_manual_override?: boolean;
};

export function ProductMasterPage() {
  const [rows, setRows] = useState<ProductFull[]>([]);
  const [q, setQ] = useState("");
  const [filterCategory, setFilterCategory] = useState("__all");
  const [filterBrand, setFilterBrand] = useState("__all");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [tab, setTab] = useState<"details" | "serials">("details");
  const [serialsFor, setSerialsFor] = useState<ProductFull | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dbCategories, setDbCategories] = useState<string[]>([]);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const load = async () => {
    const { data } = await supabase.from("products").select("*").order("name");
    setRows((data || []) as unknown as ProductFull[]);
  };
  const loadCategories = async () => {
    const { data } = await supabase.from("product_categories" as any).select("name").order("name");
    setDbCategories(((data || []) as { name: string }[]).map((c) => c.name));
  };
  useEffect(() => { load(); loadCategories(); }, []);

  const categoryOptions = useMemo(() => {
    const merged = Array.from(new Set([...DEFAULT_CATEGORIES, ...dbCategories]));
    return merged.sort((a, b) => a.localeCompare(b));
  }, [dbCategories]);

  async function saveNewCategory() {
    const name = newCatName.trim();
    if (!name) return;
    const { error } = await supabase.from("product_categories" as any).insert({ name } as any);
    if (error) return toast.error(error.message.includes("duplicate") ? "Category already exists" : error.message);
    toast.success("Category added");
    setNewCatName("");
    setAddCatOpen(false);
    await loadCategories();
    setForm((f) => ({ ...f, category: name }));
  }

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))) as string[], [rows]);
  const brands = useMemo(() => Array.from(new Set(rows.map((r) => r.brand).filter(Boolean))) as string[], [rows]);

  const filtered = useMemo(() => rows.filter((p) => {
    const s = q.toLowerCase();
    const matchQ = !s || [p.name, p.brand, p.model, p.category, p.hsn, p.sku].some((v) => (v || "").toLowerCase().includes(s));
    const matchCat = filterCategory === "__all" || (p.category || "") === filterCategory;
    const matchBrand = filterBrand === "__all" || (p.brand || "") === filterBrand;
    return matchQ && matchCat && matchBrand;
  }), [rows, q, filterCategory, filterBrand]);

  function resetForm() { setForm(empty); setEditingId(null); setTab("details"); }
  function startNew() { resetForm(); setOpen(true); }
  function startEdit(p: ProductFull) {
    setForm({
      name: p.name || "",
      sku: p.sku || "",
      category: p.category || "",
      brand: p.brand || "",
      model: p.model || "",
      unit: p.unit || "Nos",
      hsn: p.hsn || "",
      central_tax: p.central_tax_exempt ? "EXEMPT" : (p.central_tax_rate != null ? String(p.central_tax_rate) : ""),
      local_tax: p.local_tax_exempt ? "EXEMPT" : (p.local_tax_rate != null ? String(p.local_tax_rate) : ""),
      default_price: p.default_price != null ? String(p.default_price) : "",
      description: p.description || "",
      active: p.active !== false,
      serial_tracking: !!p.serial_tracking,
      serial_mode: p.serial_mode || "Manual",
      serial_format: p.serial_format || "",
      warranty_applicable: !!p.warranty_applicable,
      warranty_type: p.warranty_type || "Manufacturer",
      warranty_duration: p.warranty_duration != null ? String(p.warranty_duration) : "12",
      warranty_unit: p.warranty_unit || "Months",
      warranty_start_from: p.warranty_start_from || "Invoice Date",
      warranty_manual_override: p.warranty_manual_override !== false,
    });
    setEditingId(p.id);
    setOpen(true);
  }

  async function save(addAnother = false) {
    if (!form.brand.trim() && !form.model.trim() && !form.name.trim()) {
      toast.error("Enter Brand and Model (used to identify product)"); return;
    }
    if (!form.category) { toast.error("Category is required"); return; }
    if (!form.central_tax) { toast.error("Central Tax Rate is required"); return; }
    if (!form.local_tax) { toast.error("Local Tax Rate is required"); return; }
    if (form.warranty_applicable && (!form.warranty_duration || Number(form.warranty_duration) <= 0)) {
      toast.error("Warranty duration is required when warranty is applicable"); return;
    }
    const derivedName = form.name.trim() || [form.brand, form.model].filter(Boolean).join(" ").trim() || form.category;
    const payload = {
      name: toTitleCaseSmart(derivedName),
      sku: form.sku ? upperTrim(form.sku) : null,
      category: form.category ? toTitleCaseSmart(form.category) : null,
      brand: form.brand ? toTitleCaseSmart(form.brand) : null,
      model: form.model ? upperTrim(form.model) : null,
      unit: form.unit || "Nos",
      hsn: form.hsn ? upperTrim(form.hsn) : null,
      central_tax_rate: form.central_tax === "EXEMPT" ? null : Number(form.central_tax),
      central_tax_exempt: form.central_tax === "EXEMPT",
      local_tax_rate: form.local_tax === "EXEMPT" ? null : Number(form.local_tax),
      local_tax_exempt: form.local_tax === "EXEMPT",
      tax_rate:
        form.central_tax === "EXEMPT" || form.local_tax === "EXEMPT"
          ? null
          : Number(form.central_tax) + Number(form.local_tax),
      default_price: form.default_price ? Number(form.default_price) : null,
      description: form.description || null,
      active: form.active,
      serial_tracking: form.serial_tracking,
      serial_mode: form.serial_mode,
      serial_format: form.serial_tracking && form.serial_format ? form.serial_format : null,
      warranty_applicable: form.warranty_applicable,
      warranty_type: form.warranty_applicable ? form.warranty_type : null,
      warranty_duration: form.warranty_applicable && form.warranty_duration ? Number(form.warranty_duration) : null,
      warranty_unit: form.warranty_applicable ? form.warranty_unit : null,
      warranty_start_from: form.warranty_applicable ? form.warranty_start_from : null,
      warranty_manual_override: form.warranty_manual_override,
    };
    if (editingId) {
      const { error } = await supabase.from("products").update(payload as any).eq("id", editingId);
      if (error) return toast.error(error.message.includes("products_sku_unique") ? "SKU already in use" : error.message);
      toast.success("Product updated");
    } else {
      const { error } = await supabase.from("products").insert(payload as any);
      if (error) return toast.error(error.message.includes("products_sku_unique") ? "SKU already in use" : error.message);
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
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterBrand} onValueChange={setFilterBrand}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Brand" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Brands</SelectItem>
                {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Search name / model / brand / SKU…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Brand / Model</TableHead>
              <TableHead>Serial</TableHead>
              <TableHead>Warranty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className={cn(p.active === false && "opacity-50")}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-xs font-mono">{p.sku || "—"}</TableCell>
                  <TableCell>{p.category || "—"}</TableCell>
                  <TableCell className="text-xs">{[p.brand, p.model].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell>{p.serial_tracking ? <Badge variant="secondary"><ListOrdered className="h-3 w-3 mr-1" />Yes</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                  <TableCell>{p.warranty_applicable ? <Badge variant="secondary"><ShieldCheck className="h-3 w-3 mr-1" />{p.warranty_duration}{p.warranty_unit === "Years" ? "y" : "m"}</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                  <TableCell className="text-right">{p.default_price != null ? `₹${Number(p.default_price).toLocaleString("en-IN")}` : "—"}</TableCell>
                  <TableCell className="text-right">
                    {p.serial_tracking && <Button size="icon" variant="ghost" title="Manage Serials" onClick={() => setSerialsFor(p)}><ListOrdered className="h-4 w-4" /></Button>}
                    <Button size="icon" variant="ghost" onClick={() => startEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No products. Click <b>New Product</b> or <b>Import CSV</b>.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b">
            <DialogTitle className="text-xl">{editingId ? "Edit Product" : "New Product"}</DialogTitle>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="px-6 py-4">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="serials">Serial &amp; Warranty</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="space-y-4 mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label>Product Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. APC Smart-UPS 1500VA" />
              </div>
              <div>
                <Label>Product Code / SKU</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="UPS-1500-APC" className="font-mono" />
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
                <Label>Tax Rate (%)</Label>
                <Input type="number" min="0" step="0.01" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} placeholder="18" />
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
            </TabsContent>

            <TabsContent value="serials" className="space-y-6 mt-4">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium flex items-center gap-2"><ListOrdered className="h-4 w-4" />Serial Number Tracking</h3>
                    <p className="text-xs text-muted-foreground">Track each unit individually by serial number.</p>
                  </div>
                  <Switch checked={form.serial_tracking} onCheckedChange={(v) => setForm({ ...form, serial_tracking: v })} />
                </div>
                {form.serial_tracking && (
                  <div className="grid md:grid-cols-2 gap-4 pl-1 border-l-2 border-primary/30 pl-4">
                    <div>
                      <Label>Serial Mode</Label>
                      <Select value={form.serial_mode} onValueChange={(v) => setForm({ ...form, serial_mode: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{SERIAL_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Serial Number Format (hint)</Label>
                      <Input value={form.serial_format} onChange={(e) => setForm({ ...form, serial_format: e.target.value })} placeholder="e.g. UPS-2025-####" className="font-mono" />
                    </div>
                    <div className="md:col-span-2 text-xs text-muted-foreground bg-muted/40 rounded p-2">
                      Serial will be <b>mandatory</b> in Purchase, Sales, Gatepass and Service for this product. Duplicate serials are blocked.
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Warranty</h3>
                    <p className="text-xs text-muted-foreground">Auto-calculate warranty start &amp; end dates per unit.</p>
                  </div>
                  <Switch checked={form.warranty_applicable} onCheckedChange={(v) => setForm({ ...form, warranty_applicable: v })} />
                </div>
                {form.warranty_applicable && (
                  <div className="grid md:grid-cols-2 gap-4 border-l-2 border-primary/30 pl-4">
                    <div>
                      <Label>Warranty Type</Label>
                      <Select value={form.warranty_type} onValueChange={(v) => setForm({ ...form, warranty_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{WARRANTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Duration *</Label>
                        <Input type="number" min="1" value={form.warranty_duration} onChange={(e) => setForm({ ...form, warranty_duration: e.target.value })} />
                      </div>
                      <div>
                        <Label>Unit</Label>
                        <Select value={form.warranty_unit} onValueChange={(v) => setForm({ ...form, warranty_unit: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{WARRANTY_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Warranty Starts From</Label>
                      <Select value={form.warranty_start_from} onValueChange={(v) => setForm({ ...form, warranty_start_from: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{WARRANTY_START.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end gap-2">
                      <Checkbox id="wmo" checked={form.warranty_manual_override} onCheckedChange={(v) => setForm({ ...form, warranty_manual_override: !!v })} />
                      <Label htmlFor="wmo" className="text-sm font-normal cursor-pointer">Allow manual override of dates</Label>
                    </div>
                  </div>
                )}
              </section>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between gap-2 px-6 py-4 border-t bg-muted/30 sticky bottom-0">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-1" />Cancel</Button>
            <div className="flex gap-2">
              {!editingId && <Button variant="outline" onClick={() => save(true)}><Plus className="h-4 w-4 mr-1" />Save & New</Button>}
              <Button onClick={() => save(false)}><Save className="h-4 w-4 mr-1" />{editingId ? "Update" : "Save"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!serialsFor} onOpenChange={(o) => { if (!o) setSerialsFor(null); }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Serials — {serialsFor?.name}</DialogTitle>
          </DialogHeader>
          {serialsFor && <SerialsManager product={serialsFor} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}