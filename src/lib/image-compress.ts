import {
  MAX_ACCEPTED_BYTES,
  COMPRESS_TARGET_BYTES,
  HEIC_MIME,
  acceptedUploadMessage,
} from "@/lib/upload-limits";

export type CompressedImage = {
  blob: Blob;
  name: string;
  contentType: string;
  originalBytes: number;
  compressedBytes: number;
  quality: number;
  width: number;
  height: number;
  passthrough: boolean;
};

function bitmapDecode(
  file: File | (Blob & { name?: string; type?: string }),
  createImageBitmapFn?: typeof createImageBitmap,
): Promise<ImageBitmap> {
  const fn = createImageBitmapFn ?? globalThis.createImageBitmap;
  if (typeof fn !== "function") {
    throw new Error("createImageBitmap unavailable");
  }
  return fn(file as Blob, { imageOrientation: "from-image" });
}

function htmlImageDecode(
  file: File | (Blob & { name?: string; type?: string }),
  documentRef?: Document,
): Promise<HTMLImageElement> {
  const doc = documentRef ?? document;
  if (!doc) throw new Error("Document unavailable");
  const url = URL.createObjectURL(file as Blob);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = doc.createElement("img");
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas toBlob returned null"));
      },
      type,
      quality,
    );
  });
}

export async function compressImageToLimit(
  file: File | (Blob & { name?: string; type?: string }),
  opts?: { maxBytes?: number; maxInputBytes?: number; preset?: "document" | "photo" },
  env?: { createImageBitmapFn?: typeof createImageBitmap; documentRef?: Document },
): Promise<CompressedImage> {
  const maxBytes = opts?.maxBytes ?? COMPRESS_TARGET_BYTES;
  const maxInputBytes = opts?.maxInputBytes ?? MAX_ACCEPTED_BYTES;
  const ceiling = opts?.preset === "photo" ? 2048 : 2560;
  const originalBytes = file.size;
  const inputName = (file as { name?: string }).name ?? "photo";

  if (file.size > maxInputBytes) {
    throw new Error(acceptedUploadMessage());
  }

  let bitmap: ImageBitmap | null = null;
  let imgEl: HTMLImageElement | null = null;
  let decodedWidth = 0;
  let decodedHeight = 0;

  try {
    let decodeFailed = false;
    try {
      bitmap = await bitmapDecode(file, env?.createImageBitmapFn);
      decodedWidth = bitmap.width;
      decodedHeight = bitmap.height;
    } catch {
      try {
        imgEl = await htmlImageDecode(file, env?.documentRef);
        decodedWidth = imgEl.naturalWidth;
        decodedHeight = imgEl.naturalHeight;
      } catch {
        decodeFailed = true;
      }
    }

    if (!decodeFailed && (decodedWidth <= 0 || decodedHeight <= 0)) {
      decodeFailed = true;
    }

    if (decodeFailed) {
      const fileType = (file as { type?: string }).type ?? "";
      if ((HEIC_MIME as readonly string[]).includes(fileType)) {
        throw new Error(
          "This photo (HEIC) could not be read on this device. Switch the camera to JPEG / Most Compatible and retake.",
        );
      }
      if (originalBytes <= maxBytes) {
        const inputType2 = (file as { type?: string }).type ?? "image/jpeg";
        return {
          blob: file as Blob,
          name: inputName,
          contentType: inputType2,
          originalBytes,
          compressedBytes: originalBytes,
          quality: 1,
          width: 0,
          height: 0,
          passthrough: true,
        };
      }
      throw new Error(
        `Photo could not be read. Try a JPEG photo under ${Math.round(MAX_ACCEPTED_BYTES / (1024 * 1024))} MB. If this is an HEIC photo, convert it to JPEG first.`,
      );
    }

    const src = bitmap ?? imgEl;
    if (!src) throw new Error("decode");

    const maxSide = Math.max(decodedWidth, decodedHeight);
    const LADDER = [2560, 2240, 2048, 1792, 1600, 1280];
    const QUALITIES = [0.9, 0.85];

    // Never upscale: cap every tried side at the decoded max side.
    let triedSides: number[];
    if (maxSide < 1280) {
      triedSides = [maxSide];
    } else {
      const topSide = Math.min(ceiling, maxSide);
      triedSides = [topSide, ...LADDER.filter((s) => s < topSide)];
    }

    const doc = env?.documentRef ?? document;
    const canvas = doc.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");

    let outBlob: Blob | null = null;
    let quality = QUALITIES[0];

    outer: for (let i = 0; i < triedSides.length; i++) {
      const currentSide = triedSides[i];
      const aspect = decodedWidth / decodedHeight;
      const w = aspect >= 1 ? currentSide : Math.round(currentSide * aspect);
      const h = aspect >= 1 ? Math.round(currentSide / aspect) : currentSide;

      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(src, 0, 0, w, h);

      // Fast path: only the first (largest) side tries both qualities;
      // every smaller side tries 0.85 once.
      const qualities = i === 0 ? QUALITIES : [0.85];
      for (const q of qualities) {
        quality = q;
        outBlob = await toBlob(canvas, "image/jpeg", quality);
        if (outBlob.size <= maxBytes) {
          break outer;
        }
      }
    }

    if (!outBlob || outBlob.size > maxBytes) {
      const sizeLabel =
        maxBytes >= 1024 * 1024
          ? `${Math.round(maxBytes / 1024 / 1024)} MB`
          : `${Math.round(maxBytes / 1024)} KB`;
      throw new Error(
        `Photo could not be compressed under ${sizeLabel}. Try a smaller photo or retake it.`,
      );
    }

    const baseName = inputName.replace(/\.[^.]+$/, "");
    const outW = canvas.width;
    const outH = canvas.height;
    canvas.width = 0;
    canvas.height = 0;
    return {
      blob: outBlob,
      name: `${baseName}.jpg`,
      contentType: "image/jpeg",
      originalBytes,
      compressedBytes: outBlob.size,
      quality: Math.round(quality * 100) / 100,
      width: outW,
      height: outH,
      passthrough: false,
    };
  } finally {
    bitmap?.close();
    if (imgEl) {
      const url = imgEl.src;
      imgEl = null;
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
  }
}
