import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { verificationKeys } from "@/lib/queryKeys";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { PageLoader, CardSkeleton } from "@/components/shared/skeletons";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FieldServiceReport } from "@/components/FieldServiceReport";
import { VerificationStepper } from "@/components/VerificationStepper";
import { VerificationDiff } from "@/components/VerificationDiff";
import { VisitTimesBar } from "@/components/eng/VisitTimesBar";
import { TicketTimeline } from "@/components/eng/TicketTimeline";
import { useTicketVerifications } from "@/hooks/useTicketVerifications";
import { useFieldServiceReport } from "@/hooks/useFieldServiceReport";
import {
  buildCustomerSnapshot,
  buildEquipmentOriginal,
  customerPerFieldSchema,
  equipmentPerFieldSchema,
  resolveCustomerCorrection,
  resolveEquipmentCorrection,
  canProceedToStep2,
  canProceedToWork,
} from "@/lib/ticket-verifications";
import { getCurrentGeo, validateGeoForMismatch } from "@/lib/verification-geo";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  Loader2,
  MessageCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ShieldAlert,
  Phone,
} from "lucide-react";
import { compressImageToLimit } from "@/lib/image-compress";
import { PASSWORD_CHANGE_REQUIRED } from "@/lib/account-gate";

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
  customer_id: string | null;
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
  const queryClient = useQueryClient();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string | null>(null);
  const [guardError, setGuardError] = useState<string | null>(null);

  function isPasswordChangeRequired(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const e = err as Record<string, any>;
    if (e.code === PASSWORD_CHANGE_REQUIRED) return true;
    if (e.statusCode === 401 && /password change required/i.test(e.message ?? "")) return true;
    return false;
  }

  function triggerPasswordChangeDialog() {
    window.dispatchEvent(new CustomEvent("eng:password-change-required"));
  }

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
  const { data: verifications, isLoading: verifLoading } = useTicketVerifications(id);
  const { data: fsrRows } = useFieldServiceReport(id);
  const [verdictBusy, setVerdictBusy] = useState(false);
  const [verdictBusy2, setVerdictBusy2] = useState(false);
  const [mismatchPhotoFile, setMismatchPhotoFile] = useState<File | null>(null);
  const [mismatchBusy, setMismatchBusy] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsMismatchOpen, setDetailsMismatchOpen] = useState(false);
  const mismatchFileInputRef = useRef<HTMLInputElement>(null);

  // Step 1 forms — per-field Name / Phone toggles (mirrors equipment pattern)
  const {
    register: regCorrected,
    handleSubmit: handleCorrectedSubmit,
    formState: { errors: correctedErrors },
    reset: resetCorrected,
    watch: watchCorrected,
    setValue: setCorrectedValue,
  } = useForm({
    resolver: zodResolver(customerPerFieldSchema),
    defaultValues: {
      nameIncorrect: false,
      phoneIncorrect: false,
      nameInput: ticket?.customer_name ?? "",
      phoneInput: ticket?.customer_phone ?? "",
      email: "",
      address: "",
      sector: "",
      location: "",
    },
  });
  const nameIncorrect = watchCorrected("nameIncorrect") ?? false;
  const phoneIncorrect = watchCorrected("phoneIncorrect") ?? false;

  // Prefill per-field customer inputs when async ticket arrives
  useEffect(() => {
    if (ticket) {
      resetCorrected({
        nameIncorrect: false,
        phoneIncorrect: false,
        nameInput: ticket.customer_name ?? "",
        phoneInput: ticket.customer_phone ?? "",
        email: "",
        address: "",
        sector: "",
        location: "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.customer_name, ticket?.customer_phone]);

  // Step 2 form — per-field Model / Serial toggles
  const {
    register: regMismatch,
    handleSubmit: handleMismatchSubmit,
    formState: { errors: mismatchErrors },
    reset: resetMismatch,
    watch: watchMismatch,
    setValue: setMismatchValue,
  } = useForm({
    resolver: zodResolver(equipmentPerFieldSchema),
    defaultValues: {
      modelIncorrect: false,
      serialIncorrect: false,
      modelInput: ticket?.product ?? "",
      serialInput: ticket?.serial_no ?? "",
    },
  });
  const modelIncorrect = watchMismatch("modelIncorrect") ?? false;
  const serialIncorrect = watchMismatch("serialIncorrect") ?? false;

  // Prefill per-field inputs when async ticket arrives
  useEffect(() => {
    if (ticket) {
      resetMismatch({
        modelIncorrect: false,
        serialIncorrect: false,
        modelInput: ticket.product ?? "",
        serialInput: ticket.serial_no ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.product, ticket?.serial_no]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [tkRes, actRes] = await Promise.all([
        supabase
          .from("tickets")
          .select(
            "id,case_id,call_type,product,serial_no,customer_name,customer_phone,customer_id,customer_email,customer_address,sector,location,complaint,status,priority,assigned_employee_id,assigned_engineer_name,special_instruction,special_instruction_acknowledged,created_at",
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
      // PGRST116 = genuine no-row (.single() found nothing) → "not found" path.
      // Any other fetch error → real error card with Retry.
      const tkErr = tkRes.error as { code?: string; message?: string } | null;
      if (tkErr && tkErr.code !== "PGRST116") {
        setLoadError(tkErr.message ?? "Failed to load ticket.");
      } else {
        setLoadError(null);
      }
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
    if (!navigator.onLine) {
      toast.error("You're offline — note will not be saved");
      return;
    }
    const text = noteText.trim();
    if (!text) return;

    const bucket = `${id}:${Math.floor(Date.now() / 60_000)}`;
    if (noteIdempotencyRef.current === bucket) {
      toast.info("Note already recorded");
      return;
    }
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
          customer_id: ticket?.customer_id ?? null,
          verdict: "verified",
          snapshot,
          engineer_employee_id: myId,
          engineer_name: actorName,
        },
        { onConflict: "ticket_id" },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      try {
        await supabase.from("ticket_activities").insert({
          ticket_id: id,
          kind: "customer_verify",
          notes: `Customer verified by ${actorName} at ${new Date().toISOString()}`,
          actor: u.user?.id ?? null,
        } as never);
      } catch (actErr) {
        console.warn("Activity insert failed:", actErr);
      }
      toast.success("Customer details verified");
      resetCorrected();
      await queryClient.invalidateQueries({ queryKey: verificationKeys.detail(id) });
      await refreshActivities();
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
      const snapshot = buildCustomerSnapshot(ticket!);
      const { error } = await supabase.from("ticket_customer_verifications").upsert(
        {
          ticket_id: id,
          customer_id: ticket?.customer_id ?? null,
          verdict: "incorrect",
          snapshot,
          corrected: data,
          engineer_employee_id: myId,
          engineer_name: actorName,
        },
        { onConflict: "ticket_id" },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      try {
        await supabase.from("ticket_activities").insert({
          ticket_id: id,
          kind: "customer_verify",
          notes: `Customer corrected by ${actorName} at ${new Date().toISOString()}`,
          actor: u.user?.id ?? null,
        } as never);
      } catch (actErr) {
        console.warn("Activity insert failed:", actErr);
      }
      toast.success("Customer details corrected");
      await queryClient.invalidateQueries({ queryKey: verificationKeys.detail(id) });
      await refreshActivities();
    } finally {
      setVerdictBusy(false);
    }
  };

  const handlePerFieldCustomer = async (data: {
    nameIncorrect: boolean;
    phoneIncorrect: boolean;
    nameInput?: string;
    phoneInput?: string;
    email?: string | null;
    address?: string | null;
    sector?: string | null;
    location?: string | null;
  }) => {
    const resolved = resolveCustomerCorrection(buildCustomerSnapshot(ticket!), data);
    await handleCustomerIncorrect(resolved.corrected);
  };

  const handleEquipmentMismatch = async (data: {
    corrected_model: string | null;
    corrected_serial: string | null;
  }) => {
    if (!navigator.onLine) {
      toast.error("No internet connection. Reconnect and retry — nothing was uploaded.");
      return;
    }
    if (!mismatchPhotoFile) {
      toast.error("Photo is required for mismatch report");
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowed.includes(mismatchPhotoFile.type)) {
      toast.error("Only JPEG, PNG, WebP, HEIC images allowed");
      return;
    }
    setMismatchBusy(true);
    setGpsError(null);
    try {
      const geo = await getCurrentGeo();
      const geoErr = validateGeoForMismatch(geo);
      if (geoErr) {
        setGpsError(geoErr);
        toast.error(geoErr);
        return;
      }

      const compressed = await compressImageToLimit(mismatchPhotoFile);

      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(compressed.blob);
      });
      const base64 = dataUrl.split(",")[1];

      const { uploadPublicTicketAttachment } =
        await import("@/lib/public-ticket-uploads.functions");
      const uploadResult = await uploadPublicTicketAttachment({
        data: {
          ticket_id: id,
          filename: compressed.name,
          content_type: compressed.contentType,
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

      const { data: existingVer } = await supabase
        .from("ticket_equipment_verifications")
        .select("photo_path")
        .eq("ticket_id", id)
        .maybeSingle();
      const oldPhotoPath = (existingVer?.photo_path as string | null) ?? null;

      const { error } = await supabase.from("ticket_equipment_verifications").upsert(
        {
          ticket_id: id,
          verdict: "mismatch",
          original_model: original.original_model,
          original_serial: original.original_serial,
          corrected_model: data.corrected_model,
          corrected_serial: data.corrected_serial,
          photo_path: uploadResult.path,
          photo_lat: geo!.lat,
          photo_long: geo!.long,
          photo_accuracy: geo!.accuracy,
          photo_captured_at: geo!.captured_at,
          engineer_employee_id: myId,
          engineer_name: actorName,
        },
        { onConflict: "ticket_id" },
      );
      if (error) {
        try {
          await supabase.storage.from("ticket-attachments").remove([uploadResult.path]);
        } catch (cleanupErr) {
          console.warn("Photo cleanup failed:", cleanupErr);
        }
        toast.error(error.message);
        return;
      }
      if (oldPhotoPath && oldPhotoPath !== uploadResult.path) {
        try {
          await supabase.storage.from("ticket-attachments").remove([oldPhotoPath]);
        } catch (cleanupErr) {
          console.warn("Old photo cleanup failed:", cleanupErr);
        }
      }
      try {
        await supabase.from("ticket_activities").insert({
          ticket_id: id,
          kind: "equipment_verify",
          notes: `Equipment mismatch reported by ${actorName} at ${new Date().toISOString()}`,
          actor: u.user?.id ?? null,
        } as never);
      } catch (actErr) {
        console.warn("Activity insert failed:", actErr);
      }
      toast.success("Equipment mismatch recorded");
      setMismatchPhotoFile(null);
      resetMismatch({
        modelIncorrect: false,
        serialIncorrect: false,
        modelInput: ticket?.product ?? "",
        serialInput: ticket?.serial_no ?? "",
      });
      await queryClient.invalidateQueries({ queryKey: verificationKeys.detail(id) });
      await refreshActivities();
    } catch (err) {
      if (isPasswordChangeRequired(err)) {
        triggerPasswordChangeDialog();
        return;
      }
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
      setMismatchPhotoFile(null);
    } finally {
      setMismatchBusy(false);
    }
  };

  const handlePerFieldMismatch = async (data: {
    modelIncorrect: boolean;
    serialIncorrect: boolean;
    modelInput?: string;
    serialInput?: string;
  }) => {
    const resolved = resolveEquipmentCorrection(
      { model: ticket?.product ?? null, serial: ticket?.serial_no ?? null },
      data,
    );
    await handleEquipmentMismatch({
      corrected_model: resolved.corrected_model,
      corrected_serial: resolved.corrected_serial,
    });
  };

  const handleEquipmentMatched = async () => {
    setVerdictBusy2(true);
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
          engineer_employee_id: myId,
          engineer_name: actorName,
        },
        { onConflict: "ticket_id" },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      try {
        await supabase.from("ticket_activities").insert({
          ticket_id: id,
          kind: "equipment_verify",
          notes: `Equipment verified matched by ${actorName} at ${new Date().toISOString()}`,
          actor: u.user?.id ?? null,
        } as never);
      } catch (actErr) {
        console.warn("Activity insert failed:", actErr);
      }
      toast.success("Equipment verified as matched");
      await queryClient.invalidateQueries({ queryKey: verificationKeys.detail(id) });
      await refreshActivities();
    } finally {
      setVerdictBusy2(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!navigator.onLine) {
      toast.error("No internet connection. Reconnect and retry — nothing was uploaded.");
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
      const compressed = await compressImageToLimit(file);

      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(compressed.blob);
      });

      const base64 = dataUrl.split(",")[1];
      const ext =
        (compressed.name.split(".").pop() || "jpg")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 5) || "jpg";
      const safeName = `issue-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const path = `ticket/${id}/${new Date().toISOString().slice(0, 10)}/${safeName}`;

      setPhotoProgress("Uploading…");

      const { uploadPublicTicketAttachment } =
        await import("@/lib/public-ticket-uploads.functions");
      await uploadPublicTicketAttachment({
        data: {
          ticket_id: id,
          filename: compressed.name,
          content_type: compressed.contentType,
          kind: "issue_photo",
          data_base64: base64,
        },
      });

      // Log the upload as an activity
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("ticket_activities").insert({
        ticket_id: id,
        kind: "photo",
        notes: `Photo uploaded: ${compressed.name}`,
        actor: u.user?.id ?? null,
      } as never);

      toast.success("Photo uploaded");
      await refreshActivities();
    } catch (err) {
      if (isPasswordChangeRequired(err)) {
        triggerPasswordChangeDialog();
        return;
      }
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast.error(msg);
    } finally {
      setPhotoBusy(false);
      setPhotoProgress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) return <PageLoader label="Loading ticket…" />;
  if (!ticket && loadError)
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-700" />
            <p className="font-semibold text-base">Couldn't load this ticket</p>
            <p className="text-[13px] text-muted-foreground">{loadError}</p>
            <Button className="min-h-11" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
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
            <ShieldAlert className="h-10 w-10 mx-auto text-amber-700" />
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
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-[44px] py-3 -my-1"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Queue
      </Link>

      {/* Header — case id, status/priority, customer + tap-to-call, location, complaint, ack */}
      <Card className="rounded-xl">
        <CardContent className="space-y-3 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Ticket workspace
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-semibold text-lg">{ticket.case_id}</span>
            {ticket.priority && (
              <StatusBadge
                tone={
                  ticket.priority === "P1"
                    ? "danger"
                    : ticket.priority === "P2"
                      ? "warning"
                      : ticket.priority === "P3" || ticket.priority === "P4"
                        ? "info"
                        : "neutral"
                }
              >
                {ticket.priority}
              </StatusBadge>
            )}
            <StatusBadge
              tone={
                ticket.status === "Closed"
                  ? "success"
                  : ticket.status === "Cancelled"
                    ? "danger"
                    : ticket.status === "In Progress"
                      ? "info"
                      : ticket.status === "New" || ticket.status === "Call Log"
                        ? "neutral"
                        : "warning"
              }
            >
              {ticket.status}
            </StatusBadge>
            <span className="text-xs text-muted-foreground">{ticket.call_type}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Customer</span>
              <p className="font-medium">{ticket.customer_name}</p>
              {ticket.customer_phone && (
                <Button asChild className="min-h-[44px] w-full sm:w-auto mt-2">
                  <a href={`tel:${ticket.customer_phone}`}>
                    <Phone className="h-4 w-4" /> Call {ticket.customer_phone}
                  </a>
                </Button>
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
              className={`rounded-xl border p-4 text-sm ${isSpecialAcked ? "border-emerald-700/20 bg-emerald-500/10 text-emerald-700" : "border-amber-700/20 bg-amber-500/10 text-amber-700"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-xs">Special Instructions:</span>
                {isSpecialAcked ? (
                  <span className="inline-flex min-h-[44px] items-center gap-1 text-xs text-emerald-700 font-medium">
                    <CheckCircle2 className="h-4 w-4" /> Acknowledged
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-[44px] px-4 text-sm"
                    disabled={ackBusy}
                    onClick={acknowledgeInstruction}
                  >
                    {ackBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 mr-1" />
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

      {/* Sticky stepper + visit times */}
      <div className="sticky top-0 z-20 -mx-4 space-y-3 px-4 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <VerificationStepper
          step1Done={!!verifications?.customer}
          step2Done={!!verifications?.equipment}
          step3Done={(fsrRows?.length ?? 0) > 0}
        />
        <VisitTimesBar ticketId={id} />
      </div>

      {/* Step 1: Customer — numbered section with done state */}
      <Card className="rounded-xl">
        <CardContent className="space-y-3 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Step 1 of 3
          </p>
          <h3 className="text-[15px] font-semibold">Customer details</h3>
          {verifLoading ? (
            <CardSkeleton />
          ) : verifications?.customer ? (
            <>
              <div className="flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-emerald-700">
                <Check className="h-4 w-4" aria-hidden />
                {verifications.customer.verdict === "verified"
                  ? "Customer details verified"
                  : "Customer details corrected"}
              </div>
              {verifications.customer.verdict === "incorrect" &&
                verifications.customer.snapshot &&
                verifications.customer.corrected && (
                  <div className="space-y-3 mt-2">
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
                  className="min-h-[44px] flex-1"
                  variant="outline"
                  disabled={verdictBusy}
                  onClick={handleCustomerVerified}
                >
                  {verdictBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Details Verified
                </Button>
                <Button
                  className="min-h-[44px] flex-1"
                  variant="secondary"
                  disabled={verdictBusy}
                  onClick={() => {
                    setDetailsOpen(true);
                  }}
                >
                  Details Incorrect
                </Button>
              </div>
              <Drawer open={detailsOpen} onOpenChange={setDetailsOpen}>
                <DrawerContent className="max-h-[90vh] overflow-y-auto pb-safe">
                  <DrawerHeader>
                    <DrawerTitle>Correct customer details</DrawerTitle>
                    <DrawerDescription>
                      Mark each field correct or enter the corrected value.
                    </DrawerDescription>
                  </DrawerHeader>
                  <form
                    className="space-y-3 px-4"
                    onSubmit={handleCorrectedSubmit(handlePerFieldCustomer)}
                  >
                    <div className="space-y-1 border rounded-md p-2">
                      <p className="font-medium">Name</p>
                      <RadioGroup
                        role="radiogroup"
                        aria-label="Name accuracy"
                        value={nameIncorrect ? "needs-correction" : "correct"}
                        onValueChange={(v) =>
                          setCorrectedValue("nameIncorrect", v === "needs-correction")
                        }
                        className="flex gap-2"
                      >
                        <Label
                          className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs focus-within:ring-2 focus-within:ring-ring/30"
                          onClick={() => setCorrectedValue("nameIncorrect", false)}
                        >
                          <RadioGroupItem value="correct" />
                          Correct
                        </Label>
                        <Label
                          className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs focus-within:ring-2 focus-within:ring-ring/30"
                          onClick={() => setCorrectedValue("nameIncorrect", true)}
                        >
                          <RadioGroupItem value="needs-correction" />
                          Needs correction
                        </Label>
                      </RadioGroup>
                      {nameIncorrect && (
                        <Input
                          className="h-11"
                          placeholder="Correct name"
                          aria-label="Correct name"
                          {...regCorrected("nameInput")}
                        />
                      )}
                      {correctedErrors.nameInput && (
                        <p className="text-destructive text-xs">
                          {correctedErrors.nameInput.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1 border rounded-md p-2">
                      <p className="font-medium">Phone</p>
                      <RadioGroup
                        role="radiogroup"
                        aria-label="Phone accuracy"
                        value={phoneIncorrect ? "needs-correction" : "correct"}
                        onValueChange={(v) =>
                          setCorrectedValue("phoneIncorrect", v === "needs-correction")
                        }
                        className="flex gap-2"
                      >
                        <Label
                          className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs focus-within:ring-2 focus-within:ring-ring/30"
                          onClick={() => setCorrectedValue("phoneIncorrect", false)}
                        >
                          <RadioGroupItem value="correct" />
                          Correct
                        </Label>
                        <Label
                          className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs focus-within:ring-2 focus-within:ring-ring/30"
                          onClick={() => setCorrectedValue("phoneIncorrect", true)}
                        >
                          <RadioGroupItem value="needs-correction" />
                          Needs correction
                        </Label>
                      </RadioGroup>
                      {phoneIncorrect && (
                        <Input
                          className="h-11"
                          placeholder="Correct 10-digit phone"
                          aria-label="Correct phone"
                          {...regCorrected("phoneInput")}
                        />
                      )}
                      {correctedErrors.phoneInput && (
                        <p className="text-destructive text-xs">
                          {correctedErrors.phoneInput.message}
                        </p>
                      )}
                    </div>
                    {correctedErrors.nameIncorrect && (
                      <p className="text-destructive text-xs">
                        {correctedErrors.nameIncorrect.message}
                      </p>
                    )}
                    <Input
                      className="h-11"
                      placeholder="Email (optional)"
                      {...regCorrected("email")}
                    />
                    {correctedErrors.email && (
                      <p className="text-destructive text-xs">{correctedErrors.email.message}</p>
                    )}
                    <Input
                      className="h-11"
                      placeholder="Address (optional)"
                      {...regCorrected("address")}
                    />
                    <Input
                      className="h-11"
                      placeholder="Sector (optional)"
                      {...regCorrected("sector")}
                    />
                    <Input
                      className="h-11"
                      placeholder="Location (optional)"
                      {...regCorrected("location")}
                    />
                    <DrawerFooter className="px-0">
                      <Button
                        type="submit"
                        className="min-h-[44px]"
                        variant="secondary"
                        disabled={verdictBusy}
                      >
                        Save Corrections
                      </Button>
                      <DrawerClose asChild>
                        <Button type="button" variant="outline" className="min-h-[44px]">
                          Cancel
                        </Button>
                      </DrawerClose>
                    </DrawerFooter>
                  </form>
                </DrawerContent>
              </Drawer>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Step 2: Model / Serial — numbered section with done state */}
      <Card className="rounded-xl">
        <CardContent className="space-y-3 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Step 2 of 3
          </p>
          <h3 className="text-[15px] font-semibold">Model / Serial</h3>
          {verifLoading ? (
            <CardSkeleton />
          ) : !canProceedToStep2(verifications?.customer ?? null) ? (
            <p className="text-xs text-muted-foreground">Verify customer first.</p>
          ) : verifications?.equipment ? (
            <>
              <div className="flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-emerald-700">
                <Check className="h-4 w-4" aria-hidden />
                {verifications.equipment.verdict === "matched"
                  ? "Equipment matched"
                  : "Equipment mismatch recorded"}
              </div>
              {verifications.equipment.verdict === "mismatch" && (
                <div className="space-y-3 mt-2">
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
                  className="min-h-[44px] flex-1"
                  variant="outline"
                  disabled={verdictBusy2}
                  onClick={handleEquipmentMatched}
                >
                  {verdictBusy2 ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Matched
                </Button>
                <Button
                  className="min-h-[44px] flex-1"
                  variant="secondary"
                  disabled={mismatchBusy}
                  onClick={() => {
                    setDetailsMismatchOpen(true);
                  }}
                >
                  Mismatch
                </Button>
              </div>
              <Drawer open={detailsMismatchOpen} onOpenChange={setDetailsMismatchOpen}>
                <DrawerContent className="max-h-[90vh] overflow-y-auto pb-safe">
                  <DrawerHeader>
                    <DrawerTitle>Report equipment mismatch</DrawerTitle>
                    <DrawerDescription>
                      Mark each field correct or enter the corrected value, then add a photo.
                    </DrawerDescription>
                  </DrawerHeader>
                  <form
                    className="space-y-3 px-4"
                    onSubmit={handleMismatchSubmit(handlePerFieldMismatch)}
                  >
                    <div className="space-y-1 border rounded-md p-2">
                      <p className="font-medium">Model</p>
                      <RadioGroup
                        role="radiogroup"
                        aria-label="Model accuracy"
                        value={modelIncorrect ? "needs-correction" : "correct"}
                        onValueChange={(v) =>
                          setMismatchValue("modelIncorrect", v === "needs-correction")
                        }
                        className="flex gap-2"
                      >
                        <Label
                          className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs focus-within:ring-2 focus-within:ring-ring/30"
                          onClick={() => setMismatchValue("modelIncorrect", false)}
                        >
                          <RadioGroupItem value="correct" />
                          Correct
                        </Label>
                        <Label
                          className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs focus-within:ring-2 focus-within:ring-ring/30"
                          onClick={() => setMismatchValue("modelIncorrect", true)}
                        >
                          <RadioGroupItem value="needs-correction" />
                          Needs correction
                        </Label>
                      </RadioGroup>
                      {modelIncorrect && (
                        <Input
                          className="h-11"
                          placeholder="Correct model"
                          aria-label="Correct model"
                          {...regMismatch("modelInput")}
                        />
                      )}
                      {mismatchErrors.modelInput && (
                        <p className="text-destructive text-xs">
                          {mismatchErrors.modelInput.message}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1 border rounded-md p-2">
                      <p className="font-medium">Serial</p>
                      <RadioGroup
                        role="radiogroup"
                        aria-label="Serial accuracy"
                        value={serialIncorrect ? "needs-correction" : "correct"}
                        onValueChange={(v) =>
                          setMismatchValue("serialIncorrect", v === "needs-correction")
                        }
                        className="flex gap-2"
                      >
                        <Label
                          className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs focus-within:ring-2 focus-within:ring-ring/30"
                          onClick={() => setMismatchValue("serialIncorrect", false)}
                        >
                          <RadioGroupItem value="correct" />
                          Correct
                        </Label>
                        <Label
                          className="flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs focus-within:ring-2 focus-within:ring-ring/30"
                          onClick={() => setMismatchValue("serialIncorrect", true)}
                        >
                          <RadioGroupItem value="needs-correction" />
                          Needs correction
                        </Label>
                      </RadioGroup>
                      {serialIncorrect && (
                        <Input
                          className="h-11"
                          placeholder="Correct serial"
                          aria-label="Correct serial"
                          {...regMismatch("serialInput")}
                        />
                      )}
                      {mismatchErrors.serialInput && (
                        <p className="text-destructive text-xs">
                          {mismatchErrors.serialInput.message}
                        </p>
                      )}
                    </div>
                    {mismatchErrors.modelIncorrect && (
                      <p className="text-destructive text-xs">
                        {mismatchErrors.modelIncorrect.message}
                      </p>
                    )}
                    {gpsError && <p className="text-destructive text-xs">{gpsError}</p>}
                    <div>
                      <Label className="text-xs">Photo + GPS required</Label>
                      <input
                        ref={mismatchFileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => setMismatchPhotoFile(e.target.files?.[0] ?? null)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-1 min-h-[44px] w-full"
                        onClick={() => mismatchFileInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4 mr-1" />
                        {mismatchPhotoFile ? mismatchPhotoFile.name : "Choose Photo"}
                      </Button>
                    </div>
                    <DrawerFooter className="px-0">
                      <Button
                        type="submit"
                        className="min-h-[44px]"
                        variant="secondary"
                        disabled={
                          mismatchBusy ||
                          !mismatchPhotoFile ||
                          (!modelIncorrect && !serialIncorrect)
                        }
                      >
                        {mismatchBusy ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        Upload & Record Mismatch
                      </Button>
                      {(!mismatchPhotoFile || (!modelIncorrect && !serialIncorrect)) && (
                        <p className="text-xs text-muted-foreground">
                          Photo + at least one corrected field are required
                        </p>
                      )}
                      <DrawerClose asChild>
                        <Button type="button" variant="outline" className="min-h-[44px]">
                          Cancel
                        </Button>
                      </DrawerClose>
                    </DrawerFooter>
                  </form>
                </DrawerContent>
              </Drawer>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Step 3: Work — numbered section */}
      <Card className="rounded-xl">
        <CardContent className="space-y-3 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Step 3 of 3
          </p>
          <h3 className="text-[15px] font-semibold">Field Service Report</h3>
          {verifLoading ? (
            <CardSkeleton />
          ) : !canProceedToWork(
              verifications?.customer ?? null,
              verifications?.equipment ?? null,
            ) ? (
            <p className="text-xs text-muted-foreground">Complete verification first.</p>
          ) : (
            <FieldServiceReport ticketId={id} />
          )}
        </CardContent>
      </Card>

      {/* Activity composer — notes + photo merged, gated */}
      <Card className="rounded-xl">
        <CardContent className="space-y-3 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Field update
          </p>
          <h3 className="text-[15px] font-semibold flex items-center gap-1.5">
            <MessageCircle className="h-4 w-4" /> Activity composer
          </h3>
          {verifLoading ? (
            <CardSkeleton />
          ) : !canProceedToWork(
              verifications?.customer ?? null,
              verifications?.equipment ?? null,
            ) ? (
            <p className="text-xs text-muted-foreground">Complete verification first.</p>
          ) : (
            <>
              <div className="space-y-3">
                <Textarea
                  placeholder="Type a note…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                  disabled={noteBusy}
                />
                <Button
                  size="sm"
                  className="min-h-[44px]"
                  disabled={!noteText.trim() || noteBusy}
                  onClick={addNote}
                >
                  {noteBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Add Note
                </Button>
              </div>
              <div className="border-t border-border pt-3 space-y-3">
                <h4 className="text-sm font-semibold flex items-center gap-1.5">
                  <Upload className="h-4 w-4" /> Upload Photo
                </h4>
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
                    className="min-h-[44px] min-w-[160px]"
                    disabled={photoBusy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {photoBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Upload className="h-4 w-4 mr-1" />
                    )}
                    Choose Photo
                  </Button>
                  {photoProgress && (
                    <p className="text-xs text-muted-foreground">{photoProgress}</p>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Activity timeline via shared component (arrival/departure/signature icons + labels built in) */}
      <TicketTimeline
        activities={activities.map((a) => ({
          id: a.id,
          kind: a.kind,
          createdAt: a.created_at,
          message: a.notes,
          actor: a.actor,
        }))}
      />
    </div>
  );
}
