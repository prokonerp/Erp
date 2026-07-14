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
import { fetchBundleChildrenRaw, saveBundleForParent, type BundleChildRow } from "@/lib/productBundles";

export const Route = createFileRoute("/_app/masters/products")({
  component: ProductMasterPage,
  head: () => ({ meta: [{ title: "Product Master — Prokon" }] }),
});

const UNITS = ["Nos", "Pcs", "Set", "Box", "Mtr", "Kg", "Ltr", "Pkt"] as const;
const WARRANTY_TYPES = ["Manufacturer", "Seller", "AMC Covered"] as const;
const WARRANTY_UNITS = ["Months", "Years"] as const;
const WARRANTY_START = ["Invoice Date", "Installation Date", "Manual"] as const;
const SERIAL_MODES = ["Manual", "Auto Generate"] as const;
const DEFAULT_CATEGORIES = ["Accessories", "CCTV", "General", "Inverter/Battery", "Offline UPS", "Online UPS", "Solar Panel", "UPS Battery", "Spare Parts"];
const SPARE_PARTS_CATEGORY = "Spare Parts";
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
  weight_kg: string;
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
  parent_tagging_required: boolean;
};

const empty: FormState = {
  name: "", sku: "", category: "", brand: "", model: "", unit: "Nos",
  hsn: "", central_tax: "", local_tax: "", default_price: "", description: "", weight_kg: "", active: true,
  serial_tracking: false, serial_mode: "Manual", serial_format: "",
  warranty_applicable: false, warranty_type: "Manufacturer",
  warranty_duration: "12", warranty_unit: "Months",
  warranty_start_from: "Invoice Date", warranty_manual_override: true,
  parent_tagging_required: false,
};

type ProductFull = ProductMaster & {
  sku?: string | null;
  weight_kg?: number | null;
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
  parent_tagging_required?: boolean;
};

