import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Search, Plus, User, Factory, FileStack, Pencil, MoreHorizontal, Eye, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import { useChallansPaginated, fetchAllChallans, fetchUserNameMap, type DeliveryChallan, type DocType } from "@/lib/challan";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/useRole";
import { useNavigate } from "@tanstack/react-router";
import { AdminDeleteDialog } from "@/components/AdminDeleteDialog";

const STATUS_COLOR: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "Challan Generated": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  Dispatched: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function TypeBadge({ docType }: { docType: DocType }) {
  if (docType === "oem") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white" style={{ backgroundColor: "#7C3AED" }}>
        <Factory className="h-3 w-3" />DC TO OEM
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-white" style={{ backgroundColor: "#2563EB" }}>
      <User className="h-3 w-3" />DC TO CUSTOMER
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

export function ChallanUnifiedList() {
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [users, setUsers] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | DocType>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [partyFilter, setPartyFilter] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [q, typeFilter, statusFilter, partyFilter, from, to]);

  const queryParams = useMemo(() => ({
    page,
    pageSize: PAGE_SIZE,
    docType: typeFilter,
    status: statusFilter,
    search: q || null,
    partyName: partyFilter,
    fromDate: from || null,
    toDate: to || null,
  }), [page, typeFilter, statusFilter, q, partyFilter, from, to]);

  const { data, isLoading, isFetching, error } = useChallansPaginated(queryParams);

  const rows: DeliveryChallan[] = data?.data ?? [];
  const totalCount: number = data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  useEffect(() => {
    if (error) toast.error((error as Error).message);
  }, [error]);

  useEffect(() => {
    if (rows.length === 0) return;
    const ids = rows.map((d) => d.created_by || "").filter(Boolean);
    if (ids.length === 0) return;
    fetchUserNameMap(ids).then(setUsers).catch(() => {});
  }, [rows]);

  const parties = useMemo(
    () => Array.from(new Set(rows.map((r) => r.party_name).filter(Boolean) as string[])).sort(),
    [rows]
  );

  const counts = useMemo(() => ({
    total: totalCount,
    customer: typeFilter === "customer" ? totalCount : rows.filter((r) => r.doc_type === "customer").length,
    oem: typeFilter === "oem" ? totalCount : rows.filter((r) => r.doc_type === "oem").length,
  }), [totalCount, rows, typeFilter]);

  const cols = [
    { header: "Challan No", get: (r: DeliveryChallan) => r.challan_no },
    { header: "Date", get: (r: DeliveryChallan) => r.challan_date },
    { header: "Type", get: (r: DeliveryChallan) => (r.doc_type === "oem" ? "DC TO OEM" : "DC TO CUSTOMER") },
    { header: "Party", get: (r: DeliveryChallan) => r.party_name || "" },
    { header: "Reference", get: (r: DeliveryChallan) => r.reference_no || "" },
    { header: "Status", get: (r: DeliveryChallan) => r.status },
    { header: "Created By", get: (r: DeliveryChallan) => users[r.created_by || ""] || "" },
  ];

  const [exporting, setExporting] = useState(false);
  const [exportRows, setExportRows] = useState<DeliveryChallan[] | null>(null);
  const handleExportAll = async () => {
    setExporting(true);
    try {
      const all = await fetchAllChallans();
      let out = all;
      if (typeFilter !== "all") out = out.filter((r) => r.doc_type === typeFilter);
      if (statusFilter !== "all") out = out.filter((r) => r.status === statusFilter);
      if (partyFilter !== "all") out = out.filter((r) => r.party_name === partyFilter);
      if (from) out = out.filter((r) => r.challan_date >= from);
      if (to) out = out.filter((r) => r.challan_date <= to);
      if (q.trim()) {
        const s = q.toLowerCase();
        out = out.filter((r) => r.challan_no.toLowerCase().includes(s) || (r.party_name || "").toLowerCase().includes(s) || (r.reference_no || "").toLowerCase().includes(s) || (r.gate_pass_no || "").toLowerCase().includes(s));
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="Total Delivery Challans" count={counts.total} color="#0F172A" icon={FileStack} />
        <SummaryCard label="DC TO CUSTOMER" count={counts.customer} color="#2563EB" icon={User} />
        <SummaryCard label="DC TO OEM" count={counts.oem} color="#7C3AED" icon={Factory} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle>Delivery Challans ({totalCount}) {isFetching && <span className="text-xs font-normal text-muted-foreground">· loading…</span>}</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TypeBadge docType="customer" />
              <TypeBadge docType="oem" />
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <ExportButtons name="DeliveryChallans" title="Delivery Challans" rows={displayRows} columns={cols} />
            <Button variant="outline" size="sm" onClick={handleExportAll} disabled={exporting}>
              {exporting ? "Preparing…" : exportRows ? `Export all (${exportRows.length})` : "Prepare export (all)"}
            </Button>
            <Link to="/challan/new">
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />New Delivery Challan
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input
                className="pl-8 w-64"
                placeholder="Search no, party, reference…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="customer">DC TO CUSTOMER</SelectItem>
                <SelectItem value="oem">DC TO OEM</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["Challan Generated", "Cancelled"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={partyFilter} onValueChange={setPartyFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Customer/OEM" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Parties</SelectItem>
                {parties.map((p) => (
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
                  <TableHead>Challan No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Document Type</TableHead>
                  <TableHead>Customer/OEM</TableHead>
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
                    <TableCell className="font-mono">{r.challan_no}</TableCell>
                    <TableCell>{r.challan_date}</TableCell>
                    <TableCell><TypeBadge docType={r.doc_type} /></TableCell>
                    <TableCell>{r.party_name}</TableCell>
                    <TableCell>{r.reference_no || r.gate_pass_no || ""}</TableCell>
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
                            <DropdownMenuItem onClick={() => navigate({ to: "/challan/$id", params: { id: r.id } })}>
                              <Eye className="h-4 w-4 mr-2" />View
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate({ to: "/challan/$id/edit", params: { id: r.id } })}>
                              <Pencil className="h-4 w-4 mr-2" />Edit
                            </DropdownMenuItem>
                            {isAdmin && (
                              <>
                                <DropdownMenuSeparator />
                                <AdminDeleteDialog
                                  kind="challan"
                                  id={r.id}
                                  label={`Delivery Challan ${r.challan_no}`}
                                  onDeleted={() => toast.success("Deleted")}
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
