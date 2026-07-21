import { Badge } from "@/components/ui/badge";
import type { StockStatus, StockType } from "@/lib/ims";
import { STOCK_STATUS_LABEL } from "@/lib/ims";

const CLASS: Record<StockStatus, string> = {
  available: "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100",
  reserved: "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100",
  issued: "bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-100",
  in_transit: "bg-cyan-100 text-cyan-800 border-cyan-300 hover:bg-cyan-100",
  returned_to_oem: "bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-100",
  scrapped: "bg-neutral-200 text-neutral-700 border-neutral-300 hover:bg-neutral-200",
};

export function StockStatusBadge({ status, type }: { status: StockStatus; type?: StockType }) {
  const cls = type === "defective" && (status === "available" || status === "reserved")
    ? "bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100"
    : CLASS[status] || "";
  const label = type === "defective" && status === "available" ? "Defective" : STOCK_STATUS_LABEL[status];
  return <Badge variant="outline" className={cls}>{label}</Badge>;
}