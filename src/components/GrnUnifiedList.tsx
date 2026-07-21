import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Search, Plus, Undo2, Factory, Package, FileStack } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import { fetchAllGrns, type Grn, type GrnCategory } from "@/lib/grn";
import { fetchUserNameMap } from "@/lib/challan";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/useRole";
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

export function GrnUnifiedList() {
  const [rows, setRows] = useState<Grn[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const { isAdmin } = useIsAdmin();
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | GrnCategory>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    fetchAllGrns()
      .then(async (data) => {
        setRows(data);
        const ids = data.map((d) => d.created_by || "").filter(Boolean);
        setUsers(await fetchUserNameMap(ids));
      })
      .catch((e) => toast.error(e.message));
  }, []);

  const sources = useMemo(
    () => Array.from(new Set(rows.map((r) => r.source_name).filter(Boolean) as string[])).sort(),
    [rows]
  );

  const filtered = rows.filter((r) => {
    if (typeFilter !== "all" && r.category !== typeFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (sourceFilter !== "all" && r.source_name !== sourceFilter) return false;
    if (from && r.grn_date < from) return false;
    if (to && r.grn_date > to) return false;
    const s = q.toLowerCase();
    if (!s) return true;
    return (
      r.grn_no.toLowerCase().includes(s) ||
      (r.source_name || "").toLowerCase().includes(s) ||
      (r.reference_no || "").toLowerCase().includes(s) ||
      (r.source_doc_no || "").toLowerCase().includes(s)
    );
  });

  const counts = {
    total: rows.length,
    customer: rows.filter((r) => r.category === "customer").length,
    oem: rows.filter((r) => r.category === "oem").length,
    general: rows.filter((r) => r.category === "general").length,
  };

  const cols = [
    { header: "GRN No", get: (r: Grn) => r.grn_no },
    { header: "Date", get: (r: Grn) => r.grn_date },
    { header: "Type", get: (r: Grn) => TYPE_META[r.category].label },
    { header: "Source", get: (r: Grn) => r.source_name || "" },
    { header: "Reference", get: (r: Grn) => r.reference_no || r.source_doc_no || "" },
    { header: "Status", get: (r: Grn) => r.status },
    { header: "Created By", get: (r: Grn) => users[r.created_by || ""] || "" },
  ];

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
            <CardTitle>Goods Receipt Notes ({filtered.length})</CardTitle>
            <div className="flex items-center gap-2">
              <TypeBadge category="customer" />
              <TypeBadge category="oem" />
              <TypeBadge category="general" />
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <ExportButtons name="GRNs" title="Goods Receipt Notes" rows={filtered} columns={cols} />
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
                {filtered.map((r) => (
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
                      <div className="flex gap-1.5 justify-end">
                        <Link to="/grn/$id" params={{ id: r.id }}>
                          <Button size="sm" variant="outline"><Printer className="h-4 w-4 mr-1" />View</Button>
                        </Link>
                        {isAdmin && (
                          <AdminDeleteDialog
                            kind="grn"
                            id={r.id}
                            label={`GRN ${r.grn_no}`}
                            onDeleted={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No records</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}