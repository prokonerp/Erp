import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { PageLoader } from "@/components/shared/skeletons";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { VerificationStepper } from "@/components/VerificationStepper";
import { VerificationDiff } from "@/components/VerificationDiff";
import { useTicketVerifications } from "@/hooks/useTicketVerifications";
import {
  buildCustomerSnapshot,
  buildEquipmentOriginal,
  customerCorrectedSchema,
  equipmentMismatchSchema,
  canProceedToStep2,
  canProceedToWork,
} from "@/lib/ticket-verifications";
import { getCurrentGeo, validateGeoForMismatch } from "@/lib/verification-geo";
import { STATUS_COLOR, PRIORITY_COLOR } from "@/lib/tickets";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  Loader2,
  MessageCircle,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";

export const Route = createFileRoute("/eng/ticket/$id")({
  component: EngTicketDetail,
});

type Ticket = {
  id: string;
  case_id: string;
  call_type: string;
  product: string | null;
  serial_no: string | null;
  customer_name: string;
  customer_address: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  location: string | null;
  sector: string | null;
  complaint: string | null;
  status: string;
  priority: string | null;
  assigned_employee_id: string | null;
  assigned_engineer_name: string | null;
  assigned_engineer_phone: string | null;
  special_instruction: string | null;
  special_instruction_acknowledged: boolean;
  created_at: string;
};

type Activity = {
  id: string;
  kind: string;
  notes: string | null;
  created_at: string;
  actor: string | null;
};

