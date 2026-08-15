import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Printer, Eye, Download, RefreshCw, Truck } from "lucide-react";
import { getCurrentUserName } from "@/lib/currentUser";
import { printMultiPageElement, saveMultiPageElementAsPdf } from "@/lib/docPdf";
import { DefectiveTagSheet } from "@/components/DefectiveTagSheet";
import { listWarehouses, type WarehouseLite } from "@/lib/ims";
import {
  fmtDate,
  generateTags,
  listDefectiveInRecords,
  listDefectiveTags,
  markTagsPrinted,
  type DefectiveInRecord,
  type DefectiveTag,
} from "@/lib/defectiveTags";

export const Route = createFileRoute("/_app/ims/defective-tags")({
  head: () => ({
    meta: [
      { title: "Defective Tags — Prokon Inventory" },
      { name: "description", content: "Generate, view and print defective tags from Defective Stock IN records." },
      { property: "og:title", content: "Defective Tags — Prokon Inventory" },
      { property: "og:description", content: "Generate and print defective tags for defective stock received." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DefectiveTagsPage,
});

type SortKey = "tag_no" | "tag_date" | "customer_name" | "model_no";

const NO_ASP = "__no_asp__";

function DefectiveTagsPage() {
  const [tags, setTags] = useState<DefectiveTag[]>([]);
  const [records, setRecords] = useState<DefectiveInRecord[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("");
  const [preview, setPreview] = useState<DefectiveTag[] | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [t, r, w] = await Promise.all([listDefectiveTags(), listDefectiveInRecords(), listWarehouses()]);
      setTags(t);
      setRecords(r);
      setWarehouses(w);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load defective tags");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const pending = useMemo(() => records.filter((r) => !r.sent_to_oem), [records]);

  const aspTabs = useMemo(() => {
    const keys = Array.from(new Set(pending.map((r) => r.asp_code || NO_ASP)));
    keys.sort((a, b) => (a === NO_ASP ? 1 : b === NO_ASP ? -1 : a.localeCompare(b)));
    return keys;
  }, [pending]);

  useEffect(() => {
    if (!tab || (tab !== "register" && !aspTabs.includes(tab))) setTab(aspTabs[0] || "register");
  }, [aspTabs, tab]);

  const whByAsp = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of warehouses) if (w.asp_code && !m.has(w.asp_code)) m.set(w.asp_code, w.name);
    return m;
  }, [warehouses]);

  async function doPrint() {
    if (!sheetRef.current || !preview) return;
    await printMultiPageElement(sheetRef.current, "defective-tags", { landscape: true });
    await markTagsPrinted(preview.map((t) => t.id), await getCurrentUserName());
    load();
  }
  async function doDownload() {
    if (!sheetRef.current || !preview) return;
    try {
      await saveMultiPageElementAsPdf(sheetRef.current, "defective-tags.pdf", { landscape: true });
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    }
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab || "register"} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          {aspTabs.map((a) => (
            <TabsTrigger key={a} value={a}>
              {a === NO_ASP ? "No ASP" : a}
              <span className="ml-1.5 text-xs text-muted-foreground">
                ({pending.filter((r) => (r.asp_code || NO_ASP) === a).length})
              </span>
            </TabsTrigger>
          ))}
          <TabsTrigger value="register">Tag Register</TabsTrigger>
        </TabsList>

        {aspTabs.map((a) => (
          <TabsContent key={a} value={a} className="mt-4">
            <AspTab
              aspKey={a}
              warehouseName={a === NO_ASP ? "Unassigned warehouse" : whByAsp.get(a) || "—"}
              rows={records.filter((r) => (r.asp_code || NO_ASP) === a)}
              loading={loading}
              allTags={tags}
              onGenerated={(created) => { load(); setPreview(created); }}
            />
          </TabsContent>
        ))}

        <TabsContent value="register" className="mt-4">
          <RegisterTab tags={tags} loading={loading} onRefresh={load} onPreview={setPreview} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Defective Tag Preview — {preview?.length || 0} tag(s), A4 landscape, 4 per page</DialogTitle>
          </DialogHeader>
          <div className="bg-muted/40 p-4 overflow-x-auto">
            {preview && <DefectiveTagSheet ref={sheetRef} tags={preview} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={doDownload}><Download className="h-4 w-4 mr-1" />Download PDF</Button>
            <Button onClick={doPrint}><Printer className="h-4 w-4 mr-1" />Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AspTab({
  aspKey, warehouseName, rows, loading, allTags, onGenerated,
}: {
  aspKey: string;
  warehouseName: string;
  rows: DefectiveInRecord[];
  loading: boolean;
  allTags: DefectiveTag[];
  onGenerated: (tags: DefectiveTag[]) => void;
}) {
  const [q, setQ] = useState("");
  const [showGenerated, setShowGenerated] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    return rows.filter((r) => {
      if (r.sent_to_oem) return false;
      if (!showGenerated && r.tag_generated) return false;
      if (!s) return true;
      return [r.oem_ref_id, r.oracle_order_no, r.model_no, r.serial_no, r.customer_name, r.engineer_name, r.reason]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [rows, q, showGenerated]);

  const selectedRows = filtered.filter((r) => sel[r.key]);
  const selectedForTags = selectedRows.filter((r) => !r.tag_generated);
  const pendingCount = rows.filter((r) => !r.sent_to_oem).length;

  function generateDcToOem() {
    if (!selectedRows.length) return;
    const prefill = {
      source: "defective_tags",
      reference_no: "",
      internal_remarks: "Defective stock return to OEM",
      items: selectedRows.map((r) => ({
        part_no: r.model_no || "",
        part_name: r.part_name || r.model_no || "",
        description: "",
        uom: "Nos",
        qty: "1",
        model_no: r.model_no || "",
        serial_no: r.serial_no || "",
        oracle_no: r.oracle_order_no || "",
        stock_type: "Defective",
        oem_ref_id: r.oem_ref_id || "",
      })),
    };
    try { sessionStorage.setItem("challan:prefill:new-oem", JSON.stringify(prefill)); } catch { /* noop */ }
    navigate({ to: "/challan/oem/new" });
  }

  async function generate() {
    if (!selectedRows.length) return;
    setSaving(true);
    try {
      const created = selectedForTags.length
        ? await generateTags(selectedForTags, await getCurrentUserName())
        : [];
      if (created.length) toast.success(`${created.length} defective tag(s) generated`);
      const norm = (v: any) => String(v ?? "").trim().toLowerCase();
      const existing = allTags.filter((t) =>
        selectedRows.some(
          (r) => r.tag_generated && norm(t.model_no) === norm(r.model_no) && norm(t.serial_no) === norm(r.serial_no),
        ),
      );
      setSel({});
      onGenerated([...created, ...existing]);
    } catch (e: any) {
      toast.error(e?.message?.includes("duplicate") ? "A tag already exists for one of the selected records" : e?.message || "Tag generation failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {aspKey === NO_ASP ? "No ASP" : aspKey} · {warehouseName}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {pendingCount} defective item{pendingCount === 1 ? "" : "s"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Input
            className="flex-1 min-w-[240px]"
            placeholder="Search OEM case / Oracle / model / serial / customer / engineer…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showGenerated} onCheckedChange={(v) => setShowGenerated(!!v)} />
            Show already generated
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr className="text-left">
                <th className="p-2 w-8">
                  <Checkbox
                    checked={filtered.length > 0 && selectedRows.length === filtered.length}
                    onCheckedChange={(v) => setSel(v ? Object.fromEntries(filtered.map((r) => [r.key, true])) : {})}
                  />
                </th>
                <th className="p-2">Date</th>
                <th className="p-2">OEM Case ID</th>
                <th className="p-2">Oracle Order</th>
                <th className="p-2">Model</th>
                <th className="p-2">Defective Serial</th>
                <th className="p-2">Customer</th>
                <th className="p-2">Engineer</th>
                <th className="p-2">Repl. Date</th>
                <th className="p-2">Reason</th>
                <th className="p-2">Tag</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={11}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={11}>No pending defective items for this ASP.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.key} className="border-t align-top">
                  <td className="p-2">
                    <Checkbox
                      checked={!!sel[r.key]}
                      onCheckedChange={(v) => setSel((s) => ({ ...s, [r.key]: !!v }))}
                    />
                  </td>
                  <td className="p-2 whitespace-nowrap">{fmtDate(r.txn_date)}</td>
                  <td className="p-2">{r.oem_ref_id || "—"}</td>
                  <td className="p-2">{r.oracle_order_no || "—"}</td>
                  <td className="p-2">{r.model_no || r.part_name || "—"}</td>
                  <td className="p-2 font-mono">{r.serial_no || "—"}</td>
                  <td className="p-2">{r.customer_name || "—"}</td>
                  <td className="p-2">{r.engineer_name || "—"}</td>
                  <td className="p-2 whitespace-nowrap">{fmtDate(r.replacement_date)}</td>
                  <td className="p-2 max-w-[180px] break-words">{r.reason || "—"}</td>
                  <td className="p-2">
                    {r.tag_generated
                      ? <Badge variant="secondary">Tagged — ready for DC</Badge>
                      : <Badge variant="outline">Not Generated</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">{selectedRows.length} selected</div>
          <div className="flex gap-2">
            <Button disabled={!selectedRows.length || saving} onClick={generate}>
              <Printer className="h-4 w-4 mr-1" />
              Print Tag{selectedRows.length === 1 ? "" : "s"}{selectedRows.length ? ` (${selectedRows.length})` : ""}
            </Button>
            <Button variant="secondary" disabled={!selectedRows.length} onClick={generateDcToOem}>
              <Truck className="h-4 w-4 mr-1" />Generate DC to OEM
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RegisterTab({
  tags, loading, onRefresh, onPreview,
}: {
  tags: DefectiveTag[];
  loading: boolean;
  onRefresh: () => void;
  onPreview: (t: DefectiveTag[]) => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [aspFilter, setAspFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("tag_date");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    const rows = tags.filter((t) => {
      if (status === "printed" && !t.printed_at) return false;
      if (status === "not_printed" && t.printed_at) return false;
      if (aspFilter !== "all" && (t.asp_code || "") !== aspFilter) return false;
      if (!s) return true;
      return [t.tag_no, t.oem_case_id, t.oracle_order_no, t.model_no, t.serial_no, t.customer_name, t.asp_code, t.engineer_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s));
    });
    return rows.sort((a, b) => {
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [tags, q, status, aspFilter, sortKey, sortAsc]);

  const aspOptions = useMemo(
    () => Array.from(new Set(tags.map((t) => t.asp_code).filter(Boolean) as string[])).sort(),
    [tags],
  );

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
            <span>Defective Tag Register</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onRefresh}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
              <Button size="sm" variant="outline" disabled={filtered.length === 0} onClick={() => onPreview(filtered)}>
                <Printer className="h-4 w-4 mr-1" />Print All (filtered)
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <Input className="md:col-span-2" placeholder="Tag no / OEM case / Oracle / Model / Serial / Customer / ASP / Engineer…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tags</SelectItem>
              <SelectItem value="printed">Printed</SelectItem>
              <SelectItem value="not_printed">Not Printed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={aspFilter} onValueChange={setAspFilter}>
            <SelectTrigger><SelectValue placeholder="All ASPs" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ASPs</SelectItem>
              {aspOptions.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground self-center">{filtered.length} of {tags.length}</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2 cursor-pointer" onClick={() => toggleSort("tag_no")}>Tag No</th>
                <th className="p-2 cursor-pointer" onClick={() => toggleSort("tag_date")}>Generated</th>
                <th className="p-2">OEM Case ID</th>
                <th className="p-2">Oracle Order</th>
                <th className="p-2 cursor-pointer" onClick={() => toggleSort("model_no")}>Model · Serial</th>
                <th className="p-2 cursor-pointer" onClick={() => toggleSort("customer_name")}>Customer</th>
                <th className="p-2">ASP</th>
                <th className="p-2">Engineer</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={10}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={10}>No defective tags yet.</td></tr>
              ) : filtered.map((t) => (
                <tr key={t.id} className="border-t align-top">
                  <td className="p-2 font-mono text-xs">{t.tag_no}</td>
                  <td className="p-2 whitespace-nowrap">{fmtDate(t.tag_date)}</td>
                  <td className="p-2">{t.oem_case_id || "—"}</td>
                  <td className="p-2">{t.oracle_order_no || "—"}</td>
                  <td className="p-2">
                    <div>{t.model_no || "—"}</div>
                    <div className="text-xs text-muted-foreground font-mono">{t.serial_no || "—"}</div>
                  </td>
                  <td className="p-2">{t.customer_name || "—"}</td>
                  <td className="p-2">{t.asp_code || "—"}</td>
                  <td className="p-2">{t.engineer_name || "—"}</td>
                  <td className="p-2">
                    {t.printed_at
                      ? <Badge variant="secondary">Printed ×{t.print_count}</Badge>
                      : <Badge>Generated</Badge>}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => onPreview([t])}>
                      <Eye className="h-4 w-4 mr-1" />{t.printed_at ? "Reprint" : "Preview"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
