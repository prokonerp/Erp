import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { canManageSignature } from "@/lib/signature";
import { reportDbError } from "@/lib/format-error";
import { uploadObjectRaw } from "@/lib/storage-upload-raw";

// Same bucket as the client helper (src/lib/userSignature.ts); defined here
// so this server module never imports the browser Supabase client.
const SIGNATURE_BUCKET = "signatures";
const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
const LEGACY_EXTS = ["png", "jpg", "jpeg"] as const;

/** Service-role client (bypasses RLS — every fn below gates on the caller). */
async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- app_users pending generated types
  return supabaseAdmin as any;
}

async function isAdminUser(admin: { rpc: (...args: never[]) => unknown }, userId: string) {
  const { data, error } = (await (admin.rpc as (...a: unknown[]) => Promise<{ data: unknown; error: unknown }>)(
    "has_role",
    { _user_id: userId, _role: "admin" },
  )) as { data: unknown; error: { message?: string } | null };
  if (error) throw new Error(reportDbError("admin check", error));
  return data === true;
}

/** PNG magic (89 50 4E 47) or JPEG SOI (FF D8 FF) — rejects polyglot/deceptive uploads. */
function hasImageMagic(buf: Buffer, contentType: "image/png" | "image/jpeg"): boolean {
  if (contentType === "image/png") {
    return buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function extFor(contentType: "image/png" | "image/jpeg"): string {
  return contentType === "image/png" ? "png" : "jpg";
}

export type SignatureRow = {
  user_id: string;
  name: string | null;
  email: string | null;
  signature_url: string | null;
  signed_url: string | null;
};

/**
 * List signature users. Admins see every app_user; anyone else sees only
 * their own row (kills the all-users enumeration the old client query had).
 * Signed URLs are minted server-side with a 1-hour expiry (was 7 days).
 */
export const listSignatureUsers = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }): Promise<SignatureRow[]> => {
    const admin = await getAdmin();
    const adminFlag = await isAdminUser(admin, context.userId);
    let query = admin
      .from("app_users")
      .select("user_id, name, email, signature_url")
      .order("name", { ascending: true, nullsFirst: false });
    if (!adminFlag) query = query.eq("user_id", context.userId);
    const { data, error } = await query;
    if (error) throw new Error(reportDbError("list signature users", error));
    const rows = (Array.isArray(data) ? data : []) as Omit<SignatureRow, "signed_url">[];
    return Promise.all(
      rows.map(async (r) => {
        let signed_url: string | null = null;
        if (r.signature_url) {
          const { data: s } = await admin.storage
            .from(SIGNATURE_BUCKET)
            .createSignedUrl(r.signature_url, 3600);
          signed_url = (s as { signedUrl?: string } | null)?.signedUrl ?? null;
        }
        return { ...r, signed_url };
      }),
    );
  });

const uploadInput = z.object({
  userId: z.string().uuid(),
  dataBase64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 1024),
  contentType: z.enum(["image/png", "image/jpeg"]),
});

/**
 * Upload a signatory image. Admin-or-self (see canManageSignature): the file
 * is written with the service-role client and `app_users.signature_url` is
 * stamped in the same call — no direct browser write path remains.
 */
export const uploadSignature = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => uploadInput.parse(input))
  .handler(async ({ data, context }): Promise<{ path: string }> => {
    const admin = await getAdmin();
    const adminFlag = await isAdminUser(admin, context.userId);
    if (!canManageSignature({ userId: context.userId, isAdmin: adminFlag }, data.userId, "upload")) {
      throw new Error("Forbidden: you may only upload your own signature");
    }
    const buf = Buffer.from(data.dataBase64, "base64");
    if (buf.length === 0 || buf.length > MAX_SIGNATURE_BYTES) {
      throw new Error("Max file size is 2 MB");
    }
    if (!hasImageMagic(buf, data.contentType)) {
      throw new Error("Only PNG or JPG images are allowed");
    }
    const path = `signatures/${data.userId}.${extFor(data.contentType)}`;
    // Raw POST has no upsert: remove the target + legacy extensions first.
    const stale = [path, ...LEGACY_EXTS.map((e) => `signatures/${data.userId}.${e}`).filter((p) => p !== path)];
    await admin.storage.from(SIGNATURE_BUCKET).remove(stale);
    const adminUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    await uploadObjectRaw({
      adminUrl,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      bucket: SIGNATURE_BUCKET,
      path,
      body: buf,
      contentType: data.contentType,
      cacheControl: "3600",
    });
    const { error: dbErr } = await admin
      .from("app_users")
      .update({ signature_url: path })
      .eq("user_id", data.userId);
    if (dbErr) throw new Error(reportDbError("save signature", dbErr));
    return { path };
  });

const removeInput = z.object({ userId: z.string().uuid() });

/**
 * Remove a signatory image. Admin-only (preserves legacy behavior).
 */
export const removeSignature = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => removeInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const admin = await getAdmin();
    const adminFlag = await isAdminUser(admin, context.userId);
    if (!canManageSignature({ userId: context.userId, isAdmin: adminFlag }, data.userId, "remove")) {
      throw new Error("Forbidden: admin only");
    }
    const { data: row } = await admin
      .from("app_users")
      .select("signature_url")
      .eq("user_id", data.userId)
      .maybeSingle();
    const current = (row as { signature_url?: string | null } | null)?.signature_url ?? null;
    const stale = [
      ...(current ? [current] : []),
      ...LEGACY_EXTS.map((e) => `signatures/${data.userId}.${e}`).filter((p) => p !== current),
    ];
    if (stale.length > 0) {
      await admin.storage.from(SIGNATURE_BUCKET).remove(stale);
    }
    const { error: dbErr } = await admin
      .from("app_users")
      .update({ signature_url: null })
      .eq("user_id", data.userId);
    if (dbErr) throw new Error(reportDbError("remove signature", dbErr));
    return { ok: true };
  });
