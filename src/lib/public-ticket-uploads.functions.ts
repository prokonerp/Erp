import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 8 * 1024 * 1024;

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
    ]),
    data_base64: z
      .string()
      .min(1)
      .max(Math.ceil((MAX_BYTES * 4) / 3) + 1024),
    lat: z.number().min(-90).max(90).optional(),
    long: z.number().min(-180).max(180).optional(),
    accuracy: z.number().nullable().optional(),
    captured_at: z.string().nullable().optional(),
  })
  .refine(
    (parsed) => {
      if (parsed.kind === "equipment_correction") {
        return (
          parsed.lat !== undefined &&
          parsed.long !== undefined &&
          !!parsed.captured_at
        );
      }
      return true;
    },
    {
      message:
        "Geotagged photo with live location is mandatory for Model/Serial mismatch.",
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
  .middleware([requireActiveUser])
  .inputValidator((input) => uploadSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!ALLOWED_MIME.includes(data.content_type.toLowerCase())) {
      throw new Error("Only image uploads are allowed");
    }
    const buf = Buffer.from(data.data_base64, "base64");
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      throw new Error("Image must be between 1 byte and 8 MB");
    }
    const safeExt =
      (data.filename.split(".").pop() || "jpg")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5) || "jpg";
    const name = `${data.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExt}`;
    const path = `ticket/${data.ticket_id}/${new Date().toISOString().slice(0, 10)}/${name}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("tickets")
      .select("id")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (ticketErr || !ticket) {
      throw new Error("Ticket not found");
    }

    // Ownership gate: only the assigned engineer (or admin) may upload.
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) {
      const { data: authData } = await supabaseAdmin.auth.admin.getUserById(context.userId);
      const callerEmail = authData?.user?.email;
      if (!callerEmail) {
        throw new Error("Could not resolve your account email. Contact admin.");
      }
      const { data: caller } = await supabaseAdmin
        .from("employees")
        .select("id, name")
        .eq("email", callerEmail)
        .eq("active", true)
        .maybeSingle();
      if (!caller) {
        throw new Error("Employee account not linked. Contact admin.");
      }
      const { data: ticketRow } = await supabaseAdmin
        .from("tickets")
        .select("assigned_employee_id, assigned_engineer_name")
        .eq("id", data.ticket_id)
        .maybeSingle();
      if (!ticketRow?.assigned_employee_id && !ticketRow?.assigned_engineer_name) {
        throw new Error("Ticket has no assigned engineer. Contact Services.");
      }
      const fkMatch = ticketRow.assigned_employee_id === caller.id;
      const nameMatch =
        ticketRow.assigned_engineer_name &&
        caller.name &&
        ticketRow.assigned_engineer_name.toLowerCase() === caller.name.toLowerCase();
      if (!fkMatch && !nameMatch) {
        throw new Error(
          "You are not the assigned engineer for this ticket. Only the assigned engineer may upload attachments.",
        );
      }
    }

    const { error } = await supabaseAdmin.storage
      .from("ticket-attachments")
      .upload(path, buf, { cacheControl: "3600", upsert: false, contentType: data.content_type });
    if (error) throw new Error(error.message);
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
