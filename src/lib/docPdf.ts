import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";

const PX_PER_MM = 96 / 25.4;
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 10;
const CONTENT_W_PX = Math.round((PAGE_W_MM - MARGIN_MM * 2) * PX_PER_MM);
const CONTENT_H_PX = Math.round((PAGE_H_MM - MARGIN_MM * 2) * PX_PER_MM);

/**
 * Render an element inside a hidden iframe that carries every stylesheet of
 * the app (including @media print rules) laid out at exact A4 content width,
 * then shrink-to-fit so the whole document lands on a single A4 page.
 * Both Print and Download PDF use this so the two outputs are identical.
 */
/**
 * Serialize every same-origin stylesheet into raw CSS text. When `emulatePrint`
 * is set, `@media print` blocks are rewritten to `@media all` so a canvas
 * rasterizer (which never applies print media) sees exactly what the browser's
 * print engine sees.
 */
function collectCss(emulatePrint: boolean): string | null {
  try {
    let css = "";
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = (sheet as CSSStyleSheet).cssRules;
      } catch {
        return null; // cross-origin sheet — cannot read, fall back
      }
      for (const rule of Array.from(rules)) css += rule.cssText + "\n";
    }
    if (!css.trim()) return null;
    if (emulatePrint) css = css.replace(/@media\s+print/gi, "@media all");
    return css;
  } catch {
    return null;
  }
}

async function buildPrintFrame(
  el: HTMLElement,
  docTitle: string,
  applyScale = true,
  emulatePrint = false,
) {
  const inlined = emulatePrint ? collectCss(true) : null;
  const head = inlined
    ? `<style>${inlined}</style>`
    : Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map((n) => n.outerHTML)
        .join("\n");
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = `position:fixed;right:0;bottom:0;width:${CONTENT_W_PX}px;height:${CONTENT_H_PX}px;border:0;opacity:0;pointer-events:none;`;
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  const win = iframe.contentWindow!;
  idoc.open();
  idoc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title>${head}` +
      `<style>html,body{background:#fff;margin:0;padding:0;width:${CONTENT_W_PX}px}` +
      `#pdf-shell{width:${CONTENT_W_PX}px}` +
      `#pdf-root{width:${CONTENT_W_PX}px;transform-origin:top left}` +
        `#pdf-root>*{display:block !important}` +
      `@media print{@page{size:A4;margin:${MARGIN_MM}mm}html,body{width:auto}` +
      `#pdf-shell,#pdf-root{width:${CONTENT_W_PX}px}}</style>` +
      `</head><body><div id="pdf-shell"><div id="pdf-root">${el.outerHTML}</div></div></body></html>`,
  );
  idoc.close();
  await new Promise<void>((resolve) => {
    if (idoc.readyState === "complete") resolve();
    else win.addEventListener("load", () => resolve(), { once: true });
    setTimeout(resolve, 3000);
  });
  try {
    await (idoc as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* ignore */
  }
  await Promise.all(
    Array.from(idoc.images).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.addEventListener("load", () => res(), { once: true });
            img.addEventListener("error", () => res(), { once: true });
            setTimeout(res, 3000);
          }),
    ),
  );
  const root = idoc.getElementById("pdf-root") as HTMLElement;
  const shell = idoc.getElementById("pdf-shell") as HTMLElement;
  // Shrink-to-fit onto exactly one A4 page.
  const h = root.scrollHeight;
  const scale = h > CONTENT_H_PX ? Math.max(0.4, CONTENT_H_PX / h) : 1;
  if (applyScale && scale < 1) {
    root.style.transform = `scale(${scale})`;
    shell.style.height = `${Math.ceil(h * scale)}px`;
    shell.style.overflow = "hidden";
  }
  return { iframe, idoc, win, root, shell, scale };
}

type SaveHandle = {
  createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }>;
};

/**
 * Ask for the "Save as…" location immediately, while the browser still counts
 * the click as a user gesture. Must be called before any awaited rendering
 * work, otherwise Chrome rejects the picker and the file drops silently into
 * Downloads instead.
 */
