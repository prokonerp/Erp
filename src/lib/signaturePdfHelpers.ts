/**
 * signaturePdfHelpers.ts — shared helpers to embed authorised signatures in jsPDF.
 * Extracted from purchaseOrderPdf.ts so both PO and Invoice PDFs stay identical.
 * Handles PNG/JPG and SVG (rasterized to PNG via canvas) with CORS-safe fetching.
 */

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error || new Error("FileReader failed"));
    r.readAsDataURL(blob);
  });
}

function rasterizeSvgToPng(svgDataUrl: string, targetW: number, targetH: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof document === "undefined" || typeof Image === "undefined") {
        resolve(null);
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = setTimeout(() => resolve(null), 4000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const natW = img.naturalWidth || img.width || targetW;
          const natH = img.naturalHeight || img.height || targetH;
          const aspect = natW && natH ? natW / natH : targetW / targetH;
          let w = targetW;
          let h = targetW / aspect;
          if (h > targetH) {
            h = targetH;
            w = targetH * aspect;
          }
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * 2));
          canvas.height = Math.max(1, Math.round(h * 2));
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.scale(2, 2);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = svgDataUrl;
    } catch {
      resolve(null);
    }
  });
}

export function getImageDimensions(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    try {
      if (typeof Image === "undefined") {
        resolve(null);
        return;
      }
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 2000);
      img.onload = () => {
        clearTimeout(timer);
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w && h) resolve({ w, h });
        else resolve(null);
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
  });
}

export async function fetchSignatureDataUrl(url: string): Promise<{ dataUrl: string; format: string } | null> {
  try {
    let fetchUrl = url;
    try {
      if (typeof window !== "undefined" && url.startsWith("/")) {
        fetchUrl = new URL(url, window.location.origin).href;
      }
    } catch {
      /* keep original */
    }
    const res = await fetch(fetchUrl);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const isSvg = ct.includes("svg") || url.toLowerCase().split("?")[0].endsWith(".svg");
    if (isSvg) {
      const svgText = await res.text();
      if (!svgText.trim()) return null;
      const svg64 = btoa(unescape(encodeURIComponent(svgText)));
      const svgDataUrl = `data:image/svg+xml;base64,${svg64}`;
      const pngDataUrl = await rasterizeSvgToPng(svgDataUrl, 360, 120);
      if (pngDataUrl) return { dataUrl: pngDataUrl, format: "PNG" };
      return null;
    }
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    const dataUrl = await blobToDataUrl(blob);
    const lowerType = (blob.type || ct || "").toLowerCase();
    const fmt = lowerType.includes("jpeg") || lowerType.includes("jpg") ? "JPEG" : lowerType.includes("png") ? "PNG" : "PNG";
    return { dataUrl, format: fmt };
  } catch {
    return null;
  }
}
