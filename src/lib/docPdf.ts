import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";

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