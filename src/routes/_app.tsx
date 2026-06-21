import { useEffect, useState } from "react";
import { createFileRoute, Outlet, Link, Navigate, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { ChevronDown, FileText, ListChecks, ShieldCheck, Briefcase, Ticket, Upload, Database, BarChart3, ClipboardList, Warehouse } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/lib/usePermissions";
import type { ModuleKey } from "@/lib/permissions";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { getMyProfile } from "@/lib/admin-users.functions";
import { UserProfileMenu, type ProfileInfo } from "@/components/UserProfileMenu";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const { can, isAdmin, loading: permLoading } = usePermissions();
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [forceChange, setForceChange] = useState(false);
  const fetchProfile = useServerFn(getMyProfile);

  async function loadProfile() {
    try {
      const p = await fetchProfile();
      setProfile(p as any);
      if (p.expired) {
        setForceChange(true);
      } else if (p.days_remaining === 7 || p.days_remaining === 3 || p.days_remaining === 1) {
        const key = `pw-warn-${p.days_remaining}-${p.password_changed_at}`;
        if (typeof window !== "undefined" && !sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          const msg =
            p.days_remaining === 1
              ? "Your password expires tomorrow."
              : `Your password will expire in ${p.days_remaining} days.`;
          toast.warning(msg);
        }
      }
    } catch {
      // ignore — profile is optional for layout rendering
    }
  }

  useEffect(() => {
    if (session) loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!session) return <Navigate to="/auth" />;

  const allNav: { to: string; label: string; icon: any; module?: ModuleKey; adminOnly?: boolean }[] = [
    { to: "/masters", label: "Masters", icon: Database, module: "customers" },
    { to: "/new", label: "Gate Passes", icon: FileText, module: "gatepass" },
    { to: "/amc", label: "AMC", icon: ShieldCheck, module: "amc" },
    { to: "/crm", label: "Sales CRM", icon: Briefcase, module: "quotations" },
    { to: "/tickets", label: "Tickets", icon: Ticket, module: "tickets" },
    { to: "/indent", label: "Indent", icon: ClipboardList, module: "indent" },
    { to: "/ims", label: "IMS", icon: Warehouse, module: "ims" },
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
      <header
        className="border-b print:hidden sticky top-0 z-40"
        style={{ backgroundColor: "var(--header)", color: "var(--header-foreground)" }}
      >
        {/* Row 1: Logo */}
        <div className="bg-background text-foreground">
          <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-end">
            <Link to="/" className="leading-none">
              <img
                src={prokonLogo.url}
                alt="Prokon Hi-Tech Systems — IT and Power Solution Providers"
                className="h-10 w-auto object-contain"
              />
            </Link>
          </div>
        </div>
        {/* Row 2: Navigation ribbon */}
        <div style={{ backgroundColor: "var(--header)", color: "var(--header-foreground)" }}>
          <div className="max-w-7xl mx-auto px-4 flex items-center gap-4">
            <nav
              className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto whitespace-nowrap py-1"
              aria-label="Primary"
            >
              {navItems.map((n) => {
                if (n.to === "/new") {
                  const isActive = location.pathname === "/new" || location.pathname === "/records";
                  return (
                    <DropdownMenu key="gatepasses">
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant={isActive ? "default" : "ghost"}
                          size="sm"
                          className={
                            isActive
                              ? "shrink-0"
                              : "shrink-0 text-white/85 hover:bg-white/10 hover:text-white"
                          }
                        >
                          <FileText className="h-4 w-4 mr-1" />
                          Gate Passes
                          <ChevronDown className="h-3 w-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48">
                        <DropdownMenuItem asChild>
                          <Link
                            to="/new"
                            className={`cursor-pointer flex items-center gap-2 ${location.pathname === "/new" ? "bg-accent text-accent-foreground" : ""}`}
                          >
                            <FileText className="h-4 w-4" />
                            New Gate Pass
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link
                            to="/records"
                            className={`cursor-pointer flex items-center gap-2 ${location.pathname === "/records" ? "bg-accent text-accent-foreground" : ""}`}
                          >
                            <ListChecks className="h-4 w-4" />
                            History
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                }
                const active = location.pathname.startsWith(n.to);
                return (
                  <Link key={n.to} to={n.to} className="shrink-0">
                    <Button
                      variant={active ? "default" : "ghost"}
                      size="sm"
                      className={
                        active
                          ? "shrink-0"
                          : "shrink-0 text-white/85 hover:bg-white/10 hover:text-white"
                      }
                    >
                      <n.icon className="h-4 w-4 mr-1" />
                      {n.label}
                    </Button>
                  </Link>
                );
              })}
            </nav>
            <UserProfileMenu profile={profile} onProfileChange={loadProfile} />
          </div>
        </div>
      </header>
      <main className="max-w-[93.6rem] mx-auto p-4 md:p-6">
        <Outlet />
      </main>
      <ChangePasswordDialog
        open={forceChange}
        onOpenChange={setForceChange}
        forced
        onChanged={() => {
          setForceChange(false);
          loadProfile();
        }}
      />
    </div>
  );
}