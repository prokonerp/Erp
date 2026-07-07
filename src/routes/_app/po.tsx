import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { FileText, Plus, Settings } from "lucide-react";

export const Route = createFileRoute("/_app/po")({
  component: POLayout,
});

function POLayout() {
  const loc = useLocation();
  const tabs: { to: string; label: string; icon: any; exact?: boolean }[] = [
    { to: "/po", label: "All POs", icon: FileText, exact: true },
    { to: "/po/new", label: "New PO", icon: Plus },
    { to: "/po/settings", label: "Settings", icon: Settings },
  ];
  const active = (to: string, exact?: boolean) =>
    exact ? loc.pathname === to : loc.pathname === to || loc.pathname.startsWith(to + "/");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b pb-2">
        <h1 className="text-xl font-bold mr-4">Purchase Orders</h1>
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <Button key={t.to} asChild variant={active(t.to, t.exact) ? "default" : "ghost"} size="sm">
              <Link to={t.to}><t.icon className="h-4 w-4 mr-1" />{t.label}</Link>
            </Button>
          ))}
        </div>
      </div>
      <Outlet />
    </div>
  );
}