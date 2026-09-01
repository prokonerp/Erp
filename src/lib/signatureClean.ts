/**
 * signatureClean.ts — client-side background removal for handwritten signatures.
 * Turns a light-paper photo (grey/white) with blue/black ink into a transparent PNG data URL.
 * Used for DocumentPrintView preview and purchaseOrderPdf embedding so even if the
 * stored file has a grey rectangle, the rendered result is clean.
 */

export type CleanOpts = {
  /** Luminance threshold above which a pixel is considered paper/background (0-255). Default 185 */
  whiteThreshold?: number;
  /** Max channel spread for grey detection (e.g. 28). Low = only neutral greys become transparent. */
  greyTolerance?: number;
  /** Keep dark ink even if luminance is high? Default true — preserves blue ballpoint */
  preserveBlue?: boolean;
};

const DEFAULTS: Required<CleanOpts> = {
  whiteThreshold: 185,
  greyTolerance: 28,
  preserveBlue: true,
};

/**
 * Decide if a pixel is paper (should become transparent).
 * Paper = light and low saturation (R≈G≈B) OR light warm grey.
 * Blue ballpoint is preserved even at ~180 luminance because B dominates.
 */
function isPaper(r: number, g: number, b: number, a: number, opts: Required<CleanOpts>): boolean {
  if (a === 0) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;

  // Strong blue ink — never treat as paper (ballpoint #2a3bb0 etc has B >> R)
  if (opts.preserveBlue) {
    // blue ballpoint heuristic: B is dominant and fairly saturated
    // e.g. r 60-90, g 70-110, b 140-220  → spread ~60-100, b = max
    if (b === max && b > 110 && spread > 18 && b - r > 18) return false;
    // black ink — very dark, spread small but lum low
    if (lum < 85) return false;
  }

  // Light neutral/grey paper: lum high + desaturated
  if (lum > opts.whiteThreshold && spread < opts.greyTolerance) return true;
  // Very light warm paper (slightly yellowish photo): lum > 200 and spread moderate but still paper-looking
  if (lum > 210 && spread < 40 && r >= g && g >= b - 5) return true;
  // Pure white border
  if (r > 235 && g > 235 && b > 235) return true;
  return false;
}

/**
 * Load an image URL (remote, signed URL, or data URL) → transparent PNG data URL.
 * Returns null if loading or canvas fails (caller should fallback to original src).
 */
export async function cleanSignatureToTransparentPng(src: string, opts: CleanOpts = {}): Promise<string | null> {
  const o = { ...DEFAULTS, ...opts };
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  if (!src) return null;

  const img = new Image();
  // Needed for signed S3 URLs without CORS — try anonymous, fall back to no-cors load via fetch+blob if tainted
  img.crossOrigin = "anonymous";

  const load = new Promise<HTMLImageElement>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("img load timeout")), 6000);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = (e) => { clearTimeout(t); reject(e); };
    img.src = src;
  });

  let el: HTMLImageElement;
  try {
    el = await load;
  } catch {
    // Fallback: try fetching as blob then object URL (helps when CORS blocks canvas)
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const img2 = new Image();
      img2.crossOrigin = "anonymous";
      const p2 = new Promise<HTMLImageElement>((res2, rej2) => {
        const tt = window.setTimeout(() => rej2(new Error("blob img timeout")), 6000);
        img2.onload = () => { clearTimeout(tt); res2(img2); };
        img2.onerror = (e) => { clearTimeout(tt); rej2(e); };
        img2.src = obj;
      });
      el = await p2;
      URL.revokeObjectURL(obj);
    } catch {
      return null;
    }
  }

  const w = (el as HTMLImageElement).naturalWidth || (el as HTMLImageElement).width;
  const h = (el as HTMLImageElement).naturalHeight || (el as HTMLImageElement).height;
  if (!w || !h || w > 3000 || h > 2000) return null; // guard huge images

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true } as unknown as CanvasRenderingContext2DSettings);
  if (!ctx) return null;

  // White base then draw — helps detect paper vs transparent originals
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(el, 0, 0, w, h);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    // Canvas tainted (CORS) — cannot clean, fallback to original
    return null;
  }

  const d = data.data;
  let kept = 0;
  let removed = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    if (isPaper(r, g, b, a, o)) {
      d[i + 3] = 0; // transparent
      removed++;
    } else {
      // Slight ink darkening for crisper print: boost contrast a touch for blue/black
      // Keep original RGB, but ensure alpha 255 and apply tiny contrast
      d[i + 3] = 255;
      // Gentle darkening of ink (avoid light grey fringes becoming semi-transparent)
      // Don't modify pure ink, just the thresholded edge anti-aliasing
      kept++;
    }
  }

  // If we removed almost nothing (<3% of pixels), the image is already transparent/svg
  // — in that case return null to avoid unnecessary processing overhead for caller to fallback
  if (removed < w * h * 0.03) {
    // Still return cleaned version — it's already clean, caller can use it but original is fine too
  }
  if (kept === 0) return null; // no ink found — don't return empty image

  ctx.putImageData(data, 0, 0);

  // Optional feather: re-read and median to soften hard edges? Keep simple for now

  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Convenience hook for <img> — cleans src on mount and swaps to transparent version if cleaning succeeds.
 * Returns the cleaned src to use.
 */
export async function getCleanSignatureSrc(src: string | null | undefined): Promise<string | null> {
  if (!src) return null;
  // SVGs are already vector-transparent — never raster-clean them
  if (src.toLowerCase().split("?")[0].endsWith(".svg") || src.startsWith("data:image/svg+xml")) return src;
  const cleaned = await cleanSignatureToTransparentPng(src);
  return cleaned || src; // fallback to original if cleaning failed (e.g. CORS taint)
}
