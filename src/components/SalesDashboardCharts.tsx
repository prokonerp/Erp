import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Package } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line, CartesianGrid,
} from "recharts";
import { inr } from "@/lib/sales";

const compactInr = (v: number) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v));

type MonthlyDatum = { month: string; total: number };
type TopCustomerDatum = { name: string; total: number };
type TopProductDatum = { name: string; qty: number; value: number };

export default function SalesDashboardCharts({
  loading, monthlySeries, topCustomers, topProducts,
}: {
  loading: boolean;
  monthlySeries: MonthlyDatum[];
  topCustomers: TopCustomerDatum[];
  topProducts: TopProductDatum[];
}) {
  return (
    <>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Monthly Sales (last 12 months)</CardTitle></CardHeader>
        <CardContent className="h-64">
          {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlySeries} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={compactInr} />
                <Tooltip formatter={(v: number) => inr(v)} />
                <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Top Customers</CardTitle></CardHeader>
          <CardContent className="h-64">
            {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : topCustomers.length === 0 ? <div className="text-sm text-muted-foreground">No data</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCustomers} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={compactInr} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" />Top Products</CardTitle></CardHeader>
          <CardContent className="h-64">
            {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : topProducts.length === 0 ? <div className="text-sm text-muted-foreground">No data</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={compactInr} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
