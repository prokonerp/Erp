import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Search, Target } from "lucide-react";
import { toast } from "sonner";
import {
  type Lead,
  type LeadStatus,
  type Customer,
  fmtMoney,
  fmtDate,
  fetchCustomersByIds,
} from "@/lib/crm";
import { ExportButtons } from "@/components/ExportButtons";
import { CustomerPicker } from "@/components/CustomerPicker";
import { useLeadAssignment } from "@/lib/useLeadAssignment";
import { PageHeader } from "@/components/crm/PageHeader";
import { StatusBadge } from "@/components/crm/StatusBadge";
import { EmptyState } from "@/components/crm/EmptyState";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { useDebounced } from "@/lib/sales.hooks";
import { useLeadsTable } from "@/hooks/useLeadsTable";

export const Route = createFileRoute("/_app/crm/leads")({ component: LeadsPage });

function LeadsPage() {
  const loc = useLocation();
  if (loc.pathname !== "/crm/leads" && loc.pathname !== "/crm/leads/") return <Outlet />;
  return <LeadsList />;
}

type LeadForm = {
  customer_id: string;
  title: string;
  source: string;
  expected_value: number | string;
  next_followup: string;
  remarks: string;
};

function LeadsList() {
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useRouteState<"all" | LeadStatus>("filter", "all");
  const [q, setQ] = useRouteState<string>("q", "");
  const [page, setPage] = useRouteState<number>("page", 0);
  const pageSize = 25;
  const debouncedQ = useDebounced(q.trim(), 250);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LeadForm>({
    customer_id: "",
    title: "",
    source: "",
    expected_value: 0,
    next_followup: "",
    remarks: "",
  });
  const openNewLead = useCallback(() => setOpen(true), []);

  useEffect(() => {
    setPage(0);
  }, [debouncedQ, filter]);

  const leadsQuery = useLeadsTable({ search: debouncedQ, status: filter, page, pageSize });
  const rows = useMemo(() => (leadsQuery.data?.rows ?? []) as Lead[], [leadsQuery.data?.rows]);
  const total = leadsQuery.data?.count ?? 0;
  const isLoading = leadsQuery.isLoading;
  const isFetching = leadsQuery.isFetching;

  // Resolve customer names for the current page only (chunked fetch)
  useEffect(() => {
    if (!rows.length) return;
    const ids = rows.map((r) => r.customer_id);
    const known = new Set(customers.map((c) => c.id));
    const missing = Array.from(new Set(ids.filter((id) => id && !known.has(id))));
    if (!missing.length) return;
    let active = true;
    fetchCustomersByIds(missing).then((fetched) => {
      if (!active || !fetched.length) return;
      setCustomers((prev) => {
        const have = new Set(prev.map((c) => c.id));
        return [...prev, ...fetched.filter((c) => !have.has(c.id))];
      });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const load = useCallback(() => {
    leadsQuery.refetch();
  }, [leadsQuery]);

  const { isAdmin, staff, busy: assignBusy, nameOf, assignLeadTo } = useLeadAssignment();

  const assignInline = useCallback(
    async (leadId: string, staffId: string) => {
      const { error } = await assignLeadTo(leadId, staffId);
      if (error) return toast.error(error);
      toast.success("Lead assigned");
      load();
    },
    [assignLeadTo, load],
  );

  const cmap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c])) as Record<string, Customer>,
    [customers],
  );

  const create = async () => {
    if (!form.customer_id) return toast.error("Select a customer");
    if (!form.title) return toast.error("Title is required");
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Not signed in");
    const { error } = await supabase.from("leads").insert({
      customer_id: form.customer_id,
      owner_id: u.user.id,
      title: form.title,
      source: form.source || null,
      expected_value: Number(form.expected_value || 0),
      next_followup: form.next_followup || null,
      remarks: form.remarks || null,
      status: "new",
    });
    if (error) return toast.error(error.message);
    toast.success("Lead created");
    setOpen(false);
    setForm({
      customer_id: "",
      title: "",
      source: "",
      expected_value: 0,
      next_followup: "",
      remarks: "",
    });
    load();
  };

  // Server already filters by status + title/source; client supplements with customer-name match on the current page.
  const filtered = useMemo(() => {
    const s = debouncedQ.toLowerCase();
    if (!s) return rows;
    // If server already matched title/source, we still need to include customer-name hits that wouldn't be server-matched.
    // So broaden client-side on the current page to include customer company as well, while keeping non-matches filtered out.
    return rows.filter((r) => {
      return [r.title, r.source, cmap[r.customer_id]?.company].some((v) =>
        (v || "").toLowerCase().includes(s),
      );
    });
  }, [rows, debouncedQ, cmap]);

  const columns: ColumnDef<Lead>[] = useMemo(() => {
    const cols: ColumnDef<Lead>[] = [
      {
        key: "customer",
        header: "Customer",
        sortable: true,
        render: (r) => cmap[r.customer_id]?.company || "—",
      },
      {
        key: "title",
        header: "Lead",
        sortable: true,
        render: (r) => (
          <Link
            to="/crm/leads/$id"
            params={{ id: r.id }}
            className="font-medium text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {r.title}
          </Link>
        ),
      },
      {
        key: "status",
        header: "Status",
        sortable: true,
        render: (r) => <StatusBadge kind="lead" value={r.status} />,
      },
      {
        key: "assigned_to",
        header: "Assigned to",
        render: (r) => {
          const name = nameOf(r.owner_id);
          return (
            <div className="min-w-32" onClick={(e) => e.stopPropagation()}>
              <span className="text-sm">{name}</span>
              {r.assigned_at && !r.acknowledged_at && (
                <span className="mt-0.5 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-600/20">
                  Not acknowledged
                </span>
              )}
              {isAdmin && (
                <Select
                  value={r.owner_id || ""}
                  onValueChange={(v) => {
                    if (v && v !== r.owner_id) assignInline(r.id, v);
                  }}
                  disabled={assignBusy}
                >
                  <SelectTrigger className="h-7 text-xs w-36 mt-1">
                    <SelectValue placeholder="Reassign…" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.user_id} value={s.user_id}>
                        {s.name || s.email || s.user_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        },
      },
      {
        key: "next_followup",
        header: "Next follow-up",
        sortable: true,
        render: (r) => fmtDate(r.next_followup),
      },
      {
        key: "expected_value",
        header: "Expected",
        align: "right",
        sortable: true,
        render: (r) => fmtMoney(r.expected_value),
      },
      {
        key: "closed_value",
        header: "Closed",
        align: "right",
        sortable: true,
        render: (r) => (r.status === "won" ? fmtMoney(r.closed_value) : "—"),
      },
      ...(filter === "lost"
        ? ([
            {
              key: "lost_reason",
              header: "Lost reason",
              render: (r: Lead) => <span className="text-sm">{r.lost_reason || "—"}</span>,
            },
          ] as ColumnDef<Lead>[])
        : []),
      {
        key: "_actions",
        header: "",
        align: "right",
        render: (r) => (
          <Link to="/crm/leads/$id" params={{ id: r.id }} onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7"
              aria-label={`Open lead ${r.title}`}
            >
              <Target className="h-4 w-4" />
            </Button>
          </Link>
        ),
      },
    ];
    return cols;
  }, [cmap, nameOf, isAdmin, assignBusy, staff, assignInline, filter]);

  // Loading handled by DataTable's skeleton; no full-page gate so toolbar stays interactive during fetch.

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        description="Track prospects from first touch to closed deal."
        group="Customers (Sales & CRM)"
        icon={Target}
        primary={{ label: "New Lead", onClick: openNewLead, icon: Plus }}
        className="print:hidden"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                New lead
              </span>
            </DialogTitle>
            <DialogDescription>Create a new sales lead and assign it.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Customer *</Label>
              <CustomerPicker
                value={form.customer_id}
                required
                onChange={(id) => setForm({ ...form, customer_id: id || "" })}
              />
            </div>
            <div>
              <Label>Title *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. 5 KVA UPS for Server Room"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Source</Label>
                <Input
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                  placeholder="Referral, IndiaMART…"
                />
              </div>
              <div>
                <Label>Expected value (₹)</Label>
                <Input
                  type="number"
                  value={form.expected_value}
                  onChange={(e) => setForm({ ...form, expected_value: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Next follow-up</Label>
              <Input
                type="date"
                value={form.next_followup}
                onChange={(e) => setForm({ ...form, next_followup: e.target.value })}
              />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={create}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        totalRecords={total}
        serverPagination={{ page, pageSize, total, onPageChange: setPage }}
        rowKey="id"
        onRowClick={(r) => nav({ to: "/crm/leads/$id", params: { id: r.id } })}
        emptyIcon={Target}
        emptyTitle={q ? `No leads match "${q}"` : "No leads found"}
        emptyHint={
          q ? "Try clearing the search or filter." : 'Click "New Lead" to create a prospect.'
        }
        emptyAction={
          !q ? (
            <Button size="sm" onClick={openNewLead}>
              <Plus className="h-4 w-4 mr-1" />
              New Lead
            </Button>
          ) : undefined
        }
        toolbar={
          <div className="flex items-center gap-2 w-full">
            <span className="text-sm font-medium">
              All Leads ({total.toLocaleString()}){isFetching && !isLoading ? " · updating…" : ""}
            </span>
            <div className="ml-auto relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search customer, title, source…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-56 pl-8 h-8 text-xs"
              />
            </div>
            <Select
              value={filter}
              onValueChange={(v: string) => setFilter(v as "all" | LeadStatus)}
            >
              <SelectTrigger className="h-8 w-36 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="follow_up">Follow-up</SelectItem>
                <SelectItem value="quoted">Quoted</SelectItem>
                <SelectItem value="won">Won</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
            <ExportButtons
              name="Prokon_Leads"
              title="CRM Leads"
              rows={filtered}
              columns={[
                { header: "Customer", get: (l) => cmap[l.customer_id]?.company || "" },
                { header: "Title", get: (l) => l.title },
                { header: "Source", get: (l) => l.source || "" },
                { header: "Status", get: (l) => l.status },
                { header: "Next follow-up", get: (l) => l.next_followup || "" },
                { header: "Expected", get: (l) => Number(l.expected_value || 0) },
                { header: "Closed", get: (l) => Number(l.closed_value || 0) },
                { header: "Closed on", get: (l) => l.closed_at || "" },
                { header: "Lost reason", get: (l) => l.lost_reason || "" },
                { header: "Closing remarks", get: (l) => l.closed_remarks || "" },
                { header: "Remarks", get: (l) => l.remarks || "" },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
