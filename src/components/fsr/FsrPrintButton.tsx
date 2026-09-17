/**
 * FsrPrintButton — data host for the Field Service Report printout.
 *
 * Resolves the effective FSR row (explicit `fsrRow` prop, else the newest row
 * for the ticket via useFieldServiceReport), then — only when the user clicks
 * Print/Download, never on mount — loads company + ticket + customer + visits
 * + customer signature, builds the print model via buildFsrPrintModel, and
 * renders it into a hidden print host for the multi-page pipeline
 * (printMultiPageElement / saveMultiPageElementAsPdf). Sparse data never
 * throws: customer/visits/signature degrade to null with a warning toast.
 */
import { useRef, useState } from "react";
import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { reportDbError } from "@/lib/format-error";
import {
  DEFAULT_COMPANY_PROFILE,
  fetchCompanyProfile,
  type CompanyProfile,
} from "@/lib/companyProfile";
import {
  buildFsrPrintModel,
  type FsrPrintCustomer,
  type FsrPrintFsr,
  type FsrPrintModel,
  type FsrPrintTicket,
  type FsrPrintVisits,
} from "@/lib/fsrPrint";
import { getOemLogo } from "@/lib/oemLogos";
import { useFieldServiceReport } from "@/hooks/useFieldServiceReport";
import apcLogo from "@/assets/oem-apc.png.asset.json";
import { FsrPrintView, type FsrOemLogo } from "./FsrPrintView";

/** Wait (up to ~1.5s) for the hidden print host to render after setJob. */
async function waitForPrintHost(
  ref: { current: HTMLDivElement | null },
  timeoutMs = 1500,
): Promise<HTMLDivElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (ref.current) return ref.current;
    await new Promise<void>((r) => setTimeout(r, 20));
  }
  return null;
}

/** DB row shape: the print-model FSR fields plus the unsigned signature path
 *  (stale generated types — cast where the ticket page already does). */
export type FsrDbRow = FsrPrintFsr & {
  customer_signature_path?: string | null;
};

export type FsrPrintButtonProps = {
  ticketId: string;
  fsrRow?: FsrDbRow | null;
  /** Icon-only Print + Download buttons. */
  compact?: boolean;
};

type PrintJob = {
  model: FsrPrintModel;
  company: CompanyProfile;
  oem: FsrOemLogo;
  signatureDataUrl: string | null;
};

const TICKET_SELECT =
  "id,case_id,call_type,product,serial_no,customer_name,customer_address,customer_email,customer_phone,complaint,status,remarks,assigned_engineer_name,assigned_engineer_phone,assigned_at,preferred_visit_datetime,closed_at,created_at,oem_call,oem_brand,customer_id";

const CUSTOMER_SELECT =
  "id,company,contact_name,phone,email,billing_address,address,street,city,state,country,gst";

