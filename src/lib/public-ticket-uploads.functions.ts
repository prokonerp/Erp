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
  token: z.string().min(10).max(200),
});

async function signPath(path: string): Promise<string> {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret) throw new Error("Server misconfigured");
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
    const token = await signPath(path);
    return { path, token };
  });

export const deletePublicTicketAttachment = createServerFn({ method: "POST" })
  .inputValidator((input) => deleteSchema.parse(input))
  .handler(async ({ data }) => {
    if (!data.path.startsWith("public/")) throw new Error("Invalid path");
    const expected = await signPath(data.path);
    if (!timingSafeEqual(expected, data.token)) {
      throw new Error("Invalid delete token");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from("ticket-attachments").remove([data.path]);
    return { ok: true };
  });