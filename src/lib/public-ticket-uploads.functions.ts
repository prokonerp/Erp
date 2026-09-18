import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { requireFieldLocation } from "@/integrations/supabase/field-location-middleware";
import { buildStagedPublicPath, isStagedPublicPath } from "@/lib/public-upload-guards";
import { checkRateLimit } from "@/lib/public-rate-limit";
import { clientIpKey } from "@/lib/server-client-ip";
import { assertTicketAssignee } from "@/lib/engineer-identity";
import { storageUploadMessage } from "@/lib/format-error";
import { uploadObjectRaw } from "@/lib/storage-upload-raw";
import { ALLOWED_IMAGE_MIME, MAX_ACCEPTED_BYTES, acceptedUploadMessage } from "@/lib/upload-limits";
import type { UploadNameKind } from "@/lib/upload-naming";
import {
  buildUploadFilename,
  initialsFromName,
  makeNameToken,
  sanitizeNameLabel,
} from "@/lib/upload-naming";

export const uploadSchema = z
  .object({
    ticket_id: z.string().uuid(),
    filename: z.string().min(1).max(200),
    content_type: z.string().min(1).max(100),
    kind: z.enum([
      "serial_photo",
      "issue_photo",
      "other",
      "equipment_correction",
      "customer_signature",
    ]),
    data_base64: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_ACCEPTED_BYTES * 4) / 3) + 1024),
    lat: z.number().min(-90).max(90).optional(),
    long: z.number().min(-180).max(180).optional(),
    accuracy: z.number().nullable().optional(),
    captured_at: z.string().nullable().optional(),
  })
  // equipment_correction reuses the compulsory serial-number photo: live GPS
  // (lat/long/captured_at) is captured alongside the serial photo at mismatch submit.
  .refine(
    (parsed) => {
      if (parsed.kind === "equipment_correction") {
        return parsed.lat !== undefined && parsed.long !== undefined && !!parsed.captured_at;
      }
      return true;
    },
    {
      message: "Geotagged photo with live location is mandatory for Model/Serial mismatch.",
    },
  );

const deleteSchema = z.object({
  path: z.string().min(1).max(500),
  token: z.string().min(10).max(200),
});

async function signPath(path: string): Promise<string> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret) throw new Error("Server misconfigured: SUPABASE_SERVICE_ROLE_KEY is missing");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(path));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const uploadPublicTicketAttachment = createServerFn({ method: "POST" })
  .middleware([requireFieldLocation])
  .inputValidator((input) => uploadSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(data.content_type.toLowerCase())) {
      throw new Error("Only image uploads are allowed");
    }
    const buf = Buffer.from(data.data_base64, "base64");
    if (buf.length === 0 || buf.length > MAX_ACCEPTED_BYTES) {
      throw new Error(acceptedUploadMessage());
    }
    const safeExt =
      (data.filename.split(".").pop() || "jpg")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5) || "jpg";
    const KIND_TO_NAME: Record<string, UploadNameKind> = {
      serial_photo: "SERIAL",
      issue_photo: "ISSUE",
      equipment_correction: "MISMATCH",
      customer_signature: "SIGNATURE",
      other: "ISSUE",
    };
    const date = new Date().toISOString().slice(0, 10);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("tickets")
      .select("id, assigned_employee_id, assigned_engineer_name, case_id")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (ticketErr || !ticket) {
      throw new Error("Ticket not found");
    }
    const meta = ticket as unknown as {
      assigned_engineer_name: string | null;
      case_id: string | null;
    };
    const initials = initialsFromName(meta.assigned_engineer_name ?? "ENG");
    const label = sanitizeNameLabel(meta.case_id ?? null);
    const name = buildUploadFilename({
      initials,
      kind: KIND_TO_NAME[data.kind] ?? "ISSUE",
      date,
      label,
      token: makeNameToken(),
      ext: safeExt,
    });
    const path = `ticket/${data.ticket_id}/${date}/${name}`;

    // Ownership gate: only the assigned engineer (or admin) may upload.
    // Fast path: verified JWT email (skips the slow GoTrue admin lookup).
    const claimsEmail = (context as unknown as { claims?: { email?: unknown } })?.claims?.email;
    await assertTicketAssignee(supabaseAdmin, {
      userId: context.userId,
      emailHint: typeof claimsEmail === "string" && claimsEmail !== "" ? claimsEmail : null,
      ticket: ticket as unknown as {
        assigned_employee_id: string | null;
        assigned_engineer_name: string | null;
      },
      action: "upload attachments",
    });

    const adminUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    await uploadObjectRaw({
      adminUrl,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      bucket: "ticket-attachments",
      path,
      body: buf,
      contentType: data.content_type,
      cacheControl: "3600",
    });
    const token = await signPath(path);
    return { path, token };
  });

