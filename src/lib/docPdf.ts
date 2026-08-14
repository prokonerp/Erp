import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";

const PX_PER_MM = 96 / 25.4;
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 10;
const CONTENT_W_PX = Math.round((PAGE_W_MM - MARGIN_MM * 2) * PX_PER_MM);
const CONTENT_H_PX = Math.round((PAGE_H_MM - MARGIN_MM * 2) * PX_PER_MM);

/**
 * Collect every CSS rule of the app as *inline* text.
 *
 * Copying `<link rel="stylesheet">` tags into the capture iframe means the
 * iframe has to re-fetch and re-parse the CSS; if that request is slow, blocked
 * by the cache, or races the capture, the document rasterizes completely
 * unstyled — which renders as one narrow vertical column with no table borders
 * or left/right alignment. Reading the already-parsed rules out of the CSSOM
 * and inlining them makes styling synchronous and impossible to miss.
 */
function collectCssText() {
  let css = "";
  const fallbacks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = (sheet as CSSStyleSheet).cssRules;
      if (!rules) throw new Error("no rules");
      for (const rule of Array.from(rules)) css += rule.cssText + "\n";
    } catch {
      // Cross-origin sheet — fall back to re-linking it in the iframe.
      const node = sheet.ownerNode as HTMLElement | null;
      if (node) fallbacks.push(node.outerHTML);
    }
  }
  return `${fallbacks.join("\n")}\n<style>${css}</style>`;
}

/**
 * Render an element inside a hidden iframe that carries every stylesheet of
 * the app (including @media print rules) laid out at exact A4 content width,
 * then shrink-to-fit so the whole document lands on a single A4 page.
 * Both Print and Download PDF use this so the two outputs are identical.
 */
/** Minimum readable shrink; below this we paginate instead of compressing. */
const MIN_READABLE_SCALE = 0.7;

/**
 * Split a rendered document element into multiple A4 pages.
 *
 * Reuses the repeated-header pattern of the GRN report: everything before the
 * item table (company header, Bill To / Ship To, meta, subject) plus the table
 * column headers repeat at the top of every page; the trailing blocks
 * (totals, bank details, terms, notes, signature) print once after the last
 * item row. A row is never split across pages.
 */
function paginateDoc(idoc: Document, root: HTMLElement): HTMLElement[] | null {
  // The document body is whichever element directly contains the item table
  // (the parent may be a plain print wrapper around the .doc-print block).
  const table = root.querySelector("table.items") as HTMLTableElement | null;
  const docEl = table?.parentElement as HTMLElement | null;
  const tbody = table?.querySelector("tbody");
  if (!table || !docEl || !tbody) return null;
  const outer = root.firstElementChild as HTMLElement | null;
  const children = Array.from(docEl.children);
  const ti = children.indexOf(table);
  const headNodes = children.slice(0, ti);
  const tailNodes = children.slice(ti + 1);
  const rows = Array.from(tbody.children) as HTMLElement[];
  if (!rows.length) return null;
  const makePage = () => {
    const page = docEl.cloneNode(false) as HTMLElement;
    page.classList.add("pdf-page");
    page.style.minHeight = "0";
    for (const n of headNodes) page.appendChild(n.cloneNode(true));
    const t = table.cloneNode(false) as HTMLTableElement;
    const thead = table.querySelector("thead");
    if (thead) t.appendChild(thead.cloneNode(true));
    const tb = idoc.createElement("tbody");
    t.appendChild(tb);
    page.appendChild(t);
    return { page, tb, t };
  };
  const holder = idoc.createElement("div");
  holder.style.cssText = `width:${CONTENT_W_PX}px;position:absolute;left:-99999px;top:0;`;
  idoc.body.appendChild(holder);
  const pages: HTMLElement[] = [];
  let cur = makePage();
  holder.appendChild(cur.page);
  let i = 0;
  while (i < rows.length) {
    const row = rows[i].cloneNode(true) as HTMLElement;
    cur.tb.appendChild(row);
    if (cur.page.scrollHeight > CONTENT_H_PX && cur.tb.children.length > 1) {
      cur.tb.removeChild(row);
      pages.push(cur.page);
      holder.removeChild(cur.page);
      cur = makePage();
      holder.appendChild(cur.page);
      continue; // retry the same row on a fresh page
    }
    i++;
  }
  // Trailing blocks follow the last item row; if they don't fit, move to a new page.
  const tailClones = tailNodes.map((n) => n.cloneNode(true) as HTMLElement);
  for (const n of tailClones) cur.page.appendChild(n);
  if (cur.page.scrollHeight > CONTENT_H_PX) {
    for (const n of tailClones) cur.page.removeChild(n);
    pages.push(cur.page);
    holder.removeChild(cur.page);
    cur = makePage();
    holder.appendChild(cur.page);
    cur.t.remove(); // no item rows on the trailing page
    for (const n of tailClones) cur.page.appendChild(n);
  }
  pages.push(cur.page);
  holder.remove();
  if (pages.length < 2) return null;
  root.innerHTML = "";
  for (const p of pages) {
    if (outer && outer !== docEl) {
      // preserve the wrapper's classes/styles around each page
      const wrap = outer.cloneNode(false) as HTMLElement;
      wrap.appendChild(p);
      root.appendChild(wrap);
    } else {
      root.appendChild(p);
    }
  }
  return pages;
}

