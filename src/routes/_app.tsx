import { useEffect, useState, useCallback, useRef } from "react";
import { createFileRoute, Outlet, Link, Navigate, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListChecks,
  ShieldCheck,
  Send,
  Menu,
  Plus,
  Search,
  Command as CommandIcon,
} from "lucide-react";
import { usePermissions } from "@/lib/usePermissions";
import prokonLogo from "@/assets/prokon-logo.jpeg.asset.json";
import { getMyProfile } from "@/lib/admin-users.functions";
import { PageLoader } from "@/components/shared/skeletons";
import { UserProfileMenu, type ProfileInfo } from "@/components/UserProfileMenu";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { IdleTimeout } from "@/components/IdleTimeout";
import { ClaimAdminBanner } from "@/components/AdminAccessNotices";
import { useActivityTracker } from "@/lib/useActivityTracker";
import { toast } from "sonner";
import { NAV_ITEMS, QUICK_ACTIONS, GROUP_ORDER, groupForPath, type NavItem } from "@/lib/navigation";
import { CommandPalette } from "@/components/CommandPalette";
import { ConfirmProvider } from "@/hooks/useConfirm";
import { ACCOUNT_NOT_ACTIVE, PASSWORD_CHANGE_REQUIRED } from "@/lib/account-gate";
import { DefaultErrorComponent } from "@/router";

/**
 * Detects an account-gate denial thrown by a gated server fn. We branch on the
 * structured `code` first, but fall back to a 401 + message-string match because
 * the server-fn error serializer's handling of own-properties is uncertain.
 */
function isAccountGateError(err: unknown): { code: string } | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, any>;
  if (e.code === ACCOUNT_NOT_ACTIVE || e.code === PASSWORD_CHANGE_REQUIRED) {
    return { code: e.code };
  }
  if (e.statusCode === 401) {
    const msg = typeof e.message === "string" ? e.message : "";
    if (/password change required/i.test(msg)) return { code: PASSWORD_CHANGE_REQUIRED };
    if (/account is .*contact your administrator|no account profile found/i.test(msg)) {
      return { code: ACCOUNT_NOT_ACTIVE };
    }
  }
  return null;
}

/**
 * Error boundary for the _app subtree. Catches account-gate denials (401s) thrown
 * by gated server fns in descendant route loaders/handlers — previously these
 * were swallowed into the generic error page and left the user on a broken shell.
 */
function AppErrorBoundary({ error }: { error: Error }) {
  const gate = isAccountGateError(error);
  if (gate?.code === PASSWORD_CHANGE_REQUIRED) {
    // Non-dismissable change-password dialog over a blank shell.
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <ChangePasswordDialog
          open
          forced
          onOpenChange={() => {}}
          onChanged={() => window.location.assign("/dashboard")}
        />
      </div>
    );
  }
  if (gate?.code === ACCOUNT_NOT_ACTIVE) {
    return (
      <div className="min-h-screen grid place-items-center bg-background px-4 text-center">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Your account is disabled</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account is disabled — contact an administrator.
          </p>
          <Navigate to="/auth" />
        </div>
      </div>
    );
  }
  return <DefaultErrorComponent error={error} reset={() => {}} />;
}

export const Route = createFileRoute("/_app")({
  component: AppLayout,
  errorComponent: AppErrorBoundary,
});

