import { storageUploadMessage } from "@/lib/format-error";

export type StorageUploadRequestInput = {
  url: string;
  serviceKey: string;
  bucket: string;
  path: string;
  body: BodyInit;
  contentType: string;
  cacheControl?: string;
};

export type StorageUploadRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: BodyInit;
};

/**
 * Build a raw Storage object-upload request.
 *
 * supabase-js `.upload()` always sends an `x-upsert` header, which trips a
 * 500 P0001 on the upsert path of this project's storage API. Posting to
 * `/storage/v1/object/<bucket>/<path>` directly omits that header entirely.
 */
export function buildStorageUploadRequest({
  url,
  serviceKey,
  bucket,
  path,
  body,
  contentType,
  cacheControl,
}: StorageUploadRequestInput): StorageUploadRequest {
  const base = url.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": contentType,
  };
  if (cacheControl !== undefined) {
    headers["Cache-Control"] = cacheControl;
  }
  return {
    url: `${base}/storage/v1/object/${bucket}/${path}`,
    method: "POST",
    headers,
    body,
  };
}

export type UploadObjectRawInput = {
  adminUrl: string;
  serviceKey: string;
  bucket: string;
  path: string;
  body: BodyInit;
  contentType: string;
  cacheControl?: string;
};

/**
 * Upload one object via raw fetch (no `x-upsert` header). Throws
 * `Error(storageUploadMessage(...))` on non-2xx so the server-fn boundary
 * keeps the existing bucket/status/path throw shape.
 */
export async function uploadObjectRaw({
  adminUrl,
  serviceKey,
  bucket,
  path,
  body,
  contentType,
  cacheControl,
}: UploadObjectRawInput): Promise<void> {
  if (!serviceKey) {
    throw new Error("Server misconfigured: SUPABASE_SERVICE_ROLE_KEY is missing");
  }
  const req = buildStorageUploadRequest({
    url: adminUrl,
    serviceKey,
    bucket,
    path,
    body,
    contentType,
    cacheControl,
  });
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => ({}))) as {
      message?: unknown;
      statusCode?: unknown;
    };
    throw new Error(
      storageUploadMessage(
        bucket,
        { message: parsed.message, statusCode: parsed.statusCode ?? res.status },
        path,
      ),
    );
  }
}
