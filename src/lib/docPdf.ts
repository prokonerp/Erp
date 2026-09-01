const PX_PER_MM = 96 / 25.4;
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MARGIN_MM = 10;
// Fraction of the printable area the document occupies on the sheet; the rest
// becomes equal breathing room on both sides so the page sits dead-centre.
const DOC_FIT = 0.94;
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
      `@media print{@page{size:A4;margin:${MARGIN_MM}mm !important}html,body{width:auto}` +
      `#pdf-shell,#pdf-root{width:${CONTENT_W_PX}px}` +
      `#pdf-root{transform-origin:center;transform:scale(0.94)}}</style>` +
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

/** Save a Blob directly to the browser's default Downloads folder. */
async function saveBlobWithPicker(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

type Html2Canvas = (
  element: HTMLElement,
  options: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;

type CapturedPage = { dataUrl: string; imgW: number; imgH: number };

/**
 * Rasterize a prepared print frame into one JPEG per printed page, sized so
 * each page lands exactly centred on A4 at ~94% fit (the same geometry the
 * PDF download uses). Shared by the download path and the print path so both
 * outputs are pixel-identical.
 */
async function captureDocImages(
  root: HTMLElement,
  scale: number,
  pages: HTMLElement[] | null,
  html2canvas: Html2Canvas,
): Promise<CapturedPage[]> {
  const availW = PAGE_W_MM - MARGIN_MM * 2;
  const availH = PAGE_H_MM - MARGIN_MM * 2;
  // Capture at natural (untransformed) size so the rasterizer never sees a CSS
  // transform; jsPDF / print then draw each page centred on the sheet.
  const naturalW = Math.round(CONTENT_W_PX / (scale || 1));
  root.style.transform = "none";
  if (!pages) root.style.width = `${naturalW}px`;

  const targets: HTMLElement[] = pages && pages.length ? pages : [root];
  const out: CapturedPage[] = [];
  for (const target of targets) {
    const w = pages ? CONTENT_W_PX : naturalW;
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: w,
      width: w,
      height: Math.ceil(target.scrollHeight),
    });
    const imgW = availW * DOC_FIT;
    const imgH = Math.min(availH, (canvas.height * imgW) / canvas.width);
    out.push({ dataUrl: canvas.toDataURL("image/jpeg", 0.95), imgW, imgH });
  }
  return out;
}

/**
 * Print a document, shrunk to fit a single A4 page.
 *
 * Prints the SAME rasterized capture the PDF download uses, not the live DOM:
 * a browser print dialog's "Margins" setting (None/Minimum/Default) overrides
 * CSS `@page`, which is what used to push the document flush against the left
 * paper edge. A centred <img> inside a full-page flex wrapper is immune to
 * that setting, so Print output always matches Download output.
 */
export async function printElementSinglePage(el: HTMLElement, filename: string) {
  const docTitle = filename.replace(/\.pdf$/i, "");
  const { default: html2canvas } = await import("html2canvas-pro");
  const { iframe, root, scale, pages } = await buildPrintFrame(el, docTitle);
  try {
    const captured = await captureDocImages(root, scale, pages, html2canvas);
    const pageDivs = captured
      .map((p) => `<div class="ppage"><img src="${p.dataUrl}" alt=""></div>`)
      .join("");
    const pframe = document.createElement("iframe");
    pframe.setAttribute("aria-hidden", "true");
    pframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;";
    document.body.appendChild(pframe);
    const pidoc = pframe.contentDocument!;
    const pwin = pframe.contentWindow!;
    pidoc.open();
    pidoc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title>` +
        `<style>html,body{margin:0;padding:0;background:#fff}` +
        `.ppage{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;page-break-after:always;break-after:page;overflow:hidden}` +
        `.ppage:last-child{page-break-after:auto;break-after:auto}` +
        `.ppage img{display:block;max-width:94%;max-height:94%}</style>` +
        `<style>@media print{@page{size:A4;margin:${MARGIN_MM}mm !important}html,body{width:100%;height:100%}}</style>` +
        `</head><body>${pageDivs}</body></html>`,
    );
    pidoc.close();
    await new Promise<void>((resolve) => {
      if (pidoc.readyState === "complete") resolve();
      else pwin.addEventListener("load", () => resolve(), { once: true });
      setTimeout(resolve, 3000);
    });
    pwin.focus();
    pwin.print();
    setTimeout(() => {
      pframe.remove();
      iframe.remove();
    }, 1500);
  } catch (e) {
    iframe.remove();
    throw e;
  }
}

/**
 * Download the document as a real .pdf file (browser save dialog / Downloads
 * folder) — no print dialog. Uses the same print-CSS iframe as printing, so
 * the output matches Print Preview and always fits one A4 page.
 */
async function buildPdfBlob(el: HTMLElement, filename: string): Promise<Blob> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas-pro"),
  ]);
  const { iframe, root, scale, pages } = await buildPrintFrame(el, filename.replace(/\.pdf$/i, ""));
  try {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const availH = PAGE_H_MM - MARGIN_MM * 2;
    const captured = await captureDocImages(root, scale, pages, html2canvas);
    for (let i = 0; i < captured.length; i++) {
      const { dataUrl, imgW, imgH } = captured[i];
      // Centre the document on the sheet. The captured layout is untouched
      // (same px width); only its position on the A4 sheet changes, so the
      // border never sits flush against the page edge.
      const imgX = (PAGE_W_MM - imgW) / 2;
      const imgY = imgH >= availH ? MARGIN_MM : (PAGE_H_MM - imgH) / 2;
      if (i > 0) pdf.addPage();
      pdf.addImage(dataUrl, "JPEG", imgX, imgY, imgW, imgH);
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
async function buildMultiPageFrame(el: HTMLElement, docTitle: string, landscape = false) {
  const head = collectCssText();
  const pw = landscape ? "297mm" : "210mm";
  const ph = landscape ? "210mm" : "297mm";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = `position:fixed;right:0;bottom:0;width:${pw};height:${ph};border:0;opacity:0;pointer-events:none;`;
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
      `@media print{@page{size:A4 ${landscape ? "landscape" : "portrait"};margin:10mm !important}}</style>` +
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

/** Open the browser print dialog for a multi-page A4 document. */
export async function printMultiPageElement(
  el: HTMLElement,
  filename: string,
  opts: { landscape?: boolean } = {},
) {
  const { iframe, win } = await buildMultiPageFrame(el, filename.replace(/\.pdf$/i, ""), !!opts.landscape);
  win.focus();
  win.print();
  setTimeout(() => iframe.remove(), 1000);
}

/** Download a multi-page A4 document as a real .pdf (Save As dialog). */
export async function saveMultiPageElementAsPdf(
  el: HTMLElement,
  filename: string,
  opts: { landscape?: boolean } = {},
) {
  const landscape = !!opts.landscape;
  const { iframe, idoc } = await buildMultiPageFrame(el, filename.replace(/\.pdf$/i, ""), landscape);
  try {
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import("jspdf"),
      import("html2canvas-pro"),
    ]);
    const pages = Array.from(idoc.querySelectorAll<HTMLElement>(".defective-tag-page"));
    const targets = pages.length ? pages : [idoc.body];
    const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
    const availW = (landscape ? PAGE_H_MM : PAGE_W_MM) - MARGIN_MM * 2;
    const availH = (landscape ? PAGE_W_MM : PAGE_H_MM) - MARGIN_MM * 2;
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
      `@media print{@page{size:A4;margin:10mm !important}` +
      `#pdf-root{transform-origin:center;transform:scale(0.94)}}</style>` +
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
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas-pro"),
  ]);
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