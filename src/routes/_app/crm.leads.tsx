import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Eye } from "lucide-react";
import { toast } from "sonner";
import { type Lead, type LeadStatus, type Customer, statusLabel, statusClass, fmtMoney, fmtDate } from "@/lib/crm";
import { ExportButtons } from "@/components/ExportButtons";
import { CustomerPicker } from "@/components/CustomerPicker";

export const Route = createFileRoute("/_app/crm/leads")({ component: LeadsPage });

function LeadsPage() {
  const loc = useLocation();
  // If on a sub-route like /crm/leads/<id>, render only the child
  if (loc.pathname !== "/crm/leads" && loc.pathname !== "/crm/leads/") return <Outlet />;
  return <LeadsList />;
}

function LeadsList() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<"all" | LeadStatus>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    customer_id: "", title: "", source: "", expected_value: 0, next_followup: "", remarks: "",
  });

  const load = async () => {
    const [l, c] = await Promise.all([
      supabase.from("leads").select("*").order("updated_at", { ascending: false }),
      supabase.from("customers").select("*").order("company"),
    ]);
    setRows((l.data || []) as unknown as Lead[]);
    setCustomers((c.data || []) as unknown as Customer[]);
  };
  useEffect(() => { load(); }, []);

  const cmap = Object.fromEntries(customers.map((c) => [c.id, c]));

  const create = async () => {
    if (!form.customer_id) return toast.error("Select a customer");
    if (!form.title) return toast.error("Title is required");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Not signed in");
    const payload = {
      customer_id: form.customer_id,
      owner_id: u.user.id,
      title: form.title,
      source: form.source || null,
      expected_value: Number(form.expected_value || 0),
      next_followup: form.next_followup || null,
      remarks: form.remarks || null,
      status: "new",
    };
    const { error } = await supabase.from("leads").insert(payload as any);
    if (error) return toast.error(error.message);
    toast.success("Lead created");
    setOpen(false);
    setForm({ customer_id: "", title: "", source: "", expected_value: 0, next_followup: "", remarks: "" });
    load();
  };

  const filtered = rows.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    const s = q.toLowerCase();
    if (!s) return true;
    return [r.title, r.source, cmap[r.customer_id]?.company].some((v) => (v || "").toLowerCase().includes(s));
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base">Leads</CardTitle>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-44" />
          <ExportButtons
            name="Prokon_Leads"
            title="CRM Leads"
            rows={filtered}
            columns={[
              { header: "Customer", get: (l) => cmap[l.customer_id]?.company || "" },
              { header: "Title", get: (l) => l.title },
              { header: "Source", get: (l) => l.source || "" },
              { header: "Status", get: (l) => statusLabel[l.status] },
              { header: "Next follow-up", get: (l) => l.next_followup || "" },
              { header: "Expected", get: (l) => Number(l.expected_value || 0) },
              { header: "Closed", get: (l) => Number(l.closed_value || 0) },
              { header: "Closed on", get: (l) => l.closed_at || "" },
              { header: "Remarks", get: (l) => l.remarks || "" },
            ]}
          />
          <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="follow_up">Follow-up</SelectItem>
              <SelectItem value="quoted">Quoted</SelectItem>
              <SelectItem value="won">Won</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New lead</Button></DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle>New lead</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div>
                  <Label>Customer *</Label>
                  <CustomerPicker
                    value={form.customer_id}
                    required
                    onChange={(id) => setForm({ ...form, customer_id: id || "" })}
                  />
                </div>
                <div><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. 5 KVA UPS for Server Room" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Source</Label><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Referral, IndiaMART…" /></div>
                  <div><Label>Expected value (₹)</Label><Input type="number" value={form.expected_value} onChange={(e) => setForm({ ...form, expected_value: e.target.value })} /></div>
                </div>
                <div><Label>Next follow-up</Label><Input type="date" value={form.next_followup} onChange={(e) => setForm({ ...form, next_followup: e.target.value })} /></div>
                <div><Label>Remarks</Label><Textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={create}>Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Customer</TableHead><TableHead>Lead</TableHead><TableHead>Status</TableHead>
            <TableHead>Next follow-up</TableHead><TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Closed</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{cmap[l.customer_id]?.company || "—"}</TableCell>
                <TableCell className="font-medium">{l.title}</TableCell>
                <TableCell><Badge variant="outline" className={statusClass[l.status]}>{statusLabel[l.status]}</Badge></TableCell>
                <TableCell>{fmtDate(l.next_followup)}</TableCell>
                <TableCell className="text-right">{fmtMoney(l.expected_value)}</TableCell>
                <TableCell className="text-right">{l.status === "won" ? fmtMoney(l.closed_value) : "—"}</TableCell>
                <TableCell className="text-right">
                  <Link to="/crm/leads/$id" params={{ id: l.id }}><Button size="sm" variant="ghost"><Eye className="h-4 w-4" /></Button></Link>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No leads</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}