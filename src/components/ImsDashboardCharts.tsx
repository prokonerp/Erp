import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from "recharts";

export type PieDatum = { name: string; value: number; fill: string };
export type DayDatum = { key: string; label: string; in: number; out: number };
export type OemDatum = { name: string; value: number };

export default function ImsDashboardCharts({
  pieData, grnData, days, oemData,
}: {
  pieData: PieDatum[];
  grnData: PieDatum[];
  days: DayDatum[];
  oemData: OemDatum[];
}) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Stock Composition</CardTitle></CardHeader>
        <CardContent style={{ height: 260 }}>
          {pieData.length === 0 ? <div className="text-sm text-muted-foreground">No stock yet.</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Received Stock by Source</CardTitle></CardHeader>
        <CardContent style={{ height: 260 }}>
          {grnData.length === 0 ? <div className="text-sm text-muted-foreground">No GRN receipts yet.</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={grnData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {grnData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">30-Day Stock Movement</CardTitle></CardHeader>
        <CardContent style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={days} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="in" name="Stock In" stroke="hsl(142 76% 36%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="out" name="Stock Out" stroke="hsl(0 72% 51%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Top OEMs by Available Stock</CardTitle></CardHeader>
        <CardContent style={{ height: 260 }}>
          {oemData.length === 0 ? <div className="text-sm text-muted-foreground">No stock yet.</div> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={oemData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" name="Qty" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
