import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";
import { PageLoader } from "@/components/shared/skeletons";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { STATUS_COLOR, PRIORITY_COLOR } from "@/lib/tickets";
import { toast } from "sonner";
import { ArrowLeft, Upload, Loader2, MessageCircle } from "lucide-react";

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

  // Note form
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const noteIdempotencyRef = useRef("");

  // Photo upload
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoProgress, setPhotoProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [tkRes, actRes] = await Promise.all([
        supabase
          .from("tickets")
          .select(
            "id,case_id,call_type,product,serial_no,customer_name,customer_phone,location,complaint,status,priority,special_instruction,special_instruction_acknowledged,created_at",
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
      if (tkRes.data) setTicket(tkRes.data as Ticket);
      setActivities((actRes.data || []) as Activity[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

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
      // Refresh activities
      const { data: actRes } = await supabase
        .from("ticket_activities")
        .select("id,kind,notes,created_at,actor")
        .eq("ticket_id", id)
        .order("created_at", { ascending: false });
      setActivities((actRes || []) as Activity[]);
    } finally {
      setNoteBusy(false);
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
      // Refresh activities
      const { data: actRes } = await supabase
        .from("ticket_activities")
        .select("id,kind,notes,created_at,actor")
        .eq("ticket_id", id)
        .order("created_at", { ascending: false });
      setActivities((actRes || []) as Activity[]);
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
              className={`border rounded-md p-3 text-sm ${ticket.special_instruction_acknowledged ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}
            >
              <span className="font-medium text-xs">Special Instructions:</span>
              <p className="mt-1 whitespace-pre-wrap">{ticket.special_instruction}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Note */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <MessageCircle className="h-4 w-4" /> Add Note
          </h3>
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
        </CardContent>
      </Card>

      {/* Photo Upload */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Upload className="h-4 w-4" /> Upload Photo
          </h3>
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
                    <span className="font-medium capitalize">{a.kind}</span>
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
