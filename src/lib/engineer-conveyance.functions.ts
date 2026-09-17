import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { fetchMyIdentityAdmin } from "@/lib/engineer-identity";
import { formatDbError, storageUploadMessage } from "@/lib/format-error";
import { uploadObjectRaw } from "@/lib/storage-upload-raw";
import {
  CHARGE_TYPES,
  asEmployeeDocuments,
  dailyLogEntrySchema,
  expenseEntrySchema,
  kmTravelled,
  todayLocal,
} from "@/lib/engineer-conveyance";

import { ALLOWED_IMAGE_MIME, MAX_ACCEPTED_BYTES, acceptedUploadMessage } from "@/lib/upload-limits";
import {
  buildUploadFilename,
  initialsFromName,
  makeNameToken,
  sanitizeNameLabel,
  type UploadNameKind,
} from "@/lib/upload-naming";

const ENGINEER_BUCKET = "engineer-uploads";

const uploadKinds = [
  "morning_reading",
  "evening_reading",
  "receipt",
  "profile_photo",
  "document",
] as const;

type AdminClient = Awaited<ReturnType<typeof getAdmin>>;

/** Service-role client (bypasses RLS — every fn below gates on the caller). */
async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-table untyped access below
  return supabaseAdmin as any;
}

/**
 * Email straight from the verified JWT claims (the auth middleware already
 * validated the token). Skips the slow GoTrue admin lookup in the hot path.
 */
function claimsEmail(context: unknown): string | null {
  const email = (context as { claims?: { email?: unknown } } | null)?.claims?.email;
  return typeof email === "string" && email !== "" ? email : null;
}

/** Resolve the caller to their active employee row. Throws fail-loud errors. */
async function resolveCaller(admin: AdminClient, userId: string, emailHint: string | null) {
  // Central identity policy (auth_user_id exact, unique-email fallback,
  // fail-loud on ambiguity).
  const identity = await fetchMyIdentityAdmin(admin, {
    userId,
    emailHint,
    columns: "id, name, auth_user_id",
  });
  if (identity.status === "ambiguous") {
    throw new Error("Forbidden: multiple employee rows match your login. Contact admin.");
  }
  if (identity.status !== "ok") {
    throw new Error("Forbidden: your login is not linked to an active employee");
  }
  return identity.employee as { id: string; name: string | null; auth_user_id: string | null };
}

// ---------------------------------------------------------------------------
// uploadEngineerAttachment — engineer-scoped image upload (readings,
// receipts, profile photo, documents). Path is server-built from the
// caller's employee id, never client-supplied.
// ---------------------------------------------------------------------------
const uploadInput = z.object({
  kind: z.enum(uploadKinds),
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1).max(100),
  data_base64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_ACCEPTED_BYTES * 4) / 3) + 1024),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  label: z.string().max(24).optional(),
});

export const uploadEngineerAttachment = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => uploadInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(data.content_type.toLowerCase())) {
      throw new Error("Only JPEG, PNG, WebP, HEIC images allowed");
    }
    const buf = Buffer.from(data.data_base64, "base64");
    if (buf.length === 0 || buf.length > MAX_ACCEPTED_BYTES) {
      throw new Error(acceptedUploadMessage());
    }
    const admin = await getAdmin();
    const caller = await resolveCaller(admin, context.userId, claimsEmail(context));
    const safeExt =
      (data.filename.split(".").pop() || "jpg")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5) || "jpg";
    const day = data.date ?? todayLocal();
    const initials = initialsFromName(caller.name);
    const token = makeNameToken();
    let nameKind: UploadNameKind = "CONVEYANCE";
    let nameLabel: string | null = null;
    switch (data.kind) {
      case "morning_reading":
        nameKind = "CONVEYANCE";
        nameLabel = "morning";
        break;
      case "evening_reading":
        nameKind = "CONVEYANCE";
        nameLabel = "evening";
        break;
      case "receipt":
        nameKind = "CONVEYANCE";
        nameLabel = sanitizeNameLabel(data.label) ?? "receipt";
        break;
      case "profile_photo":
        nameKind = "PROFILE";
        nameLabel = null;
        break;
      case "document":
        nameKind = "PROFILE";
        nameLabel = sanitizeNameLabel(data.label);
        break;
    }
    const filename = buildUploadFilename({
      initials,
      kind: nameKind,
      date: day,
      label: nameLabel,
      token,
      ext: safeExt,
    });
    const path = `engineer/${caller.id}/${data.kind}/${day}/${filename}`;
    await uploadObjectRaw({
      adminUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      bucket: ENGINEER_BUCKET,
      path,
      body: buf,
      contentType: data.content_type,
    });
    return { path };
  });

