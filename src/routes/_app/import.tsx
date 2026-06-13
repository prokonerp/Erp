import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { parseCSV, buildCSV, downloadCSV } from "@/lib/csv";
import { toTitleCaseSmart, titleCaseAddress, upperTrim } from "@/lib/text";
import { useIsAdmin } from "@/lib/useRole";

export const Route = createFileRoute("/_app/import")({
  component: ImportPage,
  head: () => ({ meta: [{ title: "Bulk Import — Prokon" }] }),
});

type ModuleKey = "customers" | "products" | "amcs" | "tickets";

const TEMPLATES: Record<ModuleKey, { headers: string[]; sample: Record<string, string> }> = {
  customers: {
    headers: ["company", "contact_name", "phone", "email", "gst", "state", "billing_address", "shipping_address", "remarks"],
    sample: { company: "Acme Pvt Ltd", contact_name: "Ramesh Kumar", phone: "9876543210", email: "ramesh@acme.in", gst: "06ABCDE1234F1Z5", state: "Haryana", billing_address: "12, Sector 18, Gurgaon", shipping_address: "12, Sector 18, Gurgaon", remarks: "" },
  },
  products: {
    headers: ["name", "unit"],
    sample: { name: "APC Smart-UPS 1000VA", unit: "Nos" },
  },
  amcs: {
    headers: ["agreement_no", "client_name", "client_company", "client_address", "client_gst", "contact_no", "email", "start_date", "duration_years", "amc_value", "model", "serial_no", "remarks"],
    sample: { agreement_no: "PHS/AMC/2026/0001", client_name: "Ramesh Kumar", client_company: "Acme Pvt Ltd", client_address: "12, Sec 18, Gurgaon", client_gst: "06ABCDE1234F1Z5", contact_no: "9876543210", email: "ramesh@acme.in", start_date: "2026-01-01", duration_years: "1", amc_value: "12000", model: "APC 1000VA", serial_no: "APC2024XYZ", remarks: "" },
  },
  tickets: {
    headers: ["case_id", "call_type", "customer_name", "customer_phone", "customer_email", "location", "customer_address", "product", "serial_no", "complaint", "status"],
    sample: { case_id: "", call_type: "OOW", customer_name: "Ramesh Kumar", customer_phone: "9876543210", customer_email: "ramesh@acme.in", location: "Gurgaon", customer_address: "12, Sec 18", product: "APC 1000VA", serial_no: "APC2024XYZ", complaint: "Not powering on", status: "New" },
  },
};

