import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { amountInWords, hsnSummary, upiPaymentUri } from "@/lib/gst";
import type { InvoiceRow, InvoiceItemRow, BranchRow } from "@/lib/sales";
import { inr } from "@/lib/sales";

type Customer = {
  company: string;
  billing_address?: string | null;
  shipping_address?: string | null;
  gst?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
};

async function qrDataUrl(text: string, size = 160): Promise<string> {
  try {
    return await QRCode.toDataURL(text, { width: size, margin: 1 });
  } catch {
    return "";
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawRect(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.rect(x, y, w, h);
}

function textLines(doc: jsPDF, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(text || "", maxWidth) as string[];
}

export async function renderInvoicePdf(args: {
  invoice: InvoiceRow;
  items: InvoiceItemRow[];
  branch: BranchRow | null;
  customer: Customer | null;
  themeColor?: string;
  copyLabel?: string;
  settings?: {
    company_name?: string | null;
    company_address?: string | null;
    udyam_no?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  meta?: { vehicle_no?: string | null; po_no?: string | null; po_date?: string | null; payment_terms?: string | null };
}): Promise<jsPDF> {
  const { invoice, items, branch, customer } = args;
  const themeColor = args.themeColor || "#000000";
  const [tr, tg, tb] = hexToRgb(themeColor);
  const copyLabel = args.copyLabel || "Original Copy";
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const cw = w - margin * 2;

  doc.setDrawColor(tr, tg, tb).setLineWidth(0.6);

  // ============ RESOLVE COMPANY (settings override branch) ============
  const s = args.settings || {};
  const companyName = (s.company_name || branch?.name || "").toString();
  const companyAddress = (s.company_address || branch?.address || "").toString();
  const companyGstin = branch?.gstin || "";
  const companyUdyam = s.udyam_no || branch?.cin || "";
  const companyPhone = s.phone || branch?.phone || "";
  const companyEmail = s.email || branch?.email || "";
  if (!companyName) console.error("[invoicePdf] company_name missing in settings/branch");

  // ============ HEADER BOX ============
  const headerH = 82;
  let y = margin;
  drawRect(doc, margin, y, cw, headerH);

  // Logo box (left)
  const logoW = 70;
  doc.setLineWidth(0.4);
  drawRect(doc, margin, y, logoW, headerH);
  doc.setLineWidth(0.6);
  if (branch?.logo_url) {
    try { doc.addImage(branch.logo_url, "JPEG", margin + 6, y + 6, logoW - 12, headerH - 12); } catch { /* ignore */ }
  } else {
    doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(tr, tg, tb);
    const initials = (companyName.split(/\s+/).map((t) => t[0]).filter(Boolean).slice(0, 2).join("") || "").toUpperCase();
    doc.text(initials || "•", margin + logoW / 2, y + headerH / 2, { align: "center", baseline: "middle" });
    doc.setTextColor(0, 0, 0);
  }

  // Copy label (right)
  const copyW = 78;
  drawRect(doc, margin + cw - copyW, y, copyW, 14);
  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(tr, tg, tb);
  doc.text(copyLabel, margin + cw - copyW / 2, y + 10, { align: "center" });
  doc.setTextColor(0, 0, 0);

  // Center block
  const cx = margin + logoW + (cw - logoW - copyW) / 2;
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(tr, tg, tb);
  doc.text("TAX INVOICE", cx, y + 11, { align: "center" });
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold").setFontSize(13);
  doc.text(companyName.toUpperCase(), cx, y + 24, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(8);
  const addrLines = textLines(doc, companyAddress, cw - logoW - copyW - 20);
  let ay = y + 35;
  addrLines.slice(0, 2).forEach((ln) => { doc.text(ln, cx, ay, { align: "center" }); ay += 9; });
  const idParts: string[] = [];
  if (companyGstin) idParts.push(`GSTIN: ${companyGstin}`);
  if (companyUdyam) idParts.push(`Udyam No: ${companyUdyam}`);
  if (idParts.length) { doc.setFont("helvetica", "bold"); doc.text(idParts.join("  |  "), cx, ay, { align: "center" }); ay += 9; doc.setFont("helvetica", "normal"); }
  const contact = [companyPhone ? `Phone: ${companyPhone}` : "", companyEmail ? `Email: ${companyEmail}` : ""].filter(Boolean).join("  |  ");
  if (contact) doc.text(contact, cx, ay, { align: "center" });

  y += headerH;

  // ============ META (2 col grid) ============
  const metaH = 62;
  const halfW = cw / 2;
  drawRect(doc, margin, y, cw, metaH);
  doc.line(margin + halfW, y, margin + halfW, y + metaH);
  const metaRowH = metaH / 5;
  for (let i = 1; i < 5; i++) {
    doc.setLineWidth(0.25);
    doc.line(margin, y + i * metaRowH, margin + cw, y + i * metaRowH);
  }
  doc.setLineWidth(0.6);

  const leftMeta: [string, string][] = [
    ["Invoice No.", invoice.invoice_no || "—"],
    ["Date", invoice.invoice_date],
    ["Place of Supply", invoice.place_of_supply || "—"],
    ["Reverse Charge", invoice.reverse_charge ? "Yes" : "No"],
    ["Vehicle No.", args.meta?.vehicle_no || "—"],
  ];
  const rightMeta: [string, string][] = [
    ["E-Way Bill No.", invoice.ewaybill_no || "—"],
    ["Payment Terms", args.meta?.payment_terms || ""],
    ["PO No.", args.meta?.po_no || ""],
    ["PO Date", args.meta?.po_date || ""],
    ["Due Date", invoice.due_date ? (() => { const [Y,M,D] = invoice.due_date!.slice(0,10).split("-"); return `${D}-${M}-${Y}`; })() : "—"],
  ];
  doc.setFontSize(8.5);
  leftMeta.forEach((r, i) => {
    const yy = y + i * metaRowH + metaRowH / 2 + 2;
    doc.setFont("helvetica", "bold").text(r[0] + ":", margin + 6, yy);
    doc.setFont("helvetica", "normal").text(r[1], margin + 100, yy);
  });
  rightMeta.forEach((r, i) => {
    const yy = y + i * metaRowH + metaRowH / 2 + 2;
    doc.setFont("helvetica", "bold").text(r[0] + ":", margin + halfW + 6, yy);
    doc.setFont("helvetica", "normal").text(r[1], margin + halfW + 100, yy);
  });
  y += metaH;

  // ============ BILL TO / SHIP TO ============
  const partyH = 70;
  drawRect(doc, margin, y, halfW, partyH);
  drawRect(doc, margin + halfW, y, halfW, partyH);
  // Title bars
  doc.setFillColor(tr, tg, tb);
  doc.rect(margin, y, halfW, 12, "F");
  doc.rect(margin + halfW, y, halfW, 12, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(8.5);
  doc.text("Billed to:", margin + 6, y + 9);
  doc.text("Shipped to:", margin + halfW + 6, y + 9);
  doc.setTextColor(0, 0, 0);

  const billName = invoice.buyer_name || customer?.company || "";
  const billAddr = invoice.billing_address || customer?.billing_address || "";
  const shipAddr = invoice.shipping_address || customer?.shipping_address || billAddr;
  const buyerState = invoice.buyer_state || customer?.state || "";
  const buyerGst = invoice.buyer_gstin || customer?.gst || "";
  const buyerPhone = customer?.phone || "";

  const drawParty = (name: string, addr: string, x0: number) => {
    let py = y + 12 + 10;
    doc.setFont("helvetica", "bold").setFontSize(9);
    doc.text(name || "—", x0 + 6, py, { maxWidth: halfW - 12 });
    py += 11;
    doc.setFont("helvetica", "normal").setFontSize(8);
    const addrLn = textLines(doc, addr || "—", halfW - 12).slice(0, 3);
    addrLn.forEach((ln) => { doc.text(ln, x0 + 6, py); py += 9; });
    if (buyerState) { doc.text(`State: ${buyerState}`, x0 + 6, py); py += 9; }
    if (buyerGst) {
      doc.setFont("helvetica", "bold");
      doc.text(`GSTIN: ${buyerGst}`, x0 + 6, py);
      doc.setFont("helvetica", "normal");
      py += 9;
    }
    if (buyerPhone) { doc.text(`Mob: ${buyerPhone}`, x0 + 6, py); }
  };
  drawParty(billName, billAddr, margin);
  drawParty(billName, shipAddr, margin + halfW);
  doc.setLineWidth(0.6);
  y += partyH;

  // ============ E-INVOICE ROW (IRN / Ack No / Ack Date) ============
  const eiH = 16;
  drawRect(doc, margin, y, cw, eiH);
  doc.setFont("helvetica", "bold").setFontSize(8);
  const ackDateFmt = invoice.ack_date
    ? (() => { const d = new Date(invoice.ack_date!); const dd = String(d.getDate()).padStart(2,"0"); const mm = String(d.getMonth()+1).padStart(2,"0"); return `${dd}-${mm}-${d.getFullYear()}`; })()
    : "";
  const col = cw / 3;
  const drawEi = (label: string, val: string, x: number) => {
    doc.setFont("helvetica", "bold").text(label + ":", x + 6, y + 11);
    const lw = doc.getTextWidth(label + ": ");
    doc.setFont("helvetica", "normal").text(val || "—", x + 6 + lw + 2, y + 11);
  };
  drawEi("IRN", invoice.irn || "", margin);
  doc.line(margin + col, y, margin + col, y + eiH);
  drawEi("Ack No", invoice.ack_no || "", margin + col);
  doc.line(margin + col * 2, y, margin + col * 2, y + eiH);
  drawEi("Ack Date", ackDateFmt, margin + col * 2);
  y += eiH;

  // ============ ITEMS TABLE ============
  const isInter = invoice.is_interstate;
  const head = isInter
    ? [["S.N.", "Description of Goods", "HSN/SAC", "Qty", "Unit", "List Price", "Disc", "IGST %", "IGST Amt", "Amount (Rs.)"]]
    : [["S.N.", "Description of Goods", "HSN/SAC", "Qty", "Unit", "List Price", "Disc", "CGST %", "CGST Amt", "SGST %", "SGST Amt", "Amount (Rs.)"]];
  const body = items.map((it) => {
    const half = it.gst_rate / 2;
    const serials = (it as any).serial_numbers as string[] | null | undefined;
    const desc = serials && serials.length > 0
      ? `${it.description}\nSerial No: ${serials.join(", ")}`
      : it.description;
    const base = [
      String(it.sr_no),
      desc,
      it.hsn || "",
      String(it.qty),
      it.unit || "Nos",
      it.rate.toFixed(2),
      it.discount_pct ? it.discount_pct.toFixed(2) + "%" : "-",
    ];
    return isInter
      ? [...base, it.gst_rate.toFixed(2), it.igst.toFixed(2), it.line_total.toFixed(2)]
      : [...base, half.toFixed(2), it.cgst.toFixed(2), half.toFixed(2), it.sgst.toFixed(2), it.line_total.toFixed(2)];
  });

  autoTable(doc, {
    startY: y,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 3, lineColor: [tr, tg, tb], lineWidth: 0.4, textColor: [0, 0, 0] },
    headStyles: { fillColor: [tr, tg, tb], textColor: 255, fontStyle: "bold", halign: "center" },
    bodyStyles: { valign: "top" },
    columnStyles: isInter
      ? {
          0: { halign: "center", cellWidth: 24 },
          1: { halign: "left" },
          2: { halign: "center", cellWidth: 50 },
          3: { halign: "center", cellWidth: 30 },
          4: { halign: "center", cellWidth: 32 },
          5: { halign: "right", cellWidth: 50 },
          6: { halign: "right", cellWidth: 36 },
          7: { halign: "right", cellWidth: 42 },
          8: { halign: "right", cellWidth: 52 },
          9: { halign: "right", cellWidth: 60 },
        }
      : {
          0: { halign: "center", cellWidth: 22 },
          1: { halign: "left" },
          2: { halign: "center", cellWidth: 46 },
          3: { halign: "center", cellWidth: 26 },
          4: { halign: "center", cellWidth: 28 },
          5: { halign: "right", cellWidth: 48 },
          6: { halign: "right", cellWidth: 32 },
          7: { halign: "right", cellWidth: 36 },
          8: { halign: "right", cellWidth: 44 },
          9: { halign: "right", cellWidth: 36 },
          10: { halign: "right", cellWidth: 44 },
          11: { halign: "right", cellWidth: 56 },
        },
    theme: "grid",
    margin: { left: margin, right: margin },
  });
  // @ts-ignore
  y = (doc as any).lastAutoTable.finalY;

  // ============ ROUND OFF + GRAND TOTAL ============
  const totalsW = 220;
  const totalsX = margin + cw - totalsW;
  const labelX = totalsX + 8;
  const valueX = totalsX + totalsW - 8;
  doc.setLineWidth(0.4);
  // Left spacer box aligned with totals column
  drawRect(doc, margin, y, cw - totalsW, 36);
  // Rounded off row (right column)
  drawRect(doc, totalsX, y, totalsW, 18);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(0, 0, 0);
  doc.text(`Rounded Off (${(invoice.round_off || 0) >= 0 ? "+" : "-"})`, labelX, y + 12);
  doc.text(inr(Math.abs(invoice.round_off || 0)), valueX, y + 12, { align: "right" });
  // Grand total row (right column, filled)
  doc.setFillColor(tr, tg, tb);
  doc.rect(totalsX, y + 18, totalsW, 18, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(10);
  doc.text("GRAND TOTAL", labelX, y + 30);
  doc.text(inr(invoice.total), valueX, y + 30, { align: "right" });
  doc.setTextColor(0, 0, 0);
  doc.setLineWidth(0.6);
  y += 36;

  // ============ TAX SUMMARY ROW ============
  const rateGroups = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  items.forEach((it) => {
    const g = rateGroups.get(it.gst_rate) || { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable += it.taxable_value; g.cgst += it.cgst; g.sgst += it.sgst; g.igst += it.igst;
    rateGroups.set(it.gst_rate, g);
  });
  const rateHead = isInter
    ? [["Tax Rate", "Taxable Amt", "IGST Amt", "Total Tax"]]
    : [["Tax Rate", "Taxable Amt", "CGST Amt", "SGST Amt", "Total Tax"]];
  const rateBody = Array.from(rateGroups.entries()).map(([rate, g]) => {
    const total = g.cgst + g.sgst + g.igst;
    return isInter
      ? [rate.toFixed(2) + "%", g.taxable.toFixed(2), g.igst.toFixed(2), total.toFixed(2)]
      : [rate.toFixed(2) + "%", g.taxable.toFixed(2), g.cgst.toFixed(2), g.sgst.toFixed(2), total.toFixed(2)];
  });
  autoTable(doc, {
    startY: y,
    head: rateHead,
    body: rateBody,
    styles: { fontSize: 8, cellPadding: 3, lineColor: [tr, tg, tb], lineWidth: 0.4, halign: "right" },
    headStyles: { fillColor: [tr, tg, tb], textColor: 255, halign: "center" },
    theme: "grid",
    margin: { left: margin, right: margin },
  });
  // @ts-ignore
  y = (doc as any).lastAutoTable.finalY;

  // ============ AMOUNT IN WORDS ============
  const wordsH = 20;
  drawRect(doc, margin, y, cw, wordsH);
  doc.setFont("helvetica", "bold").setFontSize(8.5);
  doc.text("Amount (in words):", margin + 6, y + 13);
  doc.setFont("helvetica", "normal");
  doc.text(invoice.total_in_words || amountInWords(invoice.total), margin + 110, y + 13, { maxWidth: cw - 120 });
  y += wordsH;

  // ============ BANK DETAILS ============
  const bankH = 60;
  drawRect(doc, margin, y, cw, bankH);
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(tr, tg, tb);
  doc.text("Bank Details", margin + 6, y + 12);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  const bankRows = [
    ["Bank", branch?.bank_name || "—"],
    ["Account No", branch?.bank_account || "—"],
    ["IFSC Code", branch?.bank_ifsc || "—"],
  ];
  bankRows.forEach((r, i) => {
    const yy = y + 26 + i * 11;
    doc.setFont("helvetica", "bold").text(r[0] + ":", margin + 6, yy);
    doc.setFont("helvetica", "normal").text(r[1], margin + 70, yy);
  });
  if (branch?.bank_branch) doc.text(`Branch: ${branch.bank_branch}`, margin + 260, y + 26);
  if (branch?.upi_id) doc.text(`UPI: ${branch.upi_id}`, margin + 260, y + 37);
  y += bankH;

  // ============ FOOTER — 3 COLUMN GRID ============
  const footerH = 130;
  const col1W = cw * 0.42;
  const col2W = cw * 0.22;
  const col3W = cw - col1W - col2W;
  drawRect(doc, margin, y, col1W, footerH);
  drawRect(doc, margin + col1W, y, col2W, footerH);
  drawRect(doc, margin + col1W + col2W, y, col3W, footerH);

  // Terms
  doc.setFillColor(tr, tg, tb);
  doc.rect(margin, y, col1W, 14, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(8.5);
  doc.text("Terms & Conditions", margin + 6, y + 10);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal").setFontSize(8);
  const termsText = invoice.terms || branch?.invoice_footer ||
    "1. Goods once sold will not be taken back\n2. Interest @18% p.a. applicable on delayed payments\n3. Subject to Haryana Jurisdiction";
  const termsLines = textLines(doc, termsText, col1W - 12);
  termsLines.forEach((ln, i) => doc.text(ln, margin + 6, y + 26 + i * 10));

  // QR (center)
  doc.setFillColor(tr, tg, tb);
  doc.rect(margin + col1W, y, col2W, 14, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(8.5);
  doc.text("Payment QR", margin + col1W + col2W / 2, y + 10, { align: "center" });
  doc.setTextColor(0, 0, 0);
  const qrSize = Math.min(col2W - 20, footerH - 30);
  if (branch?.upi_id) {
    const uri = upiPaymentUri({
      upiId: branch.upi_id,
      payeeName: branch.name,
      amount: invoice.total,
      note: invoice.invoice_no || "Invoice",
    });
    const qr = await qrDataUrl(uri, 200);
    if (qr) doc.addImage(qr, "PNG", margin + col1W + (col2W - qrSize) / 2, y + 18, qrSize, qrSize);
  } else if (invoice.qr_payload) {
    const qr = await qrDataUrl(invoice.qr_payload, 200);
    if (qr) doc.addImage(qr, "PNG", margin + col1W + (col2W - qrSize) / 2, y + 18, qrSize, qrSize);
  }

  // Signature (right)
  doc.setFillColor(tr, tg, tb);
  doc.rect(margin + col1W + col2W, y, col3W, 14, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(8.5);
  doc.text("Signatures", margin + col1W + col2W + col3W / 2, y + 10, { align: "center" });
  doc.setTextColor(0, 0, 0);
  const sigX = margin + col1W + col2W;
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text(`For ${companyName.toUpperCase()}`, sigX + col3W - 6, y + 28, { align: "right" });
  // Blank space for physical signature
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  doc.text("Authorised Signatory", sigX + col3W - 6, y + footerH - 8, { align: "right" });

  // Ensure we haven't overflowed
  if (y + footerH > pageH - margin) {
    // no-op — content overflow is expected to be trimmed by autoTable pagination
  }

  return doc;
}

export async function downloadInvoicePdf(args: Parameters<typeof renderInvoicePdf>[0]) {
  const doc = await renderInvoicePdf(args);
  const name = `${args.invoice.invoice_no || "invoice"}.pdf`.replace(/[^\w.\-]+/g, "_");
  doc.save(name);
}

export async function printInvoicePdf(args: Parameters<typeof renderInvoicePdf>[0]) {
  const doc = await renderInvoicePdf(args);
  const url = doc.output("bloburl");
  window.open(url, "_blank");
}