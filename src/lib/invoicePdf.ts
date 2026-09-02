import type jsPDF from "jspdf";
import { amountInWords, hsnSummary, rateSummary, upiPaymentUri } from "@/lib/gst";
import type { InvoiceRow, InvoiceItemRow, BranchRow } from "@/lib/sales";
import { inr } from "@/lib/sales";
import type { CompanyProfile } from "@/lib/companyProfile";
import { getCompany } from "@/lib/letterhead";
import { fetchSignatureDataUrl, getImageDimensions } from "@/lib/signaturePdfHelpers";

type Customer = {
  company: string;
  billing_address?: string | null;
  shipping_address?: string | null;
  gst?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
};

async function qrDataUrl(QRCode: typeof import("qrcode"), text: string, size = 160): Promise<string> {
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

// ── helpers for multi-copy / watermark / signed QR ────────────────────────

function isValidBase64(s: string): boolean {
  const t = s.trim().replace(/\s+/g, "");
  if (!t || t.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}

function tryDecodeBase64(input: string): string | null {
  const s = (input || "").trim().replace(/\s+/g, "");
  if (!s || !isValidBase64(s)) return null;
  try {
    let decoded: string;
    if (typeof atob !== "undefined") {
      decoded = atob(s);
      try {
        // Handle UTF-8 bytes that were base64-encoded
        return decodeURIComponent(escape(decoded));
      } catch {
        return decoded;
      }
    } else if (typeof Buffer !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buf = (Buffer as any).from(s, "base64");
      return buf.toString("utf-8");
    }
  } catch {
    return null;
  }
  return null;
}

function resolveSignedQrPayload(invoice: InvoiceRow): string | null {
  const anyInv = invoice as unknown as Record<string, unknown>;
  // Prefer signed_qr columns when irn exists
  const rawSigned =
    (anyInv["signed_qr"] as string | null) ||
    (anyInv["signedQr"] as string | null) ||
    (anyInv["signedQR"] as string | null) ||
    (anyInv["SignedQRCode"] as string | null) ||
    (anyInv["einvoice_qr"] as string | null) ||
    null;
  const hasIrn = !!invoice.irn;
  if (hasIrn && rawSigned && typeof rawSigned === "string" && rawSigned.trim()) {
    const trimmed = rawSigned.trim();
    const decoded = tryDecodeBase64(trimmed);
    // If decoded looks meaningful (contains irn or is longer), prefer decoded
    if (decoded && decoded.length > 10) {
      // Heuristic: if decoded contains IRN substring or looks like JSON/JWT, use it
      if (invoice.irn && decoded.includes(invoice.irn)) return decoded;
      // JWT has 2 dots; JSON has braces
      if (decoded.includes(".") || decoded.includes("{") || decoded.length < trimmed.length + 20) return decoded;
      return decoded;
    }
    return trimmed;
  }
  // Fallback: qr_payload may itself be base64-encoded signed payload
  if (hasIrn && invoice.qr_payload) {
    const qp = invoice.qr_payload.trim();
    const dec = tryDecodeBase64(qp);
    if (dec && invoice.irn && dec.includes(invoice.irn)) return dec;
  }
  return null;
}

function normalizeCopies(copies: string[] | undefined, copyLabel: string | undefined): string[] {
  if (copies && Array.isArray(copies) && copies.length > 0) {
    return copies.map((c) => String(c || "").trim()).filter(Boolean);
  }
  if (copyLabel && String(copyLabel).trim()) return [String(copyLabel).trim()];
  return ["ORIGINAL"];
}

// M6 fix: normalize mixed boolean / "Y"/"N" / "true"/"1" via single helper (case-insensitive, trims)
export function normalizeYNFlag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    return s === "Y" || s === "YES" || s === "TRUE" || s === "1";
  }
  return false;
}

