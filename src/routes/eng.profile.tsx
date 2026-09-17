import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { reportDbError } from "@/lib/format-error";
import { useAuth, purgeAuthCaches } from "@/lib/useAuth";
import { useIsEngineer } from "@/lib/useIsEngineer";
import { useMyQueue } from "@/hooks/useMyQueue";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { supabase } from "@/integrations/supabase/client";
import { engKeys } from "@/lib/queryKeys";
import { recordLogout } from "@/lib/useActivityTracker";
import { compressImageToLimit } from "@/lib/image-compress";
import { MAX_ACCEPTED_BYTES, acceptedUploadMessage } from "@/lib/upload-limits";
import { asEmployeeDocuments, findDocByName, PROFILE_DOC_TYPES } from "@/lib/engineer-conveyance";
import type { ProfileDocType } from "@/lib/engineer-conveyance";
import {
  deleteEngineerAttachment,
  saveMyProfile,
  uploadEngineerAttachment,
} from "@/lib/engineer-conveyance.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Camera, FileText, Loader2, Mail, Phone, LogOut } from "lucide-react";

export const Route = createFileRoute("/eng/profile")({
  component: EngProfile,
});

/** Signed-URL viewer for one engineer-uploads object (photo / document). */
function UploadViewer({
  path,
  render,
  cache,
}: {
  path: string | null | undefined;
  render: (url: string | null, loading: boolean) => React.ReactNode;
  cache?: { current: Map<string, { url: string; expiresAt: number }> };
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    const cached = cache?.current.get(path);
    if (cached) {
      if (cached.expiresAt <= Date.now()) {
        cache?.current.delete(path);
      } else {
        setUrl(cached.url);
        return;
      }
    }
    setLoading(true);
    supabase.storage
      .from("engineer-uploads")
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        const signedUrl = error ? null : (data?.signedUrl ?? null);
        if (signedUrl)
          cache?.current.set(path, { url: signedUrl, expiresAt: Date.now() + 3500 * 1000 });
        setUrl(signedUrl);
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
  }, [path, cache]);
  return <>{render(url, loading)}</>;
}

