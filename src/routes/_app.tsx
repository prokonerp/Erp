import { createFileRoute, Outlet, Link, Navigate, useNavigate, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileText, ListChecks, LogOut, ShieldCheck, Briefcase, Ticket, Upload, Database, BarChart3 } from "lucide-react";
import { usePermissions } from "@/lib/usePermissions";
import type { ModuleKey } from "@/lib/permissions";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { can, isAdmin, loading: permLoading } = usePermissions();

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/auth" />;

  const allNav: { to: string; label: string; icon: any; module?: ModuleKey; adminOnly?: boolean }[] = [
    { to: "/masters", label: "Masters", icon: Database, module: "customers" },
    { to: "/new", label: "New Gatepass", icon: FileText, module: "gatepass" },
    { to: "/records", label: "Records", icon: ListChecks, module: "gatepass" },
    { to: "/amc", label: "AMC", icon: ShieldCheck, module: "amc" },
    { to: "/crm", label: "Sales CRM", icon: Briefcase, module: "quotations" },
    { to: "/tickets", label: "Tickets", icon: Ticket, module: "tickets" },
    { to: "/reports", label: "Reports", icon: BarChart3, module: "reports" },
    { to: "/import", label: "Import CSV", icon: Upload, adminOnly: true },
  ];
  const navItems = permLoading
    ? allNav
    : allNav.filter((n) => {
        if (n.adminOnly) return isAdmin;
        if (n.module) return can(n.module, "read");
        return true;
      });

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b print:hidden" style={{ backgroundColor: "var(--header)", color: "var(--header-foreground)" }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <Link to="/" className="flex items-center gap-2">
            <img
              src={prokonLogo.url}
              alt="Prokon Hi-Tech Systems — IT and Power Solution Providers"
              className="h-10 w-auto object-contain"
            />
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((n) => {
              const active = location.pathname.startsWith(n.to);
              return (
                <Link key={n.to} to={n.to}>
                  <Button variant={active ? "default" : "ghost"} size="sm">
                    <n.icon className="h-4 w-4 mr-1" />{n.label}
                  </Button>
                </Link>
              );
            })}
            <Button variant="ghost" size="sm" onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/auth" });
            }}>
              <LogOut className="h-4 w-4 mr-1" />Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}