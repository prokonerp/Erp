import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Target, FileSpreadsheet, Trophy, Settings, Zap, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_app/crm")({
  component: CrmLayout,
  head: () => ({ meta: [{ title: "Sales CRM — Prokon" }] }),
});

function CrmLayout() {
  const loc = useLocation();
  const tabs = [
    { to: "/crm", label: "Dashboard", icon: LayoutDashboard, exact: true },
    { to: "/crm/leads", label: "Leads", icon: Target },
    { to: "/crm/quotations", label: "Quotations", icon: FileSpreadsheet },
    { to: "/crm/incentives", label: "Incentives", icon: Trophy },
    { to: "/crm/bundles", label: "Bundles", icon: Zap },
    { to: "/crm/ai-recommend", label: "AI Recommend", icon: Sparkles },
    { to: "/crm/settings", label: "Settings", icon: Settings },
  ];
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-4 border-b pb-2 print:hidden">
        {tabs.map((t) => {
          const active = t.exact ? loc.pathname === t.to : loc.pathname.startsWith(t.to);
          return (
            <Link key={t.to} to={t.to}>
              <Button variant={active ? "default" : "ghost"} size="sm">
                <t.icon className="h-4 w-4 mr-1" />{t.label}
              </Button>
            </Link>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}