function EngProfile() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const { loading: roleLoading } = useIsEngineer();
  const { employee, initials, isLoading: employeeLoading, error: employeeError } = useMyEmployee();
  const { data: tickets = [], isLoading: queueLoading, isError: queueError } = useMyQueue();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const pendingBlockRef = useRef<ProfileDocType | null>(null);
  const [busyBlock, setBusyBlock] = useState<ProfileDocType | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const blockInputRef = useRef<HTMLInputElement>(null);
  const photoBusyRef = useRef(false);
  const blockBusyRef = useRef(false);
  const signedUrlCacheRef = useRef(new Map<string, { url: string; expiresAt: number }>());
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

  async function uploadImage(file: File, kind: "profile_photo" | "document", label?: string): Promise<string> {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!allowed.includes(file.type)) throw new Error("Only JPEG, PNG, WebP, HEIC images allowed");
    const compressed = await compressImageToLimit(
      file,
      kind === "document" ? { preset: "document" } : undefined,
    );
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
        ...(kind === "document" ? { label } : {}),
        filename: compressed.name,
        content_type: compressed.contentType,
        data_base64: base64,
      },
    });
    return res.path;
  }

  async function refreshEmployee() {
    await queryClient.invalidateQueries({ queryKey: engKeys.employee(uid) });
  }

  async function handlePhotoPick(file: File | null) {
    if (!file) return;
    if (photoBusy || photoBusyRef.current) return;
    if (file.size > MAX_ACCEPTED_BYTES) {
      toast.error(acceptedUploadMessage());
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    photoBusyRef.current = true;
    if (!navigator.onLine) {
      toast.error("No internet connection. Reconnect and retry.");
      photoBusyRef.current = false;
      return;
    }
    const oldPath = employee?.photo_path ?? null;
    setPhotoBusy(true);
    try {
      const path = await uploadImage(file, "profile_photo");
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
      toast.error(reportDbError("profile photo upload", err, "Photo upload failed"));
    } finally {
      setPhotoBusy(false);
      photoBusyRef.current = false;
    }
  }

  async function handleBlockPick(file: File | null) {
    const block = pendingBlockRef.current;
    if (!file || !block) {
      if (blockInputRef.current) blockInputRef.current.value = "";
      return;
    }
    if (blockBusyRef.current) return;
    if (file.size > MAX_ACCEPTED_BYTES) {
      toast.error(acceptedUploadMessage());
      pendingBlockRef.current = null;
      if (blockInputRef.current) blockInputRef.current.value = "";
      return;
    }
    blockBusyRef.current = true;
    if (!navigator.onLine) {
      toast.error("No internet connection. Reconnect and retry.");
      blockBusyRef.current = false;
      pendingBlockRef.current = null;
      if (blockInputRef.current) blockInputRef.current.value = "";
      return;
    }
    const oldDoc = findDocByName(documents, block);
    const oldPath = oldDoc?.path ?? null;
    setBusyBlock(block);
    let uploadedPath: string | null = null;
    try {
      uploadedPath = await uploadImage(file, "document", block);
      try {
        await callSaveProfile({
          data: {
            documents: [
              ...documents.filter(
                (d) => d.name.trim().toLowerCase() !== block.trim().toLowerCase(),
              ),
              { name: block, path: uploadedPath, uploaded_at: new Date().toISOString() },
            ],
          },
        });
      } catch (saveErr) {
        try {
          await callDeleteUpload({ data: { path: uploadedPath } });
        } catch (e) {
          console.warn("Orphan document cleanup failed:", e);
        }
        throw saveErr;
      }
      if (oldPath && oldPath !== uploadedPath) {
        try {
          await callDeleteUpload({ data: { path: oldPath } });
        } catch (e) {
          console.warn("Old document cleanup failed:", e);
        }
      }
      toast.success(oldDoc ? "Document replaced" : "Document uploaded");
      await refreshEmployee();
    } catch (err) {
      toast.error(reportDbError("profile document upload", err, "Document upload failed"));
    } finally {
      setBusyBlock(null);
      pendingBlockRef.current = null;
      blockBusyRef.current = false;
      if (blockInputRef.current) blockInputRef.current.value = "";
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <UploadViewer
            path={employee?.photo_path}
            cache={signedUrlCacheRef}
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
            <p className="text-[13px] text-muted-foreground">Field Engineer</p>
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
          <input
            ref={blockInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleBlockPick(e.target.files?.[0] ?? null)}
          />
          <div className="grid grid-cols-2 gap-2">
            {PROFILE_DOC_TYPES.map((block) => {
              const doc = findDocByName(documents, block);
              const busy = busyBlock === block;
              return (
                <div key={block} className="rounded-xl border border-border p-3 space-y-1.5">
                  <p className="text-xs font-semibold truncate">{block}</p>
                  <p className={doc ? "text-xs text-emerald-600" : "text-xs text-muted-foreground"}>
                    {doc ? "Uploaded" : "Not uploaded"}
                  </p>
                  {doc ? (
                    <UploadViewer
                      path={doc.path}
                      cache={signedUrlCacheRef}
                      render={(url) =>
                        url ? (
                          <a
                            className="min-h-[44px] inline-flex items-center text-xs underline underline-offset-2"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View
                          </a>
                        ) : (
                          <span className="min-h-[44px] inline-flex items-center text-xs text-muted-foreground">
                            Unavailable
                          </span>
                        )
                      }
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[44px] w-full"
                    disabled={busyBlock !== null}
                    onClick={() => {
                      pendingBlockRef.current = block;
                      blockInputRef.current?.click();
                    }}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" aria-hidden />
                    ) : (
                      <Camera className="h-4 w-4 mr-1" aria-hidden />
                    )}
                    {doc ? "Replace" : "Upload"}
                  </Button>
                </div>
              );
            })}
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
