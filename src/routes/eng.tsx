import { useEffect, useState } from "react";
import {
  createFileRoute,
  Outlet,
  Link,
  useLocation,
  Navigate,
  useNavigate,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/useAuth";
import { useIsEngineer } from "@/lib/useIsEngineer";
import { supabase } from "@/integrations/supabase/client";
import { recordLogout } from "@/lib/useActivityTracker";
import { PageLoader } from "@/components/shared/skeletons";
import { Ticket, User, LogOut } from "lucide-react";
import { getMyProfile } from "@/lib/admin-users.functions";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { PASSWORD_CHANGE_REQUIRED } from "@/lib/account-gate";

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
  const navigate = useNavigate();
  const [forceChange, setForceChange] = useState(false);
  const fetchProfile = useServerFn(getMyProfile);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const p = await fetchProfile();
        if ((p as any)?.must_change_password) setForceChange(true);
      } catch (err: any) {
        if (err?.code === PASSWORD_CHANGE_REQUIRED) setForceChange(true);
      }
    })();
  }, [session?.user?.id]);

  // Allow child routes to trigger the forced password-change dialog
  useEffect(() => {
    const handler = () => setForceChange(true);
    window.addEventListener("eng:password-change-required", handler);
    return () => window.removeEventListener("eng:password-change-required", handler);
  }, []);

  if (authLoading || roleLoading) {
    return <PageLoader label="Loading engineer portal…" />;
  }

  if (!session) return <Navigate to="/auth" replace />;

  const handleLogout = async () => {
    await recordLogout();
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

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
        <button
          onClick={handleLogout}
          aria-label="Log out"
          title="Log out"
          className="ml-auto p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <LogOut className="h-5 w-5" />
        </button>
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
              aria-current={active ? "page" : undefined}
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

      <ChangePasswordDialog
        open={forceChange}
        onOpenChange={setForceChange}
        forced
        onChanged={() => {
          setForceChange(false);
          window.location.reload();
        }}
      />
    </div>
  );
}
