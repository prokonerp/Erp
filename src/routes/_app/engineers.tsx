import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ModuleGate } from "@/components/ModuleGate";
import { useAttentionQueue } from "@/hooks/useEngineerAdmin";
import {
  LayoutDashboard,
  MapPin,
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

/** Admin Field-Ops tabs. All eleven are live routes — every tab is a
 *  keyboard-reachable link; no disabled placeholders remain. The layout is
 *  gated on the engineers module (action "read", matching the sidebar
 *  filter) — RLS stays authoritative, this only controls the shell. */
const TABS: EngTab[] = [
  { to: "/engineers", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/engineers/movement", label: "Movement", icon: MapPin },
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
  const attentionQ = useAttentionQueue();
  const attentionCount = attentionQ.data.length;
  return (
    <ModuleGate module="engineers" action="read" title="Engineers — access restricted">
      <nav aria-label="Engineer sections" className="print:hidden">
        <div className="flex gap-1 mb-4 border-b pb-2 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.exact ? loc.pathname === t.to : loc.pathname.startsWith(t.to);
            const badge = t.to === "/engineers/attention" ? attentionCount : 0;
            return (
              <Link
                key={t.to}
                to={t.to}
                aria-current={active ? "page" : undefined}
                className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Button variant={active ? "default" : "ghost"} size="sm">
                  <t.icon className="h-4 w-4 mr-1" aria-hidden="true" />
                  {t.label}
                  {badge > 0 && (
                    <span className="ml-1 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                      {badge}
                    </span>
                  )}
                </Button>
              </Link>
            );
          })}
        </div>
      </nav>
      <Outlet />
    </ModuleGate>
  );
}
