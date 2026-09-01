import type jsPDF from "jspdf";
import { amountInWords } from "@/lib/gst";
import { type PORow, type POItemRow } from "@/lib/purchaseOrder";
import type { BranchRow } from "@/lib/sales";

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function fmtDMY(d: string | null | undefined): string {
  if (!d) return "";
  const p = d.slice(0, 10).split("-");
  if (p.length !== 3) return d;
  return `${p[2]}-${p[1]}-${p[0]}`;
}

// jsPDF built-in Helvetica lacks the ₹ glyph — renders as "¹".
// Use "Rs. " prefix everywhere in the PDF for reliable rendering.
function inrPdf(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return "Rs. " + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function renderPurchaseOrderPdf(args: {
  po: PORow;
  items: POItemRow[];
  branch: BranchRow | null;
  themeColor?: string;
  settings?: {
    company_name?: string | null;
    company_address?: string | null;
    udyam_no?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
}): Promise<jsPDF> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const { po, items, branch } = args;
  const themeColor = args.themeColor || "#1f3864";
  const [tr, tg, tb] = hexToRgb(themeColor);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const margin = 24;
  const cw = w - margin * 2;

  doc.setDrawColor(tr, tg, tb).setLineWidth(0.7);

  // Resolve company (settings override branch). Never fall back to warehouse.name for company_name.
  const s = args.settings || {};
  const companyName = (s.company_name || "Prokon Hi-Tech Systems").toString();
  const companyAddress = (s.company_address || branch?.address || "").toString();
  const companyGstin = branch?.gstin || "";
  const companyPhone = s.phone || branch?.phone || "";
  const companyEmail = s.email || branch?.email || "";

  // Header
  let y = margin;
  const headerH = 78;
  doc.rect(margin, y, cw, headerH);
  // Left: company
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(tr, tg, tb);
  doc.text(companyName, margin + 10, y + 20);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal").setFontSize(9);
  const addrLines = doc.splitTextToSize(companyAddress, cw * 0.55) as string[];
  let ay = y + 34;
  addrLines.slice(0, 3).forEach((l) => { doc.text(l, margin + 10, ay); ay += 10; });
  if (companyGstin) { doc.setFont("helvetica", "bold"); doc.text(`GSTIN: ${companyGstin}`, margin + 10, ay); ay += 10; doc.setFont("helvetica", "normal"); }
  const c = [companyPhone ? `Tel: ${companyPhone}` : "", companyEmail ? `Email: ${companyEmail}` : ""].filter(Boolean).join("   ");
  if (c) doc.text(c, margin + 10, ay);

  // Right: title
  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(tr, tg, tb);
  doc.text("PURCHASE ORDER", margin + cw - 10, y + 24, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0, 0, 0);
  doc.text(`PO No: ${po.po_no || "—"}`, margin + cw - 10, y + 42, { align: "right" });
  doc.text(`PO Date: ${fmtDMY(po.po_date)}`, margin + cw - 10, y + 55, { align: "right" });
  if (po.delivery_date) doc.text(`Delivery: ${fmtDMY(po.delivery_date)}`, margin + cw - 10, y + 68, { align: "right" });

  y += headerH;

  // Vendor + Delivery blocks
  const boxH = 110;
  const halfW = cw / 2;
  doc.rect(margin, y, halfW, boxH);
  doc.rect(margin + halfW, y, halfW, boxH);

  doc.setFillColor(tr, tg, tb);
  doc.rect(margin, y, halfW, 16, "F");
  doc.rect(margin + halfW, y, halfW, 16, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(9);
  doc.text("VENDOR", margin + 6, y + 11);
  doc.text("DELIVER TO", margin + halfW + 6, y + 11);
  doc.setTextColor(0, 0, 0).setFont("helvetica", "normal").setFontSize(8.5);

  let ly = y + 26;
  const putLines = (lines: string[], x: number, maxW: number, maxLines: number) => {
    const wrapped = lines.flatMap((l) => doc.splitTextToSize(l || "", maxW) as string[]);
    wrapped.slice(0, maxLines).forEach((l) => { doc.text(l, x, ly); ly += 10; });
  };

  const vLines: string[] = [];
  vLines.push(`Name: ${po.vendor_name || "—"}`);
  if (po.vendor_address) vLines.push(po.vendor_address);
  if (po.vendor_gstin) vLines.push(`GSTIN: ${po.vendor_gstin}`);
  if (po.vendor_state_name) vLines.push(`State: ${po.vendor_state_name}${po.vendor_state_code ? ` (${po.vendor_state_code})` : ""}`);
  const cLine = [po.vendor_contact_name, po.vendor_phone, po.vendor_email].filter(Boolean).join(" · ");
  if (cLine) vLines.push(cLine);
  putLines(vLines, margin + 6, halfW - 12, 9);

  ly = y + 26;
  const dType = po.delivery_address_type === "customer" ? "Customer Site" : po.delivery_address_type === "custom" ? "Custom" : "Organization";
  const dLines: string[] = [`Type: ${dType}`];
  if (po.customer_name) dLines.push(`Customer: ${po.customer_name}`);
  if (po.delivery_address) dLines.push(po.delivery_address);
  putLines(dLines, margin + halfW + 6, halfW - 12, 9);

  y += boxH;

  // Items table — includes Warranty per line (default 12 mo, editable)
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8.5, cellPadding: 3.5, lineColor: [tr, tg, tb], lineWidth: 0.3, textColor: 20 },
    headStyles: { fillColor: [tr, tg, tb], textColor: 255, fontStyle: "bold", halign: "center" },
    head: [[
      "#", "Product / Description", "HSN", "Qty", "Unit", "Rate",
      po.is_interstate ? "IGST%" : "GST%", "Warranty", "Amount",
    ]],
    body: items.map((it, i) => [
      String(i + 1),
      it.description,
      it.hsn || "—",
      String(it.qty),
      it.unit || "",
      inrPdf(it.rate),
      `${it.gst_rate}%`,
      `${(it as any).warranty_months ?? 12} mo`,
      inrPdf(it.line_total),
    ]),
    columnStyles: {
      0: { halign: "center", cellWidth: 20 },
      2: { halign: "center", cellWidth: 42 },
      3: { halign: "center", cellWidth: 32 },
      4: { halign: "center", cellWidth: 34 },
      5: { halign: "right", cellWidth: 52 },
      6: { halign: "center", cellWidth: 36 },
      7: { halign: "center", cellWidth: 42 },
      8: { halign: "right", cellWidth: 62 },
    },
  });

  let ty = (doc as any).lastAutoTable.finalY + 8;

  // Totals block — right-aligned column with label left / value right, same column width.
  const totalsW = 260;
  const totalsX = margin + cw - totalsW;
  const labelX = totalsX + 10;
  const valueX = totalsX + totalsW - 10;
  const rows: [string, string][] = [
    ["Subtotal", inrPdf(po.subtotal)],
    ["Discount", inrPdf(po.discount)],
    ["Taxable Value", inrPdf(po.taxable_value)],
  ];
  if (po.is_interstate) rows.push(["IGST", inrPdf(po.igst)]);
  else {
    rows.push(["CGST", inrPdf(po.cgst)]);
    rows.push(["SGST", inrPdf(po.sgst)]);
  }
  if (Number(po.round_off) !== 0) rows.push(["Round Off", inrPdf(po.round_off)]);

  doc.setFont("helvetica", "normal").setFontSize(10);
  rows.forEach(([k, v]) => {
    doc.text(`${k}:`, labelX, ty + 12);
    doc.text(v, valueX, ty + 12, { align: "right" });
    ty += 15;
  });
  doc.setLineWidth(0.5);
  doc.line(totalsX, ty + 3, totalsX + totalsW, ty + 3);
  ty += 8;
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text("Grand Total:", labelX, ty + 12);
  doc.text(inrPdf(po.total), valueX, ty + 12, { align: "right" });
  ty += 22;

  doc.setFont("helvetica", "italic").setFontSize(8);
  const words = po.total_in_words || amountInWords(po.total);
  const wLines = doc.splitTextToSize(`Amount in Words: ${words}`, cw) as string[];
  wLines.slice(0, 2).forEach((l) => { doc.text(l, margin, ty); ty += 10; });

  ty += 8;

  // Payment Terms + Notes/Terms
  doc.setFont("helvetica", "bold").setFontSize(9);
  if (po.payment_terms) {
    doc.text(`Payment Terms:`, margin, ty);
    doc.setFont("helvetica", "normal");
    doc.text(po.payment_terms, margin + 82, ty);
    ty += 14;
  }

  if (po.terms) {
    doc.setFont("helvetica", "bold").setFontSize(9);
    doc.text("Terms & Conditions:", margin, ty);
    ty += 12;
    doc.setFont("helvetica", "normal").setFontSize(8);
    const tLines = doc.splitTextToSize(po.terms, cw) as string[];
    tLines.slice(0, 8).forEach((l) => { doc.text(l, margin, ty); ty += 10; });
  }

  // Signature block
  const pageH = doc.internal.pageSize.getHeight();
  const sigY = Math.max(ty + 30, pageH - 80);
  doc.setLineWidth(0.5);
  doc.line(margin + cw - 180, sigY, margin + cw - 20, sigY);
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  doc.text("Authorized Signatory", margin + cw - 100, sigY + 12, { align: "center" });
  doc.setFont("helvetica", "bold").setFontSize(10);
  doc.text(`For ${companyName}`, margin + cw - 100, sigY - 6, { align: "center" });

  return doc;
}

export async function printPurchaseOrderPdf(args: Parameters<typeof renderPurchaseOrderPdf>[0]): Promise<void> {
  const doc = await renderPurchaseOrderPdf(args);
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) setTimeout(() => { try { win.focus(); win.print(); } catch { /* ignore */ } }, 500);
}

export async function downloadPurchaseOrderPdf(args: Parameters<typeof renderPurchaseOrderPdf>[0], filename: string): Promise<void> {
  const doc = await renderPurchaseOrderPdf(args);
  doc.save(filename);
}