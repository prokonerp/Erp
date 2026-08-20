import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Download } from "lucide-react";
import { StockStatusBadge } from "@/components/StockStatusBadge";
import { exportCSV } from "@/lib/exports";
import { findEquipmentBySerial, warrantyEnd, coverStatus, amcStatusOf, statusClass, statusLabel, type InstalledEquipment } from "@/lib/installedEquipment";
import {
  listWarehouses,
  TXN_TYPE_LABEL, type StockItem, type Transaction, type WarehouseLite,
} from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/serial-track")({
  component: SerialTrack,
  validateSearch: (search: Record<string, unknown>): { serial?: string } => ({
    serial: typeof search.serial === "string" ? search.serial : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Serial Track — Global Serial Search | Prokon" },
      { name: "description", content: "Search any serial number to see its current status, warehouse location and complete movement history." },
      { property: "og:title", content: "Serial Track — Global Serial Search" },
      { property: "og:description", content: "Instant serial lookup with live status and full transaction history." },
    ],
  }),
});

const splitSerials = (v: string | null | undefined): string[] =>
  (v || "").split(",").map((s) => s.trim()).filter(Boolean);

type TicketLite = {
  id: string;
  case_id: string | null;
  created_at: string;
  call_type: string | null;
  complaint: string | null;
  status: string | null;
  assigned_engineer_name: string | null;
  serial_no: string | null;
};

/** Clean, business-facing label derived from txn_type + reference + notes. */
const typeLabel = (t: Transaction): string => {
  const ref = (t.reference || t.txn_no || "").toLowerCase();
  const notes = (t.notes || "").toLowerCase();
  if (notes.includes("reversal")) return "Reversal";
  if ((t.txn_type === "good_in" || t.txn_type === "defective_in") && ref.includes("grn")) return "Purchase";
  if (t.txn_type === "good_out" && ref.includes("invoice")) return "Sale";
  if (t.txn_type === "transfer_in" || t.txn_type === "transfer_out") return "Transfer";
  if ((t.txn_type === "defective_out" || t.txn_type === "good_out") && (ref.includes("dc") || ref.includes("challan"))) return "OEM Return";
  return TXN_TYPE_LABEL[t.txn_type] || t.txn_type;
};

