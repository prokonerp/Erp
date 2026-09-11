const SERVER_MAX = 8 * 1024 * 1024;

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
  opts?: { maxBytes?: number },
  env?: { createImageBitmapFn?: typeof createImageBitmap; documentRef?: Document },
): Promise<CompressedImage> {
  const maxBytes = opts?.maxBytes ?? 2 * 1024 * 1024;
  const originalBytes = file.size;
  const inputName = (file as { name?: string }).name ?? "photo";
  const inputType = (file as { type?: string }).type ?? "image/jpeg";

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

    if (decodeFailed) {
      if (originalBytes <= SERVER_MAX) {
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
        "Photo could not be read. Try a JPEG photo under 8 MB. If this is an HEIC photo, convert it to JPEG first.",
      );
    }

    const src = bitmap ?? imgEl;
    if (!src) throw new Error("decode");

    const maxSide = Math.max(decodedWidth, decodedHeight);
    let quality = 0.92;
    const side = Math.min(2048, maxSide);
    const sideSteps = [2048, 1600, 1280];

    const doc = env?.documentRef ?? document;
    const canvas = doc.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");

    let sideIdx = sideSteps.indexOf(side);
    if (sideIdx === -1) sideIdx = 0;

    let outBlob: Blob | null = null;

    while (sideIdx < sideSteps.length) {
      const currentSide = sideSteps[sideIdx];
      const aspect = decodedWidth / decodedHeight;
      const w = aspect >= 1 ? currentSide : Math.round(currentSide * aspect);
      const h = aspect >= 1 ? Math.round(currentSide / aspect) : currentSide;

      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(src, 0, 0, w, h);

      quality = sideIdx === 0 ? 0.92 : 0.8;

      while (quality >= 0.68) {
        outBlob = await toBlob(canvas, "image/jpeg", quality);
        if (outBlob.size <= maxBytes) {
          break;
        }
        quality -= 0.08;
      }

      if (outBlob && outBlob.size <= maxBytes) break;

      quality = 0.8;
      sideIdx++;
    }

    if (!outBlob || outBlob.size > maxBytes) {
      throw new Error(
        `Photo could not be compressed under ${Math.round(maxBytes / 1024 / 1024)} MB. Retake closer to the plate.`,
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
