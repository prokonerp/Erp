import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Search } from "lucide-react";
import { indentTypeLabel, indentStatusFromOracles, indentClosedAt, formatAge, oracleStatus, type Indent } from "@/lib/indent";

export const Route = createFileRoute("/_app/indent/")({
  component: IndentList,
});

function IndentList() {
  const [rows, setRows] = useState<Indent[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("indents" as never)
        .select("*")
        .order("created_at", { ascending: false });
      setRows((data || []) as unknown as Indent[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const s = q.toLowerCase().trim();
  const filtered = !s
    ? rows
    : rows.filter((r) =>
        [r.indent_no, r.case_id, r.oem_case_id, r.company, r.product_model, r.product_serial, r.engineer_name, r.indent_city]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(s)),
      );

  const kpi = useMemo(() => {
    let openInd = 0, closedInd = 0, openO = 0, closedO = 0;
    let totalClosureMs = 0, closedCount = 0;
    let longestOpenMs = 0;
    let longestOpenLabel = "—";
    for (const r of rows) {
      const st = indentStatusFromOracles(r.oracles_data);
      const oracles = r.oracles_data || [];
      for (const o of oracles) (oracleStatus(o) === "closed" ? closedO++ : openO++);
      if (st === "closed") {
        closedInd++;
        const cAt = indentClosedAt(r.oracles_data);
        if (cAt) { totalClosureMs += new Date(cAt).getTime() - new Date(r.created_at).getTime(); closedCount++; }
      } else {
        openInd++;
        const age = Date.now() - new Date(r.created_at).getTime();
        if (age > longestOpenMs) { longestOpenMs = age; longestOpenLabel = r.indent_no || r.id; }
      }
    }
    const avgIso = closedCount ? new Date(Date.now() - totalClosureMs / closedCount).toISOString() : null;
    const avg = avgIso ? formatAge(avgIso) : "—";
    const longest = longestOpenMs ? formatAge(new Date(Date.now() - longestOpenMs).toISOString()) : "—";
    return { openInd, closedInd, openO, closedO, avg, longest, longestLabel: longestOpenLabel, pending: openO };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Indent</h1>
        <div className="text-sm text-muted-foreground">
          Indents are created from OEM-tagged Tickets only.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi label="Open Indents" value={kpi.openInd} />
        <Kpi label="Closed Indents" value={kpi.closedInd} />
        <Kpi label="Open Oracles" value={kpi.openO} />
        <Kpi label="Closed Oracles" value={kpi.closedO} />
        <Kpi label="Avg Closure Time" value={kpi.avg} />
        <Kpi label="Longest Open" value={kpi.longest} hint={kpi.longestLabel} />
        <Kpi label="Oracles Pending Closure" value={kpi.pending} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input placeholder="Indent no, Case ID, OEM Case ID, company, product model/serial, engineer, city…" value={q} onChange={(e) => setQ(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-2">OEM Case / Company</th>
                <th className="p-2">Oracles · Defective / Exchange / Received</th>
                <th className="p-2">Date</th>
                <th className="p-2">Status</th>
                <th className="p-2">Age</th>
                <th className="p-2">Type</th>
                <th className="p-2">Engineer</th>
                <th className="p-2 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={8}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={8}>No Indents yet. Create one from an OEM ticket.</td></tr>
              ) : filtered.map((r) => {
                const st = indentStatusFromOracles(r.oracles_data);
                const cAt = indentClosedAt(r.oracles_data);
                const age = formatAge(r.created_at, cAt);
                const oracles = r.oracles_data || [];
                const oClosed = oracles.filter((o) => oracleStatus(o) === "closed").length;
                return (
                <tr key={r.id} className="border-t align-top hover:bg-muted/30">
                  <td className="p-2 whitespace-nowrap">
                    <div className="text-sm font-semibold text-foreground leading-tight">{r.oem_case_id || "—"}</div>
                    <div className="text-[11px] text-muted-foreground leading-tight">{r.company || "—"}</div>
                  </td>
                  <td className="p-2">
                    {oracles.length === 0 ? (
                      <span className="text-sm text-muted-foreground">No oracles</span>
                    ) : (
                      <div className="space-y-2">
                        {oracles.map((o, i) => {
                          const st2 = oracleStatus(o);
                          const defs = (o.defective_rows && o.defective_rows.length)
                            ? o.defective_rows
                            : (o.defective ? [{ def_model_no: o.defective.def_model_no, def_serial_no: o.defective.def_serial_no, qty: o.defective.qty }] : []);
                          const exs = (o.exchange_rows && o.exchange_rows.length)
                            ? o.exchange_rows
                            : (o.exchange ? [o.exchange] : []);
                          const recs = (o.received_rows && o.received_rows.length)
                            ? o.received_rows
                            : (o.received ? [o.received] : []);
                          const rowCount = Math.max(defs.length, exs.length, recs.length, 1);
                          const cleanModel = (m?: string) => (m || "").split("||").pop() || "";
                          return (
                            <div key={i} className="rounded border bg-muted/30 px-2 py-1.5 space-y-1">
                              <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${st2 === "closed" ? "bg-emerald-500" : "bg-amber-500"}`} />
                                <span className="font-mono">Oracle {o.oracle_no || `#${i + 1}`}</span>
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-normal">
                                  {st2 === "closed" ? "Closed" : "Open"}
                                </span>
                              </div>
                              {Array.from({ length: rowCount }).map((_, ri) => {
                                const d = defs[ri];
                                const e = exs[ri];
                                const rc = recs[ri];
                                return (
                                  <div key={ri} className="text-xs leading-tight space-y-0.5 pl-3">
                                    <Line label="Defective" model={d?.def_model_no || r.product_model} serial={d?.def_serial_no || r.product_serial} />
                                    <Line label="Exchange" model={cleanModel(e?.model_no)} serial={e?.serial_no} />
                                    <Line label="Received" model={cleanModel(rc?.model_no)} serial={rc?.serial_no} />
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                        <div className="text-[11px] text-muted-foreground font-medium">{oClosed}/{oracles.length} closed</div>
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-sm whitespace-nowrap" title={r.indent_date || ""}>{fmtDate(r.indent_date)}</td>
                  <td className="p-2"><Badge variant={st === "closed" ? "default" : "secondary"}>{st === "closed" ? "Closed" : "Open"}</Badge></td>
                  <td className="p-2 text-xs whitespace-nowrap">{compactAge(age)}</td>
                  <td className="p-2"><Badge variant="secondary" className="whitespace-nowrap">{indentTypeLabel(r.indent_type)}</Badge></td>
                  <td className="p-2 text-xs whitespace-nowrap">{r.engineer_name || "—"}</td>
                  <td className="p-2 text-right">
                    <Link to="/indent/$id" params={{ id: r.id }}>
                      <Button variant="ghost" size="sm"><ExternalLink className="h-4 w-4" /></Button>
                    </Link>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function compactAge(age: string): string {
  // "13 Hours 35 Min" -> "13h 35m"; "2 Days 4 Hours" -> "2d 4h"
  return age
    .replace(/\s*Days?/gi, "d")
    .replace(/\s*Hours?/gi, "h")
    .replace(/\s*Min(ute)?s?/gi, "m")
    .replace(/\s*Sec(ond)?s?/gi, "s")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mmm = MONTHS[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mmm}-${yy}`;
}

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground font-mono truncate">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Line({ label, model, serial }: { label: string; model?: string | null; serial?: string | null }) {
  const m = (model || "").trim();
  const s = (serial || "").trim();
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-16 shrink-0">{label}</span>
      <span className="font-medium">{m || "—"}</span>
      <span className="text-muted-foreground">/</span>
      <span className="font-mono">{s || "—"}</span>
    </div>
  );
}