import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth, purgeAuthCaches } from "@/lib/useAuth";
import { useIsEngineer } from "@/lib/useIsEngineer";
import { useMyQueue } from "@/hooks/useMyQueue";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { supabase } from "@/integrations/supabase/client";
import { recordLogout } from "@/lib/useActivityTracker";
import { compressImageToLimit } from "@/lib/image-compress";
import { asEmployeeDocuments } from "@/lib/engineer-conveyance";
import {
  deleteEngineerAttachment,
  saveMyProfile,
  uploadEngineerAttachment,
} from "@/lib/engineer-conveyance.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CardSkeleton } from "@/components/shared/skeletons";
import { Camera, FileText, Loader2, Mail, Phone, LogOut, Trash2 } from "lucide-react";

export const Route = createFileRoute("/eng/profile")({
  component: EngProfile,
});

/** Signed-URL viewer for one engineer-uploads object (photo / document). */
function UploadViewer({
  path,
  render,
}: {
  path: string | null | undefined;
  render: (url: string | null, loading: boolean) => React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    setLoading(true);
    supabase.storage
      .from("engineer-uploads")
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        setUrl(error ? null : (data?.signedUrl ?? null));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return <>{render(url, loading)}</>;
}

function EngProfile() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const { isEngineer, loading: roleLoading } = useIsEngineer();
  const { employee, initials, isLoading: employeeLoading, error: employeeError } = useMyEmployee();
  const { data: tickets = [], isLoading: queueLoading, isError: queueError } = useMyQueue();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [docName, setDocName] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const callUpload = useServerFn(uploadEngineerAttachment);
  const callSaveProfile = useServerFn(saveMyProfile);
  const callDeleteUpload = useServerFn(deleteEngineerAttachment);

  const documents = asEmployeeDocuments(employee?.documents);

  if (roleLoading || employeeLoading || queueLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const email = employee?.email ?? session?.user?.email ?? "—";
  const displayName = employee?.name?.trim() ? employee.name : email;
  const phone = employee?.phone?.trim() ? employee.phone : null;
  const waiting = tickets.filter((t) => t.status === "Waiting for Parts").length;

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      purgeAuthCaches();
      await recordLogout();
      await supabase.auth.signOut();
      navigate({ to: "/auth" });
    } finally {
      setLoggingOut(false);
    }
  };

  async function uploadImage(file: File, kind: "profile_photo" | "document"): Promise<string> {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowed.includes(file.type)) throw new Error("Only JPEG, PNG, WebP, HEIC images allowed");
    const compressed = await compressImageToLimit(file);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(compressed.blob);
    });
    const base64 = dataUrl.split(",")[1];
    if (!base64) throw new Error("Could not read the image");
    const res = await callUpload({
      data: {
        kind,
        filename: compressed.name,
        content_type: compressed.contentType,
        data_base64: base64,
      },
    });
    return res.path;
  }

  async function refreshEmployee() {
    await queryClient.invalidateQueries({ queryKey: ["eng", "employee", uid] });
  }

  async function handlePhotoPick(file: File | null) {
    if (!file) return;
    if (!navigator.onLine) {
      toast.error("No internet connection. Reconnect and retry.");
      return;
    }
    setPhotoBusy(true);
    try {
      const path = await uploadImage(file, "profile_photo");
      const oldPath = employee?.photo_path ?? null;
      await callSaveProfile({ data: { photo_path: path } });
      if (oldPath && oldPath !== path) {
        try {
          await callDeleteUpload({ data: { path: oldPath } });
        } catch (e) {
          console.warn("Old photo cleanup failed:", e);
        }
      }
      toast.success("Profile photo updated");
      if (photoInputRef.current) photoInputRef.current.value = "";
      await refreshEmployee();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleDocAdd() {
    if (docName.trim() === "") {
      toast.error("Enter a document name (e.g. Aadhaar)");
      return;
    }
    if (!docFile) {
      toast.error("Choose the document photo");
      return;
    }
    if (documents.length >= 10) {
      toast.error("Maximum 10 documents");
      return;
    }
    if (!navigator.onLine) {
      toast.error("No internet connection. Reconnect and retry.");
      return;
    }
    setDocBusy(true);
    try {
      const path = await uploadImage(docFile, "document");
      await callSaveProfile({
        data: {
          documents: [
            ...documents.map((d) => ({
              name: d.name,
              path: d.path,
              uploaded_at: d.uploaded_at,
            })),
            { name: docName.trim(), path, uploaded_at: new Date().toISOString() },
          ],
        },
      });
      toast.success("Document uploaded");
      setDocName("");
      setDocFile(null);
      if (docInputRef.current) docInputRef.current.value = "";
      await refreshEmployee();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Document upload failed");
    } finally {
      setDocBusy(false);
    }
  }

  async function handleDocRemove(docPath: string) {
    try {
      await callSaveProfile({
        data: { documents: documents.filter((d) => d.path !== docPath) },
      });
      try {
        await callDeleteUpload({ data: { path: docPath } });
      } catch (e) {
        console.warn("Document file cleanup failed:", e);
      }
      toast.success("Document removed");
      await refreshEmployee();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <UploadViewer
            path={employee?.photo_path}
            render={(url, loading) =>
              url ? (
                <img
                  src={url}
                  alt={`${displayName} profile photo`}
                  className="h-14 w-14 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-11 w-11 shrink-0 rounded-full bg-primary flex items-center justify-center"
                >
                  <span className="text-[15px] font-semibold text-primary-foreground">
                    {loading ? "…" : initials || "–"}
                  </span>
                </span>
              )
            }
          />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[18px] font-semibold truncate">{displayName}</p>
            <p className="text-[13px] text-muted-foreground">
              {isEngineer ? "Field Engineer" : "No engineer role — contact admin"}
            </p>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground truncate">
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{email}</span>
            </p>
            {phone ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <a
                  href={`tel:${phone.replace(/\s+/g, "")}`}
                  className="min-h-[44px] inline-flex items-center underline-offset-2 hover:underline"
                >
                  {phone}
                </a>
              </p>
            ) : null}
            {employeeError || queueError ? (
              <p role="alert" className="text-[13px] text-muted-foreground">
                Some details couldn’t load — showing what’s available.
              </p>
            ) : null}
            <div className="pt-1">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handlePhotoPick(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                disabled={photoBusy}
                onClick={() => photoInputRef.current?.click()}
              >
                {photoBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
                ) : (
                  <Camera className="h-4 w-4 mr-1" aria-hidden />
                )}
                {employee?.photo_path ? "Change photo" : "Add photo"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 grid grid-cols-2 gap-3 text-center">
          <Link
            to="/eng/queue"
            aria-label={`${tickets.length} assigned calls — view queue`}
            className="min-h-[44px] flex flex-col items-center justify-center rounded-md"
          >
            <p className="text-[20px] font-semibold tabular-nums">{tickets.length}</p>
            <p className="text-xs text-muted-foreground">Assigned calls</p>
          </Link>
          <Link
            to="/eng/queue"
            aria-label={`${waiting} waiting for parts — view queue`}
            className="min-h-[44px] flex flex-col items-center justify-center rounded-md"
          >
            <p className="text-[20px] font-semibold tabular-nums">{waiting}</p>
            <p className="text-xs text-muted-foreground">Waiting for Parts</p>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold">
            <FileText className="h-4 w-4" aria-hidden /> Documents
          </p>
          {documents.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              No documents yet — upload your Aadhaar and others below.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {documents.map((d) => (
                <li
                  key={d.path}
                  className="flex min-h-[44px] items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.name}</span>
                  <UploadViewer
                    path={d.path}
                    render={(url) =>
                      url ? (
                        <a
                          className="text-xs underline underline-offset-2"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">Unavailable</span>
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-[44px] min-w-[44px] shrink-0"
                    aria-label={`Remove ${d.name}`}
                    onClick={() => handleDocRemove(d.path)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2 rounded-xl border border-border p-3">
            <div>
              <Label className="text-xs">Document name</Label>
              <Input
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="e.g. Aadhaar, Driving licence"
                className="mt-1 h-11 min-h-[44px]"
                aria-label="Document name"
              />
            </div>
            <div>
              <input
                ref={docInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] w-full"
                disabled={docBusy}
                onClick={() => docInputRef.current?.click()}
              >
                <Camera className="h-4 w-4 mr-1" aria-hidden />
                {docFile ? docFile.name : "Choose document photo"}
              </Button>
            </div>
            <Button className="min-h-[44px] w-full" disabled={docBusy} onClick={handleDocAdd}>
              {docBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden /> : null}
              Upload document
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center px-4">
        Read-only portal. Status changes, reassignment and closures are handled by Services and
        Admin.
      </p>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="w-full min-h-[44px] h-auto" disabled={loggingOut}>
            <LogOut className="h-4 w-4" /> {loggingOut ? "Logging out…" : "Log out"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out?</AlertDialogTitle>
            <AlertDialogDescription>
              You’ll be signed out of the engineer portal on this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Stay signed in</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} className="min-h-[44px]">
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
