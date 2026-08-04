import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { type Customer } from "@/lib/crm";
import { stateFromGSTIN } from "@/lib/india";
import { ExportButtons } from "@/components/ExportButtons";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { parseCSV } from "@/lib/csv";
import { CustomerFormDialog } from "@/components/CustomerForm";

export const Route = createFileRoute("/_app/masters/customers")({
  component: CustomerMasterPage,
  head: () => ({ meta: [{ title: "Customer Master — Prokon" }] }),
});

export function CustomerMasterPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    // Supabase caps a single response at 1000 rows. Page through to load everything.
    const PAGE = 1000;
    let from = 0;
    const all: any[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, count, error } = await supabase
        .from("customers")
        .select("*", { count: "exact" })
        .order("company")
        .range(from, from + PAGE - 1);
      if (error) break;
      const batch = data || [];
      all.push(...batch);
      if (count != null) setTotalCount(count);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    setRows(all as unknown as Customer[]);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((c) => {
    const s = q.toLowerCase();
    return !s || [c.company, c.contact_name, c.phone, c.email, c.gst, c.state].some((v) => (v || "").toLowerCase().includes(s));
  }), [rows, q]);

  function startNew() { setEditing(null); setOpen(true); }
  function startEdit(c: Customer) { setEditing(c); setOpen(true); }

  async function del(id: string) {
    if (!confirm("Delete this customer?")) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted"); load();
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
      load();
    } catch (e: any) { toast.error(e?.message || "Import failed"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Customer Master</h1>
          <p className="text-sm text-muted-foreground">Single source of truth for customers used across CRM, Tickets, Gatepass and AMC.</p>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">All Customers ({totalCount || rows.length})</CardTitle>
          <Input placeholder="Search by name, phone, GST, city…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Customer</TableHead><TableHead>Type</TableHead><TableHead>Contact</TableHead><TableHead>Phone</TableHead>
              <TableHead>GSTIN</TableHead><TableHead>State</TableHead><TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link to="/customers/$id" params={{ id: c.id }} className="hover:underline hover:text-primary">
                      {c.company}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{(c as any).customer_type || "—"}</TableCell>
                  <TableCell>{c.contact_name || "—"}</TableCell>
                  <TableCell>{c.phone || "—"}</TableCell>
                  <TableCell className="text-xs">{c.gst || "—"}</TableCell>
                  <TableCell>{c.state || "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => del(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No customers. Click <b>New Customer</b> or <b>Import CSV</b>.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CustomerFormDialog
        open={open}
        onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}
        editing={editing}
        allowSaveAndNew
        onSaved={() => { load(); }}
      />
    </div>
  );
}