// ---------------------------------------------------------------------------
// deleteEngineerAttachment — remove one of the caller's own uploads.
// ---------------------------------------------------------------------------
const deleteInput = z.object({
  path: z.string().min(1).max(500),
});

export const deleteEngineerAttachment = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => deleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const caller = await resolveCaller(admin, context.userId, claimsEmail(context));
    const prefix = `engineer/${caller.id}/`;
    if (!data.path.startsWith(prefix)) {
      throw new Error("Forbidden: you can only delete your own uploads");
    }
    // Refuse submitted uploads — only orphan / replaced paths may be deleted.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new tables pending generated types (migration 20260920000001)
    const { data: logRows, error: logErr } = await (admin as any)
      .from("engineer_daily_logs")
      .select("morning_photo_path,evening_photo_path")
      .eq("employee_id", caller.id);
    if (logErr) throw new Error(formatDbError(logErr, "Failed to verify upload usage"));
    const logHit = (
      logRows as Array<{
        morning_photo_path: string | null;
        evening_photo_path: string | null;
      }> | null
    )?.some((r) => r.morning_photo_path === data.path || r.evening_photo_path === data.path);
    if (logHit) {
      throw new Error("This upload is already submitted and cannot be deleted");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new tables pending generated types (migration 20260920000001)
    const { data: expRows, error: expErr } = await (admin as any)
      .from("engineer_conveyance_expenses")
      .select("receipt_path")
      .eq("employee_id", caller.id);
    if (expErr) throw new Error(formatDbError(expErr, "Failed to verify upload usage"));
    const expHit = (expRows as Array<{ receipt_path: string | null }> | null)?.some(
      (r) => r.receipt_path === data.path,
    );
    if (expHit) {
      throw new Error("This upload is already submitted and cannot be deleted");
    }
    const { data: empRow, error: empErr } = await admin
      .from("employees")
      .select("documents")
      .eq("id", caller.id)
      .maybeSingle();
    if (empErr) throw new Error(formatDbError(empErr, "Failed to verify upload usage"));
    const docs = asEmployeeDocuments((empRow as { documents: unknown } | null)?.documents ?? []);
    if (docs.some((d) => d.path === data.path)) {
      throw new Error("This upload is already submitted and cannot be deleted");
    }
    const { error } = await admin.storage.from(ENGINEER_BUCKET).remove([data.path]);
    if (error) throw new Error(storageUploadMessage("engineer-uploads", error, data.path));
    return { path: data.path };
  });

// ---------------------------------------------------------------------------
// saveEngineerDailyLog — upsert (employee_id, log_date). Partial updates
// merge over the existing row (morning first, evening later). Each half of
// the day requires its reading AND its photo together.
// ---------------------------------------------------------------------------
const dailyLogInput = z.object({
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  morning_odometer: z.union([z.number(), z.string()]).optional(),
  morning_photo_path: z.string().max(500).nullable().optional(),
  evening_odometer: z.union([z.number(), z.string()]).optional(),
  evening_photo_path: z.string().max(500).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const saveEngineerDailyLog = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => dailyLogInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const caller = await resolveCaller(admin, context.userId, claimsEmail(context));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new tables pending generated types (migration 20260920000001)
    const logs = (admin as any).from("engineer_daily_logs");
    const { data: existing, error: readErr } = await logs
      .select("*")
      .eq("employee_id", caller.id)
      .eq("log_date", data.log_date)
      .maybeSingle();
    if (readErr) throw new Error(formatDbError(readErr, "Failed to load daily log"));
    // Hard lock: a confirmed half rejects ANY re-submit, even an identical one.
    if (
      (existing?.morning_odometer ?? null) != null &&
      (data.morning_odometer !== undefined || data.morning_photo_path !== undefined)
    ) {
      throw new Error("Morning entry is already confirmed and locked");
    }
    if (
      (existing?.evening_odometer ?? null) != null &&
      (data.evening_odometer !== undefined || data.evening_photo_path !== undefined)
    ) {
      throw new Error("Evening entry is already confirmed and locked");
    }
    const prev = (existing ?? {}) as Record<string, unknown>;
    const pick = (key: string, fallback: unknown) => {
      const v = (data as Record<string, unknown>)[key];
      return v === undefined ? fallback : v;
    };
    const merged = {
      log_date: data.log_date,
      morning_odometer: pick("morning_odometer", prev.morning_odometer),
      morning_photo_path: pick("morning_photo_path", prev.morning_photo_path),
      evening_odometer: pick("evening_odometer", prev.evening_odometer),
      evening_photo_path: pick("evening_photo_path", prev.evening_photo_path),
      notes: pick("notes", prev.notes ?? null),
    };
    const parsed = dailyLogEntrySchema.safeParse(merged);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Invalid daily log");
    }
    // Numbers + photo go together for each half of the day.
    if (parsed.data.morning_odometer != null && !parsed.data.morning_photo_path) {
      throw new Error("Morning photo is required with the morning reading");
    }
    if (parsed.data.evening_odometer != null && !parsed.data.evening_photo_path) {
      throw new Error("Evening photo is required with the evening reading");
    }
    const { error } = await logs.upsert(
      {
        employee_id: caller.id,
        log_date: data.log_date,
        morning_odometer: parsed.data.morning_odometer ?? null,
        morning_photo_path: parsed.data.morning_photo_path ?? null,
        morning_captured_at:
          data.morning_odometer !== undefined || data.morning_photo_path !== undefined
            ? new Date().toISOString()
            : ((prev.morning_captured_at as string | null) ?? null),
        evening_odometer: parsed.data.evening_odometer ?? null,
        evening_photo_path: parsed.data.evening_photo_path ?? null,
        evening_captured_at:
          data.evening_odometer !== undefined || data.evening_photo_path !== undefined
            ? new Date().toISOString()
            : ((prev.evening_captured_at as string | null) ?? null),
        notes: parsed.data.notes ?? null,
      },
      { onConflict: "employee_id,log_date" },
    );
    if (error) throw new Error(formatDbError(error, "Failed to save daily log"));
    return {
      log_date: data.log_date,
      km: kmTravelled({
        morning_odometer: parsed.data.morning_odometer ?? null,
        evening_odometer: parsed.data.evening_odometer ?? null,
      }),
    };
  });

