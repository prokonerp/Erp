import type { Transaction } from "@/lib/ims";

export type TxnDocType = "grn" | "dc" | "gdc" | "invoice" | "transfer" | null;

export type TxnDocMeta = {
  /** What to show in the Voucher/Reference column — DC/GRN number preferred */
  display: string;
  docType: TxnDocType;
  /** Canonical document number e.g. GRN-CUST/26-27/0001, DC-CUST/26-27/0001, GDC/2026/0001 */
  docNo: string | null;
  /** Raw reference field */
  rawRef: string | null;
  /** Internal auto-generated txn_no (PHS/IMS/...) — kept for tooltip / fallback */
  internalTxnNo: string | null;
  /** When available, direct FK to transfer */
  transferId?: string | null;
};

/**
 * Preference order for the voucher display:
 * 1. Reference-derived document number (GRN/DC/GDC/Invoice) — user-facing
 * 2. Raw reference (when it doesn't match a known doc pattern)
 * 3. Internal txn_no (PHS/IMS/...) — last resort
 * 4. "—"
 *
 * Reference prefixes used by DB triggers:
 *  - GRN:  'GRN ' + grn_no   (grn_no = GRN-CUST/... , GRN-OEM/... , GRN-GEN/...)
 *  - DC:   'DC ' + challan_no (challan_no = DC-CUST/... , DC-OEM/...)
 *  - GDC:  'GDC ' + dc_no     (dc_no = GDC/YYYY/NNNN)
 *  - Invoice: 'Invoice ' + invoice_no
 *  - Transfer: transfer_no stored as reference or via transfer_id FK
 */
