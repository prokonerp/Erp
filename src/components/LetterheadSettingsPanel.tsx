import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { invalidateLetterheadCache, type LetterheadDocType } from "@/lib/letterhead";

type Row = {
  document_type: LetterheadDocType;
  use_letterhead: boolean;
  show_supply_from: boolean;
};

const DOC_TYPES: { key: LetterheadDocType; label: string }[] = [
  { key: "quotation", label: "Quotation" },
  { key: "sales_order", label: "Sales Order" },
  { key: "delivery_challan", label: "Delivery Challan" },
  { key: "pi", label: "Proforma Invoice (PI)" },
  { key: "invoice", label: "Invoice" },
];

export function LetterheadSettingsPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("letterhead_settings" as never)
        .select("document_type,use_letterhead,show_supply_from");
      const byType = new Map<string, Row>();
      ((data as Row[] | null) ?? []).forEach((r) => byType.set(r.document_type, r));
      setRows(
        DOC_TYPES.map(({ key }) =>
          byType.get(key) ?? { document_type: key, use_letterhead: true, show_supply_from: false },
        ),
      );
    })();
  }, []);

  const patch = (i: number, p: Partial<Row>) => {
    const next = [...rows];
    next[i] = { ...next[i], ...p };
    setRows(next);
  };

  const save = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("letterhead_settings" as never)
        .upsert(rows as never, { onConflict: "document_type" });
      if (error) throw error;
      invalidateLetterheadCache();
      toast.success("Letterhead settings saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" /> Document Letterhead Settings
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Company letterhead is the single source of truth for every printed document. Toggle "Use
          Letterhead" per document type; enable "Show Supply From" to print the fulfilling
          warehouse as a small subtitle below the header.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Document Type</th>
                <th className="text-center px-3 py-2 w-32">Use Letterhead</th>
                <th className="text-center px-3 py-2 w-40">Show Supply From</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.document_type} className="border-t">
                  <td className="px-3 py-2">{DOC_TYPES.find((d) => d.key === r.document_type)?.label}</td>
                  <td className="text-center px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={r.use_letterhead}
                      onChange={(e) => patch(i, { use_letterhead: e.target.checked })}
                    />
                  </td>
                  <td className="text-center px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={r.show_supply_from}
                      onChange={(e) => patch(i, { show_supply_from: e.target.checked })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save Letterhead Settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}