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

export async function renderInvoicePdf(args: {
  invoice: InvoiceRow;
  items: InvoiceItemRow[];
  branch: BranchRow | null;
  customer: Customer | null;
}): Promise<jsPDF> {
  const { invoice, items, branch, customer } = args;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const margin = 32;
  let y = margin;

  // Header — company block
  doc.setFont("helvetica", "bold").setFontSize(14);
  doc.text(branch?.name || "Prokon Hi-Tech Systems", margin, y);
  doc.setFont("helvetica", "normal").setFontSize(9);
  y += 14;
  if (branch?.address) {
    doc.text(branch.address, margin, y, { maxWidth: 300 });
    y += 24;
  }
  const line2: string[] = [];
  if (branch?.gstin) line2.push(`GSTIN: ${branch.gstin}`);
  if (branch?.state_name) line2.push(`State: ${branch.state_name} (${branch.state_code || ""})`);
  if (branch?.pan) line2.push(`PAN: ${branch.pan}`);
  if (line2.length) { doc.text(line2.join("  •  "), margin, y); y += 12; }
  const line3: string[] = [];
  if (branch?.phone) line3.push(`Phone: ${branch.phone}`);
  if (branch?.email) line3.push(`Email: ${branch.email}`);
  if (line3.length) { doc.text(line3.join("  •  "), margin, y); y += 12; }

  // Title box
  doc.setDrawColor(0).setLineWidth(0.6);
  doc.rect(margin, y, w - margin * 2, 30);
  doc.setFont("helvetica", "bold").setFontSize(13);
  doc.text("TAX INVOICE", w / 2, y + 20, { align: "center" });
  y += 42;

  // Invoice meta
  const metaLeft = [
    ["Invoice No.", invoice.invoice_no || "—"],
    ["Invoice Date", invoice.invoice_date],
    ["Place of Supply", invoice.place_of_supply || "—"],
  ];
  const metaRight = [
    ["Status", invoice.status.toUpperCase()],
    ["IRN", invoice.irn ? invoice.irn.slice(0, 30) + "…" : "—"],
    ["Ack No.", invoice.ack_no || "—"],
  ];
  doc.setFontSize(9).setFont("helvetica", "normal");
  metaLeft.forEach((r, i) => {
    doc.setFont("helvetica", "bold").text(r[0] + ":", margin, y + i * 13);
    doc.setFont("helvetica", "normal").text(r[1], margin + 80, y + i * 13);
  });
  metaRight.forEach((r, i) => {
    doc.setFont("helvetica", "bold").text(r[0] + ":", w / 2 + 20, y + i * 13);
    doc.setFont("helvetica", "normal").text(r[1], w / 2 + 90, y + i * 13);
  });
  y += 3 * 13 + 8;

  // Bill To / Ship To
  const boxW = (w - margin * 2 - 10) / 2;
  doc.rect(margin, y, boxW, 80);
  doc.rect(margin + boxW + 10, y, boxW, 80);
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text("Bill To", margin + 6, y + 12);
  doc.text("Ship To", margin + boxW + 16, y + 12);
  doc.setFont("helvetica", "normal").setFontSize(9);
  const billLines = [
    invoice.buyer_name || customer?.company || "",
    invoice.billing_address || customer?.billing_address || "",
    invoice.buyer_gstin ? "GSTIN: " + invoice.buyer_gstin : "",
    invoice.buyer_state ? "State: " + invoice.buyer_state : "",
  ].filter(Boolean);
  const shipLines = [
    invoice.buyer_name || customer?.company || "",
    invoice.shipping_address || customer?.shipping_address || invoice.billing_address || "",
  ].filter(Boolean);
  doc.text(billLines.join("\n"), margin + 6, y + 26, { maxWidth: boxW - 10 });
  doc.text(shipLines.join("\n"), margin + boxW + 16, y + 26, { maxWidth: boxW - 10 });
  y += 90;

  // Items table
  const isInter = invoice.is_interstate;
  const head = isInter
    ? [["#", "Description", "HSN", "Qty", "Unit", "Rate", "Disc%", "Taxable", "GST%", "IGST", "Amount"]]
    : [["#", "Description", "HSN", "Qty", "Unit", "Rate", "Disc%", "Taxable", "GST%", "CGST", "SGST", "Amount"]];
  const body = items.map((it) => {
    const base = [
      it.sr_no,
      it.description,
      it.hsn || "",
      it.qty,
      it.unit || "",
      it.rate.toFixed(2),
      it.discount_pct.toFixed(2),
      it.taxable_value.toFixed(2),
      it.gst_rate.toFixed(2),
    ];
    return isInter
      ? [...base, it.igst.toFixed(2), it.line_total.toFixed(2)]
      : [...base, it.cgst.toFixed(2), it.sgst.toFixed(2), it.line_total.toFixed(2)];
  });
  autoTable(doc, {
    startY: y,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [40, 40, 40], textColor: 255 },
    theme: "grid",
    margin: { left: margin, right: margin },
  });
  // @ts-ignore
  y = (doc as any).lastAutoTable.finalY + 8;

  // Totals block (right)
  const totalsRows: Array<[string, string]> = [
    ["Subtotal", inr(invoice.subtotal)],
    ...(invoice.discount ? [["Discount", "− " + inr(invoice.discount)] as [string, string]] : []),
    ["Taxable Value", inr(invoice.taxable_value)],
    ...(isInter
      ? [["IGST", inr(invoice.igst)] as [string, string]]
      : [
          ["CGST", inr(invoice.cgst)] as [string, string],
          ["SGST", inr(invoice.sgst)] as [string, string],
        ]),
    ...(invoice.cess ? [["Cess", inr(invoice.cess)] as [string, string]] : []),
    ...(invoice.round_off
      ? ([["Round Off", (invoice.round_off >= 0 ? "+ " : "− ") + inr(Math.abs(invoice.round_off))]] as [string, string][])
      : []),
    ["GRAND TOTAL", inr(invoice.total)],
  ];
  const tblLeft = w - margin - 220;
  totalsRows.forEach((r, i) => {
    const bold = r[0] === "GRAND TOTAL";
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(bold ? 10 : 9);
    doc.text(r[0], tblLeft, y + i * 14);
    doc.text(r[1], w - margin, y + i * 14, { align: "right" });
  });
  const totalsBottom = y + totalsRows.length * 14 + 4;

  // Amount in words + HSN summary (left)
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text("Amount in Words:", margin, y);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(invoice.total_in_words || amountInWords(invoice.total), margin, y + 13, { maxWidth: tblLeft - margin - 10 });

  y = Math.max(totalsBottom, y + 40) + 8;

  // HSN Summary table
  const hsnRows = hsnSummary(
    items.map((it) => ({
      qty: it.qty,
      rate: it.rate,
      discount_pct: it.discount_pct,
      gst_rate: it.gst_rate,
      taxable_value: it.taxable_value,
      cgst: it.cgst,
      sgst: it.sgst,
      igst: it.igst,
      cess: it.cess,
      line_total: it.line_total,
      hsn: it.hsn,
    })),
  );
  autoTable(doc, {
    startY: y,
    head: [["HSN", "Taxable", "CGST", "SGST", "IGST", "Cess", "Total"]],
    body: hsnRows.map((r) => [r.hsn, r.taxable_value.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.igst.toFixed(2), r.cess.toFixed(2), r.total.toFixed(2)]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [70, 70, 70], textColor: 255 },
    theme: "grid",
    margin: { left: margin, right: margin },
  });
  // @ts-ignore
  y = (doc as any).lastAutoTable.finalY + 10;

  // Bank + QR + Terms
  const bankLines: string[] = [];
  if (branch?.bank_name) bankLines.push("Bank: " + branch.bank_name);
  if (branch?.bank_branch) bankLines.push("Branch: " + branch.bank_branch);
  if (branch?.bank_account) bankLines.push("A/C No: " + branch.bank_account);
  if (branch?.bank_ifsc) bankLines.push("IFSC: " + branch.bank_ifsc);
  if (branch?.upi_id) bankLines.push("UPI ID: " + branch.upi_id);

  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text("Bank Details", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(bankLines.join("\n") || "—", margin, y + 12, { maxWidth: 260 });

  // GST + UPI QR (right side)
  const qrY = y;
  if (invoice.qr_payload) {
    const gstQr = await qrDataUrl(invoice.qr_payload, 160);
    if (gstQr) {
      doc.addImage(gstQr, "PNG", w - margin - 200, qrY, 80, 80);
      doc.setFontSize(7).text("GST e-Invoice QR", w - margin - 200 + 40, qrY + 88, { align: "center" });
    }
  }
  if (branch?.upi_id) {
    const uri = upiPaymentUri({
      upiId: branch.upi_id,
      payeeName: branch.name,
      amount: invoice.total,
      note: invoice.invoice_no || "Invoice",
    });
    const upiQr = await qrDataUrl(uri, 160);
    if (upiQr) {
      doc.addImage(upiQr, "PNG", w - margin - 90, qrY, 80, 80);
      doc.setFontSize(7).text("Scan to Pay (UPI)", w - margin - 90 + 40, qrY + 88, { align: "center" });
    }
  }
  y += 100;

  // Terms
  if (invoice.terms || branch?.invoice_footer) {
    doc.setFont("helvetica", "bold").setFontSize(9);
    doc.text("Terms & Conditions", margin, y);
    doc.setFont("helvetica", "normal").setFontSize(8);
    doc.text(invoice.terms || branch?.invoice_footer || "", margin, y + 12, { maxWidth: w - margin * 2 });
  }

  // Signature
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(`For ${branch?.name || "Prokon Hi-Tech Systems"}`, w - margin, pageH - 50, { align: "right" });
  doc.text("Authorised Signatory", w - margin, pageH - 30, { align: "right" });

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