function AppLayout() {
  const { session, loading } = useAuth();
  useActivityTracker(!!session);
  const location = useLocation();
  const { can, isAdmin, loading: permLoading } = usePermissions();
  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [forceChange, setForceChange] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("prokon-sidebar-hidden") === "true";
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = window.localStorage.getItem("prokon-sidebar-groups");
      if (stored) return JSON.parse(stored);
    } catch {}
    return {};
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [gateBlocked, setGateBlocked] = useState(false);
  const fetchProfile = useServerFn(getMyProfile);

  // Persist sidebar state + auto-expand the active group on navigation.
  const prevGroupRef = useRef<string | null>(null);
  useEffect(() => {
    window.localStorage.setItem("prokon-sidebar-hidden", String(sidebarHidden));
  }, [sidebarHidden]);
  useEffect(() => {
    window.localStorage.setItem("prokon-sidebar-groups", JSON.stringify(openGroups));
  }, [openGroups]);
  useEffect(() => {
    const activeGroup = groupForPath(location.pathname);
    if (activeGroup && !openGroups[activeGroup]) {
      setOpenGroups((s) => ({ ...s, [activeGroup]: true }));
    }
    prevGroupRef.current = activeGroup;
  }, [location.pathname]);

  // ⌘K / Ctrl+K global shortcut.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function loadProfile() {
    try {
      // Ensure a live access token exists before calling the protected
      // server fn; otherwise the auth middleware throws "No authorization
      // header provided" (e.g. right after sign-out or a stale session).
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: s } = await supabase.auth.getSession();
      if (!s.session?.access_token) {
        setProfile(null);
        return;
      }
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
    } catch (err) {
      // The forced-change signal is enforced server-side by requireActiveUser
      // now, so this catch must never hide a failure again: surface it in the
      // console instead of silently rendering a profile-less layout. If the
      // failure is an account-gate denial, route it to the right UX.
      const gate = isAccountGateError(err);
      if (gate?.code === PASSWORD_CHANGE_REQUIRED) {
        setForceChange(true);
      } else if (gate?.code === ACCOUNT_NOT_ACTIVE) {
        setGateBlocked(true);
      }
      setProfile(null);
      console.error("[profile] getMyProfile failed:", err instanceof Error ? err.message : err);
    }
  }

  useEffect(() => {
    if (session) loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  if (loading) return <PageLoader label="Loading your workspace…" />;
  if (!session) return <Navigate to="/auth" />;
  if (gateBlocked) return <Navigate to="/auth" />;

  const navItems = permLoading
    ? NAV_ITEMS
    : NAV_ITEMS.filter((n) => {
        if (n.adminOnly) return isAdmin;
        if (n.module) return can(n.module, "read");
        return true;
      });

  const isActive = (path: string, exclude?: string[]) => {
    if (exclude?.some((p) => location.pathname === p || location.pathname.startsWith(p + "/")))
      return false;
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };
  const currentSearchTab = (location.search as any)?.tab as string | undefined;
  const isMasterTabActive = (path: string, tab?: string) => {
    if (path !== "/masters") return isActive(path);
    if (location.pathname !== "/masters") return false;
    if (!tab) return !currentSearchTab || currentSearchTab === "company";
    return currentSearchTab === tab;
  };
  const navLinkCls = (active: boolean) =>
    `relative flex items-center gap-2.5 pl-4 pr-3 py-1.5 rounded-md text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar ${
      active
        ? "bg-primary/10 text-primary font-medium before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
        : "text-foreground/75 hover:bg-muted hover:text-foreground"
    }`;

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

  // Derive current page title from active nav item for the header.
  // Longest-prefix match wins so /gatepass/new titles as "New Gate Pass",
  // not "Gate Passes"; excludeActive keeps parents from stealing the match.
  const currentNav = [...navItems]
    .sort((a, b) => b.to.length - a.to.length)
    .find((n) => {
      if (n.excludeActive?.some((p) => location.pathname === p || location.pathname.startsWith(p + "/")))
        return false;
      if (n.to === "/masters" && location.pathname === "/masters") {
        return isMasterTabActive(n.to, n.matchSearchTab);
      }
      return location.pathname === n.to || location.pathname.startsWith(n.to + "/");
    });
  let pageTitle = currentNav?.label ?? "Dashboard";
  let pageGroup = currentNav?.group;
  if (isActive("/gatepass")) {
    pageGroup = "Material Movement";
    if (location.pathname === "/gatepass/new") {
      pageTitle = "Create New Gate Pass";
    } else if (location.pathname === "/gatepass") {
      pageTitle = "Gate Pass History";
    } else if (location.pathname.startsWith("/gatepass/")) {
      pageTitle = "Gate Pass Detail";
    }
  }

  return (
    <ConfirmProvider>
      <div className="min-h-screen bg-muted/20 flex">
      {/* Skip to content — keyboard accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:rounded-md focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden print:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:relative inset-y-0 left-0 z-50 bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden transition-[width,transform] duration-200 print:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${sidebarHidden ? "lg:w-0 lg:border-r-0" : "lg:w-60 shrink-0"} w-60`}
        data-print="hide"
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
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setMobileOpen(false)}
                  className={navLinkCls(isActive(n.to))}
                >
                  <n.icon className="h-4 w-4 shrink-0" />
                  {n.label}
                </Link>
              ))}
            </div>
          )}

          {/* Grouped items */}
          {GROUP_ORDER.map((g) => {
            const items = groupMap.get(g);
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
                        onClick={() => setMobileOpen(false)}
                        className={navLinkCls(
                          n.group === "Masters"
                            ? isMasterTabActive(n.to, n.matchSearchTab)
                            : isActive(n.to, n.excludeActive)
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
          <Button
            variant="outline"
            size="sm"
            className="hidden md:inline-flex gap-1.5 text-muted-foreground"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette (⌘K)"
          >
            <CommandIcon className="h-3.5 w-3.5" />
            <span className="text-xs">Search…</span>
            <kbd className="ml-1 inline-flex h-5 items-center rounded border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </Button>
          <UserProfileMenu profile={profile} onProfileChange={loadProfile} />
        </header>

        {/* Content */}
        <main id="main-content" className="p-4 md:p-6 max-w-[1600px] w-full mx-auto" tabIndex={-1}>
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
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </ConfirmProvider>
  );
}