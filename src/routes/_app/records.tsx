import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Printer, Search } from "lucide-react";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_app/records")({
  component: RecordsPage,
  head: () => ({ meta: [{ title: "Records — Prokon Gatepass" }] }),
});

type Item = { product: string; serial_no?: string; quantity?: string; unit?: string; remarks?: string };
type Gatepass = {
  id: string; challan_no: string; gatepass_date: string; gatepass_time: string;
  person_name: string; person_company: string | null; vehicle_no: string | null;
  destination: string | null; purpose: string | null; return_type: string;
  items: Item[]; remarks: string | null; prepared_by: string | null; authorised_by: string | null;
  contact_no: string | null; created_at: string;
};

function RecordsPage() {
  const [rows, setRows] = useState<Gatepass[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase.from("gatepasses").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setRows((data || []) as unknown as Gatepass[]));
  }, []);

  const filtered = rows.filter((r) => {
    const s = q.toLowerCase();
    if (!s) return true;
    return r.challan_no.toLowerCase().includes(s)
      || r.person_name.toLowerCase().includes(s)
      || (r.destination || "").toLowerCase().includes(s)
      || JSON.stringify(r.items).toLowerCase().includes(s);
  });

  const exportExcel = () => {
    const flat = filtered.flatMap((g) =>
      (g.items || []).map((it, idx) => ({
        "Challan No": g.challan_no,
        Date: g.gatepass_date,
        Time: g.gatepass_time,
        "Person Name": g.person_name,
        Company: g.person_company || "",
        "Contact No": g.contact_no || "",
        "Vehicle No": g.vehicle_no || "",
        Destination: g.destination || "",
        Purpose: g.purpose || "",
        Type: g.return_type,
        "Item #": idx + 1,
        Product: it.product,
        "Serial No": it.serial_no || "",
        Qty: it.quantity || "",
        Unit: it.unit || "",
        "Item Remarks": it.remarks || "",
        "Prepared By": g.prepared_by || "",
        "Authorised By": g.authorised_by || "",
        Remarks: g.remarks || "",
        Created: new Date(g.created_at).toLocaleString(),
      }))
    );
    const ws = XLSX.utils.json_to_sheet(flat);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gatepasses");
    XLSX.writeFile(wb, `Prokon_Gatepasses_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>Gatepass Records ({filtered.length})</CardTitle>
          <div className="flex gap-2 items-center">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-8 w-64" placeholder="Search challan / person / item" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Button variant="outline" onClick={exportExcel}><Download className="h-4 w-4 mr-1" />Export Excel</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Challan No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.challan_no}</TableCell>
                    <TableCell>{r.gatepass_date}</TableCell>
                    <TableCell>{r.person_name}</TableCell>
                    <TableCell>{r.destination}</TableCell>
                    <TableCell>{(r.items || []).length}</TableCell>
                    <TableCell>{r.return_type}</TableCell>
                    <TableCell>
                      <Link to="/app/gatepass/$id" params={{ id: r.id }}>
                        <Button size="sm" variant="outline"><Printer className="h-4 w-4 mr-1" />View</Button>
                      </Link>
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