function ImportPage() {
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const [mod, setMod] = useState<ModuleKey>("customers");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: { row: number; reason: string }[] } | null>(null);

  const tpl = TEMPLATES[mod];

  if (roleLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!isAdmin) {
    return (
      <Card>
        <CardHeader><CardTitle>Restricted</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Bulk Import / Export is available to admins only.
        </CardContent>
      </Card>
    );
  }

  const onFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length === 0) { toast.error("CSV is empty or missing headers"); return; }
    setRows(parsed);
    setResult(null);
    toast.success(`Parsed ${parsed.length} row(s)`);
  };

  const downloadTemplate = () => {
    const csv = buildCSV(tpl.headers, [tpl.sample]);
    downloadCSV(`Prokon_${mod}_template.csv`, csv);
  };

  const importRows = async () => {
    if (rows.length === 0) return toast.error("Upload a CSV first");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id ?? null;
    const failed: { row: number; reason: string }[] = [];
    let ok = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (mod === "customers") {
          if (!r.company) throw new Error("company required");
          const { error } = await supabase.from("customers").insert({
            company: toTitleCaseSmart(r.company),
            contact_name: toTitleCaseSmart(r.contact_name) || null,
            phone: r.phone || null,
            email: (r.email || "").toLowerCase() || null,
            gst: upperTrim(r.gst) || null,
            state: r.state || null,
            billing_address: titleCaseAddress(r.billing_address) || null,
            shipping_address: titleCaseAddress(r.shipping_address) || null,
            remarks: r.remarks || null,
            created_by: uid,
          } as never);
          if (error) throw new Error(error.message);
        } else if (mod === "products") {
          if (!r.name) throw new Error("name required");
          const { error } = await supabase.from("products").insert({
            name: toTitleCaseSmart(r.name),
            unit: r.unit || "Nos",
          } as never);
          if (error) throw new Error(error.message);
        } else if (mod === "amcs") {
          if (!r.client_name || !r.start_date) throw new Error("client_name and start_date required");
          const years = Number(r.duration_years || 1);
          const start = r.start_date;
          const end = new Date(start);
          end.setFullYear(end.getFullYear() + years);
          end.setDate(end.getDate() - 1);
          const endStr = end.toISOString().slice(0, 10);
          const { error } = await supabase.from("amcs").insert({
            agreement_no: r.agreement_no || `PHS/AMC/${new Date().getFullYear()}/${Date.now().toString().slice(-4)}-${i}`,
            client_name: toTitleCaseSmart(r.client_name),
            client_company: r.client_company ? toTitleCaseSmart(r.client_company) : null,
            client_address: r.client_address ? titleCaseAddress(r.client_address) : null,
            client_gst: r.client_gst ? upperTrim(r.client_gst) : null,
            contact_no: r.contact_no || null,
            email: r.email ? r.email.toLowerCase() : null,
            start_date: start,
            end_date: endStr,
            duration_years: years,
            amc_value: Number(r.amc_value || 0),
            units: r.serial_no || r.model
              ? [{ model: toTitleCaseSmart(r.model || ""), serial_no: upperTrim(r.serial_no || "") }]
              : [],
            pm_dates: [],
            terms: "",
            remarks: r.remarks || null,
            created_by: uid,
          } as never);
          if (error) throw new Error(error.message);
        } else if (mod === "tickets") {
          if (!r.customer_name) throw new Error("customer_name required");
          const payload: Record<string, unknown> = {
            call_type: r.call_type || "OOW",
            customer_name: toTitleCaseSmart(r.customer_name),
            customer_phone: r.customer_phone || null,
            customer_email: (r.customer_email || "").toLowerCase() || null,
            location: toTitleCaseSmart(r.location) || null,
            customer_address: titleCaseAddress(r.customer_address) || null,
            product: toTitleCaseSmart(r.product) || null,
            serial_no: upperTrim(r.serial_no) || null,
            complaint: r.complaint || null,
            status: r.status || "New",
            created_by: uid,
          };
          if (r.case_id) payload.case_id = r.case_id;
          const { error } = await supabase.from("tickets").insert(payload as never);
          if (error) throw new Error(error.message);
        }
        ok++;
      } catch (e) {
        failed.push({ row: i + 2, reason: e instanceof Error ? e.message : "unknown" });
      }
    }
    setResult({ ok, failed });
    setBusy(false);
    if (failed.length === 0) toast.success(`Imported ${ok} record(s)`);
    else toast.warning(`Imported ${ok}, failed ${failed.length}`);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Bulk Import (CSV)</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Choose module & download template</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Module</Label>
            <Select value={mod} onValueChange={(v) => { setMod(v as ModuleKey); setRows([]); setResult(null); setFileName(""); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customers">Customers</SelectItem>
                <SelectItem value="products">Products</SelectItem>
                <SelectItem value="amcs">AMCs</SelectItem>
                <SelectItem value="tickets">Tickets</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" />Download CSV template
          </Button>
          <div className="text-xs text-muted-foreground">
            Required headers: <span className="font-mono">{tpl.headers.join(", ")}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">2. Upload your CSV</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-3 border-2 border-dashed rounded-md p-6 cursor-pointer hover:bg-muted/40">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="font-medium">{fileName || "Click to choose a CSV file"}</div>
              <div className="text-xs text-muted-foreground">UTF-8, comma-separated. First row must be headers.</div>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </label>

          {rows.length > 0 && (
            <div className="text-sm">
              <FileCheck2 className="inline h-4 w-4 mr-1 text-green-700" />
              {rows.length} row(s) ready. Preview first 5:
              <div className="overflow-x-auto border rounded-md mt-2 max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>{Object.keys(rows[0]).map((h) => <th key={h} className="p-1 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        {Object.keys(rows[0]).map((h) => <td key={h} className="p-1">{r[h]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">3. Import</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={importRows} disabled={busy || rows.length === 0} size="lg">
            {busy ? "Importing…" : `Import ${rows.length || ""} record(s)`}
          </Button>
          {result && (
            <div className="text-sm">
              <div className="font-medium">Imported: {result.ok}, Failed: {result.failed.length}</div>
              {result.failed.length > 0 && (
                <div className="mt-2 max-h-60 overflow-y-auto border rounded-md p-2 bg-red-50 text-red-900">
                  {result.failed.map((f, i) => (
                    <div key={i} className="text-xs">Row {f.row}: {f.reason}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}