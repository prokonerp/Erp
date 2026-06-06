import { createFileRoute, Outlet, Link, Navigate, useNavigate, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileText, Package, ListChecks, LogOut, Building2, ShieldCheck, Briefcase, Ticket, Upload, Database } from "lucide-react";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/auth" />;

  const navItems = [
    { to: "/masters", label: "Masters", icon: Database },
    { to: "/new", label: "New Gatepass", icon: FileText },
    { to: "/records", label: "Records", icon: ListChecks },
    { to: "/products", label: "Products", icon: Package },
    { to: "/amc", label: "AMC", icon: ShieldCheck },
    { to: "/crm", label: "Sales CRM", icon: Briefcase },
    { to: "/tickets", label: "Tickets", icon: Ticket },
    { to: "/import", label: "Import CSV", icon: Upload },
  ];

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="bg-background border-b print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <div>
              <div className="font-semibold leading-tight">Prokon Hi-Tech Systems</div>
              <div className="text-xs text-muted-foreground leading-tight">Gatepass · Picasso Centre, Sec-61 Gurgaon</div>
            </div>
          </div>
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