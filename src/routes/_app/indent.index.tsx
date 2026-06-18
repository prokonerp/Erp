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
              <tr className="text-left">
                <th className="p-2">Indent No</th>
                <th className="p-2">Date</th>
                <th className="p-2">Status</th>
                <th className="p-2">Age</th>
                <th className="p-2">Case ID</th>
                <th className="p-2">OEM Case ID</th>
                <th className="p-2">Company</th>
                <th className="p-2">Product Model</th>
                <th className="p-2">Product Serial</th>
                <th className="p-2">Oracles</th>
                <th className="p-2">Type</th>
                <th className="p-2">Engineer</th>
                <th className="p-2 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={13}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={13}>No Indents yet. Create one from an OEM ticket.</td></tr>
              ) : filtered.map((r) => {
                const st = indentStatusFromOracles(r.oracles_data);
                const cAt = indentClosedAt(r.oracles_data);
                const age = formatAge(r.created_at, cAt);
                const oCount = r.oracles_data?.length || 0;
                const oClosed = (r.oracles_data || []).filter((o) => oracleStatus(o) === "closed").length;
                return (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-mono">{r.indent_no}</td>
                  <td className="p-2">{r.indent_date}</td>
                  <td className="p-2"><Badge variant={st === "closed" ? "default" : "secondary"}>{st === "closed" ? "Closed" : "Open"}</Badge></td>
                  <td className="p-2 whitespace-nowrap">{age}</td>
                  <td className="p-2 font-mono">{r.case_id || "—"}</td>
                  <td className="p-2 font-mono">{r.oem_case_id || "—"}</td>
                  <td className="p-2">{r.company || "—"}</td>
                  <td className="p-2">{r.product_model || "—"}</td>
                  <td className="p-2 font-mono">{r.product_serial || "—"}</td>
                  <td className="p-2 text-center">{oClosed}/{oCount}</td>
                  <td className="p-2"><Badge variant="secondary">{indentTypeLabel(r.indent_type)}</Badge></td>
                  <td className="p-2">{r.engineer_name || "—"}</td>
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