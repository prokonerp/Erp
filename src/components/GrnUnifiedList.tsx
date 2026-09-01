import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useRouteState } from "@/lib/routeState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Search, Plus, Undo2, Factory, Package, FileStack, Pencil, MoreHorizontal, Eye, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import { useGrnsPaginated, fetchAllGrns, type Grn, type GrnCategory } from "@/lib/grn";
import { fetchUserNameMap } from "@/lib/challan";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/useRole";
import { useNavigate } from "@tanstack/react-router";
import { AdminDeleteDialog } from "@/components/AdminDeleteDialog";

const STATUS_COLOR: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Received: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "QC Pending": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  Approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const TYPE_META: Record<GrnCategory, { label: string; color: string; icon: any }> = {
  customer: { label: "GRN FROM CUSTOMER", color: "#059669", icon: Undo2 },
  oem: { label: "GRN FROM OEM", color: "#EA580C", icon: Factory },
  general: { label: "GRN GENERAL", color: "#475569", icon: Package },
};

function TypeBadge({ category }: { category: GrnCategory }) {
  const m = TYPE_META[category];
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white" style={{ backgroundColor: m.color }}>
      <Icon className="h-3 w-3" />{m.label}
    </span>
  );
}

function SummaryCard({ label, count, color, icon: Icon }: { label: string; count: number; color: string; icon: any }) {
  return (
    <Card className="border-l-4" style={{ borderLeftColor: color }}>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground font-medium">{label}</div>
          <div className="text-2xl font-bold mt-1">{count}</div>
        </div>
        <div className="h-10 w-10 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: color }}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

const PAGE_SIZE = 25;

export function GrnUnifiedList() {
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [users, setUsers] = useState<Record<string, string>>({});
  const [q, setQ] = useRouteState("q", "");
  const [typeFilter, setTypeFilter] = useRouteState<"all" | GrnCategory>("typeFilter", "all");
  const [statusFilter, setStatusFilter] = useRouteState<string>("statusFilter", "all");
  const [sourceFilter, setSourceFilter] = useRouteState<string>("sourceFilter", "all");
  const [from, setFrom] = useRouteState<string>("from", "");
  const [to, setTo] = useRouteState<string>("to", "");
  const [page, setPage] = useRouteState<number>("page", 0);

  // Reset to first page when filters change
  useEffect(() => {
    setPage(0);
  }, [q, typeFilter, statusFilter, sourceFilter, from, to]);

  const queryParams = useMemo(() => ({
    page,
    pageSize: PAGE_SIZE,
    category: typeFilter,
    status: statusFilter,
    search: q || null,
    sourceName: sourceFilter,
    fromDate: from || null,
    toDate: to || null,
  }), [page, typeFilter, statusFilter, q, sourceFilter, from, to]);

  const { data, isLoading, isFetching, error } = useGrnsPaginated(queryParams);

  const rows: Grn[] = data?.data ?? [];
  const totalCount: number = data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    if (error) toast.error((error as Error).message);
  }, [error]);

  // Resolve user display names for current page
  useEffect(() => {
    if (rows.length === 0) return;
    const ids = rows.map((d) => d.created_by || "").filter(Boolean);
    if (ids.length === 0) return;
    fetchUserNameMap(ids).then(setUsers).catch(() => {});
  }, [rows]);

  const sources = useMemo(
    () => Array.from(new Set(rows.map((r) => r.source_name).filter(Boolean) as string[])).sort(),
    [rows]
  );

  // For summary cards: when no type filter, approximate breakdown from current page
  // Total is exact server-side filtered count; breakdowns are page-scoped.
  const counts = useMemo(() => ({
    total: totalCount,
    customer: typeFilter === "customer" ? totalCount : rows.filter((r) => r.category === "customer").length,
    oem: typeFilter === "oem" ? totalCount : rows.filter((r) => r.category === "oem").length,
    general: typeFilter === "general" ? totalCount : rows.filter((r) => r.category === "general").length,
  }), [totalCount, rows, typeFilter]);

  const cols = [
    { header: "GRN No", get: (r: Grn) => r.grn_no },
    { header: "Date", get: (r: Grn) => r.grn_date },
    { header: "Type", get: (r: Grn) => TYPE_META[r.category].label },
    { header: "Source", get: (r: Grn) => r.source_name || "" },
    { header: "Reference", get: (r: Grn) => r.reference_no || r.source_doc_no || "" },
    { header: "Status", get: (r: Grn) => r.status },
    { header: "Created By", get: (r: Grn) => users[r.created_by || ""] || "" },
  ];

  // Export-all handler keeps fetchAll for exports only (not for list rendering)
  const [exporting, setExporting] = useState(false);
  const [exportRows, setExportRows] = useState<Grn[] | null>(null);
  const handleExportAll = async () => {
    setExporting(true);
    try {
      const all = await fetchAllGrns();
      // Apply same client-side filters for export parity (export = full filtered set)
      let out = all;
      if (typeFilter !== "all") out = out.filter((r) => r.category === typeFilter);
      if (statusFilter !== "all") out = out.filter((r) => r.status === statusFilter);
      if (sourceFilter !== "all") out = out.filter((r) => r.source_name === sourceFilter);
      if (from) out = out.filter((r) => r.grn_date >= from);
      if (to) out = out.filter((r) => r.grn_date <= to);
      if (q.trim()) {
        const s = q.toLowerCase();
        out = out.filter((r) => r.grn_no.toLowerCase().includes(s) || (r.source_name || "").toLowerCase().includes(s) || (r.reference_no || "").toLowerCase().includes(s) || (r.source_doc_no || "").toLowerCase().includes(s));
      }
      setExportRows(out);
      toast.success(`Prepared ${out.length} rows for export`);
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const displayRows = exportRows ?? rows;
  const exportColsSource = exportRows ? exportRows : rows;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total GRNs" count={counts.total} color="#0F172A" icon={FileStack} />
        <SummaryCard label="GRN FROM CUSTOMER" count={counts.customer} color="#059669" icon={Undo2} />
        <SummaryCard label="GRN FROM OEM" count={counts.oem} color="#EA580C" icon={Factory} />
        <SummaryCard label="GRN GENERAL" count={counts.general} color="#475569" icon={Package} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle>Goods Receipt Notes ({totalCount}) {isFetching && <span className="text-xs font-normal text-muted-foreground">· loading…</span>}</CardTitle>
            <div className="flex items-center gap-2">
              <TypeBadge category="customer" />
              <TypeBadge category="oem" />
              <TypeBadge category="general" />
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {/* Current-page export uses server-paginated rows; Export All uses fetchAll (export-only) */}
            <ExportButtons name="GRNs" title="Goods Receipt Notes" rows={displayRows} columns={cols} />
            <Button variant="outline" size="sm" onClick={handleExportAll} disabled={exporting}>
              {exporting ? "Preparing…" : exportRows ? `Export all (${exportRows.length})` : "Prepare export (all)"}
            </Button>
            <Link to="/grn/new">
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />New GRN</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                className="pl-8 w-64"
                placeholder="Search GRN, source, reference…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="customer">GRN FROM CUSTOMER</SelectItem>
                <SelectItem value="oem">GRN FROM OEM</SelectItem>
                <SelectItem value="general">GRN GENERAL</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["Draft", "Submitted", "Cancelled"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {sources.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>GRN Type</TableHead>
                  <TableHead>Source Name</TableHead>
                  <TableHead>Reference No</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.grn_no}</TableCell>
                    <TableCell>{r.grn_date}</TableCell>
                    <TableCell><TypeBadge category={r.category} /></TableCell>
                    <TableCell>{r.source_name}</TableCell>
                    <TableCell>{r.reference_no || r.source_doc_no || ""}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLOR[r.status] || ""} variant="secondary">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{users[r.created_by || ""] || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Row actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => navigate({ to: "/grn/$id", params: { id: r.id } })}>
                              <Eye className="h-4 w-4 mr-2" />View
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate({ to: "/grn/$id/edit", params: { id: r.id } })}>
                              <Pencil className="h-4 w-4 mr-2" />Edit
                            </DropdownMenuItem>
                            {isAdmin && (
                              <>
                                <DropdownMenuSeparator />
                                <AdminDeleteDialog
                                  kind="grn"
                                  id={r.id}
                                  label={`GRN ${r.grn_no}`}
                                  onDeleted={() => {
                                    // keepPreviousData keeps stale page; invalidation will refetch on next interaction
                                    toast.success("Deleted");
                                  }}
                                  renderTrigger={(open) => (
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onSelect={(e) => { e.preventDefault(); open(); }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />Delete
                                    </DropdownMenuItem>
                                  )}
                                />
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No records</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination — server-side, keepPreviousData keeps prior rows visible while fetching */}
          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-muted-foreground">
              Page {page + 1} of {pageCount} · {totalCount} total {isFetching && "· updating…"}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="h-4 w-4 mr-1" />Prev
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Next<ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
