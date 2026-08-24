import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ProductPicker } from "@/components/ProductPicker";
import { productWarrantyMonths } from "@/lib/sales";
import { Search, Plus, LifeBuoy, Eye, X, Pencil, Trash2, Upload, FileDown, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { fmtDate } from "@/lib/amc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { parseCSV, buildCSV, downloadCSV } from "@/lib/csv";
import { useIsAdmin } from "@/lib/useRole";
import {
  listEquipmentForCustomer, createEquipment, updateEquipment, deleteEquipment,
  warrantyEnd, coverStatus, amcStatusOf,
  importEquipmentRows, type ImportOutcome,
  statusClass, statusLabel, type InstalledEquipment, type CoverStatus,
  addMonthsIso, monthsBetweenIso, DEFAULT_AMC_MONTHS,
} from "@/lib/installedEquipment";

export const Route = createFileRoute("/_app/installed-equipment")({
  component: InstalledEquipmentPage,
  head: () => ({
    meta: [
      { title: "Installed Equipment — Customer Site Register | Prokon" },
      { name: "description", content: "Customer-wise register of installed units with warranty and AMC status, quick ticket raising and full serial footprint." },
      { property: "og:title", content: "Installed Equipment — Customer Site Register" },
      { property: "og:description", content: "Track installed units per customer with live warranty and AMC coverage status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type ChipKey = `w:${CoverStatus}` | `a:${CoverStatus}`;

const WARRANTY_CHIPS: { key: ChipKey; label: string; status: CoverStatus }[] = [
  { key: "w:active", label: "Warranty: Active", status: "active" },
  { key: "w:expiring", label: "Warranty: Expiring", status: "expiring" },
  { key: "w:expired", label: "Warranty: Expired", status: "expired" },
];
const AMC_CHIPS: { key: ChipKey; label: string; status: CoverStatus }[] = [
  { key: "a:active", label: "AMC: Active", status: "active" },
  { key: "a:expiring", label: "AMC: Expiring", status: "expiring" },
  { key: "a:expired", label: "AMC: Expired", status: "expired" },
  { key: "a:none", label: "AMC: None", status: "none" },
];

const emptyDraft = {
  product_id: null as string | null,
  model_no: "", serial_no: "", invoice_no: "", invoice_date: "",
  warranty_months: "12", amc_start_date: "", amc_end_date: "",
  amc_months: String(DEFAULT_AMC_MONTHS),
  remarks: "",
};

const EQUIPMENT_CSV_HEADERS = [
  "Customer", "Model No", "Serial No", "Invoice No", "Invoice Date",
  "Warranty Months", "AMC Start Date", "AMC Months", "Remarks",
];

function downloadEquipmentTemplate() {
  const csv = buildCSV(EQUIPMENT_CSV_HEADERS, [{
    Customer: "Acme Pvt Ltd",
    "Model No": "LUM-1050",
    "Serial No": "SN00123",
    "Invoice No": "INV-2026-001",
    "Invoice Date": "15/03/2026",
    "Warranty Months": "12",
    "AMC Start Date": "15/03/2027",
    "AMC Months": "12",
    Remarks: "",
  }]);
  downloadCSV("Prokon_installed_equipment_template.csv", csv);
}

function InstalledEquipmentPage() {
  const navigate = useNavigate();
  const { isAdmin } = useIsAdmin();
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [rows, setRows] = useState<InstalledEquipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [chips, setChips] = useState<Set<ChipKey>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteRow, setDeleteRow] = useState<InstalledEquipment | null>(null);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("list");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null);
  const [sortDesc, setSortDesc] = useState(true);

  const load = async (id: string) => {
    setLoading(true);
    try {
      setRows(await listEquipmentForCustomer(id));
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Failed to load installed equipment");
    } finally {
      setLoading(false);
    }
  };

  const onImport = async (file: File) => {
    setImporting(true);
    try {
      const parsed = parseCSV(await file.text());
      if (!parsed.length) { toast.error("Empty CSV"); return; }
      const res = await importEquipmentRows(parsed);
      setImportResult(res);
      if (res.imported) toast.success(`Imported ${res.imported} row(s)`);
      if (customerId) await load(customerId);
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!customerId) { setRows([]); return; }
    void load(customerId);
  }, [customerId]);

  const decorated = useMemo(
    () => rows.map((r) => {
      const wEnd = warrantyEnd(r);
      return { row: r, wEnd, w: coverStatus(wEnd), a: amcStatusOf(r) };
    }),
    [rows],
  );

  const term = q.trim().toLowerCase();
  const textMatched = useMemo(
    () => decorated.filter((d) =>
      !term ||
      (d.row.model_no || "").toLowerCase().includes(term) ||
      (d.row.serial_no || "").toLowerCase().includes(term) ||
      (d.row.invoice_no || "").toLowerCase().includes(term)),
    [decorated, term],
  );

  // Counts reflect the current text search, so chips stay meaningful while typing.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of textMatched) {
      c[`w:${d.w}`] = (c[`w:${d.w}`] || 0) + 1;
      c[`a:${d.a}`] = (c[`a:${d.a}`] || 0) + 1;
    }
    return c;
  }, [textMatched]);

  const filtered = useMemo(() => {
    const wSel = WARRANTY_CHIPS.filter((c) => chips.has(c.key)).map((c) => c.status);
    const aSel = AMC_CHIPS.filter((c) => chips.has(c.key)).map((c) => c.status);
    return textMatched.filter((d) =>
      (wSel.length === 0 || wSel.includes(d.w)) &&
      (aSel.length === 0 || aSel.includes(d.a)));
  }, [textMatched, chips]);

  const toggleChip = (k: ChipKey) =>
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  const anyFilter = chips.size > 0 || term.length > 0;
  const clearFilters = () => { setChips(new Set()); setQ(""); };

  const saveDraft = async () => {
    if (!customerId) return;
    if (!draft.model_no.trim()) { toast.error("Model No is required"); return; }
    setSaving(true);
    try {
      const payload = {
        customer_id: customerId,
        product_id: draft.product_id,
        model_no: draft.model_no.trim(),
        serial_no: draft.serial_no.trim().toUpperCase() || null,
        invoice_no: draft.invoice_no.trim() || null,
        invoice_date: draft.invoice_date || null,
        warranty_months: Number(draft.warranty_months) || 0,
        amc_start_date: draft.amc_start_date || null,
        amc_end_date: draft.amc_end_date || null,
        remarks: draft.remarks.trim() || null,
      };
      if (editId) await updateEquipment(editId, payload);
      else await createEquipment(payload);
      toast.success(editId ? "Equipment updated" : "Equipment added");
      setAddOpen(false);
      setEditId(null);
      setDraft({ ...emptyDraft });
      await load(customerId);
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => { setEditId(null); setDraft({ ...emptyDraft }); setAddOpen(true); };

  // AMC End auto-fills from Start + Period (months). Manual edits stick until
  // Start or Period changes again.
  const setAmcStart = (v: string) =>
    setDraft((d) => {
      const months = Number(d.amc_months) || 0;
      return {
        ...d,
        amc_start_date: v,
        amc_end_date: v && months > 0 ? addMonthsIso(v, months) : d.amc_end_date,
      };
    });

  const setAmcMonths = (v: string) =>
    setDraft((d) => {
      const months = Number(v) || 0;
      return {
        ...d,
        amc_months: v,
        amc_end_date: d.amc_start_date && months > 0 ? addMonthsIso(d.amc_start_date, months) : d.amc_end_date,
      };
    });

  const openEdit = (r: InstalledEquipment) => {
    setEditId(r.id);
    const start = (r.amc_start_date || "").slice(0, 10);
    const end = (r.amc_end_date || "").slice(0, 10);
    // Show the period that reproduces this row's stored dates; blank if custom.
    const derivedMonths = start ? monthsBetweenIso(start, end) : null;
    setDraft({
      product_id: null,
      model_no: r.model_no || "",
      serial_no: r.serial_no || "",
      invoice_no: r.invoice_no || "",
      invoice_date: (r.invoice_date || "").slice(0, 10),
      warranty_months: String(r.warranty_months ?? 0),
      amc_start_date: start,
      amc_months: derivedMonths != null ? String(derivedMonths) : "",
      amc_end_date: end,
      remarks: r.remarks || "",
    });
    setAddOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteRow || !customerId) return;
    try {
      await deleteEquipment(deleteRow.id);
      toast.success("Equipment deleted");
      setDeleteRow(null);
      await load(customerId);
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Could not delete");
    }
  };

  const chipBtn = (c: { key: ChipKey; label: string }) => {
    const on = chips.has(c.key);
    return (
      <button
        key={c.key}
        type="button"
        onClick={() => toggleChip(c.key)}
        aria-pressed={on}
        className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
          on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
        }`}
      >
        {c.label}
        <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${on ? "bg-primary-foreground/20" : "bg-muted"}`}>
          {counts[c.key] || 0}
        </span>
      </button>
    );
  };

  // Summary: model-wise counts for the currently selected customer, same filters.
  const modelCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of filtered) {
      const k = (d.row.model_no || "—").trim();
      m.set(k, (m.get(k) || 0) + 1);
    }
    const list = Array.from(m, ([model, count]) => ({ model, count }));
    list.sort((a, b) => (sortDesc ? b.count - a.count : a.count - b.count) || a.model.localeCompare(b.model));
    return list;
  }, [filtered, sortDesc]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Installed Equipment</h1>
        <p className="text-sm text-muted-foreground">Pick a customer to see every unit installed at their sites with live warranty and AMC coverage.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Customer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <CustomerPicker
              value={customerId}
              onChange={(id, c) => { setCustomerId(id); setCustomerName(c?.company || ""); }}
            />
          </div>
          <Button disabled={!customerId} size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" />Add Equipment
          </Button>
          <input
            ref={fileRef} type="file" accept=".csv,text/csv" hidden
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
          <Button variant="outline" size="sm" disabled={importing} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />{importing ? "Importing…" : "Import CSV"}
          </Button>
          <Button variant="outline" size="sm" onClick={downloadEquipmentTemplate} title="Download a sample CSV with the expected columns">
            <FileDown className="h-4 w-4 mr-1" />Sample CSV
          </Button>
          <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) setEditId(null); }}>
            <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editId ? "Edit" : "Add"} installed equipment{customerName ? ` — ${customerName}` : ""}</DialogTitle>
                <DialogDescription>Pick a model from Product Master — warranty months fill in automatically and stay editable.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Model (from Product Master) *</Label>
                  <ProductPicker
                    value={draft.product_id}
                    onChange={(id, p) => {
                      const months = productWarrantyMonths(p as never);
                      setDraft((d) => ({
                        ...d,
                        product_id: id,
                        model_no: (p?.model || p?.short_name || p?.name || d.model_no || "").trim(),
                        warranty_months: months ? String(months) : d.warranty_months,
                      }));
                    }}
                  />
                </div>
                <div><Label>Model No *</Label><Input value={draft.model_no} onChange={(e) => setDraft({ ...draft, model_no: e.target.value })} /></div>
                <div><Label>Serial No</Label><Input value={draft.serial_no} onChange={(e) => setDraft({ ...draft, serial_no: e.target.value })} /></div>
                <div><Label>Invoice No</Label><Input value={draft.invoice_no} onChange={(e) => setDraft({ ...draft, invoice_no: e.target.value })} /></div>
                <div><Label>Invoice Date</Label><Input type="date" value={draft.invoice_date} onChange={(e) => setDraft({ ...draft, invoice_date: e.target.value })} /></div>
                <div><Label>Warranty (months)</Label><Input type="number" value={draft.warranty_months} onChange={(e) => setDraft({ ...draft, warranty_months: e.target.value })} /></div>
                <div />
                <div><Label>AMC Start</Label><Input type="date" value={draft.amc_start_date} onChange={(e) => setAmcStart(e.target.value)} /></div>
                <div>
                  <Label>AMC Period (months)</Label>
                  <Input type="number" min="0" value={draft.amc_months} onChange={(e) => setAmcMonths(e.target.value)} placeholder="e.g. 12" />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Fills AMC End automatically — still editable.</p>
                </div>
                <div>
                  <Label>AMC End {Number(draft.amc_months) > 0 && draft.amc_start_date ? "(auto)" : ""}</Label>
                  <Input type="date" value={draft.amc_end_date} onChange={(e) => setDraft({ ...draft, amc_end_date: e.target.value })} />
                </div>
                <div className="sm:col-span-2"><Label>Remarks</Label><Input value={draft.remarks} onChange={(e) => setDraft({ ...draft, remarks: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button onClick={saveDraft} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {importResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span>Import summary</span>
              <Button variant="ghost" size="sm" onClick={() => setImportResult(null)}>
                <X className="h-4 w-4 mr-1" />Dismiss
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">{importResult.imported} imported</Badge>
              <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">{importResult.skipped.length} skipped (duplicates)</Badge>
              <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">{importResult.failed.length} failed</Badge>
            </div>
            {(importResult.skipped.length > 0 || importResult.failed.length > 0) && (
              <ul className="max-h-48 overflow-auto rounded-md border p-2 text-xs space-y-1">
                {importResult.skipped.map((s) => (
                  <li key={`s${s.row}`} className="text-orange-700">Row {s.row}: skipped — {s.reason}</li>
                ))}
                {importResult.failed.map((f) => (
                  <li key={`f${f.row}`} className="text-destructive">Row {f.row}: failed — {f.reason}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {customerId && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <Tabs value={tab} onValueChange={setTab} className="space-y-3">
            <TabsList>
              <TabsTrigger value="list">
                Installed Units{loading ? "" : ` (${filtered.length}${filtered.length !== rows.length ? ` of ${rows.length}` : ""})`}
              </TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-8 text-sm"
                  placeholder="Search model, serial or invoice no…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {anyFilter && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-1" />Clear filters
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {WARRANTY_CHIPS.map(chipBtn)}
              <span className="w-2" />
              {AMC_CHIPS.map(chipBtn)}
            </div>

            <TabsContent value="list" className="mt-0">
            <div className="max-h-[70vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 w-10">Sr</th>
                    <th className="px-2 py-1.5">Model No</th>
                    <th className="px-2 py-1.5">Serial No</th>
                    <th className="px-2 py-1.5">Inv No</th>
                    <th className="px-2 py-1.5">Inv Date</th>
                    <th className="px-2 py-1.5 text-right">Warranty (M)</th>
                    <th className="px-2 py-1.5">Warranty Status</th>
                    <th className="px-2 py-1.5">AMC Start</th>
                    <th className="px-2 py-1.5">AMC End</th>
                    <th className="px-2 py-1.5">AMC Status</th>
                    <th className="px-2 py-1.5 w-16 text-center">Ticket</th>
                    <th className="px-2 py-1.5 w-14 text-center">View</th>
                    <th className="px-2 py-1.5 w-20 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d, i) => (
                    <tr key={d.row.id} className="border-t hover:bg-muted/40">
                      <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-1 font-medium">{d.row.model_no}</td>
                      <td className="px-2 py-1 font-mono">{d.row.serial_no || "—"}</td>
                      <td className="px-2 py-1">{d.row.invoice_no || "—"}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{fmtDate(d.row.invoice_date) || "—"}</td>
                      <td className="px-2 py-1 text-right">{d.row.warranty_months || 0}</td>
                      <td className="px-2 py-1">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusClass(d.w)}`}>{statusLabel[d.w]}</Badge>
                        {d.wEnd && <span className="ml-1 text-muted-foreground">{fmtDate(d.wEnd)}</span>}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{fmtDate(d.row.amc_start_date) || "—"}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{fmtDate(d.row.amc_end_date) || "—"}</td>
                      <td className="px-2 py-1">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusClass(d.a)}`}>{statusLabel[d.a]}</Badge>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <Button
                          size="icon" variant="ghost" className="h-6 w-6" title="Raise ticket"
                          onClick={() => navigate({ to: "/tickets/new", search: { equipment: d.row.id } as never })}
                        >
                          <LifeBuoy className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <Button
                          size="icon" variant="ghost" className="h-6 w-6" title="View serial footprint"
                          disabled={!d.row.serial_no}
                          onClick={() => navigate({ to: "/ims/serial-track", search: { serial: d.row.serial_no } as never })}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                      <td className="px-2 py-1 text-center whitespace-nowrap">
                        {isAdmin ? (
                          <>
                            <Button size="icon" variant="ghost" className="h-6 w-6" title="Edit" onClick={() => openEdit(d.row)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" title="Delete" onClick={() => setDeleteRow(d.row)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && filtered.length === 0 && (
                    <tr><td colSpan={13} className="px-2 py-8 text-center text-muted-foreground">
                      {rows.length === 0 ? "No installed equipment recorded for this customer yet." : "No rows match the current search / filters."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </TabsContent>

            <TabsContent value="summary" className="mt-0">
              <div className="max-h-[65vh] overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 w-10">Sr</th>
                      <th className="px-2 py-1.5">Model No</th>
                      <th className="px-2 py-1.5 w-28 text-right">
                        <button type="button" className="inline-flex items-center gap-1" onClick={() => setSortDesc((s) => !s)}>
                          Units <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelCounts.map((m, i) => (
                      <tr key={m.model} className="border-t hover:bg-muted/40">
                        <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1 font-medium">{m.model}</td>
                        <td className="px-2 py-1 text-right">{m.count}</td>
                      </tr>
                    ))}
                    {!loading && modelCounts.length === 0 && (
                      <tr><td colSpan={3} className="px-2 py-8 text-center text-muted-foreground">No installed equipment matches the current filters.</td></tr>
                    )}
                  </tbody>
                  {modelCounts.length > 0 && (
                    <tfoot className="sticky bottom-0 bg-muted font-semibold">
                      <tr className="border-t">
                        <td className="px-2 py-1.5" />
                        <td className="px-2 py-1.5">Total</td>
                        <td className="px-2 py-1.5 text-right">{filtered.length}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => { if (!o) setDeleteRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this equipment record?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRow?.model_no}{deleteRow?.serial_no ? ` · ${deleteRow.serial_no}` : ""} will be removed from this customer's register. This cannot be undone.
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