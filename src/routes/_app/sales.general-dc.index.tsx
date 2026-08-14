import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MoreHorizontal, Eye, Pencil, Trash2, Ban, Download, PackageCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ControlledActionDialog } from "@/components/ControlledActionDialog";
import {
  listGeneralDcs,
  gdcTotal,
  deleteGeneralDc,
  cancelGeneralDc,
  fetchReturnedDcNos,
  isReturnOverdue,
  stageReturnGrnPrefill,
  type GeneralDcRow,
} from "@/lib/generalDc";
import { inr } from "@/lib/sales";
import { usePermissions } from "@/lib/usePermissions";
import { saveElementAsPdf } from "@/lib/docPdf";
import { GeneralDcPrintView } from "@/components/GeneralDcPrintView";
import {
  CompanyProfile,
  DEFAULT_COMPANY_PROFILE,
  fetchCompanyProfile,
} from "@/lib/companyProfile";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/sales/general-dc/")({
  component: GeneralDcList,
  head: () => ({
    meta: [
      { title: "General Delivery Challans — Prokon ERP" },
      { name: "description", content: "Standalone dispatch challans with stock posting and invoice conversion." },
      { property: "og:title", content: "General Delivery Challans — Prokon ERP" },
      { property: "og:description", content: "Standalone dispatch challans with stock posting and invoice conversion." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const tone: Record<string, string> = {
  Draft: "bg-slate-200 text-slate-800",
  Issued: "bg-blue-100 text-blue-800",
  Converted: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-rose-100 text-rose-800",
};

function GeneralDcList() {
  const [rows, setRows] = useState<GeneralDcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);
  const [warehouseNames, setWarehouseNames] = useState<Record<string, string>>({});
  const [returnedNos, setReturnedNos] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"all" | "pending-returns">("all");
  const { loading: permLoading, can } = usePermissions();

  const refresh = async () => {
    try {
      const data = await listGeneralDcs();
      setRows(data);
      setReturnedNos(await fetchReturnedDcNos(data.map((r) => r.dc_no || "")).catch(() => new Set<string>()));
    } catch (e: any) {
      toast.error(e.message || "Could not refresh list");
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const [data, profile, { data: whRows, error: whError }] = await Promise.all([
          listGeneralDcs(),
          fetchCompanyProfile(),
          supabase.from("warehouses").select("id,name"),
        ]);
        if (!active) return;
        setRows(data);
        setCompany(profile);
        fetchReturnedDcNos(data.map((r) => r.dc_no || ""))
          .then((s) => { if (active) setReturnedNos(s); })
          .catch(() => {});
        const map: Record<string, string> = {};
        (whRows || []).forEach((w: any) => {
          map[w.id] = w.name;
        });
        setWarehouseNames(map);
      } catch (e: any) {
        toast.error(e.message || "Could not load General DCs");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const isReturned = (r: GeneralDcRow) => !!r.dc_no && returnedNos.has(r.dc_no);
  const pendingReturns = rows
    .filter((r) => r.returnable && r.status === "Issued" && !isReturned(r))
    .sort((a, b) => (a.expected_return_date || "9999-12-31").localeCompare(b.expected_return_date || "9999-12-31"));
  const visible = tab === "pending-returns" ? pendingReturns : rows;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">General Delivery Challans</h1>
        <Button size="sm" asChild>
          <Link to="/sales/general-dc/new"><Plus className="h-4 w-4 mr-1.5" />New General DC</Link>
        </Button>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "all" ? "default" : "outline"} onClick={() => setTab("all")}>All ({rows.length})</Button>
        <Button size="sm" variant={tab === "pending-returns" ? "default" : "outline"} onClick={() => setTab("pending-returns")}>
          Pending Returns ({pendingReturns.length})
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2 text-left">DC No</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Customer</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Expected Return</th>
                <th className="p-2 text-left">Purpose</th>
                <th className="p-2 text-right">Value</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left w-12">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading || permLoading ? (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">
                  {tab === "pending-returns" ? "No outstanding returnable challans." : "No general delivery challans yet."}
                </td></tr>
              ) : visible.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/50">
                  <td className="p-2 font-medium">
                    <Link to="/sales/general-dc/$id" params={{ id: r.id }} className="text-primary hover:underline">
                      {r.dc_no || "—"}
                    </Link>
                  </td>
                  <td className="p-2">{r.dc_date}</td>
                  <td className="p-2">{r.customer_name || "—"}</td>
                  <td className="p-2">{r.returnable ? "Returnable" : "Non-Returnable"}</td>
                  <td className={`p-2 ${r.returnable && !isReturned(r) && isReturnOverdue(r) ? "text-destructive font-medium" : ""}`}>
                    {r.returnable ? (r.expected_return_date || "—") : "—"}
                    {r.returnable && !isReturned(r) && isReturnOverdue(r) && " · Overdue"}
                  </td>
                  <td className="p-2 max-w-[240px] truncate">{r.purpose || "—"}</td>
                  <td className="p-2 text-right">{inr(gdcTotal(r.items || []))}</td>
                  <td className="p-2"><Badge className={tone[r.status] || ""} variant="secondary">{r.status}</Badge></td>
                  <td className="p-2">
                    <RowActions
                      dc={r}
                      canEdit={can("general_dc", "edit")}
                      canDelete={can("general_dc", "delete")}
                      returned={isReturned(r)}
                      company={company}
                      warehouseNames={warehouseNames}
                      onMutate={refresh}
                    />
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

function RowActions({
  dc,
  canEdit,
  canDelete,
  returned,
  company,
  warehouseNames,
  onMutate,
}: {
  dc: GeneralDcRow;
  canEdit: boolean;
  canDelete: boolean;
  returned: boolean;
  company: CompanyProfile;
  warehouseNames: Record<string, string>;
  onMutate: () => void;
}) {
  const nav = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pdfPending, setPdfPending] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const downloadingRef = useRef(false);

  useEffect(() => {
    if (!pdfPending || !printRef.current || downloadingRef.current) return;
    let active = true;
    downloadingRef.current = true;
    const filename = `${dc.dc_no || "general-dc"}.pdf`;
    saveElementAsPdf(printRef.current, filename)
      .then(() => {
        if (active) toast.success("PDF downloaded");
      })
      .catch((e) => {
        if (active) toast.error(e.message || "PDF failed");
      })
      .finally(() => {
        downloadingRef.current = false;
        if (active) setPdfPending(false);
      });
    return () => { active = false; };
  }, [pdfPending, dc, company, warehouseNames]);

  const handleDelete = async () => {
    try {
      await deleteGeneralDc(dc.id);
      toast.success(`${dc.dc_no || "General DC"} deleted`);
      setDeleteOpen(false);
      onMutate();
    } catch (e: any) {
      toast.error(e.message || "Could not delete challan");
    }
  };

  const handleCancel = async ({ reason }: { reason: string; scope?: string }) => {
    try {
      await cancelGeneralDc(dc.id, reason);
      toast.success(`${dc.dc_no || "General DC"} cancelled — stock restored`);
      onMutate();
    } catch (e: any) {
      return { error: e.message || "Could not cancel challan" };
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
            <Link to="/sales/general-dc/$id" params={{ id: dc.id }} className="flex items-center gap-2 cursor-pointer">
              <Eye className="h-4 w-4" /> View
            </Link>
          </DropdownMenuItem>

          {dc.status === "Draft" && canEdit && (
            <DropdownMenuItem asChild>
              <Link to="/sales/general-dc/$id/edit" params={{ id: dc.id }} className="flex items-center gap-2 cursor-pointer">
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            </DropdownMenuItem>
          )}

          {dc.status === "Draft" && canDelete && (
            <DropdownMenuItem
              onClick={() => setDeleteOpen(true)}
              className="flex items-center gap-2 text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </DropdownMenuItem>
          )}

          {dc.status === "Issued" && canDelete && (
            <DropdownMenuItem
              onClick={() => setCancelOpen(true)}
              className="flex items-center gap-2 text-destructive focus:text-destructive"
            >
              <Ban className="h-4 w-4" /> Cancel
            </DropdownMenuItem>
          )}

          {dc.returnable && dc.status === "Issued" && !returned && (
            <DropdownMenuItem
              onClick={() => { stageReturnGrnPrefill(dc, warehouseNames); nav({ to: "/grn/customer/new" }); }}
              className="flex items-center gap-2"
            >
              <PackageCheck className="h-4 w-4" /> Generate Return GRN
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setPdfPending(true)}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" /> PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft challan?</AlertDialogTitle>
            <AlertDialogDescription>
              No stock has been posted for a draft, so this simply removes the record. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border text-sm divide-y">
            <div className="flex justify-between p-2"><span className="text-muted-foreground">DC Number</span><span className="font-medium">{dc.dc_no || "—"}</span></div>
            <div className="flex justify-between p-2"><span className="text-muted-foreground">Customer</span><span className="font-medium">{dc.customer_name || "—"}</span></div>
            <div className="flex justify-between p-2"><span className="text-muted-foreground">Date</span><span className="font-medium">{dc.dc_date}</span></div>
            <div className="flex justify-between p-2"><span className="text-muted-foreground">Status</span><span className="font-medium">{dc.status}</span></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void handleDelete(); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ControlledActionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${dc.dc_no || "General DC"}?`}
        description="Cancelling returns every unit issued on this challan back to available stock in its original warehouse and writes a reversal entry in the stock ledger."
        warning="A cancelled General DC is final — it cannot be issued again or converted to an invoice."
        confirmLabel="Cancel challan"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        reasonPlaceholder="e.g. Dispatch aborted, wrong customer, material returned…"
        onConfirm={handleCancel}
      />

      {pdfPending && (
        <div className="hidden">
          <div ref={printRef}>
            <GeneralDcPrintView dc={dc} company={company} warehouseNames={warehouseNames} />
          </div>
        </div>
      )}
    </>
  );
}
