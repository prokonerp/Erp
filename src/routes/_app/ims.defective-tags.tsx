import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Printer, Eye, Download, RefreshCw, Truck } from "lucide-react";
import { getCurrentUserName } from "@/lib/currentUser";
import { printMultiPageElement, saveMultiPageElementAsPdf } from "@/lib/docPdf";
import { DefectiveTagSheet } from "@/components/DefectiveTagSheet";
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

function DefectiveTagsPage() {
  const [tags, setTags] = useState<DefectiveTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("tag_date");
  const [sortAsc, setSortAsc] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [preview, setPreview] = useState<DefectiveTag[] | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      setTags(await listDefectiveTags());
    } catch (e: any) {
      toast.error(e?.message || "Failed to load defective tags");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    const rows = tags.filter((t) => {
      if (status === "printed" && !t.printed_at) return false;
      if (status === "not_printed" && t.printed_at) return false;
      if (!s) return true;
      return [t.tag_no, t.txn_no, t.service_request_no, t.oracle_order_no, t.model_no, t.serial_no, t.customer_name, t.asp_code, t.engineer_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s));
    });
    return rows.sort((a, b) => {
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [tags, q, status, sortKey, sortAsc]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortAsc((v) => !v);
    else { setSortKey(k); setSortAsc(true); }
  }

  async function doPrint() {
    if (!sheetRef.current || !preview) return;
    await printMultiPageElement(sheetRef.current, "defective-tags");
    await markTagsPrinted(preview.map((t) => t.id), await getCurrentUserName());
    load();
  }
  async function doDownload() {
    if (!sheetRef.current || !preview) return;
    try {
      await saveMultiPageElementAsPdf(sheetRef.current, "defective-tags.pdf");
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
            <span>Defective Tag Register</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
              <Button size="sm" variant="outline" disabled={filtered.length === 0} onClick={() => setPreview(filtered)}>
                <Printer className="h-4 w-4 mr-1" />Print All (filtered)
              </Button>
              <Button size="sm" onClick={() => setOpenCreate(true)}><Plus className="h-4 w-4 mr-1" />Create Defective Tag</Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input className="md:col-span-2" placeholder="Tag no / Stock IN / SR / Oracle / Model / Serial / Customer / ASP / Engineer…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tags</SelectItem>
              <SelectItem value="printed">Printed</SelectItem>
              <SelectItem value="not_printed">Not Printed</SelectItem>
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
                <th className="p-2">Stock IN No</th>
                <th className="p-2">SR No</th>
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
                <tr><td className="p-4 text-muted-foreground" colSpan={11}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={11}>No defective tags yet.</td></tr>
              ) : filtered.map((t) => (
                <tr key={t.id} className="border-t align-top">
                  <td className="p-2 font-mono text-xs">{t.tag_no}</td>
                  <td className="p-2 whitespace-nowrap">{fmtDate(t.tag_date)}</td>
                  <td className="p-2 font-mono text-xs">{t.txn_no || "—"}</td>
                  <td className="p-2">{t.service_request_no || "—"}</td>
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
                    <Button size="sm" variant="ghost" onClick={() => setPreview([t])}>
                      <Eye className="h-4 w-4 mr-1" />{t.printed_at ? "Reprint" : "Preview"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <CreateTagsDialog open={openCreate} onOpenChange={setOpenCreate} onGenerated={(created) => { load(); setPreview(created); }} />

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Defective Tag Preview — {preview?.length || 0} tag(s), A4 portrait, 4 per page</DialogTitle>
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

function CreateTagsDialog({
  open, onOpenChange, onGenerated,
}: { open: boolean; onOpenChange: (o: boolean) => void; onGenerated: (tags: DefectiveTag[]) => void }) {
  const [rows, setRows] = useState<DefectiveInRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [showGenerated, setShowGenerated] = useState(false);
  const [showSentToOem, setShowSentToOem] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setSel({});
    setLoading(true);
    listDefectiveInRecords()
      .then(setRows)
      .catch((e) => toast.error(e?.message || "Failed to load defective stock IN records"))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    return rows.filter((r) => {
      if (!showGenerated && r.tag_generated) return false;
      if (!showSentToOem && r.sent_to_oem) return false;
      if (!s) return true;
      return [r.txn_no, r.service_request_no, r.oracle_order_no, r.model_no, r.serial_no, r.customer_name, r.asp_code, r.engineer_name, r.reason]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [rows, q, showGenerated, showSentToOem]);

  const selectable = filtered.filter((r) => !r.sent_to_oem);
  const selectedRows = selectable.filter((r) => sel[r.key]);
  const selectedForTags = selectedRows.filter((r) => !r.tag_generated);
  const selectedForDc = selectedRows;


  function generateDcToOem() {
    if (!selectedForDc.length) return;
    const prefill = {
      source: "defective_tags",
      reference_no: "",
      internal_remarks: "Defective stock return to OEM",
      items: selectedForDc.map((r) => ({
        part_no: r.model_no || "",
        part_name: r.part_name || r.model_no || "",
        description: "",
        uom: "Nos",
        qty: "1",
        model_no: r.model_no || "",
        serial_no: r.serial_no || "",
        oracle_no: r.oracle_order_no || "",
        stock_type: "Defective",
        oem_ref_id: r.txn_no || r.service_request_no || "",
      })),
    };
    try { sessionStorage.setItem("challan:prefill:new-oem", JSON.stringify(prefill)); } catch { /* noop */ }
    onOpenChange(false);
    navigate({ to: "/challan/oem/new" });
  }

  async function generate() {
    if (!selectedForTags.length) return;
    setSaving(true);
    try {
      const created = await generateTags(selectedForTags, await getCurrentUserName());
      toast.success(`${created.length} defective tag(s) generated`);
      onOpenChange(false);
      onGenerated(created);
    } catch (e: any) {
      toast.error(e?.message?.includes("duplicate") ? "A tag already exists for one of the selected records" : e?.message || "Tag generation failed");
    } finally {
      setSaving(false);
    }
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Defective Stock IN records</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <Input className="flex-1 min-w-[240px]" placeholder="Search stock IN / SR / Oracle / model / serial / customer…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showGenerated} onCheckedChange={(v) => setShowGenerated(!!v)} />
            Show already generated
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showSentToOem} onCheckedChange={(v) => setShowSentToOem(!!v)} />
            Show already sent to OEM
          </label>
          <div className="text-sm text-muted-foreground">{selectedRows.length} selected</div>
        </div>
        <div className="flex-1 overflow-auto border rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr className="text-left">
                <th className="p-2 w-8">
                  <Checkbox
                    checked={selectable.length > 0 && selectedRows.length === selectable.length}
                    onCheckedChange={(v) =>
                      setSel(v ? Object.fromEntries(selectable.map((r) => [r.key, true])) : {})
                    }
                  />
                </th>
                <th className="p-2">Stock IN No</th>
                <th className="p-2">Date</th>
                <th className="p-2">SR No</th>
                <th className="p-2">Oracle Order</th>
                <th className="p-2">Model</th>
                <th className="p-2">Defective Serial</th>
                <th className="p-2">Customer</th>
                <th className="p-2">ASP</th>
                <th className="p-2">Engineer</th>
                <th className="p-2">Repl. Date</th>
                <th className="p-2">Reason</th>
                <th className="p-2">Tag</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={13}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={13}>No pending Defective Stock IN records.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.key} className="border-t align-top">
                  <td className="p-2">
                    <Checkbox
                      disabled={r.sent_to_oem}
                      checked={!!sel[r.key]}
                      onCheckedChange={(v) => setSel((s) => ({ ...s, [r.key]: !!v }))}
                    />
                  </td>

                  <td className="p-2 font-mono">{r.txn_no || "—"}</td>
                  <td className="p-2 whitespace-nowrap">{fmtDate(r.txn_date)}</td>
                  <td className="p-2">{r.service_request_no || "—"}</td>
                  <td className="p-2">{r.oracle_order_no || "—"}</td>
                  <td className="p-2">{r.model_no || r.part_name || "—"}</td>
                  <td className="p-2 font-mono">{r.serial_no || "—"}</td>
                  <td className="p-2">{r.customer_name || "—"}</td>
                  <td className="p-2">{r.asp_code || "—"}</td>
                  <td className="p-2">{r.engineer_name || "—"}</td>
                  <td className="p-2 whitespace-nowrap">{fmtDate(r.replacement_date)}</td>
                  <td className="p-2 max-w-[180px] break-words">{r.reason || "—"}</td>
                  <td className="p-2">
                    {r.sent_to_oem
                      ? <Badge variant="outline">Sent to OEM</Badge>
                      : r.tag_generated
                        ? <Badge variant="secondary">Tagged — ready for DC</Badge>
                        : <Badge variant="outline">Not Generated</Badge>}
                  </td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" disabled={!selectedForDc.length} onClick={generateDcToOem}>
            <Truck className="h-4 w-4 mr-1" />Generate DC to OEM
          </Button>
          <Button disabled={!selectedForTags.length || saving} onClick={generate}>
            Generate {selectedForTags.length || ""} Tag{selectedForTags.length === 1 ? "" : "s"}
          </Button>

        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}