export function ProductMasterPage() {
  const [rows, setRows] = useState<ProductFull[]>([]);
  const [q, setQ] = useState("");
  const [filterCategory, setFilterCategory] = useState("__all");
  const [filterBrand, setFilterBrand] = useState("__all");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [tab, setTab] = useState<"details" | "serials" | "bundle">("details");
  const [serialsFor, setSerialsFor] = useState<ProductFull | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dbCategories, setDbCategories] = useState<string[]>([]);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [parentLinks, setParentLinks] = useState<Array<{ parent_product_id: string; active: boolean }>>([]);
  const [linkedSpares, setLinkedSpares] = useState<ProductFull[]>([]);
  const [linkedParents, setLinkedParents] = useState<ProductFull[]>([]);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [bundle, setBundle] = useState<Array<{ child_product_id: string; default_qty: number; mandatory: boolean; editable_qty: boolean; note: string | null }>>([]);
  const [bundleChildPickerOpen, setBundleChildPickerOpen] = useState(false);
  const [bundleChildSearch, setBundleChildSearch] = useState("");
  void linkedParents; // reserved for future UI

  const load = async () => {
    const { data } = await supabase.from("products").select("*").order("name");
    setRows((data || []) as unknown as ProductFull[]);
  };
  const loadCategories = async () => {
    const { data } = await supabase.from("product_categories" as any).select("name").order("name");
    setDbCategories(((data || []) as unknown as { name: string }[]).map((c) => c.name));
  };
  useEffect(() => { load(); loadCategories(); }, []);

  const categoryOptions = useMemo(() => {
    const merged = Array.from(new Set([...DEFAULT_CATEGORIES, ...dbCategories]));
    return merged.sort((a, b) => a.localeCompare(b));
  }, [dbCategories]);

  // Eligible parents for spare-part linking: active, non-spare-parts category, not self.
  const eligibleParents = useMemo(
    () => rows.filter(
      (p) =>
        p.active !== false &&
        (p.category || "") !== SPARE_PARTS_CATEGORY &&
        p.id !== editingId,
    ),
    [rows, editingId],
  );
  const filteredParents = useMemo(() => {
    const s = parentSearch.trim().toLowerCase();
    if (!s) return eligibleParents;
    return eligibleParents.filter((p) =>
      [p.name, p.model, p.brand, p.category].some((v) => (v || "").toLowerCase().includes(s)),
    );
  }, [eligibleParents, parentSearch]);

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

  async function loadLinksForEdit(p: ProductFull) {
    setParentLinks([]);
    setLinkedSpares([]);
    setLinkedParents([]);
    setBundle([]);
    const hasParentTagging = !!p.parent_tagging_required || (p.category || "") === SPARE_PARTS_CATEGORY;
    if (hasParentTagging) {
      const { data } = await supabase
        .from("product_spare_parts" as any)
        .select("parent_product_id, active")
        .eq("spare_part_id", p.id);
      const links = ((data || []) as unknown as { parent_product_id: string; active: boolean | null }[])
        .map((r) => ({ parent_product_id: r.parent_product_id, active: r.active !== false }));
      setParentLinks(links);
      const ids = links.map((l) => l.parent_product_id);
      setLinkedParents(rows.filter((r) => ids.includes(r.id)));
    }
    if (!hasParentTagging || (p.category || "") !== SPARE_PARTS_CATEGORY) {
      const { data } = await supabase
        .from("product_spare_parts" as any)
        .select("spare_part_id")
        .eq("parent_product_id", p.id);
      const ids = ((data || []) as unknown as { spare_part_id: string }[]).map((r) => r.spare_part_id);
      setLinkedSpares(rows.filter((r) => ids.includes(r.id)));
    }
    // Load bundle configuration where this product is the parent.
    try {
      const rowsB: BundleChildRow[] = await fetchBundleChildrenRaw(p.id);
      setBundle(rowsB.map((r) => ({
        child_product_id: r.child_product_id,
        default_qty: Number(r.default_qty) || 1,
        mandatory: !!r.mandatory,
        editable_qty: r.editable_qty !== false,
        note: r.note ?? null,
      })));
    } catch { /* ignore */ }
  }

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))) as string[], [rows]);
  const brands = useMemo(() => Array.from(new Set(rows.map((r) => r.brand).filter(Boolean))) as string[], [rows]);

  const filtered = useMemo(() => rows.filter((p) => {
    const s = q.toLowerCase();
    const matchQ = !s || [p.name, p.brand, p.model, p.category, p.hsn].some((v) => (v || "").toLowerCase().includes(s));
    const matchCat = filterCategory === "__all" || (p.category || "") === filterCategory;
    const matchBrand = filterBrand === "__all" || (p.brand || "") === filterBrand;
    return matchQ && matchCat && matchBrand;
  }), [rows, q, filterCategory, filterBrand]);

  function resetForm() {
    setForm(empty); setEditingId(null); setTab("details");
    setParentLinks([]); setLinkedSpares([]); setLinkedParents([]); setParentSearch("");
    setBundle([]); setBundleChildSearch("");
  }
  function startNew() { resetForm(); setOpen(true); }
  function startEdit(p: ProductFull) {
    setForm({
      name: p.name || "",
      sku: "",
      category: p.category || "",
      brand: p.brand || "",
      model: p.model || "",
      unit: p.unit || "Nos",
      hsn: p.hsn || "",
      central_tax: p.central_tax_exempt ? "EXEMPT" : (p.central_tax_rate != null ? String(p.central_tax_rate) : ""),
      local_tax: p.local_tax_exempt ? "EXEMPT" : (p.local_tax_rate != null ? String(p.local_tax_rate) : ""),
      default_price: p.default_price != null ? String(p.default_price) : "",
      description: p.description || "",
      weight_kg: p.weight_kg != null ? String(p.weight_kg) : "",
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
      parent_tagging_required: !!p.parent_tagging_required || (p.category || "") === SPARE_PARTS_CATEGORY,
    });
    setEditingId(p.id);
    setOpen(true);
    loadLinksForEdit(p);
  }

  async function save(addAnother = false) {
    if (!form.brand.trim() && !form.model.trim() && !form.name.trim()) {
      toast.error("Enter Brand and Model (used to identify product)"); return;
    }
    if (!form.category) { toast.error("Category is required"); return; }
    const isSparePart = form.category === SPARE_PARTS_CATEGORY;
    const requireParents = form.parent_tagging_required || isSparePart;
    if (requireParents && parentLinks.length === 0) {
      toast.error("At least one compatible parent product must be selected.");
      return;
    }
    if (!form.central_tax) { toast.error("Central Tax Rate is required"); return; }
    if (!form.local_tax) { toast.error("Local Tax Rate is required"); return; }
    if (form.warranty_applicable && (!form.warranty_duration || Number(form.warranty_duration) <= 0)) {
      toast.error("Warranty duration is required when warranty is applicable"); return;
    }
    if (form.description && form.description.length > 200) {
      toast.error("Description must be 200 characters or less"); return;
    }
    const derivedName = [form.brand, form.model].filter(Boolean).join(" ").trim() || form.name.trim() || form.category;
    const payload = {
      name: toTitleCaseSmart(derivedName),
      category: form.category ? toTitleCaseSmart(form.category) : null,
      brand: form.brand ? upperTrim(form.brand) : null,
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
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
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
      parent_tagging_required: form.parent_tagging_required || isSparePart,
    };
    let productId = editingId;
    if (editingId) {
      const { error } = await supabase.from("products").update(payload as any).eq("id", editingId);
      if (error) return toast.error(error.message);
      toast.success("Product updated");
    } else {
      const { data, error } = await supabase.from("products").insert(payload as any).select("id").single();
      if (error) return toast.error(error.message);
      productId = (data as { id: string } | null)?.id ?? null;
      toast.success("Product added");
    }

    // Sync spare-part links when category is Spare Parts.
    if (requireParents && productId) {
      await supabase.from("product_spare_parts" as any).delete().eq("spare_part_id", productId);
      if (parentLinks.length) {
        const linkRows = parentLinks.map((l) => ({
          spare_part_id: productId,
          parent_product_id: l.parent_product_id,
          active: l.active,
        }));
        const { error: linkErr } = await supabase.from("product_spare_parts" as any).insert(linkRows as any);
        if (linkErr) toast.error(`Saved product but failed to link parents: ${linkErr.message}`);
      }
    } else if (!requireParents && productId && editingId) {
      // Parent tagging disabled — remove any existing parent links where this product was a child.
      await supabase.from("product_spare_parts" as any).delete().eq("spare_part_id", productId);
    }

    // Persist bundle (replace-all) for this product as parent.
    if (productId) {
      try {
        await saveBundleForParent(productId, bundle.map((b, i) => ({ ...b, sort_order: i })));
      } catch (e: any) {
        toast.error(`Product saved but bundle failed: ${e?.message || e}`);
      }
    }

    await load();
    if (addAnother) resetForm();
    else { setOpen(false); resetForm(); }
  }

  function toggleParent(id: string) {
    setParentLinks((prev) => {
      const found = prev.find((l) => l.parent_product_id === id);
      if (found) return prev.filter((l) => l.parent_product_id !== id);
      return [...prev, { parent_product_id: id, active: true }];
    });
  }
  function setParentActive(id: string, active: boolean) {
    setParentLinks((prev) => prev.map((l) => (l.parent_product_id === id ? { ...l, active } : l)));
  }

  async function downloadCompatibilityReport() {
    const { data } = await supabase
      .from("product_spare_parts" as any)
      .select("parent_product_id, spare_part_id");
    const links = (data || []) as unknown as { parent_product_id: string; spare_part_id: string }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out = links.map((l) => {
      const sp = byId.get(l.spare_part_id);
      const pp = byId.get(l.parent_product_id);
      return {
        spare_part: sp?.name || "",
        spare_part_model: sp?.model || "",
        spare_part_oem: sp?.brand || "",
        parent_product: pp?.name || "",
        parent_model: pp?.model || "",
        parent_oem: pp?.brand || "",
        parent_category: pp?.category || "",
      };
    });
    const headers = ["spare_part", "spare_part_model", "spare_part_oem", "parent_product", "parent_model", "parent_oem", "parent_category"];
    const csv = [headers.join(","), ...out.map((r) => headers.map((h) => `"${String((r as any)[h] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "Prokon_SpareParts_Compatibility.csv"; a.click();
    URL.revokeObjectURL(url);
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
        brand: upperTrim(r["Brand"] || "") || null,
        model: upperTrim(r["Model"] || "") || null,
        unit: r["Unit"] || "Nos",
        hsn: upperTrim(r["HSN"] || "") || null,
        default_price: r["Price"] || r["Default Price"] ? Number(r["Price"] || r["Default Price"]) : null,
        description: r["Description"] || null,
        weight_kg: r["Weight"] || r["Weight (kg)"] ? Number(r["Weight"] || r["Weight (kg)"]) : null,
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
          <Button variant="outline" size="sm" onClick={downloadCompatibilityReport}>Spare Parts Report</Button>
          <ExportButtons
            name="Prokon_Products"
            title="Product Master"
            rows={filtered}
            columns={[
              { header: "Model", get: (p) => p.model || p.name },
              { header: "Category", get: (p) => p.category || "" },
              { header: "Brand", get: (p) => p.brand || "" },
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
            <Input placeholder="Search model / brand / category…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Serial</TableHead>
              <TableHead>Warranty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="w-32 text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <TableRow key={p.id} className={cn(p.active === false && "opacity-50")}>
                  <TableCell className="font-medium font-mono">{p.model || p.name || "—"}</TableCell>
                  <TableCell>{p.category || "—"}</TableCell>
                  <TableCell className="text-xs">{p.brand || "—"}</TableCell>
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

          <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="px-6 py-4">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="serials">Serial &amp; Warranty</TabsTrigger>
              <TabsTrigger value="bundle">Bundle</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="space-y-4 mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <Label>Category *</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => {
                    if (v === "__add_new__") { setAddCatOpen(true); return; }
                    setForm({ ...form, category: v });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    <SelectItem value="__add_new__" className="text-primary font-medium">+ Add New Category</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Brand</Label>
                <Input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value.toUpperCase() })}
                  placeholder="APC / SCHNEIDER / LUMINOUS"
                  className="uppercase"
                />
              </div>
              <div>
                <Label>Model</Label>
                <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="SMT1500I" className="font-mono" />
              </div>
              <div className="md:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Description</Label>
                  <span className={cn("text-[10px]", (form.description?.length || 0) >= 200 ? "text-destructive" : "text-muted-foreground")}>
                    {form.description?.length || 0}/200
                  </span>
                </div>
                <Textarea
                  rows={3}
                  maxLength={200}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value.slice(0, 200) })}
                  placeholder="Specs / line-item description used on quotations"
                />
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
              <div>
                <Label>Weight (kg)</Label>
                <Input type="number" min="0" step="0.01" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} placeholder="e.g. 12.5" />
              </div>
              <div className="md:col-span-2 rounded-md border p-3 bg-muted/30">
                <div className="text-sm font-medium mb-2">Default Tax Rates</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Central Tax Rate *</Label>
                    <Select value={form.central_tax} onValueChange={(v) => setForm({ ...form, central_tax: v, local_tax: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {TAX_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-1">Local tax auto-syncs; override allowed.</p>
                  </div>
                  <div>
                    <Label className="text-xs">Local Tax Rate *</Label>
                    <Select value={form.local_tax} onValueChange={(v) => setForm({ ...form, local_tax: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {TAX_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="md:col-span-2 flex items-center gap-2">
                <Checkbox id="active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: !!v })} />
                <Label htmlFor="active" className="text-sm font-normal cursor-pointer">Active (available in transaction dropdowns)</Label>
              </div>

              <div className="md:col-span-2 flex items-center justify-between rounded-md border p-3 bg-muted/20">
                <div>
                  <Label className="text-sm font-medium">Parent Tagging Required</Label>
                  <p className="text-[11px] text-muted-foreground">Enable to tag compatible parent products (auto-on for Spare Parts).</p>
                </div>
                <Switch
                  checked={form.parent_tagging_required || form.category === SPARE_PARTS_CATEGORY}
                  disabled={form.category === SPARE_PARTS_CATEGORY}
                  onCheckedChange={(v) => setForm({ ...form, parent_tagging_required: v })}
                />
              </div>

              {(form.parent_tagging_required || form.category === SPARE_PARTS_CATEGORY) && (
                <div className="md:col-span-2 rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium">Compatible Parent Products *</Label>
                      <p className="text-[11px] text-muted-foreground">Active parent products this item can be tagged to. Spare-parts items are excluded.</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => setParentPickerOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" />Add Products
                    </Button>
                  </div>
                  {parentLinks.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No parent products selected yet.</p>
                  ) : (
                    <div className="rounded-md border divide-y">
                      {parentLinks.map((link) => {
                        const p = rows.find((r) => r.id === link.parent_product_id);
                        if (!p) return null;
                        return (
                          <div key={link.parent_product_id} className="flex items-center justify-between gap-2 px-3 py-2">
                            <div className="min-w-0">
                              <div className="text-sm font-mono truncate">{p.model || p.name}</div>
                              <div className="text-[11px] text-muted-foreground truncate">{[p.brand, p.category].filter(Boolean).join(" · ")}</div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="flex items-center gap-1.5">
                                <Switch
                                  checked={link.active}
                                  onCheckedChange={(v) => setParentActive(link.parent_product_id, !!v)}
                                />
                                <span className={cn("text-[11px] font-medium", link.active ? "text-primary" : "text-muted-foreground")}>
                                  {link.active ? "Active" : "Inactive"}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleParent(link.parent_product_id)}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label="Remove"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {editingId && form.category !== SPARE_PARTS_CATEGORY && linkedSpares.length > 0 && (
                <div className="md:col-span-2 rounded-md border p-3 space-y-2">
                  <Label className="text-sm font-medium">Linked Spare Parts ({linkedSpares.length})</Label>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Spare Part</TableHead>
                      <TableHead>Model No</TableHead>
                      <TableHead>OEM</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {linkedSpares.map((sp) => (
                        <TableRow key={sp.id}>
                          <TableCell>{sp.name}</TableCell>
                          <TableCell className="font-mono">{sp.model || "—"}</TableCell>
                          <TableCell>{sp.brand || "—"}</TableCell>
                          <TableCell>{sp.active === false ? <Badge variant="outline">Inactive</Badge> : <Badge>Active</Badge>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
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

            <TabsContent value="bundle" className="space-y-3 mt-4">
              <div>
                <h3 className="font-medium flex items-center gap-2">Bundle</h3>
                <p className="text-xs text-muted-foreground">
                  When this product is added to a Quotation or Invoice, the items below are suggested automatically.
                  Mark rows as mandatory to prevent removal; disable "editable qty" to lock the default quantity.
                </p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{bundle.length} child item{bundle.length === 1 ? "" : "s"}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!editingId}
                  onClick={() => setBundleChildPickerOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />Add child products
                </Button>
              </div>
              {!editingId && (
                <div className="text-xs text-muted-foreground italic">Save the product first, then add bundle children.</div>
              )}
              {bundle.length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Child product</TableHead>
                        <TableHead className="w-24 text-right">Default Qty</TableHead>
                        <TableHead className="w-20 text-center">Mandatory</TableHead>
                        <TableHead className="w-20 text-center">Editable Qty</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bundle.map((b, i) => {
                        const c = rows.find((r) => r.id === b.child_product_id);
                        return (
                          <TableRow key={b.child_product_id}>
                            <TableCell>
                              <div className="font-medium">{c?.model || c?.name || "—"}</div>
                              <div className="text-[11px] text-muted-foreground">{[c?.brand, c?.category].filter(Boolean).join(" · ")}</div>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min="0"
                                step="0.001"
                                className="h-8 text-right"
                                value={b.default_qty}
                                onChange={(e) => {
                                  const next = [...bundle]; next[i] = { ...next[i], default_qty: Number(e.target.value) }; setBundle(next);
                                }}
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Checkbox
                                checked={b.mandatory}
                                onCheckedChange={(v) => { const next = [...bundle]; next[i] = { ...next[i], mandatory: !!v }; setBundle(next); }}
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Checkbox
                                checked={b.editable_qty}
                                onCheckedChange={(v) => { const next = [...bundle]; next[i] = { ...next[i], editable_qty: !!v }; setBundle(next); }}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 text-xs"
                                placeholder="Optional note"
                                value={b.note || ""}
                                onChange={(e) => { const next = [...bundle]; next[i] = { ...next[i], note: e.target.value || null }; setBundle(next); }}
                              />
                            </TableCell>
                            <TableCell>
                              <Button size="icon" variant="ghost" onClick={() => setBundle(bundle.filter((_, x) => x !== i))}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
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

      <Dialog open={addCatOpen} onOpenChange={setAddCatOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add New Category</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Category Name</Label>
              <Input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveNewCategory()}
                autoFocus
                placeholder="e.g. Stabilizer"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setAddCatOpen(false); setNewCatName(""); }}>Cancel</Button>
              <Button size="sm" onClick={saveNewCategory}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={parentPickerOpen} onOpenChange={setParentPickerOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle>Select Compatible Parent Products</DialogTitle></DialogHeader>
          <Input
            placeholder="Search by model, brand or category…"
            value={parentSearch}
            onChange={(e) => setParentSearch(e.target.value)}
          />
          <div className="overflow-y-auto border rounded-md">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Category</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filteredParents.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => toggleParent(p.id)}>
                    <TableCell><Checkbox checked={parentLinks.some((l) => l.parent_product_id === p.id)} onCheckedChange={() => toggleParent(p.id)} /></TableCell>
                    <TableCell className="font-mono">{p.model || p.name}</TableCell>
                    <TableCell>{p.brand || "—"}</TableCell>
                    <TableCell>{p.category || "—"}</TableCell>
                  </TableRow>
                ))}
                {filteredParents.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No products match.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-between items-center pt-2">
            <span className="text-sm text-muted-foreground">{parentLinks.length} selected</span>
            <Button size="sm" onClick={() => setParentPickerOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bundleChildPickerOpen} onOpenChange={setBundleChildPickerOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle>Add Bundle Child Products</DialogTitle></DialogHeader>
          <Input
            placeholder="Search by model, brand or category…"
            value={bundleChildSearch}
            onChange={(e) => setBundleChildSearch(e.target.value)}
          />
          <div className="overflow-y-auto border rounded-md">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Category</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows
                  .filter((p) => p.active !== false && p.id !== editingId && !bundle.some((b) => b.child_product_id === p.id))
                  .filter((p) => {
                    const s = bundleChildSearch.trim().toLowerCase();
                    if (!s) return true;
                    return [p.name, p.model, p.brand, p.category].some((v) => (v || "").toLowerCase().includes(s));
                  })
                  .map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => setBundle([...bundle, { child_product_id: p.id, default_qty: 1, mandatory: false, editable_qty: true, note: null }])}
                    >
                      <TableCell><Plus className="h-4 w-4 text-primary" /></TableCell>
                      <TableCell className="font-mono">{p.model || p.name}</TableCell>
                      <TableCell>{p.brand || "—"}</TableCell>
                      <TableCell>{p.category || "—"}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end pt-2">
            <Button size="sm" onClick={() => setBundleChildPickerOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}