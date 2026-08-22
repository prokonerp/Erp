import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCustomers, useCustomerDetail, masterKeys } from "@/hooks/useMasters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { type Customer } from "@/lib/crm";
import { stateFromGSTIN } from "@/lib/india";
import { ExportButtons } from "@/components/ExportButtons";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { parseCSV } from "@/lib/csv";
import { CustomerFormDialog } from "@/components/CustomerForm";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { TableSkeleton } from "@/components/shared/skeletons";

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

  // Full row for the edit form (list view only carries list columns).
  const { data: editingDetail } = useCustomerDetail(open && editingId ? editingId : null);
  const editing = editingId ? (editingDetail ?? null) : null;

  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const filtered = useMemo(() => rows.filter((c) => {
    const s = q.toLowerCase();
    return !s || [c.company, c.contact_name, c.phone, c.email, c.gst, c.state].some((v) => (v || "").toLowerCase().includes(s));
  }), [rows, q]);

  function startNew() { setEditingId(null); setOpen(true); }
  function startEdit(c: Customer) { setEditingId(c.id); setOpen(true); }

  async function del(c: Customer) {
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success(`Deleted “${c.company}”`);
    setDeleteTarget(null);
    queryClient.invalidateQueries({ queryKey: masterKeys.customers() });
  }

  async function onImport(file: File) {
    try {
      const text = await file.text();
      const rowsCsv = parseCSV(text);
      if (!rowsCsv.length) return toast.error("Empty CSV");
      const payload = rowsCsv.map((r) => {
        const gst = upperTrim(r["GSTIN"] || r["GST"] || "");
        const stateAuto = stateFromGSTIN(gst);
        const placeOfSupply = r["Place of Supply"] || stateAuto || r["State"] || null;
        const companyName = toTitleCaseSmart(r["Company"] || r["Customer Name"] || r["Name"] || "");
        const isBiz = !!(r["Company"] || "").trim();
        const gstStatus = r["GST Treatment"] || (gst ? "Regular" : "Unregistered");
        return {
          customer_type: isBiz ? "Business" : "Individual",
          company: companyName,
          contact_name: toTitleCaseSmart(r["Contact"] || r["Contact Name"] || ""),
          phone: (r["Phone"] || r["Mobile"] || "").trim(),
          email: (r["Email"] || "").trim().toLowerCase() || null,
          gst: isBiz && gstStatus === "Unregistered" ? "URP" : (gst || null),
          gst_status: gstStatus,
          state: r["State"] || r["Place of Supply"] || stateAuto || "Haryana",
          place_of_supply: placeOfSupply,
          city: toTitleCaseSmart(r["City"] || "") || null,
          billing_address: titleCaseAddress(r["Billing Address"] || r["Address"] || "") || null,
          shipping_address: titleCaseAddress(r["Shipping Address"] || r["Billing Address"] || r["Address"] || "") || null,
          address: titleCaseAddress(r["Billing Address"] || r["Address"] || "") || null,
          remarks: r["Remarks"] || null,
        };
      }).filter((p) => p.company);
      if (!payload.length) return toast.error("No valid rows. Required column: Company / Customer Name");
      const { error } = await supabase.from("customers").insert(payload as any);
      if (error) return toast.error(error.message);
      toast.success(`Imported ${payload.length} customer(s)`);
      queryClient.invalidateQueries({ queryKey: masterKeys.customers() });
    } catch (e: any) { toast.error(e?.message || "Import failed"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer Master"
        description="Single source of truth for customers used across CRM, Tickets, Gatepass and AMC."
        crumbs={[{ label: "Masters" }, { label: "Customers" }]}
        actions={
          <>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1" />Import CSV</Button>
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
                { header: "Billing Address", get: (c) => c.billing_address || c.address || "" },
                { header: "Shipping Address", get: (c) => c.shipping_address || "" },
                { header: "Remarks", get: (c) => c.remarks || "" },
              ]}
            />
            <Button size="sm" onClick={startNew}><Plus className="h-4 w-4 mr-1" />New Customer</Button>
          </>
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">All Customers ({totalCount || rows.length})</CardTitle>
          <Input placeholder="Search by name, phone, GST, city…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <TableSkeleton rows={8} />
          ) : filtered.length === 0 ? (
            q ? (
              <EmptyState
                icon={Users}
                title={`No results for “${q}”`}
                hint="Try a different name, phone number or GSTIN."
              />
            ) : (
              <EmptyState
                icon={Users}
                title="No customers yet"
                hint="Add your first customer manually or import an existing list from a CSV file."
                action={<Button size="sm" onClick={startNew}><Plus className="h-4 w-4 mr-1" />New Customer</Button>}
              />
            )
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Customer</TableHead><TableHead>Type</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead>
                <TableHead>GSTIN</TableHead><TableHead>State</TableHead><TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.company}</TableCell>
                    <TableCell className="text-xs">{(c as any).customer_type || "—"}</TableCell>
                    <TableCell>{c.contact_name || "—"}</TableCell>
                    <TableCell>{c.phone || "—"}</TableCell>
                    <TableCell className="text-xs">{c.gst || "—"}</TableCell>
                    <TableCell>{c.state || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" aria-label={`Edit ${c.company}`} onClick={() => startEdit(c)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${c.company}`} onClick={() => setDeleteTarget(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete “${deleteTarget?.company ?? ""}”?`}
        description="This permanently removes the customer and cannot be undone. Linked records may lose this reference."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (deleteTarget) await del(deleteTarget);
        }}
      />

      <CustomerFormDialog
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) setEditingId(null); }}
        editing={editing}
        allowSaveAndNew
        onSaved={() => { queryClient.invalidateQueries({ queryKey: masterKeys.customers() }); }}
      />
    </div>
  );
}
