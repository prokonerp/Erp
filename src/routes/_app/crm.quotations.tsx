import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreVertical, Eye, Copy, Trash2, Search, Pencil, Send, ArrowRightLeft, FileText, Loader2, Clock, CheckCircle2, FilePlus } from "lucide-react";
import { toast } from "sonner";
import { type Quotation, type QuoteStatus, type Customer, fmtMoney, fmtDate, quoteStatusClass } from "@/lib/crm";
import { ExportButtons } from "@/components/ExportButtons";
import { createSalesOrderFromQuote } from "@/lib/documentFlow.writers";
import { cn } from "@/lib/utils";
import { useDebounced } from "@/lib/sales.hooks";

export const Route = createFileRoute("/_app/crm/quotations")({ component: Page });

function Page() {
  const loc = useLocation();
  if (loc.pathname !== "/crm/quotations" && loc.pathname !== "/crm/quotations/") return <Outlet />;
  return <QuotesWorkspace />;
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

// ---------------------------------------------------------------------------
// Zoho-style split-view quotations workspace
// ---------------------------------------------------------------------------

type QuoteListRow = Pick<
  Quotation,
  "id" | "quote_no" | "reference_no" | "subject" | "customer_id" | "quote_date" |
  "expiry_date" | "status" | "total" | "created_at" | "updated_at"
>;

const PAGE_SIZE = 20;
const STATUS_DOT: Record<QuoteStatus, string> = {
  draft: "bg-gray-400",
  sent: "bg-blue-500",
  accepted: "bg-green-500",
  declined: "bg-red-500",
  expired: "bg-amber-500",
  invoiced: "bg-purple-500",
};

function QuotesWorkspace() {
  const nav = useNavigate();
  const [rows, setRows] = useState<QuoteListRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<string>("all");
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Quotation | null>(null);
  const [selLoading, setSelLoading] = useState(false);
  const [tab, setTab] = useState<"details" | "activity">("details");
  const [converting, setConverting] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [newCustId, setNewCustId] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cacheRef = useRef<Map<string, Quotation>>(new Map());
  const search = useDebounced(q, 300);

  const cmap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c])) as Record<string, Customer>,
    [customers],
  );

  const loadCustomers = useCallback(async () => {
    const { data } = await supabase.from("customers").select("*").order("company");
    setCustomers((data || []) as unknown as Customer[]);
  }, []);

  const buildQuery = useCallback(
    (from: number, to: number) => {
      let query = supabase
        .from("quotations")
        .select(
          "id, quote_no, reference_no, subject, customer_id, quote_date, expiry_date, status, total, created_at, updated_at",
        )
        .order("created_at", { ascending: false })
        .range(from, to);
      if (statusF !== "all") query = query.eq("status", statusF);
      const s = search.trim();
      if (s) {
        // Server-side search on quote_no/subject; customer/amount filtered client-side.
        query = query.or(`quote_no.ilike.%${s}%,subject.ilike.%${s}%,reference_no.ilike.%${s}%`);
      }
      return query;
    },
    [statusF, search],
  );

  const loadFirst = useCallback(async () => {
    const { data } = await buildQuery(0, PAGE_SIZE - 1);
    const list = (data || []) as unknown as QuoteListRow[];
    setRows(list);
    setHasMore(list.length === PAGE_SIZE);
  }, [buildQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { data } = await buildQuery(rows.length, rows.length + PAGE_SIZE - 1);
    const list = (data || []) as unknown as QuoteListRow[];
    setRows((prev) => [...prev, ...list]);
    setHasMore(list.length === PAGE_SIZE);
    setLoadingMore(false);
  }, [buildQuery, rows.length, loadingMore, hasMore]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);
  useEffect(() => { loadFirst(); }, [loadFirst]);

  // Filter by customer / amount client-side (list is already narrow).
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const cust = cmap[r.customer_id || ""]?.company?.toLowerCase() || "";
      const amt = String(r.total ?? "");
      return (
        r.quote_no.toLowerCase().includes(s) ||
        (r.subject || "").toLowerCase().includes(s) ||
        cust.includes(s) ||
        amt.includes(s)
      );
    });
  }, [rows, cmap, search]);

  // Restore last opened from sessionStorage on first mount.
  useEffect(() => {
    try {
      const last = sessionStorage.getItem("quotes_last_selected");
      if (last) setSelectedId(last);
    } catch {}
  }, []);

  // Auto-select first item when list changes and nothing selected.
  useEffect(() => {
    if (!selectedId && filtered.length) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  // Fetch selected quote details (with cache).
  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    try { sessionStorage.setItem("quotes_last_selected", selectedId); } catch {}
    const cached = cacheRef.current.get(selectedId);
    if (cached) { setSelected(cached); return; }
    setSelLoading(true);
    (async () => {
      const { data } = await supabase.from("quotations").select("*").eq("id", selectedId).single();
      const quote = data as unknown as Quotation | null;
      if (quote) {
        quote.items = Array.isArray(quote.items) ? quote.items : [];
        cacheRef.current.set(selectedId, quote);
        setSelected(quote);
      } else {
        setSelected(null);
      }
      setSelLoading(false);
    })();
  }, [selectedId]);

  // Keyboard nav (Up / Down) — ignore when typing in inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (!filtered.length) return;
      e.preventDefault();
      const idx = filtered.findIndex((r) => r.id === selectedId);
      let next = idx;
      if (e.key === "ArrowDown") next = Math.min(filtered.length - 1, idx + 1);
      if (e.key === "ArrowUp") next = Math.max(0, idx - 1);
      if (next !== idx && next >= 0) setSelectedId(filtered[next].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedId]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadMore();
  }, [loadMore]);

  const createNew = async () => {
    if (!newCustId) return toast.error("Select customer");
    const cust = cmap[newCustId];
    const { data: u } = await supabase.auth.getUser();
    const today = new Date().toISOString().slice(0, 10);
    const exp = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase.from("quotations").insert({
      customer_id: newCustId, owner_id: u.user!.id,
      subject: newSubject || null,
      quote_date: today, expiry_date: exp, validity_days: 15,
      billing_address: cust?.billing_address || cust?.address || null,
      shipping_address: cust?.shipping_address || cust?.billing_address || cust?.address || null,
      place_of_supply: cust?.state || null,
      items: [], subtotal: 0, gst_percent: 18, gst_amount: 0, total: 0, status: "draft",
    } as any).select().single();
    if (error) return toast.error(error.message);
    setOpenNew(false); setNewCustId(""); setNewSubject("");
    nav({ to: "/crm/quotations/$id", params: { id: (data as any).id } });
  };

  const clone = (row: QuoteListRow) => {
    try { sessionStorage.setItem("quote_clone_source", row.id); } catch {}
    nav({ to: "/crm/quotations/$id", params: { id: "new" } });
  };

  const changeStatus = async (next: QuoteStatus) => {
    if (!selected) return;
    const prev = selected.status;
    setSelected({ ...selected, status: next });
    setRows((r) => r.map((x) => x.id === selected.id ? { ...x, status: next } : x));
    cacheRef.current.set(selected.id, { ...selected, status: next });
    const { error } = await supabase.from("quotations").update({ status: next }).eq("id", selected.id);
    if (error) {
      toast.error(error.message);
      setSelected({ ...selected, status: prev });
      setRows((r) => r.map((x) => x.id === selected.id ? { ...x, status: prev } : x));
    } else {
      toast.success(`Marked as ${next}`);
    }
  };

  const convert = async () => {
    if (!selected) return;
    setConverting(true);
    try {
      const so = await createSalesOrderFromQuote(selected);
      toast.success(`Sales Order ${so.so_no || ""} created`);
      await supabase.from("quotations").update({ status: "accepted" }).eq("id", selected.id);
      nav({ to: "/sales/orders/$id", params: { id: so.id } });
    } catch (e: any) {
      toast.error(e?.message || "Failed to convert");
    } finally {
      setConverting(false);
    }
  };

  const confirmDelete = async () => {
    if (!delId) return;
    const { error } = await supabase.from("quotations").delete().eq("id", delId);
    if (error) return toast.error(error.message);
    setRows((prev) => prev.filter((r) => r.id !== delId));
    cacheRef.current.delete(delId);
    if (selectedId === delId) setSelectedId(null);
    setDelId(null);
    toast.success("Quotation deleted");
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-3">
      {/* Left panel */}
      <Card className="w-[32%] min-w-[300px] flex flex-col overflow-hidden">
        <CardHeader className="p-3 space-y-2 border-b">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">Quotations</CardTitle>
            <Dialog open={openNew} onOpenChange={setOpenNew}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-7"><Plus className="h-3.5 w-3.5 mr-1" />New</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New quotation</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Customer</Label>
                    <Select value={newCustId} onValueChange={setNewCustId}>
                      <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.company}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Subject (optional)</Label>
                    <Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
                  </div>
                </div>
                <DialogFooter><Button onClick={createNew}>Create</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search customer, quote, amount…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Select value={statusF} onValueChange={setStatusF}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <div
          ref={scrollRef} onScroll={onScroll}
          className="flex-1 overflow-y-auto divide-y"
        >
          {filtered.map((r) => (
            <QuoteRow
              key={r.id}
              row={r}
              customer={cmap[r.customer_id || ""]?.company || "—"}
              selected={r.id === selectedId}
              onSelect={setSelectedId}
            />
          ))}
          {loadingMore && (
            <div className="p-3 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          )}
          {!loadingMore && !hasMore && filtered.length > 0 && (
            <div className="p-3 text-center text-[11px] text-muted-foreground">End of list</div>
          )}
          {filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">No quotations</div>
          )}
        </div>
      </Card>

      {/* Right panel */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        {!selected && !selLoading && (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a quotation to view details
          </div>
        )}
        {selLoading && (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        )}
        {selected && !selLoading && (
          <>
            {/* Sticky header */}
            <div className="sticky top-0 z-10 bg-background border-b p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Quotation</div>
                  <div className="font-semibold text-base flex items-center gap-2">
                    {selected.quote_no || "(unsaved)"}
                    <Badge variant="outline" className={quoteStatusClass[selected.status]}>{selected.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {cmap[selected.customer_id || ""]?.company || "—"} • {fmtDate(selected.quote_date)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[11px] text-muted-foreground uppercase">Total</div>
                  <div className="font-semibold text-base">{fmtMoney(selected.total)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => nav({ to: "/crm/quotations/$id", params: { id: selected.id } })}>
                    <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                  </Button>
                  <Button size="sm" variant="outline" disabled={selected.status !== "draft"} onClick={() => changeStatus("sent")}>
                    <Send className="h-3.5 w-3.5 mr-1" />Send
                  </Button>
                  <Button size="sm" variant="outline" onClick={convert} disabled={converting}>
                    <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />Convert
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => nav({ to: "/crm/quotations/$id", params: { id: selected.id } })}>
                    <FileText className="h-3.5 w-3.5 mr-1" />PDF
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost"><MoreVertical className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => clone({ ...selected } as any)} className="gap-2">
                        <Copy className="h-4 w-4" /> Clone
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => changeStatus("accepted")} className="gap-2">
                        <CheckCircle2 className="h-4 w-4" /> Mark Approved
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => changeStatus("declined")} className="gap-2 text-amber-600">
                        Reject
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setDelId(selected.id)} className="gap-2 text-red-600 focus:text-red-600">
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="mx-3 mt-2 self-start">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
              <div className="flex-1 overflow-y-auto p-3">
                <TabsContent value="details" className="m-0 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <Field label="Customer" value={cmap[selected.customer_id || ""]?.company || "—"} />
                    <Field label="Quote Date" value={fmtDate(selected.quote_date)} />
                    <Field label="Salesperson" value={selected.salesperson || "—"} />
                    <Field label="Place of Supply" value={selected.place_of_supply || "—"} />
                    <Field label="Reference #" value={selected.reference_no || "—"} />
                    <Field label="Expiry" value={fmtDate(selected.expiry_date)} />
                    <Field label="Subject" value={selected.subject || "—"} />
                    <Field label="Project" value={selected.project_name || "—"} />
                  </div>

                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right w-20">Qty</TableHead>
                          <TableHead className="text-right w-28">Rate</TableHead>
                          <TableHead className="text-right w-32">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(selected.items || []).map((it, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                            <TableCell>
                              <div className="font-medium">{it.product_name || it.description}</div>
                              {it.product_name && it.description && it.description !== it.product_name && (
                                <div className="text-xs text-muted-foreground">{it.description}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-right">{it.qty} {it.unit || ""}</TableCell>
                            <TableCell className="text-right">{fmtMoney(it.rate)}</TableCell>
                            <TableCell className="text-right">{fmtMoney(it.amount)}</TableCell>
                          </TableRow>
                        ))}
                        {(selected.items || []).length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No items</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex justify-end">
                    <div className="w-full max-w-sm space-y-1 text-sm">
                      <SumRow label="Subtotal" value={fmtMoney(selected.subtotal)} />
                      {Number(selected.discount_amount) > 0 && <SumRow label="Discount" value={`- ${fmtMoney(selected.discount_amount)}`} />}
                      {Number(selected.shipping_charges) > 0 && <SumRow label="Shipping" value={fmtMoney(selected.shipping_charges)} />}
                      <SumRow label="Tax" value={fmtMoney(selected.gst_amount)} />
                      <div className="border-t pt-1 flex justify-between font-semibold">
                        <span>Total</span><span>{fmtMoney(selected.total)}</span>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="m-0">
                  <ActivityTimeline quote={selected} />
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </Card>

      <AlertDialog open={!!delId} onOpenChange={(o) => !o && setDelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quotation</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const QuoteRow = memo(function QuoteRow({
  row, customer, selected, onSelect,
}: {
  row: QuoteListRow;
  customer: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      className={cn(
        "w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors",
        selected && "bg-accent/70 border-l-2 border-primary",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm truncate">{customer}</div>
        <div className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT[row.status])} />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground mt-0.5">
        <span className="truncate">{row.quote_no} • {fmtDate(row.quote_date)}</span>
        <span className="font-medium text-foreground">{fmtMoney(row.total)}</span>
      </div>
      {row.subject && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{row.subject}</div>}
    </button>
  );
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ActivityTimeline({ quote }: { quote: Quotation }) {
  const events: Array<{ icon: any; label: string; ts: string; tone: string }> = [];
  events.push({ icon: FilePlus, label: "Quotation created", ts: quote.created_at, tone: "text-gray-600" });
  if (quote.updated_at && quote.updated_at !== quote.created_at) {
    events.push({ icon: Pencil, label: "Last edited", ts: quote.updated_at, tone: "text-blue-600" });
  }
  if (quote.status === "sent" || quote.status === "accepted" || quote.status === "invoiced") {
    events.push({ icon: Send, label: "Sent to customer", ts: quote.updated_at, tone: "text-blue-600" });
  }
  if (quote.status === "accepted" || quote.status === "invoiced") {
    events.push({ icon: CheckCircle2, label: "Approved by customer", ts: quote.updated_at, tone: "text-green-600" });
  }
  if (quote.status === "declined") {
    events.push({ icon: Trash2, label: "Declined", ts: quote.updated_at, tone: "text-red-600" });
  }
  return (
    <ol className="relative border-l pl-4 space-y-4">
      {events.map((e, i) => {
        const Icon = e.icon;
        return (
          <li key={i} className="relative">
            <span className="absolute -left-[22px] top-0.5 h-4 w-4 rounded-full bg-background border flex items-center justify-center">
              <Icon className={cn("h-2.5 w-2.5", e.tone)} />
            </span>
            <div className="text-sm">{e.label}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {new Date(e.ts).toLocaleString()}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
