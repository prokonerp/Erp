import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  Ticket,
  Truck,
  FileText,
  IndianRupee,
  Wallet,
  Package,
  Bell,
  ReceiptIndianRupee,
  type LucideIcon,
} from "lucide-react";

export const Route = createFileRoute("/_app/engineers")({
  component: EngineersLayout,
  head: () => ({ meta: [{ title: "Engineers — Prokon" }] }),
});

type EngTab = { to: string; label: string; icon: LucideIcon; exact?: boolean };

/** Admin Field-Ops tabs. All ten are live routes — every tab is a
 *  keyboard-reachable link; no disabled placeholders remain. */
const TABS: EngTab[] = [
  { to: "/engineers", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/engineers/directory", label: "Directory", icon: Users },
  { to: "/engineers/tickets", label: "Tickets", icon: Ticket },
  { to: "/engineers/conveyance", label: "Conveyance", icon: Truck },
  { to: "/engineers/documents", label: "Documents", icon: FileText },
  { to: "/engineers/rates", label: "Rates", icon: IndianRupee },
  { to: "/engineers/expenses", label: "Payable & Expenses", icon: Wallet },
  { to: "/engineers/reconcile", label: "Reconcile", icon: ReceiptIndianRupee },
  { to: "/engineers/custody", label: "Custody", icon: Package },
  { to: "/engineers/attention", label: "Needs Attention", icon: Bell },
];

function EngineersLayout() {
  const loc = useLocation();
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-4 border-b pb-2 print:hidden">
        {TABS.map((t) => {
          const active = t.exact ? loc.pathname === t.to : loc.pathname.startsWith(t.to);
          return (
            <Link key={t.to} to={t.to} aria-current={active ? "page" : undefined}>
              <Button variant={active ? "default" : "ghost"} size="sm">
                <t.icon className="h-4 w-4 mr-1" aria-hidden="true" />{t.label}
              </Button>
            </Link>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}