// ---------------------------------------------------------------------------
// saveConveyanceExpense — own-row expense insert.
// ---------------------------------------------------------------------------
const expenseInput = z.object({
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  charge_type: z.enum(CHARGE_TYPES),
  amount: z.union([z.number(), z.string()]),
  receipt_path: z.string().max(500).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const saveConveyanceExpense = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => expenseInput.parse(input))
  .handler(async ({ data, context }) => {
    const parsed = expenseEntrySchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Invalid expense");
    }
    const admin = await getAdmin();
    const caller = await resolveCaller(admin, context.userId, claimsEmail(context));
    if (
      parsed.data.receipt_path &&
      !parsed.data.receipt_path.startsWith(`engineer/${caller.id}/`)
    ) {
      throw new Error("Forbidden: receipt must be your own upload");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new tables pending generated types (migration 20260920000001)
    const { data: row, error } = await (admin as any)
      .from("engineer_conveyance_expenses")
      .insert({
        employee_id: caller.id,
        expense_date: parsed.data.expense_date,
        charge_type: parsed.data.charge_type,
        amount: parsed.data.amount,
        receipt_path: parsed.data.receipt_path ?? null,
        notes: parsed.data.notes ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(formatDbError(error, "Failed to save expense"));
    return { id: (row as { id: string }).id };
  });

// ---------------------------------------------------------------------------
// saveMyProfile — update the caller's OWN employees row (photo + documents).
// Engineers cannot UPDATE employees under RLS, so this runs service-role.
// ---------------------------------------------------------------------------
const profileInput = z.object({
  photo_path: z.string().max(500).nullable().optional(),
  documents: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        path: z.string().min(1).max(500),
        uploaded_at: z.string().min(1).max(50),
      }),
    )
    .max(10)
    .optional(),
});

export const saveMyProfile = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => profileInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const caller = await resolveCaller(admin, context.userId, claimsEmail(context));
    const ownPrefix = `engineer/${caller.id}/`;
    if (data.photo_path && !data.photo_path.startsWith(ownPrefix)) {
      throw new Error("Forbidden: photo must be your own upload");
    }
    const docs = data.documents ? asEmployeeDocuments(data.documents) : undefined;
    if (docs && docs.some((d) => !d.path.startsWith(ownPrefix))) {
      throw new Error("Forbidden: documents must be your own uploads");
    }
    const update: Record<string, unknown> = {};
    if (data.photo_path !== undefined) update.photo_path = data.photo_path;
    if (docs !== undefined) update.documents = docs;
    if (Object.keys(update).length === 0) return { employeeId: caller.id };
    const { error } = await admin
      .from("employees")
      .update(update as never)
      .eq("id", caller.id)
      .eq("active", true);
    if (error) throw new Error(formatDbError(error, "Failed to save profile"));
    return { employeeId: caller.id };
  });
