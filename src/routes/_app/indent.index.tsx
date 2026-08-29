import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  ChevronDown,
  ExternalLink,
  MailOpen,
  PackageCheck,
  Search,
  CheckCircle2,
} from "lucide-react";
import {
  indentTypeLabel,
  indentStatusFromOracles,
  indentClosedAt,
  formatAge,
  oracleStatus,
  oracleProgress,
  type Indent,
  type OracleBlock,
} from "@/lib/indent";
import { useRealtimeRefetch } from "@/lib/softDelete";

export const Route = createFileRoute("/_app/indent/")({
  component: IndentList,
});

type Status = "open" | "closed";

function IndentList() {
  const [rows, setRows] = useState<Indent[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<Status>("open");

  const load = async () => {
    const { data } = await supabase
      .from("indents" as never)
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    setRows((data || []) as unknown as Indent[]);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);
  useRealtimeRefetch("indents", load);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  void tick;

  const s = q.toLowerCase().trim();
  const filtered = useMemo(() => {
    const base = !s
      ? rows
      : rows.filter((r) =>
          [
            r.indent_no,
            r.case_id,
            r.oem_case_id,
            r.oracle_number,
            r.company,
            r.product_model,
            r.product_serial,
            r.engineer_name,
            r.indent_city,
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(s)),
        );
    return {
      open: base.filter((r) => indentStatusFromOracles(r.oracles_data) === "open"),
      closed: base.filter((r) => indentStatusFromOracles(r.oracles_data) === "closed"),
    };
  }, [rows, s]);

  const kpi = useMemo(() => {
    let openInd = 0,
      closedInd = 0,
      openO = 0,
      closedO = 0;
    let totalClosureMs = 0,
      closedCount = 0;
    let longestOpenMs = 0;
    let longestOpenLabel = "—";
    for (const r of rows) {
      const st = indentStatusFromOracles(r.oracles_data);
      const oracles = r.oracles_data || [];
      for (const o of oracles) {
        if (oracleStatus(o) === "closed") closedO++;
        else openO++;
      }
      if (st === "closed") {
        closedInd++;
        const cAt = indentClosedAt(r.oracles_data);
        if (cAt) {
          totalClosureMs += new Date(cAt).getTime() - new Date(r.created_at).getTime();
          closedCount++;
        }
      } else {
        openInd++;
        const age = Date.now() - new Date(r.created_at).getTime();
        if (age > longestOpenMs) {
          longestOpenMs = age;
          longestOpenLabel = r.indent_no || r.id;
        }
      }
    }
    const avgIso = closedCount
      ? new Date(Date.now() - totalClosureMs / closedCount).toISOString()
      : null;
    const avg = avgIso ? formatAge(avgIso) : "—";
    const longest = longestOpenMs
      ? formatAge(new Date(Date.now() - longestOpenMs).toISOString())
      : "—";
    return {
      openInd,
      closedInd,
      openO,
      closedO,
      avg,
      longest,
      longestLabel: longestOpenLabel,
      pending: openO,
    };
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
          <Input
            placeholder="Indent no, Oracle#, Case ID, OEM Case ID, company, product model/serial, engineer, city…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Status)}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="open" className="gap-1.5">
              <MailOpen className="h-4 w-4" /> Open ({filtered.open.length})
            </TabsTrigger>
            <TabsTrigger value="closed" className="gap-1.5">
              <PackageCheck className="h-4 w-4" /> Closed ({filtered.closed.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="open" className="mt-4">
          <IndentCards items={filtered.open} loading={loading} emptyHint="No open indents." />
        </TabsContent>

        <TabsContent value="closed" className="mt-4">
          <IndentCards
            items={filtered.closed}
            loading={loading}
            emptyHint="No closed indents yet."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function IndentCards({
  items,
  loading,
  emptyHint,
}: {
  items: Indent[];
  loading: boolean;
  emptyHint: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-8" />
              <TableHead>OEM Case / Company</TableHead>
              <TableHead>Oracles · Defective / Exchange / Received</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Engineer</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="p-4 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10">
                  <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                    <CheckCircle2 className="h-6 w-6 text-muted-foreground/50" />
                    {emptyHint}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              items.map((r) => (
                <IndentRow
                  key={r.id}
                  indent={r}
                  open={openId === r.id}
                  onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function IndentRow({
  indent: r,
  open,
  onToggle,
}: {
  indent: Indent;
  open: boolean;
  onToggle: () => void;
}) {
  const st = indentStatusFromOracles(r.oracles_data);
  const cAt = indentClosedAt(r.oracles_data);
  const age = formatAge(r.created_at, cAt);
  const oracles = r.oracles_data || [];
  const closedCount = oracles.filter((o) => oracleStatus(o) === "closed").length;
  const rowClass = `cursor-pointer transition-colors ${open ? "bg-muted/40" : "hover:bg-muted/40"}`;

  return (
    <>
      <TableRow className={rowClass} onClick={onToggle} aria-expanded={open}>
        <TableCell className="w-8">
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <div className="text-sm font-semibold text-foreground leading-tight">
            {r.oem_case_id || "—"}
          </div>
          <div className="text-[11px] text-muted-foreground leading-tight">{r.company || "—"}</div>
        </TableCell>
        <TableCell>
          {oracles.length === 0 ? (
            <span className="text-sm text-muted-foreground">No oracles</span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">
                {closedCount}/{oracles.length} closed
              </span>
              <span className="text-[11px] text-muted-foreground">·</span>
              <OracleChips oracles={oracles} indentType={r.indent_type} />
            </div>
          )}
        </TableCell>
        <TableCell className="text-sm whitespace-nowrap" title={r.indent_date || ""}>
          {fmtDate(r.indent_date)}
        </TableCell>
        <TableCell>
          <Badge variant={st === "closed" ? "default" : "secondary"}>
            {st === "closed" ? "Closed" : "Open"}
          </Badge>
        </TableCell>
        <TableCell className="text-xs whitespace-nowrap">{compactAge(age)}</TableCell>
        <TableCell>
          <Badge variant="secondary" className="whitespace-nowrap">
            {indentTypeLabel(r.indent_type)}
          </Badge>
        </TableCell>
        <TableCell className="text-xs whitespace-nowrap">{r.engineer_name || "—"}</TableCell>
        <TableCell className="text-right">
          <Link to="/indent/$id" params={{ id: r.id }} onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ExternalLink className="h-4 w-4" />
            </Button>
          </Link>
        </TableCell>
      </TableRow>

      {open && (
        <TableRow className="bg-muted/30">
          <TableCell className="bg-muted/30" />
          <TableCell colSpan={8} className="bg-muted/30 p-3">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
              <div className="space-y-3 min-w-0">
                {oracles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No oracles.</p>
                ) : (
                  <>
                    <div className="space-y-3">
                      {oracles.map((o, i) => (
                        <OracleDetail
                          key={i}
                          o={o}
                          indentType={r.indent_type}
                          fallbackModel={r.product_model}
                          fallbackSerial={r.product_serial}
                          index={i}
                        />
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-medium">
                      {closedCount}/{oracles.length} closed
                    </p>
                  </>
                )}
              </div>
              <ProblemRemarksPanel indent={r} />
              <OracleStatusPanel indent={r} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ProblemRemarksPanel({ indent: r }: { indent: Indent }) {
  const hasModel = !!r.product_model?.trim();
  const hasSerial = !!r.product_serial?.trim();
  const rest: Array<[string, string]> = [];
  if (r.engineer_name) rest.push(["Engineer", r.engineer_name]);
  if (r.indent_no) rest.push(["Indent No", r.indent_no]);
  if (r.case_id) rest.push(["Case ID", r.case_id]);

  const label = "text-muted-foreground uppercase tracking-wide text-[10px]";
  const value = "font-medium font-mono";

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2.5">
      {(hasModel || hasSerial) && (
        <div className="text-xs leading-snug">
          <span className={label}>Model: </span>
          <span className={value}>{r.product_model?.trim() || "—"}</span>
          {hasSerial && (
            <>
              <span className={`${label} ml-3`}>Serial: </span>
              <span className={value}>{r.product_serial?.trim() || "—"}</span>
            </>
          )}
        </div>
      )}
      {rest.map(([k, v]) => (
        <div key={k} className="text-xs leading-snug">
          <span className={label}>{k}: </span>
          <span className={value}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function OracleStatusPanel({ indent: r }: { indent: Indent }) {
  const oracles = r.oracles_data || [];

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground font-medium">
        Oracle Status · Who &amp; When
      </div>
      {oracles.length === 0 ? (
        <p className="text-xs text-muted-foreground">No oracles.</p>
      ) : (
        <div className="space-y-1.5">
          {oracles.map((o, i) => {
            const prog = oracleProgress(o, r.indent_type);
            const dotCls =
              prog === "closed"
                ? "bg-emerald-500"
                : prog === "in_progress"
                  ? "bg-amber-500"
                  : "bg-rose-500";
            const progLabel =
              prog === "closed" ? "Closed" : prog === "in_progress" ? "In Progress" : "Pending";
            const closed = oracleClosedSummary(o);
            return (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`h-2 w-2 mt-1 rounded-full shrink-0 ${dotCls}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium">
                    <span className="font-mono">Oracle {o.oracle_no || `#${i + 1}`}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {progLabel}
                    </span>
                  </div>
                  {closed && <p className="text-muted-foreground leading-snug">{closed}</p>}
                  {o.reopened?.at ? (
                    <p className="text-amber-600 dark:text-amber-400 leading-snug">
                      Re-opened{o.reopened.by ? ` by ${o.reopened.by}` : ""}
                      {o.reopened.reason ? ` · ${o.reopened.reason}` : ""}
                    </p>
                  ) : null}
                  {o.force_closed ? (
                    <p className="text-muted-foreground leading-snug">
                      Force-closed{o.force_close_reason ? ` · ${o.force_close_reason}` : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OracleChips({
  oracles,
  indentType,
}: {
  oracles: OracleBlock[];
  indentType: string | null;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {oracles.map((o, i) => {
        const prog = oracleProgress(o, indentType);
        const dotCls =
          prog === "closed"
            ? "bg-emerald-500"
            : prog === "in_progress"
              ? "bg-amber-500"
              : "bg-rose-500";
        return (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotCls}`}
            title={`Oracle ${o.oracle_no || `#${i + 1}`}`}
          />
        );
      })}
    </div>
  );
}

function OracleDetail({
  o,
  indentType,
  fallbackModel,
  fallbackSerial,
  index,
}: {
  o: OracleBlock;
  indentType: string | null;
  fallbackModel?: string | null;
  fallbackSerial?: string | null;
  index: number;
}) {
  const prog = oracleProgress(o, indentType);
  const dotCls =
    prog === "closed" ? "bg-emerald-500" : prog === "in_progress" ? "bg-amber-500" : "bg-rose-500";
  const progLabel =
    prog === "closed" ? "Closed" : prog === "in_progress" ? "In Progress" : "Pending";

  const defs =
    o.defective_rows && o.defective_rows.length
      ? o.defective_rows
      : o.defective
        ? [
            {
              def_model_no: o.defective.def_model_no,
              def_serial_no: o.defective.def_serial_no,
              qty: o.defective.qty,
            },
          ]
        : [];
  const exs =
    o.exchange_rows && o.exchange_rows.length ? o.exchange_rows : o.exchange ? [o.exchange] : [];
  const recs =
    o.received_rows && o.received_rows.length ? o.received_rows : o.received ? [o.received] : [];
  const rowCount = Math.max(defs.length, exs.length, recs.length, 1);
  const cleanModel = (m?: string) => (m || "").split("||").pop() || "";

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotCls}`} />
        <span className="font-mono">Oracle {o.oracle_no || `#${index + 1}`}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-normal">
          {progLabel}
        </span>
      </div>
      {Array.from({ length: rowCount }).map((_, ri) => {
        const d = defs[ri];
        const e = exs[ri];
        const rc = recs[ri];
        return (
          <div key={ri} className="text-xs leading-tight space-y-0.5 pl-3">
            <Line
              label="Defective"
              model={d?.def_model_no || fallbackModel}
              serial={d?.def_serial_no || fallbackSerial}
            />
            <Line label="Exchange" model={cleanModel(e?.model_no)} serial={e?.serial_no} />
            <Line label="Received" model={cleanModel(rc?.model_no)} serial={rc?.serial_no} />
          </div>
        );
      })}
      {o.reopened?.at ? (
        <p className="pl-3 text-[11px] text-amber-600 dark:text-amber-400">
          Re-opened by {o.reopened.by || "—"}
          {o.reopened.reason ? ` · ${o.reopened.reason}` : ""}
        </p>
      ) : null}
      {o.force_closed ? (
        <p className="pl-3 text-[11px] text-muted-foreground">
          Force-closed{o.force_close_reason ? ` · ${o.force_close_reason}` : ""}
        </p>
      ) : null}
      {oracleClosedSummary(o) ? (
        <p className="border-t border-border/60 pt-1.5 pl-3 text-[11px] text-muted-foreground">
          {oracleClosedSummary(o)}
        </p>
      ) : null}
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mmm = MONTHS[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mmm}-${yy}`;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mmm = MONTHS[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mmm}-${yy}, ${h}:${mm} ${ampm}`;
}

function oracleClosedSummary(o: OracleBlock): string | null {
  if (o.status === "closed") {
    const who = o.closed_by_name?.trim();
    const at = o.closed_at ? fmtDateTime(o.closed_at) : null;
    if (who && at) return `${who} · ${at}`;
    if (who) return `Closed by ${who}`;
    if (at) return `Closed ${at}`;
    return "Closed";
  }
  return null;
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

function Line({
  label,
  model,
  serial,
}: {
  label: string;
  model?: string | null;
  serial?: string | null;
}) {
  const m = (model || "").trim();
  const s = (serial || "").trim();
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground w-16 shrink-0">
        {label}
      </span>
      <span className="font-medium">{m || "—"}</span>
      <span className="text-muted-foreground">/</span>
      <span className="font-mono">{s || "—"}</span>
    </div>
  );
}
