import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreVertical, Eye, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type Quotation, type QuoteStatus, type Customer, fmtMoney, fmtDate, quoteStatusClass } from "@/lib/crm";
import { ExportButtons } from "@/components/ExportButtons";

export const Route = createFileRoute("/_app/crm/quotations")({ component: Page });

function Page() {
  const loc = useLocation();
  if (loc.pathname !== "/crm/quotations" && loc.pathname !== "/crm/quotations/") return <Outlet />;
  return <QuotesList />;
}

const STATUSES: QuoteStatus[] = ["draft", "sent", "accepted", "declined", "expired", "invoiced"];

function QuotesList() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [custId, setCustId] = useState("");
  const [subject, setSubject] = useState("");
  const [delId, setDelId] = useState<string | null>(null);

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
    const cust = cmap[custId];
    const { data: u } = await supabase.auth.getUser();
    const today = new Date().toISOString().slice(0, 10);
    const exp = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase.from("quotations").insert({
      customer_id: custId, owner_id: u.user!.id,
      subject: subject || null,
      quote_date: today, expiry_date: exp, validity_days: 15,
      billing_address: cust?.billing_address || cust?.address || null,
      shipping_address: cust?.shipping_address || cust?.billing_address || cust?.address || null,
      place_of_supply: cust?.state || null,
      items: [], subtotal: 0, gst_percent: 18, gst_amount: 0, total: 0, status: "draft",
    } as any).select().single();
    if (error) return toast.error(error.message);
    setOpen(false); setCustId(""); setSubject("");
    nav({ to: "/crm/quotations/$id", params: { id: (data as any).id } });
  };

  const duplicate = (r: Quotation) => {
    // Stash the source id; the editor opens an unsaved working copy
    // that only persists when the user clicks Save.
    try {
      sessionStorage.setItem("quote_clone_source", r.id);
    } catch {}
    nav({ to: "/crm/quotations/$id", params: { id: "new" } });
  };

  const confirmDelete = async () => {
    if (!delId) return;
    const { error } = await supabase.from("quotations").delete().eq("id", delId);
    if (error) {
      toast.error(error.message || "Failed to delete quotation");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== delId));
    setDelId(null);
    toast.success("Quotation deleted successfully.");
  };

  const filtered = rows.filter((r) => {
    const s = q.toLowerCase();
    const matchQ = !s || r.quote_no.toLowerCase().includes(s)
      || (r.subject || "").toLowerCase().includes(s)
      || (cmap[r.customer_id || ""]?.company || "").toLowerCase().includes(s);
    const matchS = statusF === "all" || r.status === statusF;
    return matchQ && matchS;
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <CardTitle className="text-base">Quotations</CardTitle>
        <div className="flex gap-2 flex-wrap">
          <ExportButtons
            name="Prokon_Quotations"
            title="Quotations"
            rows={filtered}
            columns={[
              { header: "Quote#", get: (r) => r.quote_no },
              { header: "Ref#", get: (r) => r.reference_no || "" },
              { header: "Date", get: (r) => r.quote_date },
              { header: "Customer", get: (r) => cmap[r.customer_id || ""]?.company || "" },
              { header: "Subject", get: (r) => r.subject || "" },
              { header: "Expiry", get: (r) => r.expiry_date || "" },
              { header: "Status", get: (r) => r.status },
              { header: "Subtotal", get: (r) => Number(r.subtotal || 0) },
              { header: "GST", get: (r) => Number(r.gst_amount || 0) },
              { header: "Total", get: (r) => Number(r.total || 0) },
            ]}
          />
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />New</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New quotation</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Customer</Label>
                  <Select value={custId} onValueChange={setCustId}>
                    <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.company}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Subject (optional)</Label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. UPS supply & installation" />
                </div>
              </div>
              <DialogFooter><Button onClick={create}>Create</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Quote#</TableHead><TableHead>Ref#</TableHead><TableHead>Date</TableHead>
            <TableHead>Customer</TableHead><TableHead>Subject</TableHead>
            <TableHead>Expiry</TableHead><TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.quote_no}</TableCell>
                <TableCell className="text-xs">{r.reference_no || "—"}</TableCell>
                <TableCell>{fmtDate(r.quote_date)}</TableCell>
                <TableCell>{cmap[r.customer_id || ""]?.company || "—"}</TableCell>
                <TableCell className="max-w-[240px] truncate">{r.subject || "—"}</TableCell>
                <TableCell>{fmtDate(r.expiry_date)}</TableCell>
                <TableCell><Badge variant="outline" className={quoteStatusClass[r.status]}>{r.status}</Badge></TableCell>
                <TableCell className="text-right">{fmtMoney(r.total)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" aria-label="More actions">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => nav({ to: "/crm/quotations/$id", params: { id: r.id } })} className="gap-2 cursor-pointer">
                        <Eye className="h-4 w-4" /> View
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => duplicate(r)} className="gap-2 cursor-pointer">
                        <Copy className="h-4 w-4" /> Clone
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDelId(r.id)} className="gap-2 cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950">
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No quotations</TableCell></TableRow>}
          </TableBody>
        </Table>

        <AlertDialog open={!!delId} onOpenChange={(o) => !o && setDelId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Quotation</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this quotation? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
