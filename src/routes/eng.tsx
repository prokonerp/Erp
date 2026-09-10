import { createFileRoute, Outlet, Link, useLocation, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/useAuth";
import { useIsEngineer } from "@/lib/useIsEngineer";
import { PageLoader } from "@/components/shared/skeletons";
import { Ticket, User } from "lucide-react";

export const Route = createFileRoute("/eng")({
  component: EngLayout,
});

const TABS = [
  { to: "/eng/queue", label: "Queue", icon: Ticket },
  { to: "/eng/profile", label: "Profile", icon: User },
] as const;

function EngLayout() {
  const { session, loading: authLoading } = useAuth();
  const { isEngineer, loading: roleLoading } = useIsEngineer();
  const location = useLocation();

  if (authLoading || roleLoading) {
    return <PageLoader label="Loading engineer portal…" />;
  }

  if (!session) return <Navigate to="/auth" />;

  if (!isEngineer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-semibold text-foreground">Access Restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This portal is for field engineers only. Please contact your administrator if you
            believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="h-14 shrink-0 border-b flex items-center px-4 bg-background shadow-sm">
        <h1 className="text-[15px] font-semibold text-foreground">Engineer Portal</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <Outlet />
      </main>

      <nav className="sticky bottom-0 border-t bg-background flex items-center justify-around h-14 shrink-0 print:hidden">
        {TABS.map((tab) => {
          const active = isActive(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={`flex flex-col items-center gap-0.5 text-[11px] px-4 py-1.5 rounded-md transition-colors ${
                active ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-5 w-5" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
