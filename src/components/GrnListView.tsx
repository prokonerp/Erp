import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Search, Plus, Pencil } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import type { Grn, GrnCategory } from "@/lib/grn";
import { CATEGORY_LABEL, fetchGrns } from "@/lib/grn";
import { toast } from "sonner";
import { useIsAdmin } from "@/lib/useRole";
import { Link as RouterLink } from "@tanstack/react-router";
import { AdminDeleteDialog } from "@/components/AdminDeleteDialog";

type Props = {
  category: GrnCategory;
  newTo: "/grn/customer/new" | "/grn/oem/new" | "/grn/general/new";
};

const STATUS_COLOR: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Received: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "QC Pending": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  Approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export function GrnListView({ category, newTo }: Props) {
  const [rows, setRows] = useState<Grn[]>([]);
  const [q, setQ] = useState("");
  const { isAdmin } = useIsAdmin();

  useEffect(() => {
    fetchGrns(category).then(setRows).catch((e) => toast.error(e.message));
  }, [category]);

  const filtered = rows.filter((r) => {
    const s = q.toLowerCase();
    if (!s) return true;
    return r.grn_no.toLowerCase().includes(s)
      || (r.source_name || "").toLowerCase().includes(s)
      || (r.reference_no || "").toLowerCase().includes(s)
      || (r.source_doc_no || "").toLowerCase().includes(s)
      || (r.invoice_no || "").toLowerCase().includes(s);
  });

  const cols = [
    { header: "GRN No", get: (r: Grn) => r.grn_no },
    { header: "Date", get: (r: Grn) => r.grn_date },
    { header: "Source", get: (r: Grn) => r.source_name || "" },
    { header: "Reference", get: (r: Grn) => r.reference_no || r.source_doc_no || "" },
    { header: "Items", get: (r: Grn) => (r.items || []).length },
    { header: "Status", get: (r: Grn) => r.status },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>GRN — {CATEGORY_LABEL[category]} ({filtered.length})</CardTitle>
          <div className="flex gap-2 items-center">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-8 w-64" placeholder="Search GRN, source, reference…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <ExportButtons name={`GRN_${category}`} title={`GRN ${CATEGORY_LABEL[category]}`} rows={filtered} columns={cols} />
            <Link to={newTo}>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />New GRN</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.grn_no}</TableCell>
                    <TableCell>{r.grn_date}</TableCell>
                    <TableCell>{r.source_name}</TableCell>
                    <TableCell>{r.reference_no || r.source_doc_no}</TableCell>
                    <TableCell>{(r.items || []).length}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLOR[r.status] || ""} variant="secondary">{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5 justify-end">
                        <Link to="/grn/$id" params={{ id: r.id }}>
                          <Button size="sm" variant="outline"><Printer className="h-4 w-4 mr-1" />View</Button>
                        </Link>
                        {isAdmin && (
                          <>
                            <RouterLink to="/grn/$id/edit" params={{ id: r.id }}>
                              <Button size="sm" variant="outline"><Pencil className="h-4 w-4" /></Button>
                            </RouterLink>
                            <AdminDeleteDialog
                              kind="grn"
                              id={r.id}
                              label={`GRN ${r.grn_no}`}
                              onDeleted={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                            />
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No records</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}