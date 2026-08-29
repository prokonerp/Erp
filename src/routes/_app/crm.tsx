import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Target,
  FileSpreadsheet,
  Trophy,
  Settings,
  Zap,
  Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/crm")({
  component: CrmLayout,
  head: () => ({ meta: [{ title: "Sales CRM — Prokon" }] }),
});

const tabs = [
  { to: "/crm", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/crm/leads", label: "Leads", icon: Target },
  { to: "/crm/quotations", label: "Quotations", icon: FileSpreadsheet },
  { to: "/crm/incentives", label: "Incentives", icon: Trophy },
  { to: "/crm/bundles", label: "Bundles", icon: Zap },
  { to: "/crm/ai-recommend", label: "UPS Backup Calculator", icon: Calculator },
  { to: "/crm/settings", label: "Settings", icon: Settings },
];

function CrmLayout() {
  const loc = useLocation();
  return (
    <div>
      <div className="border-b border-border bg-background -mx-4 md:-mx-6 px-4 md:px-6 mb-5 print:hidden sticky top-0 z-20">
        <nav className="flex gap-1 overflow-x-auto" aria-label="CRM sections">
          {tabs.map((t) => {
            const active = t.exact ? loc.pathname === t.to : loc.pathname.startsWith(t.to);
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 px-3 py-3 -mb-px text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
