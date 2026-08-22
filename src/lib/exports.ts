export type ExportColumn<T> = {
  header: string;
  /** Accessor returns a primitive value to render in the cell. */
  get: (row: T) => string | number | null | undefined;
};

const safeStr = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const stamp = () => new Date().toISOString().slice(0, 10);

export function exportCSV<T>(name: string, cols: ExportColumn<T>[], rows: T[]) {
  const esc = (s: string) => {
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = cols.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => cols.map((c) => esc(safeStr(c.get(r)))).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${name}_${stamp()}.csv`);
}

export async function exportExcel<T>(name: string, cols: ExportColumn<T>[], rows: T[]) {
  const XLSX = await import("xlsx");
  const data = rows.map((r) => {
    const o: Record<string, string | number> = {};
    for (const c of cols) {
      const v = c.get(r);
      o[c.header] = typeof v === "number" ? v : safeStr(v);
    }
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: cols.map((c) => c.header) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31) || "Sheet1");
  XLSX.writeFile(wb, `${name}_${stamp()}.xlsx`);
}

export async function exportPDF<T>(name: string, cols: ExportColumn<T>[], rows: T[], title?: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: cols.length > 6 ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const head = [cols.map((c) => c.header)];
  const body = rows.map((r) => cols.map((c) => safeStr(c.get(r))));
  doc.setFontSize(13);
  doc.text(title || name, 40, 32);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()} · ${rows.length} record(s)`, 40, 48);
  autoTable(doc, {
    head, body,
    startY: 60,
    styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [30, 64, 175], textColor: 255 },
    alternateRowStyles: { fillColor: [243, 244, 246] },
    margin: { left: 24, right: 24 },
  });
  doc.save(`${name}_${stamp()}.pdf`);
}