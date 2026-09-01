import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StockStatusBadge } from "@/components/StockStatusBadge";
import { exportCSV } from "@/lib/exports";
import { findEquipmentBySerial, warrantyEnd, coverStatus, amcStatusOf, statusClass, statusLabel, type InstalledEquipment } from "@/lib/installedEquipment";
import {
  listWarehouses,
  type StockItem, type Transaction, type WarehouseLite,
} from "@/lib/ims";
import { resolveTxnType } from "@/components/serial/TransactionTypeBadge";
import { MovementTimeline, getMovementLabel } from "@/components/serial/MovementTimeline";
import { SerialSearchHero, SerialHeaderCard, SectionHeader } from "@/components/serial/SerialTrackShell";
import { getTxnDocMeta } from "@/lib/txnDocument";

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

function SerialTrack() {
  const { serial: serialParam } = Route.useSearch();
  const [stock, setStock] = useState<StockItem[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [tickets, setTickets] = useState<TicketLite[]>([]);
  const [equipment, setEquipment] = useState<InstalledEquipment[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState("");
  const [q, setQ] = useRouteState<string>("q", serialParam || "");

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

  const ticketsFor = (serial: string) =>
    tickets.filter((t) => (t.serial_no || "").toLowerCase().split(",").map((s) => s.trim()).includes(serial.toLowerCase()));

  // hint for hero
  const heroHint = loading
    ? undefined
    : searched
      ? `${matches.length} match(es) for “${searched}”`
      : undefined;

  return (
    <div className="space-y-4">
      <SerialSearchHero
        value={q}
        onChange={setQ}
        loading={loading}
        hint={heroHint}
        placeholder="Type any serial number…"
      />

      {!loading && term && matches.length === 0 && equipment.length === 0 && tickets.length === 0 && (
        <Card className="rounded-xl border-border/60 bg-card shadow-sm"><CardContent className="py-10 text-center">
          <div className="mx-auto h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3 text-muted-foreground">—</div>
          <p className="text-sm font-medium text-foreground">No serial found matching “{q.trim()}”</p>
          <p className="text-xs text-muted-foreground mt-1">Try a partial serial or check for typos.</p>
        </CardContent></Card>
      )}

      {/* Serials sold/installed but no longer (or never) held in IMS stock still resolve here. */}
      {matches.length === 0 && (equipment.length > 0 || tickets.length > 0) && (
        <Card className="rounded-xl border-border/60 bg-card shadow-sm">
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
              <SectionHeader title="Service history" count={tickets.length} countVariant="secondary" />
              {tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-3">No tickets logged against this serial yet.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border/60 bg-white shadow-sm mt-3">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Case ID</th>
                        <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Date</th>
                        <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Call Type</th>
                        <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Complaint</th>
                        <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Status</th>
                        <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Engineer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {tickets.map((t) => (
                        <tr key={t.id} className="hover:bg-muted/20">
                          <td className="p-2.5 whitespace-nowrap font-mono text-xs">{t.case_id || "—"}</td>
                          <td className="p-2.5 whitespace-nowrap text-xs">{(t.created_at || "").slice(0, 10)}</td>
                          <td className="p-2.5 text-xs">{t.call_type || "—"}</td>
                          <td className="p-2.5 max-w-[28rem] whitespace-pre-wrap break-words text-xs">{t.complaint || "—"}</td>
                          <td className="p-2.5"><Badge variant="outline" className="text-xs">{t.status || "—"}</Badge></td>
                          <td className="p-2.5 text-xs">{t.assigned_engineer_name || "—"}</td>
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
          ? (hist.slice().reverse().find((t) => t.txn_type === "good_out" || t.txn_type === "defective_out" || t.txn_type === "oem_return"))
          : null;
        return (
          <div key={`${row.id}-${serial}`} className="space-y-4">
            <SerialHeaderCard
              serial={serial}
              stockStatus={row.stock_status as any}
              stockType={row.stock_type as any}
              productLabel={row.part_model_no || row.part_name || "—"}
              oemLabel={row.oem || "—"}
              warehouseLabel={plainWhName(row.warehouse_id)}
              qty={row.qty}
              issuedTo={issuedTo ? { party: issuedTo.to_party || row.customer_name || "—", reference: getTxnDocMeta(issuedTo as unknown as any).display } : null}
            />

            <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
              <CardContent className="p-4 sm:p-5 space-y-4">
                <SectionHeader
                  title="Movement history"
                  count={hist.length}
                  onDownload={() => exportCSV(`serial_${serial}_history`, [
                    { header: "Date", get: (t: Transaction) => (t.txn_date || t.created_at || "").slice(0, 10) },
                    { header: "Type", get: (t: Transaction) => resolveTxnType(t as Transaction).label },
                    { header: "Voucher/Reference", get: (t: Transaction) => getTxnDocMeta(t as Transaction).display },
                    { header: "Party", get: (t: Transaction) => t.to_party || t.from_party || "—" },
                    { header: "Warehouse Flow", get: (t: Transaction) => {
                      const from = t.from_warehouse_id ? plainWhName(t.from_warehouse_id) : (t.from_party || "");
                      const to = t.to_warehouse_id ? plainWhName(t.to_warehouse_id) : (t.to_party || "");
                      if (from && to) return `${from} → ${to}`;
                      if (to) return `→ ${to}`;
                      if (from) return `${from} →`;
                      return "—";
                    }},
                    { header: "Qty", get: (t: Transaction) => t.qty },
                  ], hist)}
                  downloadDisabled={hist.length === 0}
                />

                <MovementTimeline txns={hist as any} warehouses={warehouses} />
                {/* Legend for beautiful in/out arrows */}
                {hist.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground border-t border-border/50 pt-3">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> In</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" /> Out to Customer</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> Transfer</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" /> OEM / Defective</span>
                    <span className="ml-auto hidden sm:inline">Beautiful pill flow replaces plain “→” arrows</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
              <CardContent className="p-4 sm:p-5 space-y-3">
                <SectionHeader title="Service history" count={svc.length} countVariant="secondary" />
                {svc.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tickets logged against this serial yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border/60 bg-white shadow-sm">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Case ID</th>
                          <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Date</th>
                          <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Call Type</th>
                          <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Complaint</th>
                          <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Status</th>
                          <th className="p-2.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground">Engineer</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {svc.map((t) => (
                          <tr key={t.id} className="hover:bg-muted/20">
                            <td className="p-2.5 whitespace-nowrap font-mono text-xs">{t.case_id || "—"}</td>
                            <td className="p-2.5 whitespace-nowrap text-xs">{(t.created_at || "").slice(0, 10)}</td>
                            <td className="p-2.5 text-xs">{t.call_type || "—"}</td>
                            <td className="p-2.5 max-w-[28rem] whitespace-pre-wrap break-words text-xs">{t.complaint || "—"}</td>
                            <td className="p-2.5"><Badge variant="outline" className="text-xs">{t.status || "—"}</Badge></td>
                            <td className="p-2.5 text-xs">{t.assigned_engineer_name || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