function SerialTrack() {
  const { serial: serialParam } = Route.useSearch();
  const [stock, setStock] = useState<StockItem[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [tickets, setTickets] = useState<TicketLite[]>([]);
  const [equipment, setEquipment] = useState<InstalledEquipment[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState("");
  const [q, setQ] = useState(serialParam || "");

  useEffect(() => {
    listWarehouses().then(setWarehouses).catch(() => {});
  }, []);

  // Keep the box in sync when arriving with ?serial= from another screen.
  useEffect(() => {
    if (serialParam) setQ(serialParam);
  }, [serialParam]);

  // Service history: tickets logged against this serial.
  useEffect(() => {
    const term = q.trim();
    if (!term) { setTickets([]); setEquipment([]); return; }
    let alive = true;
    const h = setTimeout(async () => {
      const sb = supabase as unknown as { from: (t: string) => any };
      const { data } = await sb
        .from("tickets")
        .select("id,case_id,created_at,call_type,complaint,status,assigned_engineer_name,serial_no")
        .ilike("serial_no", `%${term}%`)
        .order("created_at", { ascending: true })
        .limit(200);
      if (alive) setTickets((data || []) as TicketLite[]);
      try {
        const eq = await findEquipmentBySerial(term);
        if (alive) setEquipment(eq);
      } catch { if (alive) setEquipment([]); }
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);

  // Debounced targeted search — exact match, with defensive LIKE for legacy comma rows.
  useEffect(() => {
    const term = q.trim();
    if (!term) { setStock([]); setTxns([]); setSearched(""); return; }
    let alive = true;
    setLoading(true);
    const h = setTimeout(async () => {
      try {
        const sb = supabase as unknown as { from: (t: string) => any };
        const [s, t] = await Promise.all([
          sb.from("ims_stock_items").select("*")
            .or(`part_serial_no.eq.${term},part_serial_no.ilike.%${term}%`).limit(25),
          sb.from("ims_transactions").select("*")
            .or(`part_serial_no.eq.${term},part_serial_no.ilike.%${term}%`).limit(500),
        ]);
        if (!alive) return;
        setStock((s.data || []) as StockItem[]);
        setTxns((t.data || []) as Transaction[]);
        setSearched(term);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);

  const wMap = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  /** Plain warehouse name only — no ASP/Godown suffix (same style as Reports). */
  const plainWhName = (id: string | null | undefined) => (id ? (wMap[id]?.name || "—") : "—");

  const term = q.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!term) return [] as { serial: string; row: StockItem }[];
    const out: { serial: string; row: StockItem }[] = [];
    for (const r of stock) {
      for (const s of splitSerials(r.part_serial_no)) {
        if (s.toLowerCase().includes(term)) out.push({ serial: s, row: r });
      }
    }
    return out.slice(0, 25);
  }, [stock, term]);

  const historyFor = (row: StockItem) =>
    txns
      .filter((t) =>
        (!!t.part_serial_no && splitSerials(t.part_serial_no).some((s) => s.toLowerCase() === term)) ||
        t.stock_item_id === row.id)
      .sort((a, b) => (a.txn_date || a.created_at).localeCompare(b.txn_date || b.created_at));

  const party = (t: Transaction) => t.to_party || t.from_party || "—";

  const ticketsFor = (serial: string) =>
    tickets.filter((t) => (t.serial_no || "").toLowerCase().split(",").map((s) => s.trim()).includes(serial.toLowerCase()));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Serial Track — Global Serial Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-9"
              placeholder="Type any serial number…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {loading ? "Searching…" : searched ? `${matches.length} match(es) for “${searched}”` : "Type a serial number to search"}
          </p>
        </CardContent>
      </Card>

      {!loading && term && matches.length === 0 && equipment.length === 0 && tickets.length === 0 && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          No serial found matching “{q.trim()}”
        </CardContent></Card>
      )}

      {/* Serials sold/installed but no longer (or never) held in IMS stock still resolve here. */}
      {matches.length === 0 && (equipment.length > 0 || tickets.length > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex flex-wrap items-center gap-2">
              <span className="font-mono">{equipment[0]?.serial_no || q.trim()}</span>
              <Badge variant="outline">Not in IMS stock</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {equipment.map((e) => {
              const wEnd = warrantyEnd(e);
              const w = coverStatus(wEnd);
              const a = amcStatusOf(e);
              return (
                <div key={e.id} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                  <div><div className="text-xs text-muted-foreground">Model</div><div>{e.model_no || "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Invoice</div>
                    <div>{e.invoice_no || "—"}{e.invoice_date ? ` · ${e.invoice_date.slice(0, 10)}` : ""}</div></div>
                  <div><div className="text-xs text-muted-foreground">Warranty</div>
                    <div><Badge variant="outline" className={statusClass(w)}>{statusLabel[w]}</Badge>
                      {wEnd ? <span className="ml-1 text-muted-foreground">till {wEnd}</span> : null}</div></div>
                  <div><div className="text-xs text-muted-foreground">AMC</div>
                    <div><Badge variant="outline" className={statusClass(a)}>{statusLabel[a]}</Badge>
                      {e.amc_end_date ? <span className="ml-1 text-muted-foreground">till {e.amc_end_date.slice(0, 10)}</span> : null}</div></div>
                </div>
              );
            })}

            <div>
              <h3 className="text-sm font-medium mb-2">Service history ({tickets.length})</h3>
              {tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tickets logged against this serial yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="p-2">Case ID</th>
                        <th className="p-2">Date</th>
                        <th className="p-2">Call Type</th>
                        <th className="p-2">Complaint</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Engineer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map((t) => (
                        <tr key={t.id} className="border-t">
                          <td className="p-2 whitespace-nowrap font-mono">{t.case_id || "—"}</td>
                          <td className="p-2 whitespace-nowrap">{(t.created_at || "").slice(0, 10)}</td>
                          <td className="p-2">{t.call_type || "—"}</td>
                          <td className="p-2 max-w-[28rem] whitespace-pre-wrap break-words">{t.complaint || "—"}</td>
                          <td className="p-2"><Badge variant="outline">{t.status || "—"}</Badge></td>
                          <td className="p-2">{t.assigned_engineer_name || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {matches.map(({ serial, row }) => {
        const hist = historyFor(row);
        const svc = ticketsFor(serial);
        const issuedTo = (row.stock_status === "issued" || row.stock_status === "returned_to_oem")
          ? (hist.slice().reverse().find((t) => t.txn_type === "good_out" || t.txn_type === "defective_out"))
          : null;
        return (
          <Card key={`${row.id}-${serial}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex flex-wrap items-center gap-2">
                <span className="font-mono">{serial}</span>
                <StockStatusBadge status={row.stock_status} type={row.stock_type} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div><div className="text-xs text-muted-foreground">Product / Model</div>
                  <div>{row.part_model_no || row.part_name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">OEM</div><div>{row.oem || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Warehouse</div>
                  <div>{plainWhName(row.warehouse_id)}</div></div>
                <div><div className="text-xs text-muted-foreground">Qty</div><div>{row.qty}</div></div>
                {issuedTo && (
                  <div className="sm:col-span-2 lg:col-span-4">
                    <div className="text-xs text-muted-foreground">Issued to</div>
                    <div>{issuedTo.to_party || row.customer_name || "—"}
                      {issuedTo.reference ? <span className="text-muted-foreground"> · {issuedTo.reference}</span> : null}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Movement history ({hist.length})</h3>
                <Button
                  variant="outline" size="sm" disabled={hist.length === 0}
                  onClick={() => exportCSV(`serial_${serial}_history`, [
                    { header: "Date", get: (t: Transaction) => (t.txn_date || t.created_at || "").slice(0, 10) },
                    { header: "Type", get: (t: Transaction) => typeLabel(t) },
                    { header: "Voucher/Reference", get: (t: Transaction) => t.txn_no || t.reference || "" },
                    { header: "Party", get: (t: Transaction) => party(t) },
                    { header: "From Warehouse", get: (t: Transaction) => plainWhName(t.from_warehouse_id) },
                    { header: "To Warehouse", get: (t: Transaction) => plainWhName(t.to_warehouse_id) },
                    { header: "Qty", get: (t: Transaction) => t.qty },
                  ], hist)}
                >
                  <Download className="h-4 w-4 mr-1" />Download as CSV
                </Button>
              </div>

              {hist.length === 0 ? (
                <p className="text-sm text-muted-foreground">No transactions recorded for this serial yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="p-2">Date</th>
                        <th className="p-2">Type</th>
                        <th className="p-2">Voucher / Reference</th>
                        <th className="p-2">Party</th>
                        <th className="p-2">Warehouse</th>
                        <th className="p-2 text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hist.map((t) => (
                        <tr key={t.id} className="border-t">
                          <td className="p-2 whitespace-nowrap">{(t.txn_date || t.created_at || "").slice(0, 10)}</td>
                          <td className="p-2"><Badge variant="outline">{typeLabel(t)}</Badge></td>
                          <td className="p-2">{t.txn_no || t.reference || "—"}</td>
                          <td className="p-2">{party(t)}</td>
                          <td className="p-2 whitespace-nowrap">
                            {t.from_warehouse_id && t.to_warehouse_id
                              ? `${plainWhName(t.from_warehouse_id)} → ${plainWhName(t.to_warehouse_id)}`
                              : t.to_warehouse_id ? `→ ${plainWhName(t.to_warehouse_id)}`
                              : t.from_warehouse_id ? `${plainWhName(t.from_warehouse_id)} →` : "—"}
                          </td>
                          <td className="p-2 text-right">{t.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium mb-2">Service history ({svc.length})</h3>
                {svc.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tickets logged against this serial yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <th className="p-2">Case ID</th>
                          <th className="p-2">Date</th>
                          <th className="p-2">Call Type</th>
                          <th className="p-2">Complaint</th>
                          <th className="p-2">Status</th>
                          <th className="p-2">Engineer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {svc.map((t) => (
                          <tr key={t.id} className="border-t">
                            <td className="p-2 whitespace-nowrap font-mono">{t.case_id || "—"}</td>
                            <td className="p-2 whitespace-nowrap">{(t.created_at || "").slice(0, 10)}</td>
                            <td className="p-2">{t.call_type || "—"}</td>
                            <td className="p-2 max-w-[28rem] whitespace-pre-wrap break-words">{t.complaint || "—"}</td>
                            <td className="p-2"><Badge variant="outline">{t.status || "—"}</Badge></td>
                            <td className="p-2">{t.assigned_engineer_name || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}