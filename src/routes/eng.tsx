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
        if (p?.must_change_password) setForceChange(true);
      } catch (err: unknown) {
        const code =
          typeof err === "object" && err !== null
            ? (err as Record<string, unknown>).code
            : undefined;
        if (code === PASSWORD_CHANGE_REQUIRED) setForceChange(true);
      }
    })();
  }, [session, session?.user?.id, fetchProfile]);

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
      <header className="sticky top-0 z-30 h-14 shrink-0 border-b bg-white/95 backdrop-blur flex items-center gap-2.5 px-4">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
          aria-hidden="true"
        >
          P
        </span>
        <h1 className="text-sm font-semibold text-foreground">Engineer Portal</h1>
        <button
          onClick={handleLogout}
          aria-label="Log out"
          title="Log out"
          className="ml-auto grid min-h-[44px] min-w-[44px] place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <Outlet />
      </main>

      <nav className="sticky bottom-0 border-t bg-background flex items-center justify-around min-h-14 shrink-0 pb-safe print:hidden">
        {TABS.map((tab) => {
          const active = isActive(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-xs font-medium px-4 py-1.5 rounded-md transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="h-5 w-5" fill={active ? "currentColor" : "none"} />
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