function isProvisionalInvoice(invoice: InvoiceRow): boolean {
  const anyInv = invoice as unknown as Record<string, unknown>;
  const td = anyInv["transport_details"] as Record<string, unknown> | null | undefined;
  const eReqRaw =
    anyInv["e_invoice_required"] ??
    anyInv["eInvoiceRequired"] ??
    anyInv["e_invoice_reqd"] ??
    (td ? (td["e_invoice_reqd"] as string | undefined) : undefined);
  const eRequired = normalizeYNFlag(eReqRaw);
  // If flag not present, treat as not provisional (explicit opt-in only)
  if (!eRequired) return false;
  const hasIrn = !!invoice.irn;
  const status = String(anyInv["einvoice_status"] || anyInv["einvoiceStatus"] || "").toLowerCase();
  const generated = status === "generated" || hasIrn;
  return !generated;
}

// ── pdf_hash helper: sha256 of actual PDF bytes (subtle crypto with fallback) ───────
async function sha256HexFromBytes(bytes: Uint8Array): Promise<string> {
  try {
    const subtle = (globalThis.crypto as unknown as { subtle?: { digest: (alg: string, data: BufferSource) => Promise<ArrayBuffer> } })?.subtle;
    if (subtle?.digest) {
      const buf = await subtle.digest("SHA-256", bytes as BufferSource);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    /* fallback below */
  }
  // Fallback: simple 32-bit hash over bytes (deterministic over bytes, not cryptographic)
  let h = 0;
  for (let i = 0; i < bytes.length; i++) h = (Math.imul(31, h) + bytes[i]) | 0;
  return Math.abs(h).toString(16).padStart(8, "0");
}

export async function hashPdfDoc(doc: jsPDF): Promise<string> {
  const ab = doc.output("arraybuffer") as ArrayBuffer;
  return sha256HexFromBytes(new Uint8Array(ab));
}

function drawDiagonalWatermark(
  doc: jsPDF,
  text: string,
  opts: { isRed?: boolean; opacity?: number } = {},
) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const isRed = !!opts.isRed;
  const opacity = opts.opacity ?? 0.07;
  const cx = w / 2;
  const cy = h / 2;

  // Try to use GState for real opacity if available (jspdf >=2)
  let pushedGState = false;
  try {
    const GStateCtor = (doc as unknown as Record<string, unknown>)["GState"] as
      | (new (o: Record<string, unknown>) => unknown)
      | undefined;
    const setGState = (doc as unknown as Record<string, unknown>)["setGState"] as
      | ((g: unknown) => unknown)
      | undefined;
    if (GStateCtor && setGState) {
      const gs = new GStateCtor({ opacity });
      (setGState as (g: unknown) => void).call(doc, gs);
      pushedGState = true;
    } else if ((doc as unknown as Record<string, unknown>)["setGState"]) {
      // some builds expose GState on instance
      const instGState = (doc as unknown as { GState?: new (o: Record<string, unknown>) => unknown }).GState;
      if (instGState) {
        const gs2 = new instGState({ opacity });
        (doc as unknown as { setGState: (g: unknown) => void }).setGState(gs2);
        pushedGState = true;
      }
    }
  } catch {
    /* ignore — fallback to solid colour */
  }

  doc.saveGraphicsState?.();
  if (isRed) doc.setTextColor(200, 30, 30);
  else doc.setTextColor(120, 120, 120);
  doc.setFont("helvetica", "bold");
  // Large faint text; auto-scale if very long
  const len = text.length;
  const fontSize = len > 28 ? 36 : len > 18 ? 42 : 48;
  doc.setFontSize(fontSize);
  try {
    doc.text(text, cx, cy, { align: "center", baseline: "middle", angle: 30 } as unknown as Record<string, unknown>);
  } catch {
    // fallback without angle support
    doc.text(text, cx, cy, { align: "center" });
  }
  doc.setTextColor(0, 0, 0);
  // reset opacity
  if (pushedGState) {
    try {
      const GStateCtor = (doc as unknown as Record<string, unknown>)["GState"] as
        | (new (o: Record<string, unknown>) => unknown)
        | undefined;
      const setGState = (doc as unknown as Record<string, unknown>)["setGState"] as
        | ((g: unknown) => unknown)
        | undefined;
      if (GStateCtor && setGState) {
        const gs0 = new GStateCtor({ opacity: 1 });
        (setGState as (g: unknown) => void).call(doc, gs0);
      }
    } catch {
      /* ignore */
    }
  }
  doc.restoreGraphicsState?.();
}

// ── shared single-copy renderer (draws onto current page of `doc`) ─────────