export const deletePublicTicketAttachment = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => deleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!data.path.startsWith("public/") && !data.path.startsWith("ticket/")) {
      throw new Error("Invalid path");
    }
    const expected = await signPath(data.path);
    if (!timingSafeEqual(expected, data.token)) {
      throw new Error("Invalid delete token");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: isAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) {
      throw new Error("Only admin accounts may delete attachments");
    }
    await supabaseAdmin.storage.from("ticket-attachments").remove([data.path]);
    return { ok: true };
  });

// =====================================================================
// Anonymous staging path for the PUBLIC raise-ticket form.
//
// The public form uploads photos BEFORE the ticket exists, so there is no
// ticket_id yet. Files are staged under public/staged/<date>/... via the
// service-role client (the anon storage INSERT policy is closed), and the
// ticket submit fn only accepts paths that pass isStagedPublicPath.
// Abuse is bounded by per-IP rate limits + the captcha on submit.
// =====================================================================

const stagedUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1).max(100),
  kind: z.enum(["serial_photo", "issue_photo", "other"]).default("other"),
  data_base64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_ACCEPTED_BYTES * 4) / 3) + 1024),
});

const stagedUploadHits = new Map<string, number[]>();
const STAGED_UPLOAD_LIMIT = { windowMs: 10 * 60 * 1000, max: 10 };

export const stagePublicTicketPhoto = createServerFn({ method: "POST" })
  .inputValidator((input) => stagedUploadSchema.parse(input))
  .handler(async ({ data }) => {
    const check = checkRateLimit(stagedUploadHits, clientIpKey(), Date.now(), STAGED_UPLOAD_LIMIT);
    if (!check.allowed) {
      throw new Error("Too many uploads. Please wait a few minutes and try again.");
    }
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(data.content_type.toLowerCase())) {
      throw new Error("Only image uploads are allowed");
    }
    const buf = Buffer.from(data.data_base64, "base64");
    if (buf.length === 0 || buf.length > MAX_ACCEPTED_BYTES) {
      throw new Error(acceptedUploadMessage());
    }
    const safeExt =
      (data.filename.split(".").pop() || "jpg")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5) || "jpg";
    const path = buildStagedPublicPath(new Date(), crypto.randomUUID(), data.kind, safeExt);
    const stagedAdminUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    await uploadObjectRaw({
      adminUrl: stagedAdminUrl,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      bucket: "ticket-attachments",
      path,
      body: buf,
      contentType: data.content_type,
      cacheControl: "3600",
    });
    const token = await signPath(path);
    return { path, token };
  });

export const deleteStagedPublicPhoto = createServerFn({ method: "POST" })
  .inputValidator((input) => deleteSchema.parse(input))
  .handler(async ({ data }) => {
    // Bearer-token authorized: only staged paths, never ticket/<id>/... or
    // anything outside the public staging area.
    if (!isStagedPublicPath(data.path)) {
      throw new Error("Invalid path");
    }
    const expected = await signPath(data.path);
    if (!timingSafeEqual(expected, data.token)) {
      throw new Error("Invalid delete token");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from("ticket-attachments").remove([data.path]);
    return { ok: true };
  });

// =====================================================================
// deleteTicketAttachment — assigned-engineer cleanup for ticket photos.
//
// Browser-client `.remove()` calls fail for non-admin engineers (storage
// DELETE on this bucket is admin-gated), so verification re-tries and
// old-photo replacement used to orphan files silently. This fn deletes via
// the service-role client after verifying (a) the path lives under THIS
// ticket's folder and (b) the caller is an admin or the assigned engineer.
// Best-effort callers must still catch: a failed cleanup warns, never fails
// the parent flow.
// =====================================================================

const deleteTicketAttachmentSchema = z.object({
  ticket_id: z.string().uuid(),
  path: z.string().min(1).max(500),
});

export const deleteTicketAttachment = createServerFn({ method: "POST" })
  .middleware([requireFieldLocation])
  .inputValidator((input) => deleteTicketAttachmentSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!data.path.startsWith(`ticket/${data.ticket_id}/`)) {
      throw new Error("Invalid path");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("tickets")
      .select("id, assigned_employee_id, assigned_engineer_name")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (ticketErr || !ticket) {
      throw new Error("Ticket not found");
    }
    const claimsEmail = (context as unknown as { claims?: { email?: unknown } })?.claims?.email;
    await assertTicketAssignee(supabaseAdmin, {
      userId: context.userId,
      emailHint: typeof claimsEmail === "string" && claimsEmail !== "" ? claimsEmail : null,
      ticket: ticket as unknown as {
        assigned_employee_id: string | null;
        assigned_engineer_name: string | null;
      },
      action: "delete attachments",
    });
    const { data: verification } = await supabaseAdmin
      .from("ticket_equipment_verifications")
      .select("photo_path")
      .eq("ticket_id", data.ticket_id)
      .maybeSingle();
    if (verification && verification.photo_path === data.path) {
      throw new Error("This photo is already submitted and cannot be deleted");
    }
    const { error } = await supabaseAdmin.storage.from("ticket-attachments").remove([data.path]);
    if (error) throw new Error(storageUploadMessage("ticket-attachments", error, data.path));
    return { ok: true };
  });
