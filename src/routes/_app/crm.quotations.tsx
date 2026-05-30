import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Eye } from "lucide-react";
import { toast } from "sonner";
import { type Quotation, type Customer, fmtMoney, fmtDate } from "@/lib/crm";

export const Route = createFileRoute("/_app/crm/quotations")({ component: Page });

function Page() {
  const loc = useLocation();
  if (loc.pathname !== "/crm/quotations" && loc.pathname !== "/crm/quotations/") return <Outlet />;
  return <QuotesList />;
}

function QuotesList() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [custId, setCustId] = useState("");

  const load = async () => {
    const [a, c] = await Promise.all([
      supabase.from("quotations").select("*").order("created_at", { ascending: false }),
      supabase.from("customers").select("*").order("company"),
    ]);
    setRows((a.data || []) as unknown as Quotation[]);
    setCustomers((c.data || []) as unknown as Customer[]);
  };
  useEffect(() => { load(); }, []);

  const cmap = Object.fromEntries(customers.map((c) => [c.id, c]));

  const create = async () => {
    if (!custId) return toast.error("Select customer");
    const { data: u } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("quotations").insert({
      customer_id: custId, owner_id: u.user!.id,
      items: [], subtotal: 0, gst_percent: 18, gst_amount: 0, total: 0, status: "draft",
    } as any).select().single();
    if (error) return toast.error(error.message);
    setOpen(false); setCustId("");
    nav({ to: "/crm/quotations/$id", params: { id: (data as any).id } });
  };

  const filtered = rows.filter((r) => {
    const s = q.toLowerCase();
    return !s || r.quote_no.toLowerCase().includes(s) || (cmap[r.customer_id || ""]?.company || "").toLowerCase().includes(s);
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Quotations</CardTitle>
        <div className="flex gap-2">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New quotation</DialogTitle></DialogHeader>
              <div>
                <Label>Customer</Label>
                <Select value={custId} onValueChange={setCustId}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.company}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <DialogFooter><Button onClick={create}>Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Quote No</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead>
            <TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.quote_no}</TableCell>
                <TableCell>{fmtDate(r.quote_date)}</TableCell>
                <TableCell>{cmap[r.customer_id || ""]?.company || "—"}</TableCell>
                <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                <TableCell className="text-right">{fmtMoney(r.total)}</TableCell>
                <TableCell className="text-right">
                  <Link to="/crm/quotations/$id" params={{ id: r.id }}><Button size="sm" variant="ghost"><Eye className="h-4 w-4" /></Button></Link>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No quotations</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}