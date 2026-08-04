import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Pencil, MapPin, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { type Customer } from "@/lib/crm";
import { CustomerFormDialog } from "@/components/CustomerForm";
import { fetchCustomerSites, warrantyBadgeClass, warrantyLabel, warrantyState, type CustomerSite } from "@/lib/customerSites";
import { fmtDate } from "@/lib/amc";

export const Route = createFileRoute("/_app/customers/$id")({
  component: CustomerDetailPage,
  head: () => ({
    meta: [
      { title: "Customer Record — Prokon ERP" },
      { name: "description", content: "Customer profile with sites, installed equipment, warranty status and AMC coverage." },
      { property: "og:title", content: "Customer Record — Prokon ERP" },
      { property: "og:description", content: "Customer profile with sites, installed equipment and warranty status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type SerialRow = {
  id: string; serial_number: string; product_id: string; site_id: string | null;
  installation_date: string | null; warranty_start_date: string | null; warranty_end_date: string | null;
  status: string;
};
type ProductLite = { id: string; name: string; model: string | null };
type TicketLite = { id: string; case_id: string | null; title: string | null; status: string | null; created_at: string };

function CustomerDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [serials, setSerials] = useState<SerialRow[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [amcSerials, setAmcSerials] = useState<Set<string>>(new Set());
  const [openSerial, setOpenSerial] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Record<string, TicketLite[]>>({});
  const [editOpen, setEditOpen] = useState(false);

  const load = async () => {
    const [{ data: c }, { data: ser }, { data: prod }, { data: amcs }] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).maybeSingle(),
      supabase.from("serials").select("id,serial_number,product_id,site_id,installation_date,warranty_start_date,warranty_end_date,status").eq("customer_id", id).order("serial_number"),
      supabase.from("products").select("id,name,model"),
      supabase.from("amcs").select("units,end_date,is_deleted"),
    ]);
    setCustomer((c as any) || null);
    setSerials((ser || []) as any);
    setProducts((prod || []) as any);
    const today = new Date().toISOString().slice(0, 10);
    const set = new Set<string>();
    for (const a of (amcs || []) as any[]) {
      if (a.is_deleted) continue;
      if (!a.end_date || a.end_date < today) continue;
      for (const u of (Array.isArray(a.units) ? a.units : [])) {
        if (u?.serial_no) set.add(String(u.serial_no).toUpperCase());
      }
    }
    setAmcSerials(set);
    try { setSites(await fetchCustomerSites(id)); } catch { /* permission */ }
  };
  useEffect(() => { load(); }, [id]);

  const groups = useMemo(() => {
    const bySite = new Map<string, SerialRow[]>();
    for (const s of serials) {
      const key = s.site_id || "__none";
      bySite.set(key, [...(bySite.get(key) || []), s]);
    }
    const out = sites
      .filter((s) => bySite.has(s.id))
      .map((s) => ({ id: s.id, name: s.site_name, address: s.address, rows: bySite.get(s.id)! }));
    if (bySite.has("__none")) out.push({ id: "__none", name: "General / Unspecified", address: null, rows: bySite.get("__none")! });
    return out;
  }, [serials, sites]);

  async function toggleSerial(sn: string) {
    if (openSerial === sn) { setOpenSerial(null); return; }
    setOpenSerial(sn);
    if (!tickets[sn]) {
      const { data, error } = await supabase.from("tickets")
        .select("id,case_id,title,status,created_at").eq("serial_no", sn).order("created_at", { ascending: false });
      if (error) return toast.error(error.message);
      setTickets((t) => ({ ...t, [sn]: (data || []) as any }));
    }
  }

  const productLabel = (pid: string) => {
    const p = products.find((x) => x.id === pid);
    return p ? (p.model ? `${p.name} · ${p.model}` : p.name) : "—";
  };

  if (!customer) {
    return <div className="p-8 text-sm text-muted-foreground">Loading customer…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/masters/customers" })}>
            <ArrowLeft className="h-4 w-4 mr-1" />Customer Master
          </Button>
          <h1 className="text-2xl font-semibold mt-1">{customer.company}</h1>
          <p className="text-sm text-muted-foreground">
            {[customer.contact_name, customer.phone, customer.email].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4 mr-1" />Edit</Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="equipment">Installed Equipment ({serials.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
              <Field label="Type" value={(customer as any).customer_type} />
              <Field label="GSTIN" value={customer.gst} />
              <Field label="State" value={customer.state} />
              <Field label="City" value={(customer as any).city} />
              <Field label="Billing address" value={customer.billing_address || customer.address} />
              <Field label="Shipping address" value={customer.shipping_address} />
              <Field label="Sites" value={sites.length ? sites.map((s) => s.site_name).join(", ") : "—"} />
              <Field label="Remarks" value={customer.remarks} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="equipment" className="mt-4 space-y-4">
          {groups.length === 0 && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              No equipment recorded against this customer yet. Serials are assigned from Masters → Products → Serials.
            </CardContent></Card>
          )}
          {groups.map((g) => (
            <Card key={g.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  {g.name}
                  <span className="text-xs font-normal text-muted-foreground">({g.rows.length})</span>
                </CardTitle>
                {g.address && <p className="text-xs text-muted-foreground">{g.address}</p>}
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Product / Model</TableHead>
                    <TableHead>Serial #</TableHead>
                    <TableHead>Installed</TableHead>
                    <TableHead>Warranty</TableHead>
                    <TableHead>AMC</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {g.rows.map((r) => {
                      const w = warrantyState(r.warranty_end_date);
                      const underAmc = amcSerials.has(r.serial_number.toUpperCase());
                      const isOpen = openSerial === r.serial_number;
                      return (
                        <Fragment key={r.id}>
                          <TableRow>
                            <TableCell className="text-sm">{productLabel(r.product_id)}</TableCell>
                            <TableCell>
                              <button type="button" onClick={() => toggleSerial(r.serial_number)}
                                className="font-mono text-xs inline-flex items-center gap-1 underline underline-offset-2 hover:text-primary">
                                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                {r.serial_number}
                              </button>
                            </TableCell>
                            <TableCell className="text-xs">{fmtDate(r.installation_date) || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={warrantyBadgeClass(w)}>
                                {warrantyLabel(w)}{r.warranty_end_date ? ` · ${fmtDate(r.warranty_end_date)}` : ""}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {underAmc
                                ? <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">Under AMC</Badge>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-muted/30">
                              <TableCell colSpan={5}>
                                <TicketList rows={tickets[r.serial_number]} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <CustomerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={customer}
        onSaved={() => { load(); }}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div>{value || "—"}</div>
    </div>
  );
}

function TicketList({ rows }: { rows?: TicketLite[] }) {
  if (!rows) return <div className="text-xs text-muted-foreground py-2">Loading tickets…</div>;
  if (!rows.length) return <div className="text-xs text-muted-foreground py-2">No tickets logged against this serial.</div>;
  return (
    <div className="space-y-1 py-1">
      <div className="text-xs font-medium">Tickets ({rows.length})</div>
      {rows.map((t) => (
        <Link key={t.id} to="/tickets/$id" params={{ id: t.id }}
          className="flex items-center gap-3 text-xs hover:text-primary">
          <span className="font-mono">{t.case_id || t.id.slice(0, 8)}</span>
          <span className="flex-1 truncate">{t.title || "—"}</span>
          <span className="text-muted-foreground">{t.status}</span>
          <span className="text-muted-foreground">{fmtDate(t.created_at)}</span>
        </Link>
      ))}
    </div>
  );
}
