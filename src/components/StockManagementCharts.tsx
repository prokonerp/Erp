import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";

export type CompositionDatum = { name: string; value: number; color: string };
export type WarehouseChartDatum = { name: string; Available: number; Reserved: number; Issued: number; Defective: number };

export function StockDashboardCharts({
  compositionData, warehouseChart,
}: {
  compositionData: CompositionDatum[];
  warehouseChart: WarehouseChartDatum[];
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <Card className="rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Inventory Composition</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={compositionData}
                dataKey="value"
                nameKey="name"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={2}
              >
                {compositionData.map((c, i) => <Cell key={i} fill={c.color} />)}
              </Pie>
              <RTooltip />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="rounded-xl lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Warehouse Distribution</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={warehouseChart} layout="vertical" margin={{ left: 8, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
              <RTooltip />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Available" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Reserved" stackId="a" fill="#f59e0b" />
              <Bar dataKey="Issued" stackId="a" fill="#8b5cf6" />
              <Bar dataKey="Defective" stackId="a" fill="#f43f5e" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

export type WhConditionDatum = { name: string; Good: number; Defective: number; Scrap: number };

export function ProductDetailCharts({
  conditionData, whChart, pct,
}: {
  conditionData: CompositionDatum[];
  whChart: WhConditionDatum[];
  pct: (n: number) => number;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <Card className="rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Condition Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          {conditionData.length === 0 ? (
            <div className="h-full grid place-items-center text-xs text-muted-foreground">No inventory</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={conditionData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={78} paddingAngle={2}>
                  {conditionData.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
                <RTooltip formatter={(v: number, n: string) => [`${v} units (${pct(v)}%)`, n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-xl lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Warehouse Distribution (by condition)</CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          {whChart.length === 0 ? (
            <div className="h-full grid place-items-center text-xs text-muted-foreground">No inventory</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={whChart} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <RTooltip />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Good" stackId="c" fill="#10b981" />
                <Bar dataKey="Defective" stackId="c" fill="#f43f5e" />
                <Bar dataKey="Scrap" stackId="c" fill="#64748b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