/** Signed signature path → data URL (html2canvas-safe). Null on any failure. */
async function signaturePathToDataUrl(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from("ticket-attachments")
      .createSignedUrl(path, 3600);
    const url = data?.signedUrl;
    if (error || !url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function FsrPrintButton({ ticketId, fsrRow = null, compact = false }: FsrPrintButtonProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [job, setJob] = useState<PrintJob | null>(null);
  const [busy, setBusy] = useState<"print" | "download" | null>(null);
  // Ref-based pipeline lock: `busy` state commits on re-render, so a same-tick
  // double-click (or Print+Download together) would run two pipelines.
  const busyRef = useRef(false);

  // Newest-first (submitted_at desc) — [0] is the latest submission.
  const { data: rows } = useFieldServiceReport(fsrRow ? null : ticketId);
  const effectiveRow: FsrDbRow | null =
    fsrRow ?? (rows?.[0] as unknown as FsrDbRow | undefined) ?? null;
  if (!effectiveRow) return null;

  async function ensureJob(): Promise<PrintJob | null> {
    if (job) return job;
    const row = effectiveRow;
    if (!row) return null;

    // Company (fallback to default on any failure).
    let company: CompanyProfile = DEFAULT_COMPANY_PROFILE;
    try {
      company = await fetchCompanyProfile();
    } catch {
      /* keep default */
    }

    // Ticket — the fields the print model needs, incl. oem_brand + case_id.
    const { data: trow, error: terr } = await supabase
      .from("tickets")
      .select(TICKET_SELECT)
      .eq("id", ticketId)
      .maybeSingle();
    if (terr || !trow) {
      toast.error(
        reportDbError("fsr print ticket", terr, "Ticket not found — cannot build the report"),
      );
      return null;
    }
    const t = trow as unknown as Record<string, string | boolean | null>;
    const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
    const ticket: FsrPrintTicket = {
      case_id: str(t.case_id),
      call_type: str(t.call_type),
      product: str(t.product),
      serial_no: str(t.serial_no),
      customer_name: str(t.customer_name),
      customer_address: str(t.customer_address),
      customer_email: str(t.customer_email),
      customer_phone: str(t.customer_phone),
      complaint: str(t.complaint),
      status: str(t.status),
      remarks: str(t.remarks),
      assigned_engineer_name: str(t.assigned_engineer_name),
      assigned_engineer_phone: str(t.assigned_engineer_phone),
      assigned_at: str(t.assigned_at),
      preferred_visit_datetime: str(t.preferred_visit_datetime),
      closed_at: str(t.closed_at),
      created_at: str(t.created_at),
      oem_call: typeof t.oem_call === "boolean" ? t.oem_call : null,
      oem_brand: str(t.oem_brand),
    };

    // Customer — copied from tickets.$id.tsx; tolerate null.
    // maybeSingle (NOT single): with .single() PostgREST answers
    // Accept: application/vnd.pgrst.object+json and returns HTTP 406 /
    // PGRST116 when the row is absent or RLS-hidden — a console error on
    // every print. maybeSingle returns data:null + error:null for 0 rows,
    // matching the tickets/visits reads above. A genuine fetch error is
    // surfaced instead of silently blanking the customer block.
    let customer: FsrPrintCustomer | null = null;
    const customerId = str(t.customer_id);
    if (customerId) {
      try {
        const { data: c, error: cErr } = await supabase
          .from("customers")
          .select(CUSTOMER_SELECT)
          .eq("id", customerId)
          .maybeSingle();
        if (cErr) {
          toast.warning(
            reportDbError("fsr print customer", cErr, "Customer details could not be loaded"),
          );
        }
        customer = (c as unknown as FsrPrintCustomer | null) ?? null;
      } catch {
        customer = null;
      }
    }

    // Visits — tolerate null (timing blanks stay blank).
    let visits: FsrPrintVisits | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table pending generated types (see VisitTimesBar)
      const { data: v } = await (supabase as any)
        .from("ticket_visits")
        .select("arrival_at,departure_at")
        .eq("ticket_id", ticketId)
        .maybeSingle();
      visits = (v as FsrPrintVisits | null) ?? null;
    } catch {
      visits = null;
    }

    // Customer signature — stale generated types, cast like the ticket page.
    let signatureDataUrl: string | null = null;
    const sigPath = (row as { customer_signature_path?: string | null }).customer_signature_path;
    if (sigPath) {
      signatureDataUrl = await signaturePathToDataUrl(sigPath);
      if (!signatureDataUrl) {
        toast.warning("Customer signature unavailable — printing without it");
      }
    }

    const oem: FsrOemLogo = getOemLogo(ticket.oem_brand ?? ticket.product) ?? {
      url: apcLogo.url,
      alt: "APC",
    };
    const next: PrintJob = {
      model: buildFsrPrintModel({ fsr: row, ticket, customer, visits }),
      company,
      oem,
      signatureDataUrl,
    };
    setJob(next);
    return next;
  }

  function filenameFor(current: PrintJob): string {
    const caseId = (current.model.header.caseId || "NA").replace(/\//g, "_");
    const d = effectiveRow?.submitted_at ?? effectiveRow?.created_at ?? null;
    const day = (typeof d === "string" && d.slice(0, 10)) || new Date().toISOString().slice(0, 10);
    return `FSR_${caseId}_${day}.pdf`;
  }

  async function handlePrint() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("print");
    try {
      const current = await ensureJob();
      if (!current) return;
      const el = await waitForPrintHost(printRef);
      if (!el) throw new Error("Print not ready");
      const { printMultiPageElement } = await import("@/lib/docPdf");
      await printMultiPageElement(el, filenameFor(current), { landscape: true });
      toast.success("Field Service Report sent to print");
    } catch (e: unknown) {
      toast.error(reportDbError("fsr print", e, "Print failed"));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function handleDownload() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("download");
    try {
      const current = await ensureJob();
      if (!current) return;
      const el = await waitForPrintHost(printRef);
      if (!el) throw new Error("Print not ready");
      const { saveMultiPageElementAsPdf } = await import("@/lib/docPdf");
      await saveMultiPageElementAsPdf(el, filenameFor(current), { landscape: true });
      toast.success("Field Service Report downloaded");
    } catch (e: unknown) {
      toast.error(reportDbError("fsr print download", e, "Download failed"));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50";
  return (
    <>
      {compact ? (
        <span className="inline-flex gap-1">
          <button
            type="button"
            className="inline-flex items-center rounded border p-1.5 hover:bg-muted disabled:opacity-50"
            title="Print Field Service Report"
            disabled={busy !== null}
            onClick={() => void handlePrint()}
          >
            <Printer size={14} />
          </button>
          <button
            type="button"
            className="inline-flex items-center rounded border p-1.5 hover:bg-muted disabled:opacity-50"
            title="Download Field Service Report PDF"
            disabled={busy !== null}
            onClick={() => void handleDownload()}
          >
            <Download size={14} />
          </button>
        </span>
      ) : (
        <span className="inline-flex gap-2">
          <button
            type="button"
            className={btn}
            disabled={busy !== null}
            onClick={() => void handlePrint()}
          >
            <Printer size={14} />
            {busy === "print" ? "Preparing…" : "Print FSR"}
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy !== null}
            onClick={() => void handleDownload()}
          >
            <Download size={14} />
            {busy === "download" ? "Preparing…" : "Download FSR"}
          </button>
        </span>
      )}

      {/* Hidden print host — ref sits on the inner div so outerHTML excludes `hidden`. */}
      {job ? (
        <div className="hidden">
          <div ref={printRef}>
            <FsrPrintView
              model={job.model}
              company={job.company}
              oem={job.oem}
              signatureDataUrl={job.signatureDataUrl}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