export async function requestPdfSaveLocation(filename: string): Promise<SaveHandle | null | "cancelled"> {
  const anyWin = window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<SaveHandle> };
  if (typeof anyWin.showSaveFilePicker !== "function") return null;
  try {
    return await anyWin.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
    });
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") return "cancelled";
    return null; // picker blocked (e.g. sandboxed frame) — fall back to download
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Save a Blob, using a previously obtained handle or a native picker. */
async function saveBlobWithPicker(blob: Blob, filename: string, handle?: SaveHandle | null) {
  const h = handle ?? (await requestPdfSaveLocation(filename));
  if (h === "cancelled") return;
  if (h) {
    try {
      const writable = await h.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch {
      /* fall through to normal download */
    }
  }
  downloadBlob(blob, filename);
}

/** Print a document, shrunk to fit a single A4 page. */
export async function printElementSinglePage(el: HTMLElement, filename: string) {
  const { iframe, win } = await buildPrintFrame(el, filename.replace(/\.pdf$/i, ""));
  win.focus();
  win.print();
  setTimeout(() => iframe.remove(), 1000);
}

/**
 * Download the document as a real .pdf file (browser save dialog / Downloads
 * folder) — no print dialog. Uses the same print-CSS iframe as printing, so
 * the output matches Print Preview and always fits one A4 page.
 */
export async function saveElementAsPdf(
  el: HTMLElement,
  filename: string,
  saveHandle?: SaveHandle | null | "cancelled",
) {
  if (saveHandle === "cancelled") return;
  // Capture at natural size (no CSS transform, so layout is untouched) and let
  // jsPDF scale the resulting image down to fit exactly one A4 page.
  // `emulatePrint` inlines the app CSS with @media print promoted to @media all
  // so the rasterized output matches Print Preview exactly.
  const { iframe, root } = await buildPrintFrame(el, filename.replace(/\.pdf$/i, ""), false, true);
  try {
    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: CONTENT_W_PX,
      width: CONTENT_W_PX,
      height: Math.ceil(root.scrollHeight),
    });
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const availW = PAGE_W_MM - MARGIN_MM * 2;
    const availH = PAGE_H_MM - MARGIN_MM * 2;
    let imgW = availW;
    let imgH = (canvas.height * imgW) / canvas.width;
    if (imgH > availH) {
      imgH = availH;
      imgW = (canvas.width * imgH) / canvas.height;
    }
    pdf.addImage(imgData, "JPEG", MARGIN_MM + (availW - imgW) / 2, MARGIN_MM, imgW, imgH);
    await saveBlobWithPicker(pdf.output("blob"), filename, saveHandle ?? undefined);
  } finally {
    iframe.remove();
  }
}

/**
 * Render an element to PDF using the browser's own print engine, reusing the
 * exact same HTML and CSS (including @media print rules) as Print Preview.
 * Guarantees the "Download PDF" output matches Print exactly, unlike a canvas
 * rasterizer which ignores print media and mis-lays flexbox.
 */
export async function printElementToPdf(el: HTMLElement, filename: string) {
  const docTitle = filename.replace(/\.pdf$/i, "");
  const head = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n) => n.outerHTML)
    .join("\n");
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument!;
  const win = iframe.contentWindow!;
  idoc.open();
  idoc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title>${head}` +
      `<style>html,body{background:#fff;margin:0;padding:0}` +
      `#pdf-root,#pdf-root>*{display:block !important}` +
      `@media print{@page{size:A4;margin:10mm}}</style>` +
      `</head><body><div id="pdf-root">${el.outerHTML}</div></body></html>`,
  );
  idoc.close();
  await new Promise<void>((resolve) => {
    if (idoc.readyState === "complete") resolve();
    else win.addEventListener("load", () => resolve(), { once: true });
    setTimeout(resolve, 3000);
  });
  try {
    await (idoc as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* ignore */
  }
  await Promise.all(
    Array.from(idoc.images).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.addEventListener("load", () => res(), { once: true });
            img.addEventListener("error", () => res(), { once: true });
            setTimeout(res, 3000);
          }),
    ),
  );
  win.focus();
  win.print();
  setTimeout(() => iframe.remove(), 1000);
}

/**
 * Convert a rendered DOM element (typically an on-screen A4 document
 * preview) into a downloaded, multi-page A4 PDF. Because the source is
 * the same DOM used for on-screen preview and printing, the PDF stays
 * automatically in sync with any form / schema changes.
 */
export async function downloadElementAsPdf(
  el: HTMLElement,
  filename: string,
  opts: { fitToOnePage?: boolean } = {},
) {
  const { fitToOnePage = true } = opts;
  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    windowWidth: el.scrollWidth,
  });
  const imgData = canvas.toDataURL("image/jpeg", 0.95);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 5;
  let imgW = pageW - margin * 2;
  let imgH = (canvas.height * imgW) / canvas.width;
  const availH = pageH - margin * 2;

  // Shrink-to-fit so a document that only slightly overflows still lands on a
  // single A4 page instead of spilling a near-empty second page.
  if (fitToOnePage && imgH > availH) {
    const scale = availH / imgH;
    if (scale >= 0.55) {
      imgH = availH;
      imgW = imgW * scale;
      pdf.addImage(imgData, "JPEG", (pageW - imgW) / 2, margin, imgW, imgH);
      pdf.save(filename);
      return;
    }
  }

  let heightLeft = imgH;
  let position = margin;
  pdf.addImage(imgData, "JPEG", margin, position, imgW, imgH);
  heightLeft -= pageH - margin * 2;
  while (heightLeft > 0) {
    position = margin - (imgH - heightLeft);
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", margin, position, imgW, imgH);
    heightLeft -= pageH - margin * 2;
  }
  pdf.save(filename);
}