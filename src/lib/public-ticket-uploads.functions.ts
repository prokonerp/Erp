import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 8 * 1024 * 1024;

const uploadSchema = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1).max(100),
  kind: z.enum(["serial_photo", "issue_photo", "other"]),
  data_base64: z.string().min(1).max(Math.ceil((MAX_BYTES * 4) / 3) + 1024),
});

const deleteSchema = z.object({
  path: z.string().min(1).max(500),
});

export const uploadPublicTicketAttachment = createServerFn({ method: "POST" })
  .inputValidator((input) => uploadSchema.parse(input))
  .handler(async ({ data }) => {
    if (!ALLOWED_MIME.includes(data.content_type.toLowerCase())) {
      throw new Error("Only image uploads are allowed");
    }
    const buf = Buffer.from(data.data_base64, "base64");
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      throw new Error("Image must be between 1 byte and 8 MB");
    }
    const safeExt = (data.filename.split(".").pop() || "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 5) || "jpg";
    const name = `${data.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${safeExt}`;
    const path = `public/${new Date().toISOString().slice(0, 10)}/${name}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage
      .from("ticket-attachments")
      .upload(path, buf, { cacheControl: "3600", upsert: false, contentType: data.content_type });
    if (error) throw new Error(error.message);
    return { path };
  });

export const deletePublicTicketAttachment = createServerFn({ method: "POST" })
  .inputValidator((input) => deleteSchema.parse(input))
  .handler(async ({ data }) => {
    if (!data.path.startsWith("public/")) throw new Error("Invalid path");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from("ticket-attachments").remove([data.path]);
    return { ok: true };
  });