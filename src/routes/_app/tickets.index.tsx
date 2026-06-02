import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TICKET_STATUSES, CALL_TYPES, STATUS_COLOR } from "@/lib/tickets";
import { Plus, Eye } from "lucide-react";

export const Route = createFileRoute("/_app/tickets/")({
  component: TicketsList,
});

type Row = {
  id: string;
  case_id: string;
  call_type: string;
  product: string | null;
  serial_no: string | null;
  customer_name: string;
  customer_phone: string | null;
  location: string | null;
  status: string;
  assigned_engineer_name: string | null;
  created_at: string;
};

function TicketsList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    let query = supabase.from("tickets").select("*").order("created_at", { ascending: false }).limit(500);
    if (status !== "all") query = query.eq("status", status);
    if (type !== "all") query = query.eq("call_type", type);
    const { data } = await query;
    setRows((data || []) as Row[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, type]);

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      r.case_id.toLowerCase().includes(s) ||
      r.customer_name.toLowerCase().includes(s) ||
      (r.customer_phone || "").toLowerCase().includes(s) ||
      (r.product || "").toLowerCase().includes(s) ||
      (r.serial_no || "").toLowerCase().includes(s) ||
      (r.location || "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <CardTitle>All Tickets</CardTitle>
          <Link to="/tickets/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" />New Ticket</Button></Link>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Input placeholder="Search case / customer / serial…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {TICKET_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue placeholder="All call types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All call types</SelectItem>
                {CALL_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="p-2">Case ID</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Customer</th>
                  <th className="p-2">Product / Serial</th>
                  <th className="p-2">Location</th>
                  <th className="p-2">Engineer</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="p-4 text-muted-foreground">Loading…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="p-4 text-muted-foreground">No tickets yet.</td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 font-mono">{r.case_id}</td>
                    <td className="p-2">{r.call_type}</td>
                    <td className="p-2">
                      <div>{r.customer_name}</div>
                      <div className="text-xs text-muted-foreground">{r.customer_phone}</div>
                    </td>
                    <td className="p-2">
                      <div>{r.product || "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{r.serial_no}</div>
                    </td>
                    <td className="p-2">{r.location || "—"}</td>
                    <td className="p-2">{r.assigned_engineer_name || <span className="text-muted-foreground">Unassigned</span>}</td>
                    <td className="p-2">
                      <Badge className={STATUS_COLOR[r.status] || "bg-zinc-100 text-zinc-700"} variant="secondary">
                        {r.status}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Link to="/tickets/$id" params={{ id: r.id }}>
                        <Button size="icon" variant="ghost"><Eye className="h-4 w-4" /></Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}