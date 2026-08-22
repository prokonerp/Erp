import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Plus, Search, FileText } from "lucide-react";
import {
  inr,
  statusMeta,
  INVOICE_STATUSES,
  type InvoiceRow,
  type InvoiceStatus,
} from "@/lib/sales";
import { useDebounced, pageRange } from "@/lib/sales.hooks";
import { PaginationFooter } from "@/components/PaginationFooter";
import { PermButton } from "@/components/PermGate";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";

export const Route = createFileRoute("/_app/sales/invoices/")({
  component: InvoiceList,
  head: () => ({ meta: [{ title: "Invoices \u2014 Prokon" }] }),
});

function InvoiceList() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const debouncedQ = useDebounced(q.trim(), 300);
  // Reset paging when filters change.
  useMemo(() => setPage(0), [debouncedQ, status]);

  const query = useQuery({
    queryKey: ["invoices", { status, q: debouncedQ, page, pageSize }],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async () => {
      const { from, to } = pageRange(page, pageSize);
      let sel = supabase
        .from("invoices")
        .select("*", { count: "exact" })
        .order("invoice_date", { ascending: false })
        .range(from, to);
      if (status !== "all") sel = sel.eq("status", status);
      if (debouncedQ) {
        // Sanitize %/_ so search input can't broaden the LIKE pattern.
        const safe = debouncedQ.replace(/[%_]/g, "\\$&");
        sel = sel.or(
          `invoice_no.ilike.%${safe}%,buyer_name.ilike.%${safe}%,buyer_gstin.ilike.%${safe}%`,
        );
      }
      const { data, count, error } = await sel;
      if (error) throw error;
      return {
        rows: (data ?? []) as unknown as InvoiceRow[],
        count: count ?? 0,
      };
    },
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.count ?? null;

  const totals = useMemo(() => {
    const tot = rows.reduce((s, r) => s + Number(r.total || 0), 0);
    const paid = rows.reduce((s, r) => s + Number(r.total_paid || 0), 0);
    return { total: tot, paid, due: tot - paid };
  }, [rows]);

  const columns: ColumnDef<InvoiceRow>[] = [
    {
      key: "invoice_no",
      header: "Invoice #",
      sortable: true,
      render: (r) => (
        <Link
          to="/sales/invoices/$id"
          params={{ id: r.id }}
          className="font-mono text-xs text-primary hover:underline"
        >
          {r.invoice_no || r.id.slice(0, 8)}
        </Link>
      ),
    },
    { key: "invoice_date", header: "Date", sortable: true },
    {
      key: "buyer_name",
      header: "Customer",
      render: (r) => r.buyer_name || "\u2014",
    },
    {
      key: "buyer_gstin",
      header: "GSTIN",
      render: (r) => <span className="font-mono text-xs">{r.buyer_gstin || "\u2014"}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortable: true,
      render: (r) => <span className="font-medium">{inr(r.total)}</span>,
    },
    {
      key: "total_paid",
      header: "Paid",
      align: "right",
      render: (r) => <span className="text-emerald-700">{inr(r.total_paid)}</span>,
    },
    {
      key: "_due",
      header: "Due",
      align: "right",
      render: (r) => {
        const due = Math.max(0, Number(r.total) - Number(r.total_paid));
        return <span className="text-amber-700">{inr(due)}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const s = statusMeta(r.status);
        return (
          <span className={"inline-block px-2 py-0.5 rounded-full text-xs " + s.tone}>
            {s.label}
          </span>
        );
      },
    },
    {
      key: "irn",
      header: "IRN",
      render: (r) =>
        r.irn ? (
          <span className="text-emerald-700">\u2713</span>
        ) : (
          <span className="text-muted-foreground">\u2014</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <PageHeader
        title="Invoices"
        description="Sales invoices with status, payment tracking and e-invoicing."
        crumbs={[{ label: "Sales" }, { label: "Invoices" }]}
        actions={
          <PermButton
            module="sales"
            action="create"
            size="sm"
            asChild
            reason="You don't have permission to create invoices."
          >
            <Link to="/sales/invoices/new">
              <Plus className="h-4 w-4 mr-1" />
              New Invoice
            </Link>
          </PermButton>
        }
      />

      <DataTable
        columns={columns}
        data={rows}
        isLoading={query.isLoading}
        emptyIcon={FileText}
        emptyTitle={q || status !== "all" ? "No invoices match your filters" : "No invoices yet"}
        emptyHint={
          q || status !== "all"
            ? "Try clearing your search or changing the status filter."
            : "Create your first sales invoice to get started."
        }
        emptyAction={
          !(q || status !== "all") ? (
            <PermButton
              module="sales"
              action="create"
              size="sm"
              asChild
              reason="You don't have permission to create invoices."
            >
              <Link to="/sales/invoices/new">
                <Plus className="h-4 w-4 mr-1" />
                New Invoice
              </Link>
            </PermButton>
          ) : undefined
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2 w-full">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by number, customer, GSTIN\u2026"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8 w-72 h-9"
              />
            </div>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              <option value="all">All statuses</option>
              {INVOICE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="ml-auto text-xs text-muted-foreground">
              <span className="mr-3">
                Page total: <b>{inr(totals.total)}</b>
              </span>
              <span className="mr-3">
                Paid: <b className="text-emerald-700">{inr(totals.paid)}</b>
              </span>
              <span>
                Due: <b className="text-amber-700">{inr(totals.due)}</b>
              </span>
            </div>
          </div>
        }
        footer={
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            onPage={setPage}
            isFetching={query.isFetching && !query.isLoading}
          />
        }
      />
    </div>
  );
}
