import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Search } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";

type Item = { product: string; serial_no?: string; quantity?: string; unit?: string; remarks?: string };
export type Gatepass = {
  id: string; challan_no: string; gatepass_date: string; gatepass_time: string;
  person_name: string; person_company: string | null; vehicle_no: string | null;
  destination: string | null; purpose: string | null; return_type: string;
  items: Item[]; remarks: string | null; prepared_by: string | null; authorised_by: string | null;
  contact_no: string | null; created_at: string;
};

export function GatepassRecords() {
  const [rows, setRows] = useState<Gatepass[]>([]);
  const [q, setQ] = useRouteState("q", "");

  const GATEPASS_COLS = "id,challan_no,gatepass_date,gatepass_time,person_name,person_company,vehicle_no,destination,purpose,return_type,items,remarks,created_at";
  useEffect(() => {
    supabase.from("gatepasses").select(GATEPASS_COLS).order("created_at", { ascending: false }).limit(100)
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

  const exportRows = filtered.flatMap((g) =>
    (g.items && g.items.length > 0 ? g.items : [{ product: "", serial_no: "", quantity: "", unit: "", remarks: "" }]).map((it, idx) => ({
      g, it, idx,
    }))
  );
  const exportCols = [
    { header: "Challan No", get: (r: any) => r.g.challan_no },
    { header: "Date", get: (r: any) => r.g.gatepass_date },
    { header: "Time", get: (r: any) => r.g.gatepass_time },
    { header: "Person", get: (r: any) => r.g.person_name },
    { header: "Company", get: (r: any) => r.g.person_company || "" },
    { header: "Contact", get: (r: any) => r.g.contact_no || "" },
    { header: "Vehicle", get: (r: any) => r.g.vehicle_no || "" },
    { header: "Destination", get: (r: any) => r.g.destination || "" },
    { header: "Purpose", get: (r: any) => r.g.purpose || "" },
    { header: "Type", get: (r: any) => r.g.return_type },
    { header: "Item#", get: (r: any) => r.idx + 1 },
    { header: "Product", get: (r: any) => r.it.product || "" },
    { header: "Serial", get: (r: any) => r.it.serial_no || "" },
    { header: "Qty", get: (r: any) => r.it.quantity || "" },
    { header: "Unit", get: (r: any) => r.it.unit || "" },
    { header: "Remarks", get: (r: any) => r.g.remarks || "" },
  ];

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
            <ExportButtons name="Prokon_Gatepasses" title="Gatepass Records" rows={exportRows} columns={exportCols} />
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
                      <Link to="/gatepass/$id" params={{ id: r.id }}>
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
