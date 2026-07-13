import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Search, Plus, Pencil, Trash2 } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import type { DeliveryChallan, DocType } from "@/lib/challan";
import { fetchChallans } from "@/lib/challan";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/lib/useRole";
import { Link as RouterLink } from "@tanstack/react-router";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Props = { docType: DocType; newTo: "/challan/new" };

const STATUS_COLOR: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Submitted: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  Dispatched: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  Cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export function ChallanListView({ docType, newTo }: Props) {
  const [rows, setRows] = useState<DeliveryChallan[]>([]);
  const [q, setQ] = useState("");
  const isOem = docType === "oem";
  const { isAdmin } = useIsAdmin();

  useEffect(() => {
    fetchChallans(docType).then(setRows).catch((e) => toast.error(e.message));
  }, [docType]);

  const handleDelete = async (id: string, no: string) => {
    const { error } = await supabase.from("delivery_challans" as never).delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Deleted ${no}`);
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  const filtered = rows.filter((r) => {
    const s = q.toLowerCase();
    if (!s) return true;
    return r.challan_no.toLowerCase().includes(s)
      || (r.party_name || "").toLowerCase().includes(s)
      || (r.vehicle_number || "").toLowerCase().includes(s)
      || (r.gate_pass_no || "").toLowerCase().includes(s);
  });

  const cols = [
    { header: "Challan No", get: (r: DeliveryChallan) => r.challan_no },
    { header: "Date", get: (r: DeliveryChallan) => r.challan_date },
    { header: isOem ? "OEM" : "Customer", get: (r: DeliveryChallan) => r.party_name || "" },
    { header: "Vehicle", get: (r: DeliveryChallan) => r.vehicle_number || "" },
    { header: "Gate Pass", get: (r: DeliveryChallan) => r.gate_pass_no || "" },
    { header: "Items", get: (r: DeliveryChallan) => (r.items || []).length },
    { header: "Status", get: (r: DeliveryChallan) => r.status },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>Delivery Challan — {isOem ? "To OEM" : "To Customer"} ({filtered.length})</CardTitle>
          <div className="flex gap-2 items-center">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-8 w-64" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <ExportButtons name={`DC_${isOem ? "OEM" : "Customer"}`} title={`Delivery Challan ${isOem ? "OEM" : "Customer"}`} rows={filtered} columns={cols} />
            <Link to={newTo}>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />New Challan</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Challan No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>{isOem ? "OEM" : "Customer"}</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Gate Pass</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.challan_no}</TableCell>
                    <TableCell>{r.challan_date}</TableCell>
                    <TableCell>{r.party_name}</TableCell>
                    <TableCell>{r.vehicle_number}</TableCell>
                    <TableCell>{r.gate_pass_no}</TableCell>
                    <TableCell>{(r.items || []).length}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLOR[r.status] || ""} variant="secondary">{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5 justify-end">
                        <Link to="/challan/$id" params={{ id: r.id }}>
                          <Button size="sm" variant="outline"><Printer className="h-4 w-4 mr-1" />View</Button>
                        </Link>
                        {isAdmin && (
                          <>
                            <RouterLink to="/challan/$id/edit" params={{ id: r.id }}>
                              <Button size="sm" variant="outline"><Pencil className="h-4 w-4" /></Button>
                            </RouterLink>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete {r.challan_no}?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This permanently deletes the Delivery Challan. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(r.id, r.challan_no)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No records</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}