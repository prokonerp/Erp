import { createFileRoute, Outlet, Link, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ListChecks, Plus, MessageSquare, LayoutDashboard } from "lucide-react";

export const Route = createFileRoute("/_app/tickets")({
  component: TicketsLayout,
  head: () => ({ meta: [{ title: "Tickets — Prokon" }] }),
});

function TicketsLayout() {
  const loc = useLocation();
  const tabs = [
    { to: "/tickets/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/tickets", label: "All Tickets", icon: ListChecks, exact: true },
    { to: "/tickets/new", label: "New Ticket", icon: Plus },
    { to: "/tickets/templates", label: "WhatsApp Templates", icon: MessageSquare },
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