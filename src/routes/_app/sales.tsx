import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FileText,
  Wallet,
  Truck,
  Settings2,
  Receipt,
  ClipboardList,
} from "lucide-react";

export const Route = createFileRoute("/_app/sales")({
  component: SalesLayout,
  head: () => ({ meta: [{ title: "Sales & Invoicing — Prokon" }] }),
});

const NAV = [
  { to: "/sales", label: "HEAD SALES", icon: LayoutDashboard, exact: true },
  { to: "/sales/orders", label: "Sales Orders", icon: ClipboardList },
  { to: "/sales/invoices", label: "Invoices", icon: Receipt },
  { to: "/sales/payments", label: "Payments", icon: Wallet },
  { to: "/sales/eway", label: "e-Way Bills", icon: Truck },
  { to: "/sales/quotations", label: "Quotations", icon: FileText },
  { to: "/sales/settings", label: "Settings", icon: Settings2 },
];

function SalesLayout() {
  const loc = useLocation();
  const isActive = (to: string, exact?: boolean) =>
    exact ? loc.pathname === to : loc.pathname === to || loc.pathname.startsWith(to + "/");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {NAV.map((n) => {
          const active = isActive(n.to, n.exact);
          return (
            <Link
              key={n.to}
              to={n.to}
              className={
                "inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors " +
                (active
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-foreground/80 hover:bg-muted")
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}