async function renderOneCopyContent(
  doc: jsPDF,
  args: RenderInvoiceArgs,
  copyLabelForPage: string,
  QRCode: typeof import("qrcode"),
  autoTable: (doc: jsPDF, opts: unknown) => void,
  watermark: { isReprint: boolean; isProvisional: boolean; showWatermark: boolean },
  companyCached: CompanyProfile,
) {
  const { invoice, items, branch } = args;
  const customer = args.customer;
  const themeColor = args.themeColor || "#000000";
  const [tr, tg, tb] = hexToRgb(themeColor);
  const w = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const cw = w - margin * 2;

  doc.setDrawColor(tr, tg, tb).setLineWidth(0.6);

  // ============ RESOLVE COMPANY (cached per renderInvoiceCopies — do not call getCompany per copy) ============
  const company = companyCached;
  if (import.meta.env.DEV) console.debug("[invoicePdf] header loaded", company.name);
  const companyName = company.name.toString();
  const companyAddress = company.regd_address.toString();
  const companyGstin = company.gstin || "";
  const companyPhone = company.phone || "";
  const companyEmail = company.email || "";
  const companyWebsite = company.website || "";
  const companyLogo = company.logo_url || "";
  if (!companyName) console.error("[invoicePdf] company_name missing in Company Master");

  // ============ HEADER BOX ============
  const headerH = 82;
  let y = margin;
  drawRect(doc, margin, y, cw, headerH);

  // Logo box (left)
  const logoW = 70;
  doc.setLineWidth(0.4);
  drawRect(doc, margin, y, logoW, headerH);
  doc.setLineWidth(0.6);
  if (companyLogo) {
    try { doc.addImage(companyLogo, "JPEG", margin + 6, y + 6, logoW - 12, headerH - 12); } catch { /* ignore */ }
  } else {
    doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(tr, tg, tb);
    const initials = (companyName.split(/\s+/).map((t) => t[0]).filter(Boolean).slice(0, 2).join("") || "").toUpperCase();
    doc.text(initials || "•", margin + logoW / 2, y + headerH / 2, { align: "center", baseline: "middle" });
    doc.setTextColor(0, 0, 0);
  }

  // Copy label (right) — 78pt box, centered 8.5pt bold with themeColor border
  const copyW = 78;
  doc.setDrawColor(tr, tg, tb);
  drawRect(doc, margin + cw - copyW, y, copyW, 14);
  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(tr, tg, tb);
  // Ensure label fits — uppercase for ORIGINAL/DUPLICATE/TRIPLICATE/OFFICE/EXTRA n
  const labelText = (copyLabelForPage || "ORIGINAL").toString().trim() || "ORIGINAL";
  doc.text(labelText, margin + cw - copyW / 2, y + 10, { align: "center" });
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
  if (idParts.length) { doc.setFont("helvetica", "bold"); doc.text(idParts.join("  |  "), cx, ay, { align: "center" }); ay += 9; doc.setFont("helvetica", "normal"); }
  const contact = [
    companyPhone ? `Phone: ${companyPhone}` : "",
    companyEmail ? `Email: ${companyEmail}` : "",
    companyWebsite ? `Web: ${companyWebsite}` : "",
  ].filter(Boolean).join("  |  ");
  if (contact) doc.text(contact, cx, ay, { align: "center" });

  y += headerH;

  // Watermark: faint diagonal when isReprint or provisional (red)
  // Draw behind content but after header so header border stays crisp — use low opacity
  if (watermark.isProvisional) {
    drawDiagonalWatermark(doc, "PROVISIONAL — IRN PENDING", { isRed: true, opacity: 0.07 });
  } else if (watermark.isReprint) {
    drawDiagonalWatermark(doc, "REPRINT", { isRed: false, opacity: 0.07 });
  } else if (watermark.showWatermark) {
    // Generic faint copy watermark when explicitly requested
    drawDiagonalWatermark(doc, labelText, { isRed: false, opacity: 0.07 });
  }

  // ============ OPTIONAL: SUPPLY FROM (warehouse/branch, small text) ============
  if (args.showSupplyFrom && branch?.name) {
    const supplyH = 12;
    doc.setFont("helvetica", "italic").setFontSize(7.5).setTextColor(90, 90, 90);
    doc.text(`Supply From: ${branch.name}`, margin + 4, y + 8);
    doc.setTextColor(0, 0, 0);
    y += supplyH;
  }

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

  // M9: Exp/Port line for SEZ/Export when update_port_address present (non-destructive)
  {
    const tdForPdf = (invoice as unknown as Record<string, unknown>)["transport_details"] as
      | { update_port_address?: string | null }
      | null
      | undefined;
    const stForPdf = String((invoice as unknown as Record<string, unknown>)["sales_type"] ?? "").toLowerCase();
    const isSezExpPdf = stForPdf.startsWith("sez") || stForPdf.startsWith("export") || stForPdf.startsWith("exp");
    const portAddrPdf = tdForPdf?.update_port_address ? String(tdForPdf.update_port_address).trim() : "";
    if (isSezExpPdf && portAddrPdf) {
      const expH = 14;
      drawRect(doc, margin, y, cw, expH);
      doc.setFont("helvetica", "bold").setFontSize(7.5);
      doc.text(`Exp/Port: ${portAddrPdf.slice(0, 100)}`, margin + 6, y + 9.5);
      doc.setFont("helvetica", "normal");
      y += expH;
    }
  }

  // ============ ITEMS TABLE ============
  const isInter = invoice.is_interstate;
  const head = isInter
    ? [["S.N.", "Description of Goods", "HSN/SAC", "Qty", "Unit", "List Price", "Disc", "IGST %", "IGST Amt", "Amount (Rs.)"]]
    : [["S.N.", "Description of Goods", "HSN/SAC", "Qty", "Unit", "List Price", "Disc", "CGST %", "CGST Amt", "SGST %", "SGST Amt", "Amount (Rs.)"]];
  const body = items.map((it) => {
    const half = it.gst_rate / 2;
    const serials = (it as unknown as Record<string, unknown>).serial_numbers as string[] | null | undefined;
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
  y = (doc as unknown as Record<string, unknown>).lastAutoTable
    ? ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY as number)
    : y + 40;

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
  // H15 fix: unified via gst.ts rateSummary (single source of truth, r2-rounded) instead of
  // local Map duplication that drifted from hsnSummary rounding.
  void hsnSummary; // keep import used (HSN annex available if template needs it)
  const rateRows = rateSummary(items as unknown as Array<import("@/lib/gst").GstItemBreakup & { gst_rate: number }>);
  const rateHead = isInter
    ? [["Tax Rate", "Taxable Amt", "IGST Amt", "Total Tax"]]
    : [["Tax Rate", "Taxable Amt", "CGST Amt", "SGST Amt", "Total Tax"]];
  const rateBody = rateRows.map((g) => {
    const total = g.cgst + g.sgst + g.igst;
    return isInter
      ? [g.gst_rate.toFixed(2) + "%", g.taxable_value.toFixed(2), g.igst.toFixed(2), total.toFixed(2)]
      : [g.gst_rate.toFixed(2) + "%", g.taxable_value.toFixed(2), g.cgst.toFixed(2), g.sgst.toFixed(2), total.toFixed(2)];
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
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
    ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
    : y + 20;

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

  // QR (center) — prefer signed_qr over qr_payload when irn exists (decode base64 if needed)
  doc.setFillColor(tr, tg, tb);
  doc.rect(margin + col1W, y, col2W, 14, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(8.5);
  doc.text("Payment QR", margin + col1W + col2W / 2, y + 10, { align: "center" });
  doc.setTextColor(0, 0, 0);
  const qrSize = Math.min(col2W - 20, footerH - 30);
  const signedPayload = resolveSignedQrPayload(invoice);
  let qrText: string | null = null;
  if (signedPayload) {
    qrText = signedPayload;
  } else if (invoice.qr_payload) {
    qrText = invoice.qr_payload;
  } else if (branch?.upi_id) {
    qrText = upiPaymentUri({
      upiId: branch.upi_id,
      payeeName: companyName,
      amount: invoice.total,
      note: invoice.invoice_no || "Invoice",
    });
  }
  // If both signed payload and UPI exist, signed wins when irn present per spec
  if (qrText) {
    const qrData = await qrDataUrl(QRCode, qrText, 200);
    if (qrData) doc.addImage(qrData, "PNG", margin + col1W + (col2W - qrSize) / 2, y + 18, qrSize, qrSize);
  }

  // Signature (right) — try to embed authorised signature image above signatory line
  doc.setFillColor(tr, tg, tb);
  doc.rect(margin + col1W + col2W, y, col3W, 14, "F");
  doc.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(8.5);
  doc.text("Signatures", margin + col1W + col2W + col3W / 2, y + 10, { align: "center" });
  doc.setTextColor(0, 0, 0);
  const sigX = margin + col1W + col2W;
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text(`For ${companyName.toUpperCase()}`, sigX + col3W - 6, y + 28, { align: "right" });
  // Embed signature image if available (max 110×38 pt centered inside col3)
  if (args.authorisedSignatureUrl) {
    try {
      const sig = await fetchSignatureDataUrl(args.authorisedSignatureUrl);
      if (sig && sig.dataUrl) {
        let iw = 110;
        let ih = 38;
        try {
          const dims = await getImageDimensions(sig.dataUrl);
          if (dims && dims.w && dims.h) {
            const scale = Math.min(110 / dims.w, 38 / dims.h, 1);
            iw = dims.w * scale;
            ih = dims.h * scale;
          }
        } catch { /* keep default */ }
        const cx2 = sigX + col3W / 2;
        const x = cx2 - iw / 2;
        const yImg = y + 38 + (46 - ih) / 2;
        const fmt = sig.format === "JPEG" ? "JPEG" : "PNG";
        doc.addImage(sig.dataUrl, fmt as unknown as string, x, yImg, iw, ih);
      }
    } catch (e) {
      console.warn("[invoice PDF] signature embed failed", e);
    }
  }
  doc.setFont("helvetica", "normal").setFontSize(8.5);
  doc.text("Authorised Signatory", sigX + col3W - 6, y + footerH - 8, { align: "right" });
  if (args.preparedBy?.name) {
    try {
      doc.setFont("helvetica", "normal").setFontSize(6.5);
      doc.setTextColor(80, 80, 80);
      doc.text(String(args.preparedBy.name).slice(0, 32), sigX + col3W - 6, y + footerH - 2, { align: "right" });
      doc.setTextColor(0, 0, 0);
    } catch { /* ignore */ }
  }

  // Ensure we haven't overflowed
  if (y + footerH > pageH - margin) {
    // no-op — content overflow is expected to be trimmed by autoTable pagination
  }
}

// ── public types ─────────────────────────────────────────────────────────

export type RenderInvoiceArgs = {
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
  /** Company letterhead (source of truth). When present, takes priority over branch/settings for header. */
  company?: CompanyProfile | null;
  /** When true, render a small "Supply From: <warehouse>" line below the letterhead. */
  showSupplyFrom?: boolean;
  meta?: { vehicle_no?: string | null; po_no?: string | null; po_date?: string | null; payment_terms?: string | null };
  /** Authorised signature image URL (signed URL or public /signatures/*.svg). Embedded above signatory line. */
  authorisedSignatureUrl?: string | null;
  preparedBy?: { name?: string | null; phone?: string | null; email?: string | null } | null;
};

export type RenderInvoiceCopiesArgs = RenderInvoiceArgs & {
  /** Per-copy labels e.g. ["ORIGINAL","DUPLICATE","TRIPLICATE","OFFICE","EXTRA 1"] — each adds a page */
  copies: string[];
  /** When true, show a faint diagonal watermark with the copy label even if not reprint/provisional */
  showWatermark?: boolean;
  /** When true, add a faint diagonal "REPRINT" watermark (opacity 0.07 rotate 30°) */
  isReprint?: boolean;
};

// ── multi-copy renderer ──────────────────────────────────────────────────

/**
 * Render all copies into a single multi-page jsPDF.
 * Each entry in `copies` adds a page; header box draws the per-copy label
 * centered 8.5pt bold with themeColor border (78pt wide) and "TAX INVOICE".
 * Faint diagonal watermark: "REPRINT" when isReprint, or red "PROVISIONAL — IRN PENDING"
 * when provisional (e_invoice_required but not generated). Keeps IRN row, items autoTable,
 * totals, bank+QR (signed_qr preferred, base64 decoded), signatures.
 */
export async function renderInvoiceCopies(args: RenderInvoiceCopiesArgs): Promise<jsPDF> {
  const [{ default: jsPDF }, { default: autoTable }, QRCode] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    import("qrcode"),
  ]);

  const copies = normalizeCopies(args.copies, args.copyLabel);
  // Clamp to sane max (triplicate + office + 5 extra = 9)
  const safeCopies = copies.slice(0, 12);

  const isReprint = !!args.isReprint;
  const showWatermark = !!args.showWatermark;
  const isProvisional = isProvisionalInvoice(args.invoice);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

  // Cache company header once per bulk render — avoids N× getCompany() calls (H13).
  // Prefer caller-provided company if present; otherwise fetch once.
  const companyCached: CompanyProfile = args.company ?? (await getCompany());

  // Sequential loop with await — concurrency limit 1 to bound memory/QR/signature I/O.
  // Do NOT parallelize with Promise.all; increase only with explicit memory test.
  for (let idx = 0; idx < safeCopies.length; idx++) {
    if (idx > 0) doc.addPage();
    const label = safeCopies[idx] || args.copyLabel || "ORIGINAL";
    await renderOneCopyContent(
      doc,
      args,
      label,
      QRCode,
      autoTable as unknown as (doc: jsPDF, opts: unknown) => void,
      {
        isReprint,
        isProvisional,
        showWatermark,
      },
      companyCached,
    );
  }

  return doc;
}

// Keep existing single-copy as shim
export async function renderInvoicePdf(args: RenderInvoiceArgs): Promise<jsPDF> {
  const copies = normalizeCopies(undefined, args.copyLabel);
  return renderInvoiceCopies({ ...args, copies });
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

// ── bulk helpers: multi-page PDF or ZIP (jszip if available) ─────────────

/**
 * Bulk download — by default produces a single multi-page PDF (counts as one logical print).
 * When `asZip` is true, attempts to use `jszip` (dynamic import) to produce a ZIP with one PDF per copy;
 * if jszip is not available, falls back to the multi-page PDF.
 */
export async function downloadInvoicePdfBulk(
  args: RenderInvoiceCopiesArgs & { asZip?: boolean; zipFileName?: string },
): Promise<void> {
  const copies = normalizeCopies(args.copies, args.copyLabel);
  const baseName = (args.invoice.invoice_no || "invoice").replace(/[^\w.\-]+/g, "_");

  if (args.asZip) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jszipMod: any = await import("jszip");
      const JSZip = jszipMod.default || jszipMod;
      const zip = new JSZip();
      // Sequential per-copy render — concurrency limit 1 (await in loop); avoids OOM on many copies.
      for (const label of copies) {
        const singleDoc = await renderInvoiceCopies({ ...args, copies: [label] });
        const blob: Blob = singleDoc.output("blob") as unknown as Blob;
        const arr = await blob.arrayBuffer();
        const safeLabel = label.replace(/[^\w.\-]+/g, "_") || "copy";
        zip.file(`${baseName}_${safeLabel}.pdf`, arr);
      }
      const zipBlob: Blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = args.zipFileName || `${baseName}_copies.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return;
    } catch (e) {
      console.warn("[invoicePdfBulk] jszip not available or ZIP failed, falling back to multi-page PDF", e);
      // fall through to multi-page
    }
  }

  // Fallback / default: single multi-page PDF
  const doc = await renderInvoiceCopies({ ...args, copies });
  const name = `${baseName}.pdf`;
  doc.save(name);
}

/**
 * Bulk print — always multi-page PDF (single bloburl). ZIP is not used for print.
 * Uses existing QR code generation + signature fetching per page.
 */
export async function printInvoicePdfBulk(args: RenderInvoiceCopiesArgs): Promise<void> {
  const doc = await renderInvoiceCopies(args);
  const url = doc.output("bloburl") as unknown as string;
  window.open(url, "_blank");
  // Revoke blob URL after 60s to free memory (bloburl is createObjectURL-backed).
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

