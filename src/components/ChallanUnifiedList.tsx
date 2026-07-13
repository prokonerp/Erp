import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Search, Plus, User, Factory, FileStack } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import { fetchAllChallans, fetchUserNameMap, type DeliveryChallan, type DocType } from "@/lib/challan";
import { toast } from "sonner";

const STATUS_COLOR: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
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

export function ChallanUnifiedList() {
  const [rows, setRows] = useState<DeliveryChallan[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | DocType>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [partyFilter, setPartyFilter] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    fetchAllChallans()
      .then(async (data) => {
        setRows(data);
        const ids = data.map((d) => d.created_by || "").filter(Boolean);
        setUsers(await fetchUserNameMap(ids));
      })
      .catch((e) => toast.error(e.message));
  }, []);

  const parties = useMemo(
    () => Array.from(new Set(rows.map((r) => r.party_name).filter(Boolean) as string[])).sort(),
    [rows]
  );

  const filtered = rows.filter((r) => {
    if (typeFilter !== "all" && r.doc_type !== typeFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (partyFilter !== "all" && r.party_name !== partyFilter) return false;
    if (from && r.challan_date < from) return false;
    if (to && r.challan_date > to) return false;
    const s = q.toLowerCase();
    if (!s) return true;
    return (
      r.challan_no.toLowerCase().includes(s) ||
      (r.party_name || "").toLowerCase().includes(s) ||
      (r.reference_no || "").toLowerCase().includes(s) ||
      (r.gate_pass_no || "").toLowerCase().includes(s)
    );
  });

  const counts = {
    total: rows.length,
    customer: rows.filter((r) => r.doc_type === "customer").length,
    oem: rows.filter((r) => r.doc_type === "oem").length,
  };

  const cols = [
    { header: "Challan No", get: (r: DeliveryChallan) => r.challan_no },
    { header: "Date", get: (r: DeliveryChallan) => r.challan_date },
    { header: "Type", get: (r: DeliveryChallan) => (r.doc_type === "oem" ? "DC TO OEM" : "DC TO CUSTOMER") },
    { header: "Party", get: (r: DeliveryChallan) => r.party_name || "" },
    { header: "Reference", get: (r: DeliveryChallan) => r.reference_no || "" },
    { header: "Status", get: (r: DeliveryChallan) => r.status },
    { header: "Created By", get: (r: DeliveryChallan) => users[r.created_by || ""] || "" },
  ];

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
            <CardTitle>Delivery Challans ({filtered.length})</CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TypeBadge docType="customer" />
              <TypeBadge docType="oem" />
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <ExportButtons name="DeliveryChallans" title="Delivery Challans" rows={filtered} columns={cols} />
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
                {["Draft", "Submitted", "Dispatched", "Cancelled"].map((s) => (
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
                {filtered.map((r) => (
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
                      <Link to="/challan/$id" params={{ id: r.id }}>
                        <Button size="sm" variant="outline"><Printer className="h-4 w-4 mr-1" />View</Button>
                      </Link>
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