export function getTxnDocMeta(t: Transaction): TxnDocMeta {
  const ref = (t.reference || "").trim();
  const txnNo = (t.txn_no || "").trim();
  const upperRef = ref.toUpperCase();

  // Helper to build meta
  const mk = (display: string, docType: TxnDocType, docNo: string | null): TxnDocMeta => ({
    display,
    docType,
    docNo,
    rawRef: ref || null,
    internalTxnNo: txnNo || null,
    transferId: (t as unknown as { transfer_id?: string | null }).transfer_id ?? t.transfer_id ?? null,
  });

  // 1. Explicit prefix matches — most reliable (trigger format)
  if (upperRef.startsWith("GRN ")) {
    const docNo = ref.slice(4).trim();
    // docNo may still be empty if ref was exactly "GRN " — fall back to ref
    const display = docNo || ref;
    // Defensive: if docNo still starts with "GRN " due to double prefix, strip once more
    // (should not happen but be safe)
    const normalized = display.toUpperCase().startsWith("GRN ") ? display.slice(4).trim() : display;
    return mk(normalized, "grn", normalized);
  }
  if (upperRef.startsWith("GDC ")) {
    const docNo = ref.slice(4).trim();
    const display = docNo || ref;
    const normalized = display.toUpperCase().startsWith("GDC ") ? display.slice(4).trim() : display;
    return mk(normalized, "gdc", normalized);
  }
  if (upperRef.startsWith("DC ")) {
    const docNo = ref.slice(3).trim();
    const display = docNo || ref;
    const normalized = display.toUpperCase().startsWith("DC ") ? display.slice(3).trim() : display;
    return mk(normalized, "dc", normalized);
  }
  if (upperRef.startsWith("INVOICE ")) {
    const docNo = ref.slice(8).trim();
    return mk(docNo || ref, "invoice", docNo || ref);
  }
  if (upperRef.startsWith("INV ")) {
    const docNo = ref.slice(4).trim();
    return mk(docNo || ref, "invoice", docNo || ref);
  }

  // 2. Pattern-based detection when prefix was omitted or reference is free-form
  //    Handles cases where someone manually typed "GRN-CUST/26-27/0001" without "GRN " prefix,
  //    or where reference contains document number embedded with other text.
  //    We try to extract a canonical doc number via regex and treat that as the display.
  const grnMatch = ref.match(/(GRN-(?:CUST|OEM|GEN)\/[^\s,;]+)/i);
  if (grnMatch) {
    return mk(grnMatch[1], "grn", grnMatch[1]);
  }
  // Broader GRN fallback: any GRN/ or GRN- pattern
  if (/GRN[\/-]/i.test(ref)) {
    // Try to pull the token that looks like a GRN number
    const m = ref.match(/(GRN[^\s,;]*\/[^\s,;]+)/i);
    if (m) return mk(m[1], "grn", m[1]);
    // else still treat whole ref as GRN display
    return mk(ref, "grn", ref);
  }

  const gdcMatch = ref.match(/(GDC\/[^\s,;]+)/i);
  if (gdcMatch) return mk(gdcMatch[1], "gdc", gdcMatch[1]);

  const dcCustOemMatch = ref.match(/(DC-(?:CUST|OEM)\/[^\s,;]+)/i);
  if (dcCustOemMatch) return mk(dcCustOemMatch[1], "dc", dcCustOemMatch[1]);
  // Generic DC/ pattern (e.g., DC/2026/0001)
  if (/^DC[\/-]/i.test(ref) || /DC\//i.test(ref)) {
    const m = ref.match(/(DC[^\s,;]*\/[^\s,;]+)/i);
    if (m) return mk(m[1], "dc", m[1]);
  }

  // 3. Transfer detection
  const isTransferType = t.txn_type === "transfer_in" || t.txn_type === "transfer_out";
  const transferId = (t as unknown as { transfer_id?: string | null }).transfer_id ?? t.transfer_id ?? null;
  if (isTransferType || upperRef.includes("PHS/IMT") || /^PHS\/IMT/i.test(ref)) {
    const display = ref || txnNo || "—";
    // If we have a transfer_id we can navigate directly; otherwise try to use ref as docNo
    const docNo = ref || null;
    return {
      display,
      docType: "transfer",
      docNo,
      rawRef: ref || null,
      internalTxnNo: txnNo || null,
      transferId,
    };
  }

  // 4. Invoice detection via txn_type or reference pattern (INV-, Invoice)
  if (
    upperRef.includes("INVOICE") ||
    upperRef.includes("INV/") ||
    upperRef.includes("INV-") ||
    /\bINV\b/i.test(ref)
  ) {
    // Extract invoice number if possible: look for token after INV/INV- or Invoice
    const invMatch = ref.match(/(?:Invoice\s+)?(INV[^\s,;]*)/i);
    if (invMatch) return mk(invMatch[1] || ref, "invoice", invMatch[1] || ref);
    return mk(ref, "invoice", ref);
  }

  // 5. Generic singletons where txn_no is the real voucher — Opening Stock, Manual Entry etc.
  //    For these, showing "Opening Stock" is not useful (not unique); show the PHS/IMS txn_no instead.
  //    Keep rawRef for tooltip.
  const isGenericOpening = upperRef === "OPENING STOCK" || upperRef === "OPENING BALANCE" || upperRef === "OPENING" || upperRef.startsWith("OPENING ");
  const isGenericManual = upperRef === "MANUAL STOCK ENTRY" || upperRef === "MANUAL ENTRY" || upperRef.startsWith("MANUAL ");
  const isGeneric = isGenericOpening || isGenericManual;
  if (isGeneric) {
    if (txnNo) return mk(txnNo, null, null);
    return mk(ref, null, null);
  }

  // 6. Non-empty reference that didn't match known patterns — show as-is, not clickable
  if (ref) {
    return mk(ref, null, null);
  }

  // 7. Fallback to internal txn_no
  if (txnNo) {
    return mk(txnNo, null, null);
  }

  return mk("—", null, null);
}

/** Whether this doc type supports click-to-open */
export function isClickableTxnDoc(meta: TxnDocMeta): boolean {
  return !!meta.docType && !!meta.docNo;
}

/** Human label for tooltip / a11y */
export function txnDocTooltip(meta: TxnDocMeta): string {
  if (meta.docType && meta.docNo) {
    const typeLabel =
      meta.docType === "grn"
        ? "GRN"
        : meta.docType === "dc"
          ? "Delivery Challan"
          : meta.docType === "gdc"
            ? "General DC"
            : meta.docType === "invoice"
              ? "Invoice"
              : meta.docType === "transfer"
                ? "Transfer"
                : meta.docType;
    const base = `${typeLabel} ${meta.docNo}`;
    if (meta.internalTxnNo) return `${base} • Internal: ${meta.internalTxnNo} (click to open)`;
    return `${base} (click to open)`;
  }
  // Include rawRef when display was remapped (e.g. Opening Stock → PHS/IMS number)
  if (meta.rawRef && meta.display !== meta.rawRef) {
    if (meta.internalTxnNo && meta.display === meta.internalTxnNo) {
      return `${meta.rawRef} • ${meta.display}`;
    }
    return `${meta.display} • ${meta.rawRef}`;
  }
  if (meta.internalTxnNo && meta.display !== meta.internalTxnNo) {
    return `${meta.display} • ${meta.internalTxnNo}`;
  }
  return meta.display;
}
