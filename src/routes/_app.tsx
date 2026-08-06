import { useEffect, useState } from "react";
import { createFileRoute, Outlet, Link, Navigate, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  ListChecks,
  ShieldCheck,
  Briefcase,
  Ticket,
  Upload,
  Database,
  BarChart3,
  ClipboardList,
  Warehouse,
  PackageCheck,
  Users,
  Package,
  Send,
  LayoutDashboard,
  Menu,
  Store,
  UserCog,
  Wallet,
  Boxes,
  Truck,
  IdCard,
  Receipt,
  Archive as ArchiveIcon,
  Plus,
  Tag,
} from "lucide-react";
import { usePermissions } from "@/lib/usePermissions";
import type { ModuleKey } from "@/lib/permissions";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { getMyProfile } from "@/lib/admin-users.functions";
import { UserProfileMenu, type ProfileInfo } from "@/components/UserProfileMenu";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { IdleTimeout } from "@/components/IdleTimeout";
import { ClaimAdminBanner } from "@/components/AdminAccessNotices";
import { useActivityTracker } from "@/lib/useActivityTracker";
import { toast } from "sonner";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { session, loading } = useAuth();
  useActivityTracker(!!session);
  const location = useLocation();
  const { can, isAdmin, loading: permLoading } = usePermissions();
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [forceChange, setForceChange] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    Masters: false,
    "Service Desk": false,
    Customers: false,
    Procurement: false,
    "Material Movement": false,
    Inventory: false,
    Sales: false,
    Intelligence: false,
    System: false,
  });
  const [challanOpen, setChallanOpen] = useState(false);
  const [grnOpen, setGrnOpen] = useState(false);
  const [gatepassOpen, setGatepassOpen] = useState(false);
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
    search?: Record<string, string>;
    module?: ModuleKey;
    adminOnly?: boolean;
    group?: string;
    matchSearchTab?: string;
  }[] = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/masters", label: "Company", icon: Building2, module: "customers", group: "Masters", search: { tab: "company" }, matchSearchTab: "company" },
    { to: "/masters", label: "Branches", icon: Store, module: "customers", group: "Masters", search: { tab: "branches" }, matchSearchTab: "branches" },
    { to: "/masters", label: "Warehouses", icon: Warehouse, module: "customers", group: "Masters", search: { tab: "warehouses" }, matchSearchTab: "warehouses" },
    { to: "/masters/customers", label: "Customers", icon: Users, module: "customers", group: "Masters" },
    { to: "/masters", label: "Vendors", icon: Truck, module: "customers", group: "Masters", search: { tab: "vendors" }, matchSearchTab: "vendors" },
    { to: "/masters/products", label: "Products", icon: Package, module: "customers", group: "Masters" },
    { to: "/masters", label: "Employees", icon: IdCard, module: "customers", group: "Masters", search: { tab: "employees" }, matchSearchTab: "employees" },
    { to: "/payroll", label: "Salary & Attendance", icon: Wallet, module: "customers", group: "Masters" },
    { to: "/masters", label: "Inventory", icon: Boxes, module: "customers", group: "Masters", search: { tab: "inventory" }, matchSearchTab: "inventory" },
    { to: "/masters", label: "Accounts", icon: Wallet, module: "customers", group: "Masters", search: { tab: "accounts" }, matchSearchTab: "accounts" },
    { to: "/masters", label: "Users & Roles", icon: UserCog, module: "customers", group: "Masters", search: { tab: "users" }, matchSearchTab: "users" },
    { to: "/tickets", label: "Service Desk (Tickets)", icon: Ticket, module: "tickets", group: "Service Desk" },
    { to: "/amc", label: "Contracts (AMC)", icon: ShieldCheck, module: "amc", group: "Service Desk" },
    { to: "/crm", label: "Customers (Sales & CRM)", icon: Briefcase, module: "quotations", group: "Customers" },
    { to: "/sales", label: "Head Sales", icon: Receipt, module: "sales", group: "Sales" },
    { to: "/sales/quotations", label: "Quotations", icon: FileSpreadsheet, module: "quotations", group: "Sales" },
    { to: "/sales/invoices", label: "Invoices", icon: FileText, module: "sales", group: "Sales" },
    { to: "/sales/payments", label: "Payments", icon: Wallet, module: "sales", group: "Sales" },
    { to: "/sales/eway", label: "e-Way Bills", icon: Truck, module: "sales", group: "Sales" },
    { to: "/sales/settings", label: "Sales Settings", icon: UserCog, module: "sales", group: "Sales", adminOnly: true },
    { to: "/indent", label: "Purchase Requests (Indent)", icon: ClipboardList, module: "indent", group: "Procurement" },
    { to: "/po", label: "Purchase Orders", icon: FileText, module: "po", group: "Procurement" },
    { to: "/ims", label: "Inventory (IMS)", icon: Warehouse, module: "ims", group: "Inventory" },
    { to: "/ims/defective-tags", label: "Defective Tags", icon: Tag, module: "ims", group: "Inventory" },
    { to: "/reports", label: "Reports", icon: BarChart3, module: "reports", group: "Intelligence" },
    { to: "/import", label: "Data Import (CSV Import)", icon: Upload, adminOnly: true, group: "System" },
    { to: "/archive", label: "Archive (Deleted Records)", icon: ArchiveIcon, adminOnly: true, group: "System" },
  ];

  const navItems = permLoading
    ? allNav
    : allNav.filter((n) => {
        if (n.adminOnly) return isAdmin;
        if (n.module) return can(n.module, "read");
        return true;
      });

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");
  const currentSearchTab = (() => {
    if (typeof window === "undefined") return undefined;
    const sp = new URLSearchParams(window.location.search);
    return sp.get("tab") ?? undefined;
  })();
  const isMasterTabActive = (path: string, tab?: string) => {
    if (path !== "/masters") return isActive(path);
    if (location.pathname !== "/masters") return false;
    if (!tab) return !currentSearchTab || currentSearchTab === "company";
    return currentSearchTab === tab;
  };
  const navLinkCls = (active: boolean) =>
    `relative flex items-center gap-2.5 pl-4 pr-3 py-1.5 rounded-md text-[13px] transition-colors ${
      active
        ? "bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
        : "text-foreground/75 hover:bg-muted hover:text-foreground"
    }`;

  const groupOrder = ["Masters", "Service Desk", "Customers", "Sales", "Procurement", "Material Movement", "Inventory", "Intelligence", "System"];

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

  // Derive current page title from active nav item for the header
  const currentNav = navItems.find((n) => {
    if (n.to === "/masters" && location.pathname === "/masters") {
      return isMasterTabActive(n.to, n.matchSearchTab);
    }
    return location.pathname === n.to || location.pathname.startsWith(n.to + "/");
  });
  let pageTitle = currentNav?.label ?? "Dashboard";
  let pageGroup = currentNav?.group;
  if (isActive("/gatepass")) {
    pageGroup = "Gate Passes";
    if (location.pathname === "/gatepass/new" || location.pathname === "/new") {
      pageTitle = "Create New Gate Pass";
    } else if (location.pathname === "/gatepass" || location.pathname === "/records") {
      pageTitle = "View Gate Pass History";
    } else if (location.pathname.startsWith("/gatepass/")) {
      pageTitle = "Gate Pass Detail";
    }
  }

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
        className={`fixed lg:relative inset-y-0 left-0 z-50 bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden transition-all duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${sidebarHidden ? "lg:w-0 lg:border-r-0" : "lg:w-60 shrink-0"} w-60`}
      >
        {/* Logo */}
        <div className="h-14 border-b border-sidebar-border flex items-center justify-between px-4">
          <Link to="/dashboard" className="leading-none">
            <img
              src={prokonLogo.url}
              alt="Prokon Hi-Tech Systems"
              className="h-9 w-auto object-contain"
            />
          </Link>
          <button
            type="button"
            onClick={() => setSidebarHidden(true)}
            className="hidden lg:inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-4" aria-label="Primary">
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
            if (g === "Material Movement") {
              if (!showMm) return null;
              const isOpen = openGroups[g] !== false;
              return (
                <div key={g}>
                  <button
                    type="button"
                    onClick={() => setOpenGroups((s) => ({ ...s, [g]: !isOpen }))}
                    className="w-full flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-[0.08em] px-3 py-1.5 hover:text-foreground"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <span>{g}</span>
                  </button>
                  {isOpen && (
                    <div className="space-y-0.5">
                      <div>
                        <button
                          type="button"
                          onClick={() => setGatepassOpen((v) => !v)}
                          className={`w-full ${navLinkCls(isActive("/gatepass"))}`}
                          aria-expanded={gatepassOpen}
                        >
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left">Gate Passes</span>
                          {gatepassOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          )}
                        </button>
                        {gatepassOpen && (
                          <div className="ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border/60 pl-2">
                            <Link
                              to="/gatepass"
                              className={navLinkCls(
                                location.pathname === "/gatepass" ||
                                  location.pathname === "/records"
                              )}
                            >
                              <ListChecks className="h-4 w-4 shrink-0" />
                              View Gate Pass History
                            </Link>
                            {can("gatepass", "create") && (
                              <Link
                                to="/gatepass/new"
                                className={navLinkCls(
                                  location.pathname === "/gatepass/new" ||
                                    location.pathname === "/new"
                                )}
                              >
                                <Plus className="h-4 w-4 shrink-0" />
                                Create New Gate Pass
                              </Link>
                            )}
                          </div>
                        )}
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => setChallanOpen((v) => !v)}
                          className={`w-full ${navLinkCls(isActive("/challan"))}`}
                          aria-expanded={challanOpen}
                        >
                          <Send className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left">Delivery Challans</span>
                          {challanOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          )}
                        </button>
                        {challanOpen && (
                          <div className="ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border/60 pl-2">
                            <Link
                              to="/challan"
                              className={navLinkCls(
                                location.pathname === "/challan" ||
                                  (isActive("/challan") && !isActive("/challan/new"))
                              )}
                            >
                              <ListChecks className="h-4 w-4 shrink-0" />
                              View All Delivery Challans
                            </Link>
                            <Link to="/challan/new" className={navLinkCls(isActive("/challan/new"))}>
                              <Plus className="h-4 w-4 shrink-0" />
                              Create New Delivery Challan
                            </Link>
                          </div>
                        )}
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => setGrnOpen((v) => !v)}
                          className={`w-full ${navLinkCls(isActive("/grn"))}`}
                          aria-expanded={grnOpen}
                        >
                          <PackageCheck className="h-4 w-4 shrink-0" />
                          <span className="flex-1 text-left">GRNs</span>
                          {grnOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          )}
                        </button>
                        {grnOpen && (
                          <div className="ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border/60 pl-2">
                            <Link
                              to="/grn"
                              className={navLinkCls(
                                location.pathname === "/grn" ||
                                  (isActive("/grn") && !isActive("/grn/new"))
                              )}
                            >
                              <ListChecks className="h-4 w-4 shrink-0" />
                              View All GRNs
                            </Link>
                            <Link to="/grn/new" className={navLinkCls(isActive("/grn/new"))}>
                              <Plus className="h-4 w-4 shrink-0" />
                              Create New GRN
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            }
            if (!items || items.length === 0) return null;
            const isOpen = openGroups[g] !== false;
            return (
              <div key={g}>
                <button
                  type="button"
                  onClick={() => setOpenGroups((s) => ({ ...s, [g]: !isOpen }))}
                    className="w-full flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-[0.08em] px-3 py-1.5 hover:text-foreground"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0" />
                  )}
                  <span>{g}</span>
                </button>
                {isOpen && (
                  <div className="space-y-0.5">
                    {items.map((n) => (
                      <Link
                        key={`${n.to}-${n.matchSearchTab ?? ""}`}
                        to={n.to}
                        search={n.search as any}
                        className={navLinkCls(
                          n.group === "Masters"
                            ? isMasterTabActive(n.to, n.matchSearchTab)
                            : isActive(n.to)
                        )}
                      >
                        <n.icon className="h-4 w-4 shrink-0" />
                        {n.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          className="h-14 border-b flex items-center gap-3 px-4 md:px-6 sticky top-0 z-30 bg-background/95 backdrop-blur shadow-[0_1px_0_rgba(15,23,42,0.03)] print:hidden"
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
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex text-muted-foreground"
            onClick={() => setSidebarHidden((v) => !v)}
            aria-label={sidebarHidden ? "Show sidebar" : "Hide sidebar"}
            title={sidebarHidden ? "Show menu" : "Hide menu"}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="truncate text-[15px] font-semibold text-foreground leading-tight">
              {pageTitle}
            </h1>
            {pageGroup && (
              <p className="truncate text-[11px] text-muted-foreground leading-tight">
                {pageGroup}
              </p>
            )}
          </div>
          <UserProfileMenu profile={profile} onProfileChange={loadProfile} />
        </header>

        {/* Content */}
        <main className="p-4 md:p-6 max-w-[1600px] w-full mx-auto">
          <ClaimAdminBanner />
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
      <IdleTimeout />
    </div>
  );
}