async function buildPrintFrame(el: HTMLElement, docTitle: string) {
  const head = collectCssText();
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
      `.pdf-page{page-break-after:always;break-after:page}` +
      `.pdf-page:last-child{page-break-after:auto;break-after:auto}` +
      `.pdf-page tr{page-break-inside:avoid;break-inside:avoid}` +
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
  // Shrink-to-fit onto one A4 page, but only down to a readable minimum.
  let scale = 1;
  if (root.scrollHeight > CONTENT_H_PX) {
    scale = CONTENT_H_PX / root.scrollHeight;
    // Lay out wider so that after the CSS scale the content still spans the
    // full printable width (no blank left/right margins), then re-clamp.
    root.style.width = `${CONTENT_W_PX / scale}px`;
    scale = Math.min(1, CONTENT_H_PX / root.scrollHeight);
  }
  let pages: HTMLElement[] | null = null;
  const fitScale = scale;
  if (scale < MIN_READABLE_SCALE) {
    // Too tall to shrink readably — split into real pages at 100% size.
    root.style.width = `${CONTENT_W_PX}px`;
    scale = 1;
    pages = paginateDoc(idoc, root);
    // Not splittable (e.g. only a couple of item rows) — fall back to shrinking.
    if (!pages) scale = fitScale;
  }
  if (!pages && scale < 1) {
    root.style.width = `${CONTENT_W_PX / scale}px`;
    root.style.transform = `scale(${scale})`;
    shell.style.height = `${Math.ceil(root.scrollHeight * scale)}px`;
    shell.style.overflow = "hidden";
  } else {
    root.style.width = `${CONTENT_W_PX}px`;
  }
  return { iframe, idoc, win, root, shell, scale, pages };
}

/** Save a Blob, offering a native "Save as…" location picker when supported. */
async function saveBlobWithPicker(blob: Blob, filename: string) {
  const anyWin = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<{
      createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };
  if (typeof anyWin.showSaveFilePicker === "function") {
    try {
      const handle = await anyWin.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return; // user cancelled
      // fall through to normal download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
async function buildPdfBlob(el: HTMLElement, filename: string): Promise<Blob> {
  const { iframe, root, scale, pages } = await buildPrintFrame(el, filename.replace(/\.pdf$/i, ""));
  try {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const availW = PAGE_W_MM - MARGIN_MM * 2;
    const availH = PAGE_H_MM - MARGIN_MM * 2;

    // Capture at natural (untransformed) size so html2canvas never sees a CSS
    // transform; jsPDF then draws each page at FULL printable width.
    const naturalW = Math.round(CONTENT_W_PX / (scale || 1));
    root.style.transform = "none";
    if (!pages) root.style.width = `${naturalW}px`;

    const targets: HTMLElement[] = pages && pages.length ? pages : [root];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const w = pages ? CONTENT_W_PX : naturalW;
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: w,
        width: w,
        height: Math.ceil(target.scrollHeight),
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const imgW = availW; // always full page width — no side margins
      const imgH = Math.min(availH, (canvas.height * imgW) / canvas.width);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", MARGIN_MM, MARGIN_MM, imgW, imgH);
    }
    return pdf.output("blob");
  } finally {
    iframe.remove();
  }
}

export async function saveElementAsPdf(el: HTMLElement, filename: string) {
  const blob = await buildPdfBlob(el, filename);
  await saveBlobWithPicker(blob, filename);
}

/**
 * Print / download a multi-page A4 portrait document (e.g. sheets of defective
 * tags) using the same inlined-CSS iframe as every other document, so preview
 * and print match exactly and page breaks never split a block.
 */
async function buildMultiPageFrame(el: HTMLElement, docTitle: string) {
  const head = collectCssText();
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
      `.defective-tag-page{page-break-after:always;break-after:page}` +
      `.defective-tag-page:last-child{page-break-after:auto;break-after:auto}` +
      `.break-inside-avoid,.defective-tag{page-break-inside:avoid;break-inside:avoid}` +
      `@media print{@page{size:A4 portrait;margin:10mm}}</style>` +
      `</head><body>${el.outerHTML}</body></html>`,
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
  return { iframe, idoc, win };
}

/** Open the browser print dialog for a multi-page A4 portrait document. */
export async function printMultiPageElement(el: HTMLElement, filename: string) {
  const { iframe, win } = await buildMultiPageFrame(el, filename.replace(/\.pdf$/i, ""));
  win.focus();
  win.print();
  setTimeout(() => iframe.remove(), 1000);
}

/** Download a multi-page A4 portrait document as a real .pdf (Save As dialog). */
export async function saveMultiPageElementAsPdf(el: HTMLElement, filename: string) {
  const { iframe, idoc } = await buildMultiPageFrame(el, filename.replace(/\.pdf$/i, ""));
  try {
    const pages = Array.from(idoc.querySelectorAll<HTMLElement>(".defective-tag-page"));
    const targets = pages.length ? pages : [idoc.body];
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const availW = PAGE_W_MM - MARGIN_MM * 2;
    const availH = PAGE_H_MM - MARGIN_MM * 2;
    for (let i = 0; i < targets.length; i++) {
      const canvas = await html2canvas(targets[i], {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      let imgW = availW;
      let imgH = (canvas.height * imgW) / canvas.width;
      if (imgH > availH) {
        imgH = availH;
        imgW = (canvas.width * imgH) / canvas.height;
      }
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", MARGIN_MM + (availW - imgW) / 2, MARGIN_MM, imgW, imgH);
    }
    await saveBlobWithPicker(pdf.output("blob"), filename);
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
  const head = collectCssText();
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