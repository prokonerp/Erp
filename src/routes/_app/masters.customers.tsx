import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCustomers, useCustomerDetail, masterKeys } from "@/hooks/useMasters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Upload, Users, Search } from "lucide-react";
import { toast } from "sonner";
import { type Customer } from "@/lib/crm";
import { stateFromGSTIN } from "@/lib/india";
import { ExportButtons } from "@/components/ExportButtons";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { parseCSV } from "@/lib/csv";
import { CustomerFormDialog } from "@/components/CustomerForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";

export const Route = createFileRoute("/_app/masters/customers")({
  component: CustomerMasterPage,
  head: () => ({ meta: [{ title: "Customer Master — Prokon" }] }),
});

export function CustomerMasterPage() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: customersData, isLoading } = useCustomers();
  const rows = customersData?.rows ?? [];
  const totalCount = customersData?.count ?? rows.length;

  const { data: editingDetail } = useCustomerDetail(open && editingId ? editingId : null);
  const editing = editingId ? (editingDetail ?? null) : null;

  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const filtered = useMemo(
    () =>
      rows.filter((c) => {
        const s = q.toLowerCase();
        return (
          !s ||
          [c.company, c.contact_name, c.phone, c.email, c.gst, c.state].some(
            (v) => (v || "").toLowerCase().includes(s),
          )
        );
      }),
    [rows, q],
  );

  function startNew() {
    setEditingId(null);
    setOpen(true);
  }
  function startEdit(c: Customer) {
    setEditingId(c.id);
    setOpen(true);
  }

  async function del(c: Customer) {
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success(`Deleted \u201c${c.company}\u201d`);
    setDeleteTarget(null);
    queryClient.invalidateQueries({ queryKey: masterKeys.customers() });
  }

  async function onImport(file: File) {
    try {
      const text = await file.text();
      const rowsCsv = parseCSV(text);
      if (!rowsCsv.length) return toast.error("Empty CSV");
      const payload = rowsCsv
        .map((r) => {
          const gst = upperTrim(r["GSTIN"] || r["GST"] || "");
          const stateAuto = stateFromGSTIN(gst);
          const placeOfSupply = r["Place of Supply"] || stateAuto || r["State"] || null;
          const companyName = toTitleCaseSmart(
            r["Company"] || r["Customer Name"] || r["Name"] || "",
          );
          const isBiz = !!(r["Company"] || "").trim();
          const gstStatus = r["GST Treatment"] || (gst ? "Regular" : "Unregistered");
          return {
            customer_type: isBiz ? "Business" : "Individual",
            company: companyName,
            contact_name: toTitleCaseSmart(r["Contact"] || r["Contact Name"] || ""),
            phone: (r["Phone"] || r["Mobile"] || "").trim(),
            email: (r["Email"] || "").trim().toLowerCase() || null,
            gst: isBiz && gstStatus === "Unregistered" ? "URP" : gst || null,
            gst_status: gstStatus,
            state: r["State"] || r["Place of Supply"] || stateAuto || "Haryana",
            place_of_supply: placeOfSupply,
            city: toTitleCaseSmart(r["City"] || "") || null,
            billing_address:
              titleCaseAddress(r["Billing Address"] || r["Address"] || "") || null,
            shipping_address:
              titleCaseAddress(
                r["Shipping Address"] || r["Billing Address"] || r["Address"] || "",
              ) || null,
            address: titleCaseAddress(r["Billing Address"] || r["Address"] || "") || null,
            remarks: r["Remarks"] || null,
          };
        })
        .filter((p) => p.company);
      if (!payload.length)
        return toast.error("No valid rows. Required column: Company / Customer Name");
      const { error } = await supabase.from("customers").insert(payload as any);
      if (error) return toast.error(error.message);
      toast.success(`Imported ${payload.length} customer(s)`);
      queryClient.invalidateQueries({ queryKey: masterKeys.customers() });
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const columns: ColumnDef<Customer>[] = [
    {
      key: "company",
      header: "Customer",
      sortable: true,
      render: (c) => <span className="font-medium">{c.company}</span>,
    },
    {
      key: "customer_type",
      header: "Type",
      render: (c) => <span className="text-xs">{(c as any).customer_type || "\u2014"}</span>,
    },
    { key: "contact_name", header: "Contact", render: (c) => c.contact_name || "\u2014" },
    { key: "phone", header: "Phone", render: (c) => c.phone || "\u2014" },
    {
      key: "gst",
      header: "GSTIN",
      render: (c) => <span className="text-xs">{c.gst || "\u2014"}</span>,
    },
    { key: "state", header: "State", sortable: true, render: (c) => c.state || "\u2014" },
    {
      key: "_actions",
      header: "Actions",
      align: "right",
      render: (c) => (
        <>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Edit ${c.company}`}
            onClick={() => startEdit(c)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete ${c.company}`}
            onClick={() => setDeleteTarget(c)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </>
      ),
      className: "w-24",
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer Master"
        description="Single source of truth for customers used across CRM, Tickets, Gatepass and AMC."
        crumbs={[{ label: "Masters" }, { label: "Customers" }]}
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-1" />
              Import CSV
            </Button>
            <ExportButtons
              name="Prokon_Customers"
              title="Customer Master"
              rows={filtered}
              columns={[
                { header: "Company", get: (c) => c.company },
                { header: "Contact", get: (c) => c.contact_name || "" },
                { header: "Phone", get: (c) => c.phone || "" },
                { header: "Email", get: (c) => c.email || "" },
                { header: "GSTIN", get: (c) => c.gst || "" },
                { header: "PAN", get: (c) => (c as any).pan || "" },
                { header: "GST Treatment", get: (c) => (c as any).gst_status || "" },
                { header: "State", get: (c) => c.state || "" },
                { header: "City", get: (c) => (c as any).city || "" },
                {
                  header: "Billing Address",
                  get: (c) => c.billing_address || c.address || "",
                },
                { header: "Shipping Address", get: (c) => c.shipping_address || "" },
                { header: "Remarks", get: (c) => c.remarks || "" },
              ]}
            />
            <Button size="sm" onClick={startNew}>
              <Plus className="h-4 w-4 mr-1" />
              New Customer
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyIcon={Users}
        emptyTitle={q ? `No results for "${q}"` : "No customers yet"}
        emptyHint={
          q
            ? "Try a different name, phone number or GSTIN."
            : "Add your first customer manually or import an existing list from a CSV file."
        }
        emptyAction={
          !q ? (
            <Button size="sm" onClick={startNew}>
              <Plus className="h-4 w-4 mr-1" />
              New Customer
            </Button>
          ) : undefined
        }
        toolbar={
          <div className="flex items-center gap-2 w-full">
            <span className="text-sm font-medium">
              All Customers ({totalCount || rows.length})
            </span>
            <div className="ml-auto relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name, phone, GST…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-56 pl-8 h-8 text-xs"
              />
            </div>
          </div>
        }
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.company ?? ""}"?`}
        description="This permanently removes the customer and cannot be undone. Linked records may lose this reference."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (deleteTarget) await del(deleteTarget);
        }}
      />

      <CustomerFormDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setEditingId(null);
        }}
        editing={editing}
        allowSaveAndNew
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: masterKeys.customers() });
        }}
      />
    </div>
  );
}
