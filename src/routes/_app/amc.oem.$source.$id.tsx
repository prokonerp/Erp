import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { fmtDate } from "@/lib/amc";

export const Route = createFileRoute("/_app/amc/oem/$source/$id")({
  component: OemDetail,
  validateSearch: (s: Record<string, unknown>) => ({
    product: (s.product as string) || undefined,
    serial: (s.serial as string) || undefined,
  }),
  head: () => ({ meta: [{ title: "OEM Product Detail — Prokon" }] }),
});

type Detail = {
  source: string;
  source_id: string;
  oem_brand: string | null;
  oem_ref_id: string | null;
  oem_purchase_date: string | null;
  customer_id: string | null;
  product_id: string | null;
  serial_no: string | null;
  customer?: { name: string; phone: string | null; email: string | null; address: string | null; city: string | null; sector: string | null } | null;
  product?: { name: string | null; model: string | null; category: string | null } | null;
  ref_label?: string | null;
};

function deriveExpiry(purchase: string | null): string | null {
  if (!purchase) return null;
  const d = new Date(purchase + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function statusOf(expiry: string | null) {
  if (!expiry) return { label: "Unknown", cls: "bg-muted text-foreground border-border", days: null as number | null };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const e = new Date(expiry + "T00:00:00");
  const diff = Math.floor((e.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { label: "Expired", cls: "bg-red-100 text-red-800 border-red-300", days: diff };
  if (diff <= 30) return { label: "Expiring Soon", cls: "bg-orange-100 text-orange-800 border-orange-300", days: diff };
  return { label: "Active", cls: "bg-green-100 text-green-800 border-green-300", days: diff };
}

const NA = ({ v }: { v: React.ReactNode }) => <>{v || <span className="text-muted-foreground italic">No Data Available</span>}</>;

function OemDetail() {
  const { source, id } = Route.useParams();
  const { product: productQ, serial: serialQ } = Route.useSearch();
  const navigate = useNavigate();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [source, id, productQ, serialQ]);

  const load = async () => {
    setLoading(true); setNotFound(false);
    let base: Detail | null = null;

    if (source === "Ticket") {
      const { data } = await supabase.from("tickets")
        .select("id,ticket_no,customer_id,serial_no,product,oem_brand,oem_ref_id,oem_purchase_date")
        .eq("id", id).maybeSingle();
      if (data) {
        base = {
          source: "Ticket", source_id: data.id,
          oem_brand: data.oem_brand, oem_ref_id: data.oem_ref_id, oem_purchase_date: data.oem_purchase_date,
          customer_id: data.customer_id, product_id: null, serial_no: data.serial_no,
          ref_label: data.ticket_no || data.id,
        };
      }
    } else if (source === "AMC") {
      const { data } = await supabase.from("amcs")
        .select("id,agreement_no,customer_id,units,oem_brand,oem_ref_id,oem_purchase_date")
        .eq("id", id).maybeSingle();
      if (data) {
        const units = (data.units || []) as Array<{ product_id?: string | null; serial_no?: string | null }>;
        const u = units.find((x) =>
          (productQ && x.product_id === productQ) ||
          (serialQ && (x.serial_no || "").toUpperCase() === serialQ.toUpperCase())
        ) || units[0] || {};
        base = {
          source: "AMC", source_id: data.id,
          oem_brand: data.oem_brand, oem_ref_id: data.oem_ref_id, oem_purchase_date: data.oem_purchase_date,
          customer_id: data.customer_id, product_id: u.product_id || null, serial_no: u.serial_no || null,
          ref_label: data.agreement_no || data.id,
        };
      }
    } else if (source === "PM") {
      const { data } = await supabase.from("pm_visits")
        .select("id,amc_id,oem_brand,oem_ref_id,oem_purchase_date")
        .eq("id", id).maybeSingle();
      if (data) {
        const { data: amc } = await supabase.from("amcs")
          .select("agreement_no,customer_id,units").eq("id", data.amc_id).maybeSingle();
        const units = ((amc?.units || []) as Array<{ product_id?: string | null; serial_no?: string | null }>);
        const u = units.find((x) =>
          (productQ && x.product_id === productQ) ||
          (serialQ && (x.serial_no || "").toUpperCase() === serialQ.toUpperCase())
        ) || units[0] || {};
        base = {
          source: "PM", source_id: data.id,
          oem_brand: data.oem_brand, oem_ref_id: data.oem_ref_id, oem_purchase_date: data.oem_purchase_date,
          customer_id: amc?.customer_id || null, product_id: u.product_id || null, serial_no: u.serial_no || null,
          ref_label: amc?.agreement_no || data.amc_id,
        };
      }
    }

    if (!base) { setNotFound(true); setLoading(false); return; }

    if (base.customer_id) {
      const { data: c } = await supabase.from("customers")
        .select("company,contact_name,phone,email,billing_address,address,city,billing_city,sector")
        .eq("id", base.customer_id).maybeSingle();
      if (c) {
        base.customer = {
          name: c.company || c.contact_name || "—",
          phone: c.phone,
          email: c.email,
          address: c.billing_address || c.address,
          city: c.billing_city || c.city,
          sector: c.sector,
        };
      }
    }
    if (base.product_id) {
      const { data: p } = await supabase.from("products")
        .select("name,model,category").eq("id", base.product_id).maybeSingle();
      if (p) base.product = { name: p.name, model: p.model, category: p.category };
    }
    setD(base);
    setLoading(false);
  };

  const expiry = deriveExpiry(d?.oem_purchase_date || null);
  const st = statusOf(expiry);

  const createAmc = () => {
    const params = new URLSearchParams();
    if (d?.customer_id) params.set("customer", d.customer_id);
    if (d?.product_id) params.set("product", d.product_id);
    if (d?.serial_no) params.set("serial", d.serial_no);
    if (d?.oem_ref_id) params.set("oem_ref", d.oem_ref_id);
    navigate({ to: "/amc/new", search: Object.fromEntries(params) as never });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link to="/amc/oem"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />Back to OEM Data</Button></Link>
          <h1 className="text-2xl font-bold">OEM Product Detail</h1>
          {!loading && d && <Badge variant="outline" className={st.cls}>{st.label}</Badge>}
        </div>
        {!loading && d && (
          <Button onClick={createAmc}><FilePlus2 className="h-4 w-4 mr-1" />Create AMC</Button>
        )}
      </div>

      {loading && <div className="text-muted-foreground text-sm">Loading…</div>}
      {notFound && <div className="text-red-600 text-sm">Record not found.</div>}

      {!loading && d && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">OEM Information</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Brand" value={<NA v={d.oem_brand} />} />
              <Row label="Ref ID" value={<NA v={<span className="font-mono">{d.oem_ref_id}</span>} />} />
              <Row label="Source" value={<Badge variant="secondary">{d.source}</Badge>} />
              <Row label="Reference" value={<NA v={<span className="font-mono text-xs">{d.ref_label}</span>} />} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Product Information</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Product" value={<NA v={d.product?.name || d.product?.model} />} />
              <Row label="Model" value={<NA v={d.product?.model} />} />
              <Row label="Category" value={<NA v={d.product?.category} />} />
              <Row label="Serial Number" value={<NA v={<span className="font-mono">{d.serial_no}</span>} />} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Dates & Warranty Status</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Purchase Date" value={<NA v={fmtDate(d.oem_purchase_date)} />} />
              <Row label="Expiry Date" value={<NA v={fmtDate(expiry)} />} />
              <Row label="Warranty Status" value={<Badge variant="outline" className={st.cls}>{st.label}</Badge>} />
              <Row
                label={st.days !== null && st.days < 0 ? "Days Expired" : "Days Remaining"}
                value={st.days === null ? <NA v={null} /> : <span className={st.days < 0 ? "text-red-700 font-medium" : "text-green-700 font-medium"}>{Math.abs(st.days)} days</span>}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Customer Details</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Name" value={<NA v={d.customer?.name} />} />
              <Row label="Phone" value={<NA v={d.customer?.phone} />} />
              <Row label="Email" value={<NA v={d.customer?.email} />} />
              <Row label="Address" value={<NA v={d.customer?.address} />} />
              <Row label="City / Sector" value={<NA v={[d.customer?.city, d.customer?.sector].filter(Boolean).join(" · ")} />} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}