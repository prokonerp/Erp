import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/ims")({
  component: ImsLayout,
  head: () => ({ meta: [{ title: "IMS — Prokon" }] }),
});

const TABS: { to: string; label: string }[] = [
  { to: "/ims", label: "Dashboard" },
  { to: "/ims/stock", label: "Stock Ledger" },
  { to: "/ims/transactions", label: "Transactions" },
  { to: "/ims/transfers", label: "Stock Transfer" },
  { to: "/ims/reservations", label: "Reservations" },
  { to: "/ims/oem-returns", label: "OEM Returns" },
  { to: "/ims/indent-history", label: "Indent History" },
  { to: "/ims/reports", label: "Reports" },
  { to: "/ims/audit", label: "Audit Trail" },
];

function ImsLayout() {
  const loc = useLocation();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">IMS — Inventory Management</h1>
      </div>
      <nav className="flex flex-wrap gap-1 border-b pb-2">
        {TABS.map((t) => {
          const active = t.to === "/ims" ? loc.pathname === "/ims" : loc.pathname.startsWith(t.to);
          return (
            <Link key={t.to} to={t.to}>
              <Button variant={active ? "default" : "ghost"} size="sm">{t.label}</Button>
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}