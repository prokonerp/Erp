import { useEffect, useState } from "react";
import { createFileRoute, Outlet, Link, Navigate, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  ListChecks,
  ShieldCheck,
  Briefcase,
  Ticket,
  Upload,
  Database,
  BarChart3,
  ClipboardList,
  Warehouse,
  Truck,
  PackageCheck,
  Send,
  LayoutDashboard,
  Menu,
} from "lucide-react";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mmOpen, setMmOpen] = useState(false);
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

  const allNav: {
    to: string;
    label: string;
    icon: any;
    module?: ModuleKey;
    adminOnly?: boolean;
    group?: string;
  }[] = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/masters", label: "Masters", icon: Database, module: "customers" },
    { to: "/tickets", label: "Service Desk (Tickets)", icon: Ticket, module: "tickets", group: "Service Desk" },
    { to: "/amc", label: "Contracts (AMC)", icon: ShieldCheck, module: "amc", group: "Service Desk" },
    { to: "/crm", label: "Customers (Sales & CRM)", icon: Briefcase, module: "quotations", group: "Customers" },
    { to: "/indent", label: "Purchase Requests (Indent)", icon: ClipboardList, module: "indent", group: "Procurement" },
    { to: "/ims", label: "Inventory (IMS)", icon: Warehouse, module: "ims", group: "Inventory" },
    { to: "/reports", label: "Reports", icon: BarChart3, module: "reports", group: "Intelligence" },
    { to: "/import", label: "Data Import (CSV Import)", icon: Upload, adminOnly: true, group: "System" },
  ];

  const navItems = permLoading
    ? allNav
    : allNav.filter((n) => {
        if (n.adminOnly) return isAdmin;
        if (n.module) return can(n.module, "read");
        return true;
      });

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");
  const navLinkCls = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
      active ? "bg-accent text-accent-foreground font-medium" : "text-foreground/80 hover:bg-muted hover:text-foreground"
    }`;

  const mmPaths = ["/new", "/records", "/challan", "/grn"];
  const isMaterialMovementActive =
    mmPaths.some((p) => location.pathname === p || location.pathname.startsWith(p + "/")) ||
    location.pathname.startsWith("/challan") ||
    location.pathname.startsWith("/grn");

  const groupOrder = ["Service Desk", "Customers", "Procurement", "Inventory", "Intelligence", "System"];

  const groupMap = new Map<string, typeof navItems>();
  const ungrouped: typeof navItems = [];
  for (const n of navItems) {
    if (n.group) {
      if (!groupMap.has(n.group)) groupMap.set(n.group, []);
      groupMap.get(n.group)!.push(n);
    } else {
      ungrouped.push(n);
    }
  }

  const showMm = permLoading || can("gatepass", "read");

  return (
    <div className="min-h-screen bg-muted/20 flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-60 bg-background border-r flex flex-col shrink-0 transform transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="h-14 border-b flex items-center justify-center px-4">
          <Link to="/dashboard" className="leading-none">
            <img
              src={prokonLogo.url}
              alt="Prokon Hi-Tech Systems"
              className="h-9 w-auto object-contain"
            />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-5" aria-label="Primary">
          {/* Ungrouped items */}
          {ungrouped.length > 0 && (
            <div className="space-y-0.5">
              {ungrouped.map((n) => (
                <Link key={n.to} to={n.to} className={navLinkCls(isActive(n.to))}>
                  <n.icon className="h-4 w-4 shrink-0" />
                  {n.label}
                </Link>
              ))}
            </div>
          )}

          {/* Grouped items */}
          {groupOrder.map((g) => {
            const items = groupMap.get(g);
            if (!items || items.length === 0) return null;
            return (
              <div key={g}>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1.5">
                  {g}
                </h3>
                <div className="space-y-0.5">
                  {items.map((n) => (
                    <Link key={n.to} to={n.to} className={navLinkCls(isActive(n.to))}>
                      <n.icon className="h-4 w-4 shrink-0" />
                      {n.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Material Movement expandable group */}
          {showMm && (
            <div>
              <button
                type="button"
                onClick={() => setMmOpen((v) => !v)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  isMaterialMovementActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground"
                }`}
              >
                <Truck className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">Material Movement</span>
                {mmOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
              </button>
              {mmOpen && (
                <div className="ml-5 mt-0.5 space-y-0.5 border-l pl-2">
                  <Link to="/new" className={navLinkCls(isActive("/new"))}>
                    <FileText className="h-4 w-4 shrink-0" />
                    New Gate Pass
                  </Link>
                  <Link to="/records" className={navLinkCls(isActive("/records"))}>
                    <ListChecks className="h-4 w-4 shrink-0" />
                    History
                  </Link>
                  <Link to="/challan" className={navLinkCls(isActive("/challan"))}>
                    <Send className="h-4 w-4 shrink-0" />
                    All Delivery Challans
                  </Link>
                  <Link to="/challan/customer/new" className={navLinkCls(isActive("/challan/customer/new"))}>
                    <Send className="h-4 w-4 shrink-0" />
                    New: To Customer
                  </Link>
                  <Link to="/challan/oem/new" className={navLinkCls(isActive("/challan/oem/new"))}>
                    <Send className="h-4 w-4 shrink-0" />
                    New: To OEM
                  </Link>
                  <Link to="/grn" className={navLinkCls(isActive("/grn"))}>
                    <PackageCheck className="h-4 w-4 shrink-0" />
                    All GRNs
                  </Link>
                  <Link to="/grn/customer/new" className={navLinkCls(isActive("/grn/customer/new"))}>
                    <PackageCheck className="h-4 w-4 shrink-0" />
                    New: From Customer
                  </Link>
                  <Link to="/grn/oem/new" className={navLinkCls(isActive("/grn/oem/new"))}>
                    <PackageCheck className="h-4 w-4 shrink-0" />
                    New: From OEM
                  </Link>
                  <Link to="/grn/general/new" className={navLinkCls(isActive("/grn/general/new"))}>
                    <PackageCheck className="h-4 w-4 shrink-0" />
                    New: General
                  </Link>
                </div>
              )}
            </div>
          )}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          className="h-14 border-b flex items-center justify-between px-4 sticky top-0 z-30 bg-background/95 backdrop-blur print:hidden"
        >
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <UserProfileMenu profile={profile} onProfileChange={loadProfile} />
        </header>

        {/* Content */}
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>

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