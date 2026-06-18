import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Search } from "lucide-react";
import { indentTypeLabel, type Indent } from "@/lib/indent";

export const Route = createFileRoute("/_app/indent/")({
  component: IndentList,
});

function IndentList() {
  const [rows, setRows] = useState<Indent[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

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

  const s = q.toLowerCase().trim();
  const filtered = !s
    ? rows
    : rows.filter((r) =>
        [r.indent_no, r.case_id, r.oem_case_id, r.company, r.product_model, r.product_serial, r.engineer_name, r.indent_city]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(s)),
      );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Indent</h1>
        <div className="text-sm text-muted-foreground">
          Indents are created from OEM-tagged Tickets only.
        </div>
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
                <tr><td className="p-4 text-muted-foreground" colSpan={10}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={10}>No Indents yet. Create one from an OEM ticket.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-mono">{r.indent_no}</td>
                  <td className="p-2">{r.indent_date}</td>
                  <td className="p-2 font-mono">{r.case_id || "—"}</td>
                  <td className="p-2 font-mono">{r.oem_case_id || "—"}</td>
                  <td className="p-2">{r.company || "—"}</td>
                  <td className="p-2">{r.product_model || "—"}</td>
                  <td className="p-2 font-mono">{r.product_serial || "—"}</td>
                  <td className="p-2 text-center">{(r.oracles_data?.length) || 0}</td>
                  <td className="p-2"><Badge variant="secondary">{indentTypeLabel(r.indent_type)}</Badge></td>
                  <td className="p-2">{r.engineer_name || "—"}</td>
                  <td className="p-2 text-right">
                    <Link to="/indent/$id" params={{ id: r.id }}>
                      <Button variant="ghost" size="sm"><ExternalLink className="h-4 w-4" /></Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}