function EngTicketDetail() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [guardError, setGuardError] = useState<string | null>(null);

  // Note form
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const noteIdempotencyRef = useRef("");

  // Photo upload
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoProgress, setPhotoProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Special instruction ack
  const [ackBusy, setAckBusy] = useState(false);

  // Verification
  const { data: verifications } = useTicketVerifications(id);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [mismatchPhotoFile, setMismatchPhotoFile] = useState<File | null>(null);
  const [mismatchBusy, setMismatchBusy] = useState(false);

  // Step 1 forms
  const {
    register: regCorrected,
    handleSubmit: handleCorrectedSubmit,
    formState: { errors: correctedErrors },
    reset: resetCorrected,
  } = useForm({
    resolver: zodResolver(customerCorrectedSchema),
    defaultValues: {
      customer_name: ticket?.customer_name ?? "",
      customer_phone: ticket?.customer_phone ?? "",
      customer_email: ticket?.customer_email ?? "",
      customer_address: ticket?.customer_address ?? "",
      sector: ticket?.sector ?? "",
      location: ticket?.location ?? "",
    },
  });

  // Step 2 form
  const {
    register: regMismatch,
    handleSubmit: handleMismatchSubmit,
    formState: { errors: mismatchErrors },
    reset: resetMismatch,
  } = useForm({
    resolver: zodResolver(equipmentMismatchSchema),
    defaultValues: {
      corrected_model: ticket?.product ?? "",
      corrected_serial: ticket?.serial_no ?? "",
    },
  });

  useEffect(() => {
    let active = true;
    (async () => {
      const [tkRes, actRes] = await Promise.all([
        supabase
          .from("tickets")
          .select(
            "id,case_id,call_type,product,serial_no,customer_name,customer_phone,location,complaint,status,priority,assigned_employee_id,assigned_engineer_name,special_instruction,special_instruction_acknowledged,created_at",
          )
          .eq("id", id)
          .single(),
        supabase
          .from("ticket_activities")
          .select("id,kind,notes,created_at,actor")
          .eq("ticket_id", id)
          .order("created_at", { ascending: false }),
      ]);
      if (!active) return;
      if (tkRes.data) setTicket(tkRes.data as unknown as Ticket);
      setActivities((actRes.data || []) as Activity[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Resolve current employee identity (same pattern as useMyQueue)
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const email = u.user?.email;
      if (!email) return;
      const { data: emps } = await supabase
        .from("employees")
        .select("id,name")
        .eq("email", email)
        .eq("active", true);
      if (!active || !emps || emps.length === 0) return;
      setMyId(emps[0].id as string);
      setMyName(emps[0].name as string);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Ownership guard: fail-closed when ticket names a different engineer
  const isOwner = (() => {
    if (!ticket) return true; // loading state, no guard yet
    const hasFk = !!ticket.assigned_employee_id;
    const hasName = !!ticket.assigned_engineer_name;
    // No assignee info at all → fail-open (RLS still governs)
    if (!hasFk && !hasName) return true;
    // FK match
    if (hasFk && myId && ticket.assigned_employee_id === myId) return true;
    // Name match (only when engineer has a resolved name)
    if (hasName && myName && ticket.assigned_engineer_name === myName) return true;
    // Assigned to someone else → blocked
    return false;
  })();

  const isRestricted = !loading && ticket !== null && !isOwner;

  // Check if special instruction has been acknowledged (by ticket flag or activity)
  const isSpecialAcked = (() => {
    if (!ticket) return false;
    if (ticket.special_instruction_acknowledged) return true;
    return activities.some((a) => a.kind === "acknowledge");
  })();

  const refreshActivities = async () => {
    const { data: actRes } = await supabase
      .from("ticket_activities")
      .select("id,kind,notes,created_at,actor")
      .eq("ticket_id", id)
      .order("created_at", { ascending: false });
    setActivities((actRes || []) as Activity[]);
  };

  const addNote = async () => {
    const text = noteText.trim();
    if (!text) return;

    const bucket = `${id}:${Math.floor(Date.now() / 60_000)}`;
    if (noteIdempotencyRef.current === bucket) return;
    noteIdempotencyRef.current = bucket;

    setNoteBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("ticket_activities").insert({
        ticket_id: id,
        kind: "note",
        notes: text,
        actor: u.user?.id ?? null,
      } as never);
      if (error) {
        toast.error(error.message);
        noteIdempotencyRef.current = "";
        return;
      }
      setNoteText("");
      toast.success("Note added");
      await refreshActivities();
    } finally {
      setNoteBusy(false);
    }
  };

  const acknowledgeInstruction = async () => {
    if (!ticket?.special_instruction || isSpecialAcked) return;
    setAckBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("ticket_activities").insert({
        ticket_id: id,
        kind: "acknowledge",
        notes: "Acknowledged special instruction",
        actor: u.user?.id ?? null,
      } as never);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Acknowledged");
      await refreshActivities();
    } finally {
      setAckBusy(false);
    }
  };

  const handleCustomerVerified = async () => {
    setVerdictBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const actorName = myName ?? u.user?.email ?? "Engineer";
      const snapshot = buildCustomerSnapshot(ticket!);
      const { error } = await supabase.from("ticket_customer_verifications").upsert(
        {
          ticket_id: id,
          verdict: "verified",
          snapshot,
          actor: actorName,
        },
        { onConflict: "ticket_id" },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      await supabase.from("ticket_activities").insert({
        ticket_id: id,
        kind: "customer_verify",
        notes: `Customer verified by ${actorName} at ${new Date().toISOString()}`,
        actor: u.user?.id ?? null,
      } as never);
      toast.success("Customer details verified");
      resetCorrected();
    } finally {
      setVerdictBusy(false);
    }
  };

  const handleCustomerIncorrect = async (data: {
    customer_name: string;
    customer_phone: string;
    customer_email?: string | null;
    customer_address?: string | null;
    sector?: string | null;
    location?: string | null;
  }) => {
    setVerdictBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const actorName = myName ?? u.user?.email ?? "Engineer";
      const { error } = await supabase.from("ticket_customer_verifications").upsert(
        {
          ticket_id: id,
          verdict: "incorrect",
          corrected: data,
          actor: actorName,
        },
        { onConflict: "ticket_id" },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      await supabase.from("ticket_activities").insert({
        ticket_id: id,
        kind: "customer_verify",
        notes: `Customer corrected by ${actorName} at ${new Date().toISOString()}`,
        actor: u.user?.id ?? null,
      } as never);
      toast.success("Customer details corrected");
    } finally {
      setVerdictBusy(false);
    }
  };

  const handleEquipmentMismatch = async (data: {
    corrected_model: string;
    corrected_serial: string;
  }) => {
    if (!mismatchPhotoFile) {
      toast.error("Photo is required for mismatch report");
      return;
    }
    setMismatchBusy(true);
    try {
      const geo = await getCurrentGeo();
      const geoErr = validateGeoForMismatch(geo);
      if (geoErr) {
        toast.error(geoErr);
        return;
      }

      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(mismatchPhotoFile);
      });
      const base64 = dataUrl.split(",")[1];

      const { uploadPublicTicketAttachment } =
        await import("@/lib/public-ticket-uploads.functions");
      const uploadResult = await uploadPublicTicketAttachment({
        data: {
          ticket_id: id,
          filename: mismatchPhotoFile.name,
          content_type: mismatchPhotoFile.type,
          kind: "equipment_correction",
          data_base64: base64,
          lat: geo!.lat,
          long: geo!.long,
          accuracy: geo!.accuracy,
          captured_at: geo!.captured_at,
        },
      });

      const { data: u } = await supabase.auth.getUser();
      const actorName = myName ?? u.user?.email ?? "Engineer";
      const original = buildEquipmentOriginal(ticket!);
      const { error } = await supabase.from("ticket_equipment_verifications").upsert(
        {
          ticket_id: id,
          verdict: "mismatch",
          original_model: original.original_model,
          original_serial: original.original_serial,
          corrected_model: data.corrected_model,
          corrected_serial: data.corrected_serial,
          photo_path: uploadResult.path,
          geo_lat: geo!.lat,
          geo_long: geo!.long,
          geo_accuracy: geo!.accuracy,
          captured_at: geo!.captured_at,
          actor: actorName,
        },
        { onConflict: "ticket_id" },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      await supabase.from("ticket_activities").insert({
        ticket_id: id,
        kind: "equipment_verify",
        notes: `Equipment mismatch reported by ${actorName} at ${new Date().toISOString()}`,
        actor: u.user?.id ?? null,
      } as never);
      toast.success("Equipment mismatch recorded");
      setMismatchPhotoFile(null);
      resetMismatch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    } finally {
      setMismatchBusy(false);
    }
  };

  const handleEquipmentMatched = async () => {
    setVerdictBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const actorName = myName ?? u.user?.email ?? "Engineer";
      const original = buildEquipmentOriginal(ticket!);
      const { error } = await supabase.from("ticket_equipment_verifications").upsert(
        {
          ticket_id: id,
          verdict: "matched",
          original_model: original.original_model,
          original_serial: original.original_serial,
          corrected_model: ticket?.product ?? null,
          corrected_serial: ticket?.serial_no ?? null,
          actor: actorName,
        },
        { onConflict: "ticket_id" },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      await supabase.from("ticket_activities").insert({
        ticket_id: id,
        kind: "equipment_verify",
        notes: `Equipment verified matched by ${actorName} at ${new Date().toISOString()}`,
        actor: u.user?.id ?? null,
      } as never);
      toast.success("Equipment verified as matched");
    } finally {
      setVerdictBusy(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Photo must be ≤ 2 MB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowed.includes(file.type)) {
      toast.error("Only JPEG, PNG, WebP, HEIC images allowed");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setPhotoBusy(true);
    setPhotoProgress("Reading file…");
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const base64 = dataUrl.split(",")[1];
      const ext =
        (file.name.split(".").pop() || "jpg")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 5) || "jpg";
      const safeName = `issue-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const path = `ticket/${id}/${new Date().toISOString().slice(0, 10)}/${safeName}`;

      setPhotoProgress("Uploading…");

      // Use the existing upload server function
      const { uploadPublicTicketAttachment } =
        await import("@/lib/public-ticket-uploads.functions");
      await uploadPublicTicketAttachment({
        data: {
          ticket_id: id,
          filename: file.name,
          content_type: file.type,
          kind: "issue_photo",
          data_base64: base64,
        },
      });

      // Log the upload as an activity
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("ticket_activities").insert({
        ticket_id: id,
        kind: "photo",
        notes: `Photo uploaded: ${file.name}`,
        actor: u.user?.id ?? null,
      } as never);

      toast.success("Photo uploaded");
      await refreshActivities();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    } finally {
      setPhotoBusy(false);
      setPhotoProgress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) return <PageLoader label="Loading ticket…" />;
  if (!ticket)
    return <div className="text-center py-20 text-muted-foreground">Ticket not found.</div>;

  if (isRestricted) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Link
          to="/eng/queue"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Queue
        </Link>
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <ShieldAlert className="h-10 w-10 mx-auto text-amber-500" />
            <p className="font-semibold text-base">Not assigned to you</p>
            <p className="text-sm text-muted-foreground">
              This ticket is assigned to a different engineer. Contact Services for access.
            </p>
            <div className="mt-2">
              <span className="font-mono text-sm text-muted-foreground">{ticket.case_id}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link
        to="/eng/queue"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Queue
      </Link>

      {/* Header */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-semibold text-base">{ticket.case_id}</span>
            {ticket.priority && (
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLOR[ticket.priority] || ""}`}
              >
                {ticket.priority}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${STATUS_COLOR[ticket.status] || ""}`}
            >
              {ticket.status}
            </Badge>
            <span className="text-xs text-muted-foreground">{ticket.call_type}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Customer</span>
              <p className="font-medium">{ticket.customer_name}</p>
              {ticket.customer_phone && (
                <a
                  href={`tel:${ticket.customer_phone}`}
                  className="text-primary text-xs hover:underline"
                >
                  {ticket.customer_phone}
                </a>
              )}
            </div>
            {ticket.location && (
              <div>
                <span className="text-muted-foreground text-xs">Location</span>
                <p className="font-medium">{ticket.location}</p>
              </div>
            )}
          </div>

          {ticket.complaint && (
            <div>
              <span className="text-muted-foreground text-xs">Complaint</span>
              <p className="text-sm mt-0.5">{ticket.complaint}</p>
            </div>
          )}

          {ticket.product && (
            <div className="text-sm">
              <span className="text-muted-foreground text-xs">Product</span>
              <p className="font-medium">{ticket.product}</p>
            </div>
          )}

          {ticket.serial_no && (
            <div className="text-sm">
              <span className="text-muted-foreground text-xs">Serial No</span>
              <p className="font-medium font-mono">{ticket.serial_no}</p>
            </div>
          )}

          {ticket.special_instruction && ticket.special_instruction.trim() && (
            <div
              className={`border rounded-md p-3 text-sm ${isSpecialAcked ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-xs">Special Instructions:</span>
                {isSpecialAcked ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-green-700 font-medium">
                    <CheckCircle2 className="h-3 w-3" /> Acknowledged
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] px-2"
                    disabled={ackBusy}
                    onClick={acknowledgeInstruction}
                  >
                    {ackBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 mr-1" />
                    )}
                    Acknowledge
                  </Button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{ticket.special_instruction}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Verification Stepper */}
      <VerificationStepper
        step1Done={!!verifications?.customer}
        step2Done={!!verifications?.equipment}
      />

      {/* Step 1: Customer Verification */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <h3 className="text-sm font-semibold">1 — Customer Details</h3>
          {verifications?.customer ? (
            <>
              <div className="text-xs text-muted-foreground">
                {verifications.customer.verdict === "verified"
                  ? "✓ Customer details verified"
                  : "✓ Customer details corrected"}
              </div>
              {verifications.customer.verdict === "incorrect" &&
                verifications.customer.snapshot &&
                verifications.customer.corrected && (
                  <div className="space-y-1 mt-2">
                    <VerificationDiff
                      label="Customer name"
                      original={
                        (verifications.customer.snapshot as Record<string, unknown>)
                          .customer_name as string | null
                      }
                      corrected={
                        (verifications.customer.corrected as Record<string, unknown>)
                          .customer_name as string | null
                      }
                      engineer={verifications.customer.engineer_name}
                      at={verifications.customer.verified_at}
                    />
                    <VerificationDiff
                      label="Customer phone"
                      original={
                        (verifications.customer.snapshot as Record<string, unknown>)
                          .customer_phone as string | null
                      }
                      corrected={
                        (verifications.customer.corrected as Record<string, unknown>)
                          .customer_phone as string | null
                      }
                      engineer={verifications.customer.engineer_name}
                      at={verifications.customer.verified_at}
                    />
                    <VerificationDiff
                      label="Email"
                      original={
                        (verifications.customer.snapshot as Record<string, unknown>)
                          .customer_email as string | null
                      }
                      corrected={
                        (verifications.customer.corrected as Record<string, unknown>)
                          .customer_email as string | null
                      }
                      engineer={verifications.customer.engineer_name}
                      at={verifications.customer.verified_at}
                    />
                    <VerificationDiff
                      label="Address"
                      original={
                        (verifications.customer.snapshot as Record<string, unknown>)
                          .customer_address as string | null
                      }
                      corrected={
                        (verifications.customer.corrected as Record<string, unknown>)
                          .customer_address as string | null
                      }
                      engineer={verifications.customer.engineer_name}
                      at={verifications.customer.verified_at}
                    />
                    <VerificationDiff
                      label="Sector"
                      original={
                        (verifications.customer.snapshot as Record<string, unknown>).sector as
                          | string
                          | null
                      }
                      corrected={
                        (verifications.customer.corrected as Record<string, unknown>).sector as
                          | string
                          | null
                      }
                      engineer={verifications.customer.engineer_name}
                      at={verifications.customer.verified_at}
                    />
                    <VerificationDiff
                      label="Location"
                      original={
                        (verifications.customer.snapshot as Record<string, unknown>).location as
                          | string
                          | null
                      }
                      corrected={
                        (verifications.customer.corrected as Record<string, unknown>).location as
                          | string
                          | null
                      }
                      engineer={verifications.customer.engineer_name}
                      at={verifications.customer.verified_at}
                    />
                  </div>
                )}
            </>
          ) : ticket ? (
            <div className="space-y-3">
              <div className="text-xs space-y-1 border rounded-md p-2">
                {(() => {
                  const snap = buildCustomerSnapshot(ticket);
                  return (
                    <>
                      <p>
                        <strong>{snap.customer_name}</strong>
                      </p>
                      {snap.customer_phone && <p>Phone: {snap.customer_phone}</p>}
                      {snap.sector && <p>Sector: {snap.sector}</p>}
                      {snap.location && <p>Location: {snap.location}</p>}
                    </>
                  );
                })()}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={verdictBusy}
                  onClick={handleCustomerVerified}
                >
                  {verdictBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Details Verified
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={verdictBusy}
                  onClick={handleCorrectedSubmit(handleCustomerIncorrect)}
                >
                  Details Incorrect
                </Button>
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Correct details…</summary>
                <form
                  className="mt-2 space-y-2"
                  onSubmit={handleCorrectedSubmit(handleCustomerIncorrect)}
                >
                  <Input placeholder="Customer name" {...regCorrected("customer_name")} />
                  {correctedErrors.customer_name && (
                    <p className="text-destructive text-xs">
                      {correctedErrors.customer_name.message}
                    </p>
                  )}
                  <Input placeholder="10-digit phone" {...regCorrected("customer_phone")} />
                  {correctedErrors.customer_phone && (
                    <p className="text-destructive text-xs">
                      {correctedErrors.customer_phone.message}
                    </p>
                  )}
                  <Input placeholder="Email (optional)" {...regCorrected("customer_email")} />
                  <Input placeholder="Address (optional)" {...regCorrected("customer_address")} />
                  <Button type="submit" size="sm" variant="destructive" disabled={verdictBusy}>
                    Save Corrections
                  </Button>
                </form>
              </details>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Step 2: Equipment Verification */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <h3 className="text-sm font-semibold">2 — Model / Serial</h3>
          {!canProceedToStep2(verifications?.customer ?? null) ? (
            <p className="text-xs text-muted-foreground">Verify customer first.</p>
          ) : verifications?.equipment ? (
            <>
              <div className="text-xs text-muted-foreground">
                {verifications.equipment.verdict === "matched"
                  ? "✓ Equipment matched"
                  : "✓ Equipment mismatch recorded"}
              </div>
              {verifications.equipment.verdict === "mismatch" && (
                <div className="space-y-1 mt-2">
                  <VerificationDiff
                    label="Model"
                    original={verifications.equipment.original_model}
                    corrected={verifications.equipment.corrected_model}
                    engineer={verifications.equipment.engineer_name}
                    at={verifications.equipment.verified_at}
                    photoPath={verifications.equipment.photo_path}
                  />
                  <VerificationDiff
                    label="Serial No"
                    original={verifications.equipment.original_serial}
                    corrected={verifications.equipment.corrected_serial}
                    engineer={verifications.equipment.engineer_name}
                    at={verifications.equipment.verified_at}
                    photoPath={verifications.equipment.photo_path}
                  />
                </div>
              )}
            </>
          ) : ticket ? (
            <div className="space-y-3">
              <div className="text-xs space-y-1 border rounded-md p-2">
                <p>Model: {ticket.product ?? "—"}</p>
                <p>Serial: {ticket.serial_no ?? "—"}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={verdictBusy}
                  onClick={handleEquipmentMatched}
                >
                  {verdictBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Matched
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={mismatchBusy}
                  onClick={handleMismatchSubmit(handleEquipmentMismatch)}
                >
                  Mismatch
                </Button>
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Report mismatch…</summary>
                <form
                  className="mt-2 space-y-2"
                  onSubmit={handleMismatchSubmit(handleEquipmentMismatch)}
                >
                  <Input placeholder="Correct model" {...regMismatch("corrected_model")} />
                  {mismatchErrors.corrected_model && (
                    <p className="text-destructive text-xs">
                      {mismatchErrors.corrected_model.message}
                    </p>
                  )}
                  <Input placeholder="Correct serial" {...regMismatch("corrected_serial")} />
                  {mismatchErrors.corrected_serial && (
                    <p className="text-destructive text-xs">
                      {mismatchErrors.corrected_serial.message}
                    </p>
                  )}
                  <div>
                    <Label className="text-xs">Photo + GPS required</Label>
                    <Input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="mt-1"
                      onChange={(e) => setMismatchPhotoFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    variant="destructive"
                    disabled={mismatchBusy || !mismatchPhotoFile}
                  >
                    {mismatchBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                    Upload & Record Mismatch
                  </Button>
                </form>
              </details>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Add Note — gated */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <MessageCircle className="h-4 w-4" /> Add Note
          </h3>
          {!canProceedToWork(verifications?.customer ?? null, verifications?.equipment ?? null) ? (
            <p className="text-xs text-muted-foreground">Complete verification first.</p>
          ) : (
            <>
              <Textarea
                placeholder="Type a note…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={3}
                disabled={noteBusy}
              />
              <Button size="sm" disabled={!noteText.trim() || noteBusy} onClick={addNote}>
                {noteBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Add Note
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Photo Upload — gated */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Upload className="h-4 w-4" /> Upload Photo
          </h3>
          {!canProceedToWork(verifications?.customer ?? null, verifications?.equipment ?? null) ? (
            <p className="text-xs text-muted-foreground">Complete verification first.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Max 2 MB · JPEG, PNG, WebP, HEIC</p>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={photoBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {photoBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <Upload className="h-4 w-4 mr-1" />
                  )}
                  {photoProgress || "Choose Photo"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Activity Timeline */}
      {activities.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <h3 className="text-sm font-semibold mb-3">Activity</h3>
            <div className="space-y-3">
              {activities.map((a) => (
                <div key={a.id} className="border-l-2 border-muted pl-3 py-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">{VERIFY_LABEL[a.kind] ?? a.kind}</span>
                    <span>{formatTime(a.created_at)}</span>
                  </div>
                  {a.notes && <p className="text-sm mt-1 whitespace-pre-wrap">{a.notes}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const VERIFY_LABEL: Record<string, string> = {
  customer_verify: "Customer verification",
  equipment_verify: "Equipment verification",
  photo: "Photo",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
