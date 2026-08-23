import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Eye, FilePlus2, Search } from "lucide-react";
import { fmtDate } from "@/lib/amc";
import { istTodayIso, localDateIso } from "@/lib/dateRange";

export const Route = createFileRoute("/_app/amc/oem")({
  component: AmcOemData,
  head: () => ({ meta: [{ title: "AMC OEM Data — Prokon" }] }),
});

type OemRow = {
  source: "Ticket" | "AMC" | "PM";
  source_id: string;
  oem_brand: string | null;
  oem_ref_id: string | null;
  oem_purchase_date: string | null;
  customer_id: string | null;
  product_id: string | null;
  serial_no: string | null;
  // joined
  customer?: { name: string; phone: string | null; city: string | null; sector: string | null } | null;
  product?: { category: string | null; model: string | null; name: string | null } | null;
};

type AmcUnitLite = { product_id?: string | null; serial_no?: string | null; category?: string | null; model?: string | null };

function deriveExpiry(purchase: string | null): string | null {
  if (!purchase) return null;
  const d = new Date(purchase + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return localDateIso(d);
}

function statusOf(expiry: string | null): { label: string; cls: string } {
  if (!expiry) return { label: "Unknown", cls: "bg-muted text-foreground border-border" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const e = new Date(expiry + "T00:00:00");
  const diff = Math.floor((e.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { label: "Expired", cls: "bg-red-100 text-red-800 border-red-300" };
  if (diff <= 30) return { label: "Expiring Soon", cls: "bg-orange-100 text-orange-800 border-orange-300" };
  return { label: "Active", cls: "bg-green-100 text-green-800 border-green-300" };
}

function AmcOemData() {
  const [rows, setRows] = useState<OemRow[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "expiring" | "expired">("all");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { void load(); }, []);

  const load = async () => {
    setLoading(true);
    const today = istTodayIso();

    // 1. OEM sources
    const [tk, am, pm] = await Promise.all([
      supabase.from("tickets").select("id,customer_id,serial_no,product,oem_brand,oem_ref_id,oem_purchase_date").eq("oem_call", true),
      supabase.from("amcs").select("id,customer_id,units,oem_brand,oem_ref_id,oem_purchase_date").eq("oem_call", true),
      supabase.from("pm_visits").select("id,amc_id,oem_brand,oem_ref_id,oem_purchase_date").eq("oem_call", true),
    ]);

    // 2. Active AMC coverage map: key = `${customer_id}::${product_id|serial}`
    const { data: activeAmcs } = await supabase.from("amcs")
      .select("customer_id,units,start_date,end_date")
      .lte("start_date", today)
      .gte("end_date", today);
    const covered = new Set<string>();
    for (const a of (activeAmcs || []) as { customer_id: string | null; units: AmcUnitLite[] }[]) {
      if (!a.customer_id) continue;
      for (const u of a.units || []) {
        if (u.product_id) covered.add(`${a.customer_id}::p::${u.product_id}`);
        if (u.serial_no) covered.add(`${a.customer_id}::s::${(u.serial_no || "").toUpperCase()}`);
      }
    }

    const out: OemRow[] = [];

    for (const t of (tk.data || []) as Array<{ id: string; customer_id: string | null; serial_no: string | null; product: string | null; oem_brand: string | null; oem_ref_id: string | null; oem_purchase_date: string | null }>) {
      out.push({
        source: "Ticket", source_id: t.id,
        oem_brand: t.oem_brand, oem_ref_id: t.oem_ref_id, oem_purchase_date: t.oem_purchase_date,
        customer_id: t.customer_id, product_id: null, serial_no: t.serial_no,
      });
    }
    for (const a of (am.data || []) as Array<{ id: string; customer_id: string | null; units: AmcUnitLite[]; oem_brand: string | null; oem_ref_id: string | null; oem_purchase_date: string | null }>) {
      for (const u of a.units || []) {
        out.push({
          source: "AMC", source_id: a.id,
          oem_brand: a.oem_brand, oem_ref_id: a.oem_ref_id, oem_purchase_date: a.oem_purchase_date,
          customer_id: a.customer_id, product_id: u.product_id || null, serial_no: u.serial_no || null,
        });
      }
    }
    // PM visits inherit customer + units via parent AMC
    const pmAmcIds = Array.from(new Set(((pm.data || []) as Array<{ amc_id: string }>).map((p) => p.amc_id)));
    const pmAmcMap = new Map<string, { customer_id: string | null; units: AmcUnitLite[] }>();
    if (pmAmcIds.length) {
      const { data: amcRows } = await supabase.from("amcs").select("id,customer_id,units").in("id", pmAmcIds);
      for (const a of (amcRows || []) as Array<{ id: string; customer_id: string | null; units: AmcUnitLite[] }>) {
        pmAmcMap.set(a.id, { customer_id: a.customer_id, units: a.units || [] });
      }
    }
    for (const p of (pm.data || []) as Array<{ id: string; amc_id: string; oem_brand: string | null; oem_ref_id: string | null; oem_purchase_date: string | null }>) {
      const parent = pmAmcMap.get(p.amc_id);
      if (!parent) continue;
      for (const u of parent.units || []) {
        out.push({
          source: "PM", source_id: p.id,
          oem_brand: p.oem_brand, oem_ref_id: p.oem_ref_id, oem_purchase_date: p.oem_purchase_date,
          customer_id: parent.customer_id, product_id: u.product_id || null, serial_no: u.serial_no || null,
        });
      }
    }

    // 3. Product-level exclusion
    const visible = out.filter((r) => {
      if (!r.customer_id) return true;
      const pk = r.product_id ? `${r.customer_id}::p::${r.product_id}` : null;
      const sk = r.serial_no ? `${r.customer_id}::s::${r.serial_no.toUpperCase()}` : null;
      if (pk && covered.has(pk)) return false;
      if (sk && covered.has(sk)) return false;
      return true;
    });

    // 4. Dedup by (oem_ref_id, customer_id, product_id|serial)
    const seen = new Set<string>();
    const deduped: OemRow[] = [];
    for (const r of visible) {
      const k = `${r.oem_ref_id || ""}|${r.customer_id || ""}|${r.product_id || ""}|${(r.serial_no || "").toUpperCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(r);
    }

    // 5. Join customers + products
    const custIds = Array.from(new Set(deduped.map((r) => r.customer_id).filter(Boolean) as string[]));
    const prodIds = Array.from(new Set(deduped.map((r) => r.product_id).filter(Boolean) as string[]));
    const [{ data: custs }, { data: prods }] = await Promise.all([
      custIds.length
        ? supabase.from("customers").select("id,company,contact_name,phone,city,billing_city,sector").in("id", custIds)
        : Promise.resolve({ data: [] as Array<{ id: string; company: string | null; contact_name: string | null; phone: string | null; city: string | null; billing_city: string | null; sector: string | null }> }),
      prodIds.length
        ? supabase.from("products").select("id,name,model,category").in("id", prodIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; model: string | null; category: string | null }> }),
    ]);
    const custMap = new Map(((custs || []) as Array<{ id: string; company: string | null; contact_name: string | null; phone: string | null; city: string | null; billing_city: string | null; sector: string | null }>).map((c) => [c.id, c]));
    const prodMap = new Map(((prods || []) as Array<{ id: string; name: string | null; model: string | null; category: string | null }>).map((p) => [p.id, p]));
    for (const r of deduped) {
      const c = r.customer_id ? custMap.get(r.customer_id) : null;
      if (c) r.customer = { name: c.company || c.contact_name || "—", phone: c.phone, city: c.billing_city || c.city, sector: c.sector };
      const p = r.product_id ? prodMap.get(r.product_id) : null;
      if (p) r.product = { category: p.category, model: p.model, name: p.name };
    }

    setRows(deduped);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return rows.filter((r) => {
      const expiry = deriveExpiry(r.oem_purchase_date);
      const st = statusOf(expiry).label;
      if (statusFilter === "expiring" && st !== "Expiring Soon") return false;
      if (statusFilter === "expired" && st !== "Expired") return false;
      if (!s) return true;
      return [r.oem_brand, r.oem_ref_id, r.customer?.name, r.customer?.phone, r.customer?.city, r.customer?.sector, r.product?.category, r.product?.model, r.serial_no]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [rows, q, statusFilter]);

  const counts = useMemo(() => {
    let expired = 0, expiring = 0;
    for (const r of rows) {
      const st = statusOf(deriveExpiry(r.oem_purchase_date)).label;
      if (st === "Expired") expired++;
      else if (st === "Expiring Soon") expiring++;
    }
    return { total: rows.length, expiring, expired };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to="/amc"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button></Link>
          <h1 className="text-2xl font-bold">AMC OEM Data</h1>
        </div>
        <div className="text-xs text-muted-foreground max-w-md text-right">
          OEM products not covered under any active AMC — convert these to AMC opportunities.
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <button onClick={() => setStatusFilter("all")} className={`text-left rounded-lg border-2 p-3 bg-muted ${statusFilter === "all" ? "ring-2 ring-primary" : ""}`}>
          <div className="text-xs uppercase opacity-70">Total Opportunities</div><div className="text-2xl font-bold">{counts.total}</div>
        </button>
        <button onClick={() => setStatusFilter("expiring")} className={`text-left rounded-lg border-2 p-3 bg-orange-100 border-orange-300 text-orange-900 ${statusFilter === "expiring" ? "ring-2 ring-primary" : ""}`}>
          <div className="text-xs uppercase opacity-70">Expiring ≤ 30 days</div><div className="text-2xl font-bold">{counts.expiring}</div>
        </button>
        <button onClick={() => setStatusFilter("expired")} className={`text-left rounded-lg border-2 p-3 bg-red-100 border-red-300 text-red-900 ${statusFilter === "expired" ? "ring-2 ring-primary" : ""}`}>
          <div className="text-xs uppercase opacity-70">Expired</div><div className="text-2xl font-bold">{counts.expired}</div>
        </button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>Uncovered OEM Products ({filtered.length})</CardTitle>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8 w-64" placeholder="Search brand, ref, customer, serial" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OEM Brand</TableHead>
                  <TableHead>Ref ID</TableHead>
                  <TableHead>Purchase</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Serial</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!loading && filtered.map((r, i) => {
                  const expiry = deriveExpiry(r.oem_purchase_date);
                  const st = statusOf(expiry);
                  const params = new URLSearchParams();
                  if (r.customer_id) params.set("customer", r.customer_id);
                  if (r.product_id) params.set("product", r.product_id);
                  if (r.serial_no) params.set("serial", r.serial_no);
                  if (r.oem_ref_id) params.set("oem_ref", r.oem_ref_id);
                  const detailSearch: Record<string, string> = {};
                  if (r.product_id) detailSearch.product = r.product_id;
                  if (r.serial_no) detailSearch.serial = r.serial_no;
                  const goDetail = () => navigate({
                    to: "/amc/oem/$source/$id",
                    params: { source: r.source, id: r.source_id },
                    search: detailSearch as never,
                  });
                  return (
                    <TableRow key={`${r.source}-${r.source_id}-${i}`} onClick={goDetail} className="cursor-pointer">
                      <TableCell className="font-medium">{r.oem_brand || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.oem_ref_id || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtDate(r.oem_purchase_date)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtDate(expiry)}</TableCell>
                      <TableCell><Badge variant="outline" className={st.cls}>{st.label}</Badge></TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{r.customer?.name || "—"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {[r.customer?.phone, r.customer?.city, r.customer?.sector].filter(Boolean).join(" · ")}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.product ? (
                          <>
                            <div>{r.product.model || r.product.name || "—"}</div>
                            <div className="text-[11px] text-muted-foreground">{r.product.category || ""}</div>
                          </>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.serial_no || "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{r.source}</Badge></TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); goDetail(); }}>
                            <Eye className="h-4 w-4 mr-1" />View
                          </Button>
                          <a href={`/amc/new?${params.toString()}`} onClick={(e) => e.stopPropagation()}>
                            <Button size="sm"><FilePlus2 className="h-4 w-4 mr-1" />Create AMC</Button>
                          </a>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No OEM opportunities — all OEM products are already covered.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}