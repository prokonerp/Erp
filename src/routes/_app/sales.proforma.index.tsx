// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MoreHorizontal, Eye, Pencil, Trash2, Ban, Download } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ControlledActionDialog } from "@/components/ControlledActionDialog";
import { listProformas, deleteProforma, updateProforma, type ProformaRow } from "@/lib/proforma";
import { inr } from "@/lib/sales";
import { supabase } from "@/integrations/supabase/client";
import { saveElementAsPdf } from "@/lib/docPdf";
import { ProformaPrintView } from "@/components/ProformaPrintView";
import { CompanyProfile, DEFAULT_COMPANY_PROFILE, fetchCompanyProfile } from "@/lib/companyProfile";
import { useRouteState } from "@/lib/routeState";
import { signSignatureUrl } from "@/lib/userSignature";

export const Route = createFileRoute("/_app/sales/proforma/")({
  component: ProformaList,
  head: () => ({
    meta: [
      { title: "Proforma Invoices — Prokon ERP" },
      { name: "description", content: "Proforma invoices (no stock) with conversion to tax invoice." },
      { property: "og:title", content: "Proforma Invoices — Prokon ERP" },
      { property: "og:description", content: "Proforma invoices (no stock) with conversion to tax invoice." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const tone: Record<string, string> = {
  draft: "bg-slate-200 text-slate-800",
  issued: "bg-blue-100 text-blue-800",
  cancelled: "bg-rose-100 text-rose-800",
};

function ProformaList() {
  const [rows, setRows] = useState<ProformaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const [tab, setTab] = useRouteState<"all" | "draft" | "issued">("proforma-tab", "all");

  const refresh = async () => {
    try {
      const data = await listProformas();
      setRows(data);
    } catch (e: any) {
      toast.error(e.message || "Could not refresh list");
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const [data, profile] = await Promise.all([listProformas(), fetchCompanyProfile()]);
        if (!active) return;
        setRows(data);
        setCompany(profile);
      } catch (e: any) {
        toast.error(e.message || "Could not load Proforma Invoices");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const filtered = tab === "all" ? rows : rows.filter((r) => r.status === tab);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Proforma Invoices</h1>
        <Button size="sm" asChild>
          <Link to="/sales/proforma/new"><Plus className="h-4 w-4 mr-1.5" />New Proforma</Link>
        </Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "all" ? "default" : "outline"} onClick={() => setTab("all")}>All ({rows.length})</Button>
        <Button size="sm" variant={tab === "draft" ? "default" : "outline"} onClick={() => setTab("draft")}>Draft ({rows.filter((r) => r.status === "draft").length})</Button>
        <Button size="sm" variant={tab === "issued" ? "default" : "outline"} onClick={() => setTab("issued")}>Issued ({rows.filter((r) => r.status === "issued").length})</Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Proforma No</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Customer</th>
                <th className="p-2 text-left">SO No</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left w-12">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No proforma invoices yet.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/50">
                  <td className="p-2 font-medium font-mono">
                    <Link to="/sales/proforma/$id" params={{ id: r.id }} className="text-primary hover:underline">
                      {r.proforma_no || "—"}
                    </Link>
                  </td>
                  <td className="p-2">{r.proforma_date}</td>
                  <td className="p-2">{r.buyer_name || "—"}</td>
                  <td className="p-2 font-mono text-xs">{r.sales_order_id ? r.sales_order_id.slice(0, 8) : "—"}</td>
                  <td className="p-2 text-right tabular-nums">{inr(r.total)}</td>
                  <td className="p-2"><Badge className={tone[r.status] || ""} variant="secondary">{r.status}</Badge></td>
                  <td className="p-2">
                    <RowActions row={r} company={company} onMutate={refresh} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function RowActions({ row, company, onMutate }: { row: ProformaRow; company: CompanyProfile; onMutate: () => void }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pdfPending, setPdfPending] = useState(false);
  const [authorisedSignatureUrl, setAuthorisedSignatureUrl] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const downloadingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user || cancelled) return;
        const { data: au } = await supabase.from("app_users").select("signature_url").eq("user_id", u.user.id).maybeSingle();
        if (cancelled) return;
        const signed = await signSignatureUrl((au as any)?.signature_url || null);
        if (!cancelled) setAuthorisedSignatureUrl(signed);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!pdfPending || !printRef.current || downloadingRef.current) return;
    let active = true;
    downloadingRef.current = true;
    const filename = `${row.proforma_no || "proforma"}.pdf`;
    saveElementAsPdf(printRef.current, filename)
      .then(() => { if (active) toast.success("PDF downloaded"); })
      .catch((e) => { if (active) toast.error(e.message || "PDF failed"); })
      .finally(() => { downloadingRef.current = false; if (active) setPdfPending(false); });
    return () => { active = false; };
  }, [pdfPending, row, company]);

  const handleDelete = async () => {
    try {
      await deleteProforma(row.id);
      toast.success(`${row.proforma_no || "Proforma"} deleted`);
      setDeleteOpen(false);
      onMutate();
    } catch (e: any) {
      toast.error(e.message || "Could not delete");
    }
  };

  const handleCancel = async ({ reason }: { reason: string }) => {
    try {
      await updateProforma(row.id, { status: "cancelled", cancelled_reason: reason, cancelled_at: new Date().toISOString() } as any);
      toast.success(`${row.proforma_no || "Proforma"} cancelled`);
      onMutate();
    } catch (e: any) {
      return { error: e.message || "Could not cancel" };
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Open actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link to="/sales/proforma/$id" params={{ id: row.id }} className="flex items-center gap-2 cursor-pointer">
              <Eye className="h-4 w-4" /> View
            </Link>
          </DropdownMenuItem>
          {row.status === "draft" && (
            <DropdownMenuItem asChild>
              <Link to="/sales/proforma/$id/edit" params={{ id: row.id }} className="flex items-center gap-2 cursor-pointer">
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            </DropdownMenuItem>
          )}
          {row.status === "draft" && (
            <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="flex items-center gap-2 text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4" /> Delete
            </DropdownMenuItem>
          )}
          {row.status === "issued" && (
            <DropdownMenuItem onClick={() => setCancelOpen(true)} className="flex items-center gap-2 text-destructive focus:text-destructive">
              <Ban className="h-4 w-4" /> Cancel
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPdfPending(true)} className="flex items-center gap-2">
            <Download className="h-4 w-4" /> PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft proforma?</AlertDialogTitle>
            <AlertDialogDescription>No stock is affected. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border text-sm divide-y">
            <div className="flex justify-between p-2"><span className="text-muted-foreground">Proforma No</span><span className="font-medium font-mono">{row.proforma_no || "—"}</span></div>
            <div className="flex justify-between p-2"><span className="text-muted-foreground">Customer</span><span className="font-medium">{row.buyer_name || "—"}</span></div>
            <div className="flex justify-between p-2"><span className="text-muted-foreground">Status</span><span className="font-medium">{row.status}</span></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(e) => { e.preventDefault(); void handleDelete(); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ControlledActionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${row.proforma_no || "Proforma"}?`}
        description="Proforma is not a delivery document — cancelling has no stock effect."
        warning="A cancelled proforma cannot be issued again."
        confirmLabel="Cancel proforma"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        reasonPlaceholder="e.g. Superseded, customer withdrew…"
        onConfirm={handleCancel}
      />

      {pdfPending && (
        <div className="hidden">
          <div ref={printRef}>
            <ProformaPrintView proforma={row} company={company} authorised_signature_url={authorisedSignatureUrl} />
          </div>
        </div>
      )}
    </>
  );
}
